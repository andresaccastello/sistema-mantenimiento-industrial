import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';
import { procesarVencimientos } from '../functions/preventivos/vencimientos.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (ESTIMACION USO TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

async function getTokenForUser(user: { id: number; legajo: string; sesion_version: number }) {
  return await sign(
    {
      sub: String(user.id),
      legajo: user.legajo,
      sv: user.sesion_version,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    JWT_SECRET,
    'HS256'
  );
}

interface Respuesta {
  status: number;
  cuerpo: any;
}

async function pedir(method: string, path: string, token: string | null, body?: unknown): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await app.request(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const texto = await r.text();
  let cuerpo: any = texto;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    // no es JSON
  }
  return { status: r.status, cuerpo };
}

const TIPO_VENCIMIENTO = 'PREVENTIVO_VENCIMIENTO';
const TIPO_ATRASO = 'LECTURA_ATRASADA';

test('Etapa HE1 — Horómetro estimado (EU-01 a EU-15)', async (t) => {
  let client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];

  // Lo que ya había: la revisión diaria recorre toda la base, así que los avisos de esta
  // corrida se borran por id
  const inicio = (await client.query(
    `SELECT
       (SELECT COALESCE(max(id), 0) FROM avisos_vencimiento)::bigint AS aviso,
       (SELECT COALESCE(max(id), 0) FROM notificaciones)::bigint AS notificacion,
       NOW() AS ahora`
  )).rows[0];
  const ultimoAviso = Number(inicio.aviso);
  const ultimaNotificacion = Number(inicio.notificacion);
  const inicioEn: Date = inicio.ahora;

  try {
    const suf = Date.now();
    const passHash = await bcrypt.hash('pass123', 10);

    const perfilMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, nombre FROM perfiles')).rows) {
      perfilMap[r.nombre] = Number(r.id);
    }
    const permisoPlanes = Number((await client.query(`SELECT id FROM permisos WHERE codigo = 'PLANES_GESTIONAR'`)).rows[0].id);

    // Planta, sectores y máquinas
    const pl = Number((await client.query(
      'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`EU_PL_${suf}`]
    )).rows[0].id);
    createdPlantaIds.push(pl);
    async function crearSector(nombre: string) {
      const id = Number((await client.query(
        'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`${nombre}_${suf}`, pl]
      )).rows[0].id);
      createdSectorIds.push(id);
      return id;
    }
    const s1 = await crearSector('EU_S1');
    const s2 = await crearSector('EU_S2');
    let numeroMaquina = 0;
    async function crearMaquina(sectorId = s1) {
      numeroMaquina++;
      const n = String(numeroMaquina).padStart(2, '0');
      const r = await client.query(
        `INSERT INTO maquinas (codigo, nombre, sector_id, activo)
         VALUES ($1, $2, $3, TRUE) RETURNING id, codigo, nombre`,
        [`EU_M${n}_${suf}`, `Maquina EU ${n}`, sectorId]
      );
      const id = Number(r.rows[0].id);
      createdMaquinaIds.push(id);
      return { id, codigo: r.rows[0].codigo as string, nombre: r.rows[0].nombre as string };
    }

    // Usuarios
    async function crearUsuario(clave: string, perfil: string, sectores: number[]) {
      const res = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, $2, 'EU', $3, $4, TRUE, 1) RETURNING id, legajo, sesion_version`,
        [`EU_${clave}_${suf}`, clave, passHash, perfilMap[perfil]]
      );
      const u = res.rows[0];
      const id = Number(u.id);
      createdUsuarioIds.push(id);
      for (const s of sectores) {
        await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)', [id, s]);
      }
      return { id, token: await getTokenForUser({ id, legajo: u.legajo, sesion_version: Number(u.sesion_version) }) };
    }
    const A = await crearUsuario('Admin', 'ADMINISTRADOR', []);
    // G: solo PLANES_GESTIONAR, por excepción, con el alcance del sector 2
    const G = await crearUsuario('Gestor', 'CONSULTA', [s2]);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Planes de su sector', $3)`,
      [G.id, permisoPlanes, A.id]
    );
    /** Un responsable sin PLANES_GESTIONAR: recibe avisos solo de los planes de los que es responsable. */
    let numeroResponsable = 0;
    async function responsable() {
      const u = await crearUsuario(`Resp${++numeroResponsable}`, 'RESPONSABLE_MANTENIMIENTO', [s1]);
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, motivo, otorgado_por_usuario_id)
         VALUES ($1, $2, 'DENEGAR', 'Solo como responsable', $3)`,
        [u.id, permisoPlanes, A.id]
      );
      return u;
    }

    // Helpers
    let numeroMedidor = 0;
    /** Un medidor dado de alta por A, sin lecturas salvo que se pasen. */
    async function medidor(maquinaId: number, extra: Record<string, unknown> = {}) {
      numeroMedidor++;
      const r = await pedir('POST', '/api/medidores', A.token, {
        maquina_id: maquinaId,
        nombre: `Horómetro ${numeroMedidor}`,
        unidad: 'h',
        lectura_cada_dias: null,
        ...extra,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      return { id: Number(r.cuerpo.id), nombre: r.cuerpo.nombre as string };
    }
    const verMedidor = async (id: number) => {
      const r = await pedir('GET', `/api/medidores/${id}`, A.token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      return r.cuerpo;
    };
    const cambiarMedidor = (id: number, body: unknown, token = A.token) => pedir('PATCH', `/api/medidores/${id}`, token, body);

    /**
     * Carga una lectura por la API y le corre registrada_en al mediodía local de
     * hoy_instalacion() − dias, como en LR. Devuelve el id de la lectura.
     */
    async function lectura(medidorId: number, valor: number, dias: number) {
      const r = await pedir('POST', `/api/medidores/${medidorId}/lecturas`, A.token, { valor });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      const id = Number(r.cuerpo.id);
      await client.query(
        `UPDATE lecturas_medidor SET registrada_en = (
           ((hoy_instalacion() - $2::int)::timestamp + interval '12 hours') AT TIME ZONE COALESCE(
             (SELECT zona_horaria FROM configuracion_sistema WHERE id = 1), 'America/Argentina/Buenos_Aires'
           )
         ) WHERE id = $1`,
        [id, dias]
      );
      return id;
    }
    /** hoy_instalacion() + dias, como YYYY-MM-DD: las fechas esperadas salen del hoy de la base. */
    const fechaBase = async (dias: number) =>
      (await client.query(`SELECT to_char(hoy_instalacion() + $1::int, 'YYYY-MM-DD') AS f`, [dias])).rows[0].f as string;

    /** Una tarea por uso: toca a las `primera` y avisa `anticipacion` antes. */
    const tareaUso = (accion: string, medidorId: number, primera = 200, anticipacion = 30) => ({
      accion,
      uso: { medidor_id: medidorId, cada: 100, primera, anticipacion },
    });
    let numeroPlan = 0;
    async function crearPlan(maquinaId: number, tareas: unknown[], extra: Record<string, unknown> = {}) {
      numeroPlan++;
      const r = await pedir('POST', '/api/planes', A.token, {
        maquina_id: maquinaId,
        nombre: `Plan EU ${numeroPlan}`,
        anticipacion_dias: 7,
        tareas,
        ...extra,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      return r.cuerpo;
    }
    const verPlan = async (id: number) => {
      const r = await pedir('GET', `/api/planes/${id}`, A.token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      return r.cuerpo;
    };
    /** Apaga el plan al terminar el caso, para que no entre en las revisiones de los que siguen. */
    const apagar = async (...planIds: number[]) =>
      client.query('UPDATE planes_mantenimiento SET activo = FALSE WHERE id = ANY($1)', [planIds]);
    /** La revisión diaria, forzada. */
    const revisar = () => procesarVencimientos({ forzar: true });
    /** Los avisos de un usuario, de un tipo, de esta corrida. */
    const avisosDe = async (usuarioId: number, tipo: string) =>
      (await client.query(
        `SELECT id, titulo, mensaje, maquina_id FROM notificaciones
         WHERE usuario_id = $1 AND tipo_evento = $2 AND id > $3 ORDER BY id`,
        [usuarioId, tipo, ultimaNotificacion]
      )).rows.map((r) => ({
        id: Number(r.id),
        titulo: r.titulo as string,
        mensaje: r.mensaje as string,
        maquina_id: r.maquina_id === null ? null : Number(r.maquina_id),
      }));

    // =========================================================================
    // EU-01: Sin nada
    // =========================================================================
    await t.test('EU-01: Sin lecturas ni uso declarado, ritmo y estimacion nulos', async () => {
      const m = await crearMaquina();
      const sinNada = await medidor(m.id);
      const conLectura = await medidor(m.id, { lectura_inicial: 100 });
      const p = await crearPlan(m.id, [tareaUso('Sin nada', sinNada.id), tareaUso('Con lectura', conLectura.id)]);

      for (const id of [sinNada.id, conLectura.id]) {
        const d = await verMedidor(id);
        assert.deepStrictEqual(
          [d.uso_estimado, d.ritmo, d.valor_estimado_hoy, d.atraso_por_dias, d.atraso_por_uso, d.atrasado],
          [null, null, null, false, false, false]
        );
      }
      const plan = await verPlan(p.id);
      assert.deepStrictEqual(plan.tareas.map((x: any) => x.uso.estimacion), [null, null]);
      await apagar(p.id);
    });

    // =========================================================================
    // EU-02: Con el declarado
    // =========================================================================
    await t.test('EU-02: 40 por semana y una lectura de 100 hace 2 días', async () => {
      const m = await crearMaquina();
      const med = await medidor(m.id, { uso_estimado: { valor: 40, periodo: 'SEMANA' } });
      await lectura(med.id, 100, 2);
      const p = await crearPlan(m.id, [tareaUso('Cambiar aceite', med.id, 200, 30)]);

      const d = await verMedidor(med.id);
      assert.deepStrictEqual(d.uso_estimado, { valor: 40, periodo: 'SEMANA' });
      assert.deepStrictEqual(d.ritmo, {
        por_dia: 5.714,
        fuente: 'DECLARADO',
        declarado_por_dia: 5.714,
        lecturas: null,
        desvio_pct: null,
      });
      assert.strictEqual(d.valor_estimado_hoy, 111.43);

      const uso = (await verPlan(p.id)).tareas[0].uso;
      assert.deepStrictEqual(uso.estimacion, {
        fecha: await fechaBase(-2 + 18),
        fecha_aviso: await fechaBase(-2 + 13),
        pasada: false,
        ritmo_por_dia: 5.714,
        fuente: 'DECLARADO',
      });
      // Lo de siempre no cambia
      assert.deepStrictEqual([uso.estado, uso.faltan, uso.proximo], ['AL_DIA', 100, 200]);

      // La misma estimación en /vencimientos
      const v = await pedir('GET', `/api/planes/vencimientos?maquina_id=${m.id}&estado=AL_DIA`, A.token);
      assert.strictEqual(v.status, 200, JSON.stringify(v.cuerpo));
      assert.deepStrictEqual(v.cuerpo.tareas[0].uso.estimacion, uso.estimacion);
      await apagar(p.id);
    });

    // =========================================================================
    // EU-03: De declarado a lecturas
    // =========================================================================
    await t.test('EU-03: Con 2 lecturas sigue DECLARADO; con 3 en 7 días o más, LECTURAS', async () => {
      const m = await crearMaquina();
      const mas = await medidor(m.id, { uso_estimado: { valor: 40, periodo: 'SEMANA' } });
      const menos = await medidor(m.id, { uso_estimado: { valor: 20, periodo: 'DIA' } });
      const p = await crearPlan(m.id, [tareaUso('Más', mas.id, 300, 30), tareaUso('Menos', menos.id, 300, 30)]);

      const l1 = await lectura(mas.id, 100, 16);
      await lectura(mas.id, 150, 9);
      await lectura(menos.id, 100, 16);
      await lectura(menos.id, 150, 9);
      assert.strictEqual((await verMedidor(mas.id)).ritmo.fuente, 'DECLARADO', 'Con 2 lecturas');

      await lectura(mas.id, 240, 2);
      await lectura(menos.id, 240, 2);

      // 140 en 14 días: 10 por día. Contra 5,714 declarado, +75 %; contra 20, −50 %
      const d = await verMedidor(mas.id);
      const desde = (await client.query('SELECT registrada_en FROM lecturas_medidor WHERE id = $1', [l1])).rows[0].registrada_en;
      assert.deepStrictEqual(
        { ...d.ritmo, lecturas: { ...d.ritmo.lecturas, desde: null, hasta: null } },
        {
          por_dia: 10,
          fuente: 'LECTURAS',
          declarado_por_dia: 5.714,
          lecturas: { usadas: 3, desde: null, hasta: null },
          desvio_pct: 75,
        }
      );
      assert.strictEqual(new Date(d.ritmo.lecturas.desde).getTime(), new Date(desde).getTime());
      assert.strictEqual((await verMedidor(menos.id)).ritmo.desvio_pct, -50);

      // La fecha sale del ritmo real: faltan 60 a 10 por día, 6 días desde la última
      const est = (await verPlan(p.id)).tareas[0].uso.estimacion;
      assert.deepStrictEqual(est, {
        fecha: await fechaBase(-2 + 6),
        fecha_aviso: await fechaBase(-2 + 3),
        pasada: false,
        ritmo_por_dia: 10,
        fuente: 'LECTURAS',
      });
      await apagar(p.id);
    });

    // =========================================================================
    // EU-04: Pocos días
    // =========================================================================
    await t.test('EU-04: 3 lecturas en menos de 7 días no alcanzan', async () => {
      const m = await crearMaquina();
      const conDeclarado = await medidor(m.id, { uso_estimado: { valor: 2, periodo: 'DIA' } });
      const sinDeclarado = await medidor(m.id);
      for (const med of [conDeclarado, sinDeclarado]) {
        await lectura(med.id, 100, 7);
        await lectura(med.id, 150, 4);
        await lectura(med.id, 200, 1);
      }
      const c = await verMedidor(conDeclarado.id);
      assert.deepStrictEqual([c.ritmo.fuente, c.ritmo.por_dia, c.ritmo.lecturas, c.ritmo.desvio_pct], ['DECLARADO', 2, null, null]);
      assert.strictEqual((await verMedidor(sinDeclarado.id)).ritmo, null);
    });

    // =========================================================================
    // EU-05: La ventana
    // =========================================================================
    await t.test('EU-05: La ventana de 60 días, o las 3 últimas', async () => {
      const m = await crearMaquina();
      // Con 3 en los 60 días, la de hace 100 no entra: (190 − 150) / 40 = 1
      const tres = await medidor(m.id);
      await lectura(tres.id, 100, 100);
      await lectura(tres.id, 150, 50);
      await lectura(tres.id, 170, 30);
      await lectura(tres.id, 190, 10);
      const a = await verMedidor(tres.id);
      assert.deepStrictEqual([a.ritmo.fuente, a.ritmo.por_dia, a.ritmo.lecturas.usadas], ['LECTURAS', 1, 3]);

      // Con 1 en los 60 días, las 3 últimas: (310 − 200) / 140 = 0,786
      const una = await medidor(m.id);
      await lectura(una.id, 100, 200);
      await lectura(una.id, 200, 150);
      await lectura(una.id, 300, 100);
      await lectura(una.id, 310, 10);
      const b = await verMedidor(una.id);
      assert.deepStrictEqual([b.ritmo.fuente, b.ritmo.por_dia, b.ritmo.lecturas.usadas], ['LECTURAS', 0.786, 3]);
    });

    // =========================================================================
    // EU-06: Anuladas
    // =========================================================================
    await t.test('EU-06: Una lectura anulada no cuenta', async () => {
      const m = await crearMaquina();
      const med = await medidor(m.id);
      await lectura(med.id, 100, 20);
      await lectura(med.id, 200, 10);
      const ultima = await lectura(med.id, 300, 2);
      assert.strictEqual((await verMedidor(med.id)).ritmo.lecturas.usadas, 3);

      const r = await pedir('POST', `/api/medidores/${med.id}/lecturas/${ultima}/anular`, A.token, { motivo: 'Mal cargada' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      assert.strictEqual((await verMedidor(med.id)).ritmo, null, 'Quedan 2: no alcanza');
    });

    // =========================================================================
    // EU-07: Ritmo 0
    // =========================================================================
    await t.test('EU-07: Ritmo 0 según las lecturas: LECTURAS, 0 y sin fecha', async () => {
      const m = await crearMaquina();
      const med = await medidor(m.id, { uso_estimado: { valor: 40, periodo: 'SEMANA' } });
      await lectura(med.id, 100, 20);
      await lectura(med.id, 100, 10);
      await lectura(med.id, 100, 2);
      const p = await crearPlan(m.id, [tareaUso('Parada', med.id)]);

      const d = await verMedidor(med.id);
      assert.deepStrictEqual([d.ritmo.fuente, d.ritmo.por_dia, d.ritmo.desvio_pct, d.valor_estimado_hoy], ['LECTURAS', 0, -100, 100]);
      assert.strictEqual((await verPlan(p.id)).tareas[0].uso.estimacion, null);
      await apagar(p.id);
    });

    // =========================================================================
    // EU-08: No cambia estados
    // =========================================================================
    await t.test('EU-08: Con estimada_pasada, estado y estado_uso son los de sin declarado', async () => {
      const m = await crearMaquina();
      // 70 por semana, 10 por día: la de 100 hace 30 días llegaría a 200 hace 20
      const conDeclarado = await medidor(m.id, { uso_estimado: { valor: 70, periodo: 'SEMANA' } });
      const sinDeclarado = await medidor(m.id);
      await lectura(conDeclarado.id, 100, 30);
      await lectura(sinDeclarado.id, 100, 30);
      const p = await crearPlan(m.id, [tareaUso('Con', conDeclarado.id), tareaUso('Sin', sinDeclarado.id)]);

      const [con, sin] = (await verPlan(p.id)).tareas;
      assert.deepStrictEqual(con.uso.estimacion, {
        fecha: await fechaBase(-30 + 10),
        fecha_aviso: await fechaBase(-30 + 7),
        pasada: true,
        ritmo_por_dia: 10,
        fuente: 'DECLARADO',
      });
      assert.strictEqual(sin.uso.estimacion, null);
      const lo = (x: any) => [x.estado, x.uso.estado, x.uso.faltan, x.uso.proximo];
      assert.deepStrictEqual(lo(con), ['AL_DIA', 'AL_DIA', 100, 200]);
      assert.deepStrictEqual(lo(con), lo(sin));

      // Sin el declarado, nada cambia
      const r = await cambiarMedidor(conDeclarado.id, { uso_estimado: null });
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      const despues = (await verPlan(p.id)).tareas[0];
      assert.deepStrictEqual(lo(despues), lo(con));
      assert.strictEqual(despues.uso.estimacion, null);
      await apagar(p.id);
    });

    // =========================================================================
    // EU-09: No genera nada
    // =========================================================================
    await t.test('EU-09: Una tarea pasada en un plan automático no genera ninguna intervención', async () => {
      const R = await responsable();
      const m = await crearMaquina();
      const med = await medidor(m.id, { uso_estimado: { valor: 70, periodo: 'SEMANA' } });
      await lectura(med.id, 100, 30);
      const p = await crearPlan(m.id, [tareaUso('Pasada', med.id)], {
        generacion_automatica: true,
        responsable_usuario_id: R.id,
      });
      assert.strictEqual((await verPlan(p.id)).tareas[0].uso.estimacion.pasada, true);

      const r = await revisar();
      assert.ok(!(r.generadas ?? []).some((g) => g.plan_id === p.id), JSON.stringify(r));
      const ints = await client.query('SELECT count(*)::int AS n FROM intervenciones WHERE maquina_id = $1', [m.id]);
      assert.strictEqual(ints.rows[0].n, 0, 'Ninguna intervención');
      assert.strictEqual((await avisosDe(R.id, TIPO_VENCIMIENTO)).length, 0, 'Ningún aviso de vencimiento');
      // Sí avisa que hay que cargar una lectura (HE1, 4): 10 por día desde 100 hace 30 días
      assert.ok((r.lecturas_por_uso ?? 0) >= 1, JSON.stringify(r));
      assert.deepStrictEqual(await avisosDe(R.id, TIPO_ATRASO), [
        {
          id: (await avisosDe(R.id, TIPO_ATRASO))[0]?.id,
          titulo: 'Lecturas para cargar',
          mensaje: `${m.codigo} · ${med.nombre}: por el ritmo de uso (10 h/día) estaría en ≈ 400 h y hay una tarea que avisa a las 170 h. Cargá una lectura.`,
          maquina_id: m.id,
        },
      ]);
      await apagar(p.id);
    });

    // =========================================================================
    // EU-10: Validación
    // =========================================================================
    await t.test('EU-10: Validación de uso_estimado', async () => {
      const m = await crearMaquina();
      const med = await medidor(m.id, { uso_estimado: { valor: 40, periodo: 'SEMANA' } });
      const invalidos: Array<[string, unknown]> = [
        ['0', { valor: 0, periodo: 'DIA' }],
        ['negativo', { valor: -1, periodo: 'DIA' }],
        ['sin período', { valor: 40 }],
        ['sin valor', { periodo: 'DIA' }],
        ['período inválido', { valor: 40, periodo: 'ANIO' }],
        ['valor de texto', { valor: '40', periodo: 'DIA' }],
        ['texto', '40 por semana'],
        ['más de 2 decimales', { valor: 1.234, periodo: 'DIA' }],
        ['fuera de NUMERIC(14,2)', { valor: 1e13, periodo: 'DIA' }],
        ['un campo de más', { valor: 40, periodo: 'DIA', otro: 1 }],
        ['una lista', [40, 'DIA']],
      ];
      for (const [caso, uso] of invalidos) {
        const alta = await pedir('POST', '/api/medidores', A.token, {
          maquina_id: m.id, nombre: `Inválido ${caso}`, unidad: 'h', uso_estimado: uso,
        });
        assert.deepStrictEqual([alta.status, alta.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `alta, ${caso}`);
        const cambio = await cambiarMedidor(med.id, { uso_estimado: uso });
        assert.deepStrictEqual([cambio.status, cambio.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `cambio, ${caso}`);
      }
      assert.deepStrictEqual((await verMedidor(med.id)).uso_estimado, { valor: 40, periodo: 'SEMANA' }, 'No cambió');

      // Cambia, y null lo borra
      const mes = await cambiarMedidor(med.id, { uso_estimado: { valor: 160.5, periodo: 'MES' } });
      assert.strictEqual(mes.status, 200, JSON.stringify(mes.cuerpo));
      assert.deepStrictEqual(mes.cuerpo.uso_estimado, { valor: 160.5, periodo: 'MES' });
      const borrado = await cambiarMedidor(med.id, { uso_estimado: null });
      assert.strictEqual(borrado.status, 200, JSON.stringify(borrado.cuerpo));
      assert.deepStrictEqual([borrado.cuerpo.uso_estimado, borrado.cuerpo.ritmo], [null, null]);
      // Un PATCH sin el campo no lo toca
      await cambiarMedidor(med.id, { uso_estimado: { valor: 8, periodo: 'DIA' } });
      const otro = await cambiarMedidor(med.id, { nombre: 'Horómetro renombrado' });
      assert.deepStrictEqual(otro.cuerpo.uso_estimado, { valor: 8, periodo: 'DIA' });

      // Fuera del alcance, la respuesta de siempre
      const ajeno = await cambiarMedidor(med.id, { uso_estimado: { valor: 1, periodo: 'DIA' } }, G.token);
      assert.deepStrictEqual([ajeno.status, ajeno.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
      const altaAjena = await pedir('POST', '/api/medidores', G.token, {
        maquina_id: m.id, nombre: 'Ajeno', unidad: 'h', uso_estimado: { valor: 1, periodo: 'DIA' },
      });
      assert.deepStrictEqual([altaAjena.status, altaAjena.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
      assert.deepStrictEqual((await verMedidor(med.id)).uso_estimado, { valor: 8, periodo: 'DIA' });
    });

    const marcas = async (medidorId: number) =>
      (await client.query('SELECT atraso_avisado_en, estimacion_avisada_en FROM medidores WHERE id = $1', [medidorId])).rows[0];
    /** Una línea por uso, como en 4. */
    const lineaUso = (m: { codigo: string }, med: { nombre: string }, ritmo: string, valor: string, verbo: string, umbral: string) =>
      `${m.codigo} · ${med.nombre}: por el ritmo de uso (${ritmo} h/día) estaría en ≈ ${valor} h y hay una tarea que ${verbo} a las ${umbral} h. Cargá una lectura.`;

    // =========================================================================
    // EU-11: Una vez por episodio
    // =========================================================================
    await t.test('EU-11: El aviso por uso sale una vez; vuelve con una lectura nueva o con otro declarado', async () => {
      const R = await responsable();
      const m = await crearMaquina();
      // Sin control por días: igual avisa
      const med = await medidor(m.id, { uso_estimado: { valor: 70, periodo: 'SEMANA' }, lectura_cada_dias: null });
      await lectura(med.id, 100, 30);
      const p = await crearPlan(m.id, [tareaUso('Cambiar aceite', med.id)], { responsable_usuario_id: R.id });
      const d = await verMedidor(med.id);
      assert.deepStrictEqual([d.atraso_por_dias, d.atraso_por_uso, d.atrasado], [false, true, true]);

      await revisar();
      const primero = await avisosDe(R.id, TIPO_ATRASO);
      assert.deepStrictEqual(primero.map((a) => a.mensaje), [lineaUso(m, med, '10', '400', 'avisa', '170')]);
      assert.ok((await marcas(med.id)).estimacion_avisada_en !== null, 'Queda marcado');
      assert.strictEqual((await marcas(med.id)).atraso_avisado_en, null, 'Por días, no');

      await revisar();
      assert.strictEqual((await avisosDe(R.id, TIPO_ATRASO)).length, 1, 'No se repite');

      // Una lectura nueva limpia la marca; sigue atrasado por uso, así que vuelve a avisar
      await lectura(med.id, 110, 20);
      assert.strictEqual((await marcas(med.id)).estimacion_avisada_en, null, 'La lectura limpia la marca');
      await revisar();
      const segundo = await avisosDe(R.id, TIPO_ATRASO);
      assert.deepStrictEqual(segundo.map((a) => a.mensaje).slice(1), [lineaUso(m, med, '10', '310', 'avisa', '170')]);

      // El mismo declarado no limpia la marca; otro, sí
      await cambiarMedidor(med.id, { uso_estimado: { valor: 70, periodo: 'SEMANA' } });
      assert.ok((await marcas(med.id)).estimacion_avisada_en !== null, 'El mismo declarado no limpia');
      await cambiarMedidor(med.id, { uso_estimado: { valor: 140, periodo: 'SEMANA' } });
      assert.strictEqual((await marcas(med.id)).estimacion_avisada_en, null, 'Otro declarado limpia');
      await revisar();
      const tercero = await avisosDe(R.id, TIPO_ATRASO);
      assert.deepStrictEqual(tercero.map((a) => a.mensaje).slice(2), [lineaUso(m, med, '20', '510', 'avisa', '170')]);
      await apagar(p.id);
    });

    // =========================================================================
    // EU-12: Cada aviso por su lado
    // =========================================================================
    await t.test('EU-12: Los avisos por días y por uso van por separado, y juntos si coinciden', async () => {
      // Los dos a la vez: dos líneas en el mismo aviso
      const R1 = await responsable();
      const m1 = await crearMaquina();
      const ambos = await medidor(m1.id, { uso_estimado: { valor: 70, periodo: 'SEMANA' }, lectura_cada_dias: 7 });
      await lectura(ambos.id, 100, 30);
      const p1 = await crearPlan(m1.id, [tareaUso('Ambos', ambos.id)], { responsable_usuario_id: R1.id });

      // Primero por días; después se declara el uso
      const R2 = await responsable();
      const m2 = await crearMaquina();
      const diasPrimero = await medidor(m2.id, { lectura_cada_dias: 7 });
      await lectura(diasPrimero.id, 100, 30);
      const p2 = await crearPlan(m2.id, [tareaUso('Días primero', diasPrimero.id)], { responsable_usuario_id: R2.id });

      // Primero por uso; después se pide leer cada 7 días
      const R3 = await responsable();
      const m3 = await crearMaquina();
      const usoPrimero = await medidor(m3.id, { uso_estimado: { valor: 70, periodo: 'SEMANA' }, lectura_cada_dias: null });
      await lectura(usoPrimero.id, 100, 30);
      const p3 = await crearPlan(m3.id, [tareaUso('Uso primero', usoPrimero.id)], { responsable_usuario_id: R3.id });

      const r = await revisar();
      assert.ok((r.lecturas_atrasadas ?? 0) >= 2 && (r.lecturas_por_uso ?? 0) >= 2, JSON.stringify(r));
      const lineaDias = (m: { codigo: string }, med: { nombre: string }) => `${m.codigo} · ${med.nombre}: 30 días sin lectura (se lee cada 7)`;

      assert.deepStrictEqual((await avisosDe(R1.id, TIPO_ATRASO)).map((a) => [a.titulo, a.mensaje]), [
        ['Lecturas para cargar', `${lineaDias(m1, ambos)}\n${lineaUso(m1, ambos, '10', '400', 'avisa', '170')}`],
      ]);
      assert.deepStrictEqual((await avisosDe(R2.id, TIPO_ATRASO)).map((a) => a.mensaje), [lineaDias(m2, diasPrimero)]);
      assert.deepStrictEqual((await avisosDe(R3.id, TIPO_ATRASO)).map((a) => a.mensaje), [lineaUso(m3, usoPrimero, '10', '400', 'avisa', '170')]);

      // El avisado por días no tapa el de uso, y al revés: cada uno sale solo con su línea
      await cambiarMedidor(diasPrimero.id, { uso_estimado: { valor: 70, periodo: 'SEMANA' } });
      await cambiarMedidor(usoPrimero.id, { lectura_cada_dias: 7 });
      await revisar();
      assert.deepStrictEqual((await avisosDe(R2.id, TIPO_ATRASO)).map((a) => a.mensaje), [
        lineaDias(m2, diasPrimero),
        lineaUso(m2, diasPrimero, '10', '400', 'avisa', '170'),
      ]);
      assert.deepStrictEqual((await avisosDe(R3.id, TIPO_ATRASO)).map((a) => a.mensaje), [
        lineaUso(m3, usoPrimero, '10', '400', 'avisa', '170'),
        lineaDias(m3, usoPrimero),
      ]);
      assert.strictEqual((await avisosDe(R1.id, TIPO_ATRASO)).length, 1, 'El de los dos no se repite');
      await apagar(p1.id, p2.id, p3.id);
    });

    // =========================================================================
    // EU-13: La ronda
    // =========================================================================
    await t.test('EU-13: La ronda con solo_atrasados incluye un medidor atrasado solo por uso', async () => {
      const m = await crearMaquina();
      const porUso = await medidor(m.id, { uso_estimado: { valor: 70, periodo: 'SEMANA' }, lectura_cada_dias: null });
      const alDia = await medidor(m.id, { uso_estimado: { valor: 70, periodo: 'SEMANA' }, lectura_cada_dias: null });
      await lectura(porUso.id, 100, 30);
      await lectura(alDia.id, 100, 1);
      const p = await crearPlan(m.id, [tareaUso('Por uso', porUso.id), tareaUso('Al día', alDia.id)]);

      const r = await pedir('GET', `/api/medidores/ronda?maquina_id=${m.id}&solo_atrasados=true`, A.token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      assert.deepStrictEqual(
        r.cuerpo.map((x: any) => [x.id, x.atraso_por_dias, x.atraso_por_uso, x.atrasado]),
        [[porUso.id, false, true, true]]
      );
      const todos = await pedir('GET', `/api/medidores/ronda?maquina_id=${m.id}`, A.token);
      assert.deepStrictEqual(todos.cuerpo.map((x: any) => x.id).sort(), [porUso.id, alDia.id].sort());
      await apagar(p.id);
    });

    // Calendario
    const calendario = async (maquinaId: number) => {
      const hoy = await fechaBase(0);
      const r = await pedir('GET', `/api/planes/calendario?desde=${hoy}&hasta=${await fechaBase(40)}&maquina_id=${maquinaId}`, A.token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      return r.cuerpo;
    };
    const estimadas = (c: any) => c.eventos.filter((e: any) => e.tipo === 'ESTIMADA');
    const tareaFecha = (accion: string, primera: string, extra: Record<string, unknown> = {}) => ({
      accion,
      frecuencia_valor: 1,
      frecuencia_unidad: 'MESES',
      primera_fecha: primera,
      ...extra,
    });

    // =========================================================================
    // EU-14: Calendario, solo por uso
    // =========================================================================
    await t.test('EU-14: Solo por uso: ESTIMADA en fecha_estimada; una pasada, en hoy', async () => {
      const m = await crearMaquina();
      const futura = await medidor(m.id, { uso_estimado: { valor: 40, periodo: 'SEMANA' } });
      const pasada = await medidor(m.id, { uso_estimado: { valor: 70, periodo: 'SEMANA' } });
      await lectura(futura.id, 100, 2);
      await lectura(pasada.id, 100, 30);
      const p = await crearPlan(m.id, [tareaUso('Futura', futura.id), tareaUso('Pasada', pasada.id), tareaFecha('Por fecha', await fechaBase(5))]);
      const [tFutura, tPasada, tFecha] = p.tareas.map((x: any) => x.id);

      const c = await calendario(m.id);
      assert.deepStrictEqual(
        estimadas(c).map((e: any) => [e.tarea_id, e.fecha, e.estado, e.vencida_por_uso, e.tambien_por_uso, e.intervencion]),
        [
          [tPasada, await fechaBase(0), 'AL_DIA', false, false, null],
          [tFutura, await fechaBase(16), 'AL_DIA', false, false, null],
        ]
      );
      const [ePasada, eFutura] = estimadas(c);
      assert.deepStrictEqual(eFutura.estimacion, {
        fecha: await fechaBase(16),
        fecha_aviso: await fechaBase(11),
        pasada: false,
        ritmo_por_dia: 5.714,
        fuente: 'DECLARADO',
      });
      assert.deepStrictEqual([ePasada.estimacion.fecha, ePasada.estimacion.pasada], [await fechaBase(-20), true]);
      // Los demás tipos llevan estimacion en null
      const otros = c.eventos.filter((e: any) => e.tipo !== 'ESTIMADA');
      assert.ok(otros.some((e: any) => e.tarea_id === tFecha), 'La tarea por fecha sale');
      assert.ok(otros.every((e: any) => e.estimacion === null));

      // La lista por_uso sigue igual, ahora con la estimación
      assert.deepStrictEqual(c.por_uso.map((x: any) => x.tarea_id).sort(), [tFutura, tPasada].sort());
      assert.deepStrictEqual(c.por_uso.find((x: any) => x.tarea_id === tFutura).uso.estimacion, eFutura.estimacion);
      await apagar(p.id);
    });

    // =========================================================================
    // EU-15: Calendario, por fecha y por uso
    // =========================================================================
    await t.test('EU-15: Fecha y uso: ESTIMADA solo si llega antes; nunca VENCIDA ni EN_CURSO', async () => {
      const m = await crearMaquina();
      // 40 por semana desde 100 hace 2 días: la estimada es hoy + 16
      const med = await medidor(m.id, { uso_estimado: { valor: 40, periodo: 'SEMANA' } });
      await lectura(med.id, 100, 2);
      const uso = { uso: { medidor_id: med.id, cada: 100, primera: 200, anticipacion: 30 } };
      const p = await crearPlan(m.id, [
        tareaFecha('Llega antes por uso', await fechaBase(30), uso),
        tareaFecha('Llega antes por fecha', await fechaBase(10), uso),
      ]);
      const [tAntes, tDespues] = p.tareas.map((x: any) => x.id);
      const c = await calendario(m.id);
      assert.deepStrictEqual(estimadas(c).map((e: any) => [e.tarea_id, e.fecha]), [[tAntes, await fechaBase(16)]]);
      assert.ok(c.eventos.some((e: any) => e.tarea_id === tDespues && e.tipo === 'PENDIENTE'), 'La otra, por su fecha');

      // VENCIDA por uso: sin estimación ni evento
      const m2 = await crearMaquina();
      const vencido = await medidor(m2.id, { uso_estimado: { valor: 40, periodo: 'SEMANA' } });
      await lectura(vencido.id, 250, 2);
      const pv = await crearPlan(m2.id, [tareaUso('Vencida', vencido.id)]);
      const cv = await calendario(m2.id);
      assert.strictEqual(cv.por_uso[0].estado, 'VENCIDA');
      assert.deepStrictEqual([estimadas(cv), cv.por_uso[0].uso.estimacion], [[], null]);

      // EN_CURSO: próxima por uso, con la intervención generada
      const m3 = await crearMaquina();
      const proximo = await medidor(m3.id, { uso_estimado: { valor: 40, periodo: 'SEMANA' } });
      await lectura(proximo.id, 180, 2);
      const pe = await crearPlan(m3.id, [tareaUso('En curso', proximo.id)]);
      assert.strictEqual(estimadas(await calendario(m3.id)).length, 1, 'Próxima, antes de generar');
      const g = await pedir('POST', `/api/planes/${pe.id}/generar`, A.token, {});
      assert.strictEqual(g.status, 201, JSON.stringify(g.cuerpo));
      const ce = await calendario(m3.id);
      assert.strictEqual(ce.por_uso[0].estado, 'EN_CURSO');
      assert.deepStrictEqual([estimadas(ce), ce.por_uso[0].uso.estimacion], [[], null]);
      await apagar(p.id, pv.id, pe.id);
    });
  } finally {
    client = await clienteSano(client);
    // Limpieza: lo que creó esta prueba, y los avisos de esta corrida
    try {
      const maquinas = createdMaquinaIds;
      const tipos = [TIPO_VENCIMIENTO, TIPO_ATRASO];

      await client.query('DELETE FROM avisos_vencimiento WHERE id > $1', [ultimoAviso]);
      await client.query(
        `DELETE FROM notificacion_envios WHERE notificacion_id IN (
           SELECT id FROM notificaciones WHERE tipo_evento = ANY($1) AND id > $2
         )`,
        [tipos, ultimaNotificacion]
      );
      await client.query('DELETE FROM notificaciones WHERE tipo_evento = ANY($1) AND id > $2', [tipos, ultimaNotificacion]);
      // Los medidores ajenos que la revisión diaria de esta corrida marcó vuelven a quedar sin marca
      await client.query(
        'UPDATE medidores SET atraso_avisado_en = NULL WHERE atraso_avisado_en >= $1 AND NOT (maquina_id = ANY($2))',
        [inicioEn, maquinas]
      );
      await client.query(
        'UPDATE medidores SET estimacion_avisada_en = NULL WHERE estimacion_avisada_en >= $1 AND NOT (maquina_id = ANY($2))',
        [inicioEn, maquinas]
      );

      const intIds = (await client.query('SELECT id FROM intervenciones WHERE maquina_id = ANY($1)', [maquinas])).rows.map((r) => Number(r.id));
      if (maquinas.length > 0) {
        await client.query(
          'DELETE FROM lecturas_medidor WHERE medidor_id IN (SELECT id FROM medidores WHERE maquina_id = ANY($1))',
          [maquinas]
        );
      }
      if (intIds.length > 0) {
        await client.query(
          'DELETE FROM intervencion_tarea_repuestos WHERE intervencion_tarea_id IN (SELECT id FROM intervencion_tareas WHERE intervencion_id = ANY($1))',
          [intIds]
        );
        await client.query('DELETE FROM intervencion_tareas WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE intervencion_id = ANY($1))', [intIds]);
        await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM historial_estados_maquina WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = ANY($1)', [intIds]);
        await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [intIds]);
      }
      if (maquinas.length > 0) {
        await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE maquina_id = ANY($1))', [maquinas]);
        await client.query('DELETE FROM notificaciones WHERE maquina_id = ANY($1)', [maquinas]);
        await client.query(
          `DELETE FROM plan_tarea_repuestos WHERE plan_tarea_id IN (
             SELECT t.id FROM plan_tareas t JOIN planes_mantenimiento p ON p.id = t.plan_id WHERE p.maquina_id = ANY($1)
           )`,
          [maquinas]
        );
        await client.query(
          'DELETE FROM plan_tareas WHERE plan_id IN (SELECT id FROM planes_mantenimiento WHERE maquina_id = ANY($1))',
          [maquinas]
        );
        await client.query('DELETE FROM planes_mantenimiento WHERE maquina_id = ANY($1)', [maquinas]);
        await client.query('DELETE FROM medidores WHERE maquina_id = ANY($1)', [maquinas]);
        await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = ANY($1)', [maquinas]);
        await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [maquinas]);
      }
      if (createdUsuarioIds.length > 0) {
        await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE usuario_id = ANY($1))', [createdUsuarioIds]);
        await client.query('DELETE FROM notificaciones WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuario_sector WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query(
          'DELETE FROM auditoria_permisos WHERE sobre_usuario_id = ANY($1) OR realizado_por_usuario_id = ANY($1)',
          [createdUsuarioIds]
        );
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUsuarioIds]);
      }
      if (createdSectorIds.length > 0) {
        await client.query('DELETE FROM sectores WHERE id = ANY($1)', [createdSectorIds]);
      }
      if (createdPlantaIds.length > 0) {
        await client.query('DELETE FROM plantas WHERE id = ANY($1)', [createdPlantaIds]);
      }
    } finally {
      client.release();
    }
  }
});
