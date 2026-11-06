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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 006 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 006 — Cierres, trabajo realizado y confirmación', async (t) => {
  const client = await pool.connect();
  let sectorId = 0;

  try {
    // 1. Aplicación limpia e idempotente de la migración
    await t.test('1. Aplicar migración 006_cierres.sql', async () => {
      const sqlPath = path.resolve(__dirname, '../../database/migrations/006_cierres.sql');
      const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
      await client.query(sqlContent);
      assert.ok(true, 'Migración 006 ejecutada exitosamente');
    });

    // 2. Verificar existencia de las columnas nuevas
    await t.test('2. Columnas trabajo_realizado y observacion_confirmacion existen', async () => {
      const colTrabajo = await client.query(
        `SELECT column_name, data_type 
         FROM information_schema.columns 
         WHERE table_name = 'intervenciones' AND column_name = 'trabajo_realizado'`
      );
      assert.strictEqual(colTrabajo.rows.length, 1);

      const colObsConf = await client.query(
        `SELECT column_name, data_type 
         FROM information_schema.columns 
         WHERE table_name = 'intervencion_periodos_detencion' AND column_name = 'observacion_confirmacion'`
      );
      assert.strictEqual(colObsConf.rows.length, 1);
    });

    const testSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // Setup de datos de prueba
    const resUser = await client.query("SELECT id FROM usuarios WHERE legajo = 'ADMIN001' LIMIT 1");
    assert.ok(resUser.rows.length > 0, 'Debe existir usuario ADMIN001 para pruebas');
    const userId = Number(resUser.rows[0].id);

    const resSec = await client.query(
      'INSERT INTO sectores (nombre) VALUES ($1) RETURNING id',
      [`Sector Mig006 ${testSuffix}`]
    );
    sectorId = Number(resSec.rows[0].id);

    const resM = await client.query(
      `INSERT INTO maquinas (nombre, sector_id, codigo) VALUES ($1, $2, $3) RETURNING id`,
      [`Maq Test Mig006 ${testSuffix}`, sectorId, `M006-${testSuffix}`]
    );
    const maquinaId = Number(resM.rows[0].id);

    const resI = await client.query(
      `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion)
       VALUES ($1, 1, $2, 'Intervención prueba migración 006') RETURNING id`,
      [maquinaId, userId]
    );
    const intervencionId = Number(resI.rows[0].id);

    // 3. ck_intervenciones_finalizada_datos rechaza FINALIZADA sin trabajo_realizado
    await t.test('3. ck_intervenciones_finalizada_datos rechaza FINALIZADA sin trabajo_realizado', async () => {
      await assert.rejects(
        client.query(
          `UPDATE intervenciones
           SET estado = 'FINALIZADA',
               fecha_inicio = NOW() - INTERVAL '1 hour',
               fecha_finalizacion = NOW(),
               ejecucion = 'INTERNA',
               trabajo_realizado = NULL
           WHERE id = $1`,
          [intervencionId]
        ),
        /ck_intervenciones_finalizada_datos/i
      );

      // Con trabajo_realizado vacío o espacios
      await assert.rejects(
        client.query(
          `UPDATE intervenciones
           SET estado = 'FINALIZADA',
               fecha_inicio = NOW() - INTERVAL '1 hour',
               fecha_finalizacion = NOW(),
               ejecucion = 'INTERNA',
               trabajo_realizado = '   '
           WHERE id = $1`,
          [intervencionId]
        ),
        /ck_intervenciones_finalizada_datos/i
      );
    });

    // 4. ck_intervenciones_finalizada_datos rechaza FINALIZADA sin ejecucion
    await t.test('4. ck_intervenciones_finalizada_datos rechaza FINALIZADA sin ejecucion', async () => {
      await assert.rejects(
        client.query(
          `UPDATE intervenciones
           SET estado = 'FINALIZADA',
               fecha_inicio = NOW() - INTERVAL '1 hour',
               fecha_finalizacion = NOW(),
               ejecucion = NULL,
               trabajo_realizado = 'Se cambiaron rodamientos'
           WHERE id = $1`,
          [intervencionId]
        ),
        /ck_intervenciones_finalizada_datos/i
      );
    });

    // 5. Con trabajo_realizado y ejecucion válidos sí permite FINALIZADA
    await t.test('5. Permite estado FINALIZADA con trabajo_realizado y ejecucion válidos', async () => {
      await client.query(
        `UPDATE intervenciones
         SET estado = 'FINALIZADA',
             fecha_inicio = NOW() - INTERVAL '1 hour',
             fecha_finalizacion = NOW(),
             ejecucion = 'INTERNA',
             trabajo_realizado = 'Reparación de motor y calibración'
         WHERE id = $1`,
        [intervencionId]
      );

      const check = await client.query('SELECT estado, trabajo_realizado, ejecucion FROM intervenciones WHERE id = $1', [intervencionId]);
      assert.strictEqual(check.rows[0].estado, 'FINALIZADA');
      assert.strictEqual(check.rows[0].ejecucion, 'INTERNA');
      assert.strictEqual(check.rows[0].trabajo_realizado, 'Reparación de motor y calibración');
    });

  } finally {
    if (sectorId) {
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
