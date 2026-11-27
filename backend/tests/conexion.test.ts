import { test } from 'node:test';
import assert from 'node:assert';
import pg from 'pg';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (CONEXION TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

const pidDe = async (c: { query: pg.Pool['query'] }): Promise<number> =>
  Number((await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);

/** Espera hasta que se cumpla la condición, o falla a los 15 segundos. */
async function esperar(condicion: () => boolean, que: string): Promise<void> {
  const limite = Date.now() + 15000;
  while (!condicion()) {
    if (Date.now() > limite) throw new Error(`No pasó a tiempo: ${que}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test('Etapa C2 — Cortes de conexión con la base (CX-01 a CX-03)', async (t) => {
  // La conexión que corta a las otras: aparte del pool, para no cortarse a sí misma
  const cortadora = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: true });
  await cortadora.connect();
  const cortar = async (pid: number) => {
    const r = await cortadora.query('SELECT pg_terminate_backend($1) AS ok', [pid]);
    assert.strictEqual(r.rows[0].ok, true, 'pg_terminate_backend no cortó la conexión');
  };

  try {
    await t.test('CX-01: Se corta una conexión inactiva del pool', async () => {
      const cliente = await pool.connect();
      const pid = await pidDe(cliente);
      cliente.release();
      await esperar(() => pool.idleCount >= 1, 'la conexión vuelve al pool');
      const antes = pool.totalCount;

      await cortar(pid);
      // El pool la descarta al recibir el error; si nadie lo atendiera, el proceso terminaría acá
      await esperar(() => pool.totalCount < antes, 'el pool descarta la conexión cortada');

      const nuevo = await pidDe(pool);
      assert.notStrictEqual(nuevo, pid);
      const r = await pool.query('SELECT 1 AS uno');
      assert.strictEqual(r.rows[0].uno, 1);
    });

    await t.test('CX-02: Se corta la conexión tomada por la prueba', async () => {
      let cliente = await pool.connect();
      try {
        const pid = await pidDe(cliente);
        let terminada = false;
        cliente.once('end', () => { terminada = true; });

        await cortar(pid);
        await esperar(() => terminada, 'la conexión tomada se cierra');

        await assert.rejects(cliente.query('SELECT 1'));

        const anterior = cliente;
        cliente = await clienteSano(cliente);
        assert.notStrictEqual(cliente, anterior);
        assert.notStrictEqual(await pidDe(cliente), pid);
        const r = await cliente.query('SELECT 1 AS uno');
        assert.strictEqual(r.rows[0].uno, 1);
      } finally {
        cliente.release();
      }
    });

    await t.test('CX-03: clienteSano con un cliente que anda', async () => {
      const cliente = await pool.connect();
      try {
        const pid = await pidDe(cliente);
        const devuelto = await clienteSano(cliente);
        assert.strictEqual(devuelto, cliente);
        assert.strictEqual(await pidDe(devuelto), pid);
      } finally {
        cliente.release();
      }
    });
  } finally {
    await cortadora.end();
  }
});
