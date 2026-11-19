import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';
import { procesarVencimientos } from '../functions/preventivos/vencimientos.ts';
import { mismaForma } from './contrato.ts';
import { lecturaCargadaEjemplo } from '../../frontend/src/api/contrato-medidores.ts';

// Timeout de bloqueo para las pruebas de concurrencia
process.env.LOCK_TIMEOUT = '5s';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (LECTURAS RONDA TESTS)');
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
/** Un id que no existe: más que cualquier medidor de la base. */
const ID_INEXISTENTE = 9_000_000_000;

test('Etapa LE1 — Ronda de lecturas y avisos de lecturas (LR-01 a LR-14)', async (t) => {
  let client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];

  // Lo que ya había: la revisión diaria recorre toda la base, así que los avisos de esta
  // corrida se borran por id (también los de planes y medidores ajenos)
  const inicio = (await client.query(
    `SELECT
       (SELECT COALESCE(max(id), 0) FROM avisos_vencimiento)::bigint AS aviso,
       (SELECT COALESCE(max(id), 0) FROM notificaciones)::bigint AS notificacion,
       NOW() AS ahora`
  )).rows[0];
  const ultimoAviso = Number(inicio.aviso);
  const ultimaNotificacion = Number(inicio.notificacion);
  const inicioEn: Date = inicio.ahora;

  const sistemaId = Number((await client.query('SELECT id FROM usuarios WHERE es_sistema')).rows[0].id);

  try {
    const suf = Date.now();
    const passHash = await bcrypt.hash('pass123', 10);

    const perfilMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, nombre FROM perfiles')).rows) {
      perfilMap[r.nombre] = Number(r.id);
    }
    const permisoPlanes = Number((await client.query(`SELECT id FROM permisos WHERE codigo = 'PLANES_GESTIONAR'`)).rows[0].id);

    // Plantas, sectores y máquinas
    async function crearPlanta(clave: string) {
      const id = Number((await client.query(
        'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`LR_${clave}_${suf}`]
      )).rows[0].id);
      createdPlantaIds.push(id);
      return id;
    }
    async function crearSector(nombre: string, plantaId: number) {
      const r = await client.query(
        'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id, nombre', [`${nombre}_${suf}`, plantaId]
      );
      const id = Number(r.rows[0].id);
      createdSectorIds.push(id);
      return { id, nombre: r.rows[0].nombre as string };
    }
    let numeroMaquina = 0;
    /** El código lleva el número con dos cifras: el orden por código es el orden de creación. */
    async function crearMaquina(sectorId: number, prefijo = 'LR_M') {
      numeroMaquina++;
      const n = String(numeroMaquina).padStart(2, '0');
      const r = await client.query(
        `INSERT INTO maquinas (codigo, nombre, sector_id, activo)
         VALUES ($1, $2, $3, TRUE) RETURNING id, codigo, nombre`,
        [`${prefijo}${n}_${suf}`, `Maquina LR ${n}`, sectorId]
      );
      const id = Number(r.rows[0].id);
      createdMaquinaIds.push(id);
      return { id, codigo: r.rows[0].codigo as string, nombre: r.rows[0].nombre as string };
    }
    const pl = await crearPlanta('PL');
    const s1 = (await crearSector('LR_S1', pl)).id;

    // Usuarios
    async function crearUsuario(clave: string, perfil: string, sectores: number[]) {
      const res = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, $2, 'LR', $3, $4, TRUE, 1) RETURNING id, legajo, sesion_version`,
        [`LR_${clave}_${suf}`, clave, passHash, perfilMap[perfil]]
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
    const C = await crearUsuario('Consulta', 'CONSULTA', [s1]);
    // G: solo PLANES_GESTIONAR, por excepción, con el alcance de su sector
    const G = await crearUsuario('Gestor', 'CONSULTA', [s1]);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Planes de su sector', $3)`,
      [G.id, permisoPlanes, A.id]
    );
    /**
     * Un responsable nuevo para cada caso, sin PLANES_GESTIONAR: así recibe avisos solo como
     * responsable de los planes de ese caso, y no los de planes ajenos sin responsable que la
     * revisión diaria encuentre en la base.
     */
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
    /** Un medidor dado de alta por A, con su primera lectura. */
    async function medidor(maquinaId: number, extra: Record<string, unknown> = {}) {
      numeroMedidor++;
      const r = await pedir('POST', '/api/medidores', A.token, {
        maquina_id: maquinaId,
        nombre: `Horómetro ${numeroMedidor}`,
        unidad: 'horas',
        lectura_inicial: 100,
        ...extra,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      return { id: Number(r.cuerpo.id), nombre: r.cuerpo.nombre as string };
    }
    const tareaUso = (accion: string, medidorId: number) => ({
      accion,
      uso: { medidor_id: medidorId, cada: 100, primera: 500, anticipacion: 20 },
    });
    let numeroPlan = 0;
    async function crearPlan(maquinaId: number, tareas: unknown[], extra: Record<string, unknown> = {}) {
      numeroPlan++;
      const r = await pedir('POST', '/api/planes', A.token, {
        maquina_id: maquinaId,
        nombre: `Plan LR ${numeroPlan}`,
        anticipacion_dias: 7,
        tareas,
        ...extra,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      return r.cuerpo;
    }
    /** Apaga el plan al terminar el caso, para que no entre en las revisiones de los que siguen. */
    const apagar = async (...planIds: number[]) =>
      client.query('UPDATE planes_mantenimiento SET activo = FALSE WHERE id = ANY($1)', [planIds]);

    const ronda = (lecturas: unknown, token: string | null = O.token) =>
      pedir('POST', '/api/medidores/ronda', token, { lecturas });
    async function rondaOk(lecturas: unknown[], token = O.token) {
      const r = await ronda(lecturas, token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      return r.cuerpo;
    }
    /** La revisión diaria, forzada: no depende de si hoy ya se revisó. */
    const revisar = () => procesarVencimientos({ forzar: true });

    /** Los valores de las lecturas vigentes del medidor, en el orden en que se cargaron. */
    const valoresDe = async (medidorId: number) =>
      (await client.query(
        'SELECT valor FROM lecturas_medidor WHERE medidor_id = $1 AND anulada_en IS NULL ORDER BY id', [medidorId]
      )).rows.map((r) => Number(r.valor));
    /** Cuántas lecturas hay en los medidores de esta prueba. */
    const totalLecturas = async () =>
      Number((await client.query(
        'SELECT count(*)::int AS n FROM lecturas_medidor WHERE medidor_id IN (SELECT id FROM medidores WHERE maquina_id = ANY($1))',
        [createdMaquinaIds]
      )).rows[0].n);
    /** Los avisos de un usuario, de un tipo, de esta corrida. */
    const avisosDe = async (usuarioId: number, tipo: string) =>
      (await client.query(
        `SELECT id, prioridad, titulo, mensaje, intervencion_id, maquina_id, generada_por_usuario_id
         FROM notificaciones
         WHERE usuario_id = $1 AND tipo_evento = $2 AND id > $3
         ORDER BY id`,
        [usuarioId, tipo, ultimaNotificacion]
      )).rows.map((r) => ({
        id: Number(r.id),
        prioridad: r.prioridad as string,
        titulo: r.titulo as string,
        mensaje: r.mensaje as string,
        intervencion_id: r.intervencion_id === null ? null : Number(r.intervencion_id),
        maquina_id: r.maquina_id === null ? null : Number(r.maquina_id),
        generada_por_usuario_id: Number(r.generada_por_usuario_id),
      }));
    const intervencionesDe = async (maquinaId: number) =>
      (await client.query('SELECT id, creado_por_usuario_id, estado FROM intervenciones WHERE maquina_id = $1 ORDER BY id', [maquinaId])).rows;
    const avisadoEn = async (medidorId: number) =>
      (await client.query('SELECT atraso_avisado_en FROM medidores WHERE id = $1', [medidorId])).rows[0].atraso_avisado_en;

    /**
     * Deja el alta del medidor y sus lecturas `dias` días atrás, al mediodía local, a partir de
     * hoy_instalacion(): así "días sin lectura" no depende de la hora en que corre la prueba.
     */
    async function atrasar(medidorId: number, dias: number) {
      const cuando = `(
        ((hoy_instalacion() - $2::int)::timestamp + interval '12 hours') AT TIME ZONE COALESCE(
          (SELECT zona_horaria FROM configuracion_sistema WHERE id = 1), 'America/Argentina/Buenos_Aires'
        )
      )`;
      await client.query(`UPDATE lecturas_medidor SET registrada_en = ${cuando} WHERE medidor_id = $1`, [medidorId, dias]);
      await client.query(`UPDATE medidores SET creado_en = ${cuando} WHERE id = $1`, [medidorId, dias]);
    }

    // =========================================================================
    // LR-01: Permisos
    // =========================================================================
    await t.test('LR-01: Permisos', async () => {
      const m = await crearMaquina(s1);
      const med = await medidor(m.id);
      const cuerpo = [{ medidor_id: med.id, valor: 110, observacion: null }];

      const sinToken = await ronda(cuerpo, null);
      assert.strictEqual(sinToken.status, 401);
      for (const [quien, token] of [['consulta', C.token], ['solo PLANES_GESTIONAR', G.token]] as const) {
        const r = await ronda(cuerpo, token);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE'], quien);
      }
      assert.deepStrictEqual(await valoresDe(med.id), [100], 'Sin permiso, no se guarda');

      // Un operario de fábrica la carga
      const r = await ronda(cuerpo, O.token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      assert.deepStrictEqual(r.cuerpo.resultados.map((x: any) => x.ok), [true]);
      assert.deepStrictEqual(await valoresDe(med.id), [100, 110]);

      // El GET: con solo PLANES_GESTIONAR, 200; sin ninguno de los dos permisos, 403
      const q = `/api/medidores/ronda?maquina_id=${m.id}`;
      const deGestor = await pedir('GET', q, G.token);
      assert.strictEqual(deGestor.status, 200, JSON.stringify(deGestor.cuerpo));
      assert.deepStrictEqual(deGestor.cuerpo.map((x: any) => x.id), [med.id]);
      const deOperario = await pedir('GET', q, O.token);
      assert.strictEqual(deOperario.status, 200);
      const deConsulta = await pedir('GET', q, C.token);
      assert.deepStrictEqual([deConsulta.status, deConsulta.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
    });

    // =========================================================================
    // LR-02: Cuerpo inválido
    // =========================================================================
    await t.test('LR-02: Cuerpo inválido: 422 y no se guarda ninguna', async () => {
      const m = await crearMaquina(s1);
      const a = await medidor(m.id);
      const b = await medidor(m.id);
      const antes = await totalLecturas();

      const buena = { medidor_id: a.id, valor: 110 };
      const casos: Array<[string, unknown]> = [
        ['sin lecturas', undefined],
        ['lecturas no es una lista', { medidor_id: a.id, valor: 110 }],
        ['lista vacía', []],
        ['201 lecturas', Array.from({ length: 201 }, (_, i) => ({ medidor_id: ID_INEXISTENTE + i, valor: 1 }))],
        ['un medidor repetido', [buena, { medidor_id: a.id, valor: 120 }]],
        ['un valor que es texto', [buena, { medidor_id: b.id, valor: '120' }]],
        ['un valor negativo', [buena, { medidor_id: b.id, valor: -1 }]],
        ['un valor con tres decimales', [buena, { medidor_id: b.id, valor: 120.123 }]],
        ['sin valor', [buena, { medidor_id: b.id }]],
        ['una observación de 201 caracteres', [buena, { medidor_id: b.id, valor: 120, observacion: 'x'.repeat(201) }]],
        ['una observación que no es texto', [buena, { medidor_id: b.id, valor: 120, observacion: 5 }]],
        ['un medidor_id que es texto', [buena, { medidor_id: String(b.id), valor: 120 }]],
        ['un medidor_id que es true', [buena, { medidor_id: true, valor: 120 }]],
        ['un medidor_id negativo', [buena, { medidor_id: -1, valor: 120 }]],
        ['un elemento que no es un objeto', [buena, 120]],
      ];
      for (const [nombre, lecturas] of casos) {
        const r = await ronda(lecturas);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `${nombre}: ${JSON.stringify(r.cuerpo)}`);
      }
      assert.strictEqual(await totalLecturas(), antes, 'No se guardó ninguna');

      // En el borde: 200 lecturas se aceptan (ninguna de un medidor que exista)
      const en200 = await ronda(Array.from({ length: 200 }, (_, i) => ({ medidor_id: ID_INEXISTENTE + i, valor: 1 })));
      assert.strictEqual(en200.status, 200, JSON.stringify(en200.cuerpo).slice(0, 300));
      assert.strictEqual(en200.cuerpo.resultados.length, 200);
      assert.ok(en200.cuerpo.resultados.every((x: any) => x.ok === false && x.codigo === 'MEDIDOR_NO_ENCONTRADO'));
      // Una observación de 200 caracteres, también
      const obs200 = await rondaOk([{ medidor_id: b.id, valor: 120, observacion: 'y'.repeat(200) }]);
      assert.strictEqual(obs200.resultados[0].ok, true);
    });

    // =========================================================================
    // LR-03: Tres lecturas, una menor que la última
    // =========================================================================
    await t.test('LR-03: Tres lecturas, una menor que la última', async () => {
      const m = await crearMaquina(s1);
      const a = await medidor(m.id);
      const b = await medidor(m.id, { lectura_inicial: 200 });
      const c = await medidor(m.id, { lectura_inicial: 300 });

      // En un orden que no es el de los ids
      const r = await rondaOk([
        { medidor_id: c.id, valor: 310.5, observacion: 'Con el motor en marcha' },
        { medidor_id: b.id, valor: 150 },
        { medidor_id: a.id, valor: 100, observacion: null },
      ]);
      assert.deepStrictEqual(Object.keys(r).sort(), ['avisos', 'generadas', 'resultados']);
      assert.deepStrictEqual([r.generadas, r.avisos], [[], 0]);

      const ids = async (medidorId: number) =>
        (await client.query(
          'SELECT id, valor, origen, observacion, registrada_por_usuario_id FROM lecturas_medidor WHERE medidor_id = $1 ORDER BY id DESC LIMIT 1',
          [medidorId]
        )).rows[0];
      const ultimaC = await ids(c.id);
      const ultimaA = await ids(a.id);
      assert.deepStrictEqual(r.resultados, [
        { medidor_id: c.id, ok: true, lectura_id: Number(ultimaC.id), tareas: [] },
        { medidor_id: b.id, ok: false, codigo: 'LECTURA_MENOR', error: 'La lectura es menor que la última registrada' },
        { medidor_id: a.id, ok: true, lectura_id: Number(ultimaA.id), tareas: [] },
      ]);

      assert.deepStrictEqual(await valoresDe(c.id), [300, 310.5]);
      assert.deepStrictEqual(await valoresDe(b.id), [200], 'La menor no se guardó');
      assert.deepStrictEqual(await valoresDe(a.id), [100, 100], 'Igual a la última, se guarda');
      assert.deepStrictEqual(
        [ultimaC.origen, ultimaC.observacion, Number(ultimaC.registrada_por_usuario_id)],
        ['MANUAL', 'Con el motor en marcha', O.id]
      );
      assert.strictEqual(ultimaA.observacion, null);
    });

    // =========================================================================
    // LR-04: Un medidor inactivo y uno que no existe
    // =========================================================================
    await t.test('LR-04: Un medidor inactivo y uno que no existe', async () => {
      const m = await crearMaquina(s1);
      const inactivo = await medidor(m.id);
      const bueno = await medidor(m.id);
      const baja = await pedir('POST', `/api/medidores/${inactivo.id}/desactivar`, A.token, {});
      assert.strictEqual(baja.status, 200, JSON.stringify(baja.cuerpo));
      // Y uno de una máquina inactiva
      const mInactiva = await crearMaquina(s1);
      const deInactiva = await medidor(mInactiva.id);
      await client.query('UPDATE maquinas SET activo = FALSE WHERE id = $1', [mInactiva.id]);

      const r = await rondaOk([
        { medidor_id: inactivo.id, valor: 110 },
        { medidor_id: ID_INEXISTENTE, valor: 110 },
        { medidor_id: deInactiva.id, valor: 110 },
        { medidor_id: bueno.id, valor: 110 },
      ]);
      assert.deepStrictEqual(r.resultados.slice(0, 3), [
        { medidor_id: inactivo.id, ok: false, codigo: 'MEDIDOR_INACTIVO', error: 'El medidor está inactivo' },
        { medidor_id: ID_INEXISTENTE, ok: false, codigo: 'MEDIDOR_NO_ENCONTRADO', error: 'Medidor no encontrado' },
        { medidor_id: deInactiva.id, ok: false, codigo: 'MAQUINA_INACTIVA', error: 'La máquina está inactiva' },
      ]);
      assert.deepStrictEqual([r.resultados[3].medidor_id, r.resultados[3].ok], [bueno.id, true]);
      assert.deepStrictEqual(await valoresDe(inactivo.id), [100]);
      assert.deepStrictEqual(await valoresDe(deInactiva.id), [100]);
      assert.deepStrictEqual(await valoresDe(bueno.id), [100, 110], 'Las demás se guardan');
    });

    // =========================================================================
    // LR-05: Una lectura deja una tarea próxima
    // =========================================================================
    await t.test('LR-05: Una lectura deja una tarea próxima', async () => {
      const R = await responsable();
      const m = await crearMaquina(s1);
      const med = await medidor(m.id);
      const plan = await crearPlan(m.id, [tareaUso('Cambiar aceite', med.id)], { responsable_usuario_id: R.id });
      const tareaId = Number(plan.tareas[0].id);

      // Lejos de la próxima (500): no avisa
      const lejos = await rondaOk([{ medidor_id: med.id, valor: 300 }]);
      assert.deepStrictEqual([lejos.avisos, lejos.generadas], [0, []]);
      assert.deepStrictEqual(lejos.resultados[0].tareas, [
        { tarea_id: tareaId, accion: 'Cambiar aceite', plan: { id: plan.id, nombre: plan.nombre }, estado: 'AL_DIA', proximo_uso: 500, faltan_uso: 200 },
      ]);
      assert.strictEqual((await avisosDe(R.id, TIPO_VENCIMIENTO)).length, 0);

      // Con 485 faltan 15, dentro de la anticipación de 20: próxima, y se avisa al momento
      const r = await rondaOk([{ medidor_id: med.id, valor: 485 }]);
      assert.deepStrictEqual(r.resultados[0].tareas, [
        { tarea_id: tareaId, accion: 'Cambiar aceite', plan: { id: plan.id, nombre: plan.nombre }, estado: 'PROXIMA', proximo_uso: 500, faltan_uso: 15 },
      ]);
      assert.deepStrictEqual([r.avisos, r.generadas], [1, []]);
      const avisos = await avisosDe(R.id, TIPO_VENCIMIENTO);
      assert.strictEqual(avisos.length, 1, 'Un aviso al responsable del plan');
      assert.deepStrictEqual(
        { ...avisos[0], id: 0 },
        {
          id: 0,
          prioridad: 'NORMAL',
          titulo: `Preventivo: ${plan.nombre}`,
          mensaje: `${m.codigo} · ${m.nombre}: 1 tarea próxima (Cambiar aceite).`,
          intervencion_id: null,
          maquina_id: m.id,
          generada_por_usuario_id: sistemaId,
        }
      );

      // Otra lectura en el mismo ciclo no repite el aviso
      const otra = await rondaOk([{ medidor_id: med.id, valor: 490 }]);
      assert.strictEqual(otra.avisos, 0);
      assert.strictEqual(otra.resultados[0].tareas[0].faltan_uso, 10);
      assert.strictEqual((await avisosDe(R.id, TIPO_VENCIMIENTO)).length, 1);

      // La revisión diaria, tampoco
      await revisar();
      assert.strictEqual((await avisosDe(R.id, TIPO_VENCIMIENTO)).length, 1, 'La revisión diaria no repite');

      // Cuando vence, se avisa otra vez: es otro estado del mismo ciclo
      const vencida = await rondaOk([{ medidor_id: med.id, valor: 520 }]);
      assert.deepStrictEqual(
        [vencida.avisos, vencida.resultados[0].tareas[0].estado, vencida.resultados[0].tareas[0].faltan_uso],
        [1, 'VENCIDA', -20]
      );
      const alFinal = await avisosDe(R.id, TIPO_VENCIMIENTO);
      assert.strictEqual(alFinal.length, 2);
      assert.strictEqual(alFinal[1].mensaje, `${m.codigo} · ${m.nombre}: 1 tarea vencida (Cambiar aceite).`);
      await apagar(plan.id);
    });

    // =========================================================================
    // LR-06: Plan con generación automática
    // =========================================================================
    await t.test('LR-06: Plan con generación automática; la lectura vence una tarea', async () => {
      const R = await responsable();
      const m = await crearMaquina(s1);
      const med = await medidor(m.id);
      const plan = await crearPlan(m.id, [tareaUso('Cambiar aceite', med.id)], {
        responsable_usuario_id: R.id,
        generacion_automatica: true,
      });

      const r = await rondaOk([{ medidor_id: med.id, valor: 520 }]);
      const ints = await intervencionesDe(m.id);
      assert.strictEqual(ints.length, 1, 'Se generó la intervención');
      assert.strictEqual(Number(ints[0].creado_por_usuario_id), sistemaId, 'La genera el usuario del sistema');
      assert.deepStrictEqual(r.generadas, [{ plan_id: plan.id, intervencion_id: Number(ints[0].id) }]);
      assert.strictEqual(r.avisos, 1);
      // tareas se lee después del aviso: ya muestra la intervención en curso
      assert.strictEqual(r.resultados[0].tareas[0].estado, 'EN_CURSO');
      const avisos = await avisosDe(R.id, TIPO_VENCIMIENTO);
      assert.strictEqual(avisos.length, 1);
      assert.strictEqual(
        avisos[0].mensaje,
        `${m.codigo} · ${m.nombre}: 1 tarea vencida (Cambiar aceite). Se generó la intervención N.º ${ints[0].id}.`
      );

      // Otra lectura no genera otra
      const otra = await rondaOk([{ medidor_id: med.id, valor: 530 }]);
      assert.deepStrictEqual([otra.generadas, otra.avisos], [[], 0]);
      assert.strictEqual((await intervencionesDe(m.id)).length, 1, 'Una sola intervención');
      assert.strictEqual((await avisosDe(R.id, TIPO_VENCIMIENTO)).length, 1);
      await apagar(plan.id);
    });

    // =========================================================================
    // LR-07: El POST /:id/lecturas de siempre
    // =========================================================================
    await t.test('LR-07: El POST /:id/lecturas de siempre también avisa', async () => {
      const R = await responsable();
      const m = await crearMaquina(s1);
      const med = await medidor(m.id);
      const plan = await crearPlan(m.id, [tareaUso('Cambiar aceite', med.id)], { responsable_usuario_id: R.id });

      const r = await pedir('POST', `/api/medidores/${med.id}/lecturas`, O.token, { valor: 485 });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      // Su respuesta no cambia: la misma forma que el ejemplo de la PV3
      assert.deepStrictEqual(mismaForma(r.cuerpo, lecturaCargadaEjemplo), []);
      assert.deepStrictEqual([r.cuerpo.valor, r.cuerpo.origen], [485, 'MANUAL']);

      const avisos = await avisosDe(R.id, TIPO_VENCIMIENTO);
      assert.strictEqual(avisos.length, 1, 'También avisa');
      assert.strictEqual(avisos[0].mensaje, `${m.codigo} · ${m.nombre}: 1 tarea próxima (Cambiar aceite).`);

      // Una lectura que falla no avisa ni cambia su error
      const menor = await pedir('POST', `/api/medidores/${med.id}/lecturas`, O.token, { valor: 100 });
      assert.deepStrictEqual([menor.status, menor.cuerpo.codigo], [422, 'LECTURA_MENOR']);
      assert.strictEqual((await avisosDe(R.id, TIPO_VENCIMIENTO)).length, 1);
      await apagar(plan.id);
    });

    // =========================================================================
    // LR-08: Si el aviso falla
    // =========================================================================
    await t.test('LR-08: Si el aviso falla, la lectura queda guardada', async () => {
      const R = await responsable();
      const m = await crearMaquina(s1);
      const med = await medidor(m.id);
      const plan = await crearPlan(m.id, [tareaUso('Cambiar aceite', med.id)], { responsable_usuario_id: R.id });
      const tareaId = Number(plan.tareas[0].id);

      // El aviso de este plan falla dentro de procesarPlan
      await client.query(`
        CREATE OR REPLACE FUNCTION trg_fn_test_lr08() RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.plan_tarea_id = ${tareaId} THEN
            RAISE EXCEPTION 'Falla forzada LR-08';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await client.query(`
        CREATE TRIGGER trg_test_lr08 BEFORE INSERT ON avisos_vencimiento
        FOR EACH ROW EXECUTE FUNCTION trg_fn_test_lr08();
      `);
      try {
        const r = await ronda([{ medidor_id: med.id, valor: 485 }]);
        assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
        assert.deepStrictEqual([r.cuerpo.resultados[0].ok, r.cuerpo.avisos, r.cuerpo.generadas], [true, 0, []]);
        assert.strictEqual(r.cuerpo.resultados[0].tareas[0].estado, 'PROXIMA');
        assert.deepStrictEqual(await valoresDe(med.id), [100, 485], 'La lectura quedó guardada');
        assert.strictEqual((await avisosDe(R.id, TIPO_VENCIMIENTO)).length, 0);

        // Lo mismo con el POST de siempre: 201 y la lectura guardada
        const r2 = await pedir('POST', `/api/medidores/${med.id}/lecturas`, O.token, { valor: 490 });
        assert.strictEqual(r2.status, 201, JSON.stringify(r2.cuerpo));
        assert.deepStrictEqual(await valoresDe(med.id), [100, 485, 490]);
      } finally {
        client = await clienteSano(client);
        await client.query('DROP TRIGGER IF EXISTS trg_test_lr08 ON avisos_vencimiento');
        await client.query('DROP FUNCTION IF EXISTS trg_fn_test_lr08()');
      }

      // Sin la falla, la revisión diaria lo retoma
      await revisar();
      assert.strictEqual((await avisosDe(R.id, TIPO_VENCIMIENTO)).length, 1, 'La revisión diaria avisa lo que faltó');
      await apagar(plan.id);
    });

    // =========================================================================
    // LR-09: Atraso
    // =========================================================================
    await t.test('LR-09: Atraso', async () => {
      const R = await responsable();
      const m = await crearMaquina(s1);
      const atrasado = await medidor(m.id);
      const sinTareas = await medidor(m.id);
      const sinControl = await medidor(m.id, { lectura_cada_dias: null });
      const justo = await medidor(m.id);
      const dePlanInactivo = await medidor(m.id);
      const plan = await crearPlan(
        m.id,
        [tareaUso('Cambiar aceite', atrasado.id), tareaUso('Engrasar', sinControl.id), tareaUso('Limpiar filtro', justo.id)],
        { responsable_usuario_id: R.id }
      );
      const planInactivo = await crearPlan(m.id, [tareaUso('Revisar correas', dePlanInactivo.id)], { responsable_usuario_id: R.id });
      await apagar(planInactivo.id);

      // La última lectura, hace 8 días; la de "justo", hace exactamente 7
      for (const x of [atrasado, sinTareas, sinControl, dePlanInactivo]) await atrasar(x.id, 8);
      await atrasar(justo.id, 7);

      // En el GET de la ronda
      const lista = await pedir('GET', `/api/medidores/ronda?maquina_id=${m.id}`, O.token);
      assert.strictEqual(lista.status, 200, JSON.stringify(lista.cuerpo));
      const porId = new Map<number, any>(lista.cuerpo.map((x: any) => [x.id, x]));
      const estado = (id: number) => [porId.get(id).dias_sin_lectura, porId.get(id).atrasado];
      assert.deepStrictEqual(estado(atrasado.id), [8, true], 'Hace 8 días, cada 7, con una tarea activa');
      assert.deepStrictEqual(estado(sinTareas.id), [8, false], 'Sin tareas activas');
      assert.deepStrictEqual(estado(sinControl.id), [8, false], 'Con lectura_cada_dias en null');
      assert.deepStrictEqual(estado(justo.id), [7, false], 'Con exactamente 7 días');
      assert.deepStrictEqual(estado(dePlanInactivo.id), [8, false], 'Con la tarea en un plan inactivo');
      assert.strictEqual(porId.get(sinControl.id).lectura_cada_dias, null);
      // Y en los GET de medidores (3.5)
      const det = (await pedir('GET', `/api/medidores/${atrasado.id}`, O.token)).cuerpo;
      assert.deepStrictEqual([det.lectura_cada_dias, det.dias_sin_lectura, det.atrasado], [7, 8, true]);
      const deLista = (await pedir('GET', `/api/medidores?maquina_id=${m.id}`, O.token)).cuerpo.find((x: any) => x.id === justo.id);
      assert.deepStrictEqual([deLista.lectura_cada_dias, deLista.dias_sin_lectura, deLista.atrasado], [7, 7, false]);

      // La revisión diaria avisa
      const r1 = await pedir('POST', '/api/planes/procesar-vencimientos', A.token, {});
      assert.strictEqual(r1.status, 200, JSON.stringify(r1.cuerpo));
      assert.ok(Number.isInteger(r1.cuerpo.lecturas_atrasadas) && r1.cuerpo.lecturas_atrasadas >= 1, JSON.stringify(r1.cuerpo));
      const avisos = await avisosDe(R.id, TIPO_ATRASO);
      assert.strictEqual(avisos.length, 1, 'Un aviso de lecturas atrasadas');
      assert.deepStrictEqual(
        { ...avisos[0], id: 0 },
        {
          id: 0,
          prioridad: 'NORMAL',
          titulo: 'Lecturas para cargar',
          mensaje: `${m.codigo} · ${atrasado.nombre}: 8 días sin lectura (se lee cada 7)`,
          intervencion_id: null,
          maquina_id: m.id,
          generada_por_usuario_id: sistemaId,
        }
      );
      assert.ok((await avisadoEn(atrasado.id)) !== null, 'El medidor queda marcado');
      for (const x of [sinTareas, sinControl, justo, dePlanInactivo]) {
        assert.strictEqual(await avisadoEn(x.id), null, `${x.nombre} no se marca`);
      }
      // La regla nace en NUNCA: no sale ningún email
      const envios = Number((await client.query(
        'SELECT count(*)::int AS n FROM notificacion_envios WHERE notificacion_id = $1', [avisos[0].id]
      )).rows[0].n);
      assert.strictEqual(envios, 0);

      // Una segunda revisión no repite
      await revisar();
      assert.strictEqual((await avisosDe(R.id, TIPO_ATRASO)).length, 1, 'La segunda revisión no repite');

      // Una lectura nueva limpia la marca
      await rondaOk([{ medidor_id: atrasado.id, valor: 110 }]);
      assert.strictEqual(await avisadoEn(atrasado.id), null, 'La lectura nueva limpia la marca');
      const despues = (await pedir('GET', `/api/medidores/${atrasado.id}`, O.token)).cuerpo;
      assert.deepStrictEqual([despues.dias_sin_lectura, despues.atrasado], [0, false]);
      await revisar();
      assert.strictEqual((await avisosDe(R.id, TIPO_ATRASO)).length, 1, 'Al día, no avisa');

      // Si vuelve a atrasarse, se avisa de nuevo: es otro atraso
      await atrasar(atrasado.id, 9);
      await revisar();
      const otraVez = await avisosDe(R.id, TIPO_ATRASO);
      assert.strictEqual(otraVez.length, 2);
      assert.strictEqual(otraVez[1].mensaje, `${m.codigo} · ${atrasado.nombre}: 9 días sin lectura (se lee cada 7)`);
      await apagar(plan.id);
    });

    // =========================================================================
    // LR-10: Agrupado
    // =========================================================================
    await t.test('LR-10: Un destinatario con dos medidores atrasados recibe un solo aviso', async () => {
      const R1 = await responsable();
      const R2 = await responsable();
      const ma = await crearMaquina(s1);
      const mb = await crearMaquina(s1);
      const x = await medidor(ma.id);
      const y = await medidor(mb.id, { lectura_cada_dias: 3 });
      // El medidor X lo usan dos planes, de dos responsables; el Y, uno de R1
      const p1 = await crearPlan(ma.id, [tareaUso('Cambiar aceite', x.id)], { responsable_usuario_id: R1.id });
      const p2 = await crearPlan(ma.id, [tareaUso('Engrasar', x.id), tareaUso('Limpiar filtro', x.id)], { responsable_usuario_id: R2.id });
      const p3 = await crearPlan(mb.id, [tareaUso('Cambiar aceite', y.id)], { responsable_usuario_id: R1.id });
      await atrasar(x.id, 8);
      await atrasar(y.id, 10);

      const r = await revisar();
      assert.ok((r.lecturas_atrasadas ?? 0) >= 2, JSON.stringify(r));

      const lineaX = `${ma.codigo} · ${x.nombre}: 8 días sin lectura (se lee cada 7)`;
      const lineaY = `${mb.codigo} · ${y.nombre}: 10 días sin lectura (se lee cada 3)`;
      const deR1 = await avisosDe(R1.id, TIPO_ATRASO);
      assert.strictEqual(deR1.length, 1, 'Un solo aviso para R1');
      assert.deepStrictEqual(
        [deR1[0].titulo, deR1[0].mensaje, deR1[0].maquina_id],
        ['Lecturas para cargar', `${lineaX}\n${lineaY}`, null],
        'Con las dos líneas, y sin máquina porque son varios'
      );
      // R2 recibe el suyo una sola vez, aunque su plan tiene dos tareas con el medidor
      const deR2 = await avisosDe(R2.id, TIPO_ATRASO);
      assert.strictEqual(deR2.length, 1, 'Un solo aviso para R2');
      assert.deepStrictEqual([deR2[0].mensaje, deR2[0].maquina_id], [lineaX, ma.id]);
      await apagar(p1.id, p2.id, p3.id);
    });

    // =========================================================================
    // LR-11: Dos revisiones diarias a la vez
    // =========================================================================
    await t.test('LR-11: Dos revisiones diarias a la vez, tres vueltas', async () => {
      const R = await responsable();
      for (let vuelta = 1; vuelta <= 3; vuelta++) {
        const m = await crearMaquina(s1);
        const med = await medidor(m.id);
        const plan = await crearPlan(m.id, [tareaUso('Cambiar aceite', med.id)], { responsable_usuario_id: R.id });
        await atrasar(med.id, 8);

        const [a, b] = await Promise.all([revisar(), revisar()]);
        assert.ok(a.revisado && b.revisado, `Vuelta ${vuelta}`);
        const avisos = (await avisosDe(R.id, TIPO_ATRASO)).filter((n) => n.mensaje.includes(m.codigo));
        assert.strictEqual(avisos.length, 1, `Vuelta ${vuelta}: un solo aviso por destinatario y medidor`);
        assert.strictEqual(avisos[0].mensaje, `${m.codigo} · ${med.nombre}: 8 días sin lectura (se lee cada 7)`);
        assert.ok((await avisadoEn(med.id)) !== null, `Vuelta ${vuelta}: el medidor queda marcado`);
        await apagar(plan.id);
      }
    });

    // =========================================================================
    // LR-12: El GET de la ronda
    // =========================================================================
    await t.test('LR-12: El GET de la ronda', async () => {
      // Una planta aparte, con los sectores y las máquinas creados al revés del orden que se espera
      const pl2 = await crearPlanta('PL2');
      const sB = await crearSector('LR2_B', pl2);
      const sA = await crearSector('LR2_A', pl2);
      const b1 = await crearMaquina(sB.id);
      const a2 = await crearMaquina(sA.id, 'LR_N');
      const a1 = await crearMaquina(sA.id, 'LR_M');
      const mInactiva = await crearMaquina(sA.id);

      const zeta = await medidor(a1.id, { nombre: 'Zeta' });
      const alfa = await medidor(a1.id, { nombre: 'Alfa' });
      const deA2 = await medidor(a2.id, { nombre: 'Contador de ciclos', unidad: 'ciclos', lectura_inicial: undefined });
      const deB1 = await medidor(b1.id, { nombre: 'Horómetro B' });
      // No entran: un medidor inactivo y uno de una máquina inactiva
      const inactivo = await medidor(a1.id, { nombre: 'Inactivo' });
      const baja = await pedir('POST', `/api/medidores/${inactivo.id}/desactivar`, A.token, {});
      assert.strictEqual(baja.status, 200, JSON.stringify(baja.cuerpo));
      const deInactiva = await medidor(mInactiva.id, { nombre: 'De máquina inactiva' });
      await client.query('UPDATE maquinas SET activo = FALSE WHERE id = $1', [mInactiva.id]);

      // Alfa: una tarea activa, una inactiva y una de un plan inactivo
      const R = await responsable();
      const plan = await crearPlan(a1.id, [tareaUso('Cambiar aceite', alfa.id), tareaUso('Engrasar', alfa.id)], { responsable_usuario_id: R.id });
      await client.query('UPDATE plan_tareas SET activo = FALSE WHERE id = $1', [Number(plan.tareas[1].id)]);
      const planInactivo = await crearPlan(a1.id, [tareaUso('Revisar correas', alfa.id)], { responsable_usuario_id: R.id });
      await apagar(planInactivo.id);
      // El de B1, atrasado: con una tarea activa y la última lectura hace 8 días
      const planB = await crearPlan(b1.id, [tareaUso('Cambiar aceite', deB1.id)], { responsable_usuario_id: R.id });
      await atrasar(deB1.id, 8);
      // El de A2 no tiene lecturas: los días cuentan desde su alta
      await atrasar(deA2.id, 3);

      const pedirRonda = async (q: string, token = O.token) => {
        const r = await pedir('GET', `/api/medidores/ronda?${q}`, token);
        assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
        return r.cuerpo as any[];
      };

      // Orden de recorrida: el nombre del sector, el código de la máquina y el nombre del medidor
      const todos = await pedirRonda(`planta_id=${pl2}`);
      assert.deepStrictEqual(
        todos.map((x) => [x.sector.nombre, x.maquina.codigo, x.nombre]),
        [
          [sA.nombre, a1.codigo, 'Alfa'],
          [sA.nombre, a1.codigo, 'Zeta'],
          [sA.nombre, a2.codigo, 'Contador de ciclos'],
          [sB.nombre, b1.codigo, 'Horómetro B'],
        ],
        'Sin el inactivo ni el de la máquina inactiva'
      );
      assert.ok(!todos.some((x) => x.id === inactivo.id || x.id === deInactiva.id));

      // Cada medidor, completo
      const itemAlfa = todos[0];
      assert.strictEqual(typeof itemAlfa.ultima.registrada_en, 'string');
      assert.deepStrictEqual(itemAlfa, {
        id: alfa.id,
        nombre: 'Alfa',
        unidad: 'horas',
        lectura_cada_dias: 7,
        maquina: { id: a1.id, codigo: a1.codigo, nombre: a1.nombre },
        sector: { id: sA.id, nombre: sA.nombre },
        ultima: { valor: 100, registrada_en: itemAlfa.ultima.registrada_en },
        dias_sin_lectura: 0,
        atrasado: false,
        tareas: [
          { tarea_id: Number(plan.tareas[0].id), accion: 'Cambiar aceite', plan: { id: plan.id, nombre: plan.nombre }, estado: 'AL_DIA', proximo_uso: 500, faltan_uso: 400 },
        ],
      });
      // Sin lecturas: sin última, y los días desde el alta
      const itemA2 = todos[2];
      assert.deepStrictEqual(
        [itemA2.ultima, itemA2.dias_sin_lectura, itemA2.atrasado, itemA2.tareas, itemA2.unidad],
        [null, 3, false, [], 'ciclos']
      );
      const itemB1 = todos[3];
      assert.deepStrictEqual([itemB1.dias_sin_lectura, itemB1.atrasado, itemB1.tareas.length], [8, true, 1]);

      // Filtros
      const deSector = await pedirRonda(`sector_id=${sA.id}`);
      assert.deepStrictEqual(deSector.map((x) => x.id), [alfa.id, zeta.id, deA2.id]);
      const deMaquina = await pedirRonda(`maquina_id=${a1.id}`);
      assert.deepStrictEqual(deMaquina.map((x) => x.id), [alfa.id, zeta.id]);
      const cruzado = await pedirRonda(`sector_id=${sB.id}&maquina_id=${a1.id}`);
      assert.deepStrictEqual(cruzado, []);
      const atrasados = await pedirRonda(`planta_id=${pl2}&solo_atrasados=true`);
      assert.deepStrictEqual(atrasados.map((x) => x.id), [deB1.id]);
      const sinFiltro = await pedirRonda('solo_atrasados=false');
      assert.ok(todos.every((x) => sinFiltro.some((y) => y.id === x.id)), 'Sin filtros, están todos');

      // Ver lecturas es de todas las máquinas (D-023): G, con alcance en otro sector, ve lo mismo
      const deGestor = await pedirRonda(`planta_id=${pl2}`, G.token);
      assert.deepStrictEqual(deGestor.map((x) => x.id), todos.map((x) => x.id));

      // Un id inválido da 422
      for (const q of ['planta_id=abc', 'sector_id=0', 'maquina_id=-1', 'maquina_id=1.5']) {
        const r = await pedir('GET', `/api/medidores/ronda?${q}`, O.token);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], q);
      }
      await apagar(plan.id, planB.id);
    });

    // =========================================================================
    // LR-13: lectura_cada_dias
    // =========================================================================
    await t.test('LR-13: lectura_cada_dias', async () => {
      const m = await crearMaquina(s1);
      const alta = (extra: Record<string, unknown>) =>
        pedir('POST', '/api/medidores', A.token, { maquina_id: m.id, nombre: `Medidor ${++numeroMedidor}`, unidad: 'horas', ...extra });

      // Al crear: sin el campo queda 7
      const sin = await alta({});
      assert.deepStrictEqual([sin.status, sin.cuerpo.lectura_cada_dias], [201, 7], JSON.stringify(sin.cuerpo));
      const enBase = (await client.query('SELECT lectura_cada_dias FROM medidores WHERE id = $1', [sin.cuerpo.id])).rows[0];
      assert.strictEqual(enBase.lectura_cada_dias, 7);
      for (const mal of [0, 366, 'x', '7', 7.5, true, -1]) {
        const r = await alta({ lectura_cada_dias: mal });
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `alta con ${JSON.stringify(mal)}`);
      }
      const conNull = await alta({ lectura_cada_dias: null });
      assert.deepStrictEqual([conNull.status, conNull.cuerpo.lectura_cada_dias, conNull.cuerpo.atrasado], [201, null, false]);
      for (const borde of [1, 365]) {
        const r = await alta({ lectura_cada_dias: borde });
        assert.deepStrictEqual([r.status, r.cuerpo.lectura_cada_dias], [201, borde]);
      }

      // Al cambiarlo
      const id = Number(sin.cuerpo.id);
      const cambiar = (body: Record<string, unknown>) => pedir('PATCH', `/api/medidores/${id}`, A.token, body);
      const marcar = () => client.query('UPDATE medidores SET atraso_avisado_en = NOW() WHERE id = $1', [id]);
      for (const mal of [0, 366, 'x', 7.5]) {
        const r = await cambiar({ lectura_cada_dias: mal });
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `cambio a ${JSON.stringify(mal)}`);
      }

      await marcar();
      // Otro campo, o el mismo valor, no limpian la marca
      const soloNombre = await cambiar({ nombre: 'Horómetro principal' });
      assert.deepStrictEqual([soloNombre.status, soloNombre.cuerpo.lectura_cada_dias], [200, 7]);
      const mismo = await cambiar({ lectura_cada_dias: 7 });
      assert.strictEqual(mismo.status, 200);
      assert.ok((await avisadoEn(id)) !== null, 'Sin cambiarlo, la marca sigue');

      const a14 = await cambiar({ lectura_cada_dias: 14 });
      assert.deepStrictEqual([a14.status, a14.cuerpo.lectura_cada_dias, a14.cuerpo.nombre], [200, 14, 'Horómetro principal']);
      assert.strictEqual(await avisadoEn(id), null, 'Al cambiarlo, se limpia atraso_avisado_en');

      await marcar();
      const aNull = await cambiar({ lectura_cada_dias: null });
      assert.deepStrictEqual([aNull.status, aNull.cuerpo.lectura_cada_dias], [200, null]);
      assert.strictEqual(await avisadoEn(id), null);

      // El operario carga lecturas, pero no gestiona medidores
      const deOperario = await pedir('PATCH', `/api/medidores/${id}`, O.token, { lectura_cada_dias: 10 });
      assert.deepStrictEqual([deOperario.status, deOperario.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);
    });

    // =========================================================================
    // LR-14: Concurrencia
    // =========================================================================
    await t.test('LR-14: Dos rondas a la vez sobre el mismo medidor, seis vueltas', async () => {
      const R = await responsable();
      const m = await crearMaquina(s1);
      const med = await medidor(m.id, { lectura_inicial: 490 });
      const plan = await crearPlan(m.id, [tareaUso('Cambiar aceite', med.id)], { responsable_usuario_id: R.id });

      // Valores crecientes: 491 y 492, 493 y 494... La tarea pasa de próxima a vencida en el camino
      const guardados: number[] = [490];
      for (let vuelta = 1; vuelta <= 6; vuelta++) {
        const v1 = 490 + vuelta * 2 - 1;
        const v2 = v1 + 1;
        const [r1, r2] = await Promise.all([
          ronda([{ medidor_id: med.id, valor: v1 }], O.token),
          ronda([{ medidor_id: med.id, valor: v2 }], A.token),
        ]);
        for (const r of [r1, r2]) {
          assert.strictEqual(r.status, 200, `Vuelta ${vuelta}: ${r.status} ${JSON.stringify(r.cuerpo)}`);
          const res = r.cuerpo.resultados[0];
          assert.ok(
            res.ok === true || ['LECTURA_MENOR', 'RECURSO_OCUPADO'].includes(res.codigo),
            `Vuelta ${vuelta}: ${JSON.stringify(res)}`
          );
        }
        assert.ok(
          r1.cuerpo.resultados[0].ok || r2.cuerpo.resultados[0].ok,
          `Vuelta ${vuelta}: al menos una se guarda`
        );
        if (r1.cuerpo.resultados[0].ok) guardados.push(v1);
        if (r2.cuerpo.resultados[0].ok) guardados.push(v2);
        const valores = await valoresDe(med.id);
        const ordenados = [...valores].sort((a, b) => a - b);
        assert.deepStrictEqual(valores, ordenados, `Vuelta ${vuelta}: las lecturas que quedan nunca bajan`);
      }

      // Quedan exactamente las que dieron ok
      assert.deepStrictEqual(await valoresDe(med.id), guardados.sort((a, b) => a - b));
      // Los avisos no se repiten: como mucho, uno por próxima y uno por vencida
      const avisos = await avisosDe(R.id, TIPO_VENCIMIENTO);
      assert.ok(avisos.length <= 2, `Avisos sin repetir (${avisos.length})`);
      assert.strictEqual(new Set(avisos.map((a) => a.mensaje)).size, avisos.length);
      const filas = (await client.query(
        `SELECT estado, ciclo, count(*)::int AS n FROM avisos_vencimiento WHERE plan_tarea_id = $1 GROUP BY 1, 2`,
        [Number(plan.tareas[0].id)]
      )).rows;
      assert.ok(filas.every((f) => f.n === 1), 'Un aviso por vencimiento');
      await apagar(plan.id);
    });
  } finally {
    client = await clienteSano(client);
    // Limpieza: lo que creó esta prueba, y los avisos de esta corrida
    try {
      await client.query('DROP TRIGGER IF EXISTS trg_test_lr08 ON avisos_vencimiento');
      await client.query('DROP FUNCTION IF EXISTS trg_fn_test_lr08()');

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
