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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 010 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 010 — Versión de sesión en usuarios', async (t) => {
  const client = await pool.connect();

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/010_sesion_version.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    // 1. Aplicación limpia de la migración
    await t.test('M10-01: Aplicar migración 010_sesion_version.sql', async () => {
      await client.query(sqlContent);
      assert.ok(true, 'Migración 010 ejecutada exitosamente');
    });

    // 2. Idempotencia
    await t.test('M10-02: Idempotencia: ejecutar la migración dos veces no falla', async () => {
      await client.query(sqlContent);
      assert.ok(true, 'Segunda ejecución completada sin errores');
    });

    // 3. Columna sesion_version en usuarios
    await t.test('M10-03: Columna sesion_version existe con tipo integer, NOT NULL y default 1', async () => {
      const res = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'usuarios' AND column_name = 'sesion_version'
      `);

      assert.strictEqual(res.rows.length, 1, 'Debe existir la columna sesion_version');
      const col = res.rows[0];
      assert.strictEqual(col.data_type, 'integer');
      assert.strictEqual(col.is_nullable, 'NO');
      assert.ok(col.column_default?.includes('1'), 'Default debe ser 1');
    });

    // 4. Los usuarios existentes tienen valor >= 1
    await t.test('M10-04: Todos los usuarios existentes tienen sesion_version >= 1', async () => {
      const res = await client.query(`
        SELECT COUNT(*) AS total_invalidos
        FROM usuarios
        WHERE sesion_version IS NULL OR sesion_version < 1
      `);
      assert.strictEqual(Number(res.rows[0].total_invalidos), 0, 'No debe haber filas sin sesion_version válida');
    });
  } finally {
    client.release();
  }
});
