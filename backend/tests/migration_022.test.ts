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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 022 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 022 — Preferencias del usuario', async (t) => {
  let client = await pool.connect();

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/022_preferencias_usuario.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    /** Un usuario de prueba, dentro de la transacción de la prueba. */
    async function crearUsuario(extra: { columnas: string; valores: unknown[] } = { columnas: '', valores: [] }) {
      const suf = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const perfil = (await client.query(`SELECT id FROM perfiles WHERE nombre = 'OPERARIO'`)).rows[0].id;
      return client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version${extra.columnas})
         VALUES ($1, 'Persona', 'M22', 'x', $2, TRUE, 1${extra.valores.map((_, i) => `, $${i + 3}`).join('')})
         RETURNING id, modo_simple_celular, tema`,
        [`U_M22_${suf}`, perfil, ...extra.valores]
      );
    }

    // =========================================================================
    // M22-01: Aplicar dos veces
    // =========================================================================
    await t.test('M22-01: Aplicar dos veces no da error', async () => {
      await client.query(sqlContent);
      await client.query(sqlContent);
      const r = await client.query(
        `SELECT count(*)::int AS n FROM pg_constraint
         WHERE conrelid = 'usuarios'::regclass AND conname = 'ck_usuarios_tema'`
      );
      assert.strictEqual(r.rows[0].n, 1, 'Un solo CHECK de tema');
    });

    // =========================================================================
    // M22-02: Las columnas con sus tipos y valores por omisión
    // =========================================================================
    await t.test('M22-02: modo_simple_celular y tema', async () => {
      const r = await client.query(
        `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'usuarios'
           AND column_name IN ('modo_simple_celular', 'tema')
         ORDER BY column_name`
      );
      const columnas = Object.fromEntries(r.rows.map((c) => [c.column_name, c]));
      assert.deepStrictEqual(Object.keys(columnas).sort(), ['modo_simple_celular', 'tema']);

      assert.strictEqual(columnas.modo_simple_celular.data_type, 'boolean');
      assert.strictEqual(columnas.modo_simple_celular.is_nullable, 'NO');
      assert.strictEqual(columnas.modo_simple_celular.column_default, 'true');

      assert.strictEqual(columnas.tema.data_type, 'character varying');
      assert.strictEqual(columnas.tema.character_maximum_length, 10);
      assert.strictEqual(columnas.tema.is_nullable, 'NO');
      assert.strictEqual(columnas.tema.column_default, "'CLARO'::character varying");

      // Un usuario nuevo, sin decir nada, queda con los valores por omisión
      await client.query('BEGIN');
      try {
        const u = await crearUsuario();
        assert.deepStrictEqual(
          { modo_simple_celular: u.rows[0].modo_simple_celular, tema: u.rows[0].tema },
          { modo_simple_celular: true, tema: 'CLARO' }
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // =========================================================================
    // M22-03: El CHECK rechaza otro tema
    // =========================================================================
    await t.test('M22-03: El CHECK rechaza otro valor de tema', async () => {
      await client.query('BEGIN');
      try {
        for (const fuera of ['AZUL', 'claro', '']) {
          await client.query('SAVEPOINT fuera');
          await assert.rejects(crearUsuario({ columnas: ', tema', valores: [fuera] }), /ck_usuarios_tema/, fuera);
          await client.query('ROLLBACK TO SAVEPOINT fuera');
        }
        const validos = [];
        for (const tema of ['CLARO', 'OSCURO', 'SISTEMA']) {
          validos.push((await crearUsuario({ columnas: ', tema', valores: [tema] })).rows[0].tema);
        }
        assert.deepStrictEqual(validos, ['CLARO', 'OSCURO', 'SISTEMA']);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  } finally {
    client = await clienteSano(client);
    client.release();
  }
});
