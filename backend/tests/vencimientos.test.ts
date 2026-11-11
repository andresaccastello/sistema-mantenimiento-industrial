import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';
import { procesarVencimientos, ResultadoVencimientos } from '../functions/preventivos/vencimientos.ts';

// Timeout de bloqueo para las pruebas de concurrencia
process.env.LOCK_TIMEOUT = '5s';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (VENCIMIENTOS TESTS)');
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

async function pedir(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  extra: Record<string, string> = {}
): Promise<Respuesta> {
  const headers: Record<string, string> = { ...extra };
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

/** Suma días a una fecha YYYY-MM-DD. */
function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** El error de un plan en el resultado, o undefined. */
const errorDe = (r: ResultadoVencimientos, planId: number) => r.errores?.find((e) => e.plan_id === planId);

test('Etapa PV5 — Generación automática y avisos de vencimiento (PA-01 a PA-10)', async (t) => {
  let client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];

  // Lo que ya había: los avisos de esta corrida se borran por id (también los de planes ajenos)
  const inicio = (await client.query(
    `SELECT
       (SELECT COALESCE(max(id), 0) FROM avisos_vencimiento)::bigint AS aviso,
       (SELECT COALESCE(max(id), 0) FROM notificaciones)::bigint AS notificacion,
       (SELECT to_char(vencimientos_revisados_el, 'YYYY-MM-DD') FROM configuracion_sistema WHERE id = 1) AS revisados_el`
  )).rows[0];
  const ultimoAviso = Number(inicio.aviso);
  const ultimaNotificacion = Number(inicio.notificacion);
  const revisadosEl: string | null = inicio.revisados_el;

  const sistemaId = Number((await client.query('SELECT id FROM usuarios WHERE es_sistema')).rows[0].id);

  try {
    const suf = Date.now();
    const passHash = await bcrypt.hash('pass123', 10);

    const perfilMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, nombre FROM perfiles')).rows) {
      perfilMap[r.nombre] = Number(r.id);
    }
    const permMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, codigo FROM permisos')).rows) {
      permMap[r.codigo] = Number(r.id);
    }

    const hoy: string = (await client.query(`SELECT to_char(hoy_instalacion(), 'YYYY-MM-DD') AS hoy`)).rows[0].hoy;

    const critAlta = Number((await client.query(
      'SELECT id FROM criticidades WHERE prioridad_alta AND activo ORDER BY orden, id LIMIT 1'
    )).rows[0].id);
    const critNormal = Number((await client.query(
      'SELECT id FROM criticidades WHERE NOT prioridad_alta AND activo ORDER BY orden, id LIMIT 1'
    )).rows[0].id);

    // Plantas, sectores y máquinas
    const pl = Number((await client.query(
      'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`PA_PL_${suf}`]
    )).rows[0].id);
    createdPlantaIds.push(pl);
    async function crearSector(clave: string) {
      const id = Number((await client.query(
        'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`PA_${clave}_${suf}`, pl]
      )).rows[0].id);
      createdSectorIds.push(id);
      return id;
    }
    const s1 = await crearSector('S1');
    const s2 = await crearSector('S2');

    let numeroMaquina = 0;
    async function crearMaquina(sectorId = s1, criticidadId = critNormal) {
      numeroMaquina++;
      const r = await client.query(
        `INSERT INTO maquinas (codigo, nombre, sector_id, criticidad_id, activo)
         VALUES ($1, $2, $3, $4, TRUE) RETURNING id, codigo, nombre`,
        [`PA_M${numeroMaquina}_${suf}`, `Maquina PA ${numeroMaquina}`, sectorId, criticidadId]
      );
      const id = Number(r.rows[0].id);
      createdMaquinaIds.push(id);
      return { id, codigo: r.rows[0].codigo as string, nombre: r.rows[0].nombre as string };
    }

    // Usuarios
    async function crearUsuario(clave: string, perfil: string, sectores: number[]) {
      const res = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, $2, 'PA', $3, $4, TRUE, 1) RETURNING id, legajo, sesion_version`,
        [`PA_${clave}_${suf}`, clave, passHash, perfilMap[perfil]]
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
    const R = await crearUsuario('Resp', 'RESPONSABLE_MANTENIMIENTO', [s1, s2]);
    const R2 = await crearUsuario('RespDos', 'RESPONSABLE_MANTENIMIENTO', [s1, s2]);
    const O = await crearUsuario('Operario', 'OPERARIO', [s1]);
    // G1 y G2: PLANES_GESTIONAR por excepción, con alcance de sus sectores
    async function conPlanesDeSector(clave: string, sector: number) {
      const u = await crearUsuario(clave, 'CONSULTA', [sector]);
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Planes de su sector', $3)`,
        [u.id, permMap['PLANES_GESTIONAR'], A.id]
      );
      return u;
    }
    const G1 = await conPlanesDeSector('GestorUno', s1);
    const G2 = await conPlanesDeSector('GestorDos', s2);

    // Helpers
    const tareaFecha = (accion: string, primera: string, extra: Record<string, unknown> = {}) => ({
      accion,
      frecuencia_valor: 1,
      frecuencia_unidad: 'MESES',
      primera_fecha: primera,
      ...extra,
    });
    let numeroPlan = 0;
    async function crearPlan(maquinaId: number, tareas: unknown[], extra: Record<string, unknown> = {}) {
      numeroPlan++;
      const r = await pedir('POST', '/api/planes', A.token, {
        maquina_id: maquinaId,
        nombre: `Plan PA ${numeroPlan}`,
        anticipacion_dias: 7,
        tareas,
        ...extra,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      return r.cuerpo;
    }
    /** Apaga el plan al terminar el caso, para que no entre en los que siguen. */
    const apagar = async (...planIds: number[]) =>
      client.query('UPDATE planes_mantenimiento SET activo = FALSE WHERE id = ANY($1)', [planIds]);

    const forzar = async () => {
      const r = await pedir('POST', '/api/planes/procesar-vencimientos', A.token, {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      return r.cuerpo as ResultadoVencimientos;
    };
    /** Los avisos de vencimiento de una máquina, de esta corrida. */
    const avisosDe = async (maquinaId: number) =>
      (await client.query(
        `SELECT id, usuario_id, prioridad, titulo, mensaje, intervencion_id, maquina_id, generada_por_usuario_id
         FROM notificaciones
         WHERE tipo_evento = 'PREVENTIVO_VENCIMIENTO' AND maquina_id = $1 AND id > $2
         ORDER BY id`,
        [maquinaId, ultimaNotificacion]
      )).rows.map((r) => ({ ...r, id: Number(r.id), usuario_id: Number(r.usuario_id) }));
    const intervencionesDe = async (maquinaId: number) =>
      (await client.query('SELECT id, creado_por_usuario_id, responsable_usuario_id, estado FROM intervenciones WHERE maquina_id = $1 ORDER BY id', [maquinaId])).rows;

    /** Una intervención preventiva finalizada con la tarea hecha, cargada directo en la base. */
    async function ejecucion(maquinaId: number, planId: number, tareaId: number, fin: string) {
      const tipo = Number((await client.query(`SELECT id FROM tipos_intervencion WHERE codigo = 'PREVENTIVO'`)).rows[0].id);
      const intId = Number((await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, plan_mantenimiento_id,
           fecha_creacion, fecha_inicio, fecha_finalizacion, trabajo_realizado, ejecucion
         ) VALUES ($1, $2, $3, 'Preventivo PA', 'FINALIZADA', $4,
                   $5::timestamptz - interval '2 hours', $5::timestamptz - interval '1 hour', $5::timestamptz,
                   'Trabajo PA', 'INTERNA')
         RETURNING id`,
        [maquinaId, tipo, A.id, planId, fin]
      )).rows[0].id);
      await client.query(
        `INSERT INTO intervencion_tareas (intervencion_id, plan_tarea_id, orden, accion, fecha_programada, hecha, hecha_por_usuario_id, hecha_en)
         SELECT $1, t.id, t.orden, t.accion, t.primera_fecha, TRUE, $2, NOW() FROM plan_tareas t WHERE t.id = $3`,
        [intId, A.id, tareaId]
      );
      return intId;
    }

    // =========================================================================
    // PA-01: Permisos
    // =========================================================================
    await t.test('PA-01: Permisos', async () => {
      const r = await pedir('POST', '/api/planes/procesar-vencimientos', O.token, {});
      assert.deepStrictEqual([r.status, r.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
      const sinToken = await pedir('POST', '/api/planes/procesar-vencimientos', null, {});
      assert.strictEqual(sinToken.status, 401);

      const neon = await pedir('POST', '/api/avisos/procesar', null, {});
      assert.deepStrictEqual([neon.status, neon.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
    });

    // =========================================================================
    // PA-02: Una vez por día
    // =========================================================================
    await t.test('PA-02: Una vez por día', async () => {
      try {
        await client.query(`UPDATE configuracion_sistema SET vencimientos_revisados_el = hoy_instalacion() - 1 WHERE id = 1`);
        const primera = await procesarVencimientos();
        assert.strictEqual(primera.revisado, true, JSON.stringify(primera));
        const revisado = (await client.query(
          `SELECT vencimientos_revisados_el = hoy_instalacion() AS hoy FROM configuracion_sistema WHERE id = 1`
        )).rows[0].hoy;
        assert.strictEqual(revisado, true, 'Queda revisado hoy');

        const segunda = await procesarVencimientos();
        assert.deepStrictEqual(segunda, { revisado: false });

        // Con la revisión en ayer, vuelve a revisar
        await client.query(`UPDATE configuracion_sistema SET vencimientos_revisados_el = hoy_instalacion() - 1 WHERE id = 1`);
        const tercera = await procesarVencimientos();
        assert.strictEqual(tercera.revisado, true);
        assert.ok(Array.isArray(tercera.generadas) && Array.isArray(tercera.errores));
        assert.strictEqual(typeof tercera.planes, 'number');
        assert.strictEqual(typeof tercera.avisos, 'number');

        // Forzar revisa aunque ya se haya revisado hoy
        const forzada = await procesarVencimientos({ forzar: true });
        assert.strictEqual(forzada.revisado, true);

        // C3, 2: un error que corta la revisión antes de terminar no marca el día. Se fuerza
        // sacándole la marca al usuario del sistema, que la revisión busca para ser el autor.
        await client.query(`UPDATE configuracion_sistema SET vencimientos_revisados_el = hoy_instalacion() - 1 WHERE id = 1`);
        await client.query('UPDATE usuarios SET es_sistema = FALSE WHERE id = $1', [sistemaId]);
        let cortada = false;
        try {
          await procesarVencimientos();
        } catch {
          cortada = true;
        } finally {
          client = await clienteSano(client);
          await client.query('UPDATE usuarios SET es_sistema = TRUE WHERE id = $1', [sistemaId]);
        }
        assert.strictEqual(cortada, true, 'La revisión se cortó');
        const marcadaTrasCorte = (await client.query(
          `SELECT vencimientos_revisados_el = hoy_instalacion() AS hoy FROM configuracion_sistema WHERE id = 1`
        )).rows[0].hoy;
        assert.strictEqual(marcadaTrasCorte, false, 'Cortada, la fecha no queda marcada');

        const proxima = await procesarVencimientos();
        assert.strictEqual(proxima.revisado, true, 'El próximo programado vuelve a revisar');
        const marcadaAlFinal = (await client.query(
          `SELECT vencimientos_revisados_el = hoy_instalacion() AS hoy FROM configuracion_sistema WHERE id = 1`
        )).rows[0].hoy;
        assert.strictEqual(marcadaAlFinal, true, 'Al terminar, queda revisado hoy');
      } finally {
        client = await clienteSano(client);
        await client.query('UPDATE usuarios SET es_sistema = TRUE WHERE id = $1', [sistemaId]);
        await client.query('UPDATE configuracion_sistema SET vencimientos_revisados_el = $1::date WHERE id = 1', [revisadosEl]);
      }
    });

    // =========================================================================
    // PA-03: Avisos
    // =========================================================================
    await t.test('PA-03: Avisos', async () => {
      const m = await crearMaquina();
      const rMed = await pedir('POST', '/api/medidores', A.token, { maquina_id: m.id, nombre: 'Horómetro PA', unidad: 'horas' });
      assert.strictEqual(rMed.status, 201, JSON.stringify(rMed.cuerpo));
      const medidorId = Number(rMed.cuerpo.id);
      const lectura = async (valor: number) => {
        const r = await pedir('POST', `/api/medidores/${medidorId}/lecturas`, A.token, { valor });
        assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      };
      await lectura(495);

      // Cambiar aceite: vencida, cada 1 día; Engrasar: por uso, próxima (faltan 5 de 10)
      const plan = await crearPlan(
        m.id,
        [
          tareaFecha('Cambiar aceite', sumarDias(hoy, -10), { frecuencia_valor: 1, frecuencia_unidad: 'DIAS' }),
          { accion: 'Engrasar', uso: { medidor_id: medidorId, cada: 100, primera: 500, anticipacion: 10 } },
        ],
        { responsable_usuario_id: R.id }
      );
      const [tAceite, tEngrase] = plan.tareas.map((x: any) => Number(x.id));

      const r1 = await forzar();
      assert.strictEqual(errorDe(r1, plan.id), undefined, JSON.stringify(r1.errores));
      let avisos = await avisosDe(m.id);
      assert.strictEqual(avisos.length, 1, 'Una notificación, al responsable');
      assert.strictEqual(avisos[0].usuario_id, R.id);
      assert.strictEqual(avisos[0].titulo, `Preventivo: ${plan.nombre}`);
      assert.strictEqual(
        avisos[0].mensaje,
        `${m.codigo} · ${m.nombre}: 1 tarea vencida (Cambiar aceite) y 1 próxima (Engrasar).`
      );
      assert.strictEqual(Number(avisos[0].generada_por_usuario_id), sistemaId, 'El autor es el usuario del sistema');
      assert.strictEqual(Number(avisos[0].maquina_id), m.id);
      assert.strictEqual(avisos[0].intervencion_id, null);
      const ciclos = (await client.query(
        'SELECT plan_tarea_id, estado, ciclo FROM avisos_vencimiento WHERE plan_tarea_id = ANY($1) ORDER BY plan_tarea_id',
        [[tAceite, tEngrase]]
      )).rows.map((x) => [Number(x.plan_tarea_id), x.estado, x.ciclo]);
      assert.deepStrictEqual(ciclos, [
        [tAceite, 'VENCIDA', `F:${sumarDias(hoy, -10)}`],
        [tEngrase, 'PROXIMA', 'U:500.00'],
      ]);

      // Forzar de nuevo: ninguna nueva
      await forzar();
      assert.strictEqual((await avisosDe(m.id)).length, 1, 'No se repite el aviso');

      // La próxima pasa a vencida, con el mismo ciclo: un aviso nuevo, solo con esa
      await lectura(510);
      await forzar();
      avisos = await avisosDe(m.id);
      assert.strictEqual(avisos.length, 2);
      assert.strictEqual(avisos[1].mensaje, `${m.codigo} · ${m.nombre}: 1 tarea vencida (Engrasar).`);
      await forzar();
      assert.strictEqual((await avisosDe(m.id)).length, 2, 'Tampoco se repite el de vencida');

      // Se hace el cambio de aceite hace 5 días: con el ciclo nuevo, vence de nuevo y se avisa
      await ejecucion(m.id, plan.id, tAceite, `${sumarDias(hoy, -5)} 12:00:00-03`);
      await forzar();
      avisos = await avisosDe(m.id);
      assert.strictEqual(avisos.length, 3);
      assert.strictEqual(avisos[2].mensaje, `${m.codigo} · ${m.nombre}: 1 tarea vencida (Cambiar aceite).`);
      const nuevo = (await client.query(
        `SELECT ciclo FROM avisos_vencimiento WHERE plan_tarea_id = $1 AND estado = 'VENCIDA' ORDER BY id`,
        [tAceite]
      )).rows.map((x) => x.ciclo);
      assert.deepStrictEqual(nuevo, [`F:${sumarDias(hoy, -10)}`, `F:${sumarDias(hoy, -4)}`]);

      await apagar(plan.id);
    });

    // =========================================================================
    // PA-04: Destinatarios
    // =========================================================================
    await t.test('PA-04: Destinatarios', async () => {
      // Sin responsable
      const m = await crearMaquina(s1);
      const plan = await crearPlan(m.id, [tareaFecha('Revisar filtro', sumarDias(hoy, -2))]);
      await forzar();
      const para = (await avisosDe(m.id)).map((a) => a.usuario_id);
      assert.ok(para.includes(G1.id), 'Le llega a quien tiene PLANES_GESTIONAR en el sector');
      assert.ok(para.includes(A.id), 'Le llega a quien tiene PLANES_GESTIONAR en todos');
      assert.ok(!para.includes(G2.id), 'No le llega a quien tiene PLANES_GESTIONAR en otro sector');
      assert.ok(!para.includes(O.id), 'No le llega a quien no tiene PLANES_GESTIONAR');
      assert.ok(!para.includes(sistemaId), 'Nunca al usuario del sistema');
      assert.strictEqual(new Set(para).size, para.length, 'Una por destinatario');

      // Responsable inactivo: igual que sin responsable
      const m2 = await crearMaquina(s1);
      const plan2 = await crearPlan(m2.id, [tareaFecha('Revisar filtro', sumarDias(hoy, -2))], { responsable_usuario_id: R2.id });
      await client.query('UPDATE usuarios SET activo = FALSE WHERE id = $1', [R2.id]);
      await forzar();
      const para2 = (await avisosDe(m2.id)).map((a) => a.usuario_id);
      assert.ok(!para2.includes(R2.id), 'El responsable inactivo no recibe');
      assert.ok(para2.includes(G1.id) && para2.includes(A.id) && !para2.includes(G2.id), JSON.stringify(para2));
      assert.ok(!para2.includes(sistemaId));

      // El usuario del sistema no recibe ninguno de esta corrida
      const alSistema = Number((await client.query(
        `SELECT count(*)::int AS n FROM notificaciones WHERE usuario_id = $1 AND id > $2`, [sistemaId, ultimaNotificacion]
      )).rows[0].n);
      assert.strictEqual(alSistema, 0);

      await apagar(plan.id, plan2.id);
    });

    // =========================================================================
    // PA-05: Prioridad
    // =========================================================================
    await t.test('PA-05: Prioridad', async () => {
      const mVencida = await crearMaquina(s1, critAlta);
      const pVencida = await crearPlan(
        mVencida.id,
        [tareaFecha('Cambiar correa', sumarDias(hoy, -1)), tareaFecha('Engrasar', sumarDias(hoy, 3))],
        { responsable_usuario_id: R.id }
      );
      const mProxima = await crearMaquina(s1, critAlta);
      const pProxima = await crearPlan(mProxima.id, [tareaFecha('Engrasar', sumarDias(hoy, 3))], { responsable_usuario_id: R.id });
      await forzar();
      assert.deepStrictEqual((await avisosDe(mVencida.id)).map((a) => a.prioridad), ['ALTA']);
      assert.deepStrictEqual((await avisosDe(mProxima.id)).map((a) => a.prioridad), ['NORMAL']);
      await apagar(pVencida.id, pProxima.id);
    });

    // =========================================================================
    // PA-06: Generación automática
    // =========================================================================
    await t.test('PA-06: Generación automática', async () => {
      const m = await crearMaquina(s1);
      const plan = await crearPlan(
        m.id,
        [
          tareaFecha('Cambiar aceite', sumarDias(hoy, -2)),
          tareaFecha('Engrasar', sumarDias(hoy, 3)),
          tareaFecha('Pintar', sumarDias(hoy, 60)),
        ],
        { responsable_usuario_id: R.id, generacion_automatica: true }
      );
      assert.strictEqual(plan.generacion_automatica, true);
      const [tAceite, tEngrase] = plan.tareas.map((x: any) => Number(x.id));

      const r = await forzar();
      const generada = r.generadas?.find((g) => g.plan_id === plan.id);
      assert.ok(generada, JSON.stringify(r));
      const ints = await intervencionesDe(m.id);
      assert.strictEqual(ints.length, 1);
      assert.strictEqual(Number(ints[0].id), generada.intervencion_id);
      assert.strictEqual(Number(ints[0].creado_por_usuario_id), sistemaId);
      assert.strictEqual(Number(ints[0].responsable_usuario_id), R.id, 'La responsable del plan');
      const tareas = (await client.query(
        'SELECT plan_tarea_id FROM intervencion_tareas WHERE intervencion_id = $1 ORDER BY orden', [generada.intervencion_id]
      )).rows.map((x) => Number(x.plan_tarea_id));
      assert.deepStrictEqual(tareas, [tAceite, tEngrase], 'Las tareas que tocaban');

      // El autor, en la API, como cualquier otro: "Sistema"
      const det = await pedir('GET', `/api/intervenciones/${generada.intervencion_id}`, A.token);
      assert.strictEqual(det.status, 200, JSON.stringify(det.cuerpo));
      assert.strictEqual(det.cuerpo.creado_por.nombre, 'Sistema');

      const avisos = await avisosDe(m.id);
      assert.strictEqual(avisos.length, 1);
      assert.strictEqual(
        avisos[0].mensaje,
        `${m.codigo} · ${m.nombre}: 1 tarea vencida (Cambiar aceite) y 1 próxima (Engrasar). Se generó la intervención N.º ${generada.intervencion_id}.`
      );

      // Forzar de nuevo: no genera otra ni avisa de nuevo
      const r2 = await forzar();
      assert.ok(!r2.generadas?.some((g) => g.plan_id === plan.id));
      assert.strictEqual((await intervencionesDe(m.id)).length, 1);
      assert.strictEqual((await avisosDe(m.id)).length, 1);

      // Apagada: no genera y solo avisa
      const m2 = await crearMaquina(s1);
      const plan2 = await crearPlan(m2.id, [tareaFecha('Cambiar aceite', sumarDias(hoy, -2))], { responsable_usuario_id: R.id });
      assert.strictEqual(plan2.generacion_automatica, false);
      const r3 = await forzar();
      assert.ok(!r3.generadas?.some((g) => g.plan_id === plan2.id));
      assert.strictEqual((await intervencionesDe(m2.id)).length, 0);
      assert.strictEqual((await avisosDe(m2.id)).length, 1);

      // El alta y el PATCH aceptan generacion_automatica booleano; otro tipo, 422
      const rMal = await pedir('PATCH', `/api/planes/${plan2.id}`, A.token, { generacion_automatica: 'true' });
      assert.deepStrictEqual([rMal.status, rMal.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const rMal2 = await pedir('POST', '/api/planes', A.token, {
        maquina_id: m2.id, nombre: 'Plan PA mal', tareas: [tareaFecha('X', hoy)], generacion_automatica: 1,
      });
      assert.deepStrictEqual([rMal2.status, rMal2.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const rBien = await pedir('PATCH', `/api/planes/${plan2.id}`, A.token, { generacion_automatica: true });
      assert.strictEqual(rBien.status, 200);
      assert.strictEqual(rBien.cuerpo.generacion_automatica, true);
      const lista = await pedir('GET', `/api/planes?maquina_id=${m2.id}`, A.token);
      assert.strictEqual(lista.cuerpo[0].generacion_automatica, true);

      await apagar(plan.id, plan2.id);
    });

    // =========================================================================
    // PA-07: Un plan que falla
    // =========================================================================
    await t.test('PA-07: Un plan que falla no frena a los demás', async () => {
      const mFalla = await crearMaquina(s1);
      const pFalla = await crearPlan(
        mFalla.id,
        [tareaFecha('Cambiar aceite', sumarDias(hoy, -2))],
        { responsable_usuario_id: R.id, generacion_automatica: true }
      );
      const tFalla = Number(pFalla.tareas[0].id);
      const mBien = await crearMaquina(s1);
      const pBien = await crearPlan(mBien.id, [tareaFecha('Cambiar aceite', sumarDias(hoy, -2))], { responsable_usuario_id: R.id });

      // El aviso del primer plan falla, después de generar su intervención
      await client.query(`
        CREATE OR REPLACE FUNCTION trg_fn_test_pa07() RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.plan_tarea_id = ${tFalla} THEN
            RAISE EXCEPTION 'Falla forzada PA-07';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await client.query(`
        CREATE TRIGGER trg_test_pa07 BEFORE INSERT ON avisos_vencimiento
        FOR EACH ROW EXECUTE FUNCTION trg_fn_test_pa07();
      `);
      try {
        const r = await forzar();
        assert.deepStrictEqual(errorDe(r, pFalla.id), { plan_id: pFalla.id, codigo: 'ERROR_INTERNO' });
        assert.strictEqual(errorDe(r, pBien.id), undefined);
        assert.strictEqual((await avisosDe(mBien.id)).length, 1, 'El otro plan se procesa');

        // Del plan que falló no queda nada a medias
        assert.strictEqual((await intervencionesDe(mFalla.id)).length, 0, 'Sin la intervención generada');
        assert.strictEqual((await avisosDe(mFalla.id)).length, 0);
        const filas = Number((await client.query(
          'SELECT count(*)::int AS n FROM avisos_vencimiento WHERE plan_tarea_id = $1', [tFalla]
        )).rows[0].n);
        assert.strictEqual(filas, 0);
      } finally {
        client = await clienteSano(client);
        await client.query('DROP TRIGGER IF EXISTS trg_test_pa07 ON avisos_vencimiento');
        await client.query('DROP FUNCTION IF EXISTS trg_fn_test_pa07()');
      }

      // Sin la falla, al forzar se procesa
      const r2 = await forzar();
      assert.strictEqual(errorDe(r2, pFalla.id), undefined);
      assert.strictEqual((await intervencionesDe(mFalla.id)).length, 1);
      await apagar(pFalla.id, pBien.id);
    });

    // =========================================================================
    // PA-08: El usuario del sistema
    // =========================================================================
    await t.test('PA-08: El usuario del sistema', async () => {
      const campos = 'password_hash, activo, actualizado_en, sesion_version, password_actualizado_en, debe_cambiar_password, ultimo_acceso_en';
      const original = (await client.query(`SELECT ${campos} FROM usuarios WHERE id = $1`, [sistemaId])).rows[0];
      const consulta = async () => {
        const r = await pedir('GET', '/api/perfiles', A.token);
        return r.cuerpo.find((p: any) => p.nombre === 'CONSULTA').usuarios_activos;
      };
      const miembrosAntes = await consulta();
      try {
        // Con una contraseña conocida
        const hash = await bcrypt.hash('ClaveConocida1', 10);
        await client.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, sistemaId]);
        const r1 = await pedir('POST', '/api/auth/login', null, { legajo: 'SISTEMA', password: 'ClaveConocida1' });
        assert.deepStrictEqual([r1.status, r1.cuerpo.codigo], [401, 'CREDENCIALES_INVALIDAS']);

        // Y además activo: lo rechaza por es_sistema
        await client.query('UPDATE usuarios SET activo = TRUE WHERE id = $1', [sistemaId]);
        const r2 = await pedir('POST', '/api/auth/login', null, { legajo: 'SISTEMA', password: 'ClaveConocida1' });
        assert.deepStrictEqual([r2.status, r2.cuerpo.codigo], [401, 'CREDENCIALES_INVALIDAS']);

        // No aparece en la lista, el detalle, los miembros del perfil ni los responsables posibles
        for (const ruta of ['/api/usuarios', '/api/usuarios?texto=Sistema', '/api/usuarios?activo=true', '/api/usuarios?activo=false']) {
          const l = await pedir('GET', ruta, A.token);
          assert.strictEqual(l.status, 200);
          assert.ok(!l.cuerpo.some((u: any) => u.id === sistemaId), `No aparece en ${ruta}`);
        }
        const det = await pedir('GET', `/api/usuarios/${sistemaId}`, A.token);
        assert.deepStrictEqual([det.status, det.cuerpo.codigo], [404, 'USUARIO_NO_ENCONTRADO']);
        const cambio = await pedir('PATCH', `/api/usuarios/${sistemaId}`, A.token, { nombre: 'Otro' });
        assert.strictEqual(cambio.status, 404);
        assert.strictEqual(await consulta(), miembrosAntes, 'No cuenta entre los miembros de CONSULTA');

        const m = await crearMaquina(s1);
        const resp = await pedir('GET', `/api/planes/responsables-habilitados?maquina_id=${m.id}`, A.token);
        assert.strictEqual(resp.status, 200);
        assert.ok(!resp.cuerpo.some((u: any) => u.id === sistemaId), 'No es un responsable posible');
      } finally {
        client = await clienteSano(client);
        await client.query(
          `UPDATE usuarios SET password_hash = $1, activo = $2, actualizado_en = $3, sesion_version = $4,
             password_actualizado_en = $5, debe_cambiar_password = $6, ultimo_acceso_en = $7
           WHERE id = $8`,
          [
            original.password_hash, original.activo, original.actualizado_en, original.sesion_version,
            original.password_actualizado_en, original.debe_cambiar_password, original.ultimo_acceso_en, sistemaId,
          ]
        );
      }
    });

    // =========================================================================
    // PA-09: Concurrencia
    // =========================================================================
    await t.test('PA-09: Concurrencia, diez vueltas', async () => {
      for (let vuelta = 1; vuelta <= 10; vuelta++) {
        // Forzar dos veces a la vez
        const m = await crearMaquina(s1);
        const plan = await crearPlan(
          m.id,
          [tareaFecha('Cambiar aceite', sumarDias(hoy, -2)), tareaFecha('Engrasar', sumarDias(hoy, 3))],
          { responsable_usuario_id: R.id, generacion_automatica: true }
        );
        const [a, b] = await Promise.all([procesarVencimientos({ forzar: true }), procesarVencimientos({ forzar: true })]);
        const ocupados = [a, b].filter((x) => errorDe(x, plan.id)?.codigo === 'RECURSO_OCUPADO').length;
        for (const x of [a, b]) {
          const e = errorDe(x, plan.id);
          assert.ok(e === undefined || e.codigo === 'RECURSO_OCUPADO', `Vuelta ${vuelta}: ${JSON.stringify(e)}`);
        }
        const ints = await intervencionesDe(m.id);
        assert.ok(ints.length <= 1, `Vuelta ${vuelta}: una sola intervención`);
        if (ocupados < 2) assert.strictEqual(ints.length, 1, `Vuelta ${vuelta}: una intervención`);
        const avisos = await avisosDe(m.id);
        assert.ok(avisos.length <= 1, `Vuelta ${vuelta}: avisos sin repetir`);
        const filas = (await client.query(
          `SELECT plan_tarea_id, estado, ciclo, count(*)::int AS n FROM avisos_vencimiento
           WHERE plan_tarea_id = ANY($1) GROUP BY 1, 2, 3`,
          [plan.tareas.map((x: any) => Number(x.id))]
        )).rows;
        assert.ok(filas.every((f) => f.n === 1), `Vuelta ${vuelta}: un aviso por vencimiento`);

        // Generar a mano a la vez que lo automático
        const m2 = await crearMaquina(s1);
        const plan2 = await crearPlan(
          m2.id,
          [tareaFecha('Cambiar aceite', sumarDias(hoy, -2))],
          { responsable_usuario_id: R.id, generacion_automatica: true }
        );
        const [manual, auto] = await Promise.all([
          pedir('POST', `/api/planes/${plan2.id}/generar`, A.token, {}),
          procesarVencimientos({ forzar: true }),
        ]);
        const manualOcupado = manual.status === 409 && manual.cuerpo.codigo === 'RECURSO_OCUPADO';
        const autoOcupado = errorDe(auto, plan2.id)?.codigo === 'RECURSO_OCUPADO';
        assert.ok(
          manual.status === 201 || manualOcupado || (manual.status === 409 && manual.cuerpo.codigo === 'SIN_TAREAS_PARA_GENERAR'),
          `Vuelta ${vuelta}: ${manual.status} ${JSON.stringify(manual.cuerpo)}`
        );
        const e2 = errorDe(auto, plan2.id);
        assert.ok(e2 === undefined || autoOcupado, `Vuelta ${vuelta}: ${JSON.stringify(e2)}`);
        const ints2 = await intervencionesDe(m2.id);
        assert.ok(ints2.length <= 1, `Vuelta ${vuelta}: una sola intervención (${ints2.length})`);
        if (!manualOcupado && !autoOcupado) assert.strictEqual(ints2.length, 1, `Vuelta ${vuelta}: una intervención`);

        await apagar(plan.id, plan2.id);
      }
    });

    // =========================================================================
    // PA-10: El programado
    // =========================================================================
    await t.test('PA-10: El programado', async () => {
      const neon = { 'x-neon-trigger-invocation-id': `pa10-${suf}` };
      try {
        const r = await pedir('POST', '/api/avisos/procesar', null, {}, neon);
        assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
        assert.deepStrictEqual(Object.keys(r.cuerpo).sort(), ['envios', 'vencimientos']);
        assert.strictEqual(typeof r.cuerpo.vencimientos.revisado, 'boolean');
        assert.strictEqual(typeof r.cuerpo.envios.procesados, 'number');

        // Si procesarVencimientos falla, los envíos se procesan igual
        await client.query(`UPDATE configuracion_sistema SET vencimientos_revisados_el = hoy_instalacion() - 1 WHERE id = 1`);
        await client.query(`
          CREATE OR REPLACE FUNCTION trg_fn_test_pa10() RETURNS TRIGGER AS $$
          BEGIN
            IF NEW.vencimientos_revisados_el IS DISTINCT FROM OLD.vencimientos_revisados_el THEN
              RAISE EXCEPTION 'Falla forzada PA-10';
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;
        `);
        await client.query(`
          CREATE TRIGGER trg_test_pa10 BEFORE UPDATE ON configuracion_sistema
          FOR EACH ROW EXECUTE FUNCTION trg_fn_test_pa10();
        `);
        try {
          const r2 = await pedir('POST', '/api/avisos/procesar', null, {}, neon);
          assert.strictEqual(r2.status, 200, JSON.stringify(r2.cuerpo));
          assert.ok(r2.cuerpo.vencimientos.error, 'El error de los vencimientos queda anotado');
          assert.strictEqual(typeof r2.cuerpo.envios.procesados, 'number', 'Los envíos se procesan igual');
        } finally {
          client = await clienteSano(client);
          await client.query('DROP TRIGGER IF EXISTS trg_test_pa10 ON configuracion_sistema');
          await client.query('DROP FUNCTION IF EXISTS trg_fn_test_pa10()');
        }
      } finally {
        client = await clienteSano(client);
        await client.query('UPDATE configuracion_sistema SET vencimientos_revisados_el = $1::date WHERE id = 1', [revisadosEl]);
      }
    });
  } finally {
    client = await clienteSano(client);
    // Limpieza: lo que creó esta prueba, y los avisos de vencimiento de esta corrida
    try {
      await client.query('UPDATE configuracion_sistema SET vencimientos_revisados_el = $1::date WHERE id = 1', [revisadosEl]);
      await client.query('DROP TRIGGER IF EXISTS trg_test_pa07 ON avisos_vencimiento');
      await client.query('DROP FUNCTION IF EXISTS trg_fn_test_pa07()');
      await client.query('DROP TRIGGER IF EXISTS trg_test_pa10 ON configuracion_sistema');
      await client.query('DROP FUNCTION IF EXISTS trg_fn_test_pa10()');

      await client.query('DELETE FROM avisos_vencimiento WHERE id > $1', [ultimoAviso]);
      await client.query(
        `DELETE FROM notificacion_envios WHERE notificacion_id IN (
           SELECT id FROM notificaciones WHERE tipo_evento = 'PREVENTIVO_VENCIMIENTO' AND id > $1
         )`,
        [ultimaNotificacion]
      );
      await client.query(`DELETE FROM notificaciones WHERE tipo_evento = 'PREVENTIVO_VENCIMIENTO' AND id > $1`, [ultimaNotificacion]);

      const maquinas = createdMaquinaIds;
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
        await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [intIds]);
      }
      if (maquinas.length > 0) {
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
