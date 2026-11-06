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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 005 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 005 — Integridad compuesta y restricciones de estado', async (t) => {
  const client = await pool.connect();
  let sectorId = 0;

  try {
    // 1. Aplicación limpia e idempotente de la migración
    await t.test('1. Aplicar migración 005_motor_estados.sql', async () => {
      const sqlPath = path.resolve(__dirname, '../../database/migrations/005_motor_estados.sql');
      const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
      await client.query(sqlContent);
      assert.ok(true, 'Migración 005 ejecutada exitosamente');
    });

    const testSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // Setup de datos de prueba
    const resUser = await client.query("SELECT id FROM usuarios WHERE legajo = 'ADMIN001' LIMIT 1");
    assert.ok(resUser.rows.length > 0, 'Debe existir usuario ADMIN001 para pruebas');
    const userId = Number(resUser.rows[0].id);

    const resSec = await client.query(
      'INSERT INTO sectores (nombre) VALUES ($1) RETURNING id',
      [`Sector Mig005 ${testSuffix}`]
    );
    sectorId = Number(resSec.rows[0].id);

    // Crear dos máquinas distintas para probar incoherencia
    const resM1 = await client.query(
      `INSERT INTO maquinas (nombre, sector_id, codigo) VALUES ($1, $2, $3) RETURNING id`,
      [`Maq Test Mig005 A ${testSuffix}`, sectorId, `M005-A-${testSuffix}`]
    );
    const m1Id = Number(resM1.rows[0].id);

    const resM2 = await client.query(
      `INSERT INTO maquinas (nombre, sector_id, codigo) VALUES ($1, $2, $3) RETURNING id`,
      [`Maq Test Mig005 B ${testSuffix}`, sectorId, `M005-B-${testSuffix}`]
    );
    const m2Id = Number(resM2.rows[0].id);

    // Crear intervención sobre m1
    const resI = await client.query(
      `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion)
       VALUES ($1, 1, $2, 'Intervencion para test mig 005') RETURNING id`,
      [m1Id, userId]
    );
    const intervencionId = Number(resI.rows[0].id);

    // 2. Probar fk_periodos_intervencion_maquina (coherencia de máquina)
    await t.test('2. fk_periodos_intervencion_maquina rechaza máquina discordante', async () => {
      await assert.rejects(
        client.query(
          `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, abierto_por_usuario_id)
           VALUES ($1, $2, $3)`,
          [intervencionId, m2Id, userId]
        ),
        /fk_periodos_intervencion_maquina|violates foreign key constraint/i
      );

      // Con máquina coherente sí debe funcionar
      const resP = await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, abierto_por_usuario_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [intervencionId, m1Id, userId]
      );
      assert.ok(resP.rows[0].id);
      await client.query('DELETE FROM intervencion_periodos_detencion WHERE id = $1', [resP.rows[0].id]);
    });

    // 3. Probar fk_historial_maquina_intervencion_maquina (coherencia en historial de máquina)
    await t.test('3. fk_historial_maquina_intervencion_maquina rechaza máquina discordante', async () => {
      await assert.rejects(
        client.query(
          `INSERT INTO historial_estados_maquina (maquina_id, estado_anterior, estado_nuevo, intervencion_id, cambiado_por_usuario_id)
           VALUES ($1, 'OPERATIVA', 'DETENIDA', $2, $3)`,
          [m2Id, intervencionId, userId]
        ),
        /fk_historial_maquina_intervencion_maquina|violates foreign key constraint/i
      );
    });

    // 4. Probar ck_historial_espera_observacion (observación obligatoria al pasar a espera de repuestos)
    await t.test('4. ck_historial_espera_observacion rechaza observación vacía o nula', async () => {
      await assert.rejects(
        client.query(
          `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, observacion)
           VALUES ($1, 'EN_PROCESO', 'EN_ESPERA_REPUESTOS', $2, '   ')`,
          [intervencionId, userId]
        ),
        /ck_historial_espera_observacion/i
      );

      await assert.rejects(
        client.query(
          `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, observacion)
           VALUES ($1, 'EN_PROCESO', 'EN_ESPERA_REPUESTOS', $2, NULL)`,
          [intervencionId, userId]
        ),
        /ck_historial_espera_observacion/i
      );

      // Con observación válida debe funcionar
      const resH = await client.query(
        `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, observacion)
         VALUES ($1, 'EN_PROCESO', 'EN_ESPERA_REPUESTOS', $2, 'Falta rodamiento SKF 6204') RETURNING id`,
        [intervencionId, userId]
      );
      assert.ok(resH.rows[0].id);
    });

  } finally {
    if (sectorId) {
      await client.query(`
        DELETE FROM intervencion_periodos_detencion WHERE maquina_id IN (
          SELECT id FROM maquinas WHERE sector_id = ${sectorId}
        )
      `);
      await client.query(`
        DELETE FROM historial_estados_intervencion WHERE intervencion_id IN (
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
      await client.query(`
        DELETE FROM historial_estados_maquina WHERE maquina_id IN (
          SELECT id FROM maquinas WHERE sector_id = ${sectorId}
        )
      `);
      await client.query(`DELETE FROM maquinas WHERE sector_id = ${sectorId}`);
      await client.query(`DELETE FROM sectores WHERE id = ${sectorId}`);
    }
    client.release();
  }
});
