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
          'accion', 'activo', 'actualizado_en', 'creado_en', 'detalle', 'frecuencia_unidad',
          'frecuencia_valor', 'id', 'medidor_id', 'orden', 'plan_id', 'primera_fecha', 'proveedor_id',
          'uso_anticipacion', 'uso_cada', 'uso_primera',
        ]
      );
      assert.strictEqual(tareas.accion.character_maximum_length, 200);
      assert.strictEqual(tareas.primera_fecha.data_type, 'date');
      assert.strictEqual(tareas.activo.column_default, 'true');

      // intervencion_tareas
      const it = await columnas('intervencion_tareas');
      assert.deepStrictEqual(
        Object.keys(it).sort(),
        [
          'accion', 'detalle', 'fecha_programada', 'hecha', 'hecha_en', 'hecha_por_usuario_id', 'id',
          'intervencion_id', 'medidor_id', 'observacion', 'orden', 'plan_tarea_id', 'uso_programado', 'valor_medidor',
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

      // hoy_instalacion() existe y da lo mismo que la fecha local de la zona configurada (PV2, 1.3)
      const hoy = await client.query(
        `SELECT to_char(hoy_instalacion(), 'YYYY-MM-DD') AS funcion,
                to_char((now() AT TIME ZONE zona_horaria)::date, 'YYYY-MM-DD') AS esperado,
                pg_typeof(hoy_instalacion())::text AS tipo
         FROM configuracion_sistema WHERE id = 1`
      );
      assert.strictEqual(hoy.rows[0].tipo, 'date');
      assert.strictEqual(hoy.rows[0].funcion, hoy.rows[0].esperado);
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

        const insertarTarea = (campos: { valor: number; unidad: string }) =>
          client.query(
            `INSERT INTO plan_tareas (plan_id, orden, accion, frecuencia_valor, frecuencia_unidad, primera_fecha)
             VALUES ($1, $2, 'Tarea M18-03', $3, $4, '2026-01-01') RETURNING id`,
            [planId, orden++, campos.valor, campos.unidad]
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

        // Los previstos del plan (PV2.2, 2.1)
        const insertarPrevistoPlan = (repId: number, cantidad: number) =>
          client.query(
            'INSERT INTO plan_tarea_repuestos (plan_tarea_id, repuesto_id, cantidad, orden) VALUES ($1, $2, $3, 1)',
            [tareaId, repId, cantidad]
          );
        await rechaza('previsto del plan con cantidad 0', () => insertarPrevistoPlan(repuestoId, 0), /ck_plan_tarea_repuestos_cantidad/);
        await insertarPrevistoPlan(repuestoId, 2);
        await rechaza('el mismo repuesto dos veces en la tarea', () => insertarPrevistoPlan(repuestoId, 1), /uq_plan_tarea_repuestos_repuesto/);

        // Los previstos de la intervención (PV2.2, 2.3)
        const repuesto2Id = Number((await client.query(
          `INSERT INTO repuestos (nombre, codigo) VALUES ('Repuesto M18 B', $1) RETURNING id`,
          [`R2_M18_${Date.now()}`]
        )).rows[0].id);
        const intTareaId = Number((await client.query(
          'SELECT id FROM intervencion_tareas WHERE intervencion_id = $1 AND plan_tarea_id = $2', [intId, tareaId]
        )).rows[0].id);
        const consumoId = Number((await client.query(
          `INSERT INTO intervencion_repuestos (intervencion_id, repuesto_id, cantidad, costo_unitario_aplicado, registrado_por_usuario_id)
           VALUES ($1, $2, 1, 0, $3) RETURNING id`,
          [intId, repuestoId, b.usuarioId]
        )).rows[0].id);
        const insertarPrevistoInt = (repId: number, cantidad: number, consumo: number | null) =>
          client.query(
            `INSERT INTO intervencion_tarea_repuestos (intervencion_tarea_id, repuesto_id, cantidad_prevista, orden, consumo_id)
             VALUES ($1, $2, $3, 1, $4)`,
            [intTareaId, repId, cantidad, consumo]
          );
        await rechaza('previsto de la intervención con cantidad 0', () => insertarPrevistoInt(repuestoId, 0, null), /ck_intervencion_tarea_repuestos_cantidad/);
        await insertarPrevistoInt(repuestoId, 2, consumoId);
        await rechaza('el mismo repuesto dos veces en la tarea de la intervención', () => insertarPrevistoInt(repuestoId, 1, null), /uq_intervencion_tarea_repuestos_repuesto/);
        await rechaza('el mismo consumo en dos previstos', () => insertarPrevistoInt(repuesto2Id, 1, consumoId), /uq_intervencion_tarea_repuestos_consumo/);

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

    // =========================================================================
    // M18-06: Con el formato de la PV1
    // =========================================================================
    await t.test('M18-06: Una tarea con el formato de la PV1 pasa a la lista de previstos', async () => {
      // La migración trae su BEGIN y su COMMIT: sin ellos corre dentro del ROLLBACK de la prueba
      const sinTransaccion = sqlContent.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
      assert.ok(!/^COMMIT;/m.test(sinTransaccion), 'Sin COMMIT');

      const columnasViejas = async () =>
        (await client.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'plan_tareas' AND column_name IN ('repuesto_id', 'cantidad')`
        )).rows.length;

      let tareaCon = 0;
      await client.query('BEGIN');
      try {
        const b = await crearBase(client);
        const planId = await crearPlan(client, b, 'Plan formato PV1');
        const repuestoId = Number((await client.query(
          `INSERT INTO repuestos (nombre, codigo) VALUES ('Repuesto M18-06', $1) RETURNING id`,
          [`R_M1806_${Date.now()}`]
        )).rows[0].id);

        await client.query(
          `ALTER TABLE plan_tareas
             ADD COLUMN repuesto_id BIGINT NULL REFERENCES repuestos(id),
             ADD COLUMN cantidad NUMERIC(14,3) NULL,
             ADD CONSTRAINT ck_plan_tareas_cantidad CHECK (cantidad IS NULL OR cantidad > 0),
             ADD CONSTRAINT ck_plan_tareas_repuesto_cantidad CHECK ((repuesto_id IS NULL) = (cantidad IS NULL))`
        );
        tareaCon = await crearTarea(client, planId, 1, '2026-01-15');
        const tareaSin = await crearTarea(client, planId, 2, '2026-01-15');
        await client.query('UPDATE plan_tareas SET repuesto_id = $1, cantidad = 2.5 WHERE id = $2', [repuestoId, tareaCon]);

        await client.query(sinTransaccion);

        const previstos = await client.query(
          'SELECT plan_tarea_id, repuesto_id, cantidad, orden FROM plan_tarea_repuestos WHERE plan_tarea_id = ANY($1)',
          [[tareaCon, tareaSin]]
        );
        assert.deepStrictEqual(previstos.rows, [
          { plan_tarea_id: String(tareaCon), repuesto_id: String(repuestoId), cantidad: '2.500', orden: 1 },
        ]);
        assert.strictEqual(await columnasViejas(), 0, 'Sin las dos columnas');
        const ck = await client.query(
          `SELECT conname FROM pg_constraint
           WHERE conrelid = 'plan_tareas'::regclass AND conname IN ('ck_plan_tareas_cantidad', 'ck_plan_tareas_repuesto_cantidad')`
        );
        assert.strictEqual(ck.rows.length, 0, 'Sin sus restricciones');
        const vista = await client.query('SELECT id FROM v_plan_tareas_estado WHERE id = ANY($1)', [[tareaCon, tareaSin]]);
        assert.strictEqual(vista.rows.length, 2, 'La vista se volvió a crear');
      } finally {
        await client.query('ROLLBACK');
      }

      const queda = await client.query('SELECT 1 FROM plan_tareas WHERE id = $1', [tareaCon]);
      assert.strictEqual(queda.rows.length, 0, 'El ROLLBACK sacó los datos');
      assert.strictEqual(await columnasViejas(), 0);
    });

    // -------------------------------------------------------------------------
    // Helpers de los medidores (PV3)
    // -------------------------------------------------------------------------
    const crearMedidor = async (b: Base, nombre = 'Horómetro', maquinaId = b.maquinaId) =>
      Number((await client.query(
        `INSERT INTO medidores (maquina_id, nombre, unidad, creado_por_usuario_id) VALUES ($1, $2, 'horas', $3) RETURNING id`,
        [maquinaId, nombre, b.usuarioId]
      )).rows[0].id);

    const crearLectura = async (b: Base, medidorId: number, valor: number) =>
      Number((await client.query(
        `INSERT INTO lecturas_medidor (medidor_id, valor, registrada_por_usuario_id, origen) VALUES ($1, $2, $3, 'MANUAL') RETURNING id`,
        [medidorId, valor, b.usuarioId]
      )).rows[0].id);

    /** Una tarea del plan por uso; con `primeraFecha`, también por fecha. */
    const crearTareaUso = async (
      planId: number,
      orden: number,
      medidorId: number,
      uso: { cada: number; primera: number; anticipacion: number },
      primeraFecha: string | null = null
    ) =>
      Number((await client.query(
        `INSERT INTO plan_tareas (
           plan_id, orden, accion, frecuencia_valor, frecuencia_unidad, primera_fecha,
           medidor_id, uso_cada, uso_primera, uso_anticipacion
         ) VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10) RETURNING id`,
        [
          planId, orden, `Tarea uso M18 ${orden}`,
          primeraFecha === null ? null : 6, primeraFecha === null ? null : 'MESES', primeraFecha,
          medidorId, uso.cada, uso.primera, uso.anticipacion,
        ]
      )).rows[0].id);

    /** La tarea en una intervención, con su medidor y, si está hecha, su valor. */
    const agregarTareaUso = async (
      intervencionId: number,
      tareaId: number,
      usuarioId: number,
      medidorId: number,
      valor: number | null
    ) =>
      Number((await client.query(
        `INSERT INTO intervencion_tareas (
           intervencion_id, plan_tarea_id, orden, accion, medidor_id, uso_programado, valor_medidor,
           hecha, hecha_por_usuario_id, hecha_en
         )
         SELECT $1, t.id, t.orden, t.accion, $2::bigint, 500, $3::numeric,
                $4::boolean, CASE WHEN $4::boolean THEN $5::bigint ELSE NULL END, CASE WHEN $4::boolean THEN NOW() ELSE NULL END
         FROM plan_tareas t WHERE t.id = $6
         RETURNING id`,
        [intervencionId, medidorId, valor, valor !== null, usuarioId, tareaId]
      )).rows[0].id);

    const USO_250 = { cada: 250, primera: 500, anticipacion: 25 };

    // =========================================================================
    // M18-07: Estructura de los medidores
    // =========================================================================
    await t.test('M18-07: Estructura', async () => {
      const columnas = async (tabla: string) => {
        const r = await client.query(
          `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale
           FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = $1`,
          [tabla]
        );
        const mapa: Record<string, any> = {};
        for (const c of r.rows) mapa[c.column_name] = c;
        return mapa;
      };
      const numerico = (c: any, nullable: string) =>
        assert.deepStrictEqual([c?.data_type, c?.numeric_precision, c?.numeric_scale, c?.is_nullable], ['numeric', 14, 2, nullable]);

      const med = await columnas('medidores');
      assert.deepStrictEqual(
        Object.keys(med).sort(),
        ['activo', 'actualizado_en', 'creado_en', 'creado_por_usuario_id', 'id', 'maquina_id', 'nombre', 'unidad']
      );
      assert.deepStrictEqual([med.id.data_type, med.maquina_id.is_nullable], ['bigint', 'NO']);
      assert.deepStrictEqual([med.nombre.character_maximum_length, med.nombre.is_nullable], [60, 'NO']);
      assert.deepStrictEqual([med.unidad.character_maximum_length, med.unidad.is_nullable], [20, 'NO']);
      assert.deepStrictEqual([med.activo.is_nullable, med.activo.column_default], ['NO', 'true']);
      assert.strictEqual(med.creado_por_usuario_id.is_nullable, 'NO');

      const lec = await columnas('lecturas_medidor');
      assert.deepStrictEqual(
        Object.keys(lec).sort(),
        [
          'anulada_en', 'anulada_por_usuario_id', 'id', 'intervencion_tarea_id', 'medidor_id', 'motivo_anulacion',
          'observacion', 'origen', 'registrada_en', 'registrada_por_usuario_id', 'valor',
        ]
      );
      numerico(lec.valor, 'NO');
      assert.deepStrictEqual([lec.medidor_id.is_nullable, lec.registrada_por_usuario_id.is_nullable, lec.origen.is_nullable], ['NO', 'NO', 'NO']);
      assert.strictEqual(lec.registrada_en.is_nullable, 'NO');
      assert.match(lec.registrada_en.column_default, /now\(\)/);
      assert.strictEqual(lec.observacion.character_maximum_length, 200);
      for (const c of ['intervencion_tarea_id', 'anulada_en', 'anulada_por_usuario_id', 'motivo_anulacion']) {
        assert.strictEqual(lec[c].is_nullable, 'YES', c);
      }

      const indice = await client.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_lecturas_medidor_vigentes'`);
      assert.match(indice.rows[0].indexdef, /\(medidor_id, valor DESC, id DESC\) WHERE \(anulada_en IS NULL\)/);
      const unico = await client.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_medidores_maquina_nombre'`);
      assert.match(unico.rows[0].indexdef, /UNIQUE.*maquina_id, lower\(/);

      const tareas = await columnas('plan_tareas');
      for (const c of ['frecuencia_valor', 'frecuencia_unidad', 'primera_fecha']) {
        assert.strictEqual(tareas[c].is_nullable, 'YES', c);
      }
      assert.deepStrictEqual([tareas.medidor_id.data_type, tareas.medidor_id.is_nullable], ['bigint', 'YES']);
      for (const c of ['uso_cada', 'uso_primera', 'uso_anticipacion']) numerico(tareas[c], 'YES');

      const it = await columnas('intervencion_tareas');
      assert.strictEqual(it.fecha_programada.is_nullable, 'YES');
      assert.deepStrictEqual([it.medidor_id.data_type, it.medidor_id.is_nullable], ['bigint', 'YES']);
      for (const c of ['uso_programado', 'valor_medidor']) numerico(it[c], 'YES');

      const vista = await columnas('v_plan_tareas_estado');
      for (const c of ['lectura_actual', 'lectura_actual_en', 'ultimo_uso', 'proximo_uso', 'faltan_uso', 'estado_uso', 'estado_fecha']) {
        assert.ok(vista[c], `La vista tiene ${c}`);
      }

      const permiso = await client.query(
        `SELECT nombre, usa_alcance FROM permisos WHERE codigo = 'MAQUINAS_REGISTRAR_LECTURAS'`
      );
      assert.deepStrictEqual(permiso.rows, [{ nombre: 'Cargar lecturas de medidores', usa_alcance: false }]);
      const perfiles = (await client.query(
        `SELECT p.nombre FROM perfil_permiso pp
         JOIN perfiles p ON p.id = pp.perfil_id
         JOIN permisos pe ON pe.id = pp.permiso_id
         WHERE pe.codigo = 'MAQUINAS_REGISTRAR_LECTURAS'`
      )).rows.map((r) => r.nombre);
      for (const perfil of ['ADMINISTRADOR', 'RESPONSABLE_MANTENIMIENTO', 'OPERARIO']) {
        assert.ok(perfiles.includes(perfil), `Lo tiene ${perfil}`);
      }
      assert.ok(!perfiles.includes('CONSULTA'), 'CONSULTA no lo tiene');
    });

    // =========================================================================
    // M18-08: Restricciones de los medidores
    // =========================================================================
    await t.test('M18-08: Restricciones', async () => {
      await client.query('BEGIN');
      try {
        const b = await crearBase(client);
        const planId = await crearPlan(client, b, 'Plan M18-08');
        const medidorId = await crearMedidor(b);
        let orden = 1;

        const rechaza = async (nombre: string, hacer: () => Promise<unknown>, regex: RegExp) => {
          await client.query('SAVEPOINT caso');
          await assert.rejects(hacer(), regex, nombre);
          await client.query('ROLLBACK TO SAVEPOINT caso');
        };

        type CamposTarea = {
          fv?: number | null; fu?: string | null; pf?: string | null;
          med?: number | null; cada?: number | null; primera?: number | null; ant?: number | null;
        };
        const FECHA = { fv: 1, fu: 'MESES', pf: '2026-01-01' };
        const USO = { med: medidorId, cada: 250, primera: 500, ant: 25 };
        const tarea = (c: CamposTarea) =>
          client.query(
            `INSERT INTO plan_tareas (
               plan_id, orden, accion, frecuencia_valor, frecuencia_unidad, primera_fecha,
               medidor_id, uso_cada, uso_primera, uso_anticipacion
             ) VALUES ($1, $2, 'Tarea M18-08', $3, $4, $5::date, $6, $7, $8, $9) RETURNING id`,
            [planId, orden++, c.fv ?? null, c.fu ?? null, c.pf ?? null, c.med ?? null, c.cada ?? null, c.primera ?? null, c.ant ?? null]
          );

        await rechaza('sin fecha ni uso', () => tarea({}), /ck_plan_tareas_criterio/);
        await rechaza('fecha sin primera_fecha', () => tarea({ ...USO, ...FECHA, pf: null }), /ck_plan_tareas_fecha_completa/);
        await rechaza('fecha sin unidad', () => tarea({ ...USO, ...FECHA, fu: null }), /ck_plan_tareas_fecha_completa/);
        await rechaza('uso sin uso_cada', () => tarea({ ...USO, cada: null }), /ck_plan_tareas_uso_completo/);
        await rechaza('uso sin medidor', () => tarea({ ...FECHA, ...USO, med: null }), /ck_plan_tareas_uso_completo/);
        await rechaza('uso_cada 0', () => tarea({ ...USO, cada: 0, ant: 0 }), /ck_plan_tareas_uso_cada/);
        await rechaza('anticipación mayor que uso_cada', () => tarea({ ...USO, ant: 251 }), /ck_plan_tareas_uso_anticipacion/);
        await rechaza('uso_primera negativa', () => tarea({ ...USO, primera: -1 }), /ck_plan_tareas_uso_primera/);

        const lectura = (c: { valor?: number; origen?: string; tarea?: number | null; en?: string | null; por?: number | null; motivo?: string | null }) =>
          client.query(
            `INSERT INTO lecturas_medidor (
               medidor_id, valor, registrada_por_usuario_id, origen, intervencion_tarea_id,
               anulada_en, anulada_por_usuario_id, motivo_anulacion
             ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8)`,
            [medidorId, c.valor ?? 10, b.usuarioId, c.origen ?? 'MANUAL', c.tarea ?? null, c.en ?? null, c.por ?? null, c.motivo ?? null]
          );
        await rechaza('lectura negativa', () => lectura({ valor: -1 }), /ck_lecturas_medidor_valor/);
        await rechaza('origen desconocido', () => lectura({ origen: 'OTRO' }), /ck_lecturas_medidor_origen/);
        await rechaza('lectura TAREA sin tarea', () => lectura({ origen: 'TAREA' }), /ck_lecturas_medidor_tarea/);

        const soloUso = Number((await tarea(USO)).rows[0].id);
        const conLosDos = Number((await tarea({ ...FECHA, ...USO })).rows[0].id);
        assert.ok(soloUso > 0, 'Una tarea solo por uso');
        assert.ok(conLosDos > 0, 'Una tarea con los dos criterios');

        const intId = await crearIntervencion(client, b, planId, 'PENDIENTE');
        const fila = (c: { tarea?: number; fecha?: string | null; med?: number | null; prog?: number | null; valor?: number | null; hecha?: boolean }) => {
          const hecha = c.hecha ?? false;
          return client.query(
            `INSERT INTO intervencion_tareas (
               intervencion_id, plan_tarea_id, orden, accion, fecha_programada, medidor_id, uso_programado, valor_medidor,
               hecha, hecha_por_usuario_id, hecha_en
             ) VALUES ($1, $2, 1, 'Tarea M18-08', $3::date, $4, $5, $6, $7, $8, $9::timestamptz) RETURNING id`,
            [intId, c.tarea ?? soloUso, c.fecha ?? null, c.med ?? null, c.prog ?? null, c.valor ?? null, hecha, hecha ? b.usuarioId : null, hecha ? '2026-01-02T10:00:00Z' : null]
          );
        };
        const CON_MEDIDOR = { med: medidorId, prog: 500 };
        await rechaza('valor_medidor en una tarea sin hacer', () => fila({ ...CON_MEDIDOR, valor: 10 }), /ck_intervencion_tareas_valor_medidor/);
        await rechaza('valor_medidor sin medidor', () => fila({ fecha: '2026-01-01', valor: 10, hecha: true }), /ck_intervencion_tareas_valor_medidor/);
        await rechaza('hecha, con medidor y sin valor', () => fila({ ...CON_MEDIDOR, hecha: true }), /ck_intervencion_tareas_valor_medidor/);
        await rechaza('sin fecha ni medidor', () => fila({}), /ck_intervencion_tareas_criterio/);
        await rechaza('uso_programado sin medidor', () => fila({ fecha: '2026-01-01', prog: 500 }), /ck_intervencion_tareas_uso_programado/);

        const itId = Number((await fila(CON_MEDIDOR)).rows[0].id);
        await rechaza('lectura MANUAL con tarea', () => lectura({ tarea: itId }), /ck_lecturas_medidor_tarea/);
        await rechaza('anulación sin motivo', () => lectura({ en: '2026-01-02T10:00:00Z', por: b.usuarioId }), /ck_lecturas_medidor_anulacion/);
        await rechaza('anulación sin quién', () => lectura({ en: '2026-01-02T10:00:00Z', motivo: 'Mal cargada' }), /ck_lecturas_medidor_anulacion/);
        await rechaza('anulación sin fecha', () => lectura({ por: b.usuarioId, motivo: 'Mal cargada' }), /ck_lecturas_medidor_anulacion/);
        await rechaza('el mismo nombre en la máquina', () => crearMedidor(b, 'horómetro'), /uq_medidores_maquina_nombre/);

        // Se aceptan
        assert.ok((await crearMedidor(b, 'horómetro', b.maquina2Id)) > 0, 'El mismo nombre en otra máquina');
        await lectura({ origen: 'TAREA', tarea: itId });
        await lectura({ en: '2026-01-02T10:00:00Z', por: b.usuarioId, motivo: 'Mal cargada' });
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // =========================================================================
    // M18-09: El estado por uso
    // =========================================================================
    await t.test('M18-09: El estado por uso', async () => {
      await client.query('BEGIN');
      try {
        const hoy: string = (await client.query(`SELECT to_char(hoy_instalacion(), 'YYYY-MM-DD') AS hoy`)).rows[0].hoy;
        const b = await crearBase(client);
        const planId = await crearPlan(client, b, 'Plan M18-09', b.maquinaId, 7);
        let orden = 1;

        const estado = async (tareaId: number) => {
          const x = (await client.query('SELECT * FROM v_plan_tareas_estado WHERE id = $1', [tareaId])).rows[0];
          const num = (v: unknown) => (v === null ? null : Number(v));
          return {
            estado: x.estado,
            estado_uso: x.estado_uso,
            estado_fecha: x.estado_fecha,
            faltan: num(x.faltan_uso),
            ultimo: num(x.ultimo_uso),
            proximo: num(x.proximo_uso),
            lectura: num(x.lectura_actual),
            proxima_fecha: x.proxima_fecha,
            dias: x.dias,
            ultima_ejecucion: x.ultima_ejecucion,
          };
        };

        const med = await crearMedidor(b);
        const tId = await crearTareaUso(planId, orden++, med, USO_250);

        // Solo por uso: sin fecha
        const sinLecturas = await estado(tId);
        assert.deepStrictEqual(
          [sinLecturas.estado, sinLecturas.estado_uso, sinLecturas.faltan, sinLecturas.proximo, sinLecturas.lectura],
          ['SIN_LECTURA', 'SIN_LECTURA', null, 500, null]
        );
        assert.deepStrictEqual([sinLecturas.estado_fecha, sinLecturas.proxima_fecha, sinLecturas.dias], [null, null, null]);

        const conLectura = async (valor: number) => {
          const id = await crearLectura(b, med, valor);
          return { id, e: await estado(tId) };
        };
        const l400 = await conLectura(400);
        assert.deepStrictEqual([l400.e.estado, l400.e.faltan], ['AL_DIA', 100]);
        const l475 = await conLectura(475);
        assert.deepStrictEqual([l475.e.estado, l475.e.faltan], ['PROXIMA', 25]);
        const l500 = await conLectura(500);
        assert.deepStrictEqual([l500.e.estado, l500.e.faltan], ['PROXIMA', 0]);
        const l5005 = await conLectura(500.5);
        assert.deepStrictEqual([l5005.e.estado, l5005.e.faltan], ['VENCIDA', -0.5]);

        // Anular la de 500,5: vuelve a PROXIMA
        await client.query(
          `UPDATE lecturas_medidor SET anulada_en = NOW(), anulada_por_usuario_id = $1, motivo_anulacion = 'Mal cargada' WHERE id = $2`,
          [b.usuarioId, l5005.id]
        );
        const anulada = await estado(tId);
        assert.deepStrictEqual([anulada.estado, anulada.faltan, anulada.lectura], ['PROXIMA', 0, 500]);

        // Finalizada con la tarea hecha y valor_medidor 510
        const iF = await crearIntervencion(client, b, planId, 'FINALIZADA', { fin: '2026-03-10 12:00:00-03' });
        await agregarTareaUso(iF, tId, b.usuarioId, med, 510);
        const hecha = await estado(tId);
        assert.deepStrictEqual([hecha.ultimo, hecha.proximo], [510, 760]);
        assert.ok(hecha.ultima_ejecucion !== null, 'ultima_ejecucion también se calcula en una tarea solo por uso');

        // Cancelada, eliminada o sin la tarea hecha: no cuenta
        const tNoCuenta = await crearTareaUso(planId, orden++, med, USO_250);
        const iC = await crearIntervencion(client, b, planId, 'CANCELADA');
        await agregarTareaUso(iC, tNoCuenta, b.usuarioId, med, 900);
        const iE = await crearIntervencion(client, b, planId, 'FINALIZADA', { eliminada: true });
        await agregarTareaUso(iE, tNoCuenta, b.usuarioId, med, 900);
        const iS = await crearIntervencion(client, b, planId, 'FINALIZADA');
        await agregarTareaUso(iS, tNoCuenta, b.usuarioId, med, null);
        const noCuenta = await estado(tNoCuenta);
        assert.deepStrictEqual([noCuenta.ultimo, noCuenta.proximo], [null, 500], 'Cancelada, eliminada o sin hacer no cuentan');

        // Un valor_medidor de otro medidor no cuenta
        const otro = await crearMedidor(b, 'Horómetro viejo');
        const tOtro = await crearTareaUso(planId, orden++, med, USO_250);
        const iO = await crearIntervencion(client, b, planId, 'FINALIZADA');
        await agregarTareaUso(iO, tOtro, b.usuarioId, otro, 900);
        assert.deepStrictEqual([(await estado(tOtro)).ultimo, (await estado(tOtro)).proximo], [null, 500], 'El de otro medidor no cuenta');

        // El medidor inactivo: INACTIVA
        const inactivo = await crearMedidor(b, 'Contador inactivo');
        const tInactiva = await crearTareaUso(planId, orden++, inactivo, USO_250);
        await client.query('UPDATE medidores SET activo = FALSE WHERE id = $1', [inactivo]);
        assert.strictEqual((await estado(tInactiva)).estado, 'INACTIVA', 'El medidor inactivo');

        // Combinadas: con el plan de anticipación 7 días, y un medidor con su lectura
        const combinada = async (nombre: string, lectura: number | null, fecha: string) => {
          const m = await crearMedidor(b, nombre);
          if (lectura !== null) await crearLectura(b, m, lectura);
          return estado(await crearTareaUso(planId, orden++, m, USO_250, fecha));
        };
        const lejos = '2099-01-01';
        const fv = new Date(`${hoy}T00:00:00Z`);
        fv.setUTCDate(fv.getUTCDate() - 3);
        const vencida = fv.toISOString().slice(0, 10);
        const fp = new Date(`${hoy}T00:00:00Z`);
        fp.setUTCDate(fp.getUTCDate() + 3);
        const proxima = fp.toISOString().slice(0, 10);

        const c1 = await combinada('Combinada 1', 600, lejos);
        assert.deepStrictEqual([c1.estado_fecha, c1.estado_uso, c1.estado], ['AL_DIA', 'VENCIDA', 'VENCIDA']);
        const c2 = await combinada('Combinada 2', 100, vencida);
        assert.deepStrictEqual([c2.estado_fecha, c2.estado_uso, c2.estado], ['VENCIDA', 'AL_DIA', 'VENCIDA']);
        const c3 = await combinada('Combinada 3', null, proxima);
        assert.deepStrictEqual([c3.estado_fecha, c3.estado_uso, c3.estado], ['PROXIMA', 'SIN_LECTURA', 'PROXIMA']);
        const c4 = await combinada('Combinada 4', null, lejos);
        assert.deepStrictEqual([c4.estado_fecha, c4.estado_uso, c4.estado], ['AL_DIA', 'SIN_LECTURA', 'SIN_LECTURA']);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // =========================================================================
    // M18-10: Reaplicar con datos
    // =========================================================================
    await t.test('M18-10: Reaplicar con datos', async () => {
      // Datos guardados de verdad: el COMMIT de la migración guardaría los de una transacción
      const b = await crearBase(client);
      let medidorId: number | null = null;
      try {
        const planId = await crearPlan(client, b, 'Plan M18-10');
        medidorId = await crearMedidor(b);
        const l1 = await crearLectura(b, medidorId, 100);
        const l2 = await crearLectura(b, medidorId, 200);
        await client.query(
          `UPDATE lecturas_medidor SET anulada_en = NOW(), anulada_por_usuario_id = $1, motivo_anulacion = 'Mal cargada' WHERE id = $2`,
          [b.usuarioId, l2]
        );
        const tareaId = await crearTareaUso(planId, 1, medidorId, USO_250);
        const intId = await crearIntervencion(client, b, planId, 'FINALIZADA');
        const itId = await agregarTareaUso(intId, tareaId, b.usuarioId, medidorId, 150);

        const foto = async () => {
          const r = await client.query(
            `SELECT
               (SELECT to_jsonb(x) FROM medidores x WHERE x.id = $1) AS medidor,
               (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM lecturas_medidor x WHERE x.medidor_id = $1) AS lecturas,
               (SELECT to_jsonb(x) FROM plan_tareas x WHERE x.id = $2) AS tarea,
               (SELECT to_jsonb(x) FROM intervencion_tareas x WHERE x.id = $3) AS tarea_intervencion,
               (SELECT to_jsonb(x) - 'hoy' - 'dias' FROM v_plan_tareas_estado x WHERE x.id = $2) AS estado`,
            [medidorId, tareaId, itId]
          );
          return r.rows[0];
        };
        const antes = await foto();
        assert.strictEqual(antes.lecturas.length, 2);
        assert.deepStrictEqual(
          [Number(antes.tarea_intervencion.valor_medidor), Number(antes.estado.lectura_actual), Number(antes.estado.ultimo_uso)],
          [150, 100, 150]
        );
        assert.strictEqual(antes.lecturas[0].id, l1);

        await client.query(sqlContent);
        assert.deepStrictEqual(await foto(), antes, 'Reaplicar no cambia el medidor, las lecturas ni las tareas');
      } finally {
        await client.query(
          `DELETE FROM lecturas_medidor WHERE medidor_id IN (SELECT id FROM medidores WHERE maquina_id = ANY($1))`,
          [[b.maquinaId, b.maquina2Id]]
        );
        await client.query(
          `DELETE FROM intervencion_tareas WHERE intervencion_id IN (SELECT id FROM intervenciones WHERE maquina_id = ANY($1))`,
          [[b.maquinaId, b.maquina2Id]]
        );
        await client.query(
          'DELETE FROM plan_tareas WHERE plan_id IN (SELECT id FROM planes_mantenimiento WHERE maquina_id = ANY($1))',
          [[b.maquinaId, b.maquina2Id]]
        );
        await client.query('DELETE FROM medidores WHERE maquina_id = ANY($1)', [[b.maquinaId, b.maquina2Id]]);
        await borrarBase(client, b);
      }
    });
  } finally {
    client.release();
  }
});
