import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (CALENDARIO TESTS)');
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

/** Suma días a una fecha YYYY-MM-DD. */
function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

interface Evento {
  fecha: string;
  tipo: 'HECHA' | 'PENDIENTE' | 'PREVISTA';
  estado: string | null;
  vencida_por_uso: boolean;
  tambien_por_uso: boolean;
  tarea_id: number;
  accion: string;
  plan: { id: number; nombre: string };
  maquina: { id: number; codigo: string; nombre: string; criticidad: { nombre: string; prioridad_alta: boolean } };
  sector: { id: number; nombre: string };
  responsable: unknown;
  intervencion: { id: number; estado: string } | null;
}

test('Etapa CAL1 — Calendario de preventivos (CA-01 a CA-13)', async (t) => {
  let client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];

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
    async function crearPlanta(clave: string) {
      const id = Number((await client.query(
        'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`CA_${clave}_${suf}`]
      )).rows[0].id);
      createdPlantaIds.push(id);
      return id;
    }
    const pl1 = await crearPlanta('PL1');
    const pl2 = await crearPlanta('PL2');
    async function crearSector(clave: string, planta = pl1) {
      const id = Number((await client.query(
        'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`CA_${clave}_${suf}`, planta]
      )).rows[0].id);
      createdSectorIds.push(id);
      return id;
    }
    const s1 = await crearSector('S1');
    const s2 = await crearSector('S2', pl2);
    const s3 = await crearSector('S3');

    let numeroMaquina = 0;
    async function crearMaquina(sectorId = s1, criticidadId = critNormal) {
      numeroMaquina++;
      const r = await client.query(
        `INSERT INTO maquinas (codigo, nombre, sector_id, criticidad_id, activo)
         VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
        [`CA_M${String(numeroMaquina).padStart(2, '0')}_${suf}`, `Maquina CA ${numeroMaquina}`, sectorId, criticidadId]
      );
      const id = Number(r.rows[0].id);
      createdMaquinaIds.push(id);
      return id;
    }

    // Usuarios
    async function crearUsuario(clave: string, perfil: string, sectores: number[]) {
      const res = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, $2, 'CA', $3, $4, TRUE, 1) RETURNING id, legajo, sesion_version`,
        [`CA_${clave}_${suf}`, clave, passHash, perfilMap[perfil]]
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
    const O = await crearUsuario('Operario', 'OPERARIO', [s1]);
    // G1: PLANES_GESTIONAR por excepción, con alcance de su sector
    const G1 = await crearUsuario('GestorUno', 'CONSULTA', [s1]);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Planes de su sector', $3)`,
      [G1.id, permMap['PLANES_GESTIONAR'], A.id]
    );

    // Helpers
    const tarea = (accion: string, primera: string, valor = 1, unidad = 'MESES', extra: Record<string, unknown> = {}) => ({
      accion,
      frecuencia_valor: valor,
      frecuencia_unidad: unidad,
      primera_fecha: primera,
      ...extra,
    });
    let numeroPlan = 0;
    /** Crea el plan y devuelve sus ids y los de sus tareas, en orden. */
    async function crearPlan(maquinaId: number, tareas: unknown[]) {
      numeroPlan++;
      const r = await pedir('POST', '/api/planes', A.token, {
        maquina_id: maquinaId,
        nombre: `Plan CA ${numeroPlan}`,
        anticipacion_dias: 7,
        tareas,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      return { id: Number(r.cuerpo.id), tareas: (r.cuerpo.tareas as Array<{ id: number }>).map((x) => Number(x.id)) };
    }
    async function crearMedidor(maquinaId: number) {
      const r = await pedir('POST', '/api/medidores', A.token, { maquina_id: maquinaId, nombre: 'Horómetro CA', unidad: 'horas' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      return Number(r.cuerpo.id);
    }
    async function lectura(medidorId: number, valor: number) {
      const r = await pedir('POST', `/api/medidores/${medidorId}/lecturas`, A.token, { valor });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
    }
    async function calendario(token: string, desde: string, hasta: string, extra = '') {
      return pedir('GET', `/api/planes/calendario?desde=${desde}&hasta=${hasta}${extra}`, token);
    }
    async function calendarioOk(desde: string, hasta: string, extra = '', token = A.token) {
      const r = await calendario(token, desde, hasta, extra);
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      return r.cuerpo as { hoy: string; desde: string; hasta: string; vencidas: number; eventos: Evento[]; por_uso: any[] };
    }
    const deTarea = (eventos: Evento[], tareaId: number) => eventos.filter((e) => e.tarea_id === tareaId);
    const estadoVista = async (tareaId: number) =>
      (await client.query('SELECT estado FROM v_plan_tareas_estado WHERE id = $1', [tareaId])).rows[0].estado as string;

    const tipoPreventivo = Number((await client.query(`SELECT id FROM tipos_intervencion WHERE codigo = 'PREVENTIVO'`)).rows[0].id);
    /** Una intervención preventiva finalizada, cargada directo en la base, con la tarea hecha o no. */
    async function ejecucion(maquinaId: number, planId: number, tareaId: number, fin: string, hecha = true) {
      const intId = Number((await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, plan_mantenimiento_id,
           fecha_creacion, fecha_inicio, fecha_finalizacion, trabajo_realizado, ejecucion
         ) VALUES ($1, $2, $3, 'Preventivo CA', 'FINALIZADA', $4,
                   $5::timestamptz - interval '2 hours', $5::timestamptz - interval '1 hour', $5::timestamptz,
                   'Trabajo CA', 'INTERNA')
         RETURNING id`,
        [maquinaId, tipoPreventivo, A.id, planId, fin]
      )).rows[0].id);
      await client.query(
        `INSERT INTO intervencion_tareas (intervencion_id, plan_tarea_id, orden, accion, fecha_programada, hecha, hecha_por_usuario_id, hecha_en)
         SELECT $1, t.id, t.orden, t.accion, t.primera_fecha, $4, CASE WHEN $4 THEN $2::bigint END, CASE WHEN $4 THEN NOW() END
         FROM plan_tareas t WHERE t.id = $3`,
        [intId, A.id, tareaId, hecha]
      );
      return intId;
    }
    /** La fecha local de las 15:00 UTC de un día: el mismo día en cualquier zona de −12 a +8. */
    const finDe = (fecha: string) => `${fecha}T15:00:00Z`;

    // =========================================================================
    // CA-01: Parámetros
    // =========================================================================
    await t.test('CA-01: Parámetros', async () => {
      const casos: Array<[string, string]> = [
        ['falta desde', `/api/planes/calendario?hasta=${hoy}`],
        ['falta hasta', `/api/planes/calendario?desde=${hoy}`],
        ['fecha mal escrita', `/api/planes/calendario?desde=2026-1-5&hasta=${hoy}`],
        ['fecha imposible', '/api/planes/calendario?desde=2026-02-30&hasta=2026-03-10'],
        ['desde > hasta', `/api/planes/calendario?desde=${sumarDias(hoy, 1)}&hasta=${hoy}`],
        ['63 días', `/api/planes/calendario?desde=${hoy}&hasta=${sumarDias(hoy, 62)}`],
        ['maquina_id inválido', `/api/planes/calendario?desde=${hoy}&hasta=${hoy}&maquina_id=abc`],
      ];
      for (const [caso, url] of casos) {
        const r = await pedir('GET', url, A.token);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `${caso}: ${JSON.stringify(r.cuerpo)}`);
        assert.ok(typeof r.cuerpo.error === 'string' && r.cuerpo.error.length > 0, caso);
      }
      const ok = await calendario(A.token, hoy, sumarDias(hoy, 61));
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.cuerpo));
      assert.strictEqual(ok.cuerpo.hoy, hoy);
      assert.strictEqual(ok.cuerpo.desde, hoy);
      assert.strictEqual(ok.cuerpo.hasta, sumarDias(hoy, 61));
      assert.ok(Array.isArray(ok.cuerpo.eventos) && Array.isArray(ok.cuerpo.por_uso));
      assert.strictEqual(typeof ok.cuerpo.vencidas, 'number');
    });

    // =========================================================================
    // CA-02: Permisos y alcance
    // =========================================================================
    await t.test('CA-02: Permisos y alcance', async () => {
      const r = await calendario(O.token, hoy, hoy);
      assert.deepStrictEqual([r.status, r.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
      const sinToken = await calendario('', hoy, hoy);
      assert.strictEqual(sinToken.status, 401);

      const m1 = await crearMaquina(s1);
      const m2 = await crearMaquina(s2);
      const med1 = await crearMedidor(m1);
      const med2 = await crearMedidor(m2);
      const p1 = await crearPlan(m1, [
        tarea('Vencida S1', sumarDias(hoy, -3)),
        { accion: 'Uso S1', uso: { medidor_id: med1, cada: 100, primera: 100 } },
      ]);
      const p2 = await crearPlan(m2, [
        tarea('Vencida S2', sumarDias(hoy, -3)),
        { accion: 'Uso S2', uso: { medidor_id: med2, cada: 100, primera: 100 } },
      ]);

      const g = await calendarioOk(sumarDias(hoy, -5), sumarDias(hoy, 30), '', G1.token);
      assert.ok(g.eventos.length > 0);
      assert.ok(g.eventos.every((e) => e.sector.id === s1), 'Solo eventos de su sector');
      assert.ok(deTarea(g.eventos, p1.tareas[0]).length > 0);
      assert.strictEqual(deTarea(g.eventos, p2.tareas[0]).length, 0);
      assert.deepStrictEqual(g.por_uso.map((x) => x.tarea_id), [p1.tareas[1]]);
      assert.strictEqual(g.vencidas, 1, 'Cuenta solo las vencidas de su sector');

      const a = await calendarioOk(sumarDias(hoy, -5), sumarDias(hoy, 30));
      assert.ok(deTarea(a.eventos, p2.tareas[0]).length > 0, 'El administrador ve las dos');
      assert.ok(a.vencidas >= 2);
    });

    // =========================================================================
    // CA-03: Pendiente y previstas mensuales
    // =========================================================================
    await t.test('CA-03: Pendiente y previstas', async () => {
      const m = await crearMaquina();
      const p = await crearPlan(m, [tarea('Mensual', sumarDias(hoy, 5))]);
      const id = p.tareas[0];
      const hasta = sumarDias(hoy, 61);
      const c = await calendarioOk(hoy, hasta, `&maquina_id=${m}`);
      const ev = deTarea(c.eventos, id);

      // Las fechas esperadas, sumando de a un mes con Postgres
      const esperadas = (await client.query(
        `SELECT to_char(($1::date + interval '1 month')::date, 'YYYY-MM-DD') AS uno,
                to_char((($1::date + interval '1 month')::date + interval '1 month')::date, 'YYYY-MM-DD') AS dos`,
        [sumarDias(hoy, 5)]
      )).rows[0];
      const previstas = [esperadas.uno, esperadas.dos].filter((f: string) => f <= hasta);

      assert.deepStrictEqual(
        ev.map((e) => [e.fecha, e.tipo]),
        [[sumarDias(hoy, 5), 'PENDIENTE'], ...previstas.map((f: string) => [f, 'PREVISTA'])]
      );
      assert.strictEqual(ev[0].estado, await estadoVista(id));
      assert.deepStrictEqual([ev[0].vencida_por_uso, ev[0].tambien_por_uso, ev[0].intervencion], [false, false, null]);
      for (const e of ev.slice(1)) {
        assert.deepStrictEqual([e.estado, e.vencida_por_uso, e.tambien_por_uso, e.intervencion], [null, false, false, null]);
      }
      assert.deepStrictEqual(ev[0].plan, { id: p.id, nombre: `Plan CA ${numeroPlan}` });
      assert.strictEqual(ev[0].maquina.id, m);
      assert.strictEqual(ev[0].maquina.criticidad.prioridad_alta, false);
    });

    // =========================================================================
    // CA-04: Fin de mes
    // =========================================================================
    await t.test('CA-04: Fin de mes', async () => {
      const m = await crearMaquina();
      const p = await crearPlan(m, [tarea('Fin de mes', '2027-01-31')]);
      // La etapa pide desde el 25/01, pero eso son 63 días: se corre al 26 (respuesta del usuario)
      const c = await calendarioOk('2027-01-26', '2027-03-28', `&maquina_id=${m}`);
      assert.deepStrictEqual(
        deTarea(c.eventos, p.tareas[0]).map((e) => [e.fecha, e.tipo]),
        [['2027-01-31', 'PENDIENTE'], ['2027-02-28', 'PREVISTA'], ['2027-03-28', 'PREVISTA']]
      );
    });

    // =========================================================================
    // CA-05: Vencida
    // =========================================================================
    await t.test('CA-05: Vencida', async () => {
      const m = await crearMaquina();
      const p = await crearPlan(m, [tarea('Semanal', sumarDias(hoy, -10), 7, 'DIAS')]);
      const id = p.tareas[0];
      const c = await calendarioOk(sumarDias(hoy, -15), sumarDias(hoy, 15), `&maquina_id=${m}`);
      assert.deepStrictEqual(
        deTarea(c.eventos, id).map((e) => [e.fecha, e.tipo, e.estado]),
        [
          [sumarDias(hoy, -10), 'PENDIENTE', 'VENCIDA'],
          [sumarDias(hoy, 7), 'PREVISTA', null],
          [sumarDias(hoy, 14), 'PREVISTA', null],
        ]
      );
      assert.strictEqual(deTarea(c.eventos, id)[0].vencida_por_uso, false);
      assert.strictEqual(c.vencidas, 1);

      // El mes que viene: sin la pendiente, pero la cuenta sigue
      const otro = await calendarioOk(sumarDias(hoy, 30), sumarDias(hoy, 60), `&maquina_id=${m}`);
      assert.strictEqual(otro.vencidas, 1);
      assert.ok(deTarea(otro.eventos, id).every((e) => e.tipo === 'PREVISTA'));
    });

    // =========================================================================
    // CA-06: Hechas
    // =========================================================================
    await t.test('CA-06: Hechas', async () => {
      const m = await crearMaquina();
      const p = await crearPlan(m, [
        tarea('Hecha', sumarDias(hoy, -20)),
        tarea('Eliminada', sumarDias(hoy, -20)),
        tarea('No marcada', sumarDias(hoy, -20)),
        tarea('No finalizada', sumarDias(hoy, -20)),
      ]);
      const [t1, t2, t3, t4] = p.tareas;
      const dia = sumarDias(hoy, -5);
      const i1 = await ejecucion(m, p.id, t1, finDe(dia));
      const i2 = await ejecucion(m, p.id, t2, finDe(dia));
      await client.query(`UPDATE intervenciones SET eliminado_en = NOW(), eliminado_por_usuario_id = $2, motivo_eliminacion = 'Prueba CA' WHERE id = $1`, [i2, A.id]);
      await ejecucion(m, p.id, t3, finDe(dia), false);
      // La cuarta, en una intervención generada (pendiente), con la tarea marcada
      const g = await pedir('POST', `/api/planes/${p.id}/generar`, A.token, { tarea_ids: [t4] });
      assert.strictEqual(g.status, 201, JSON.stringify(g.cuerpo));
      const i4 = Number((await client.query(
        `SELECT id FROM intervenciones WHERE maquina_id = $1 AND estado <> 'FINALIZADA' AND eliminado_en IS NULL`, [m]
      )).rows[0].id);
      await client.query(
        'UPDATE intervencion_tareas SET hecha = TRUE, hecha_por_usuario_id = $2, hecha_en = NOW() WHERE intervencion_id = $1',
        [i4, A.id]
      );

      const rango: [string, string] = [sumarDias(hoy, -30), sumarDias(hoy, 31)];
      const c = await calendarioOk(...rango, `&maquina_id=${m}`);
      const hechas = c.eventos.filter((e) => e.tipo === 'HECHA');
      assert.deepStrictEqual(
        hechas.map((e) => [e.fecha, e.tarea_id, e.intervencion]),
        [[dia, t1, { id: i1, estado: 'FINALIZADA' }]]
      );
      assert.deepStrictEqual([hechas[0].estado, hechas[0].vencida_por_uso, hechas[0].tambien_por_uso], [null, false, false]);
      assert.ok(deTarea(c.eventos, t1).some((e) => e.tipo === 'PENDIENTE'));

      // Inactiva la tarea: la hecha sigue; la pendiente y las previstas, no
      await client.query('UPDATE plan_tareas SET activo = FALSE WHERE id = $1', [t1]);
      const despues = await calendarioOk(...rango, `&maquina_id=${m}`);
      assert.deepStrictEqual(
        deTarea(despues.eventos, t1).map((e) => [e.fecha, e.tipo]),
        [[dia, 'HECHA']]
      );
    });

    // =========================================================================
    // CA-07: En curso
    // =========================================================================
    await t.test('CA-07: En curso', async () => {
      const m = await crearMaquina();
      const p = await crearPlan(m, [tarea('En curso', sumarDias(hoy, 3))]);
      const g = await pedir('POST', `/api/planes/${p.id}/generar`, A.token, { tarea_ids: [p.tareas[0]] });
      assert.strictEqual(g.status, 201, JSON.stringify(g.cuerpo));
      const i = (await client.query('SELECT id, estado FROM intervenciones WHERE maquina_id = $1', [m])).rows[0];

      const c = await calendarioOk(hoy, sumarDias(hoy, 10), `&maquina_id=${m}`);
      const pend = deTarea(c.eventos, p.tareas[0]).filter((e) => e.tipo === 'PENDIENTE');
      assert.strictEqual(pend.length, 1);
      assert.strictEqual(pend[0].estado, 'EN_CURSO');
      assert.deepStrictEqual(pend[0].intervencion, { id: Number(i.id), estado: i.estado });
    });

    // =========================================================================
    // CA-08: Por uso
    // =========================================================================
    await t.test('CA-08: Por uso', async () => {
      const m = await crearMaquina();
      const med = await crearMedidor(m);
      const p = await crearPlan(m, [
        { accion: 'Solo uso', uso: { medidor_id: med, cada: 500, primera: 500 } },
        tarea('Fecha y uso', sumarDias(hoy, 20), 1, 'MESES', { uso: { medidor_id: med, cada: 500, primera: 500 } }),
      ]);
      const [soloUso, ambas] = p.tareas;
      await lectura(med, 100);

      const c = await calendarioOk(hoy, sumarDias(hoy, 61), `&maquina_id=${m}`);
      assert.strictEqual(deTarea(c.eventos, soloUso).length, 0);
      const ev = deTarea(c.eventos, ambas);
      assert.ok(ev.length >= 2);
      assert.deepStrictEqual([ev[0].fecha, ev[0].tipo], [sumarDias(hoy, 20), 'PENDIENTE']);
      assert.ok(ev.every((e) => e.tambien_por_uso === true));

      assert.deepStrictEqual(c.por_uso.map((x) => x.tarea_id), [soloUso]);
      const u = c.por_uso[0];
      assert.strictEqual(u.accion, 'Solo uso');
      assert.strictEqual(u.estado, await estadoVista(soloUso));
      assert.strictEqual(u.uso.medidor.id, med);
      assert.strictEqual(u.uso.faltan, 400);
      assert.deepStrictEqual(u.plan, { id: p.id, nombre: `Plan CA ${numeroPlan}` });
      assert.strictEqual(u.maquina.id, m);
      assert.strictEqual(u.intervencion, null);
    });

    // =========================================================================
    // CA-09: Venció por uso con la fecha en el futuro
    // =========================================================================
    await t.test('CA-09: Venció por uso antes de su fecha', async () => {
      const m = await crearMaquina();
      const med = await crearMedidor(m);
      const p = await crearPlan(m, [
        tarea('Venció por uso', sumarDias(hoy, 20), 10, 'DIAS', { uso: { medidor_id: med, cada: 100, primera: 100 } }),
      ]);
      await lectura(med, 150);
      const id = p.tareas[0];
      assert.strictEqual(await estadoVista(id), 'VENCIDA');

      const c = await calendarioOk(hoy, sumarDias(hoy, 25), `&maquina_id=${m}`);
      assert.deepStrictEqual(
        deTarea(c.eventos, id).map((e) => [e.fecha, e.tipo, e.estado, e.vencida_por_uso]),
        [
          [hoy, 'PENDIENTE', 'VENCIDA', true],
          [sumarDias(hoy, 10), 'PREVISTA', null, false],
          [sumarDias(hoy, 20), 'PREVISTA', null, false],
        ]
      );
      assert.ok(c.eventos.every((e) => e.estado !== 'VENCIDA' || e.fecha <= hoy), 'Ninguna vencida en el futuro');
    });

    // =========================================================================
    // CA-10: Inactivas
    // =========================================================================
    await t.test('CA-10: Inactivas', async () => {
      const mT = await crearMaquina();
      const pT = await crearPlan(mT, [tarea('Tarea inactiva', sumarDias(hoy, 2))]);
      await client.query('UPDATE plan_tareas SET activo = FALSE WHERE id = $1', [pT.tareas[0]]);

      const mP = await crearMaquina();
      const pP = await crearPlan(mP, [tarea('Plan inactivo', sumarDias(hoy, 2))]);
      await client.query('UPDATE planes_mantenimiento SET activo = FALSE WHERE id = $1', [pP.id]);

      const mM = await crearMaquina();
      const pM = await crearPlan(mM, [tarea('Máquina inactiva', sumarDias(hoy, 2))]);
      await client.query('UPDATE maquinas SET activo = FALSE WHERE id = $1', [mM]);

      const c = await calendarioOk(hoy, sumarDias(hoy, 61));
      for (const id of [pT.tareas[0], pP.tareas[0], pM.tareas[0]]) {
        assert.strictEqual(deTarea(c.eventos, id).length, 0, `Tarea ${id}`);
      }
    });

    // =========================================================================
    // CA-11: Filtros
    // =========================================================================
    await t.test('CA-11: Filtros', async () => {
      const s4 = await crearSector('S4');
      const s5 = await crearSector('S5', pl2);
      const m1 = await crearMaquina(s4);
      const m2 = await crearMaquina(s5);
      const med1 = await crearMedidor(m1);
      const med2 = await crearMedidor(m2);
      const p1 = await crearPlan(m1, [
        tarea('Vencida uno', sumarDias(hoy, -3)),
        { accion: 'Uso uno', uso: { medidor_id: med1, cada: 100, primera: 100 } },
      ]);
      const p2 = await crearPlan(m2, [
        tarea('Vencida dos', sumarDias(hoy, -3)),
        { accion: 'Uso dos', uso: { medidor_id: med2, cada: 100, primera: 100 } },
      ]);
      const desde = sumarDias(hoy, -5);
      const hasta = sumarDias(hoy, 30);

      const porMaquina = await calendarioOk(desde, hasta, `&maquina_id=${m1}`);
      assert.ok(porMaquina.eventos.length > 0 && porMaquina.eventos.every((e) => e.maquina.id === m1));
      assert.deepStrictEqual(porMaquina.por_uso.map((x) => x.tarea_id), [p1.tareas[1]]);
      assert.strictEqual(porMaquina.vencidas, 1);

      const porSector = await calendarioOk(desde, hasta, `&sector_id=${s5}`);
      assert.ok(porSector.eventos.length > 0 && porSector.eventos.every((e) => e.sector.id === s5));
      assert.ok(deTarea(porSector.eventos, p2.tareas[0]).length > 0);
      assert.deepStrictEqual(porSector.por_uso.map((x) => x.tarea_id), [p2.tareas[1]]);
      assert.strictEqual(porSector.vencidas, 1);

      // La planta 2 tiene los sectores S2 (CA-02) y S5: no la máquina de S4
      const porPlanta = await calendarioOk(desde, hasta, `&planta_id=${pl2}`);
      const sectoresPlanta2 = [s2, s5];
      assert.ok(porPlanta.eventos.every((e) => sectoresPlanta2.includes(e.sector.id)));
      assert.strictEqual(deTarea(porPlanta.eventos, p1.tareas[0]).length, 0);
      assert.ok(deTarea(porPlanta.eventos, p2.tareas[0]).length > 0);
      assert.ok(!porPlanta.por_uso.some((x) => x.tarea_id === p1.tareas[1]));
      assert.ok(porPlanta.por_uso.some((x) => x.tarea_id === p2.tareas[1]));
      assert.strictEqual(porPlanta.vencidas, 2, 'La de S2 y la de S5');
    });

    // =========================================================================
    // CA-12: Diaria en 62 días
    // =========================================================================
    await t.test('CA-12: Diaria en 62 días', async () => {
      const m = await crearMaquina();
      const p = await crearPlan(m, [tarea('Diaria', hoy, 1, 'DIAS')]);
      const hasta = sumarDias(hoy, 61);
      const c = await calendarioOk(hoy, hasta, `&maquina_id=${m}`);
      const ev = deTarea(c.eventos, p.tareas[0]);
      assert.ok(ev.length <= 62);
      assert.strictEqual(ev.length, 62);
      ev.forEach((e, i) => assert.strictEqual(e.fecha, sumarDias(hoy, i), `Evento ${i}`));
      assert.strictEqual(ev[0].tipo, 'PENDIENTE');
      assert.ok(ev.slice(1).every((e) => e.tipo === 'PREVISTA'));
    });

    // =========================================================================
    // CA-13: Orden
    // =========================================================================
    await t.test('CA-13: Orden', async () => {
      // La normal se crea primero: su código va antes que el de la de prioridad alta
      const mN = await crearMaquina(s3, critNormal);
      const mA = await crearMaquina(s3, critAlta);
      const pN = await crearPlan(mN, [
        tarea('Normal', sumarDias(hoy, 4)),
        tarea('Pendiente mañana', sumarDias(hoy, 1)),
        tarea('Hecha anteayer', sumarDias(hoy, -30)),
      ]);
      const pA = await crearPlan(mA, [
        tarea('Alta', sumarDias(hoy, 4)),
        tarea('Diaria alta', hoy, 1, 'DIAS'),
        tarea('Vencida anteayer', sumarDias(hoy, -2)),
      ]);
      const [tN, tQ, tH] = pN.tareas;
      const [tA, tP, tV] = pA.tareas;
      const anteayer = sumarDias(hoy, -2);
      await ejecucion(mN, pN.id, tH, finDe(anteayer));

      const c = await calendarioOk(sumarDias(hoy, -5), sumarDias(hoy, 10), `&sector_id=${s3}`);
      const delDia = (fecha: string) => c.eventos.filter((e) => e.fecha === fecha).map((e) => [e.tarea_id, e.tipo]);

      // Prioridad alta primero, aunque su código vaya después
      const pendientes4 = c.eventos.filter((e) => e.fecha === sumarDias(hoy, 4) && e.tipo === 'PENDIENTE');
      assert.deepStrictEqual(pendientes4.map((e) => e.tarea_id), [tA, tN]);
      // Pendiente antes que prevista, aunque la prevista sea de prioridad alta
      assert.deepStrictEqual(delDia(sumarDias(hoy, 1)), [[tQ, 'PENDIENTE'], [tP, 'PREVISTA']]);
      // Hecha antes que pendiente, aunque la pendiente sea de prioridad alta
      assert.deepStrictEqual(delDia(anteayer), [[tH, 'HECHA'], [tV, 'PENDIENTE']]);
      // Y todo en orden de fecha
      const fechas = c.eventos.map((e) => e.fecha);
      assert.deepStrictEqual(fechas, [...fechas].sort());
    });
  } finally {
    client = await clienteSano(client);
    // Limpieza: lo que creó esta prueba
    try {
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
