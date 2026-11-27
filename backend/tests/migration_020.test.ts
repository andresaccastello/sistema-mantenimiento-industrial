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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 020 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 020 — Pedidos que se usan al recibir y compras', async (t) => {
  let client = await pool.connect();

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/020_pedidos_compras.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    // =========================================================================
    // M20-01: Aplicar dos veces
    // =========================================================================
    await t.test('M20-01: Aplicar dos veces no da error', async () => {
      await client.query(sqlContent);
      await client.query(sqlContent);
      const r = await client.query(
        `SELECT count(*)::int AS n FROM pg_constraint
         WHERE conrelid = 'pedidos_repuesto'::regclass AND conname = 'ck_pedidos_repuesto_costo'`
      );
      assert.strictEqual(r.rows[0].n, 1, 'Un solo CHECK del costo');
      const fk = await client.query(
        `SELECT count(*)::int AS n FROM pg_constraint
         WHERE conrelid = 'pedidos_repuesto'::regclass AND contype = 'f'
           AND confrelid = 'intervencion_repuestos'::regclass`
      );
      assert.strictEqual(fk.rows[0].n, 1, 'Una sola clave foránea a intervencion_repuestos');
    });

    // =========================================================================
    // M20-02: Las tres columnas con sus tipos
    // =========================================================================
    await t.test('M20-02: costo_unitario, comprobante y consumo_id', async () => {
      const r = await client.query(
        `SELECT column_name, data_type, numeric_precision, numeric_scale, character_maximum_length, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'pedidos_repuesto' AND column_name IN ('costo_unitario', 'comprobante', 'consumo_id')
         ORDER BY column_name`
      );
      const columnas = Object.fromEntries(r.rows.map((c) => [c.column_name, c]));
      assert.deepStrictEqual(Object.keys(columnas).sort(), ['comprobante', 'consumo_id', 'costo_unitario']);

      assert.strictEqual(columnas.costo_unitario.data_type, 'numeric');
      assert.strictEqual(Number(columnas.costo_unitario.numeric_precision), 14);
      assert.strictEqual(Number(columnas.costo_unitario.numeric_scale), 2);
      assert.strictEqual(columnas.costo_unitario.is_nullable, 'YES');

      assert.strictEqual(columnas.comprobante.data_type, 'character varying');
      assert.strictEqual(Number(columnas.comprobante.character_maximum_length), 60);
      assert.strictEqual(columnas.comprobante.is_nullable, 'YES');

      assert.strictEqual(columnas.consumo_id.data_type, 'bigint');
      assert.strictEqual(columnas.consumo_id.is_nullable, 'YES');
      const fk = await client.query(
        `SELECT a.attname
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
         WHERE c.conrelid = 'pedidos_repuesto'::regclass AND c.contype = 'f'
           AND c.confrelid = 'intervencion_repuestos'::regclass`
      );
      assert.deepStrictEqual(fk.rows.map((x) => x.attname), ['consumo_id']);
    });

    // =========================================================================
    // M20-03: El CHECK rechaza un costo negativo
    // =========================================================================
    await t.test('M20-03: El CHECK rechaza un costo negativo', async () => {
      // Todo dentro de una transacción que se deshace: no queda nada
      await client.query('BEGIN');
      try {
        const suf = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
        const perfil = (await client.query(`SELECT id FROM perfiles WHERE nombre = 'OPERARIO'`)).rows[0].id;
        const planta = (await client.query(
          'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`PL_M20_${suf}`]
        )).rows[0].id;
        const sector = (await client.query(
          'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`S_M20_${suf}`, planta]
        )).rows[0].id;
        const maquina = (await client.query(
          'INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, TRUE) RETURNING id',
          [`M20_${suf}`, `Maquina M20 ${suf}`, sector]
        )).rows[0].id;
        const usuario = (await client.query(
          `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
           VALUES ($1, 'Persona', 'M20', 'x', $2, TRUE, 1) RETURNING id`,
          [`U_M20_${suf}`, perfil]
        )).rows[0].id;
        const tipo = (await client.query(`SELECT id FROM tipos_intervencion WHERE codigo = 'CORRECTIVO'`)).rows[0].id;
        const intervencion = (await client.query(
          `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado)
           VALUES ($1, $2, $3, 'Falla M20', 'PENDIENTE') RETURNING id`,
          [maquina, tipo, usuario]
        )).rows[0].id;

        const insertar = (costo: number) =>
          client.query(
            `INSERT INTO pedidos_repuesto (intervencion_id, descripcion, cantidad, creado_por_usuario_id, costo_unitario, comprobante)
             VALUES ($1, 'Pedido M20', 1, $2, $3, 'R-0001') RETURNING id`,
            [intervencion, usuario, costo]
          );

        await client.query('SAVEPOINT negativo');
        await assert.rejects(insertar(-0.01), /ck_pedidos_repuesto_costo/);
        await client.query('ROLLBACK TO SAVEPOINT negativo');

        const ok = await insertar(0);
        assert.ok(Number(ok.rows[0].id) > 0, 'Un costo de 0 se acepta');
      } finally {
        await client.query('ROLLBACK');
      }
    });
  } finally {
    client = await clienteSano(client);
    client.release();
  }
});
