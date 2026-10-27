import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../functions/db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 011 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 011 — Tiempos de gestión e inactividad', async (t) => {
  const client = await pool.connect();

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/011_tiempos.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    // 1. Verificación de versión de PostgreSQL >= 14 (soporte de multirangos)
    await t.test('M11-01: Versión de PostgreSQL es 14 o superior (server_version_num >= 140000)', async () => {
      const res = await client.query('SHOW server_version_num');
      const versionNum = parseInt(res.rows[0].server_version_num, 10);
      assert.ok(versionNum >= 140000, `Versión de PostgreSQL (${versionNum}) debe ser >= 140000`);
    });

    // 2. Aplicación limpia de la migración
    await t.test('M11-02: Aplicar migración 011_tiempos.sql', async () => {
      await client.query(sqlContent);
      assert.ok(true, 'Migración 011 ejecutada exitosamente');
    });

    // 3. Idempotencia: correrla de nuevo no falla
    await t.test('M11-03: Idempotencia: ejecutar la migración dos veces no falla', async () => {
      await client.query(sqlContent);
      assert.ok(true, 'Segunda ejecución completada sin errores');
    });

    // 4. Existencia de la vista v_intervencion_tiempos con todas sus columnas
    await t.test('M11-04: La vista v_intervencion_tiempos existe con las columnas esperadas', async () => {
      const res = await client.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'v_intervencion_tiempos'
        ORDER BY ordinal_position
      `);

      const columnasEsperadas = [
        'intervencion_id',
        'espera_minutos',
        'espera_en_curso',
        'duracion_bruta_minutos',
        'duracion_neta_minutos',
        'tiempo_total_minutos',
        'trabajo_en_curso',
        'inactividad_minutos',
        'inactividad_en_curso'
      ];

      const nombresColumnas = res.rows.map((r) => r.column_name);
      for (const col of columnasEsperadas) {
        assert.ok(nombresColumnas.includes(col), `La vista debe contener la columna ${col}`);
      }
    });

    // 5. Existencia de la función fn_inactividad_maquina
    await t.test('M11-05: La función fn_inactividad_maquina existe y es ejecutable', async () => {
      const res = await client.query(`
        SELECT routine_name, routine_type
        FROM information_schema.routines
        WHERE routine_name = 'fn_inactividad_maquina'
      `);
      assert.strictEqual(res.rows.length, 1, 'Debe existir la rutina fn_inactividad_maquina');

      // Probar ejecución con parámetros nulos o fechas arbitrarias
      const resEjec = await client.query(`
        SELECT * FROM fn_inactividad_maquina(999999, '2026-01-01 00:00:00Z', '2026-01-02 00:00:00Z')
      `);
      assert.strictEqual(resEjec.rows.length, 1, 'Debe devolver exactamente una fila');
      const fila = resEjec.rows[0];
      assert.strictEqual(fila.total_minutos, 0);
      assert.strictEqual(fila.correctivo_minutos, 0);
      assert.strictEqual(fila.preventivo_minutos, 0);
      assert.strictEqual(fila.fuera_de_servicio_minutos, 0);
    });

    // 6. Verificación del backfill de fecha_efectiva e idempotencia
    await t.test('M11-06: Verificación del backfill de fecha_efectiva e idempotencia', async () => {
      // Obtener o crear entidades necesarias
      const resUser = await client.query('SELECT id FROM usuarios WHERE activo = TRUE LIMIT 1');
      const resMaq = await client.query('SELECT id FROM maquinas WHERE activo = TRUE LIMIT 1');
      const resTipo = await client.query('SELECT id FROM tipos_intervencion LIMIT 1');

      assert.ok(resUser.rows.length > 0, 'Debe existir al menos un usuario');
      assert.ok(resMaq.rows.length > 0, 'Debe existir al menos una máquina');
      assert.ok(resTipo.rows.length > 0, 'Debe existir al menos un tipo de intervención');

      const userId = resUser.rows[0].id;
      const maqId = resMaq.rows[0].id;
      const tipoId = resTipo.rows[0].id;

      let testIntId: number | null = null;
      try {
        const fechaInicio = '2026-01-01 09:00:00Z';
        const fechaFin = '2026-01-01 12:00:00Z';

        const resInt = await client.query(
          `INSERT INTO intervenciones (
             maquina_id, tipo_intervencion_id, creado_por_usuario_id, responsable_usuario_id,
             descripcion, estado, ejecucion, trabajo_realizado, fecha_creacion, fecha_inicio, fecha_finalizacion
           ) VALUES ($1, $2, $3, $3, 'M11-06 Backfill Test', 'FINALIZADA', 'INTERNA', 'Trabajo OK',
             '2026-01-01 08:00:00Z', $4, $5)
           RETURNING id`,
          [maqId, tipoId, userId, fechaInicio, fechaFin]
        );
        testIntId = Number(resInt.rows[0].id);

        // Insertar filas en historial con fecha_efectiva NULL
        await client.query(
          `INSERT INTO historial_estados_intervencion (
             intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, cambiado_en, fecha_efectiva
           ) VALUES
             ($1, NULL, 'PENDIENTE', $2, '2026-01-01 08:00:00Z', NULL),
             ($1, 'PENDIENTE', 'EN_PROCESO', $2, '2026-01-01 09:30:00Z', NULL),
             ($1, 'EN_PROCESO', 'FINALIZADA', $2, '2026-01-01 12:30:00Z', NULL)`,
          [testIntId, userId]
        );

        // Ejecutar la migración completa (que incluye el backfill)
        await client.query(sqlContent);

        // Verificar que fecha_efectiva fue asignada correctamente
        const resHist = await client.query(
          `SELECT estado_nuevo, fecha_efectiva
           FROM historial_estados_intervencion
           WHERE intervencion_id = $1
           ORDER BY cambiado_en ASC, id ASC`,
          [testIntId]
        );

        assert.strictEqual(resHist.rows.length, 3);
        // PENDIENTE sigue NULL
        assert.strictEqual(resHist.rows[0].fecha_efectiva, null);
        // Primera EN_PROCESO tomó fecha_inicio
        assert.strictEqual(new Date(resHist.rows[1].fecha_efectiva).toISOString(), new Date(fechaInicio).toISOString());
        // Última FINALIZADA tomó fecha_finalizacion
        assert.strictEqual(new Date(resHist.rows[2].fecha_efectiva).toISOString(), new Date(fechaFin).toISOString());

        // Re-ejecutar la migración para verificar idempotencia
        await client.query(sqlContent);

        const resHist2 = await client.query(
          `SELECT estado_nuevo, fecha_efectiva
           FROM historial_estados_intervencion
           WHERE intervencion_id = $1
           ORDER BY cambiado_en ASC, id ASC`,
          [testIntId]
        );

        assert.strictEqual(new Date(resHist2.rows[1].fecha_efectiva).toISOString(), new Date(fechaInicio).toISOString());
        assert.strictEqual(new Date(resHist2.rows[2].fecha_efectiva).toISOString(), new Date(fechaFin).toISOString());
      } finally {
        if (testIntId) {
          await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = $1', [testIntId]);
          await client.query('DELETE FROM intervenciones WHERE id = $1', [testIntId]);
        }
      }
    });
  } finally {
    client.release();
  }
});
