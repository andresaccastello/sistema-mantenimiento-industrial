import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (PREFERENCIAS TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

async function getTokenForUser(user: { id: number; legajo: string; sesion_version: number }) {
  return await sign(
    {
      sub: String(user.id),
      legajo: user.legajo,
      sv: user.sesion_version,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    JWT_SECRET,
    'HS256'
  );
}

interface Respuesta {
  status: number;
  cuerpo: any;
  tipo: string | null;
  bytes: Uint8Array;
}

async function pedir(method: string, path: string, token: string | null, body?: unknown): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let cuerpoPedido: FormData | string | undefined;
  if (body instanceof FormData) {
    cuerpoPedido = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    cuerpoPedido = JSON.stringify(body);
  }
  const r = await app.request(path, { method, headers, body: cuerpoPedido });
  const bytes = new Uint8Array(await r.arrayBuffer());
  const texto = new TextDecoder().decode(bytes);
  let cuerpo: any = texto;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    // no es JSON
  }
  return { status: r.status, cuerpo, tipo: r.headers.get('Content-Type'), bytes };
}

/** Un PNG de 1 × 1. */
const PNG_CHICO = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
);

function conArchivo(bytes: Uint8Array, nombre: string, tipo: string) {
  const fd = new FormData();
  fd.append('archivo', new File([Buffer.from(bytes)], nombre, { type: tipo }));
  return fd;
}

test('Etapa D1 — Preferencias del usuario e identidad del sistema (PR-01 a PR-11)', async (t) => {
  let client = await pool.connect();
  const createdUsuarioIds: number[] = [];

  // Cómo estaba la identidad al empezar: se deja igual al terminar
  const inicio = (await client.query(
    'SELECT nombre_sistema, nombre_empresa, logo, logo_tipo, actualizado_en FROM configuracion_sistema WHERE id = 1'
  )).rows[0];

  try {
    const suf = Date.now();
    const passHash = await bcrypt.hash('pass123', 10);
    const perfilMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, nombre FROM perfiles')).rows) {
      perfilMap[r.nombre] = Number(r.id);
    }

    async function crearUsuario(clave: string, perfil: string) {
      const res = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, $2, 'PR', $3, $4, TRUE, 1) RETURNING id, legajo, sesion_version`,
        [`PR_${clave}_${suf}`, clave, passHash, perfilMap[perfil]]
      );
      const u = res.rows[0];
      const id = Number(u.id);
      createdUsuarioIds.push(id);
      return { id, token: await getTokenForUser({ id, legajo: u.legajo, sesion_version: Number(u.sesion_version) }) };
    }
    const A = await crearUsuario('Admin', 'ADMINISTRADOR');
    const R = await crearUsuario('Resp', 'RESPONSABLE_MANTENIMIENTO');
    const O = await crearUsuario('Operario', 'OPERARIO');

    const preferenciasEnBase = async (id: number) =>
      (await client.query('SELECT modo_simple_celular, tema FROM usuarios WHERE id = $1', [id])).rows[0];

    // =========================================================================
    // PR-01: /me trae las preferencias
    // =========================================================================
    await t.test('PR-01: /me', async () => {
      const r = await pedir('GET', '/api/auth/me', O.token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      assert.deepStrictEqual(r.cuerpo.preferencias, { modo_simple_celular: true, tema: 'CLARO' });
    });

    // =========================================================================
    // PR-02: Cada uno cambia las suyas
    // =========================================================================
    await t.test('PR-02: PATCH /api/auth/preferencias', async () => {
      const r1 = await pedir('PATCH', '/api/auth/preferencias', O.token, { modo_simple_celular: false });
      assert.strictEqual(r1.status, 200, JSON.stringify(r1.cuerpo));
      assert.deepStrictEqual(r1.cuerpo, { modo_simple_celular: false, tema: 'CLARO' });

      const r2 = await pedir('PATCH', '/api/auth/preferencias', O.token, { tema: 'OSCURO' });
      assert.deepStrictEqual([r2.status, r2.cuerpo], [200, { modo_simple_celular: false, tema: 'OSCURO' }]);

      const r3 = await pedir('PATCH', '/api/auth/preferencias', O.token, { modo_simple_celular: true, tema: 'SISTEMA' });
      assert.deepStrictEqual([r3.status, r3.cuerpo], [200, { modo_simple_celular: true, tema: 'SISTEMA' }]);

      const me = await pedir('GET', '/api/auth/me', O.token);
      assert.deepStrictEqual(me.cuerpo.preferencias, { modo_simple_celular: true, tema: 'SISTEMA' });

      // Otro usuario no cambia
      assert.deepStrictEqual(await preferenciasEnBase(R.id), { modo_simple_celular: true, tema: 'CLARO' });

      // Sin sesión: 401
      const sin = await pedir('PATCH', '/api/auth/preferencias', null, { tema: 'OSCURO' });
      assert.strictEqual(sin.status, 401);
      assert.deepStrictEqual(await preferenciasEnBase(O.id), { modo_simple_celular: true, tema: 'SISTEMA' });
    });

    // =========================================================================
    // PR-03: Cuerpo inválido
    // =========================================================================
    await t.test('PR-03: Cuerpo inválido', async () => {
      const antes = await preferenciasEnBase(R.id);
      const casos: Array<[string, unknown]> = [
        ['vacío', {}],
        ['tema AZUL', { tema: 'AZUL' }],
        ['modo_simple_celular "si"', { modo_simple_celular: 'si' }],
        ['campo desconocido', { tema: 'OSCURO', color: 'rojo' }],
        ['no es un objeto', [1, 2]],
      ];
      for (const [caso, cuerpo] of casos) {
        const r = await pedir('PATCH', '/api/auth/preferencias', R.token, cuerpo);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `${caso}: ${JSON.stringify(r.cuerpo)}`);
      }
      assert.deepStrictEqual(await preferenciasEnBase(R.id), antes, 'No cambió nada');
    });

    // =========================================================================
    // PR-04: PUT /identidad
    // =========================================================================
    await t.test('PR-04: PUT /api/configuracion/identidad', async () => {
      const valido = { nombre_sistema: `Sistema PR ${suf}`, nombre_empresa: 'Empresa de prueba PR' };
      const sinPermiso = await pedir('PUT', '/api/configuracion/identidad', R.token, valido);
      assert.deepStrictEqual([sinPermiso.status, sinPermiso.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);

      const publicaAntes = (await pedir('GET', '/api/configuracion/publica', null)).cuerpo;
      for (const nombre of ['ab', 'x'.repeat(81)]) {
        const r = await pedir('PUT', '/api/configuracion/identidad', A.token, { ...valido, nombre_sistema: nombre });
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `${nombre.length} caracteres`);
      }
      assert.deepStrictEqual((await pedir('GET', '/api/configuracion/publica', null)).cuerpo, publicaAntes, 'Los 422 no cambian nada');

      const ok = await pedir('PUT', '/api/configuracion/identidad', A.token, { ...valido, nombre_sistema: `  ${valido.nombre_sistema}  ` });
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.cuerpo));
      const publica = (await pedir('GET', '/api/configuracion/publica', null)).cuerpo;
      assert.strictEqual(publica.nombre_sistema, valido.nombre_sistema, 'Recortado');
      assert.strictEqual(publica.nombre_empresa, valido.nombre_empresa);
      assert.ok(new Date(publica.actualizado_en) > new Date(publicaAntes.actualizado_en), 'actualizado_en nuevo');

      // La empresa puede quedar en null
      const sinEmpresa = await pedir('PUT', '/api/configuracion/identidad', A.token, { nombre_sistema: valido.nombre_sistema, nombre_empresa: null });
      assert.deepStrictEqual([sinEmpresa.status, sinEmpresa.cuerpo.nombre_empresa], [200, null]);
    });

    // =========================================================================
    // PR-05: PUT /logo
    // =========================================================================
    await t.test('PR-05: PUT /api/configuracion/logo', async () => {
      const antes = (await pedir('GET', '/api/configuracion/publica', null)).cuerpo;
      const ok = await pedir('PUT', '/api/configuracion/logo', A.token, conArchivo(PNG_CHICO, 'logo.png', 'image/png'));
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.cuerpo));
      assert.strictEqual(ok.cuerpo.tiene_logo, true);
      assert.ok(new Date(ok.cuerpo.actualizado_en) > new Date(antes.actualizado_en), 'actualizado_en nuevo');

      const logo = await pedir('GET', '/api/configuracion/logo', null);
      assert.strictEqual(logo.status, 200);
      assert.strictEqual(logo.tipo, 'image/png');
      assert.deepStrictEqual(Buffer.from(logo.bytes), Buffer.from(PNG_CHICO));

      const malos: Array<[string, FormData]> = [
        ['texto con nombre .png', conArchivo(new TextEncoder().encode('no soy una imagen'), 'logo.png', 'image/png')],
        ['SVG', conArchivo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'logo.svg', 'image/svg+xml')],
        ['más de 300 KB', conArchivo(Uint8Array.from([...PNG_CHICO, ...new Uint8Array(300 * 1024)]), 'grande.png', 'image/png')],
      ];
      for (const [caso, fd] of malos) {
        const r = await pedir('PUT', '/api/configuracion/logo', A.token, fd);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `${caso}: ${JSON.stringify(r.cuerpo)}`);
        assert.ok(typeof r.cuerpo.error === 'string' && r.cuerpo.error.length > 0, caso);
      }
      const sinPermiso = await pedir('PUT', '/api/configuracion/logo', R.token, conArchivo(PNG_CHICO, 'logo.png', 'image/png'));
      assert.deepStrictEqual([sinPermiso.status, sinPermiso.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE']);

      // Los rechazos no tocaron el logo
      const sigue = await pedir('GET', '/api/configuracion/logo', null);
      assert.deepStrictEqual(Buffer.from(sigue.bytes), Buffer.from(PNG_CHICO));
    });

    // =========================================================================
    // PR-06: DELETE /logo
    // =========================================================================
    await t.test('PR-06: DELETE /api/configuracion/logo', async () => {
      const sinPermiso = await pedir('DELETE', '/api/configuracion/logo', R.token);
      assert.strictEqual(sinPermiso.status, 403);
      const r = await pedir('DELETE', '/api/configuracion/logo', A.token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      assert.strictEqual(r.cuerpo.tiene_logo, false);
      assert.strictEqual((await pedir('GET', '/api/configuracion/publica', null)).cuerpo.tiene_logo, false);
      const logo = await pedir('GET', '/api/configuracion/logo', null);
      assert.strictEqual(logo.status, 404);
    });

    // =========================================================================
    // PR-07 a PR-11: PATCH /api/auth/email (cada usuario carga su email)
    // =========================================================================
    const usuarioEnBase = async (id: number) =>
      (await client.query(
        `SELECT legajo, nombre, apellido, email, telefono_whatsapp, perfil_id, activo, modo_simple_celular, tema,
                debe_cambiar_password, sesion_version,
                (SELECT COALESCE(array_agg(sector_id ORDER BY sector_id), '{}') FROM usuario_sector WHERE usuario_id = u.id) AS sectores,
                (SELECT COUNT(*)::int FROM usuario_permiso WHERE usuario_id = u.id) AS excepciones
         FROM usuarios u WHERE id = $1`,
        [id]
      )).rows[0];
    const auditoriaEmail = async (id: number) =>
      (await client.query(
        `SELECT realizado_por_usuario_id, sobre_usuario_id, accion, detalle
         FROM auditoria_permisos WHERE sobre_usuario_id = $1 ORDER BY id`,
        [id]
      )).rows.map((f) => ({ ...f, detalle: JSON.parse(f.detalle) }));

    await t.test('PR-07: email válido, normalizado, auditado y devuelto por /me', async () => {
      const r = await pedir('PATCH', '/api/auth/email', O.token, { email: '  Operario.PR@Empresa.COM ' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      assert.deepStrictEqual(r.cuerpo, { email: 'operario.pr@empresa.com' });

      const me = await pedir('GET', '/api/auth/me', O.token);
      assert.strictEqual(me.cuerpo.email, 'operario.pr@empresa.com');

      const aud = await auditoriaEmail(O.id);
      assert.strictEqual(aud.length, 1);
      assert.strictEqual(Number(aud[0].realizado_por_usuario_id), O.id);
      assert.strictEqual(Number(aud[0].sobre_usuario_id), O.id);
      assert.strictEqual(aud[0].accion, 'USUARIO_MODIFICADO');
      assert.strictEqual(aud[0].detalle.anterior.email, null);
      assert.strictEqual(aud[0].detalle.nuevo.email, 'operario.pr@empresa.com');
      assert.strictEqual(aud[0].detalle.nuevo.nombre, 'Operario');

      // El mismo email que ya tiene otro usuario se acepta, como en la edición de usuarios
      const repetido = await pedir('PATCH', '/api/auth/email', R.token, { email: 'operario.pr@empresa.com' });
      assert.deepStrictEqual([repetido.status, repetido.cuerpo], [200, { email: 'operario.pr@empresa.com' }]);
    });

    await t.test('PR-08: email inválido', async () => {
      const antes = await usuarioEnBase(O.id);
      const audAntes = (await auditoriaEmail(O.id)).length;
      const casos: Array<[string, unknown]> = [
        ['sin arroba', 'sin-arroba'],
        ['con espacios', 'ana maria@empresa.com'],
        ['255 caracteres', 'a'.repeat(243) + '@empresa.com'],
        ['número', 123],
        ['booleano', true],
      ];
      for (const [caso, email] of casos) {
        const r = await pedir('PATCH', '/api/auth/email', O.token, { email });
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'EMAIL_INVALIDO'], `${caso}: ${JSON.stringify(r.cuerpo)}`);
      }
      const cuerpos: Array<[string, unknown]> = [
        ['vacío', {}],
        ['campo desconocido', { email: 'otro@empresa.com', perfil_id: 1 }],
        ['no es un objeto', ['otro@empresa.com']],
      ];
      for (const [caso, cuerpo] of cuerpos) {
        const r = await pedir('PATCH', '/api/auth/email', O.token, cuerpo);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `${caso}: ${JSON.stringify(r.cuerpo)}`);
      }
      assert.deepStrictEqual(await usuarioEnBase(O.id), antes, 'No cambió nada');
      assert.strictEqual((await auditoriaEmail(O.id)).length, audAntes, 'Sin auditoría');
    });

    await t.test('PR-09: null y vacío dejan el email en null', async () => {
      const r = await pedir('PATCH', '/api/auth/email', O.token, { email: null });
      assert.deepStrictEqual([r.status, r.cuerpo], [200, { email: null }], JSON.stringify(r.cuerpo));
      assert.strictEqual((await pedir('GET', '/api/auth/me', O.token)).cuerpo.email, null);
      const aud = await auditoriaEmail(O.id);
      assert.strictEqual(aud[aud.length - 1].detalle.anterior.email, 'operario.pr@empresa.com');
      assert.strictEqual(aud[aud.length - 1].detalle.nuevo.email, null);

      // Sin cambios: 422 SIN_CAMBIOS, como la edición de usuarios
      const igual = await pedir('PATCH', '/api/auth/email', O.token, { email: '   ' });
      assert.deepStrictEqual([igual.status, igual.cuerpo.codigo], [422, 'SIN_CAMBIOS']);

      await pedir('PATCH', '/api/auth/email', R.token, { email: '' });
      assert.strictEqual((await usuarioEnBase(R.id)).email, null, 'Vacío queda en null');
    });

    await t.test('PR-10: no cambia otros campos ni a otros usuarios', async () => {
      const antesO = await usuarioEnBase(O.id);
      const antesA = await usuarioEnBase(A.id);
      const r = await pedir('PATCH', '/api/auth/email', O.token, { email: 'nuevo.pr@empresa.com' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      assert.deepStrictEqual(await usuarioEnBase(O.id), { ...antesO, email: 'nuevo.pr@empresa.com' });
      assert.deepStrictEqual(await usuarioEnBase(A.id), antesA, 'El admin no cambia');

      const me = (await pedir('GET', '/api/auth/me', O.token)).cuerpo;
      assert.strictEqual(me.perfil.nombre, 'OPERARIO');
      assert.deepStrictEqual(me.sectores, []);
    });

    await t.test('PR-11: sin sesión, 401', async () => {
      const antes = await usuarioEnBase(O.id);
      const sin = await pedir('PATCH', '/api/auth/email', null, { email: 'intruso@empresa.com' });
      assert.strictEqual(sin.status, 401);
      assert.deepStrictEqual(await usuarioEnBase(O.id), antes);
    });
  } finally {
    client = await clienteSano(client);
    try {
      // La identidad y el logo, como estaban al empezar
      await client.query(
        `UPDATE configuracion_sistema
         SET nombre_sistema = $1, nombre_empresa = $2, logo = $3, logo_tipo = $4, actualizado_en = $5
         WHERE id = 1`,
        [inicio.nombre_sistema, inicio.nombre_empresa, inicio.logo, inicio.logo_tipo, inicio.actualizado_en]
      );
      if (createdUsuarioIds.length > 0) {
        await client.query(
          'DELETE FROM auditoria_permisos WHERE sobre_usuario_id = ANY($1) OR realizado_por_usuario_id = ANY($1)',
          [createdUsuarioIds]
        );
        await client.query('DELETE FROM usuario_sector WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUsuarioIds]);
      }
    } finally {
      client.release();
    }
  }
});
