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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 021 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 021 — Ronda de lecturas', async (t) => {
  let client = await pool.connect();

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/021_ronda_lecturas.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
    // Para correrla dentro del ROLLBACK de una prueba: sin su BEGIN y su COMMIT
    const sinTransaccion = sqlContent.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');

    /** Una máquina, su sector y su planta, y un usuario, dentro de la transacción de la prueba. */
    async function crearBase() {
      const suf = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const perfil = (await client.query(`SELECT id FROM perfiles WHERE nombre = 'OPERARIO'`)).rows[0].id;
      const planta = (await client.query(
        'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`PL_M21_${suf}`]
      )).rows[0].id;
      const sector = (await client.query(
        'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`S_M21_${suf}`, planta]
      )).rows[0].id;
      const maquina = (await client.query(
        'INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, TRUE) RETURNING id',
        [`M21_${suf}`, `Maquina M21 ${suf}`, sector]
      )).rows[0].id;
      const usuario = (await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, 'Persona', 'M21', 'x', $2, TRUE, 1) RETURNING id`,
        [`U_M21_${suf}`, perfil]
      )).rows[0].id;
      return { maquina, usuario };
    }

    // =========================================================================
    // M21-01: Aplicar dos veces
    // =========================================================================
    await t.test('M21-01: Aplicar dos veces no da error', async () => {
      await client.query(sqlContent);
      await client.query(sqlContent);
      const r = await client.query(
        `SELECT count(*)::int AS n FROM pg_constraint
         WHERE conrelid = 'medidores'::regclass AND conname = 'ck_medidores_lectura_cada_dias'`
      );
      assert.strictEqual(r.rows[0].n, 1, 'Un solo CHECK de lectura_cada_dias');
    });

    // =========================================================================
    // M21-02: Las columnas con sus tipos
    // =========================================================================
    await t.test('M21-02: lectura_cada_dias y atraso_avisado_en', async () => {
      const r = await client.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'medidores'
           AND column_name IN ('lectura_cada_dias', 'atraso_avisado_en')
         ORDER BY column_name`
      );
      const columnas = Object.fromEntries(r.rows.map((c) => [c.column_name, c]));
      assert.deepStrictEqual(Object.keys(columnas).sort(), ['atraso_avisado_en', 'lectura_cada_dias']);

      assert.strictEqual(columnas.lectura_cada_dias.data_type, 'smallint');
      assert.strictEqual(columnas.lectura_cada_dias.is_nullable, 'YES');
      assert.strictEqual(columnas.lectura_cada_dias.column_default, '7');

      assert.strictEqual(columnas.atraso_avisado_en.data_type, 'timestamp with time zone');
      assert.strictEqual(columnas.atraso_avisado_en.is_nullable, 'YES');
      assert.strictEqual(columnas.atraso_avisado_en.column_default, null);
    });

    // =========================================================================
    // M21-03: Un medidor que ya existía queda con 7
    // =========================================================================
    await t.test('M21-03: Un medidor que ya existía queda con 7', async () => {
      // Todo dentro de una transacción que se deshace: no queda nada
      await client.query('BEGIN');
      try {
        const b = await crearBase();
        // La tabla como antes de la 021
        await client.query(
          `ALTER TABLE medidores
             DROP COLUMN lectura_cada_dias,
             DROP COLUMN atraso_avisado_en`
        );
        const medidor = (await client.query(
          `INSERT INTO medidores (maquina_id, nombre, unidad, creado_por_usuario_id)
           VALUES ($1, 'Horómetro M21', 'horas', $2) RETURNING id`,
          [b.maquina, b.usuario]
        )).rows[0].id;

        await client.query(sinTransaccion);

        const r = await client.query('SELECT lectura_cada_dias, atraso_avisado_en FROM medidores WHERE id = $1', [medidor]);
        assert.deepStrictEqual(r.rows[0], { lectura_cada_dias: 7, atraso_avisado_en: null });
      } finally {
        await client.query('ROLLBACK');
      }

      const columnas = await client.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'medidores'
           AND column_name IN ('lectura_cada_dias', 'atraso_avisado_en')`
      );
      assert.strictEqual(columnas.rows[0].n, 2, 'El ROLLBACK dejó las dos columnas');
    });

    // =========================================================================
    // M21-04: El CHECK rechaza 0 y 366, y acepta NULL
    // =========================================================================
    await t.test('M21-04: El CHECK rechaza 0 y 366, y acepta NULL', async () => {
      await client.query('BEGIN');
      try {
        const b = await crearBase();
        const insertar = (cada: number | null) =>
          client.query(
            `INSERT INTO medidores (maquina_id, nombre, unidad, creado_por_usuario_id, lectura_cada_dias)
             VALUES ($1, $2, 'horas', $3, $4) RETURNING id, lectura_cada_dias`,
            [b.maquina, `Medidor M21 ${cada}`, b.usuario, cada]
          );

        for (const fuera of [0, 366]) {
          await client.query('SAVEPOINT fuera');
          await assert.rejects(insertar(fuera), /ck_medidores_lectura_cada_dias/, String(fuera));
          await client.query('ROLLBACK TO SAVEPOINT fuera');
        }

        const sinControl = await insertar(null);
        assert.strictEqual(sinControl.rows[0].lectura_cada_dias, null, 'NULL se acepta');
        const bordes = [await insertar(1), await insertar(365)].map((r) => r.rows[0].lectura_cada_dias);
        assert.deepStrictEqual(bordes, [1, 365]);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  } finally {
    client = await clienteSano(client);
    client.release();
  }
});
