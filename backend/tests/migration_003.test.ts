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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION TESTS)');
  console.error('===============================================================');
  console.error(' La prueba de migración modifica el esquema y la base de datos.');
  console.error(' Solo está permitida contra una rama de pruebas aislada de Neon:');
  console.error(' 1. Define NEON_TEST_BRANCH_ID en tu .env con el ID de la rama.');
  console.error(' 2. Define DATABASE_URL apuntando a esa rama específica.');
  console.error(' No se ejecutará contra producción.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 003 — Intervenciones y Máquinas', async (t) => {
  const client = await pool.connect();
  let sectorId = 0;

  try {
    // 1. Aplicación de la migración
    await t.test('1. Aplicar migración 003_intervenciones_schema.sql', async () => {
      const sqlPath = path.resolve(__dirname, '../../database/migrations/003_intervenciones_schema.sql');
      const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
      await client.query(sqlContent);
      assert.ok(true, 'Migración 003 ejecutada exitosamente');
    });

    const testSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // Setup de datos base para pruebas de restricciones
    const resUser = await client.query("SELECT id FROM usuarios WHERE legajo = 'ADMIN001' LIMIT 1");
    assert.ok(resUser.rows.length > 0, 'Debe existir usuario ADMIN001 para pruebas');
    const userId = Number(resUser.rows[0].id);

    const resSector = await client.query(
      'INSERT INTO sectores (nombre) VALUES ($1) RETURNING id',
      [`Sector Mig003 ${testSuffix}`]
    );
    sectorId = Number(resSector.rows[0].id);

    const resMaquina = await client.query(
      'INSERT INTO maquinas (nombre, sector_id, codigo) VALUES ($1, $2, $3) RETURNING id',
      [`Máquina Mig003 ${testSuffix}`, sectorId, `M003-${testSuffix}`]
    );
    const maquinaId = Number(resMaquina.rows[0].id);

    const resTipo = await client.query("SELECT id FROM tipos_intervencion WHERE codigo = 'CORRECTIVO' LIMIT 1");
    assert.ok(resTipo.rows.length > 0, 'Debe existir tipo CORRECTIVO');
    const tipoCorrectivoId = resTipo.rows[0].id;

    // 2. Unicidad de codigo en maquinas
    await t.test('2. Restricción uq_maquinas_codigo en maquinas', async () => {
      const codigoTest = 'TEST-COD-' + Date.now();
      const resM1 = await client.query(
        'INSERT INTO maquinas (nombre, sector_id, codigo) VALUES ($1, $2, $3) RETURNING id',
        [`Máquina Test 1 ${testSuffix}`, sectorId, codigoTest]
      );

      await assert.rejects(
        client.query(
          'INSERT INTO maquinas (nombre, sector_id, codigo) VALUES ($1, $2, $3)',
          [`Máquina Test 2 ${testSuffix}`, sectorId, codigoTest]
        ),
        /uq_maquinas_codigo|duplicate key/i
      );

      await client.query('DELETE FROM maquinas WHERE id = $1', [resM1.rows[0].id]);
    });

    // 3. Restricción de ejecucion en intervenciones
    await t.test('3. Restricción ck_intervenciones_ejecucion', async () => {
      await assert.rejects(
        client.query(
          `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, ejecucion)
           VALUES ($1, $2, $3, $4, $5)`,
          [maquinaId, tipoCorrectivoId, userId, 'Falla test ejecucion', 'INVALIDA']
        ),
        /ck_intervenciones_ejecucion/i
      );

      const okRes = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, ejecucion)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [maquinaId, tipoCorrectivoId, userId, 'Falla test ejecucion valida', 'INTERNA']
      );
      assert.ok(okRes.rows[0].id);
    });

    // 4. Restricción ck_intervenciones_finalizada_fechas
    await t.test('4. Restricción ck_intervenciones_finalizada_fechas', async () => {
      // FINALIZADA sin fechas debe fallar
      await assert.rejects(
        client.query(
          `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado, trabajo_realizado, ejecucion)
           VALUES ($1, $2, $3, $4, 'FINALIZADA', 'Trabajo test', 'INTERNA')`,
          [maquinaId, tipoCorrectivoId, userId, 'Finalizada sin fechas']
        ),
        /ck_intervenciones_finalizada_fechas/i
      );
    });

    // 5. Restricción ck_historial_cancelada_observacion
    await t.test('5. Restricción ck_historial_cancelada_observacion', async () => {
      const resI = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion)
         VALUES ($1, $2, $3, 'Test cancelada') RETURNING id`,
        [maquinaId, tipoCorrectivoId, userId]
      );
      const intervencionId = resI.rows[0].id;

      // Cancelar con observación vacía debe fallar
      await assert.rejects(
        client.query(
          `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, observacion)
           VALUES ($1, 'PENDIENTE', 'CANCELADA', $2, '   ')`,
          [intervencionId, userId]
        ),
        /ck_historial_cancelada_observacion/i
      );

      // Cancelar con observación válida debe funcionar
      await client.query(
        `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, observacion)
         VALUES ($1, 'PENDIENTE', 'CANCELADA', $2, 'Falsa alarma confirmada')`,
        [intervencionId, userId]
      );
    });

    // 6. Protección ON DELETE RESTRICT contra borrado físico accidental
    await t.test('6. Protección ON DELETE RESTRICT en intervenciones', async () => {
      const resI = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion)
         VALUES ($1, $2, $3, 'Test restrict') RETURNING id`,
        [maquinaId, tipoCorrectivoId, userId]
      );
      const intervencionId = resI.rows[0].id;

      // Agregar historial
      await client.query(
        `INSERT INTO historial_estados_intervencion (intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id)
         VALUES ($1, NULL, 'PENDIENTE', $2)`,
        [intervencionId, userId]
      );

      // Intentar borrado físico debe fallar por RESTRICT
      await assert.rejects(
        client.query('DELETE FROM intervenciones WHERE id = $1', [intervencionId]),
        /fk_historial_intervencion|violates foreign key constraint/i
      );
    });

    // 7. Períodos de detención: unicidad de período abierto
    await t.test('7. Períodos de detención: un solo período abierto por intervención', async () => {
      const resI = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion)
         VALUES ($1, $2, $3, 'Test detencion') RETURNING id`,
        [maquinaId, tipoCorrectivoId, userId]
      );
      const intervencionId = resI.rows[0].id;

      // Abrir primer período (hasta = NULL)
      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, abierto_por_usuario_id)
         VALUES ($1, $2, $3)`,
        [intervencionId, maquinaId, userId]
      );

      // Intentar abrir segundo período mientras el primero está abierto debe fallar
      await assert.rejects(
        client.query(
          `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, abierto_por_usuario_id)
           VALUES ($1, $2, $3)`,
          [intervencionId, maquinaId, userId]
        ),
        /uq_periodo_abierto_por_intervencion|duplicate key/i
      );

      // Cerrar el primer período (confirmar recuperación)
      await client.query(
        `UPDATE intervencion_periodos_detencion
         SET hasta = NOW(), confirmado_por_usuario_id = $1
         WHERE intervencion_id = $2`,
        [userId, intervencionId]
      );

      // Ahora sí se puede abrir un segundo período (ej. falla persistente o reapertura)
      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, abierto_por_usuario_id)
         VALUES ($1, $2, $3)`,
        [intervencionId, maquinaId, userId]
      );
    });

    // 8. Renglones de costos: tipos, importes y anulación
    await t.test('8. Renglones de costo: validaciones y anulación', async () => {
      const resI = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion)
         VALUES ($1, $2, $3, 'Test costos') RETURNING id`,
        [maquinaId, tipoCorrectivoId, userId]
      );
      const intervencionId = resI.rows[0].id;

      // Importe negativo en MANO_OBRA debe fallar
      await assert.rejects(
        client.query(
          `INSERT INTO intervencion_costos (intervencion_id, tipo, descripcion, importe, registrado_por_usuario_id)
           VALUES ($1, 'MANO_OBRA', 'Horas extra', -100, $2)`,
          [intervencionId, userId]
        ),
        /ck_intervencion_costos_importe/i
      );

      // Importe negativo en AJUSTE sí está permitido
      const ajusteRes = await client.query(
        `INSERT INTO intervencion_costos (intervencion_id, tipo, descripcion, importe, registrado_por_usuario_id)
         VALUES ($1, 'AJUSTE', 'Descuento por garantía', -50, $2) RETURNING id`,
        [intervencionId, userId]
      );
      assert.ok(ajusteRes.rows[0].id);

      // Anulación sin motivo debe fallar
      await assert.rejects(
        client.query(
          `UPDATE intervencion_costos SET anulado_en = NOW() WHERE id = $1`,
          [ajusteRes.rows[0].id]
        ),
        /ck_intervencion_costos_anulacion/i
      );
    });

  } finally {
    if (sectorId) {
      await client.query(`
        DELETE FROM intervencion_costos WHERE intervencion_id IN (
          SELECT id FROM intervenciones WHERE maquina_id IN (
            SELECT id FROM maquinas WHERE sector_id = ${sectorId}
          )
        )
      `);
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
        DELETE FROM intervencion_auditoria WHERE intervencion_id IN (
          SELECT id FROM intervenciones WHERE maquina_id IN (
            SELECT id FROM maquinas WHERE sector_id = ${sectorId}
          )
        )
      `);
      await client.query(`
        DELETE FROM notificaciones WHERE intervencion_id IN (
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
