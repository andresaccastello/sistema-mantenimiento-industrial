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
  console.error(' BLOQUEO DE SEGURIDAD (PERMISOS TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Etapa 2 — Catálogo de Permisos Granulares y Alcance', async (t) => {
  const client = await pool.connect();

  try {
    // 1. Aplicación de la migración 004
    await t.test('1. Aplicar migración 004_permisos_granulares.sql', async () => {
      const sqlPath = path.resolve(__dirname, '../../database/migrations/004_permisos_granulares.sql');
      const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
      await client.query(sqlContent);
      assert.ok(true, 'Migración 004 ejecutada correctamente');
    });

    // 2. Verificar que los permisos granulares existan en el catálogo
    await t.test('2. Catálogo de permisos ampliado correctamente', async () => {
      const res = await client.query(`
        SELECT codigo FROM permisos 
        WHERE codigo IN (
          'INTERVENCIONES_VER', 
          'INTERVENCIONES_FINALIZAR', 
          'INTERVENCIONES_REABRIR', 
          'COSTOS_VER', 
          'COSTOS_REGISTRAR', 
          'MAQUINAS_CAMBIAR_ESTADO', 
          'PERMISOS_GESTIONAR'
        )
      `);
      assert.strictEqual(res.rows.length, 7, 'Todos los permisos requeridos deben estar en la tabla');
    });

    // 3. Crear datos temporales de prueba (un perfil Operario, un usuario y un sector)
    const legajoTest = 'TEST_OPERARIO_' + Date.now();
    const resPerfilOp = await client.query("SELECT id FROM perfiles WHERE nombre = 'OPERARIO'");
    const perfilOperarioId = resPerfilOp.rows[0].id;

    const resUser = await client.query(
      `INSERT INTO usuarios (legajo, nombre, perfil_id)
       VALUES ($1, 'Operario Test', $2) RETURNING id`,
      [legajoTest, perfilOperarioId]
    );
    const testUserId = resUser.rows[0].id;

    const resAdmin = await client.query("SELECT id FROM usuarios WHERE legajo = 'ADMIN001' LIMIT 1");
    const adminId = resAdmin.rows.length > 0 ? resAdmin.rows[0].id : testUserId;

    const resSector = await client.query('SELECT id FROM sectores LIMIT 1');
    const sectorId = resSector.rows[0].id;

    // 4. Verificar permisos base de Operario
    await t.test('4. Operario tiene INTERVENCIONES_VER con alcance PROPIAS y no tiene COSTOS_VER', async () => {
      const res = await client.query(
        `SELECT pe.codigo, pp.alcance
         FROM perfil_permiso pp
         JOIN permisos pe ON pp.permiso_id = pe.id
         WHERE pp.perfil_id = $1`,
        [perfilOperarioId]
      );
      const permMap = new Map(res.rows.map((r: { codigo: string; alcance: string }) => [r.codigo, r.alcance]));

      assert.strictEqual(permMap.get('INTERVENCIONES_VER'), 'PROPIAS');
      assert.strictEqual(permMap.get('INTERVENCIONES_CREAR'), 'TODAS');
      assert.strictEqual(permMap.has('COSTOS_VER'), false);
      assert.strictEqual(permMap.has('INTERVENCIONES_FINALIZAR'), false);
    });

    // 5. Otorgar excepción: CONCEDER COSTOS_VER con alcance SECTORES
    await t.test('5. Conceder excepción individual a usuario (COSTOS_VER con SECTORES)', async () => {
      const resPerm = await client.query("SELECT id FROM permisos WHERE codigo = 'COSTOS_VER'");
      const permCostosId = resPerm.rows[0].id;

      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Autorizado para ver costos de su sector', $3)`,
        [testUserId, permCostosId, adminId]
      );

      // Asignar sector al usuario
      await client.query(
        `INSERT INTO usuario_sector (usuario_id, sector_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [testUserId, sectorId]
      );

      const resEx = await client.query(
        `SELECT efecto, alcance FROM usuario_permiso WHERE usuario_id = $1 AND permiso_id = $2`,
        [testUserId, permCostosId]
      );
      assert.strictEqual(resEx.rows[0].efecto, 'CONCEDER');
      assert.strictEqual(resEx.rows[0].alcance, 'SECTORES');
    });

    // 6. Prevalencia de DENEGAR: Denegar INTERVENCIONES_CREAR al usuario
    await t.test('6. Prevalencia de DENEGAR anula permiso de perfil', async () => {
      const resPerm = await client.query("SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_CREAR'");
      const permCrearId = resPerm.rows[0].id;

      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, motivo, otorgado_por_usuario_id)
         VALUES ($1, $2, 'DENEGAR', 'Sanción temporal', $3)`,
        [testUserId, permCrearId, adminId]
      );

      // Simular cálculo de permisos efectivos
      const [resBase, resEx] = await Promise.all([
        client.query(
          `SELECT pe.codigo, pp.alcance
           FROM perfil_permiso pp
           JOIN permisos pe ON pp.permiso_id = pe.id
           WHERE pp.perfil_id = $1`,
          [perfilOperarioId]
        ),
        client.query(
          `SELECT pe.codigo, up.efecto, up.alcance
           FROM usuario_permiso up
           JOIN permisos pe ON up.permiso_id = pe.id
           WHERE up.usuario_id = $1`,
          [testUserId]
        )
      ]);

      const effectiveMap = new Map();
      for (const r of resBase.rows) effectiveMap.set(r.codigo, r.alcance);
      for (const r of resEx.rows) {
        if (r.efecto === 'DENEGAR') effectiveMap.delete(r.codigo);
        else if (r.efecto === 'CONCEDER') effectiveMap.set(r.codigo, r.alcance);
      }

      assert.strictEqual(effectiveMap.has('INTERVENCIONES_CREAR'), false, 'DENEGAR debe haber eliminado INTERVENCIONES_CREAR');
      assert.strictEqual(effectiveMap.get('COSTOS_VER'), 'SECTORES', 'CONCEDER debe mantener COSTOS_VER con SECTORES');
      assert.strictEqual(effectiveMap.get('INTERVENCIONES_VER'), 'PROPIAS', 'Permiso base no modificado se conserva');
    });

    // 7. Restricciones de integridad en tablas de permisos
    await t.test('7. Restricciones ck_usuario_permiso_efecto y ck_usuario_permiso_alcance', async () => {
      const resPerm = await client.query("SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_FINALIZAR'");
      const permId = resPerm.rows[0].id;

      await assert.rejects(
        client.query(
          `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id)
           VALUES ($1, $2, 'INVALIDO', 'TODAS', $3)`,
          [testUserId, permId, adminId]
        ),
        /ck_usuario_permiso_efecto/i
      );

      await assert.rejects(
        client.query(
          `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id)
           VALUES ($1, $2, 'CONCEDER', 'ALCANCE_FALSO', $3)`,
          [testUserId, permId, adminId]
        ),
        /ck_usuario_permiso_alcance/i
      );
    });

    // Limpieza
    await client.query('DELETE FROM usuarios WHERE id = $1', [testUserId]);

  } finally {
    client.release();
  }
});
