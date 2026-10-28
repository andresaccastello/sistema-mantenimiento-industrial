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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 009 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 009 — Usuarios, perfiles y contraseñas', async (t) => {
  const client = await pool.connect();

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/009_usuarios.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    // 1. Aplicación limpia de la migración
    await t.test('1. Aplicar migración 009_usuarios.sql', async () => {
      await client.query(sqlContent);
      assert.ok(true, 'Migración 009 ejecutada exitosamente');
    });

    // 2. Columnas nuevas en usuarios
    await t.test('2. Columnas debe_cambiar_password y password_actualizado_en en usuarios', async () => {
      const res = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'usuarios' AND column_name IN ('debe_cambiar_password', 'password_actualizado_en')
        ORDER BY column_name ASC
      `);

      assert.strictEqual(res.rows.length, 2);
      const colDebe = res.rows.find((r) => r.column_name === 'debe_cambiar_password');
      const colActualizado = res.rows.find((r) => r.column_name === 'password_actualizado_en');

      assert.ok(colDebe);
      assert.strictEqual(colDebe.data_type, 'boolean');
      assert.strictEqual(colDebe.is_nullable, 'NO');
      assert.ok(colDebe.column_default?.includes('false'));

      assert.ok(colActualizado);
      assert.strictEqual(colActualizado.data_type, 'timestamp with time zone');
      assert.strictEqual(colActualizado.is_nullable, 'YES');
    });

    // 3. Perfiles nuevos y permisos de I_D comparados contra RESPONSABLE_MANTENIMIENTO
    await t.test('3. Perfil I_D tiene exactamente los mismos permisos y alcance que RESPONSABLE_MANTENIMIENTO', async () => {
      const resResp = await client.query(`
        SELECT pe.codigo, pp.alcance
        FROM perfil_permiso pp
        JOIN perfiles p ON pp.perfil_id = p.id
        JOIN permisos pe ON pp.permiso_id = pe.id
        WHERE p.nombre = 'RESPONSABLE_MANTENIMIENTO'
        ORDER BY pe.codigo ASC
      `);

      const resID = await client.query(`
        SELECT pe.codigo, pp.alcance
        FROM perfil_permiso pp
        JOIN perfiles p ON pp.perfil_id = p.id
        JOIN permisos pe ON pp.permiso_id = pe.id
        WHERE p.nombre = 'I_D'
        ORDER BY pe.codigo ASC
      `);

      assert.ok(resResp.rows.length > 0);
      assert.strictEqual(resID.rows.length, resResp.rows.length);
      assert.deepStrictEqual(resID.rows, resResp.rows);
    });

    // 4. Perfil DIRECCION tiene los de CONSULTA más NOTIFICACIONES_FALLAS_RECIBIR con TODAS
    await t.test('4. Perfil DIRECCION tiene permisos de CONSULTA + NOTIFICACIONES_FALLAS_RECIBIR (TODAS)', async () => {
      const resCons = await client.query(`
        SELECT pe.codigo, pp.alcance
        FROM perfil_permiso pp
        JOIN perfiles p ON pp.perfil_id = p.id
        JOIN permisos pe ON pp.permiso_id = pe.id
        WHERE p.nombre = 'CONSULTA'
        ORDER BY pe.codigo ASC
      `);

      const resDir = await client.query(`
        SELECT pe.codigo, pp.alcance
        FROM perfil_permiso pp
        JOIN perfiles p ON pp.perfil_id = p.id
        JOIN permisos pe ON pp.permiso_id = pe.id
        WHERE p.nombre = 'DIRECCION'
        ORDER BY pe.codigo ASC
      `);

      assert.ok(resCons.rows.length > 0);
      assert.strictEqual(resDir.rows.length, resCons.rows.length + 1);

      const notifFalla = resDir.rows.find((r) => r.codigo === 'NOTIFICACIONES_FALLAS_RECIBIR');
      assert.ok(notifFalla);
      assert.strictEqual(notifFalla.alcance, 'TODAS');

      // Los de consulta deben estar todos
      for (const row of resCons.rows) {
        const found = resDir.rows.find((r) => r.codigo === row.codigo);
        assert.ok(found, `Permiso ${row.codigo} debe estar en DIRECCION`);
        assert.strictEqual(found.alcance, row.alcance);
      }
    });

    // 5. Restricción CHECK en auditoria_permisos.accion
    await t.test('5. Restricción ck_auditoria_permisos_accion valida acciones permitidas y rechaza inválidas', async () => {
      const resUser = await client.query("SELECT id FROM usuarios WHERE legajo = 'ADMIN001' LIMIT 1");
      const userId = resUser.rows[0].id;

      // Acción válida
      const resOk = await client.query(`
        INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
        VALUES ($1, $1, 'PASSWORD_CAMBIADA', '{"ok": true}')
        RETURNING id
      `, [userId]);
      assert.ok(resOk.rows[0].id);

      // Acción inválida debe fallar
      await assert.rejects(async () => {
        await client.query(`
          INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
          VALUES ($1, $1, 'ACCION_INEXISTENTE', '{}')
        `, [userId]);
      }, /ck_auditoria_permisos_accion/);
    });

    // 6. Idempotencia: correr la migración una segunda vez
    await t.test('6. Idempotencia: ejecutar 009_usuarios.sql nuevamente sin error', async () => {
      await client.query(sqlContent);
      assert.ok(true, 'Segunda ejecución de migración 009 exitosa');
    });

  } finally {
    client.release();
  }
});
