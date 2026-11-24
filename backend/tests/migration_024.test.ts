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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 024 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 024 — Tareas de rutina (M24-01 a M24-07)', async (t) => {
  let client = await pool.connect();

  try {
    const leer = (archivo: string) =>
      fs.readFileSync(path.resolve(__dirname, '../../database/migrations', archivo), 'utf-8');
    const sql024 = leer('024_rutinas.sql');
    const sql014 = leer('014_excepciones_permisos.sql');

    /**
     * Corre `fn` dentro de una transacción que siempre se deshace: los datos de prueba no quedan.
     * Cada intento que tiene que fallar va con su savepoint.
     */
    async function enTransaccion(fn: (base: { maquina: number; usuario: number }) => Promise<void>) {
      await client.query('BEGIN');
      try {
        const suf = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
        const planta = (await client.query(`INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id`, [`M24_P_${suf}`])).rows[0].id;
        const sector = (await client.query(
          `INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id`, [`M24_S_${suf}`, planta]
        )).rows[0].id;
        const maquina = Number((await client.query(
          `INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, 'Maquina M24', $2, TRUE) RETURNING id`,
          [`M24_M_${suf}`, sector]
        )).rows[0].id);
        const usuario = Number((await client.query('SELECT id FROM usuarios WHERE es_sistema')).rows[0].id);
        await fn({ maquina, usuario });
      } finally {
        await client.query('ROLLBACK');
      }
    }

    async function falla(sql: string, params: unknown[], codigo: string, mensaje: string) {
      await client.query('SAVEPOINT intento');
      try {
        await client.query(sql, params);
        assert.fail(`${mensaje}: tenía que fallar`);
      } catch (err: any) {
        if (err?.code === 'ERR_ASSERTION') throw err;
        assert.strictEqual(err.code, codigo, `${mensaje}: ${err.message}`);
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT intento');
      }
    }

    const INSERT_RUTINA = `INSERT INTO rutinas (maquina_id, descripcion, frecuencia, incluye_sabado, activa, baja_en, vigente_desde, creado_por_usuario_id)
                           VALUES ($1, $2, $3, $4, $5, $6, DATE '2026-11-02', $7) RETURNING id`;

    // =========================================================================
    await t.test('M24-01: Aplicar dos veces no da error', async () => {
      await client.query(sql024);
      await client.query(sql024);
      const r = await client.query(`SELECT to_regclass('public.rutinas') AS a, to_regclass('public.rutina_registros') AS b`);
      assert.ok(r.rows[0].a && r.rows[0].b);
    });

    // =========================================================================
    await t.test('M24-02: Tablas y columnas', async () => {
      const cols = async (tabla: string) =>
        Object.fromEntries((await client.query(
          `SELECT column_name, data_type, is_nullable, character_maximum_length
           FROM information_schema.columns WHERE table_name = $1`,
          [tabla]
        )).rows.map((x) => [x.column_name, [x.data_type, x.is_nullable, x.character_maximum_length]]));

      assert.deepStrictEqual(await cols('rutinas'), {
        id: ['bigint', 'NO', null],
        maquina_id: ['bigint', 'NO', null],
        descripcion: ['character varying', 'NO', 200],
        frecuencia: ['character varying', 'NO', 7],
        incluye_sabado: ['boolean', 'NO', null],
        activa: ['boolean', 'NO', null],
        vigente_desde: ['date', 'NO', null],
        baja_en: ['date', 'YES', null],
        creado_por_usuario_id: ['bigint', 'NO', null],
        creado_en: ['timestamp with time zone', 'NO', null],
        actualizado_en: ['timestamp with time zone', 'NO', null],
      });
      assert.deepStrictEqual(await cols('rutina_registros'), {
        id: ['bigint', 'NO', null],
        rutina_id: ['bigint', 'NO', null],
        periodo: ['date', 'NO', null],
        usuario_id: ['bigint', 'NO', null],
        hecha_en: ['timestamp with time zone', 'NO', null],
        nota: ['character varying', 'YES', 500],
      });

      // La FK de los registros, sin CASCADE
      const fk = await client.query(
        `SELECT confdeltype FROM pg_constraint
         WHERE conrelid = 'rutina_registros'::regclass AND contype = 'f' AND confrelid = 'rutinas'::regclass`
      );
      assert.deepStrictEqual(fk.rows.map((x) => x.confdeltype), ['a'], 'NO ACTION');

      const idx = await client.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'rutinas' ORDER BY indexname`);
      const nombres = idx.rows.map((x) => x.indexname);
      assert.ok(nombres.includes('idx_rutinas_maquina'));
      assert.ok(nombres.includes('uq_rutinas_maquina_descripcion'));
    });

    // =========================================================================
    await t.test('M24-03: Los CHECK', async () => {
      await enTransaccion(async ({ maquina, usuario }) => {
        await falla(INSERT_RUTINA, [maquina, 'Limpiar', 'MENSUAL', false, true, null, usuario], '23514', 'Frecuencia inválida');
        await falla(INSERT_RUTINA, [maquina, 'Limpiar', 'SEMANAL', true, true, null, usuario], '23514', 'Sábado en una semanal');
        await falla(INSERT_RUTINA, [maquina, 'Limpiar', 'DIARIA', false, true, '2026-11-10', usuario], '23514', 'Activa con baja');
        await falla(INSERT_RUTINA, [maquina, 'Limpiar', 'DIARIA', false, false, null, usuario], '23514', 'Inactiva sin baja');
        await falla(INSERT_RUTINA, [maquina, '   ', 'DIARIA', false, true, null, usuario], '23514', 'Descripción vacía');

        // Lo válido entra
        await client.query(INSERT_RUTINA, [maquina, 'Limpiar', 'DIARIA', true, true, null, usuario]);
        await client.query(INSERT_RUTINA, [maquina, 'Revisar', 'SEMANAL', false, false, '2026-11-10', usuario]);
      });
    });

    // =========================================================================
    await t.test('M24-04: Descripción única entre las activas de la máquina', async () => {
      await enTransaccion(async ({ maquina, usuario }) => {
        await client.query(INSERT_RUTINA, [maquina, 'Cambiar el agua', 'SEMANAL', false, true, null, usuario]);
        await falla(INSERT_RUTINA, [maquina, '  cambiar el AGUA ', 'DIARIA', false, true, null, usuario], '23505', 'Repetida entre activas');
        // Con la otra dada de baja, se puede
        await client.query(`UPDATE rutinas SET activa = FALSE, baja_en = DATE '2026-11-10' WHERE maquina_id = $1`, [maquina]);
        await client.query(INSERT_RUTINA, [maquina, 'Cambiar el agua', 'SEMANAL', false, true, null, usuario]);
        // Y una dada de baja repetida también
        await client.query(INSERT_RUTINA, [maquina, 'Cambiar el agua', 'SEMANAL', false, false, '2026-11-11', usuario]);
      });
    });

    // =========================================================================
    await t.test('M24-05: Una marca por período, y el lunes en las semanales', async () => {
      await enTransaccion(async ({ maquina, usuario }) => {
        const diaria = (await client.query(INSERT_RUTINA, [maquina, 'Diaria', 'DIARIA', false, true, null, usuario])).rows[0].id;
        const semanal = (await client.query(INSERT_RUTINA, [maquina, 'Semanal', 'SEMANAL', false, true, null, usuario])).rows[0].id;
        const INS = 'INSERT INTO rutina_registros (rutina_id, periodo, usuario_id) VALUES ($1, $2, $3)';

        await client.query(INS, [diaria, '2026-11-24', usuario]);
        await falla(INS, [diaria, '2026-11-24', usuario], '23505', 'Misma rutina y período');
        await client.query(INS, [diaria, '2026-11-25', usuario]);

        // 2026-11-23 es lunes; 2026-11-26, jueves
        await client.query(INS, [semanal, '2026-11-23', usuario]);
        await falla(INS, [semanal, '2026-11-26', usuario], '23514', 'Semanal en un jueves');
      });
    });

    // =========================================================================
    await t.test('M24-06: periodo_rutina y rutina_corresponde con fechas fijas', async () => {
      const r = (await client.query(
        `SELECT
           EXTRACT(ISODOW FROM DATE '2026-11-23')::int AS dow_lunes,
           EXTRACT(ISODOW FROM DATE '2026-11-28')::int AS dow_sabado,
           EXTRACT(ISODOW FROM DATE '2026-11-29')::int AS dow_domingo,
           to_char(periodo_rutina('DIARIA', DATE '2026-11-26'), 'YYYY-MM-DD') AS diaria_jueves,
           to_char(periodo_rutina('SEMANAL', DATE '2026-11-26'), 'YYYY-MM-DD') AS semanal_jueves,
           to_char(periodo_rutina('SEMANAL', DATE '2026-11-23'), 'YYYY-MM-DD') AS semanal_lunes,
           to_char(periodo_rutina('SEMANAL', DATE '2026-11-29'), 'YYYY-MM-DD') AS semanal_domingo,
           rutina_corresponde('DIARIA', FALSE, DATE '2026-11-23') AS diaria_lunes,
           rutina_corresponde('DIARIA', FALSE, DATE '2026-11-28') AS diaria_sabado_sin,
           rutina_corresponde('DIARIA', TRUE, DATE '2026-11-28') AS diaria_sabado_con,
           rutina_corresponde('DIARIA', TRUE, DATE '2026-11-29') AS diaria_domingo,
           rutina_corresponde('SEMANAL', FALSE, DATE '2026-11-29') AS semanal_domingo_corresponde,
           rutina_corresponde('SEMANAL', FALSE, DATE '2026-11-28') AS semanal_sabado`
      )).rows[0];
      assert.deepStrictEqual([r.dow_lunes, r.dow_sabado, r.dow_domingo], [1, 6, 7], 'Las fechas fijas');
      assert.strictEqual(r.diaria_jueves, '2026-11-26');
      assert.strictEqual(r.semanal_jueves, '2026-11-23');
      assert.strictEqual(r.semanal_lunes, '2026-11-23');
      assert.strictEqual(r.semanal_domingo, '2026-11-23');
      assert.strictEqual(r.diaria_lunes, true);
      assert.strictEqual(r.diaria_sabado_sin, false);
      assert.strictEqual(r.diaria_sabado_con, true);
      assert.strictEqual(r.diaria_domingo, false, 'El domingo nunca');
      assert.strictEqual(r.semanal_domingo_corresponde, true);
      assert.strictEqual(r.semanal_sabado, true);

      const vol = await client.query(
        `SELECT proname, provolatile FROM pg_proc WHERE proname IN ('periodo_rutina', 'rutina_corresponde') ORDER BY proname`
      );
      assert.deepStrictEqual(vol.rows.map((x) => [x.proname, x.provolatile]), [['periodo_rutina', 'i'], ['rutina_corresponde', 'i']]);
    });

    // =========================================================================
    await t.test('M24-07: RUTINAS_REALIZAR, también después de reaplicar la 014', async () => {
      const revisar = async (cuando: string) => {
        const p = await client.query(`SELECT nombre, descripcion, usa_alcance FROM permisos WHERE codigo = 'RUTINAS_REALIZAR'`);
        assert.strictEqual(p.rows.length, 1, cuando);
        assert.deepStrictEqual(p.rows[0], {
          nombre: 'Marcar tareas de rutina',
          descripcion: 'Permite marcar como hechas las tareas de rutina de las máquinas',
          usa_alcance: true,
        }, cuando);
        const pp = await client.query(
          `SELECT pf.nombre, pp.alcance FROM perfil_permiso pp
           JOIN perfiles pf ON pf.id = pp.perfil_id
           JOIN permisos pe ON pe.id = pp.permiso_id
           WHERE pe.codigo = 'RUTINAS_REALIZAR' ORDER BY pf.nombre`
        );
        assert.deepStrictEqual(pp.rows.map((x) => [x.nombre, x.alcance]), [
          ['ADMINISTRADOR', 'TODAS'],
          ['OPERARIO', 'SECTORES'],
          ['RESPONSABLE_MANTENIMIENTO', 'TODAS'],
        ], cuando);
      };
      await revisar('Después de la 024');
      await client.query(sql014);
      await revisar('Después de reaplicar la 014');
      await client.query(sql024);
      await revisar('Después de reaplicar la 024');
    });
  } finally {
    client = await clienteSano(client);
    client.release();
  }
});
