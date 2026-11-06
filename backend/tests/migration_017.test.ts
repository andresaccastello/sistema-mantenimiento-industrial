import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pool } from '../functions/db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 017 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

interface Base {
  plantaId: number;
  sectorId: number;
  maquinaId: number;
  usuarioId: number;
  proveedorId: number;
  intervencionId: number;
}

/**
 * Crea, dentro de la transacción abierta, una planta, un sector, una máquina,
 * un usuario, un proveedor y una intervención. Todo se revierte con ROLLBACK.
 */
async function crearBase(client: pg.PoolClient, costoManoObra = 0): Promise<Base> {
  const suf = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  const resPerfil = await client.query(`SELECT id FROM perfiles WHERE nombre = 'OPERARIO'`);
  const resTipo = await client.query('SELECT id FROM tipos_intervencion ORDER BY id LIMIT 1');

  const resPl = await client.query(
    'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id',
    [`PL_M17_${suf}`]
  );
  const resS = await client.query(
    'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id',
    [`S_M17_${suf}`, resPl.rows[0].id]
  );
  const resM = await client.query(
    'INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, TRUE) RETURNING id',
    [`M17_${suf}`, `Maquina M17 ${suf}`, resS.rows[0].id]
  );
  const resU = await client.query(
    `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
     VALUES ($1, 'Persona', 'M17', 'x', $2, TRUE, 1) RETURNING id`,
    [`U_M17_${suf}`, resPerfil.rows[0].id]
  );
  const resP = await client.query(
    'INSERT INTO proveedores (nombre) VALUES ($1) RETURNING id',
    [`Prov M17 ${suf}`]
  );
  const resI = await client.query(
    `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, costo_mano_obra)
     VALUES ($1, $2, $3, 'Prueba M17', $4) RETURNING id`,
    [resM.rows[0].id, resTipo.rows[0].id, resU.rows[0].id, costoManoObra]
  );

  return {
    plantaId: Number(resPl.rows[0].id),
    sectorId: Number(resS.rows[0].id),
    maquinaId: Number(resM.rows[0].id),
    usuarioId: Number(resU.rows[0].id),
    proveedorId: Number(resP.rows[0].id),
    intervencionId: Number(resI.rows[0].id),
  };
}

test('Migración 017 — Renglones de costo con mano de obra por persona', async (t) => {
  const client = await pool.connect();

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/017_costos_renglones.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    // M17-01: Aplicar dos veces seguidas sin error
    await t.test('M17-01: Aplicar la migración 017 dos veces sin error', async () => {
      await client.query(sqlContent);
      await client.query(sqlContent);
      assert.ok(true, 'Migración 017 aplicada dos veces');
    });

    // M17-02: Estructura
    await t.test('M17-02: Existen las cuatro columnas nuevas', async () => {
      const res = await client.query(`
        SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'intervencion_costos'
          AND column_name IN ('usuario_id', 'proveedor_id', 'horas', 'valor_hora')
        ORDER BY column_name
      `);
      assert.strictEqual(res.rows.length, 4);
      const porNombre: Record<string, any> = {};
      for (const r of res.rows) porNombre[r.column_name] = r;

      assert.strictEqual(porNombre.horas.data_type, 'numeric');
      assert.strictEqual(Number(porNombre.horas.numeric_precision), 8);
      assert.strictEqual(Number(porNombre.horas.numeric_scale), 2);
      assert.strictEqual(porNombre.valor_hora.data_type, 'numeric');
      assert.strictEqual(Number(porNombre.valor_hora.numeric_precision), 14);
      assert.strictEqual(Number(porNombre.valor_hora.numeric_scale), 2);
      for (const col of ['usuario_id', 'proveedor_id', 'horas', 'valor_hora']) {
        assert.strictEqual(porNombre[col].is_nullable, 'YES', `${col} admite nulos`);
      }

      // Índices parciales
      const resIdx = await client.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'intervencion_costos'
          AND indexname IN ('idx_intervencion_costos_usuario', 'idx_intervencion_costos_proveedor')
      `);
      assert.strictEqual(resIdx.rows.length, 2);
    });

    // M17-03: Restricciones
    await t.test('M17-03: Restricciones de los renglones', async () => {
      await client.query('BEGIN');
      try {
        const base = await crearBase(client);
        const { usuarioId, proveedorId, intervencionId } = base;

        const insertar = (campos: {
          tipo: string;
          importe: number;
          usuario_id?: number | null;
          proveedor_id?: number | null;
          horas?: number | null;
          valor_hora?: number | null;
          motivo?: string | null;
        }) =>
          client.query(
            `INSERT INTO intervencion_costos (
               intervencion_id, tipo, descripcion, importe, usuario_id, proveedor_id,
               horas, valor_hora, motivo, registrado_por_usuario_id
             ) VALUES ($1, $2, 'Renglón M17', $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [
              intervencionId,
              campos.tipo,
              campos.importe,
              campos.usuario_id ?? null,
              campos.proveedor_id ?? null,
              campos.horas ?? null,
              campos.valor_hora ?? null,
              campos.motivo ?? null,
              usuarioId,
            ]
          );

        // Cada rechazo, en su punto de guardado
        const rechaza = async (nombre: string, campos: Parameters<typeof insertar>[0], regex: RegExp) => {
          await client.query('SAVEPOINT caso');
          await assert.rejects(insertar(campos), regex, nombre);
          await client.query('ROLLBACK TO SAVEPOINT caso');
        };

        await rechaza('MANO_OBRA sin horas', { tipo: 'MANO_OBRA', importe: 100, usuario_id: usuarioId }, /ck_intervencion_costos_mo_persona/);
        await rechaza(
          'MANO_OBRA con usuario y proveedor',
          { tipo: 'MANO_OBRA', importe: 100, horas: 1, usuario_id: usuarioId, proveedor_id: proveedorId },
          /ck_intervencion_costos_mo_persona/
        );
        await rechaza('MANO_OBRA sin persona', { tipo: 'MANO_OBRA', importe: 100, horas: 1 }, /ck_intervencion_costos_mo_persona/);
        await rechaza('horas en TRANSPORTE', { tipo: 'TRANSPORTE', importe: 100, horas: 1 }, /ck_intervencion_costos_mo_horas/);
        await rechaza('usuario_id en OTRO', { tipo: 'OTRO', importe: 100, usuario_id: usuarioId }, /ck_intervencion_costos_usuario_mo/);
        await rechaza('valor_hora sin horas', { tipo: 'OTRO', importe: 100, valor_hora: 50 }, /ck_intervencion_costos_valor_hora/);
        await rechaza(
          'valor_hora con importe distinto de horas × valor hora',
          { tipo: 'MANO_OBRA', importe: 300, horas: 2, valor_hora: 100, usuario_id: usuarioId },
          /ck_intervencion_costos_valor_hora/
        );
        await rechaza('AJUSTE de 0', { tipo: 'AJUSTE', importe: 0, motivo: 'Ajuste en cero' }, /ck_intervencion_costos_ajuste/);
        await rechaza('AJUSTE sin motivo', { tipo: 'AJUSTE', importe: -100 }, /ck_intervencion_costos_ajuste/);

        // Se aceptan
        const r1 = await insertar({ tipo: 'MANO_OBRA', importe: 3000, horas: 2.5, valor_hora: 1200, usuario_id: usuarioId });
        assert.ok(r1.rows[0].id, 'MANO_OBRA de 2,5 h × 1200 con importe 3000');

        const r2 = await insertar({ tipo: 'MANO_OBRA', importe: 20000, horas: 4, proveedor_id: proveedorId });
        assert.ok(r2.rows[0].id, 'MANO_OBRA externa de 4 h sin valor hora, con importe 20000');

        const r3 = await insertar({ tipo: 'AJUSTE', importe: -1000, motivo: 'Descuento acordado' });
        assert.ok(r3.rows[0].id, 'AJUSTE de −1000 con motivo');
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // M17-04: Costos cargados antes
    await t.test('M17-04: Una intervención con costos cargados a mano hace fallar la migración', async () => {
      let base: Base | null = null;
      await client.query('BEGIN');
      try {
        base = await crearBase(client, 100);
        const idEsperado = String(base.intervencionId);

        await assert.rejects(client.query(sqlContent), (err: Error) => {
          assert.match(err.message, /Hay intervenciones con costos cargados a mano: .*Revisarlas antes de migrar\./);
          assert.ok(
            err.message.split(/[:.]/)[1].split(',').map((s) => s.trim()).includes(idEsperado),
            `El mensaje nombra la intervención ${idEsperado}: ${err.message}`
          );
          return true;
        });
      } finally {
        await client.query('ROLLBACK');
      }

      // Si la migración no hubiera fallado, su COMMIT habría guardado los datos:
      // se borran (son todos de la prueba) y la prueba falla.
      if (base) {
        const b: Base = base;
        const resQueda = await client.query('SELECT 1 FROM intervenciones WHERE id = $1', [b.intervencionId]);
        if (resQueda.rows.length > 0) {
          await client.query('DELETE FROM intervenciones WHERE id = $1', [b.intervencionId]);
          await client.query('DELETE FROM maquinas WHERE id = $1', [b.maquinaId]);
          await client.query('DELETE FROM usuarios WHERE id = $1', [b.usuarioId]);
          await client.query('DELETE FROM proveedores WHERE id = $1', [b.proveedorId]);
          await client.query('DELETE FROM sectores WHERE id = $1', [b.sectorId]);
          await client.query('DELETE FROM plantas WHERE id = $1', [b.plantaId]);
        }
        assert.strictEqual(resQueda.rows.length, 0, 'No quedan datos de la prueba');
      }
    });
  } finally {
    client.release();
  }
});
