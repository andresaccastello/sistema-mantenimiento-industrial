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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 012 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 012 — Marca configurable por instalación', async (t) => {
  const client = await pool.connect();
  let configPrevia: {
    nombre_sistema: string;
    nombre_empresa: string | null;
    logo: Buffer | null;
    logo_tipo: string | null;
  } | null = null;

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/012_configuracion.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    // Leer y guardar los valores previos si la tabla ya existe
    try {
      const resPrev = await client.query(
        'SELECT nombre_sistema, nombre_empresa, logo, logo_tipo FROM configuracion_sistema WHERE id = 1'
      );
      if (resPrev.rows.length > 0) {
        configPrevia = resPrev.rows[0];
      }
    } catch {
      // La tabla aún no existe antes de correr M12-01.1
    }

    // 1. Aplicación limpia de la migración
    await t.test('M12-01.1: Aplicar migración 012_configuracion.sql', async () => {
      await client.query(sqlContent);
      assert.ok(true, 'Migración 012 ejecutada exitosamente');
    });

    if (!configPrevia) {
      const resPrev = await client.query(
        'SELECT nombre_sistema, nombre_empresa, logo, logo_tipo FROM configuracion_sistema WHERE id = 1'
      );
      if (resPrev.rows.length > 0) {
        configPrevia = resPrev.rows[0];
      }
    }

    // 2. Idempotencia
    await t.test('M12-01.2: Idempotencia: ejecutar la migración dos veces no falla', async () => {
      await client.query(sqlContent);
      assert.ok(true, 'Segunda ejecución completada sin errores');
    });

    // 3. La tabla existe y la fila 1 existe con valores por omisión
    await t.test('M12-01.3: Tabla configuracion_sistema y fila id=1 existen', async () => {
      const res = await client.query('SELECT * FROM configuracion_sistema WHERE id = 1');
      assert.strictEqual(res.rows.length, 1, 'Debe existir la fila con id = 1');
      const row = res.rows[0];
      assert.strictEqual(row.nombre_sistema, 'Sistema de Mantenimiento Industrial');
      assert.ok(row.actualizado_en, 'Debe tener actualizado_en');

      const resCols = await client.query(`
        SELECT column_name, column_default
        FROM information_schema.columns
        WHERE table_name = 'configuracion_sistema'
          AND column_name IN ('nombre_empresa', 'logo', 'logo_tipo')
      `);
      assert.strictEqual(resCols.rows.length, 3, 'Deben existir las columnas nombre_empresa, logo y logo_tipo');
      for (const col of resCols.rows) {
        assert.strictEqual(col.column_default, null, `La columna ${col.column_name} debe tener column_default IS NULL`);
      }
    });

    // 4. Un segundo INSERT con id = 2 falla
    await t.test('M12-01.4: Un segundo INSERT con id = 2 falla por restricción CHECK (id = 1)', async () => {
      await assert.rejects(
        async () => {
          await client.query(
            "INSERT INTO configuracion_sistema (id, nombre_sistema) VALUES (2, 'Otra Empresa')"
          );
        },
        (err: any) => {
          return err.message.includes('ck_configuracion_id') || err.code === '23514';
        },
        'Debe rechazar id != 1'
      );
    });

    // 5. Logo de más de 300 KB (307200 bytes) falla
    await t.test('M12-01.5: Logo de más de 300 KB (307201 bytes) falla por restricción de tamaño', async () => {
      const bufferGrande = Buffer.alloc(307201, 1);
      await assert.rejects(
        async () => {
          await client.query(
            "UPDATE configuracion_sistema SET logo = $1, logo_tipo = 'image/png' WHERE id = 1",
            [bufferGrande]
          );
        },
        (err: any) => {
          return err.message.includes('ck_configuracion_logo_tamano') || err.code === '23514';
        },
        'Debe rechazar logo > 300 KB'
      );
    });

    // 6. Tipo image/svg+xml falla
    await t.test('M12-01.6: Tipo de logo image/svg+xml falla por restricción de tipo', async () => {
      const bufferSvg = Buffer.from('<svg></svg>');
      await assert.rejects(
        async () => {
          await client.query(
            "UPDATE configuracion_sistema SET logo = $1, logo_tipo = 'image/svg+xml' WHERE id = 1",
            [bufferSvg]
          );
        },
        (err: any) => {
          return err.message.includes('ck_configuracion_logo_tipo') || err.code === '23514';
        },
        'Debe rechazar SVG'
      );
    });

    // 7. Coherencia: logo sin logo_tipo o logo_tipo sin logo falla
    await t.test('M12-01.7: Coherencia logo y logo_tipo', async () => {
      const bufferPng = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      await assert.rejects(
        async () => {
          await client.query(
            'UPDATE configuracion_sistema SET logo = $1, logo_tipo = NULL WHERE id = 1',
            [bufferPng]
          );
        },
        (err: any) => err.code === '23514',
        'Debe rechazar logo sin logo_tipo'
      );

      await assert.rejects(
        async () => {
          await client.query(
            "UPDATE configuracion_sistema SET logo = NULL, logo_tipo = 'image/png' WHERE id = 1"
          );
        },
        (err: any) => err.code === '23514',
        'Debe rechazar logo_tipo sin logo'
      );
    });
  } finally {
    // Restaurar los valores guardados de la fila 1
    if (configPrevia) {
      await client.query(
        `UPDATE configuracion_sistema
         SET nombre_sistema = $1,
             nombre_empresa = $2,
             logo = $3,
             logo_tipo = $4,
             actualizado_en = NOW()
         WHERE id = 1`,
        [
          configPrevia.nombre_sistema,
          configPrevia.nombre_empresa,
          configPrevia.logo,
          configPrevia.logo_tipo,
        ]
      );
    }
    client.release();
  }
});
