import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 027 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 027 — Intentos de ingreso (M27-01 a M27-03)', async (t) => {
  let client = await pool.connect();

  try {
    const sql027 = fs.readFileSync(
      path.resolve(__dirname, '../../database/migrations', '027_intentos_ingreso.sql'),
      'utf-8'
    );

    // =========================================================================
    await t.test('M27-01: Se aplica dos veces sin error', async () => {
      await client.query(sql027);
      await client.query(sql027);
    });

    // =========================================================================
    await t.test('M27-02: La tabla intentos_ingreso, sus columnas y el legajo normalizado', async () => {
      const cols = await client.query(
        `SELECT column_name, data_type, character_maximum_length AS largo, is_nullable, column_default
         FROM information_schema.columns WHERE table_name = 'intentos_ingreso' ORDER BY ordinal_position`
      );
      const resumen = cols.rows.map((c) => [c.column_name, c.data_type, c.largo, c.is_nullable]);
      assert.deepStrictEqual(resumen, [
        ['id', 'bigint', null, 'NO'],
        ['legajo', 'character varying', 50, 'NO'],
        ['exitoso', 'boolean', null, 'NO'],
        ['creado_en', 'timestamp with time zone', null, 'NO'],
      ]);
      assert.strictEqual(cols.rows.find((c) => c.column_name === 'creado_en').column_default, 'now()');
      const identidad = await client.query(
        `SELECT is_identity, identity_generation FROM information_schema.columns
         WHERE table_name = 'intentos_ingreso' AND column_name = 'id'`
      );
      assert.deepStrictEqual(identidad.rows[0], { is_identity: 'YES', identity_generation: 'ALWAYS' });

      // Un legajo sin normalizar no entra; se prueba dentro de una transacción que se deshace
      await client.query('BEGIN');
      try {
        await assert.rejects(
          client.query(`INSERT INTO intentos_ingreso (legajo, exitoso) VALUES (' m27_sin_normalizar ', FALSE)`),
          (err: { code?: string; constraint?: string }) =>
            err.code === '23514' && err.constraint === 'ck_intentos_ingreso_legajo'
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // =========================================================================
    await t.test('M27-03: El índice (legajo, creado_en DESC)', async () => {
      const idx = await client.query(
        `SELECT indexdef FROM pg_indexes
         WHERE tablename = 'intentos_ingreso' AND indexname = 'idx_intentos_ingreso_legajo_creado'`
      );
      assert.strictEqual(idx.rows.length, 1);
      assert.match(idx.rows[0].indexdef, /\(legajo, creado_en DESC\)/);
    });
  } finally {
    client = await clienteSano(client);
    client.release();
  }
});
