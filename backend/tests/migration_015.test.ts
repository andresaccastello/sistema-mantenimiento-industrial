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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 015 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 015 — Avisos por email: base de datos', async (t) => {
  const client = await pool.connect();

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/015_avisos_email.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    // Restaurar estado base si quedó afectado por ejecuciones previas
    await client.query(
      "UPDATE notificacion_reglas SET modo = 'NUNCA' WHERE tipo_evento = 'FALLA_REGISTRADA' AND canal = 'WHATSAPP'"
    );
    await client.query(
      "UPDATE notificacion_canales SET activo = FALSE WHERE canal = 'EMAIL'"
    );

    // M15-01: Se aplica dos veces sin error
    await t.test('M15-01: Aplicar migración 015_avisos_email.sql dos veces sin error', async () => {
      await client.query(sqlContent);
      await client.query(sqlContent);
      assert.ok(true, 'Migración 015 aplicada dos veces con éxito');
    });

    // M15-02: email y telefono_whatsapp existen, aceptan NULL y validan con restricciones
    await t.test('M15-02: email y telefono_whatsapp validaciones de formato y NULL', async () => {
      const resCols = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'usuarios' AND column_name IN ('email', 'telefono_whatsapp')
      `);
      assert.strictEqual(resCols.rows.length, 2);

      const resPerfil = await client.query("SELECT id FROM perfiles WHERE nombre = 'ADMINISTRADOR' LIMIT 1");
      const perfilId = resPerfil.rows[0].id;

      // Acepta NULL
      await client.query('BEGIN');
      try {
        const rNull = await client.query(
          `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, email, telefono_whatsapp)
           VALUES ('M15_NULL', 'Test Null', 'hash', $1, TRUE, NULL, NULL) RETURNING id`,
          [perfilId]
        );
        assert.ok(rNull.rows[0].id);
      } finally {
        await client.query('ROLLBACK');
      }

      // Acepta valores válidos: a@b.co y +5491112345678
      await client.query('BEGIN');
      try {
        const rOk = await client.query(
          `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, email, telefono_whatsapp)
           VALUES ('M15_OK', 'Test Ok', 'hash', $1, TRUE, 'a@b.co', '+5491112345678') RETURNING id`,
          [perfilId]
        );
        assert.ok(rOk.rows[0].id);
      } finally {
        await client.query('ROLLBACK');
      }

      // Rechaza sin-arroba
      await client.query('BEGIN');
      try {
        await assert.rejects(
          client.query(
            `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, email)
             VALUES ('M15_ERR1', 'Test Err', 'hash', $1, TRUE, 'sin-arroba')`,
            [perfilId]
          ),
          /ck_usuarios_email/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // Rechaza +12 (menos de 8 dígitos)
      await client.query('BEGIN');
      try {
        await assert.rejects(
          client.query(
            `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, telefono_whatsapp)
             VALUES ('M15_ERR2', 'Test Err', 'hash', $1, TRUE, '+12')`,
            [perfilId]
          ),
          /ck_usuarios_telefono_whatsapp/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // Rechaza 5491112345678 (sin el '+')
      await client.query('BEGIN');
      try {
        await assert.rejects(
          client.query(
            `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, telefono_whatsapp)
             VALUES ('M15_ERR3', 'Test Err', 'hash', $1, TRUE, '5491112345678')`,
            [perfilId]
          ),
          /ck_usuarios_telefono_whatsapp/i
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // M15-03: notificacion_reglas tiene las 16 filas iniciales y restricciones
    await t.test('M15-03: notificacion_reglas tiene 16 filas con modos correctos y restricciones', async () => {
      const res = await client.query('SELECT tipo_evento, canal, modo FROM notificacion_reglas');
      assert.strictEqual(res.rows.length, 16);

      const mapaModos: Record<string, Record<string, string>> = {};
      for (const row of res.rows) {
        if (!mapaModos[row.tipo_evento]) mapaModos[row.tipo_evento] = {};
        mapaModos[row.tipo_evento][row.canal] = row.modo;
      }

      // WhatsApp siempre NUNCA
      for (const tEv in mapaModos) {
        assert.strictEqual(mapaModos[tEv]['WHATSAPP'], 'NUNCA', `WHATSAPP en ${tEv} debe ser NUNCA`);
      }

      // Modos EMAIL
      assert.strictEqual(mapaModos['FALLA_REGISTRADA']?.['EMAIL'], 'SOLO_ALTA');
      assert.strictEqual(mapaModos['INTERVENCION_ASIGNADA']?.['EMAIL'], 'SIEMPRE');
      assert.strictEqual(mapaModos['INTERVENCION_REASIGNADA']?.['EMAIL'], 'SIEMPRE');
      assert.strictEqual(mapaModos['DETENCION_PENDIENTE_CONFIRMACION']?.['EMAIL'], 'SIEMPRE');
      assert.strictEqual(mapaModos['INTERVENCION_DESASIGNADA']?.['EMAIL'], 'NUNCA');
      assert.strictEqual(mapaModos['INTERVENCION_FINALIZADA']?.['EMAIL'], 'NUNCA');
      assert.strictEqual(mapaModos['INTERVENCION_CANCELADA']?.['EMAIL'], 'NUNCA');
      assert.strictEqual(mapaModos['INTERVENCION_REABIERTA']?.['EMAIL'], 'NUNCA');

      // Probar restricciones en transacciones independientes con ROLLBACK
      // 1. Tipo inventado
      await client.query('BEGIN');
      try {
        await assert.rejects(
          client.query(
            "INSERT INTO notificacion_reglas (tipo_evento, canal, modo) VALUES ('EVENTO_FALSO', 'EMAIL', 'SIEMPRE')"
          ),
          /ck_notificacion_reglas_tipo_evento/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // 2. Canal inventado o no permitido (PUSH)
      await client.query('BEGIN');
      try {
        await assert.rejects(
          client.query(
            "INSERT INTO notificacion_reglas (tipo_evento, canal, modo) VALUES ('FALLA_REGISTRADA', 'PUSH', 'SIEMPRE')"
          ),
          /ck_notificacion_reglas_canal/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // 3. Modo inventado
      await client.query('BEGIN');
      try {
        await assert.rejects(
          client.query(
            "INSERT INTO notificacion_reglas (tipo_evento, canal, modo) VALUES ('FALLA_REGISTRADA', 'EMAIL', 'INVENTADO')"
          ),
          /ck_notificacion_reglas_modo/i
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // M15-04: Columnas e índice nuevos en notificacion_canales y notificacion_envios
    await t.test('M15-04: Columnas e índice nuevos en notificacion_canales y notificacion_envios', async () => {
      const resCanalesCol = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'notificacion_canales' AND column_name = 'actualizado_por_usuario_id'
      `);
      assert.strictEqual(resCanalesCol.rows.length, 1);

      const resEnviosCols = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'notificacion_envios' AND column_name IN ('proximo_intento_en', 'destino')
      `);
      assert.strictEqual(resEnviosCols.rows.length, 2);

      const resIdx = await client.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'notificacion_envios' AND indexname = 'idx_notificacion_envios_pendientes'
      `);
      assert.strictEqual(resIdx.rows.length, 1);
    });

    // M15-05: CONFIGURACION_GESTIONAR existe con usa_alcance = false y solo para ADMINISTRADOR
    await t.test('M15-05: Permiso CONFIGURACION_GESTIONAR existe y pertenece solo a ADMINISTRADOR', async () => {
      const resPermiso = await client.query(
        "SELECT codigo, nombre, usa_alcance FROM permisos WHERE codigo = 'CONFIGURACION_GESTIONAR'"
      );
      assert.strictEqual(resPermiso.rows.length, 1);
      assert.strictEqual(resPermiso.rows[0].usa_alcance, false);

      const resPerfiles = await client.query(`
        SELECT p.nombre AS perfil
        FROM perfil_permiso pp
        JOIN perfiles p ON p.id = pp.perfil_id
        JOIN permisos pe ON pe.id = pp.permiso_id
        WHERE pe.codigo = 'CONFIGURACION_GESTIONAR'
      `);
      assert.strictEqual(resPerfiles.rows.length, 1);
      assert.strictEqual(resPerfiles.rows[0].perfil, 'ADMINISTRADOR');
    });

    // M15-06: Aplicarla de nuevo no cambia un modo, canal modificado ni quita permisos a otros perfiles (en transacción con ROLLBACK)
    await t.test('M15-06: Idempotencia respeta cambios en reglas, canales y permisos asignados', async () => {
      // Eliminar BEGIN; y COMMIT; del SQL para no interferir con la transacción de prueba
      const sqlSinTransaccion = sqlContent
        .replace(/^\s*BEGIN;\s*/im, '')
        .replace(/\s*COMMIT;\s*$/im, '');

      await client.query('BEGIN');
      try {
        // Modificar una regla y un canal
        await client.query(
          "UPDATE notificacion_reglas SET modo = 'SIEMPRE' WHERE tipo_evento = 'FALLA_REGISTRADA' AND canal = 'WHATSAPP'"
        );
        await client.query(
          "UPDATE notificacion_canales SET activo = TRUE WHERE canal = 'EMAIL'"
        );

        // Asignar CONFIGURACION_GESTIONAR a otro perfil
        await client.query(`
          INSERT INTO perfil_permiso (perfil_id, permiso_id, alcance)
          SELECT p.id, pe.id, 'TODAS'
          FROM perfiles p
          JOIN permisos pe ON pe.codigo = 'CONFIGURACION_GESTIONAR'
          WHERE p.nombre = 'RESPONSABLE_MANTENIMIENTO'
          ON CONFLICT (perfil_id, permiso_id) DO NOTHING
        `);

        // Re-ejecutar la migración dentro de la transacción
        await client.query(sqlSinTransaccion);

        // Verificar que no se sobreescribieron
        const resRegla = await client.query(
          "SELECT modo FROM notificacion_reglas WHERE tipo_evento = 'FALLA_REGISTRADA' AND canal = 'WHATSAPP'"
        );
        assert.strictEqual(resRegla.rows[0].modo, 'SIEMPRE');

        const resCanal = await client.query(
          "SELECT activo FROM notificacion_canales WHERE canal = 'EMAIL'"
        );
        assert.strictEqual(resCanal.rows[0].activo, true);

        // Verificar que el otro perfil conserva el permiso
        const resOtroPerfil = await client.query(`
          SELECT 1
          FROM perfil_permiso pp
          JOIN perfiles p ON p.id = pp.perfil_id
          JOIN permisos pe ON pe.id = pp.permiso_id
          WHERE pe.codigo = 'CONFIGURACION_GESTIONAR' AND p.nombre = 'RESPONSABLE_MANTENIMIENTO'
        `);
        assert.strictEqual(resOtroPerfil.rows.length, 1);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  } finally {
    client.release();
  }
});
