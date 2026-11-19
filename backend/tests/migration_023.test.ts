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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 023 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 023 — Uso estimado del medidor', async (t) => {
  let client = await pool.connect();

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/023_uso_estimado.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    /**
     * Una máquina de prueba, dentro de la transacción de la prueba, y una función que le da de
     * alta un medidor con el uso declarado que se le pase.
     */
    async function base() {
      const suf = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const planta = (await client.query(`INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id`, [`M23_P_${suf}`])).rows[0].id;
      const sector = (await client.query(
        `INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id`, [`M23_S_${suf}`, planta]
      )).rows[0].id;
      const maquina = (await client.query(
        `INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, 'Maquina M23', $2, TRUE) RETURNING id`,
        [`M23_M_${suf}`, sector]
      )).rows[0].id;
      const usuario = (await client.query('SELECT id FROM usuarios WHERE es_sistema')).rows[0].id;
      let n = 0;
      return (valor: unknown, periodo: unknown) =>
        client.query(
          `INSERT INTO medidores (maquina_id, nombre, unidad, creado_por_usuario_id, uso_estimado_valor, uso_estimado_periodo)
           VALUES ($1, $2, 'horas', $3, $4, $5) RETURNING id, uso_estimado_valor, uso_estimado_periodo, estimacion_avisada_en`,
          [maquina, `Medidor M23 ${++n}`, usuario, valor, periodo]
        );
    }

    // =========================================================================
    // M23-01: Aplicar dos veces
    // =========================================================================
    await t.test('M23-01: Aplicar dos veces no da error', async () => {
      await client.query(sqlContent);
      await client.query(sqlContent);
      const r = await client.query(
        `SELECT conname FROM pg_constraint
         WHERE conrelid = 'medidores'::regclass AND conname LIKE 'ck_medidores_uso_estimado%'
         ORDER BY conname`
      );
      assert.deepStrictEqual(
        r.rows.map((x) => x.conname),
        ['ck_medidores_uso_estimado_completo', 'ck_medidores_uso_estimado_periodo', 'ck_medidores_uso_estimado_valor'],
        'Un CHECK de cada uno'
      );
    });

    // =========================================================================
    // M23-02: Las columnas, con sus tipos
    // =========================================================================
    await t.test('M23-02: uso_estimado_valor, uso_estimado_periodo y estimacion_avisada_en', async () => {
      const r = await client.query(
        `SELECT column_name, data_type, numeric_precision, numeric_scale, character_maximum_length, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'medidores'
           AND column_name IN ('uso_estimado_valor', 'uso_estimado_periodo', 'estimacion_avisada_en')
         ORDER BY column_name`
      );
      const c = Object.fromEntries(r.rows.map((x) => [x.column_name, x]));
      assert.deepStrictEqual(Object.keys(c).sort(), ['estimacion_avisada_en', 'uso_estimado_periodo', 'uso_estimado_valor']);
      assert.deepStrictEqual(
        [c.uso_estimado_valor.data_type, c.uso_estimado_valor.numeric_precision, c.uso_estimado_valor.numeric_scale],
        ['numeric', 14, 2]
      );
      assert.deepStrictEqual([c.uso_estimado_periodo.data_type, c.uso_estimado_periodo.character_maximum_length], ['character varying', 6]);
      assert.strictEqual(c.estimacion_avisada_en.data_type, 'timestamp with time zone');
      for (const x of Object.values(c) as Array<{ column_name: string; is_nullable: string; column_default: unknown }>) {
        assert.strictEqual(x.is_nullable, 'YES', x.column_name);
        assert.strictEqual(x.column_default, null, x.column_name);
      }

      // Un medidor sin decir nada queda sin uso declarado
      await client.query('BEGIN');
      try {
        const alta = await base();
        const m = (await alta(null, null)).rows[0];
        assert.deepStrictEqual([m.uso_estimado_valor, m.uso_estimado_periodo, m.estimacion_avisada_en], [null, null, null]);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // =========================================================================
    // M23-03: Los CHECK
    // =========================================================================
    await t.test('M23-03: Los CHECK rechazan un valor sin período, un 0 y un período inválido', async () => {
      await client.query('BEGIN');
      try {
        const alta = await base();
        const casos: Array<[string, unknown, unknown, RegExp]> = [
          ['valor sin período', 40, null, /ck_medidores_uso_estimado_completo/],
          ['período sin valor', null, 'SEMANA', /ck_medidores_uso_estimado_completo/],
          ['valor 0', 0, 'DIA', /ck_medidores_uso_estimado_valor/],
          ['valor negativo', -5, 'DIA', /ck_medidores_uso_estimado_valor/],
          ['período inválido', 40, 'ANIO', /ck_medidores_uso_estimado_periodo/],
          ['período en minúsculas', 40, 'semana', /ck_medidores_uso_estimado_periodo/],
        ];
        for (const [caso, valor, periodo, error] of casos) {
          await client.query('SAVEPOINT fuera');
          await assert.rejects(alta(valor, periodo), error, caso);
          await client.query('ROLLBACK TO SAVEPOINT fuera');
        }
        const validos = [];
        for (const periodo of ['DIA', 'SEMANA', 'MES']) {
          const m = (await alta(40, periodo)).rows[0];
          validos.push([Number(m.uso_estimado_valor), m.uso_estimado_periodo]);
        }
        assert.deepStrictEqual(validos, [[40, 'DIA'], [40, 'SEMANA'], [40, 'MES']]);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    // =========================================================================
    // M23-04: Las dos vistas
    // =========================================================================
    await t.test('M23-04: Existen v_medidores_ritmo y v_plan_tareas_estimacion, con sus columnas', async () => {
      const columnas = async (vista: string) =>
        (await client.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`,
          [vista]
        )).rows.map((x) => x.column_name);

      const ritmo = await columnas('v_medidores_ritmo');
      for (const c of [
        'medidor_id', 'ritmo_declarado', 'ritmo_lecturas', 'lecturas_usadas', 'lecturas_desde', 'lecturas_hasta',
        'ritmo', 'fuente', 'desvio_pct',
      ]) {
        assert.ok(ritmo.includes(c), `v_medidores_ritmo.${c}`);
      }
      const estimacion = await columnas('v_plan_tareas_estimacion');
      for (const c of ['tarea_id', 'fecha_estimada', 'fecha_aviso_estimada', 'valor_estimado_hoy', 'estimada_pasada']) {
        assert.ok(estimacion.includes(c), `v_plan_tareas_estimacion.${c}`);
      }

      // Las dos se pueden consultar
      await client.query('SELECT * FROM v_medidores_ritmo LIMIT 1');
      await client.query('SELECT * FROM v_plan_tareas_estimacion LIMIT 1');
    });
  } finally {
    client = await clienteSano(client);
    client.release();
  }
});
