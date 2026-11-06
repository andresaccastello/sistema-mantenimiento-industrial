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
  console.error(' BLOQUEO DE SEGURIDAD (MIGRATION 013 TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Migración 013 — Datos de la máquina (criticidad, tipo de equipo, planta y modelo)', async (t) => {
  const client = await pool.connect();
  const createdMaquinaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdPlantaIds: number[] = [];

  try {
    const sqlPath = path.resolve(__dirname, '../../database/migrations/013_datos_maquina.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    // M13-01: Aplicar la migración
    await t.test('M13-01: Aplicar migración 013_datos_maquina.sql sin errores', async () => {
      await client.query(sqlContent);
      assert.ok(true, 'Migración 013 ejecutada exitosamente');
    });

    // M13-02: Aplicarla otra vez
    await t.test('M13-02: Idempotencia: aplicar otra vez no falla ni agrega filas en criticidades ni tipos_equipo', async () => {
      const antesCrit = await client.query('SELECT COUNT(*)::int AS c FROM criticidades');
      const antesTipos = await client.query('SELECT COUNT(*)::int AS c FROM tipos_equipo');

      await client.query(sqlContent);

      const despuesCrit = await client.query('SELECT COUNT(*)::int AS c FROM criticidades');
      const despuesTipos = await client.query('SELECT COUNT(*)::int AS c FROM tipos_equipo');

      assert.strictEqual(despuesCrit.rows[0].c, antesCrit.rows[0].c, 'No deben agregarse filas en criticidades');
      assert.strictEqual(despuesTipos.rows[0].c, antesTipos.rows[0].c, 'No deben agregarse filas en tipos_equipo');
    });

    // M13-03: Códigos iniciales y fila por omisión
    await t.test('M13-03: Existen los códigos iniciales y en cada catálogo hay a lo sumo una fila por omisión activa', async () => {
      const resCrit = await client.query(
        `SELECT codigo FROM criticidades WHERE codigo IN ('ALTA', 'MEDIA', 'BAJA')`
      );
      const codigosCrit = new Set(resCrit.rows.map((r) => r.codigo));
      for (const cod of ['ALTA', 'MEDIA', 'BAJA']) {
        assert.ok(codigosCrit.has(cod), `Debe existir criticidad con código ${cod}`);
      }

      const resCritOmision = await client.query(
        'SELECT id, activo FROM criticidades WHERE por_omision = TRUE'
      );
      assert.ok(resCritOmision.rows.length <= 1, 'A lo sumo una criticidad por omisión');
      if (resCritOmision.rows.length === 1) {
        assert.strictEqual(resCritOmision.rows[0].activo, true, 'La criticidad por omisión debe estar activa');
      }

      const resTipos = await client.query(
        `SELECT codigo FROM tipos_equipo WHERE codigo IN ('MAQUINA', 'VEHICULO', 'INSTALACION', 'HERRAMIENTA')`
      );
      const codigosTipos = new Set(resTipos.rows.map((r) => r.codigo));
      for (const cod of ['MAQUINA', 'VEHICULO', 'INSTALACION', 'HERRAMIENTA']) {
        assert.ok(codigosTipos.has(cod), `Debe existir tipo_equipo con código ${cod}`);
      }

      const resTiposOmision = await client.query(
        'SELECT id, activo FROM tipos_equipo WHERE por_omision = TRUE'
      );
      assert.ok(resTiposOmision.rows.length <= 1, 'A lo sumo un tipo_equipo por omisión');
      if (resTiposOmision.rows.length === 1) {
        assert.strictEqual(resTiposOmision.rows[0].activo, true, 'El tipo_equipo por omisión debe estar activo');
      }
    });

    // M13-04: Restricciones de los catálogos, cada una dentro de una transacción con ROLLBACK
    await t.test('M13-04: Restricciones de criticidades y tipos_equipo dentro de transacciones con ROLLBACK', async () => {
      const suf = Date.now();

      for (const tabla of ['criticidades', 'tipos_equipo'] as const) {
        // 1. Marcar una segunda fila por omisión
        await client.query('BEGIN');
        try {
          const omActual = await client.query(`SELECT id FROM ${tabla} WHERE por_omision = TRUE`);
          if (omActual.rows.length === 0) {
            await client.query(
              `INSERT INTO ${tabla} (codigo, nombre, orden, por_omision, activo) VALUES ($1, $2, 990, TRUE, TRUE)`,
              [`OM1_${suf}`, `Omision 1 ${suf}`]
            );
          }
          await assert.rejects(
            async () => {
              await client.query(
                `INSERT INTO ${tabla} (codigo, nombre, orden, por_omision, activo) VALUES ($1, $2, 991, TRUE, TRUE)`,
                [`OM2_${suf}`, `Omision 2 ${suf}`]
              );
            },
            (err: any) => err.code === '23505',
            `Debe rechazar una segunda fila por omisión en ${tabla}`
          );
        } finally {
          await client.query('ROLLBACK');
        }

        // 2. orden en 0
        await client.query('BEGIN');
        try {
          await assert.rejects(
            async () => {
              await client.query(
                `INSERT INTO ${tabla} (codigo, nombre, orden, por_omision, activo) VALUES ($1, $2, 0, FALSE, TRUE)`,
                [`ORD0_${suf}`, `Orden Cero ${suf}`]
              );
            },
            (err: any) => err.code === '23514',
            `Debe rechazar orden = 0 en ${tabla}`
          );
        } finally {
          await client.query('ROLLBACK');
        }

        // 3. orden repetido
        await client.query('BEGIN');
        try {
          const ordExistente = await client.query(`SELECT orden FROM ${tabla} LIMIT 1`);
          const ordenDup = ordExistente.rows[0].orden;
          await assert.rejects(
            async () => {
              await client.query(
                `INSERT INTO ${tabla} (codigo, nombre, orden, por_omision, activo) VALUES ($1, $2, $3, FALSE, TRUE)`,
                [`ORDDUP_${suf}`, `Orden Dup ${suf}`, ordenDup]
              );
            },
            (err: any) => err.code === '23505',
            `Debe rechazar orden repetido en ${tabla}`
          );
        } finally {
          await client.query('ROLLBACK');
        }

        // 4. Fila por omisión inactiva
        await client.query('BEGIN');
        try {
          await client.query(`UPDATE ${tabla} SET por_omision = FALSE WHERE por_omision = TRUE`);
          await assert.rejects(
            async () => {
              await client.query(
                `INSERT INTO ${tabla} (codigo, nombre, orden, por_omision, activo) VALUES ($1, $2, 992, TRUE, FALSE)`,
                [`OMINACT_${suf}`, `Omision Inactiva ${suf}`]
              );
            },
            (err: any) => err.code === '23514',
            `Debe rechazar fila por omisión inactiva en ${tabla}`
          );
        } finally {
          await client.query('ROLLBACK');
        }
      }
    });

    // M13-05: INSERT de máquina sin criticidad ni tipo, en un sector propio de la prueba
    await t.test('M13-05: INSERT de máquina sin criticidad ni tipo toma los valores de fn_criticidad_por_omision() y fn_tipo_equipo_por_omision()', async () => {
      const suf = Date.now();
      const resSec = await client.query(
        'INSERT INTO sectores (nombre) VALUES ($1) RETURNING id',
        [`Sector M13_${suf}`]
      );
      const secId = Number(resSec.rows[0].id);
      createdSectorIds.push(secId);

      const resFn = await client.query(
        'SELECT fn_criticidad_por_omision() AS crit_id, fn_tipo_equipo_por_omision() AS tipo_id'
      );
      const expectedCritId = Number(resFn.rows[0].crit_id);
      const expectedTipoId = Number(resFn.rows[0].tipo_id);

      const resMaq = await client.query(
        'INSERT INTO maquinas (nombre, sector_id) VALUES ($1, $2) RETURNING id, criticidad_id, tipo_equipo_id',
        [`Maquina M13_${suf}`, secId]
      );
      const maq = resMaq.rows[0];
      createdMaquinaIds.push(Number(maq.id));

      assert.strictEqual(Number(maq.criticidad_id), expectedCritId, 'Debe tomar fn_criticidad_por_omision()');
      assert.strictEqual(Number(maq.tipo_equipo_id), expectedTipoId, 'Debe tomar fn_tipo_equipo_por_omision()');
    });

    // M13-06: Columnas de maquinas
    await t.test('M13-06: Existe maquinas.modelo, no existe maquinas.tipo y las dos columnas nuevas son NOT NULL', async () => {
      const resCols = await client.query(`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'maquinas'
          AND column_name IN ('tipo', 'modelo', 'criticidad_id', 'tipo_equipo_id')
      `);
      const mapCols = new Map(resCols.rows.map((r) => [r.column_name, r.is_nullable]));

      assert.strictEqual(mapCols.has('tipo'), false, 'No debe existir maquinas.tipo');
      assert.strictEqual(mapCols.has('modelo'), true, 'Debe existir maquinas.modelo');
      assert.strictEqual(mapCols.get('criticidad_id'), 'NO', 'criticidad_id debe ser NOT NULL');
      assert.strictEqual(mapCols.get('tipo_equipo_id'), 'NO', 'tipo_equipo_id debe ser NOT NULL');
    });

    // M13-07: sectores.planta_id
    await t.test('M13-07: sectores.planta_id acepta NULL y rechaza planta inexistente por FK', async () => {
      const suf = Date.now();
      const resSecNull = await client.query(
        'INSERT INTO sectores (nombre, planta_id) VALUES ($1, NULL) RETURNING id, planta_id',
        [`Sector SinPlanta M13_${suf}`]
      );
      const secNullId = Number(resSecNull.rows[0].id);
      createdSectorIds.push(secNullId);
      assert.strictEqual(resSecNull.rows[0].planta_id, null, 'sectores.planta_id debe aceptar NULL');

      const resPlanta = await client.query(
        'INSERT INTO plantas (nombre, descripcion) VALUES ($1, $2) RETURNING id',
        [`Planta M13_${suf}`, 'Planta de prueba']
      );
      const plantaId = Number(resPlanta.rows[0].id);
      createdPlantaIds.push(plantaId);

      const resSecPlanta = await client.query(
        'INSERT INTO sectores (nombre, planta_id) VALUES ($1, $2) RETURNING id, planta_id',
        [`Sector ConPlanta M13_${suf}`, plantaId]
      );
      createdSectorIds.push(Number(resSecPlanta.rows[0].id));
      assert.strictEqual(Number(resSecPlanta.rows[0].planta_id), plantaId);

      await assert.rejects(
        async () => {
          await client.query(
            'INSERT INTO sectores (nombre, planta_id) VALUES ($1, 999999999)',
            [`Sector FK Inv M13_${suf}`]
          );
        },
        (err: any) => err.code === '23503',
        'Debe fallar por clave foránea con planta inexistente'
      );
    });
  } finally {
    if (createdMaquinaIds.length > 0) {
      await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [createdMaquinaIds]);
    }
    if (createdSectorIds.length > 0) {
      await client.query('DELETE FROM sectores WHERE id = ANY($1)', [createdSectorIds]);
    }
    if (createdPlantaIds.length > 0) {
      await client.query('DELETE FROM plantas WHERE id = ANY($1)', [createdPlantaIds]);
    }
    client.release();
  }
});

