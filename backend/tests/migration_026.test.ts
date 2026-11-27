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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 026 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 026 — Documentos de la máquina y código SAE del proveedor (M26-01 a M26-05)', async (t) => {
  let client = await pool.connect();

  try {
    const sql026 = fs.readFileSync(
      path.resolve(__dirname, '../../database/migrations', '026_maquina_documentos.sql'),
      'utf-8'
    );

    // =========================================================================
    await t.test('M26-01: Se aplica dos veces sin error', async () => {
      await client.query(sql026);
      await client.query(sql026);
    });

    // =========================================================================
    await t.test('M26-02: La tabla maquina_documentos, sus columnas y su índice', async () => {
      const cols = await client.query(
        `SELECT column_name, data_type, character_maximum_length AS largo, is_nullable, column_default
         FROM information_schema.columns WHERE table_name = 'maquina_documentos' ORDER BY ordinal_position`
      );
      const resumen = cols.rows.map((c) => [c.column_name, c.data_type, c.largo, c.is_nullable]);
      assert.deepStrictEqual(resumen, [
        ['id', 'bigint', null, 'NO'],
        ['maquina_id', 'bigint', null, 'NO'],
        ['titulo', 'character varying', 150, 'NO'],
        ['tipo', 'character varying', 12, 'NO'],
        ['url', 'character varying', 1000, 'NO'],
        ['notas', 'character varying', 500, 'YES'],
        ['creado_por_usuario_id', 'bigint', null, 'NO'],
        ['creado_en', 'timestamp with time zone', null, 'NO'],
        ['actualizado_en', 'timestamp with time zone', null, 'NO'],
      ]);
      for (const c of cols.rows.filter((x) => x.column_name.endsWith('_en'))) {
        assert.strictEqual(c.column_default, 'now()', c.column_name);
      }
      const identidad = await client.query(
        `SELECT is_identity, identity_generation FROM information_schema.columns
         WHERE table_name = 'maquina_documentos' AND column_name = 'id'`
      );
      assert.deepStrictEqual(identidad.rows[0], { is_identity: 'YES', identity_generation: 'ALWAYS' });

      const fks = await client.query(
        `SELECT a.attname AS columna, c.confrelid::regclass::text AS tabla
         FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
         WHERE c.conrelid = 'maquina_documentos'::regclass AND c.contype = 'f' ORDER BY a.attname`
      );
      assert.deepStrictEqual(fks.rows, [
        { columna: 'creado_por_usuario_id', tabla: 'usuarios' },
        { columna: 'maquina_id', tabla: 'maquinas' },
      ]);

      const idx = await client.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'maquina_documentos' AND indexname = 'idx_maquina_documentos_maquina'`
      );
      assert.strictEqual(idx.rows.length, 1);
      assert.match(idx.rows[0].indexdef, /\(maquina_id\)/);
    });

    // =========================================================================
    await t.test('M26-03: Los CHECK de maquina_documentos (dentro de una transacción que se revierte)', async () => {
      const m = await client.query('SELECT id FROM maquinas ORDER BY id LIMIT 1');
      const u = await client.query('SELECT id FROM usuarios ORDER BY id LIMIT 1');
      if (m.rows.length === 0 || u.rows.length === 0) assert.fail('Hace falta una máquina y un usuario en la base');
      const maquinaId = m.rows[0].id;
      const usuarioId = u.rows[0].id;

      const intentar = async (titulo: string, tipo: string, url: string) => {
        await client.query('SAVEPOINT m26');
        try {
          await client.query(
            `INSERT INTO maquina_documentos (maquina_id, titulo, tipo, url, creado_por_usuario_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [maquinaId, titulo, tipo, url, usuarioId]
          );
          await client.query('RELEASE SAVEPOINT m26');
          return null;
        } catch (err: any) {
          await client.query('ROLLBACK TO SAVEPOINT m26');
          return err.constraint as string;
        }
      };

      await client.query('BEGIN');
      try {
        assert.strictEqual(await intentar('Manual', 'MANUAL', 'https://ejemplo.com/manual.pdf'), null);
        assert.strictEqual(await intentar('Plano', 'PLANO', 'HTTP://ejemplo.com/plano'), null, 'El esquema sin distinguir mayúsculas');
        assert.strictEqual(await intentar('Malo', 'MANUAL', 'javascript:alert(1)'), 'ck_maquina_documentos_url');
        assert.strictEqual(await intentar('Malo', 'MANUAL', 'data:text/html,hola'), 'ck_maquina_documentos_url');
        assert.strictEqual(await intentar('Malo', 'MANUAL', 'ejemplo.com/manual'), 'ck_maquina_documentos_url');
        assert.strictEqual(await intentar('   ', 'MANUAL', 'https://ejemplo.com'), 'ck_maquina_documentos_titulo');
        assert.strictEqual(await intentar('Malo', 'PDF', 'https://ejemplo.com'), 'ck_maquina_documentos_tipo');
        for (const tipo of ['MANUAL', 'FOTO', 'VIDEO', 'INSTRUCTIVO', 'PLANO', 'OTRO']) {
          assert.strictEqual(await intentar(`Doc ${tipo}`, tipo, 'https://ejemplo.com'), null, tipo);
        }
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // =========================================================================
    await t.test('M26-04: proveedores.codigo_externo, con único sin distinguir mayúsculas ni espacios', async () => {
      const col = await client.query(
        `SELECT data_type, character_maximum_length AS largo, is_nullable FROM information_schema.columns
         WHERE table_name = 'proveedores' AND column_name = 'codigo_externo'`
      );
      assert.deepStrictEqual(col.rows[0], { data_type: 'character varying', largo: 40, is_nullable: 'YES' });

      const idx = await client.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'proveedores' AND indexname = 'uq_proveedores_codigo_externo'`
      );
      assert.strictEqual(idx.rows.length, 1);
      assert.match(idx.rows[0].indexdef, /UNIQUE/);
      assert.match(idx.rows[0].indexdef, /upper\(TRIM\(BOTH FROM codigo_externo\)\)|upper\(btrim\(\(?codigo_externo/i);
      assert.match(idx.rows[0].indexdef, /WHERE \(codigo_externo IS NOT NULL\)/);

      const suf = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(`INSERT INTO proveedores (nombre, codigo_externo) VALUES ($1, 'sae-01')`, [`M26 A ${suf}`]);
        await client.query(`INSERT INTO proveedores (nombre, codigo_externo) VALUES ($1, NULL)`, [`M26 B ${suf}`]);
        await client.query(`INSERT INTO proveedores (nombre, codigo_externo) VALUES ($1, NULL)`, [`M26 C ${suf}`]);
        await client.query('SAVEPOINT m26');
        await assert.rejects(
          client.query(`INSERT INTO proveedores (nombre, codigo_externo) VALUES ($1, ' SAE-01 ')`, [`M26 D ${suf}`]),
          (err: any) => err.constraint === 'uq_proveedores_codigo_externo'
        );
        await client.query('ROLLBACK TO SAVEPOINT m26');
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // =========================================================================
    await t.test('M26-05: Reaplicar no borra documentos ni códigos', async () => {
      const suf = Date.now();
      await client.query('BEGIN');
      try {
        const m = await client.query('SELECT id FROM maquinas ORDER BY id LIMIT 1');
        const u = await client.query('SELECT id FROM usuarios ORDER BY id LIMIT 1');
        const doc = await client.query(
          `INSERT INTO maquina_documentos (maquina_id, titulo, tipo, url, creado_por_usuario_id)
           VALUES ($1, 'Reaplicar', 'OTRO', 'https://ejemplo.com', $2) RETURNING id`,
          [m.rows[0].id, u.rows[0].id]
        );
        const prov = await client.query(
          `INSERT INTO proveedores (nombre, codigo_externo) VALUES ($1, 'M26-REAP') RETURNING id`,
          [`M26 E ${suf}`]
        );
        // La migración trae su propio BEGIN y COMMIT: acá se aplica su cuerpo dentro de esta transacción
        const cuerpo = sql026.replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
        await client.query(cuerpo);
        const d = await client.query('SELECT titulo FROM maquina_documentos WHERE id = $1', [doc.rows[0].id]);
        assert.strictEqual(d.rows[0].titulo, 'Reaplicar');
        const p = await client.query('SELECT codigo_externo FROM proveedores WHERE id = $1', [prov.rows[0].id]);
        assert.strictEqual(p.rows[0].codigo_externo, 'M26-REAP');
      } finally {
        await client.query('ROLLBACK');
      }
    });
  } finally {
    client = await clienteSano(client);
    client.release();
  }
});
