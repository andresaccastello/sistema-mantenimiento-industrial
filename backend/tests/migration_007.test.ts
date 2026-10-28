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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 007 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 007 — Reapertura, edición y permisos de operario', async (t) => {
  const client = await pool.connect();
  let sectorId = 0;

  try {
    // 1. Aplicación limpia e idempotente de la migración
    await t.test('1. Aplicar migración 007_reapertura_edicion.sql', async () => {
      const sqlPath = path.resolve(__dirname, '../../database/migrations/007_reapertura_edicion.sql');
      const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
      await client.query(sqlContent);
      assert.ok(true, 'Migración 007 ejecutada exitosamente');
    });

    const testSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // Setup de datos de prueba
    const resUser = await client.query("SELECT id FROM usuarios WHERE legajo = 'ADMIN001' LIMIT 1");
    assert.ok(resUser.rows.length > 0, 'Debe existir usuario ADMIN001 para pruebas');
    const userId = Number(resUser.rows[0].id);

    const resSec = await client.query(
      'INSERT INTO sectores (nombre) VALUES ($1) RETURNING id',
      [`Sector Mig007 ${testSuffix}`]
    );
    sectorId = Number(resSec.rows[0].id);

    const resM = await client.query(
      `INSERT INTO maquinas (nombre, sector_id, codigo) VALUES ($1, $2, $3) RETURNING id`,
      [`Maq Test Mig007 ${testSuffix}`, sectorId, `M007-${testSuffix}`]
    );
    const maquinaId = Number(resM.rows[0].id);

    const resI = await client.query(
      `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion)
       VALUES ($1, 1, $2, 'Intervención prueba migración 007') RETURNING id`,
      [maquinaId, userId]
    );
    const intervencionId = Number(resI.rows[0].id);

    // 2. ck_intervencion_auditoria_evento acepta 'EDICION'
    await t.test('2. ck_intervencion_auditoria_evento acepta tipo_evento EDICION', async () => {
      const resAud = await client.query(
        `INSERT INTO intervencion_auditoria (
           intervencion_id, tipo_evento, campo_modificado, valor_anterior, valor_nuevo, motivo, realizado_por_usuario_id
         )
         VALUES ($1, 'EDICION', 'descripcion', 'Desc anterior', 'Desc nueva', 'Prueba mig 007', $2)
         RETURNING id, tipo_evento`,
        [intervencionId, userId]
      );
      assert.strictEqual(resAud.rows.length, 1);
      assert.strictEqual(resAud.rows[0].tipo_evento, 'EDICION');
    });

    // 3. ck_intervencion_auditoria_evento sigue rechazando un tipo_evento inexistente
    await t.test('3. ck_intervencion_auditoria_evento rechaza un tipo de evento no permitido', async () => {
      await assert.rejects(
        client.query(
          `INSERT INTO intervencion_auditoria (
             intervencion_id, tipo_evento, campo_modificado, realizado_por_usuario_id
           )
           VALUES ($1, 'EVENTO_INEXISTENTE', 'campo', $2)`,
          [intervencionId, userId]
        ),
        /ck_intervencion_auditoria_evento/i
      );
    });

    // 4. Perfil OPERARIO tiene INTERVENCIONES_EDITAR con alcance PROPIAS
    await t.test('4. Perfil OPERARIO tiene permiso INTERVENCIONES_EDITAR con alcance PROPIAS', async () => {
      const resPerm = await client.query(
        `SELECT pp.alcance
         FROM perfil_permiso pp
         JOIN perfiles p ON pp.perfil_id = p.id
         JOIN permisos pe ON pp.permiso_id = pe.id
         WHERE p.nombre = 'OPERARIO' AND pe.codigo = 'INTERVENCIONES_EDITAR'`
      );
      assert.strictEqual(resPerm.rows.length, 1);
      assert.strictEqual(resPerm.rows[0].alcance, 'PROPIAS');
    });

  } finally {
    if (sectorId) {
      await client.query(`
        DELETE FROM intervencion_auditoria WHERE intervencion_id IN (
          SELECT id FROM intervenciones WHERE maquina_id IN (
            SELECT id FROM maquinas WHERE sector_id = ${sectorId}
          )
        )
      `);
      await client.query(`
        DELETE FROM intervenciones WHERE maquina_id IN (
          SELECT id FROM maquinas WHERE sector_id = ${sectorId}
        )
      `);
      await client.query(`DELETE FROM maquinas WHERE sector_id = ${sectorId}`);
      await client.query(`DELETE FROM sectores WHERE id = ${sectorId}`);
    }
    client.release();
  }
});
