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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 008 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 008 — Notificaciones internas, canales y bandeja de salida', async (t) => {
  const client = await pool.connect();

  let usuario1Id = 0;
  let usuario2Id = 0;
  let notificacionId = 0;

  try {
    // 1. Aplicar migración 008_notificaciones.sql
    await t.test('1. Aplicar migración 008_notificaciones.sql', async () => {
      const sqlPath = path.resolve(__dirname, '../../database/migrations/008_notificaciones.sql');
      const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
      await client.query(sqlContent);
      assert.ok(true, 'Migración 008 ejecutada exitosamente');
    });

    const testSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // Setup de usuarios
    const resAdmin = await client.query("SELECT id FROM usuarios WHERE legajo = 'ADMIN001' LIMIT 1");
    assert.ok(resAdmin.rows.length > 0, 'Debe existir usuario ADMIN001 para pruebas');
    usuario1Id = Number(resAdmin.rows[0].id);

    const resPerfil = await client.query('SELECT id FROM perfiles LIMIT 1');
    const perfilId = Number(resPerfil.rows[0].id);

    const resUser2 = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo)
       VALUES ($1, $2, 'dummy_hash', $3, TRUE)
       RETURNING id`,
      [`U8_${testSuffix}`, `Usuario Test 8 ${testSuffix}`, perfilId]
    );
    usuario2Id = Number(resUser2.rows[0].id);

    // 2. Canales iniciales
    await t.test('2. Los tres canales existen con activo = false', async () => {
      const res = await client.query('SELECT canal, activo FROM notificacion_canales ORDER BY canal ASC');
      assert.strictEqual(res.rows.length, 3);
      assert.deepStrictEqual(
        res.rows.map(r => ({ canal: r.canal, activo: r.activo })),
        [
          { canal: 'EMAIL', activo: false },
          { canal: 'PUSH', activo: false },
          { canal: 'WHATSAPP', activo: false },
        ]
      );
    });

    // 3. ck_notificacion_canales_canal rechaza canal no permitido
    await t.test('3. ck_notificacion_canales_canal rechaza canal no permitido', async () => {
      await assert.rejects(
        client.query("INSERT INTO notificacion_canales (canal) VALUES ('SMS')"),
        /ck_notificacion_canales_canal/i
      );
    });

    // 4. Restricciones en notificaciones
    await t.test('4. notificaciones: rechaza prioridad inválida y autonotificación', async () => {
      // Prioridad inválida
      await assert.rejects(
        client.query(
          `INSERT INTO notificaciones (usuario_id, tipo_evento, prioridad, titulo, mensaje, generada_por_usuario_id)
           VALUES ($1, 'TEST', 'BAJA', 'Titulo', 'Mensaje', $2)`,
          [usuario1Id, usuario2Id]
        ),
        /ck_notificaciones_prioridad/i
      );

      // Autonotificación rechazada (generada_por == destinatario)
      await assert.rejects(
        client.query(
          `INSERT INTO notificaciones (usuario_id, tipo_evento, prioridad, titulo, mensaje, generada_por_usuario_id)
           VALUES ($1, 'TEST', 'NORMAL', 'Titulo', 'Mensaje', $1)`,
          [usuario1Id]
        ),
        /ck_notificaciones_no_autonotificar/i
      );

      // Inserción válida
      const resValida = await client.query(
        `INSERT INTO notificaciones (usuario_id, tipo_evento, prioridad, titulo, mensaje, generada_por_usuario_id)
         VALUES ($1, 'FALLA_REGISTRADA', 'ALTA', 'Falla detectada', 'Detalle de la falla', $2)
         RETURNING id, prioridad, leida_en`,
        [usuario1Id, usuario2Id]
      );
      assert.strictEqual(resValida.rows.length, 1);
      assert.strictEqual(resValida.rows[0].prioridad, 'ALTA');
      assert.strictEqual(resValida.rows[0].leida_en, null);
      notificacionId = Number(resValida.rows[0].id);
    });

    // 5. Restricciones en notificacion_envios
    await t.test('5. notificacion_envios: restricciones de canal, unicidad, estado e intentos', async () => {
      // Canal inexistente (FK)
      await assert.rejects(
        client.query(
          `INSERT INTO notificacion_envios (notificacion_id, canal) VALUES ($1, 'INEXISTENTE')`,
          [notificacionId]
        )
      );

      // Inserción válida de envío
      const resEnvio = await client.query(
        `INSERT INTO notificacion_envios (notificacion_id, canal, estado)
         VALUES ($1, 'EMAIL', 'PENDIENTE') RETURNING id`,
        [notificacionId]
      );
      assert.strictEqual(resEnvio.rows.length, 1);

      // Duplicado de (notificacion_id, canal)
      await assert.rejects(
        client.query(
          `INSERT INTO notificacion_envios (notificacion_id, canal, estado)
           VALUES ($1, 'EMAIL', 'PENDIENTE')`,
          [notificacionId]
        ),
        /uq_notificacion_envios_notificacion_canal/i
      );

      // Estado inválido
      await assert.rejects(
        client.query(
          `INSERT INTO notificacion_envios (notificacion_id, canal, estado)
           VALUES ($1, 'PUSH', 'EN_PROCESO')`,
          [notificacionId]
        ),
        /ck_notificacion_envios_estado/i
      );

      // Intentos negativos
      await assert.rejects(
        client.query(
          `INSERT INTO notificacion_envios (notificacion_id, canal, intentos)
           VALUES ($1, 'PUSH', -1)`,
          [notificacionId]
        ),
        /ck_notificacion_envios_intentos/i
      );
    });

  } finally {
    // Cleanup de registros de prueba
    if (notificacionId) {
      await client.query('DELETE FROM notificacion_envios WHERE notificacion_id = $1', [notificacionId]);
      await client.query('DELETE FROM notificaciones WHERE id = $1', [notificacionId]);
    }
    if (usuario2Id) {
      await client.query('DELETE FROM notificaciones WHERE usuario_id = $1 OR generada_por_usuario_id = $1', [usuario2Id]);
      await client.query('DELETE FROM usuarios WHERE id = $1', [usuario2Id]);
    }
    client.release();
  }
});
