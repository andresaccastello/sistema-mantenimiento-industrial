import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 019 TESTS)');
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
  planId: number;
  tareaId: number;
}

/** Una planta, un sector, una máquina, un usuario, y un plan con una tarea. */
async function crearBase(client: pg.PoolClient): Promise<Base> {
  const suf = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const resPerfil = await client.query(`SELECT id FROM perfiles WHERE nombre = 'OPERARIO'`);
  const plantaId = Number((await client.query(
    'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`PL_M19_${suf}`]
  )).rows[0].id);
  const sectorId = Number((await client.query(
    'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`S_M19_${suf}`, plantaId]
  )).rows[0].id);
  const maquinaId = Number((await client.query(
    'INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, TRUE) RETURNING id',
    [`M19_${suf}`, `Maquina M19 ${suf}`, sectorId]
  )).rows[0].id);
  const usuarioId = Number((await client.query(
    `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
     VALUES ($1, 'Persona', 'M19', 'x', $2, TRUE, 1) RETURNING id`,
    [`U_M19_${suf}`, resPerfil.rows[0].id]
  )).rows[0].id);
  const planId = Number((await client.query(
    `INSERT INTO planes_mantenimiento (maquina_id, nombre, anticipacion_dias, creado_por_usuario_id, generacion_automatica)
     VALUES ($1, 'Plan M19', 7, $2, TRUE) RETURNING id`,
    [maquinaId, usuarioId]
  )).rows[0].id);
  const tareaId = Number((await client.query(
    `INSERT INTO plan_tareas (plan_id, orden, accion, frecuencia_valor, frecuencia_unidad, primera_fecha)
     VALUES ($1, 1, 'Tarea M19', 1, 'MESES', '2026-01-15') RETURNING id`,
    [planId]
  )).rows[0].id);
  return { plantaId, sectorId, maquinaId, usuarioId, planId, tareaId };
}

/** Borra lo que creó crearBase, con sus avisos. */
async function borrarBase(client: pg.PoolClient, b: Base) {
  await client.query('DELETE FROM avisos_vencimiento WHERE plan_tarea_id = $1', [b.tareaId]);
  await client.query('DELETE FROM plan_tareas WHERE plan_id = $1', [b.planId]);
  await client.query('DELETE FROM planes_mantenimiento WHERE id = $1', [b.planId]);
  await client.query('DELETE FROM maquinas WHERE id = $1', [b.maquinaId]);
  await client.query('DELETE FROM sectores WHERE id = $1', [b.sectorId]);
  await client.query('DELETE FROM plantas WHERE id = $1', [b.plantaId]);
  await client.query('DELETE FROM usuarios WHERE id = $1', [b.usuarioId]);
}

/** Una sentencia que tiene que fallar, dentro de una transacción que se deshace. */
async function rechaza(client: pg.PoolClient, sql: string, params: unknown[], patron: RegExp) {
  await client.query('BEGIN');
  try {
    await assert.rejects(client.query(sql, params), patron);
  } finally {
    await client.query('ROLLBACK');
  }
}

test('Migración 019 — Generación automática y avisos de vencimiento', async (t) => {
  let client = await pool.connect();

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/019_vencimientos.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    const usuariosSistema = async () =>
      (await client.query(
        `SELECT id, legajo, nombre, apellido, password_hash, perfil_id, activo
         FROM usuarios WHERE es_sistema ORDER BY id`
      )).rows;

    // =========================================================================
    // M19-01: Aplicar dos veces, y reaplicar con datos
    // =========================================================================
    await t.test('M19-01: Aplicar dos veces, y reaplicar con datos no cambia nada', async () => {
      await client.query(sqlContent);
      const sistema = await usuariosSistema();
      await client.query(sqlContent);
      assert.deepStrictEqual(await usuariosSistema(), sistema, 'Reaplicar no crea otro usuario del sistema ni lo cambia');
      assert.strictEqual(sistema.length, 1, 'Hay un solo usuario del sistema');

      const b = await crearBase(client);
      try {
        await client.query(
          `INSERT INTO avisos_vencimiento (plan_tarea_id, estado, ciclo) VALUES ($1, 'PROXIMA', 'F:2026-01-15')`,
          [b.tareaId]
        );

        const foto = async () => {
          const r = await client.query(
            `SELECT
               (SELECT to_jsonb(x) FROM planes_mantenimiento x WHERE x.id = $1) AS plan,
               (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM avisos_vencimiento x WHERE x.plan_tarea_id = $2) AS avisos,
               (SELECT vencimientos_revisados_el FROM configuracion_sistema WHERE id = 1) AS revisados_el,
               (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM usuarios x WHERE x.es_sistema) AS sistema`,
            [b.planId, b.tareaId]
          );
          return r.rows[0];
        };
        const antes = await foto();
        assert.strictEqual(antes.plan.generacion_automatica, true);

        await client.query(sqlContent);
        assert.deepStrictEqual(await foto(), antes, 'Reaplicar no cambia el plan, los avisos, la revisión ni el usuario del sistema');
        assert.strictEqual((await usuariosSistema()).length, 1, 'Sigue habiendo un solo usuario del sistema');
      } finally {
        await borrarBase(client, b);
      }
    });

    // =========================================================================
    // M19-02: Estructura
    // =========================================================================
    await t.test('M19-02: Estructura', async () => {
      const columna = async (tabla: string, nombre: string) => {
        const r = await client.query(
          `SELECT data_type, is_nullable, column_default, character_maximum_length
           FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
          [tabla, nombre]
        );
        assert.strictEqual(r.rows.length, 1, `Existe ${tabla}.${nombre}`);
        return r.rows[0];
      };

      const esSistema = await columna('usuarios', 'es_sistema');
      assert.deepStrictEqual(
        [esSistema.data_type, esSistema.is_nullable, esSistema.column_default],
        ['boolean', 'NO', 'false']
      );
      const automatica = await columna('planes_mantenimiento', 'generacion_automatica');
      assert.deepStrictEqual(
        [automatica.data_type, automatica.is_nullable, automatica.column_default],
        ['boolean', 'NO', 'false']
      );
      const revisados = await columna('configuracion_sistema', 'vencimientos_revisados_el');
      assert.deepStrictEqual([revisados.data_type, revisados.is_nullable], ['date', 'YES']);

      // avisos_vencimiento
      const id = await columna('avisos_vencimiento', 'id');
      assert.strictEqual(id.data_type, 'bigint');
      const tarea = await columna('avisos_vencimiento', 'plan_tarea_id');
      assert.deepStrictEqual([tarea.data_type, tarea.is_nullable], ['bigint', 'NO']);
      const estado = await columna('avisos_vencimiento', 'estado');
      assert.strictEqual(estado.is_nullable, 'NO');
      const ciclo = await columna('avisos_vencimiento', 'ciclo');
      assert.deepStrictEqual(
        [ciclo.data_type, ciclo.is_nullable, ciclo.character_maximum_length],
        ['character varying', 'NO', 40]
      );
      const avisadoEn = await columna('avisos_vencimiento', 'avisado_en');
      assert.strictEqual(avisadoEn.data_type, 'timestamp with time zone');
      assert.match(String(avisadoEn.column_default), /now\(\)/i);

      const identidad = await client.query(
        `SELECT is_identity FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'avisos_vencimiento' AND column_name = 'id'`
      );
      assert.strictEqual(identidad.rows[0].is_identity, 'YES');

      const fk = await client.query(
        `SELECT ccu.table_name AS tabla
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
         WHERE tc.table_name = 'avisos_vencimiento' AND tc.constraint_type = 'FOREIGN KEY'
           AND kcu.column_name = 'plan_tarea_id'`
      );
      assert.deepStrictEqual(fk.rows.map((r) => r.tabla), ['plan_tareas']);

      // Los índices únicos
      const indices = await client.query(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE indexname IN ('uq_avisos_vencimiento_tarea_estado_ciclo', 'uq_usuarios_es_sistema')
         ORDER BY indexname`
      );
      assert.strictEqual(indices.rows.length, 2);
      const avisos = indices.rows.find((r) => r.indexname === 'uq_avisos_vencimiento_tarea_estado_ciclo');
      assert.match(avisos.indexdef, /UNIQUE INDEX .*\(plan_tarea_id, estado, ciclo\)/);
      const sistemaIdx = indices.rows.find((r) => r.indexname === 'uq_usuarios_es_sistema');
      assert.match(sistemaIdx.indexdef, /UNIQUE INDEX .*\(es_sistema\) WHERE es_sistema/);

      // El usuario del sistema
      const r = await client.query(
        `SELECT u.legajo, u.nombre, u.activo, p.nombre AS perfil, u.password_hash
         FROM usuarios u JOIN perfiles p ON p.id = u.perfil_id
         WHERE u.es_sistema`
      );
      assert.strictEqual(r.rows.length, 1);
      const s = r.rows[0];
      assert.deepStrictEqual([s.legajo, s.nombre, s.activo, s.perfil], ['SISTEMA', 'Sistema', false, 'CONSULTA']);
      assert.ok(!String(s.password_hash).startsWith('$2'), 'La contraseña no es un hash de bcrypt: no corresponde a ninguna clave');
      assert.ok(String(s.password_hash).length > 10, 'La contraseña no está vacía');
    });

    // =========================================================================
    // M19-03: Restricciones
    // =========================================================================
    await t.test('M19-03: Restricciones', async () => {
      const perfil = Number((await client.query(`SELECT id FROM perfiles WHERE nombre = 'CONSULTA'`)).rows[0].id);

      // Un segundo es_sistema
      await rechaza(
        client,
        `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, es_sistema)
         VALUES ($1, 'Otro sistema', 'x', $2, FALSE, TRUE)`,
        [`M19_SIS_${Date.now()}`, perfil],
        /uq_usuarios_es_sistema/
      );

      const b = await crearBase(client);
      try {
        // Un estado raro
        await rechaza(
          client,
          `INSERT INTO avisos_vencimiento (plan_tarea_id, estado, ciclo) VALUES ($1, 'AL_DIA', 'F:2026-01-15')`,
          [b.tareaId],
          /ck_avisos_vencimiento_estado/
        );
        // Un ciclo vacío
        await rechaza(
          client,
          `INSERT INTO avisos_vencimiento (plan_tarea_id, estado, ciclo) VALUES ($1, 'PROXIMA', NULL)`,
          [b.tareaId],
          /null value|nulo/i
        );

        // Un aviso repetido
        await client.query(
          `INSERT INTO avisos_vencimiento (plan_tarea_id, estado, ciclo) VALUES ($1, 'VENCIDA', 'F:2026-01-15|U:500.00')`,
          [b.tareaId]
        );
        await rechaza(
          client,
          `INSERT INTO avisos_vencimiento (plan_tarea_id, estado, ciclo) VALUES ($1, 'VENCIDA', 'F:2026-01-15|U:500.00')`,
          [b.tareaId],
          /uq_avisos_vencimiento_tarea_estado_ciclo/
        );
        // El mismo ciclo con otro estado, o el mismo estado con otro ciclo, sí
        await client.query(
          `INSERT INTO avisos_vencimiento (plan_tarea_id, estado, ciclo)
           VALUES ($1, 'PROXIMA', 'F:2026-01-15|U:500.00'), ($1, 'VENCIDA', 'F:2026-02-15|U:500.00')`,
          [b.tareaId]
        );
        const n = Number((await client.query(
          'SELECT count(*)::int AS n FROM avisos_vencimiento WHERE plan_tarea_id = $1', [b.tareaId]
        )).rows[0].n);
        assert.strictEqual(n, 3);
      } finally {
        await borrarBase(client, b);
      }
    });
  } finally {
    client = await clienteSano(client);
    client.release();
  }
});
