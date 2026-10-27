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
  } finally {
    client.release();
  }
});
