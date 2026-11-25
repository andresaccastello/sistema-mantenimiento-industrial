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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 025 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 025 — Avisos de parada crítica y de stock bajo (M25-01 a M25-05)', async (t) => {
  let client = await pool.connect();

  try {
    const leer = (archivo: string) =>
      fs.readFileSync(path.resolve(__dirname, '../../database/migrations', archivo), 'utf-8');
    const sql014 = leer('014_excepciones_permisos.sql');
    const sql015 = leer('015_avisos_email.sql');
    const sql025 = leer('025_avisos_criticos.sql');

    // =========================================================================
    await t.test('M25-01: La 015 y la 025 se aplican dos veces sin error', async () => {
      await client.query(sql015);
      await client.query(sql025);
      await client.query(sql015);
      await client.query(sql025);
    });

    // =========================================================================
    await t.test('M25-02: Las columnas', async () => {
      const col = async (tabla: string, columna: string) =>
        (await client.query(
          `SELECT data_type, is_nullable, column_default FROM information_schema.columns
           WHERE table_name = $1 AND column_name = $2`,
          [tabla, columna]
        )).rows[0];

      assert.deepStrictEqual(await col('notificaciones', 'repuesto_id'), { data_type: 'bigint', is_nullable: 'YES', column_default: null });
      assert.deepStrictEqual(await col('repuestos', 'stock_bajo_avisado_en'), {
        data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null,
      });
      const sw = await col('configuracion_sistema', 'critico_por_detencion_posterior');
      assert.deepStrictEqual([sw.data_type, sw.is_nullable, sw.column_default], ['boolean', 'NO', 'true']);

      const fk = await client.query(
        `SELECT confrelid::regclass::text AS tabla FROM pg_constraint
         WHERE conrelid = 'notificaciones'::regclass AND contype = 'f'
           AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'notificaciones'::regclass AND attname = 'repuesto_id')]`
      );
      assert.deepStrictEqual(fk.rows.map((x) => x.tabla), ['repuestos']);
    });

    // =========================================================================
    await t.test('M25-03: Las 24 reglas, con las 4 nuevas', async () => {
      const total = (await client.query('SELECT count(*)::int AS n FROM notificacion_reglas')).rows[0].n;
      assert.strictEqual(total, 24);
      const nuevas = await client.query(
        `SELECT tipo_evento, canal, modo FROM notificacion_reglas
         WHERE tipo_evento IN ('PARADA_CRITICA', 'STOCK_BAJO') ORDER BY tipo_evento, canal`
      );
      assert.deepStrictEqual(nuevas.rows.map((x) => [x.tipo_evento, x.canal, x.modo]), [
        ['PARADA_CRITICA', 'EMAIL', 'SIEMPRE'],
        ['PARADA_CRITICA', 'WHATSAPP', 'NUNCA'],
        ['STOCK_BAJO', 'EMAIL', 'SIEMPRE'],
        ['STOCK_BAJO', 'WHATSAPP', 'NUNCA'],
      ]);

      // Un tipo fuera de la lista sigue rechazado
      await client.query('BEGIN');
      try {
        await assert.rejects(
          client.query(`INSERT INTO notificacion_reglas (tipo_evento, canal, modo) VALUES ('OTRO_TIPO', 'EMAIL', 'NUNCA')`),
          (err: any) => err.code === '23514'
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // =========================================================================
    await t.test('M25-04: Los permisos y sus alcances, también después de reaplicar la 014', async () => {
      const revisar = async (cuando: string) => {
        const p = await client.query(
          `SELECT codigo, nombre, usa_alcance FROM permisos
           WHERE codigo IN ('NOTIFICACIONES_CRITICAS_RECIBIR', 'NOTIFICACIONES_STOCK_RECIBIR') ORDER BY codigo`
        );
        assert.deepStrictEqual(p.rows.map((x) => [x.codigo, x.nombre, x.usa_alcance]), [
          ['NOTIFICACIONES_CRITICAS_RECIBIR', 'Recibir avisos de paradas críticas', true],
          ['NOTIFICACIONES_STOCK_RECIBIR', 'Recibir avisos de stock bajo', false],
        ], cuando);
        const pp = await client.query(
          `SELECT pe.codigo, pf.nombre, pp.alcance FROM perfil_permiso pp
           JOIN perfiles pf ON pf.id = pp.perfil_id
           JOIN permisos pe ON pe.id = pp.permiso_id
           WHERE pe.codigo IN ('NOTIFICACIONES_CRITICAS_RECIBIR', 'NOTIFICACIONES_STOCK_RECIBIR')
           ORDER BY pe.codigo, pf.nombre`
        );
        assert.deepStrictEqual(pp.rows.map((x) => [x.codigo, x.nombre, x.alcance]), [
          ['NOTIFICACIONES_CRITICAS_RECIBIR', 'ADMINISTRADOR', 'TODAS'],
          ['NOTIFICACIONES_CRITICAS_RECIBIR', 'CONSULTA', 'TODAS'],
          ['NOTIFICACIONES_CRITICAS_RECIBIR', 'RESPONSABLE_MANTENIMIENTO', 'TODAS'],
          ['NOTIFICACIONES_STOCK_RECIBIR', 'ADMINISTRADOR', 'TODAS'],
          ['NOTIFICACIONES_STOCK_RECIBIR', 'RESPONSABLE_MANTENIMIENTO', 'TODAS'],
        ], cuando);
      };
      await revisar('Después de la 025');
      await client.query(sql014);
      await revisar('Después de reaplicar la 014');
    });

    // =========================================================================
    await t.test('M25-05: Reaplicar la 025 no pisa el switch', async () => {
      const inicio = (await client.query('SELECT critico_por_detencion_posterior AS v FROM configuracion_sistema WHERE id = 1')).rows[0].v;
      await client.query('BEGIN');
      try {
        await client.query('UPDATE configuracion_sistema SET critico_por_detencion_posterior = $1 WHERE id = 1', [!inicio]);
        await client.query(sql025.replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, ''));
        const despues = (await client.query('SELECT critico_por_detencion_posterior AS v FROM configuracion_sistema WHERE id = 1')).rows[0].v;
        assert.strictEqual(despues, !inicio);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  } finally {
    client = await clienteSano(client);
    client.release();
  }
});
