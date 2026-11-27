import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import app from '../functions/api.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (INGRESO TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

const CLAVE = 'clave-correcta-IN1';
const MAL = 'clave-equivocada';
const BLOQUEO = { error: 'Demasiados intentos. Probá de nuevo en unos minutos', codigo: 'DEMASIADOS_INTENTOS' };

interface Respuesta {
  status: number;
  cuerpo: { codigo?: string; error?: string; token?: string };
}

async function ingresar(legajo: string, password: string): Promise<Respuesta> {
  const r = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ legajo, password }),
  });
  return { status: r.status, cuerpo: (await r.json()) as Respuesta['cuerpo'] };
}

test('Etapa PUB1 — Límite de intentos de ingreso (IN-01 a IN-07)', async (t) => {
  let client = await pool.connect();
  const createdUsuarioIds: number[] = [];
  // Cada prueba usa legajos propios (ya normalizados): sus intentos se borran al final
  const legajosPropios: string[] = [];
  const suf = Date.now().toString(36).toUpperCase();

  const legajo = (nombre: string) => {
    const l = `${nombre}_${suf}`;
    legajosPropios.push(l);
    return l;
  };

  const intentos = async (l: string) => {
    const { rows } = await client.query<{ exitoso: boolean }>(
      'SELECT exitoso FROM intentos_ingreso WHERE legajo = $1 ORDER BY id',
      [l]
    );
    return rows.map((r) => r.exitoso);
  };

  const fallar = async (l: string, veces: number) => {
    for (let i = 0; i < veces; i++) {
      const r = await ingresar(l, MAL);
      assert.strictEqual(r.status, 401, `fallo ${i + 1} de ${l}`);
      assert.strictEqual(r.cuerpo.codigo, 'CREDENCIALES_INVALIDAS');
    }
  };

  try {
    const passHash = await bcrypt.hash(CLAVE, 10);
    const { rows: perfiles } = await client.query<{ id: string }>(`SELECT id FROM perfiles WHERE nombre = 'OPERARIO'`);
    const perfilId = Number(perfiles[0].id);

    const crearUsuario = async (nombre: string) => {
      const l = legajo(nombre);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version, debe_cambiar_password)
         VALUES ($1, $2, 'IN', $3, $4, TRUE, 1, FALSE) RETURNING id`,
        [l, nombre, passHash, perfilId]
      );
      createdUsuarioIds.push(Number(rows[0].id));
      return l;
    };

    // =========================================================================
    await t.test('IN-01: 4 fallos y después la contraseña correcta: entra', async () => {
      const l = await crearUsuario('IN01');
      await fallar(l, 4);
      const r = await ingresar(l, CLAVE);
      assert.strictEqual(r.status, 200);
      assert.ok(r.cuerpo.token);
      assert.deepStrictEqual(await intentos(l), [false, false, false, false, true]);
    });

    // =========================================================================
    let cuerpoBloqueo: Respuesta['cuerpo'] = {};
    await t.test('IN-02: 5 fallos: el sexto intento da 429, aunque la contraseña sea la correcta', async () => {
      const l = await crearUsuario('IN02');
      await fallar(l, 5);
      const r = await ingresar(l, CLAVE);
      assert.strictEqual(r.status, 429);
      assert.deepStrictEqual(r.cuerpo, BLOQUEO);
      cuerpoBloqueo = r.cuerpo;
      // El bloqueado no compara la contraseña ni se registra como intento
      assert.deepStrictEqual(await intentos(l), [false, false, false, false, false]);
      const otra = await ingresar(l, MAL);
      assert.strictEqual(otra.status, 429);
    });

    // =========================================================================
    await t.test('IN-03: Los fallos de hace más de 15 minutos no cuentan', async () => {
      const l = await crearUsuario('IN03');
      await fallar(l, 5);
      assert.strictEqual((await ingresar(l, CLAVE)).status, 429);
      // Los 5 fallos pasan a ser de hace 16 minutos
      await client.query(
        `UPDATE intentos_ingreso SET creado_en = creado_en - interval '16 minutes' WHERE legajo = $1`,
        [l]
      );
      const r = await ingresar(l, MAL);
      assert.strictEqual(r.status, 401);
      assert.strictEqual(r.cuerpo.codigo, 'CREDENCIALES_INVALIDAS');
      assert.strictEqual((await ingresar(l, CLAVE)).status, 200);
    });

    // =========================================================================
    await t.test('IN-04: Un ingreso exitoso pone la cuenta en cero (y borra los intentos de más de 7 días)', async () => {
      const l = await crearUsuario('IN04');
      // Un intento propio de hace 8 días: el ingreso exitoso lo borra
      const lViejo = legajo('IN04V');
      await client.query(
        `INSERT INTO intentos_ingreso (legajo, exitoso, creado_en) VALUES ($1, FALSE, NOW() - interval '8 days')`,
        [lViejo]
      );
      await fallar(l, 4);
      assert.strictEqual((await ingresar(l, CLAVE)).status, 200);
      assert.deepStrictEqual(await intentos(lViejo), []);
      // Sin la cuenta en cero, serían 8 fallos
      await fallar(l, 4);
      assert.strictEqual((await ingresar(l, CLAVE)).status, 200);
      await fallar(l, 5);
      assert.strictEqual((await ingresar(l, CLAVE)).status, 429);
    });

    // =========================================================================
    await t.test('IN-05: Un legajo inexistente se bloquea igual, con la misma respuesta', async () => {
      const l = legajo('IN05NOEXISTE');
      const { rowCount } = await client.query('SELECT 1 FROM usuarios WHERE legajo = $1', [l]);
      assert.strictEqual(rowCount, 0);
      await fallar(l, 5);
      const r = await ingresar(l, CLAVE);
      assert.strictEqual(r.status, 429);
      assert.deepStrictEqual(r.cuerpo, cuerpoBloqueo);
      assert.deepStrictEqual(await intentos(l), [false, false, false, false, false]);
    });

    // =========================================================================
    await t.test('IN-06: 8 pedidos fallidos a la vez: 5 dan contraseña incorrecta y 3 dan 429, nunca 500', async () => {
      const l = await crearUsuario('IN06');
      const respuestas = await Promise.all(Array.from({ length: 8 }, () => ingresar(l, MAL)));
      const codigos = respuestas.map((r) => `${r.status} ${r.cuerpo.codigo}`).sort();
      assert.deepStrictEqual(codigos, [
        '401 CREDENCIALES_INVALIDAS',
        '401 CREDENCIALES_INVALIDAS',
        '401 CREDENCIALES_INVALIDAS',
        '401 CREDENCIALES_INVALIDAS',
        '401 CREDENCIALES_INVALIDAS',
        '429 DEMASIADOS_INTENTOS',
        '429 DEMASIADOS_INTENTOS',
        '429 DEMASIADOS_INTENTOS',
      ]);
      assert.deepStrictEqual(await intentos(l), [false, false, false, false, false]);
    });

    // =========================================================================
    await t.test('IN-07: Los legajos con distinto formato son el mismo legajo', async () => {
      const l = await crearUsuario('IN07');
      const otroFormato = `  ${l.toLowerCase()}  `;
      // 3 fallos con espacios y en minúscula, y 2 con el legajo tal cual
      for (let i = 0; i < 3; i++) {
        const r = await ingresar(otroFormato, CLAVE);
        assert.strictEqual(r.status, 401);
        assert.strictEqual(r.cuerpo.codigo, 'CREDENCIALES_INVALIDAS');
      }
      await fallar(l, 2);
      assert.deepStrictEqual(await intentos(l), [false, false, false, false, false]);
      const r = await ingresar(l, CLAVE);
      assert.strictEqual(r.status, 429);
      assert.deepStrictEqual(r.cuerpo, BLOQUEO);
      assert.strictEqual((await ingresar(otroFormato, CLAVE)).status, 429);
    });
  } finally {
    client = await clienteSano(client);
    try {
      await client.query('DELETE FROM intentos_ingreso WHERE legajo = ANY($1)', [legajosPropios]);
      if (createdUsuarioIds.length > 0) {
        await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUsuarioIds]);
      }
    } finally {
      client.release();
    }
  }
});
