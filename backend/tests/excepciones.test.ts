import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (EXCEPCIONES TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

// Helpers para requests
async function getJson(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'GET',
    headers,
  });
}

async function postJson(path: string, body: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function putJson(path: string, body: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
}

async function deleteJson(path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'DELETE',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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

test('Etapa API-05 — Excepciones de permisos por usuario (EX-01 a EX-10)', async (t) => {
  const client = await pool.connect();

  const createdUserIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];

  const suf = Date.now();

  try {
    // 1. Obtener IDs de perfiles
    const resPerfiles = await client.query('SELECT id, nombre FROM perfiles');
    let adminPerfilId = 0;
    let respPerfilId = 0;
    let operarioPerfilId = 0;

    for (const r of resPerfiles.rows) {
      if (r.nombre === 'ADMINISTRADOR') adminPerfilId = Number(r.id);
      if (r.nombre === 'RESPONSABLE_MANTENIMIENTO') respPerfilId = Number(r.id);
      if (r.nombre === 'OPERARIO') operarioPerfilId = Number(r.id);
    }

    assert.ok(adminPerfilId > 0, 'Perfil ADMINISTRADOR debe existir');
    assert.ok(respPerfilId > 0, 'Perfil RESPONSABLE_MANTENIMIENTO debe existir');
    assert.ok(operarioPerfilId > 0, 'Perfil OPERARIO debe existir');

    // 2. Crear sector y máquina propios para pruebas
    const insSec = await client.query(
      'INSERT INTO sectores (nombre, activo) VALUES ($1, TRUE) RETURNING id',
      [`Sector_EX_${suf}`]
    );
    const sectorId = Number(insSec.rows[0].id);
    createdSectorIds.push(sectorId);

    const insMaq = await client.query(
      'INSERT INTO maquinas (nombre, sector_id) VALUES ($1, $2) RETURNING id',
      [`Maq_EX_${suf}`, sectorId]
    );
    const maquinaId = Number(insMaq.rows[0].id);
    createdMaquinaIds.push(maquinaId);

    // 3. Crear usuarios de prueba con contraseña conocida
    const passHash = await bcrypt.hash('pass123', 10);

    // Admin de la prueba
    const insAdmin = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, debe_cambiar_password, sesion_version)
       VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, 1) RETURNING id, legajo, sesion_version, nombre, apellido`,
      [`ADM_EX_${suf}`, 'Admin', 'PruebaEX', passHash, adminPerfilId]
    );
    const testAdmin = insAdmin.rows[0];
    const testAdminId = Number(testAdmin.id);
    createdUserIds.push(testAdminId);
    const testAdminToken = await getTokenForUser(testAdmin);

    // Operario de la prueba
    const insOp = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, debe_cambiar_password, sesion_version)
       VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, 1) RETURNING id, legajo, sesion_version, nombre, apellido`,
      [`OP_EX_${suf}`, 'Operario', 'PruebaEX', passHash, operarioPerfilId]
    );
    const testOp = insOp.rows[0];
    const testOpId = Number(testOp.id);
    createdUserIds.push(testOpId);
    const testOpToken = await getTokenForUser(testOp);

    // Asignar sector al operario
    await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)', [testOpId, sectorId]);

    // Responsable de la prueba
    const insResp = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, debe_cambiar_password, sesion_version)
       VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, 1) RETURNING id, legajo, sesion_version, nombre, apellido`,
      [`RSP_EX_${suf}`, 'Responsable', 'PruebaEX', passHash, respPerfilId]
    );
    const testResp = insResp.rows[0];
    const testRespId = Number(testResp.id);
    createdUserIds.push(testRespId);
    const testRespToken = await getTokenForUser(testResp);

    // EX-01: GET /api/permisos
    await t.test('EX-01: GET /api/permisos — 200 ordenado con usa_alcance, 403 para operario', async () => {
      // 403 con operario
      const resForbidden = await getJson('/api/permisos', testOpToken);
      assert.strictEqual(resForbidden.status, 403);
      const errJson = await resForbidden.json();
      assert.strictEqual(errJson.codigo, 'PERMISO_INSUFICIENTE');

      // 200 con admin
      const resOk = await getJson('/api/permisos', testAdminToken);
      assert.strictEqual(resOk.status, 200);
      const catalogo: any[] = await resOk.json();
      assert.ok(Array.isArray(catalogo));
      assert.ok(catalogo.length > 0);

      // Verificar orden ascendente por código
      for (let i = 0; i < catalogo.length - 1; i++) {
        assert.ok(
          catalogo[i].codigo.localeCompare(catalogo[i + 1].codigo) <= 0,
          `El catálogo debe estar ordenado por código: ${catalogo[i].codigo} <= ${catalogo[i + 1].codigo}`
        );
      }

      // Verificar usa_alcance exactamente en los 5 permisos definidos
      const esperadosTrue = new Set([
        'INTERVENCIONES_VER',
        'INTERVENCIONES_CREAR',
        'INTERVENCIONES_EDITAR',
        'REPORTES_CONSULTAR',
        'NOTIFICACIONES_FALLAS_RECIBIR',
      ]);

      for (const p of catalogo) {
        assert.ok('id' in p && typeof p.id === 'number');
        assert.ok('codigo' in p && typeof p.codigo === 'string');
        assert.ok('nombre' in p && typeof p.nombre === 'string');
        assert.ok('usa_alcance' in p && typeof p.usa_alcance === 'boolean');

        if (esperadosTrue.has(p.codigo)) {
          assert.strictEqual(p.usa_alcance, true, `Permiso ${p.codigo} debe tener usa_alcance = true`);
        } else {
          assert.strictEqual(p.usa_alcance, false, `Permiso ${p.codigo} debe tener usa_alcance = false`);
        }
      }
    });

    // EX-02: Conceder INTERVENCIONES_VER con SECTORES a un operario de la prueba
    await t.test('EX-02: Conceder INTERVENCIONES_VER con SECTORES a un operario', async () => {
      // Token del operario obtenido ANTES del cambio
      const tokenPrevioOp = testOpToken;

      const resPut = await putJson(
        `/api/usuarios/${testOpId}/excepciones/INTERVENCIONES_VER`,
        {
          efecto: 'CONCEDER',
          alcance: 'SECTORES',
          motivo: 'Cubre el turno noche en Pintura',
        },
        testAdminToken
      );

      assert.strictEqual(resPut.status, 200);
      const userUpdated = await resPut.json();

      // Permiso efectivo agregado
      assert.strictEqual(userUpdated.permisos.INTERVENCIONES_VER, 'SECTORES');

      // Excepción en la lista con otorgado_por y usa_alcance
      const excep = userUpdated.excepciones.find((e: any) => e.codigo === 'INTERVENCIONES_VER');
      assert.ok(excep, 'La excepción INTERVENCIONES_VER debe figurar en la respuesta');
      assert.strictEqual(excep.efecto, 'CONCEDER');
      assert.strictEqual(excep.alcance, 'SECTORES');
      assert.strictEqual(excep.motivo, 'Cubre el turno noche en Pintura');
      assert.strictEqual(excep.usa_alcance, true);
      assert.ok(excep.otorgado_por, 'Debe incluir otorgado_por');
      assert.strictEqual(excep.otorgado_por.id, testAdminId);
      assert.strictEqual(excep.otorgado_por.nombre, testAdmin.nombre);

      // Auditoría: fila EXCEPCION_CREADA
      const resAud = await client.query(
        `SELECT accion, detalle FROM auditoria_permisos
         WHERE sobre_usuario_id = $1 AND accion = 'EXCEPCION_CREADA'
         ORDER BY id DESC LIMIT 1`,
        [testOpId]
      );
      assert.strictEqual(resAud.rows.length, 1);
      const detalleAud = typeof resAud.rows[0].detalle === 'string'
        ? JSON.parse(resAud.rows[0].detalle)
        : resAud.rows[0].detalle;

      assert.strictEqual(detalleAud.codigo, 'INTERVENCIONES_VER');
      assert.strictEqual(detalleAud.efecto, 'CONCEDER');
      assert.strictEqual(detalleAud.alcance, 'SECTORES');
      assert.strictEqual(detalleAud.motivo, 'Cubre el turno noche en Pintura');

      // Con el token previo del operario, GET /api/auth/me ya muestra el permiso nuevo
      const resMe = await getJson('/api/auth/me', tokenPrevioOp);
      assert.strictEqual(resMe.status, 200);
      const meData = await resMe.json();
      assert.strictEqual(meData.permisos.INTERVENCIONES_VER, 'SECTORES');
    });

    // EX-03: Cambiarla a TODAS -> EXCEPCION_MODIFICADA, y SIN_CAMBIOS al repetir
    await t.test('EX-03: Cambiar excepción a TODAS y verificar EXCEPCION_MODIFICADA y SIN_CAMBIOS', async () => {
      const resPut = await putJson(
        `/api/usuarios/${testOpId}/excepciones/INTERVENCIONES_VER`,
        {
          efecto: 'CONCEDER',
          alcance: 'TODAS',
          motivo: 'Pasa a turno rotativo general',
        },
        testAdminToken
      );

      assert.strictEqual(resPut.status, 200);
      const userUpdated = await resPut.json();
      assert.strictEqual(userUpdated.permisos.INTERVENCIONES_VER, 'TODAS');

      // Auditoría: EXCEPCION_MODIFICADA con anterior.alcance = 'SECTORES'
      const resAud = await client.query(
        `SELECT accion, detalle FROM auditoria_permisos
         WHERE sobre_usuario_id = $1 AND accion = 'EXCEPCION_MODIFICADA'
         ORDER BY id DESC LIMIT 1`,
        [testOpId]
      );
      assert.strictEqual(resAud.rows.length, 1);
      const detalleAud = typeof resAud.rows[0].detalle === 'string'
        ? JSON.parse(resAud.rows[0].detalle)
        : resAud.rows[0].detalle;

      assert.strictEqual(detalleAud.codigo, 'INTERVENCIONES_VER');
      assert.strictEqual(detalleAud.alcance, 'TODAS');
      assert.ok(detalleAud.anterior);
      assert.strictEqual(detalleAud.anterior.alcance, 'SECTORES');

      // Mismo cuerpo otra vez: 422 SIN_CAMBIOS
      const resRepetido = await putJson(
        `/api/usuarios/${testOpId}/excepciones/INTERVENCIONES_VER`,
        {
          efecto: 'CONCEDER',
          alcance: 'TODAS',
          motivo: 'Pasa a turno rotativo general',
        },
        testAdminToken
      );

      assert.strictEqual(resRepetido.status, 422);
      const repetidoJson = await resRepetido.json();
      assert.strictEqual(repetidoJson.codigo, 'SIN_CAMBIOS');
    });

    // EX-04: Denegar INTERVENCIONES_CREAR a un responsable de la prueba
    await t.test('EX-04: Denegar INTERVENCIONES_CREAR a un responsable -> desaparece de efectivos y POST 403', async () => {
      const resPut = await putJson(
        `/api/usuarios/${testRespId}/excepciones/INTERVENCIONES_CREAR`,
        {
          efecto: 'DENEGAR',
          motivo: 'Sancionado temporalmente sin creacion',
        },
        testAdminToken
      );

      assert.strictEqual(resPut.status, 200);
      const userUpdated = await resPut.json();
      assert.strictEqual(userUpdated.permisos.INTERVENCIONES_CREAR, undefined);

      // POST /api/intervenciones con el token del responsable devuelve 403
      const resPost = await postJson(
        '/api/intervenciones',
        {
          maquina_id: maquinaId,
          descripcion: 'Falla de prueba para verificar denegación',
        },
        testRespToken
      );

      assert.strictEqual(resPost.status, 403);
      const postJsonErr = await resPost.json();
      assert.strictEqual(postJsonErr.codigo, 'PERMISO_INSUFICIENTE');
    });

    // EX-05: Quitar una excepción -> vuelve el perfil, EXCEPCION_ELIMINADA con anterior, 404 si no existe, 422 sin motivo
    await t.test('EX-05: Quitar excepción -> vuelve permiso, EXCEPCION_ELIMINADA, 404 al repetir, 422 sin motivo', async () => {
      // 1. Quitar la excepción DENEGAR de INTERVENCIONES_CREAR
      const resDel = await deleteJson(
        `/api/usuarios/${testRespId}/excepciones/INTERVENCIONES_CREAR`,
        { motivo: 'Fin de la sancion aplicada' },
        testAdminToken
      );

      assert.strictEqual(resDel.status, 200);
      const userUpdated = await resDel.json();
      assert.ok(userUpdated.permisos.INTERVENCIONES_CREAR, 'INTERVENCIONES_CREAR debe reaparecer en los efectivos');

      // Auditoría: fila EXCEPCION_ELIMINADA con anterior
      const resAud = await client.query(
        `SELECT accion, detalle FROM auditoria_permisos
         WHERE sobre_usuario_id = $1 AND accion = 'EXCEPCION_ELIMINADA'
         ORDER BY id DESC LIMIT 1`,
        [testRespId]
      );
      assert.strictEqual(resAud.rows.length, 1);
      const detalleAud = typeof resAud.rows[0].detalle === 'string'
        ? JSON.parse(resAud.rows[0].detalle)
        : resAud.rows[0].detalle;

      assert.strictEqual(detalleAud.codigo, 'INTERVENCIONES_CREAR');
      assert.ok(detalleAud.anterior);
      assert.strictEqual(detalleAud.anterior.efecto, 'DENEGAR');

      // 2. Quitarla de nuevo: 404 EXCEPCION_NO_ENCONTRADA
      const resDelRepetido = await deleteJson(
        `/api/usuarios/${testRespId}/excepciones/INTERVENCIONES_CREAR`,
        { motivo: 'Fin de la sancion aplicada' },
        testAdminToken
      );
      assert.strictEqual(resDelRepetido.status, 404);
      const delRepJson = await resDelRepetido.json();
      assert.strictEqual(delRepJson.codigo, 'EXCEPCION_NO_ENCONTRADA');

      // 3. Sin motivo (o motivo menor a 5 caracteres): 422 MOTIVO_REQUERIDO
      const resSinMotivo = await deleteJson(
        `/api/usuarios/${testRespId}/excepciones/INTERVENCIONES_CREAR`,
        { motivo: '   ' },
        testAdminToken
      );
      assert.strictEqual(resSinMotivo.status, 422);
      const sinMotivoJson = await resSinMotivo.json();
      assert.strictEqual(sinMotivoJson.codigo, 'MOTIVO_REQUERIDO');
    });

    // EX-06: Validaciones (a) a (g)
    await t.test('EX-06: Validaciones (a) a (g)', async () => {
      // (a) Código inexistente: 404 PERMISO_NO_ENCONTRADO
      const resA = await putJson(
        `/api/usuarios/${testOpId}/excepciones/PERMISO_FANTASMA`,
        { efecto: 'CONCEDER', alcance: 'TODAS', motivo: 'Motivo valido' },
        testAdminToken
      );
      assert.strictEqual(resA.status, 404);
      assert.strictEqual((await resA.json()).codigo, 'PERMISO_NO_ENCONTRADO');

      // (b) efecto: 'OTRO': 400 DATOS_INVALIDOS
      const resB = await putJson(
        `/api/usuarios/${testOpId}/excepciones/INTERVENCIONES_VER`,
        { efecto: 'OTRO', alcance: 'TODAS', motivo: 'Motivo valido' },
        testAdminToken
      );
      assert.strictEqual(resB.status, 400);
      assert.strictEqual((await resB.json()).codigo, 'DATOS_INVALIDOS');

      // (c) Conceder INTERVENCIONES_VER sin alcance: 400 DATOS_INVALIDOS
      const resC = await putJson(
        `/api/usuarios/${testOpId}/excepciones/INTERVENCIONES_VER`,
        { efecto: 'CONCEDER', motivo: 'Motivo valido' },
        testAdminToken
      );
      assert.strictEqual(resC.status, 400);
      assert.strictEqual((await resC.json()).codigo, 'DATOS_INVALIDOS');

      // (d) Denegar con alcance: 400 DATOS_INVALIDOS
      const resD = await putJson(
        `/api/usuarios/${testOpId}/excepciones/INTERVENCIONES_VER`,
        { efecto: 'DENEGAR', alcance: 'TODAS', motivo: 'Motivo valido' },
        testAdminToken
      );
      assert.strictEqual(resD.status, 400);
      assert.strictEqual((await resD.json()).codigo, 'DATOS_INVALIDOS');

      // (e) Conceder MAQUINAS_GESTIONAR con SECTORES: 400; sin alcance: 200, guardado con TODAS
      const resE1 = await putJson(
        `/api/usuarios/${testOpId}/excepciones/MAQUINAS_GESTIONAR`,
        { efecto: 'CONCEDER', alcance: 'SECTORES', motivo: 'Motivo valido' },
        testAdminToken
      );
      assert.strictEqual(resE1.status, 400);
      assert.strictEqual((await resE1.json()).codigo, 'DATOS_INVALIDOS');

      const resE2 = await putJson(
        `/api/usuarios/${testOpId}/excepciones/MAQUINAS_GESTIONAR`,
        { efecto: 'CONCEDER', motivo: 'Motivo para maquinas gestionar' },
        testAdminToken
      );
      assert.strictEqual(resE2.status, 200);
      const userE2 = await resE2.json();
      assert.strictEqual(userE2.permisos.MAQUINAS_GESTIONAR, 'TODAS');
      const excepE2 = userE2.excepciones.find((e: any) => e.codigo === 'MAQUINAS_GESTIONAR');
      assert.strictEqual(excepE2.alcance, 'TODAS');

      // (f) Motivo de 3 letras: 422 MOTIVO_REQUERIDO
      const resF = await putJson(
        `/api/usuarios/${testOpId}/excepciones/INTERVENCIONES_VER`,
        { efecto: 'CONCEDER', alcance: 'TODAS', motivo: 'abc' },
        testAdminToken
      );
      assert.strictEqual(resF.status, 422);
      assert.strictEqual((await resF.json()).codigo, 'MOTIVO_REQUERIDO');

      // (g) Usuario inexistente: 404 USUARIO_NO_ENCONTRADO
      const resG = await putJson(
        `/api/usuarios/99999999/excepciones/INTERVENCIONES_VER`,
        { efecto: 'CONCEDER', alcance: 'TODAS', motivo: 'Motivo valido' },
        testAdminToken
      );
      assert.strictEqual(resG.status, 404);
      assert.strictEqual((await resG.json()).codigo, 'USUARIO_NO_ENCONTRADO');
    });

    // EX-07: Sin PERMISOS_GESTIONAR: un responsable con USUARIOS_GESTIONAR por SQL -> 403 PERMISO_INSUFICIENTE en PUT y DELETE
    await t.test('EX-07: Sin PERMISOS_GESTIONAR -> 403 PERMISO_INSUFICIENTE en PUT y DELETE', async () => {
      // Conceder solo USUARIOS_GESTIONAR por SQL al responsable
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         SELECT $1, p.id, 'CONCEDER', 'TODAS', 'Concedido para prueba EX-07', $2
         FROM permisos p
         WHERE p.codigo = 'USUARIOS_GESTIONAR'`,
        [testRespId, testAdminId]
      );

      // Intento de PUT
      const resPut = await putJson(
        `/api/usuarios/${testOpId}/excepciones/INTERVENCIONES_VER`,
        { efecto: 'CONCEDER', alcance: 'TODAS', motivo: 'Intento sin permiso gestionar' },
        testRespToken
      );
      assert.strictEqual(resPut.status, 403);
      assert.strictEqual((await resPut.json()).codigo, 'PERMISO_INSUFICIENTE');

      // Intento de DELETE
      const resDel = await deleteJson(
        `/api/usuarios/${testOpId}/excepciones/INTERVENCIONES_VER`,
        { motivo: 'Intento delete sin permiso gestionar' },
        testRespToken
      );
      assert.strictEqual(resDel.status, 403);
      assert.strictEqual((await resDel.json()).codigo, 'PERMISO_INSUFICIENTE');

      // Limpiar la excepción de USUARIOS_GESTIONAR del responsable
      await client.query('DELETE FROM usuario_permiso WHERE usuario_id = $1', [testRespId]);
    });

    // EX-08: ADMIN001 sobre sí mismo -> 403 AUTOGESTION_NO_PERMITIDA
    await t.test('EX-08: ADMIN001 sobre sí mismo -> 403 AUTOGESTION_NO_PERMITIDA', async () => {
      const resAdmin001 = await client.query(
        "SELECT id, legajo, sesion_version FROM usuarios WHERE legajo = 'ADMIN001'"
      );
      assert.ok(resAdmin001.rows.length > 0, 'ADMIN001 debe existir en la base');
      const admin001 = resAdmin001.rows[0];
      const admin001Token = await getTokenForUser({
        id: Number(admin001.id),
        legajo: admin001.legajo,
        sesion_version: Number(admin001.sesion_version),
      });

      // PUT sobre sí mismo
      const resPut = await putJson(
        `/api/usuarios/${admin001.id}/excepciones/INTERVENCIONES_VER`,
        { efecto: 'CONCEDER', alcance: 'TODAS', motivo: 'Auto-gestión no permitida' },
        admin001Token
      );
      assert.strictEqual(resPut.status, 403);
      assert.strictEqual((await resPut.json()).codigo, 'AUTOGESTION_NO_PERMITIDA');

      // DELETE sobre sí mismo
      const resDel = await deleteJson(
        `/api/usuarios/${admin001.id}/excepciones/INTERVENCIONES_VER`,
        { motivo: 'Auto-gestión no permitida' },
        admin001Token
      );
      assert.strictEqual(resDel.status, 403);
      assert.strictEqual((await resDel.json()).codigo, 'AUTOGESTION_NO_PERMITIDA');
    });

    // EX-09: No dar lo que no se tiene: un responsable con USUARIOS_GESTIONAR y PERMISOS_GESTIONAR concedidos por SQL
    await t.test('EX-09: Techo de permisos y alcances (8.5)', async () => {
      // Conceder USUARIOS_GESTIONAR y PERMISOS_GESTIONAR por SQL al responsable
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         SELECT $1, p.id, 'CONCEDER', 'TODAS', 'Concedido para prueba EX-09', $2
         FROM permisos p
         WHERE p.codigo IN ('USUARIOS_GESTIONAR', 'PERMISOS_GESTIONAR')`,
        [testRespId, testAdminId]
      );

      // (a) Conceder INTERVENCIONES_CORREGIR (que no posee): 403 PERMISO_NO_OTORGABLE
      const resA = await putJson(
        `/api/usuarios/${testOpId}/excepciones/INTERVENCIONES_CORREGIR`,
        { efecto: 'CONCEDER', motivo: 'Intento dar permiso que no tengo' },
        testRespToken
      );
      assert.strictEqual(resA.status, 403);
      assert.strictEqual((await resA.json()).codigo, 'PERMISO_NO_OTORGABLE');

      // (b) Con su INTERVENCIONES_VER bajado a SECTORES por SQL:
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         SELECT $1, p.id, 'CONCEDER', 'SECTORES', 'Bajado a sectores para prueba', $2
         FROM permisos p
         WHERE p.codigo = 'INTERVENCIONES_VER'
         ON CONFLICT (usuario_id, permiso_id) DO UPDATE SET alcance = 'SECTORES'`,
        [testRespId, testAdminId]
      );

      // Conceder INTERVENCIONES_VER con TODAS: 403 PERMISO_NO_OTORGABLE
      const resB1 = await putJson(
        `/api/usuarios/${testOpId}/excepciones/INTERVENCIONES_VER`,
        { efecto: 'CONCEDER', alcance: 'TODAS', motivo: 'Intento alcance mayor' },
        testRespToken
      );
      assert.strictEqual(resB1.status, 403);
      assert.strictEqual((await resB1.json()).codigo, 'PERMISO_NO_OTORGABLE');

      // Conceder INTERVENCIONES_VER con SECTORES: 200
      const resB2 = await putJson(
        `/api/usuarios/${testOpId}/excepciones/INTERVENCIONES_VER`,
        { efecto: 'CONCEDER', alcance: 'SECTORES', motivo: 'Alcance permitido igual' },
        testRespToken
      );
      assert.strictEqual(resB2.status, 200);

      // (c) Denegar INTERVENCIONES_CORREGIR (que no posee): 403 PERMISO_NO_OTORGABLE
      const resC = await putJson(
        `/api/usuarios/${testOpId}/excepciones/INTERVENCIONES_CORREGIR`,
        { efecto: 'DENEGAR', motivo: 'Intento denegar permiso que no tengo' },
        testRespToken
      );
      assert.strictEqual(resC.status, 403);
      assert.strictEqual((await resC.json()).codigo, 'PERMISO_NO_OTORGABLE');

      // Limpiar excepciones del responsable
      await client.query('DELETE FROM usuario_permiso WHERE usuario_id = $1', [testRespId]);
    });

    // EX-10: Todo en una transacción — si falla el registro de auditoría, la excepción no queda guardada
    await t.test('EX-10: Transaccionalidad: si falla auditoria_permisos, la excepción no queda guardada', async () => {
      // Usuario exclusivo para esta prueba
      const insUserFail = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, debe_cambiar_password, sesion_version)
         VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, 1) RETURNING id`,
        [`FAIL_EX_${suf}`, 'Usuario', 'FalloAuditoria', passHash, operarioPerfilId]
      );
      const userFailId = Number(insUserFail.rows[0].id);
      createdUserIds.push(userFailId);

      // Crear trigger para forzar fallo en auditoria_permisos
      await client.query(`
        CREATE OR REPLACE FUNCTION trg_fn_test_fail_auditoria()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.sobre_usuario_id = ${userFailId} THEN
            RAISE EXCEPTION 'Fallo forzado en auditoria_permisos para prueba EX-10';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_test_fail_auditoria ON auditoria_permisos;
        CREATE TRIGGER trg_test_fail_auditoria
        BEFORE INSERT ON auditoria_permisos
        FOR EACH ROW EXECUTE FUNCTION trg_fn_test_fail_auditoria();
      `);

      try {
        const resFail = await putJson(
          `/api/usuarios/${userFailId}/excepciones/INTERVENCIONES_VER`,
          { efecto: 'CONCEDER', alcance: 'TODAS', motivo: 'Motivo para fallo' },
          testAdminToken
        );

        // Debe retornar 500
        assert.strictEqual(resFail.status, 500);

        // Verificar que no se haya guardado ninguna excepción en usuario_permiso
        const resExFail = await client.query(
          'SELECT id FROM usuario_permiso WHERE usuario_id = $1',
          [userFailId]
        );
        assert.strictEqual(resExFail.rows.length, 0, 'No debe haber filas en usuario_permiso tras el rollback');

      } finally {
        await client.query(`
          DROP TRIGGER IF EXISTS trg_test_fail_auditoria ON auditoria_permisos;
          DROP FUNCTION IF EXISTS trg_fn_test_fail_auditoria();
        `).catch(() => {});
      }
    });

  } finally {
    // Limpieza estricta de datos creados en la suite
    await client.query(`
      DROP TRIGGER IF EXISTS trg_test_fail_auditoria ON auditoria_permisos;
      DROP FUNCTION IF EXISTS trg_fn_test_fail_auditoria();
    `).catch(() => {});

    if (createdUserIds.length > 0) {
      await client.query(
        'DELETE FROM auditoria_permisos WHERE sobre_usuario_id = ANY($1) OR realizado_por_usuario_id = ANY($1)',
        [createdUserIds]
      );
      await client.query(
        'DELETE FROM usuario_permiso WHERE usuario_id = ANY($1) OR otorgado_por_usuario_id = ANY($1)',
        [createdUserIds]
      );
      await client.query(
        'DELETE FROM usuario_sector WHERE usuario_id = ANY($1)',
        [createdUserIds]
      );
    }

    if (createdMaquinaIds.length > 0) {
      await client.query('DELETE FROM intervenciones WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
      await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [createdMaquinaIds]);
    }

    if (createdSectorIds.length > 0) {
      await client.query('DELETE FROM sectores WHERE id = ANY($1)', [createdSectorIds]);
    }

    if (createdUserIds.length > 0) {
      await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUserIds]);
    }

    client.release();
  }
});

