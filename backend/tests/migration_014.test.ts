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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 014 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 014 — Excepciones de permisos (usa_alcance y acciones de auditoría)', async (t) => {
  const client = await pool.connect();

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/014_excepciones_permisos.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    // M14-01: Aplicar la migración
    await t.test('M14-01: Aplicar migración 014_excepciones_permisos.sql sin errores', async () => {
      await client.query(sqlContent);
      assert.ok(true, 'Migración 014 ejecutada exitosamente');
    });

    // M14-02: Aplicarla otra vez
    await t.test('M14-02: Idempotencia: aplicar otra vez no falla', async () => {
      await client.query(sqlContent);
      assert.ok(true, 'Segunda ejecución de migración 014 exitosa sin errores');
    });

    // M14-03: usa_alcance exactamente en los 5 permisos
    await t.test('M14-03: usa_alcance en TRUE exactamente en los cinco permisos especificados', async () => {
      const resCol = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'permisos' AND column_name = 'usa_alcance'
      `);
      assert.strictEqual(resCol.rows.length, 1);
      const col = resCol.rows[0];
      assert.strictEqual(col.data_type, 'boolean');
      assert.strictEqual(col.is_nullable, 'NO');
      assert.ok(col.column_default?.includes('false'));

      const resPermisos = await client.query('SELECT codigo, usa_alcance FROM permisos ORDER BY codigo ASC');
      assert.ok(resPermisos.rows.length > 0);

      const esperadosTrue = new Set([
        'INTERVENCIONES_VER',
        'INTERVENCIONES_CREAR',
        'INTERVENCIONES_EDITAR',
        'REPORTES_CONSULTAR',
        'NOTIFICACIONES_FALLAS_RECIBIR',
      ]);

      for (const row of resPermisos.rows) {
        if (esperadosTrue.has(row.codigo)) {
          assert.strictEqual(row.usa_alcance, true, `El permiso ${row.codigo} debe tener usa_alcance = TRUE`);
        } else {
          assert.strictEqual(row.usa_alcance, false, `El permiso ${row.codigo} debe tener usa_alcance = FALSE`);
        }
      }

      const encontradosTrue = resPermisos.rows.filter((r) => r.usa_alcance === true);
      assert.strictEqual(encontradosTrue.length, 5, 'Debe haber exactamente 5 permisos con usa_alcance = TRUE');
    });

    // M14-04: Restricción de auditoría dentro de una transacción con ROLLBACK
    await t.test('M14-04: Restricción de la auditoría dentro de transacción con ROLLBACK', async () => {
      await client.query('BEGIN');
      try {
        const resUser = await client.query("SELECT id FROM usuarios WHERE legajo = 'ADMIN001' LIMIT 1");
        assert.ok(resUser.rows.length > 0, 'Debe existir usuario ADMIN001');
        const adminId = resUser.rows[0].id;

        const accionesNuevas = ['EXCEPCION_CREADA', 'EXCEPCION_MODIFICADA', 'EXCEPCION_ELIMINADA'];
        for (const accion of accionesNuevas) {
          const res = await client.query(
            `INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
             VALUES ($1, $1, $2, '{"codigo": "INTERVENCIONES_VER"}')
             RETURNING id`,
            [adminId, accion]
          );
          assert.ok(res.rows[0].id, `La acción ${accion} debe ser aceptada por la restricción`);
        }

        // Acción inexistente debe ser rechazada
        await assert.rejects(
          async () => {
            await client.query(
              `INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
               VALUES ($1, $1, 'ACCION_INEXISTENTE_XYZ', '{}')`,
              [adminId]
            );
          },
          (err: any) => err.code === '23514' || /ck_auditoria_permisos_accion/i.test(err.message),
          'Debe rechazar una acción que no pertenezca al catálogo permitido de auditoria_permisos'
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });
  } finally {
    client.release();
  }
});
