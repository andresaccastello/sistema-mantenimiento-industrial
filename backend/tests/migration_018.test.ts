import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pool } from '../functions/db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 018 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

interface Base {
  plantaId: number;
  sectorId: number;
  maquinaId: number;
  maquina2Id: number;
  usuarioId: number;
  tipoPreventivoId: number;
}

/**
 * Crea una planta, un sector, dos máquinas y un usuario. Dentro de una transacción
 * se revierte con ROLLBACK; fuera, lo borra borrarBase.
 */
async function crearBase(client: pg.PoolClient): Promise<Base> {
  const suf = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const resPerfil = await client.query(`SELECT id FROM perfiles WHERE nombre = 'OPERARIO'`);
  const resTipo = await client.query(`SELECT id FROM tipos_intervencion WHERE codigo = 'PREVENTIVO'`);

  const plantaId = Number((await client.query(
    'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`PL_M18_${suf}`]
  )).rows[0].id);
  const sectorId = Number((await client.query(
    'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`S_M18_${suf}`, plantaId]
  )).rows[0].id);
  const maquinaId = Number((await client.query(
    'INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, TRUE) RETURNING id',
    [`M18A_${suf}`, `Maquina M18 A ${suf}`, sectorId]
  )).rows[0].id);
  const maquina2Id = Number((await client.query(
    'INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, TRUE) RETURNING id',
    [`M18B_${suf}`, `Maquina M18 B ${suf}`, sectorId]
  )).rows[0].id);
  const usuarioId = Number((await client.query(
    `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
     VALUES ($1, 'Persona', 'M18', 'x', $2, TRUE, 1) RETURNING id`,
    [`U_M18_${suf}`, resPerfil.rows[0].id]
  )).rows[0].id);

  return { plantaId, sectorId, maquinaId, maquina2Id, usuarioId, tipoPreventivoId: Number(resTipo.rows[0].id) };
}

/** Borra todo lo que cuelga de la base de la prueba. */
async function borrarBase(client: pg.PoolClient, b: Base) {
  const maquinas = [b.maquinaId, b.maquina2Id];
  await client.query(
    `DELETE FROM intervencion_tareas WHERE intervencion_id IN (SELECT id FROM intervenciones WHERE maquina_id = ANY($1))`,
    [maquinas]
  );
  await client.query('DELETE FROM intervenciones WHERE maquina_id = ANY($1)', [maquinas]);
  await client.query(
    'DELETE FROM plan_tareas WHERE plan_id IN (SELECT id FROM planes_mantenimiento WHERE maquina_id = ANY($1))',
    [maquinas]
  );
  await client.query('DELETE FROM planes_mantenimiento WHERE maquina_id = ANY($1)', [maquinas]);
  await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [maquinas]);
  await client.query('DELETE FROM sectores WHERE id = $1', [b.sectorId]);
  await client.query('DELETE FROM plantas WHERE id = $1', [b.plantaId]);
  await client.query('DELETE FROM usuarios WHERE id = $1', [b.usuarioId]);
}

async function crearPlan(client: pg.PoolClient, b: Base, nombre: string, maquinaId = b.maquinaId, anticipacion = 7) {
  return Number((await client.query(
    `INSERT INTO planes_mantenimiento (maquina_id, nombre, anticipacion_dias, creado_por_usuario_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [maquinaId, nombre, anticipacion, b.usuarioId]
  )).rows[0].id);
}

async function crearTarea(
  client: pg.PoolClient,
  planId: number,
  orden: number,
  primeraFecha: string,
  frecuencia: { valor: number; unidad: string } = { valor: 1, unidad: 'MESES' }
) {
  return Number((await client.query(
    `INSERT INTO plan_tareas (plan_id, orden, accion, frecuencia_valor, frecuencia_unidad, primera_fecha)
     VALUES ($1, $2, $3, $4, $5, $6::date) RETURNING id`,
    [planId, orden, `Tarea M18 ${orden}`, frecuencia.valor, frecuencia.unidad, primeraFecha]
  )).rows[0].id);
}

/**
 * Una intervención preventiva del plan. FINALIZADA lleva sus fechas, con la
 * finalización en `fin` (con zona horaria). `eliminada` la da de baja lógica.
 */
async function crearIntervencion(
  client: pg.PoolClient,
  b: Base,
  planId: number,
  estado: 'PENDIENTE' | 'EN_PROCESO' | 'FINALIZADA' | 'CANCELADA',
  opciones: { fin?: string; eliminada?: boolean; maquinaId?: number } = {}
) {
  const fin = opciones.fin ?? '2026-03-10 12:00:00-03';
  const finalizada = estado === 'FINALIZADA';
  const res = await client.query(
    `INSERT INTO intervenciones (
       maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, plan_mantenimiento_id,
       fecha_creacion, fecha_inicio, fecha_finalizacion, trabajo_realizado, ejecucion,
       eliminado_en, eliminado_por_usuario_id, motivo_eliminacion
     ) VALUES (
       $1, $2, $3, 'Preventivo M18', $4, $5,
       CASE WHEN $6 THEN $7::timestamptz - interval '2 hours' ELSE NOW() END,
       CASE WHEN $6 THEN $7::timestamptz - interval '1 hour' ELSE NULL END,
       CASE WHEN $6 THEN $7::timestamptz ELSE NULL END,
       CASE WHEN $6 THEN 'Trabajo M18' ELSE NULL END,
       CASE WHEN $6 THEN 'INTERNA' ELSE NULL END,
       CASE WHEN $8 THEN NOW() ELSE NULL END,
       CASE WHEN $8 THEN $3::bigint ELSE NULL END,
       CASE WHEN $8 THEN 'Baja de prueba M18' ELSE NULL END
     ) RETURNING id`,
    [opciones.maquinaId ?? b.maquinaId, b.tipoPreventivoId, b.usuarioId, estado, planId, finalizada, fin, Boolean(opciones.eliminada)]
  );
  return Number(res.rows[0].id);
}

async function agregarTarea(client: pg.PoolClient, intervencionId: number, tareaId: number, hecha: boolean, usuarioId: number) {
  return Number((await client.query(
    `INSERT INTO intervencion_tareas (
       intervencion_id, plan_tarea_id, orden, accion, fecha_programada, hecha, hecha_por_usuario_id, hecha_en
     )
     SELECT $1, t.id, t.orden, t.accion, t.primera_fecha, $2,
            CASE WHEN $2 THEN $3::bigint ELSE NULL END,
            CASE WHEN $2 THEN NOW() ELSE NULL END
     FROM plan_tareas t WHERE t.id = $4
     RETURNING id`,
    [intervencionId, hecha, usuarioId, tareaId]
  )).rows[0].id);
}

/** Suma días a una fecha YYYY-MM-DD. */
function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

test('Migración 018 — Preventivos por calendario', async (t) => {
  const client = await pool.connect();

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/018_preventivos.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    // =========================================================================
    // M18-01: Aplicar
    // =========================================================================
    await t.test('M18-01: Aplicar dos veces, y reaplicar con datos no cambia nada', async () => {
      await client.query(sqlContent);
      await client.query(sqlContent);

      // Datos guardados de verdad: el COMMIT de la migración guardaría los de una transacción
      const b = await crearBase(client);
      try {
        const planId = await crearPlan(client, b, 'Plan M18-01');
        const tareaId = await crearTarea(client, planId, 1, '2026-01-15');
        const intId = await crearIntervencion(client, b, planId, 'PENDIENTE');
        const itId = await agregarTarea(client, intId, tareaId, false, b.usuarioId);

        const foto = async () => {
          const r = await client.query(
            `SELECT
               (SELECT to_jsonb(x) FROM planes_mantenimiento x WHERE x.id = $1) AS plan,
               (SELECT to_jsonb(x) FROM plan_tareas x WHERE x.id = $2) AS tarea,
               (SELECT to_jsonb(x) FROM intervencion_tareas x WHERE x.id = $3) AS tarea_intervencion,
               (SELECT to_jsonb(x) - 'hoy' - 'dias' FROM v_plan_tareas_estado x WHERE x.id = $2) AS estado`,
            [planId, tareaId, itId]
          );
          return r.rows[0];
        };
        const antes = await foto();
        assert.strictEqual(antes.estado.estado, 'EN_CURSO');

        await client.query(sqlContent);
        assert.deepStrictEqual(await foto(), antes, 'Reaplicar no cambia el plan, la tarea ni la de la intervención');
      } finally {
        await borrarBase(client, b);
      }
    });

    // =========================================================================
    // M18-02: Estructura
    // =========================================================================
    await t.test('M18-02: Estructura', async () => {
      const columnas = async (tabla: string) => {
        const r = await client.query(
          `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length,
                  numeric_precision, numeric_scale
           FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = $1`,
          [tabla]
        );
        const mapa: Record<string, any> = {};
        for (const c of r.rows) mapa[c.column_name] = c;
        return mapa;
      };

      // configuracion_sistema.zona_horaria
      const conf = await columnas('configuracion_sistema');
      assert.strictEqual(conf.zona_horaria?.data_type, 'text');
      assert.strictEqual(conf.zona_horaria.is_nullable, 'NO');
      assert.match(conf.zona_horaria.column_default, /America\/Argentina\/Buenos_Aires/);

      // planes_mantenimiento: las que quedan, las nuevas, y ninguna de las seis viejas
      const planes = await columnas('planes_mantenimiento');
      assert.deepStrictEqual(
        Object.keys(planes).sort(),
        [
          'activo', 'actualizado_en', 'anticipacion_dias', 'creado_en', 'creado_por_usuario_id',
          'descripcion', 'id', 'maquina_id', 'nombre', 'responsable_usuario_id',
        ]
      );
      for (const vieja of ['criterio', 'frecuencia_valor', 'frecuencia_unidad', 'proxima_fecha', 'proximo_valor_objetivo', 'observaciones']) {
        assert.strictEqual(planes[vieja], undefined, `${vieja} no existe`);
      }
      assert.strictEqual(planes.anticipacion_dias.data_type, 'integer');
      assert.strictEqual(planes.anticipacion_dias.is_nullable, 'NO');
      assert.strictEqual(planes.anticipacion_dias.column_default, '7');
      assert.strictEqual(planes.creado_por_usuario_id.data_type, 'bigint');
      assert.strictEqual(planes.creado_por_usuario_id.is_nullable, 'NO');

      // plan_tareas
      const tareas = await columnas('plan_tareas');
      assert.deepStrictEqual(
        Object.keys(tareas).sort(),
        [
          'accion', 'activo', 'actualizado_en', 'cantidad', 'creado_en', 'detalle', 'frecuencia_unidad',
          'frecuencia_valor', 'id', 'orden', 'plan_id', 'primera_fecha', 'proveedor_id', 'repuesto_id',
        ]
      );
      assert.strictEqual(tareas.accion.character_maximum_length, 200);
      assert.strictEqual(tareas.primera_fecha.data_type, 'date');
      assert.strictEqual(tareas.cantidad.data_type, 'numeric');
      assert.strictEqual(Number(tareas.cantidad.numeric_precision), 14);
      assert.strictEqual(Number(tareas.cantidad.numeric_scale), 3);
      assert.strictEqual(tareas.activo.column_default, 'true');

      // intervencion_tareas
      const it = await columnas('intervencion_tareas');
      assert.deepStrictEqual(
        Object.keys(it).sort(),
        [
          'accion', 'detalle', 'fecha_programada', 'hecha', 'hecha_en', 'hecha_por_usuario_id', 'id',
          'intervencion_id', 'observacion', 'orden', 'plan_tarea_id',
        ]
      );
      assert.strictEqual(it.observacion.character_maximum_length, 500);
      assert.strictEqual(it.hecha.column_default, 'false');
      assert.strictEqual(it.hecha_en.data_type, 'timestamp with time zone');

      // Índices
      const indices = (await client.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename IN ('planes_mantenimiento', 'intervencion_tareas')`
      )).rows.map((r) => r.indexname);
      assert.ok(!indices.includes('idx_planes_proxima_fecha'), 'idx_planes_proxima_fecha no existe');
      assert.ok(indices.includes('uq_planes_maquina_nombre'));
      assert.ok(indices.includes('idx_intervencion_tareas_plan_tarea'));

      // La vista, con sus columnas calculadas
      const vista = await columnas('v_plan_tareas_estado');
      for (const c of ['hoy', 'ultima_ejecucion', 'proxima_fecha', 'dias', 'intervencion_en_curso_id', 'intervencion_en_curso_estado', 'estado']) {
        assert.ok(vista[c], `La vista tiene ${c}`);
      }

      // El evento nuevo de la auditoría
      const ck = await client.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ck_intervencion_auditoria_evento'`
      );
      assert.match(ck.rows[0].def, /CORRECCION_TAREA/);

      // La FK compuesta de la 002 sigue
      const fk = await client.query(`SELECT 1 FROM pg_constraint WHERE conname = 'fk_intervenciones_plan_maquina'`);
      assert.strictEqual(fk.rows.length, 1);
    });

    // =========================================================================
    // M18-03: Restricciones
    // =========================================================================
    await t.test('M18-03: Restricciones', async () => {
      await client.query('BEGIN');
      try {
        const b = await crearBase(client);
        const planId = await crearPlan(client, b, 'Lubricación');
        const repuestoId = Number((await client.query(
          `INSERT INTO repuestos (nombre, codigo) VALUES ('Repuesto M18', $1) RETURNING id`,
          [`R_M18_${Date.now()}`]
        )).rows[0].id);
        let orden = 10;

        const insertarTarea = (campos: { valor: number; unidad: string; repuesto_id?: number | null; cantidad?: number | null }) =>
          client.query(
            `INSERT INTO plan_tareas (plan_id, orden, accion, frecuencia_valor, frecuencia_unidad, primera_fecha, repuesto_id, cantidad)
             VALUES ($1, $2, 'Tarea M18-03', $3, $4, '2026-01-01', $5, $6) RETURNING id`,
            [planId, orden++, campos.valor, campos.unidad, campos.repuesto_id ?? null, campos.cantidad ?? null]
          );

        const rechaza = async (nombre: string, hacer: () => Promise<unknown>, regex: RegExp) => {
          await client.query('SAVEPOINT caso');
          await assert.rejects(hacer(), regex, nombre);
          await client.query('ROLLBACK TO SAVEPOINT caso');
        };

        // Frecuencias
        await rechaza('0 días', () => insertarTarea({ valor: 0, unidad: 'DIAS' }), /ck_plan_tareas_frecuencia/);
        await rechaza('3651 días', () => insertarTarea({ valor: 3651, unidad: 'DIAS' }), /ck_plan_tareas_frecuencia/);
        await rechaza('121 meses', () => insertarTarea({ valor: 121, unidad: 'MESES' }), /ck_plan_tareas_frecuencia/);
        await rechaza('11 años', () => insertarTarea({ valor: 11, unidad: 'ANIOS' }), /ck_plan_tareas_frecuencia/);
        await rechaza('unidad HORAS', () => insertarTarea({ valor: 10, unidad: 'HORAS' }), /ck_plan_tareas_unidad/);

        // Repuesto y cantidad
        await rechaza('repuesto sin cantidad', () => insertarTarea({ valor: 1, unidad: 'MESES', repuesto_id: repuestoId }), /ck_plan_tareas_repuesto_cantidad/);
        await rechaza('cantidad sin repuesto', () => insertarTarea({ valor: 1, unidad: 'MESES', cantidad: 2 }), /ck_plan_tareas_repuesto_cantidad/);

        // hecha, quién y cuándo
        const tareaId = Number((await insertarTarea({ valor: 1, unidad: 'MESES' })).rows[0].id);
        const intId = await crearIntervencion(client, b, planId, 'PENDIENTE');
        const insertarHecha = (hecha: boolean, porId: number | null, en: string | null) =>
          client.query(
            `INSERT INTO intervencion_tareas (intervencion_id, plan_tarea_id, orden, accion, fecha_programada, hecha, hecha_por_usuario_id, hecha_en)
             VALUES ($1, $2, 1, 'Tarea M18-03', '2026-01-01', $3, $4, $5::timestamptz)`,
            [intId, tareaId, hecha, porId, en]
          );
        await rechaza('hecha sin hecha_en', () => insertarHecha(true, b.usuarioId, null), /ck_intervencion_tareas_hecha/);
        await rechaza('hecha_en sin hecha', () => insertarHecha(false, null, '2026-01-02T10:00:00Z'), /ck_intervencion_tareas_hecha/);

        // La misma tarea dos veces en una intervención
        await insertarHecha(false, null, null);
        await rechaza('la misma tarea dos veces', () => insertarHecha(false, null, null), /uq_intervencion_tareas_tarea/);

        // Nombre repetido en la máquina, sin importar mayúsculas
        await rechaza('"lubricación" en la misma máquina', () => crearPlan(client, b, 'lubricación'), /uq_planes_maquina_nombre/);

        // Anticipación
        await rechaza('anticipación 91', () => crearPlan(client, b, 'Plan anticipación', b.maquinaId, 91), /ck_planes_anticipacion/);

        // Se aceptan
        const otro = await crearPlan(client, b, 'lubricación', b.maquina2Id);
        assert.ok(otro > 0, 'El mismo nombre en otra máquina');
        const r120 = await insertarTarea({ valor: 120, unidad: 'MESES' });
        assert.ok(Number(r120.rows[0].id) > 0, '120 meses');
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // =========================================================================
    // M18-04: Planes con el formato viejo
    // =========================================================================
    await t.test('M18-04: Un plan con el formato viejo hace fallar la migración', async () => {
      let b: Base | null = null;
      let planId: number | null = null;
      await client.query('BEGIN');
      try {
        b = await crearBase(client);
        await client.query('ALTER TABLE planes_mantenimiento ADD COLUMN criterio VARCHAR(30)');
        planId = await crearPlan(client, b, 'Plan viejo M18');
        const idEsperado = String(planId);

        await assert.rejects(client.query(sqlContent), (err: Error) => {
          assert.match(err.message, /Hay planes de mantenimiento con el formato viejo: .*Revisarlos antes de migrar\./);
          assert.ok(
            err.message.split(/[:.]/)[1].split(',').map((s) => s.trim()).includes(idEsperado),
            `El mensaje nombra el plan ${idEsperado}: ${err.message}`
          );
          return true;
        });
      } finally {
        await client.query('ROLLBACK');
      }

      // El ROLLBACK saca la columna y los datos. Si la migración no hubiera fallado,
      // su COMMIT los habría guardado: se borran, se reaplica y la prueba falla.
      const resCol = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'planes_mantenimiento' AND column_name = 'criterio'`
      );
      if (b) {
        const resQueda = await client.query('SELECT 1 FROM usuarios WHERE id = $1', [b.usuarioId]);
        if (resQueda.rows.length > 0) {
          await borrarBase(client, b);
          await client.query(sqlContent);
        }
        assert.strictEqual(resQueda.rows.length, 0, 'No quedan datos de la prueba');
      }
      assert.strictEqual(resCol.rows.length, 0, 'La columna criterio no volvió');
    });

    // =========================================================================
    // M18-05: El estado de una tarea
    // =========================================================================
    await t.test('M18-05: El estado de una tarea', async () => {
      const zona = await client.query('SELECT zona_horaria FROM configuracion_sistema WHERE id = 1');
      assert.strictEqual(zona.rows[0].zona_horaria, 'America/Argentina/Buenos_Aires');

      await client.query('BEGIN');
      try {
        const hoy: string = (await client.query(
          `SELECT to_char((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 'YYYY-MM-DD') AS hoy`
        )).rows[0].hoy;

        const b = await crearBase(client);
        const planId = await crearPlan(client, b, 'Plan M18-05', b.maquinaId, 7);
        let orden = 1;
        const tarea = (primera: string, frecuencia?: { valor: number; unidad: string }) =>
          crearTarea(client, planId, orden++, primera, frecuencia);

        const estado = async (tareaId: number) => {
          const r = await client.query(
            `SELECT to_char(hoy, 'YYYY-MM-DD') AS hoy,
                    to_char(ultima_ejecucion, 'YYYY-MM-DD') AS ultima,
                    to_char(proxima_fecha, 'YYYY-MM-DD') AS proxima,
                    dias, estado, intervencion_en_curso_id, intervencion_en_curso_estado
             FROM v_plan_tareas_estado WHERE id = $1`,
            [tareaId]
          );
          const x = r.rows[0];
          return {
            hoy: x.hoy,
            ultima: x.ultima,
            proxima: x.proxima,
            dias: Number(x.dias),
            estado: x.estado,
            en_curso: x.intervencion_en_curso_id === null ? null : Number(x.intervencion_en_curso_id),
            en_curso_estado: x.intervencion_en_curso_estado,
          };
        };

        // Sin ejecuciones: la próxima es la primera fecha
        const tVencida = await tarea(sumarDias(hoy, -3));
        const tHoy = await tarea(hoy);
        const t7 = await tarea(sumarDias(hoy, 7));
        const t8 = await tarea(sumarDias(hoy, 8));

        const eV = await estado(tVencida);
        assert.strictEqual(eV.hoy, hoy, 'hoy es el de Buenos Aires');
        assert.deepStrictEqual(
          { ultima: eV.ultima, proxima: eV.proxima, dias: eV.dias, estado: eV.estado, en_curso: eV.en_curso },
          { ultima: null, proxima: sumarDias(hoy, -3), dias: -3, estado: 'VENCIDA', en_curso: null }
        );
        assert.deepStrictEqual([(await estado(tHoy)).estado, (await estado(tHoy)).dias], ['PROXIMA', 0]);
        assert.deepStrictEqual([(await estado(t7)).estado, (await estado(t7)).dias], ['PROXIMA', 7]);
        assert.deepStrictEqual([(await estado(t8)).estado, (await estado(t8)).dias], ['AL_DIA', 8]);

        // En una intervención PENDIENTE: EN_CURSO. Con dos abiertas, la de menor id.
        const tCurso = await tarea(sumarDias(hoy, 100));
        const iPend = await crearIntervencion(client, b, planId, 'PENDIENTE');
        await agregarTarea(client, iPend, tCurso, false, b.usuarioId);
        const iProc = await crearIntervencion(client, b, planId, 'EN_PROCESO');
        await agregarTarea(client, iProc, tCurso, false, b.usuarioId);
        const eC = await estado(tCurso);
        assert.deepStrictEqual([eC.estado, eC.en_curso, eC.en_curso_estado], ['EN_CURSO', Math.min(iPend, iProc), 'PENDIENTE']);

        // Finalizada con la tarea hecha el 31/01, cada 1 mes: el 28/02, o el 29/02
        const tMes = await tarea('2026-01-01', { valor: 1, unidad: 'MESES' });
        const iMes = await crearIntervencion(client, b, planId, 'FINALIZADA', { fin: '2027-01-31 12:00:00-03' });
        await agregarTarea(client, iMes, tMes, true, b.usuarioId);
        const eM = await estado(tMes);
        assert.deepStrictEqual([eM.ultima, eM.proxima], ['2027-01-31', '2027-02-28']);

        const tBis = await tarea('2026-01-01', { valor: 1, unidad: 'MESES' });
        const iBis = await crearIntervencion(client, b, planId, 'FINALIZADA', { fin: '2028-01-31 12:00:00-03' });
        await agregarTarea(client, iBis, tBis, true, b.usuarioId);
        const eB = await estado(tBis);
        assert.deepStrictEqual([eB.ultima, eB.proxima], ['2028-01-31', '2028-02-29']);

        // La última ejecución es la mayor, y cuenta desde ella
        const tDos = await tarea('2025-01-01', { valor: 2, unidad: 'SEMANAS' });
        const iDos1 = await crearIntervencion(client, b, planId, 'FINALIZADA', { fin: '2025-06-10 12:00:00-03' });
        await agregarTarea(client, iDos1, tDos, true, b.usuarioId);
        const iDos2 = await crearIntervencion(client, b, planId, 'FINALIZADA', { fin: '2025-05-01 12:00:00-03' });
        await agregarTarea(client, iDos2, tDos, true, b.usuarioId);
        const eD = await estado(tDos);
        assert.deepStrictEqual([eD.ultima, eD.proxima], ['2025-06-10', '2025-06-24']);

        // Finalizada sin la tarea hecha: no cuenta
        const tSin = await tarea(sumarDias(hoy, -3));
        const iSin = await crearIntervencion(client, b, planId, 'FINALIZADA');
        await agregarTarea(client, iSin, tSin, false, b.usuarioId);
        const eS = await estado(tSin);
        assert.deepStrictEqual([eS.ultima, eS.proxima, eS.estado], [null, sumarDias(hoy, -3), 'VENCIDA']);

        // Cancelada, con la tarea hecha: no cuenta, y no está en curso
        const tCanc = await tarea(sumarDias(hoy, -3));
        const iCanc = await crearIntervencion(client, b, planId, 'CANCELADA');
        await agregarTarea(client, iCanc, tCanc, true, b.usuarioId);
        const eCa = await estado(tCanc);
        assert.deepStrictEqual([eCa.ultima, eCa.estado, eCa.en_curso], [null, 'VENCIDA', null]);

        // Eliminada: ni la finalizada cuenta, ni la pendiente la deja en curso
        const tElim = await tarea(sumarDias(hoy, -3));
        const iElimF = await crearIntervencion(client, b, planId, 'FINALIZADA', { eliminada: true });
        await agregarTarea(client, iElimF, tElim, true, b.usuarioId);
        const iElimP = await crearIntervencion(client, b, planId, 'PENDIENTE', { eliminada: true });
        await agregarTarea(client, iElimP, tElim, false, b.usuarioId);
        const eE = await estado(tElim);
        assert.deepStrictEqual([eE.ultima, eE.estado, eE.en_curso], [null, 'VENCIDA', null]);

        // Una finalización a las 23:30 de Buenos Aires, que en UTC ya es el día siguiente
        const tNoche = await tarea('2026-01-01', { valor: 1, unidad: 'DIAS' });
        const iNoche = await crearIntervencion(client, b, planId, 'FINALIZADA', { fin: '2026-03-10 23:30:00-03' });
        await agregarTarea(client, iNoche, tNoche, true, b.usuarioId);
        const eN = await estado(tNoche);
        assert.deepStrictEqual([eN.ultima, eN.proxima], ['2026-03-10', '2026-03-11']);

        // INACTIVA: la tarea, el plan o la máquina
        const tInactiva = await tarea(sumarDias(hoy, -3));
        await client.query('UPDATE plan_tareas SET activo = FALSE WHERE id = $1', [tInactiva]);
        assert.strictEqual((await estado(tInactiva)).estado, 'INACTIVA', 'Tarea inactiva');

        const planInactivo = await crearPlan(client, b, 'Plan inactivo M18-05');
        const tPlanInactivo = await crearTarea(client, planInactivo, 1, sumarDias(hoy, -3));
        await client.query('UPDATE planes_mantenimiento SET activo = FALSE WHERE id = $1', [planInactivo]);
        assert.strictEqual((await estado(tPlanInactivo)).estado, 'INACTIVA', 'Plan inactivo');

        const planM2 = await crearPlan(client, b, 'Plan máquina inactiva M18-05', b.maquina2Id);
        const tMaqInactiva = await crearTarea(client, planM2, 1, sumarDias(hoy, -3));
        const iMaq = await crearIntervencion(client, b, planM2, 'PENDIENTE', { maquinaId: b.maquina2Id });
        await agregarTarea(client, iMaq, tMaqInactiva, false, b.usuarioId);
        await client.query('UPDATE maquinas SET activo = FALSE WHERE id = $1', [b.maquina2Id]);
        assert.strictEqual((await estado(tMaqInactiva)).estado, 'INACTIVA', 'Máquina inactiva, aun con una intervención en curso');
      } finally {
        await client.query('ROLLBACK');
      }
    });
  } finally {
    client.release();
  }
});
