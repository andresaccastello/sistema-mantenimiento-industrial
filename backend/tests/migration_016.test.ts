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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 016 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 016 — Repuestos, stock y pedidos: base de datos', async (t) => {
  let client = await pool.connect();

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/016_repuestos_stock.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    // M16-01: Aplicar dos veces seguidas sin error
    await t.test('M16-01: Aplicar migración 016_repuestos_stock.sql dos veces sin error', async () => {
      await client.query(sqlContent);
      await client.query(sqlContent);
      assert.ok(true, 'Migración 016 aplicada dos veces con éxito');
    });

    // M16-02: Estructura
    await t.test('M16-02: Existen las tablas y columnas nuevas', async () => {
      // Tablas nuevas
      const resTables = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('proveedores', 'repuesto_costos', 'pedidos_repuesto')
      `);
      assert.strictEqual(resTables.rows.length, 3);

      // Columnas repuestos
      const resRep = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'repuestos'
          AND column_name IN ('codigo', 'unidad', 'lleva_stock', 'stock_minimo', 'proveedor_id', 'ubicacion', 'descripcion')
      `);
      assert.strictEqual(resRep.rows.length, 7);

      // Columnas movimientos_stock
      const resMov = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'movimientos_stock'
          AND column_name IN ('delta', 'stock_resultante', 'proveedor_id', 'comprobante')
      `);
      assert.strictEqual(resMov.rows.length, 4);

      // Columnas intervencion_repuestos
      const resIntRep = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'intervencion_repuestos'
          AND column_name IN ('registrado_por_usuario_id', 'observacion', 'movimiento_id', 'anulado_en', 'anulado_por_usuario_id', 'motivo_anulacion', 'devolucion_movimiento_id')
      `);
      assert.strictEqual(resIntRep.rows.length, 7);
    });

    // M16-03: repuestos y proveedores
    await t.test('M16-03: Restricciones de repuestos y proveedores', async () => {
      // 1. sin control de stock y con cantidad mayor que 0 -> rechaza
      await client.query('BEGIN');
      try {
        await assert.rejects(
          client.query(
            "INSERT INTO repuestos (nombre, lleva_stock, cantidad_disponible) VALUES ('R Sin Stock Positivo', FALSE, 5)"
          ),
          /ck_repuestos_lleva_stock/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // 2. sin control de stock y con mínimo -> rechaza
      await client.query('BEGIN');
      try {
        await assert.rejects(
          client.query(
            "INSERT INTO repuestos (nombre, lleva_stock, cantidad_disponible, stock_minimo) VALUES ('R Sin Stock Con Min', FALSE, 0, 10)"
          ),
          /ck_repuestos_lleva_stock/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // 3. mínimo negativo -> rechaza
      await client.query('BEGIN');
      try {
        await assert.rejects(
          client.query(
            "INSERT INTO repuestos (nombre, lleva_stock, stock_minimo) VALUES ('R Min Negativo', TRUE, -1)"
          ),
          /ck_repuestos_stock_minimo/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // 4. código repetido con otras mayúsculas -> rechaza
      await client.query('BEGIN');
      try {
        await client.query(
          "INSERT INTO repuestos (nombre, codigo) VALUES ('Repuesto A', 'cod-x-100')"
        );
        await assert.rejects(
          client.query(
            "INSERT INTO repuestos (nombre, codigo) VALUES ('Repuesto B', 'COD-X-100')"
          ),
          /uq_repuestos_codigo/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // 5. proveedor repetido con otras mayúsculas y espacios -> rechaza
      await client.query('BEGIN');
      try {
        await client.query(
          "INSERT INTO proveedores (nombre) VALUES ('Proveedor Alpha')"
        );
        await assert.rejects(
          client.query(
            "INSERT INTO proveedores (nombre) VALUES ('  proveedor alpha  ')"
          ),
          /uq_proveedores_nombre/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // Dos repuestos sin código se aceptan
      await client.query('BEGIN');
      try {
        const r1 = await client.query(
          "INSERT INTO repuestos (nombre, codigo) VALUES ('Repuesto Sin Cod 1', NULL) RETURNING id"
        );
        const r2 = await client.query(
          "INSERT INTO repuestos (nombre, codigo) VALUES ('Repuesto Sin Cod 2', NULL) RETURNING id"
        );
        assert.ok(r1.rows[0].id);
        assert.ok(r2.rows[0].id);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // M16-04: movimientos_stock
    await t.test('M16-04: Restricciones de movimientos_stock', async () => {
      const resUser = await client.query('SELECT id FROM usuarios WHERE activo = TRUE LIMIT 1');
      const userId = resUser.rows[0].id;

      // DEVOLUCION con delta = cantidad se acepta
      await client.query('BEGIN');
      try {
        const repRes = await client.query(
          "INSERT INTO repuestos (nombre, lleva_stock, cantidad_disponible) VALUES ('R Para Movimientos', TRUE, 10) RETURNING id"
        );
        const repId = repRes.rows[0].id;

        const movDev = await client.query(
          `INSERT INTO movimientos_stock (repuesto_id, tipo, cantidad, delta, stock_resultante, realizado_por_usuario_id)
           VALUES ($1, 'DEVOLUCION', 2, 2, 12, $2) RETURNING id`,
          [repId, userId]
        );
        assert.ok(movDev.rows[0].id);
      } finally {
        await client.query('ROLLBACK');
      }

      // INGRESO con delta negativo se rechaza
      await client.query('BEGIN');
      try {
        const repRes = await client.query(
          "INSERT INTO repuestos (nombre, lleva_stock, cantidad_disponible) VALUES ('R Para Movimientos', TRUE, 10) RETURNING id"
        );
        const repId = repRes.rows[0].id;

        await assert.rejects(
          client.query(
            `INSERT INTO movimientos_stock (repuesto_id, tipo, cantidad, delta, stock_resultante, realizado_por_usuario_id)
             VALUES ($1, 'INGRESO', 2, -2, 8, $2)`,
            [repId, userId]
          ),
          /ck_movimientos_stock_delta_tipo/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // EGRESO con delta positivo se rechaza
      await client.query('BEGIN');
      try {
        const repRes = await client.query(
          "INSERT INTO repuestos (nombre, lleva_stock, cantidad_disponible) VALUES ('R Para Movimientos', TRUE, 10) RETURNING id"
        );
        const repId = repRes.rows[0].id;

        await assert.rejects(
          client.query(
            `INSERT INTO movimientos_stock (repuesto_id, tipo, cantidad, delta, stock_resultante, realizado_por_usuario_id)
             VALUES ($1, 'EGRESO', 2, 2, 12, $2)`,
            [repId, userId]
          ),
          /ck_movimientos_stock_delta_tipo/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // delta sin stock_resultante se rechaza
      await client.query('BEGIN');
      try {
        const repRes = await client.query(
          "INSERT INTO repuestos (nombre, lleva_stock, cantidad_disponible) VALUES ('R Para Movimientos', TRUE, 10) RETURNING id"
        );
        const repId = repRes.rows[0].id;

        await assert.rejects(
          client.query(
            `INSERT INTO movimientos_stock (repuesto_id, tipo, cantidad, delta, stock_resultante, realizado_por_usuario_id)
             VALUES ($1, 'INGRESO', 2, 2, NULL, $2)`,
            [repId, userId]
          ),
          /ck_movimientos_stock_delta_resultante/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // stock_resultante negativo se rechaza
      await client.query('BEGIN');
      try {
        const repRes = await client.query(
          "INSERT INTO repuestos (nombre, lleva_stock, cantidad_disponible) VALUES ('R Para Movimientos', TRUE, 10) RETURNING id"
        );
        const repId = repRes.rows[0].id;

        await assert.rejects(
          client.query(
            `INSERT INTO movimientos_stock (repuesto_id, tipo, cantidad, delta, stock_resultante, realizado_por_usuario_id)
             VALUES ($1, 'EGRESO', 15, -15, -5, $2)`,
            [repId, userId]
          ),
          /ck_movimientos_stock_resultante/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // Una fila sin delta ni stock_resultante se acepta
      await client.query('BEGIN');
      try {
        const repRes = await client.query(
          "INSERT INTO repuestos (nombre, lleva_stock, cantidad_disponible) VALUES ('R Para Movimientos', TRUE, 10) RETURNING id"
        );
        const repId = repRes.rows[0].id;

        const movViejo = await client.query(
          `INSERT INTO movimientos_stock (repuesto_id, tipo, cantidad, delta, stock_resultante, realizado_por_usuario_id)
           VALUES ($1, 'INGRESO', 5, NULL, NULL, $2) RETURNING id`,
          [repId, userId]
        );
        assert.ok(movViejo.rows[0].id);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // M16-05: intervencion_repuestos
    await t.test('M16-05: Restricciones de intervencion_repuestos', async () => {
      const resUser = await client.query('SELECT id FROM usuarios WHERE activo = TRUE LIMIT 1');
      const userId = resUser.rows[0].id;
      const resInt = await client.query('SELECT id FROM intervenciones LIMIT 1');
      const intId = resInt.rows[0].id;

      await client.query('BEGIN');
      try {
        const repRes = await client.query(
          "INSERT INTO repuestos (nombre, lleva_stock, cantidad_disponible) VALUES ('R Para Intervencion', TRUE, 10) RETURNING id"
        );
        const repId = repRes.rows[0].id;

        // INSERT con solo las 4 columnas de siempre se acepta
        const resBasico = await client.query(
          `INSERT INTO intervencion_repuestos (intervencion_id, repuesto_id, cantidad, costo_unitario_aplicado)
           VALUES ($1, $2, 2, 100) RETURNING id`,
          [intId, repId]
        );
        assert.ok(resBasico.rows[0].id);

        // anulado_en sin motivo se rechaza
        await assert.rejects(
          client.query(
            `INSERT INTO intervencion_repuestos (intervencion_id, repuesto_id, cantidad, costo_unitario_aplicado, anulado_en, anulado_por_usuario_id)
             VALUES ($1, $2, 2, 100, NOW(), $3)`,
            [intId, repId, userId]
          ),
          /ck_intervencion_repuestos_anulacion/i
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // M16-06: pedidos_repuesto
    await t.test('M16-06: Restricciones de pedidos_repuesto', async () => {
      const resUser = await client.query('SELECT id FROM usuarios WHERE activo = TRUE LIMIT 1');
      const userId = resUser.rows[0].id;
      const resInt = await client.query('SELECT id FROM intervenciones LIMIT 1');
      const intId = resInt.rows[0].id;

      // sin repuesto y sin descripción se rechaza
      await client.query('BEGIN');
      try {
        await assert.rejects(
          client.query(
            `INSERT INTO pedidos_repuesto (intervencion_id, cantidad, creado_por_usuario_id)
             VALUES ($1, 2, $2)`,
            [intId, userId]
          ),
          /ck_pedidos_repuesto_item/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // PEDIDO sin pedido_en se rechaza
      await client.query('BEGIN');
      try {
        const repRes = await client.query(
          "INSERT INTO repuestos (nombre) VALUES ('R Para Pedidos') RETURNING id"
        );
        const repId = repRes.rows[0].id;

        await assert.rejects(
          client.query(
            `INSERT INTO pedidos_repuesto (intervencion_id, repuesto_id, cantidad, estado, creado_por_usuario_id)
             VALUES ($1, $2, 2, 'PEDIDO', $3)`,
            [intId, repId, userId]
          ),
          /ck_pedidos_repuesto_transiciones/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // CANCELADO sin motivo se rechaza
      await client.query('BEGIN');
      try {
        const repRes = await client.query(
          "INSERT INTO repuestos (nombre) VALUES ('R Para Pedidos') RETURNING id"
        );
        const repId = repRes.rows[0].id;

        await assert.rejects(
          client.query(
            `INSERT INTO pedidos_repuesto (intervencion_id, repuesto_id, cantidad, estado, creado_por_usuario_id)
             VALUES ($1, $2, 2, 'CANCELADO', $3)`,
            [intId, repId, userId]
          ),
          /ck_pedidos_repuesto_transiciones/i
        );
      } finally {
        await client.query('ROLLBACK');
      }

      // esperado_para anterior a pedido_en se rechaza
      await client.query('BEGIN');
      try {
        const repRes = await client.query(
          "INSERT INTO repuestos (nombre) VALUES ('R Para Pedidos') RETURNING id"
        );
        const repId = repRes.rows[0].id;

        await assert.rejects(
          client.query(
            `INSERT INTO pedidos_repuesto (intervencion_id, repuesto_id, cantidad, estado, pedido_en, esperado_para, creado_por_usuario_id)
             VALUES ($1, $2, 2, 'PEDIDO', '2026-11-10', '2026-11-05', $3)`,
            [intId, repId, userId]
          ),
          /ck_pedidos_repuesto_fechas/i
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // M16-07: Proveedores desde el texto
    await t.test('M16-07: Proveedores desde el texto', async () => {
      const sqlSinTransaccion = sqlContent
        .replace(/^\s*BEGIN;\s*/im, '')
        .replace(/\s*COMMIT;\s*$/im, '');

      await client.query('BEGIN');
      try {
        const r1 = await client.query(
          "INSERT INTO repuestos (nombre, proveedor) VALUES ('Repuesto Casa Uno A', ' Casa Uno ') RETURNING id"
        );
        const r2 = await client.query(
          "INSERT INTO repuestos (nombre, proveedor) VALUES ('Repuesto Casa Uno B', 'casa uno') RETURNING id"
        );
        const id1 = r1.rows[0].id;
        const id2 = r2.rows[0].id;

        // Aplicar migración
        await client.query(sqlSinTransaccion);

        // Queda un solo proveedor
        const resProv = await client.query(
          "SELECT id, nombre FROM proveedores WHERE lower(trim(nombre)) = 'casa uno'"
        );
        assert.strictEqual(resProv.rows.length, 1);
        const provId = resProv.rows[0].id;

        // Los dos repuestos tienen su proveedor_id asignado
        const resR = await client.query(
          "SELECT id, proveedor_id FROM repuestos WHERE id IN ($1, $2) ORDER BY id",
          [id1, id2]
        );
        assert.strictEqual(resR.rows.length, 2);
        assert.strictEqual(resR.rows[0].proveedor_id, provId);
        assert.strictEqual(resR.rows[1].proveedor_id, provId);

        // Reaplicar otra vez no crea otro
        await client.query(sqlSinTransaccion);
        const resProv2 = await client.query(
          "SELECT id FROM proveedores WHERE lower(trim(nombre)) = 'casa uno'"
        );
        assert.strictEqual(resProv2.rows.length, 1);

        // Renombrar el proveedor y reaplicar: no se crea otro
        await client.query(
          "UPDATE proveedores SET nombre = 'Casa Uno SRL' WHERE id = $1",
          [provId]
        );
        await client.query(sqlSinTransaccion);
        const resProvViejo = await client.query(
          "SELECT id FROM proveedores WHERE lower(trim(nombre)) = 'casa uno'"
        );
        assert.strictEqual(resProvViejo.rows.length, 0);
        const resProvNuevo = await client.query(
          "SELECT id FROM proveedores WHERE lower(trim(nombre)) = 'casa uno srl'"
        );
        assert.strictEqual(resProvNuevo.rows.length, 1);

        // Dejar un repuesto con proveedor_id y proveedor en NULL, como lo deja la API, y reaplicar: sigue sin proveedor
        const r3 = await client.query(
          "INSERT INTO repuestos (nombre, proveedor_id, proveedor) VALUES ('Repuesto Sin Proveedor', NULL, NULL) RETURNING id"
        );
        const id3 = r3.rows[0].id;
        await client.query(sqlSinTransaccion);
        const resR3 = await client.query(
          "SELECT id, proveedor_id, proveedor FROM repuestos WHERE id = $1",
          [id3]
        );
        assert.strictEqual(resR3.rows[0].proveedor_id, null);
        assert.strictEqual(resR3.rows[0].proveedor, null);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // M16-08: Historial inicial
    await t.test('M16-08: Historial inicial', async () => {
      // Todo repuesto tiene al menos una fila en repuesto_costos
      const resFaltantes = await client.query(`
        SELECT r.id
        FROM repuestos r
        WHERE NOT EXISTS (
          SELECT 1 FROM repuesto_costos rc WHERE rc.repuesto_id = r.id
        )
      `);
      assert.strictEqual(resFaltantes.rows.length, 0);

      // Cantidad de filas antes de reaplicar
      const resCount1 = await client.query('SELECT count(*)::int as count FROM repuesto_costos');
      const count1 = resCount1.rows[0].count;

      // Reaplicar migración
      await client.query(sqlContent);

      const resCount2 = await client.query('SELECT count(*)::int as count FROM repuesto_costos');
      const count2 = resCount2.rows[0].count;
      assert.strictEqual(count1, count2);
    });

  } finally {
    client = await clienteSano(client);
    client.release();
  }
});
