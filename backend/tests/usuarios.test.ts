import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { pool } from '../functions/db.ts';
import app from '../functions/api.ts';
import { resolverPermisosEfectivos } from '../functions/intervenciones/permisos.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (USUARIOS TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

// Helpers para requests
async function postJson(path: string, body: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

async function getJson(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'GET',
    headers,
  });
}

test('Etapa U — Usuarios, perfiles y contraseñas', async (t) => {
  const client = await pool.connect();

  let adminToken = '';
  let adminId = 0;
  let operarioPerfilId = 0;
  let responsablePerfilId = 0;
  let adminPerfilId = 0;
  let idPerfilId = 0;
  let direccionPerfilId = 0;
  let sector1Id = 0;
  let sector2Id = 0;
  let sectorInactivoId = 0;
  let maquinaId = 0;

  try {
    // Setup inicial
    const resPerfiles = await client.query('SELECT id, nombre FROM perfiles');
    for (const r of resPerfiles.rows) {
      if (r.nombre === 'OPERARIO') operarioPerfilId = Number(r.id);
      if (r.nombre === 'RESPONSABLE_MANTENIMIENTO') responsablePerfilId = Number(r.id);
      if (r.nombre === 'ADMINISTRADOR') adminPerfilId = Number(r.id);
      if (r.nombre === 'I_D') idPerfilId = Number(r.id);
      if (r.nombre === 'DIRECCION') direccionPerfilId = Number(r.id);
    }

    // Sectores
    const resSectoresActivos = await client.query('SELECT id FROM sectores WHERE activo = TRUE ORDER BY id ASC LIMIT 2');
    if (resSectoresActivos.rows.length >= 2) {
      sector1Id = Number(resSectoresActivos.rows[0].id);
      sector2Id = Number(resSectoresActivos.rows[1].id);
    } else {
      const insS1 = await client.query(`
        INSERT INTO sectores (nombre, activo) VALUES ('Sector U1', TRUE)
        ON CONFLICT (nombre) DO UPDATE SET activo = TRUE RETURNING id
      `);
      sector1Id = Number(insS1.rows[0].id);

      const insS2 = await client.query(`
        INSERT INTO sectores (nombre, activo) VALUES ('Sector U2', TRUE)
        ON CONFLICT (nombre) DO UPDATE SET activo = TRUE RETURNING id
      `);
      sector2Id = Number(insS2.rows[0].id);
    }

    // Sector inactivo para pruebas
    const insSInact = await client.query(
      "INSERT INTO sectores (nombre, activo) VALUES ($1, FALSE) RETURNING id",
      [`Sector Inactivo ${Date.now()}`]
    );
    sectorInactivoId = Number(insSInact.rows[0].id);

    // Máquina para pruebas
    const resM = await client.query('SELECT id FROM maquinas WHERE activo = TRUE LIMIT 1');
    if (resM.rows.length > 0) {
      maquinaId = Number(resM.rows[0].id);
    } else {
      const insM = await client.query(
        "INSERT INTO maquinas (nombre, sector_id) VALUES ('Maq Test U', $1) RETURNING id",
        [sector1Id]
      );
      maquinaId = Number(insM.rows[0].id);
    }

    // Admin login
    const adminPass = process.env.ADMIN_INITIAL_PASSWORD || 'admin';
    const resAdmin = await client.query("SELECT id, legajo FROM usuarios WHERE legajo = 'ADMIN001'");
    if (resAdmin.rows.length > 0) {
      adminId = Number(resAdmin.rows[0].id);
      // Aseguramos password conocido para tests
      const hash = await bcrypt.hash(adminPass, 10);
      await client.query(
        "UPDATE usuarios SET password_hash = $1, activo = TRUE, debe_cambiar_password = FALSE WHERE id = $2",
        [hash, adminId]
      );
    } else {
      const hash = await bcrypt.hash(adminPass, 10);
      const insA = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, debe_cambiar_password)
         VALUES ('ADMIN001', 'Admin', 'Sistema', $1, $2, TRUE, FALSE) RETURNING id`,
        [hash, adminPerfilId]
      );
      adminId = Number(insA.rows[0].id);
    }

    const loginRes = await postJson('/api/auth/login', { legajo: 'ADMIN001', password: adminPass });
    assert.strictEqual(loginRes.status, 200);
    const loginData = await loginRes.json();
    adminToken = loginData.token;

    let operarioU01Id = 0;
    const operarioU01Legajo = `OP_U01_${Date.now()}`;

    // U-01: Admin crea un operario con dos sectores
    await t.test('U-01: Admin crea un operario con dos sectores', async () => {
      const res = await postJson('/api/usuarios', {
        legajo: operarioU01Legajo,
        nombre: 'Carlos',
        apellido: 'Gómez',
        perfil_id: operarioPerfilId,
        sectores: [sector1Id, sector2Id],
        password_temporal: 'temporal123',
      }, adminToken);

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(data.id);
      operarioU01Id = data.id;
      assert.strictEqual(data.debe_cambiar_password, true);
      assert.strictEqual(data.activo, true);
      assert.deepStrictEqual(data.sectores, [sector1Id, sector2Id]);

      // Verificar en base de datos
      const resDb = await client.query(
        'SELECT legajo, password_hash, debe_cambiar_password, activo FROM usuarios WHERE id = $1',
        [operarioU01Id]
      );
      assert.strictEqual(resDb.rows.length, 1);
      const row = resDb.rows[0];
      assert.strictEqual(row.debe_cambiar_password, true);
      assert.notStrictEqual(row.password_hash, 'temporal123');
      assert.ok(row.password_hash.startsWith('$2'));

      // Sectores en usuario_sector
      const resSec = await client.query(
        'SELECT sector_id FROM usuario_sector WHERE usuario_id = $1 ORDER BY sector_id ASC',
        [operarioU01Id]
      );
      assert.strictEqual(resSec.rows.length, 2);

      // Auditoría USUARIO_CREADO sin la contraseña
      const resAud = await client.query(
        "SELECT accion, detalle FROM auditoria_permisos WHERE sobre_usuario_id = $1 AND accion = 'USUARIO_CREADO'",
        [operarioU01Id]
      );
      assert.strictEqual(resAud.rows.length, 1);
      assert.strictEqual(resAud.rows[0].detalle.includes('temporal123'), false);
      assert.strictEqual(resAud.rows[0].detalle.includes('$2'), false);
    });

    // U-02: Legajo repetido; perfil inexistente; sector inactivo; contraseña corta o igual a legajo
    await t.test('U-02: Validaciones en alta de usuario', async () => {
      // 1. Legajo repetido -> 409 LEGAJO_DUPLICADO
      const resDup = await postJson('/api/usuarios', {
        legajo: operarioU01Legajo,
        nombre: 'Otro',
        perfil_id: operarioPerfilId,
        password_temporal: 'claveValida123',
      }, adminToken);
      assert.strictEqual(resDup.status, 409);
      assert.strictEqual((await resDup.json()).codigo, 'LEGAJO_DUPLICADO');

      // 2. Perfil inexistente -> 422 DATOS_INVALIDOS
      const resPerf = await postJson('/api/usuarios', {
        legajo: `TEST_P_${Date.now()}`,
        nombre: 'Otro',
        perfil_id: 9999999,
        password_temporal: 'claveValida123',
      }, adminToken);
      assert.strictEqual(resPerf.status, 422);
      assert.strictEqual((await resPerf.json()).codigo, 'DATOS_INVALIDOS');

      // 3. Sector inactivo -> 422 DATOS_INVALIDOS
      const resSecInact = await postJson('/api/usuarios', {
        legajo: `TEST_S_${Date.now()}`,
        nombre: 'Otro',
        perfil_id: operarioPerfilId,
        sectores: [sectorInactivoId],
        password_temporal: 'claveValida123',
      }, adminToken);
      assert.strictEqual(resSecInact.status, 422);
      assert.strictEqual((await resSecInact.json()).codigo, 'DATOS_INVALIDOS');

      // 4. Contraseña de 5 caracteres -> 422 PASSWORD_INVALIDA
      const resPassCorta = await postJson('/api/usuarios', {
        legajo: `TEST_PC_${Date.now()}`,
        nombre: 'Otro',
        perfil_id: operarioPerfilId,
        password_temporal: '12345',
      }, adminToken);
      assert.strictEqual(resPassCorta.status, 422);
      assert.strictEqual((await resPassCorta.json()).codigo, 'PASSWORD_INVALIDA');

      // 5. Contraseña igual al legajo -> 422 PASSWORD_INVALIDA
      const legajoIgual = `SAME_${Date.now()}`;
      const resPassIgual = await postJson('/api/usuarios', {
        legajo: legajoIgual,
        nombre: 'Otro',
        perfil_id: operarioPerfilId,
        password_temporal: legajoIgual,
      }, adminToken);
      assert.strictEqual(resPassIgual.status, 422);
      assert.strictEqual((await resPassIgual.json()).codigo, 'PASSWORD_INVALIDA');
    });

    let operarioTokenViejo = '';

    // U-03: El operario nuevo ingresa
    await t.test('U-03: Operario nuevo ingresa con contraseña temporal', async () => {
      const resLogin = await postJson('/api/auth/login', {
        legajo: operarioU01Legajo,
        password: 'temporal123',
      });
      assert.strictEqual(resLogin.status, 200);
      const data = await resLogin.json();
      assert.ok(data.token);
      operarioTokenViejo = data.token;
      assert.strictEqual(data.debe_cambiar_password, true);

      // GET /api/intervenciones debe fallar con 403 CAMBIO_PASSWORD_REQUERIDO
      const resInt = await getJson('/api/intervenciones', operarioTokenViejo);
      assert.strictEqual(resInt.status, 403);
      assert.strictEqual((await resInt.json()).codigo, 'CAMBIO_PASSWORD_REQUERIDO');

      // GET /api/auth/me debe permitirse y responder 200
      const resMe = await getJson('/api/auth/me', operarioTokenViejo);
      assert.strictEqual(resMe.status, 200);
      const meData = await resMe.json();
      assert.strictEqual(meData.id, operarioU01Id);
      assert.strictEqual(meData.debe_cambiar_password, true);
    });

    let operarioTokenNuevo = '';

    // U-04: Cambia su contraseña: (a) actual incorrecta, (b) corta, (c) igual a la actual, (d) válida
    await t.test('U-04: Cambio de contraseña del operario e invalidación de sesión anterior', async () => {
      // (a) Actual incorrecta -> 401 CREDENCIALES_INVALIDAS
      const resA = await postJson('/api/auth/cambiar-password', {
        password_actual: 'incorrecta123',
        password_nueva: 'nuevaClave123',
      }, operarioTokenViejo);
      assert.strictEqual(resA.status, 401);
      assert.strictEqual((await resA.json()).codigo, 'CREDENCIALES_INVALIDAS');

      // (b) Nueva de 6 caracteres -> 422 PASSWORD_INVALIDA
      const resB = await postJson('/api/auth/cambiar-password', {
        password_actual: 'temporal123',
        password_nueva: '123456',
      }, operarioTokenViejo);
      assert.strictEqual(resB.status, 422);
      assert.strictEqual((await resB.json()).codigo, 'PASSWORD_INVALIDA');

      // (c) Nueva igual a la actual -> 422 PASSWORD_INVALIDA
      const resC = await postJson('/api/auth/cambiar-password', {
        password_actual: 'temporal123',
        password_nueva: 'temporal123',
      }, operarioTokenViejo);
      assert.strictEqual(resC.status, 422);
      assert.strictEqual((await resC.json()).codigo, 'PASSWORD_INVALIDA');

      // (d) Válida -> 200 con token nuevo, flag en FALSE
      const resD = await postJson('/api/auth/cambiar-password', {
        password_actual: 'temporal123',
        password_nueva: 'nuevaClaveValida123',
      }, operarioTokenViejo);
      assert.strictEqual(resD.status, 200);
      const dataD = await resD.json();
      assert.ok(dataD.token);
      operarioTokenNuevo = dataD.token;

      // Verificar flag en base de datos
      const resDb = await client.query('SELECT debe_cambiar_password FROM usuarios WHERE id = $1', [operarioU01Id]);
      assert.strictEqual(resDb.rows[0].debe_cambiar_password, false);

      // Con el token viejo cualquier pedido -> 401 SESION_INVALIDADA
      const resViejo = await getJson('/api/intervenciones', operarioTokenViejo);
      assert.strictEqual(resViejo.status, 401);
      assert.strictEqual((await resViejo.json()).codigo, 'SESION_INVALIDADA');

      // Con el token nuevo, GET /api/intervenciones -> 200
      const resNuevo = await getJson('/api/intervenciones', operarioTokenNuevo);
      assert.strictEqual(resNuevo.status, 200);
    });

    // U-05: Permisos efectivos en login y /me
    await t.test('U-05: Permisos efectivos en login y /me sin permisos en JWT', async () => {
      const legajoEx = `U05_${Date.now()}`;
      const hash = await bcrypt.hash('claveValida123', 10);
      const insU = await client.query(`
        INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
        VALUES ($1, 'Usuario U05', $2, $3, TRUE, FALSE) RETURNING id
      `, [legajoEx, hash, operarioPerfilId]);
      const uId = Number(insU.rows[0].id);

      // Asignar sector
      await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)', [uId, sector1Id]);

      // Agregar excepción CONCEDER COSTOS_VER con SECTORES
      const resCostos = await client.query("SELECT id FROM permisos WHERE codigo = 'COSTOS_VER'");
      const permCostosId = resCostos.rows[0].id;
      await client.query(`
        INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
        VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Test U05 Conceder', $3)
      `, [uId, permCostosId, adminId]);

      // Agregar excepción DENEGAR INTERVENCIONES_CREAR
      const resCrear = await client.query("SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_CREAR'");
      const permCrearId = resCrear.rows[0].id;
      await client.query(`
        INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, motivo, otorgado_por_usuario_id)
        VALUES ($1, $2, 'DENEGAR', 'Test U05 Denegar', $3)
      `, [uId, permCrearId, adminId]);

      // Login
      const resLogin = await postJson('/api/auth/login', {
        legajo: legajoEx,
        password: 'claveValida123',
      });
      assert.strictEqual(resLogin.status, 200);
      const loginData = await resLogin.json();
      const token = loginData.token;

      // Permisos efectivos esperados
      const expectedInfo = await resolverPermisosEfectivos(client, uId);
      assert.deepStrictEqual(loginData.user.permisos, expectedInfo.permisos);
      assert.strictEqual(loginData.user.permisos.COSTOS_VER, 'SECTORES');
      assert.strictEqual('INTERVENCIONES_CREAR' in loginData.user.permisos, false);

      // Verificar que el JWT no traiga ni perfil ni permisos
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      assert.strictEqual('permisos' in payload, false);
      assert.strictEqual('perfil' in payload, false);
      assert.ok('sub' in payload);
      assert.ok('legajo' in payload);
      assert.ok('iat' in payload);
      assert.ok('exp' in payload);

      // GET /api/auth/me
      const resMe = await getJson('/api/auth/me', token);
      assert.strictEqual(resMe.status, 200);
      const meData = await resMe.json();
      assert.deepStrictEqual(meData.permisos, expectedInfo.permisos);
    });

    // U-06: PATCH: cambiar perfil y sectores
    await t.test('U-06: PATCH modifica perfil y sectores con auditoría', async () => {
      // Intentar enviar legajo -> 422 DATOS_INVALIDOS
      const resLeg = await patchJson(`/api/usuarios/${operarioU01Id}`, {
        legajo: 'MOD_LEGAJO',
      }, adminToken);
      assert.strictEqual(resLeg.status, 422);
      assert.strictEqual((await resLeg.json()).codigo, 'DATOS_INVALIDOS');

      // Modificar perfil a RESPONSABLE_MANTENIMIENTO y sectores a [sector1Id]
      const countAudBefore = await client.query(
        "SELECT COUNT(*)::integer AS total FROM auditoria_permisos WHERE sobre_usuario_id = $1",
        [operarioU01Id]
      );
      const audBefore = Number(countAudBefore.rows[0].total);

      const resPatch = await patchJson(`/api/usuarios/${operarioU01Id}`, {
        perfil_id: responsablePerfilId,
        sectores: [sector1Id],
      }, adminToken);
      assert.strictEqual(resPatch.status, 200);

      // Verificar 2 filas de auditoría: PERFIL_CAMBIADO y SECTORES_CAMBIADOS
      const resAud = await client.query(`
        SELECT accion, detalle FROM auditoria_permisos
        WHERE sobre_usuario_id = $1
        ORDER BY id DESC LIMIT 2
      `, [operarioU01Id]);

      assert.strictEqual(resAud.rows.length, 2);
      const acciones = resAud.rows.map((r) => r.accion);
      assert.ok(acciones.includes('PERFIL_CAMBIADO'));
      assert.ok(acciones.includes('SECTORES_CAMBIADOS'));

      // Desde el pedido siguiente el middleware aplica los permisos del nuevo perfil
      // Como ahora es Responsable, puede listar usuarios si tuviera permiso, o iniciar intervenciones
      const infoPost = await resolverPermisosEfectivos(client, operarioU01Id);
      assert.ok('INTERVENCIONES_CAMBIAR_ESTADO' in infoPost.permisos);
    });

    // U-07: Admin intenta modificarse, desactivarse o restablecerse a sí mismo
    await t.test('U-07: Protecciones de autogestión para el administrador', async () => {
      // 1. PATCH sobre sí mismo -> 403 AUTOGESTION_NO_PERMITIDA
      const resPatch = await patchJson(`/api/usuarios/${adminId}`, {
        nombre: 'Nuevo Nombre Propio',
      }, adminToken);
      assert.strictEqual(resPatch.status, 403);
      assert.strictEqual((await resPatch.json()).codigo, 'AUTOGESTION_NO_PERMITIDA');

      // 2. Desactivarse a sí mismo -> 403 AUTOGESTION_NO_PERMITIDA
      const resDesact = await postJson(`/api/usuarios/${adminId}/desactivar`, {
        motivo: 'Motivo de prueba autogestión',
      }, adminToken);
      assert.strictEqual(resDesact.status, 403);
      assert.strictEqual((await resDesact.json()).codigo, 'AUTOGESTION_NO_PERMITIDA');

      // 3. Restablecerse a sí mismo -> 403 AUTOGESTION_NO_PERMITIDA
      const resReset = await postJson(`/api/usuarios/${adminId}/restablecer-password`, {
        password_temporal: 'temporalAdmin123',
      }, adminToken);
      assert.strictEqual(resReset.status, 403);
      assert.strictEqual((await resReset.json()).codigo, 'AUTOGESTION_NO_PERMITIDA');
    });

    // U-08: Responsable con USUARIOS_GESTIONAR concedido por excepción intenta crear ADMINISTRADOR y OPERARIO
    await t.test('U-08: Responsable con USUARIOS_GESTIONAR no puede asignar perfil con permisos superiores', async () => {
      const legajoR = `RESP_GEST_${Date.now()}`;
      const hash = await bcrypt.hash('claveResp123', 10);
      const insR = await client.query(`
        INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
        VALUES ($1, 'Resp Gestor', $2, $3, TRUE, FALSE) RETURNING id
      `, [legajoR, hash, responsablePerfilId]);
      const respId = Number(insR.rows[0].id);

      // Conceder USUARIOS_GESTIONAR por excepción individual
      const resPermUg = await client.query("SELECT id FROM permisos WHERE codigo = 'USUARIOS_GESTIONAR'");
      const permUgId = resPermUg.rows[0].id;
      await client.query(`
        INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
        VALUES ($1, $2, 'CONCEDER', 'TODAS', 'Permiso para gestionar usuarios test U08', $3)
      `, [respId, permUgId, adminId]);

      // Login del responsable
      const loginResp = await postJson('/api/auth/login', { legajo: legajoR, password: 'claveResp123' });
      assert.strictEqual(loginResp.status, 200);
      const tokenResp = (await loginResp.json()).token;

      // 1. Intenta crear usuario ADMINISTRADOR -> 403 PERFIL_NO_ASIGNABLE
      const resAdminFail = await postJson('/api/usuarios', {
        legajo: `NEW_ADMIN_${Date.now()}`,
        nombre: 'Admin Ilegal',
        perfil_id: adminPerfilId,
        password_temporal: 'temporalAdmin123',
      }, tokenResp);
      assert.strictEqual(resAdminFail.status, 403);
      assert.strictEqual((await resAdminFail.json()).codigo, 'PERFIL_NO_ASIGNABLE');

      // 2. Intenta crear usuario OPERARIO -> 201 Exitoso
      const resOpOk = await postJson('/api/usuarios', {
        legajo: `NEW_OP_${Date.now()}`,
        nombre: 'Operario Legal',
        perfil_id: operarioPerfilId,
        password_temporal: 'temporalOp123',
      }, tokenResp);
      assert.strictEqual(resOpOk.status, 201);
    });

    // U-09: Único administrador activo: otro usuario con USUARIOS_GESTIONAR intenta desactivarlo o cambiarle el perfil
    await t.test('U-09: Protección de último administrador activo', async () => {
      try {
        // Aseguramos que solo ADMIN001 sea el único admin activo
        await client.query(`
          UPDATE usuarios SET activo = FALSE
          WHERE perfil_id = $1 AND id != $2
        `, [adminPerfilId, adminId]);

        // Usuario gestor secundario
        const legajoG = `GESTOR_${Date.now()}`;
        const hash = await bcrypt.hash('claveGestor123', 10);
        const insG = await client.query(`
          INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
          VALUES ($1, 'Gestor Secundario', $2, $3, TRUE, FALSE) RETURNING id
        `, [legajoG, hash, responsablePerfilId]);
        const gestorId = Number(insG.rows[0].id);

        const resUg = await client.query("SELECT id FROM permisos WHERE codigo = 'USUARIOS_GESTIONAR'");
        await client.query(`
          INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
          VALUES ($1, $2, 'CONCEDER', 'TODAS', 'Gestor U09', $3)
        `, [gestorId, resUg.rows[0].id, adminId]);

        const loginG = await postJson('/api/auth/login', { legajo: legajoG, password: 'claveGestor123' });
        const tokenG = (await loginG.json()).token;

        // 1. Intenta desactivar al único admin activo -> 409 ULTIMO_ADMINISTRADOR
        const resDesact = await postJson(`/api/usuarios/${adminId}/desactivar`, {
          motivo: 'Intento desactivar unico admin',
        }, tokenG);
        assert.strictEqual(resDesact.status, 409);
        assert.strictEqual((await resDesact.json()).codigo, 'ULTIMO_ADMINISTRADOR');

        // 2. Intenta cambiarle el perfil al único admin activo -> 409 ULTIMO_ADMINISTRADOR
        const resPatch = await patchJson(`/api/usuarios/${adminId}`, {
          perfil_id: operarioPerfilId,
        }, tokenG);
        assert.strictEqual(resPatch.status, 409);
        assert.strictEqual((await resPatch.json()).codigo, 'ULTIMO_ADMINISTRADOR');

        // 3. Con dos administradores activos, desactivar uno -> 200
        const legajoA2 = `ADMIN2_${Date.now()}`;
        const insA2 = await client.query(`
          INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
          VALUES ($1, 'Admin 2', $2, $3, TRUE, FALSE) RETURNING id
        `, [legajoA2, hash, adminPerfilId]);
        const admin2Id = Number(insA2.rows[0].id);

        // Ahora hay 2 admins. Desactivar admin2Id -> 200
        const resDesactOk = await postJson(`/api/usuarios/${admin2Id}/desactivar`, {
          motivo: 'Desactivando admin 2 con exito',
        }, adminToken);
        assert.strictEqual(resDesactOk.status, 200);
      } finally {
        // Revertir y asegurar que ADMIN001 quede activo pase o falle la prueba
        await client.query('UPDATE usuarios SET activo = TRUE WHERE id = $1', [adminId]);
      }
    });

    // U-10: Concurrencia: dos administradores, A1 y A2, se desactivan mutuamente a la vez
    await t.test('U-10: Concurrencia en desactivación de administradores', async () => {
      try {
        const hash = await bcrypt.hash('adminMutuo123', 10);
        const legajoA1 = `CONC_A1_${Date.now()}`;
        const legajoA2 = `CONC_A2_${Date.now()}`;

        // Aseguramos que solo existan A1 y A2 como administradores activos
        await client.query('UPDATE usuarios SET activo = FALSE WHERE perfil_id = $1', [adminPerfilId]);

        const insA1 = await client.query(`
          INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
          VALUES ($1, 'Admin Conc 1', $2, $3, TRUE, FALSE) RETURNING id
        `, [legajoA1, hash, adminPerfilId]);
        const idA1 = Number(insA1.rows[0].id);

        const insA2 = await client.query(`
          INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
          VALUES ($1, 'Admin Conc 2', $2, $3, TRUE, FALSE) RETURNING id
        `, [legajoA2, hash, adminPerfilId]);
        const idA2 = Number(insA2.rows[0].id);

        const login1 = await postJson('/api/auth/login', { legajo: legajoA1, password: 'adminMutuo123' });
        const tokenA1 = (await login1.json()).token;

        const login2 = await postJson('/api/auth/login', { legajo: legajoA2, password: 'adminMutuo123' });
        const tokenA2 = (await login2.json()).token;

        // Ejecutar desactivación mutua en simultáneo con Promise.all
        const [res1, res2] = await Promise.all([
          postJson(`/api/usuarios/${idA2}/desactivar`, { motivo: 'Desactivando A2 desde A1' }, tokenA1),
          postJson(`/api/usuarios/${idA1}/desactivar`, { motivo: 'Desactivando A1 desde A2' }, tokenA2),
        ]);

        assert.notStrictEqual(res1.status, 500, 'res1 no debe responder 500');
        assert.notStrictEqual(res2.status, 500, 'res2 no debe responder 500');

        const statuses = [res1.status, res2.status];
        const winners = statuses.filter((s) => s === 200);
        assert.strictEqual(winners.length, 1, 'Exactamente una solicitud debe responder 200');

        // El perdedor puede recibir 409 (ULTIMO_ADMINISTRADOR o RECURSO_OCUPADO) o 401 (si su propio usuario ya fue desactivado)
        const loserStatus = statuses.find((s) => s !== 200);
        assert.ok(
          loserStatus === 409 || loserStatus === 401,
          `El perdedor debe recibir 409 o 401, pero recibió ${loserStatus}`
        );

        // Aserción obligatoria: queda exactamente un administrador activo
        const resActivos = await client.query(`
          SELECT COUNT(*)::integer AS total FROM usuarios WHERE perfil_id = $1 AND activo = TRUE
        `, [adminPerfilId]);
        assert.strictEqual(Number(resActivos.rows[0].total), 1, 'Debe quedar exactamente un admin activo');

        // Variante: forzar solapamiento con bloqueo previo de otra conexión
        const legajoB1 = `SOLAP_B1_${Date.now()}`;
        const legajoB2 = `SOLAP_B2_${Date.now()}`;

        // Desactivar cualquier otro admin para tener exactamente B1 y B2
        await client.query('UPDATE usuarios SET activo = FALSE WHERE perfil_id = $1', [adminPerfilId]);

        const insB1 = await client.query(`
          INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
          VALUES ($1, 'Admin Solap 1', $2, $3, TRUE, FALSE) RETURNING id
        `, [legajoB1, hash, adminPerfilId]);
        const idB1 = Number(insB1.rows[0].id);

        const insB2 = await client.query(`
          INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
          VALUES ($1, 'Admin Solap 2', $2, $3, TRUE, FALSE) RETURNING id
        `, [legajoB2, hash, adminPerfilId]);
        const idB2 = Number(insB2.rows[0].id);

        const loginB1 = await postJson('/api/auth/login', { legajo: legajoB1, password: 'adminMutuo123' });
        const tokenB1 = (await loginB1.json()).token;

        const loginB2 = await postJson('/api/auth/login', { legajo: legajoB2, password: 'adminMutuo123' });
        const tokenB2 = (await loginB2.json()).token;

        // Otra conexión bloquea las dos filas con FOR UPDATE
        const blockerClient = await pool.connect();
        try {
          await blockerClient.query('BEGIN');
          await blockerClient.query(
            'SELECT id FROM usuarios WHERE id IN ($1, $2) ORDER BY id ASC FOR UPDATE',
            [idB1, idB2]
          );

          // Lanzar ambos pedidos
          const p1 = postJson(`/api/usuarios/${idB2}/desactivar`, { motivo: 'Solapando B1 a B2' }, tokenB1);
          const p2 = postJson(`/api/usuarios/${idB1}/desactivar`, { motivo: 'Solapando B2 a B1' }, tokenB2);

          // Pequeña espera para asegurar que ambas peticiones estén en curso esperando el lock
          await new Promise((resolve) => setTimeout(resolve, 80));

          // Liberar el bloqueo
          await blockerClient.query('COMMIT');

          // Esperar los resultados
          const [resB1, resB2] = await Promise.all([p1, p2]);

          assert.notStrictEqual(resB1.status, 500, 'resB1 no debe ser 500');
          assert.notStrictEqual(resB2.status, 500, 'resB2 no debe ser 500');

          const bStatuses = [resB1.status, resB2.status];
          assert.strictEqual(bStatuses.filter((s) => s === 200).length, 1, 'Exactamente una debe ser 200');
          const bLoser = bStatuses.find((s) => s !== 200);
          assert.ok(bLoser === 409 || bLoser === 401, `El perdedor solapado debe ser 409 o 401, fue ${bLoser}`);

          // Debe quedar exactamente un admin activo entre B1 y B2
          const resActivosB = await client.query(`
            SELECT COUNT(*)::integer AS total FROM usuarios WHERE perfil_id = $1 AND activo = TRUE
          `, [adminPerfilId]);
          assert.strictEqual(Number(resActivosB.rows[0].total), 1);
        } finally {
          await blockerClient.query('ROLLBACK').catch(() => {});
          blockerClient.release();
        }

      } finally {
        // Revertir siempre y reactivar ADMIN001 para que la base nunca quede rota
        await client.query('UPDATE usuarios SET activo = TRUE WHERE id = $1', [adminId]);
      }
    });

    // U-11: Desactivar a un responsable con 2 intervenciones abiertas
    await t.test('U-11: Desactivar responsable con intervenciones abiertas', async () => {
      const legajoR = `RESP_AB_${Date.now()}`;
      const hash = await bcrypt.hash('clave12345678', 10);
      const insR = await client.query(`
        INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
        VALUES ($1, 'Resp Abiertas', $2, $3, TRUE, FALSE) RETURNING id
      `, [legajoR, hash, responsablePerfilId]);
      const respId = Number(insR.rows[0].id);

      // Login previo para obtener token
      const loginR = await postJson('/api/auth/login', { legajo: legajoR, password: 'clave12345678' });
      const tokenR = (await loginR.json()).token;

      // Crear 2 intervenciones abiertas asignadas a respId
      await client.query(`
        INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, responsable_usuario_id, estado, descripcion)
        VALUES 
          ($1, 1, $2, $3, 'PENDIENTE', 'Int abierta 1 test U11'),
          ($1, 1, $2, $3, 'EN_PROCESO', 'Int abierta 2 test U11')
      `, [maquinaId, adminId, respId]);

      // Desactivar
      const resDesact = await postJson(`/api/usuarios/${respId}/desactivar`, {
        motivo: 'Desactivando responsable con trabajo abierto',
      }, adminToken);

      assert.strictEqual(resDesact.status, 200);
      const dataDesact = await resDesact.json();
      assert.strictEqual(dataDesact.intervenciones_abiertas_como_responsable, 2);

      // Ese usuario ya no puede ingresar (401)
      const resReLogin = await postJson('/api/auth/login', { legajo: legajoR, password: 'clave12345678' });
      assert.strictEqual(resReLogin.status, 401);
      assert.strictEqual((await resReLogin.json()).codigo, 'CREDENCIALES_INVALIDAS');

      // Un pedido con su token anterior -> 401 (usuario inactivo)
      const resReq = await getJson('/api/intervenciones', tokenR);
      assert.strictEqual(resReq.status, 401);
    });

    // U-12: Reactivar; reactivar un activo; desactivar sin motivo
    await t.test('U-12: Reactivar usuario y validaciones de motivo', async () => {
      // Tomamos un usuario inactivo
      const legajoInact = `U12_INACT_${Date.now()}`;
      const hash = await bcrypt.hash('clave12345678', 10);
      const ins = await client.query(`
        INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
        VALUES ($1, 'Usuario Inactivo U12', $2, $3, FALSE, FALSE) RETURNING id
      `, [legajoInact, hash, operarioPerfilId]);
      const uId = Number(ins.rows[0].id);

      // 1. Reactivar exitoso -> 200
      const resReact = await postJson(`/api/usuarios/${uId}/reactivar`, {
        motivo: 'Reactivando para reincorporación',
      }, adminToken);
      assert.strictEqual(resReact.status, 200);

      // 2. Reactivar un usuario ya activo -> 422 SIN_CAMBIOS
      const resReactDup = await postJson(`/api/usuarios/${uId}/reactivar`, {
        motivo: 'Intento de reactivación redundante',
      }, adminToken);
      assert.strictEqual(resReactDup.status, 422);
      assert.strictEqual((await resReactDup.json()).codigo, 'SIN_CAMBIOS');

      // 3. Desactivar sin motivo -> 422 MOTIVO_REQUERIDO
      const resSinMotivo = await postJson(`/api/usuarios/${uId}/desactivar`, {
        motivo: '   ',
      }, adminToken);
      assert.strictEqual(resSinMotivo.status, 422);
      assert.strictEqual((await resSinMotivo.json()).codigo, 'MOTIVO_REQUERIDO');
    });

    // U-13: Restablecer contraseña
    await t.test('U-13: Restablecer contraseña temporal e invalidar token previo', async () => {
      const legajoRst = `U13_RST_${Date.now()}`;
      const hash = await bcrypt.hash('claveVieja123', 10);
      const ins = await client.query(`
        INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
        VALUES ($1, 'Usuario Reset', $2, $3, TRUE, FALSE) RETURNING id
      `, [legajoRst, hash, operarioPerfilId]);
      const uId = Number(ins.rows[0].id);

      // Usuario ingresa con clave vieja
      const loginOld = await postJson('/api/auth/login', { legajo: legajoRst, password: 'claveVieja123' });
      assert.strictEqual(loginOld.status, 200);
      const oldToken = (await loginOld.json()).token;

      // Admin restablece contraseña
      const resReset = await postJson(`/api/usuarios/${uId}/restablecer-password`, {
        password_temporal: 'temporalNueva123',
      }, adminToken);
      assert.strictEqual(resReset.status, 200);

      // No entra con la vieja
      const loginFail = await postJson('/api/auth/login', { legajo: legajoRst, password: 'claveVieja123' });
      assert.strictEqual(loginFail.status, 401);

      // Su token anterior queda invalidado (401 SESION_INVALIDADA)
      const resOldToken = await getJson('/api/intervenciones', oldToken);
      assert.strictEqual(resOldToken.status, 401);
      assert.strictEqual((await resOldToken.json()).codigo, 'SESION_INVALIDADA');

      // Entra con la temporal y queda obligado a cambiarla
      const loginTemp = await postJson('/api/auth/login', { legajo: legajoRst, password: 'temporalNueva123' });
      assert.strictEqual(loginTemp.status, 200);
      const tempLoginData = await loginTemp.json();
      const tempToken = tempLoginData.token;
      assert.strictEqual(tempLoginData.debe_cambiar_password, true);

      // Con el token temporal no puede navegar otros endpoints
      const resTempInt = await getJson('/api/intervenciones', tempToken);
      assert.strictEqual(resTempInt.status, 403);
      assert.strictEqual((await resTempInt.json()).codigo, 'CAMBIO_PASSWORD_REQUERIDO');
    });

    // U-14: Sin USUARIOS_GESTIONAR en cada endpoint de la sección 5 -> 403
    await t.test('U-14: Endpoints protegidos con USUARIOS_GESTIONAR rechazan usuarios sin permiso', async () => {
      // Crear operario sin USUARIOS_GESTIONAR
      const legajoOp = `OP_SIN_PERM_${Date.now()}`;
      const hash = await bcrypt.hash('operario123', 10);
      const ins = await client.query(`
        INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
        VALUES ($1, 'Operario Sin Perm', $2, $3, TRUE, FALSE) RETURNING id
      `, [legajoOp, hash, operarioPerfilId]);
      const opId = Number(ins.rows[0].id);

      const loginOp = await postJson('/api/auth/login', { legajo: legajoOp, password: 'operario123' });
      const opToken = (await loginOp.json()).token;

      // Probar cada endpoint de la sección 5
      assert.strictEqual((await getJson('/api/perfiles', opToken)).status, 403);
      assert.strictEqual((await getJson('/api/usuarios', opToken)).status, 403);
      assert.strictEqual((await getJson(`/api/usuarios/${opId}`, opToken)).status, 403);
      assert.strictEqual((await postJson('/api/usuarios', { legajo: 'X' }, opToken)).status, 403);
      assert.strictEqual((await patchJson(`/api/usuarios/${opId}`, { nombre: 'X' }, opToken)).status, 403);
      assert.strictEqual((await postJson(`/api/usuarios/${opId}/desactivar`, { motivo: 'test' }, opToken)).status, 403);
      assert.strictEqual((await postJson(`/api/usuarios/${opId}/reactivar`, { motivo: 'test' }, opToken)).status, 403);
      assert.strictEqual((await postJson(`/api/usuarios/${opId}/restablecer-password`, { password_temporal: 'test' }, opToken)).status, 403);
    });

    // U-15: GET /api/usuarios con filtros y GET /api/usuarios/:id detalle sin password_hash
    await t.test('U-15: Consultas de usuarios con filtros y detalle sin password_hash', async () => {
      // Filtros
      const resList = await getJson(`/api/usuarios?texto=ADMIN001&activo=true&perfil_id=${adminPerfilId}`, adminToken);
      assert.strictEqual(resList.status, 200);
      const listData = await resList.json();
      assert.ok(Array.isArray(listData));
      assert.ok(listData.length >= 1);
      assert.strictEqual(listData[0].legajo, 'ADMIN001');

      // Verificar que ningún usuario de la lista exponga password_hash
      for (const u of listData) {
        assert.strictEqual('password_hash' in u, false);
      }

      // Detalle
      const resDetail = await getJson(`/api/usuarios/${adminId}`, adminToken);
      assert.strictEqual(resDetail.status, 200);
      const detailData = await resDetail.json();
      assert.strictEqual(detailData.id, adminId);
      assert.strictEqual('password_hash' in detailData, false);
      assert.ok('permisos' in detailData);
      assert.ok('excepciones' in detailData);
      assert.ok(typeof detailData.intervenciones_abiertas_como_responsable === 'number');
    });

    // U-16: Perfiles I_D y DIRECCION
    await t.test('U-16: Capacidades y restricciones de perfiles I_D y DIRECCION', async () => {
      const hash = await bcrypt.hash('clave12345678', 10);

      // Crear usuario I_D
      const legajoID = `ID_${Date.now()}`;
      const insID = await client.query(`
        INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
        VALUES ($1, 'Usuario I+D', $2, $3, TRUE, FALSE) RETURNING id
      `, [legajoID, hash, idPerfilId]);
      const idUserId = Number(insID.rows[0].id);

      // Crear usuario DIRECCION
      const legajoDir = `DIR_${Date.now()}`;
      const insDir = await client.query(`
        INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
        VALUES ($1, 'Usuario Direccion', $2, $3, TRUE, FALSE) RETURNING id
      `, [legajoDir, hash, direccionPerfilId]);
      const dirUserId = Number(insDir.rows[0].id);

      const loginID = await postJson('/api/auth/login', { legajo: legajoID, password: 'clave12345678' });
      const tokenID = (await loginID.json()).token;

      const loginDir = await postJson('/api/auth/login', { legajo: legajoDir, password: 'clave12345678' });
      const tokenDir = (await loginDir.json()).token;

      // Crear una intervención de prueba pendiente y asignada a idUserId
      const insInt = await client.query(`
        INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, responsable_usuario_id, estado, descripcion)
        VALUES ($1, 1, $2, $3, 'PENDIENTE', 'Intervencion prueba U16') RETURNING id
      `, [maquinaId, adminId, idUserId]);
      const intId = Number(insInt.rows[0].id);

      // 1. Usuario I_D puede iniciar la intervención
      const resIniciarID = await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenID);
      assert.strictEqual(resIniciarID.status, 200);

      // 2. Usuario DIRECCION puede ver las intervenciones
      const resVerDir = await getJson('/api/intervenciones', tokenDir);
      assert.strictEqual(resVerDir.status, 200);

      // 3. Usuario DIRECCION NO puede cambiar estado de intervención -> 403
      const resIniciarDir = await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenDir);
      assert.strictEqual(resIniciarDir.status, 403);

      // 4. Usuario DIRECCION recibe aviso de falla nueva
      // Crear una falla en sector de la máquina
      const countNotifBefore = await client.query(
        'SELECT COUNT(*)::integer AS total FROM notificaciones WHERE usuario_id = $1',
        [dirUserId]
      );
      const notifBefore = Number(countNotifBefore.rows[0].total);

      // Admin reporta falla
      const resFalla = await postJson('/api/intervenciones', {
        maquina_id: maquinaId,
        descripcion: 'Falla para notificar a Dirección U16',
        detiene_maquina: false,
      }, adminToken);
      assert.strictEqual(resFalla.status, 201);

      const countNotifAfter = await client.query(
        'SELECT COUNT(*)::integer AS total FROM notificaciones WHERE usuario_id = $1',
        [dirUserId]
      );
      assert.strictEqual(Number(countNotifAfter.rows[0].total), notifBefore + 1, 'DIRECCION debe recibir notificación de falla');
    });

    // U-17: Fallo forzado (trigger) al insertar la auditoría de un alta
    await t.test('U-17: Rollback transaccional si falla la inserción de auditoría en alta', async () => {
      // Crear función y trigger que falle si el legajo contiene 'TRIGGER_FAIL'
      await client.query(`
        CREATE OR REPLACE FUNCTION trg_fn_test_fail_auditoria() RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.detalle LIKE '%TRIGGER_FAIL%' THEN
            RAISE EXCEPTION 'Fallo forzado de prueba auditoria';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_test_fail_auditoria ON auditoria_permisos;
        CREATE TRIGGER trg_test_fail_auditoria
        BEFORE INSERT ON auditoria_permisos
        FOR EACH ROW EXECUTE FUNCTION trg_fn_test_fail_auditoria();
      `);

      const legajoFail = `TRIGGER_FAIL_${Date.now()}`;

      try {
        const res = await postJson('/api/usuarios', {
          legajo: legajoFail,
          nombre: 'Usuario Fallo',
          perfil_id: operarioPerfilId,
          sectores: [sector1Id],
          password_temporal: 'temporalFail123',
        }, adminToken);

        // Debe retornar 500
        assert.strictEqual(res.status, 500);

        // Verificar que el usuario no exista
        const resUser = await client.query('SELECT id FROM usuarios WHERE legajo = $1', [legajoFail]);
        assert.strictEqual(resUser.rows.length, 0);

        // Verificar que no queden filas huérfanas en usuario_sector
        const resSec = await client.query(`
          SELECT us.* FROM usuario_sector us
          LEFT JOIN usuarios u ON us.usuario_id = u.id
          WHERE u.id IS NULL
        `);
        assert.strictEqual(resSec.rows.length, 0);

      } finally {
        await client.query(`
          DROP TRIGGER IF EXISTS trg_test_fail_auditoria ON auditoria_permisos;
          DROP FUNCTION IF EXISTS trg_fn_test_fail_auditoria();
        `);
      }
    });

    // U-19: Cambiar contraseña y usar el token nuevo inmediatamente (sin esperas); token viejo 401 SESION_INVALIDADA
    await t.test('U-19: Uso inmediato de nuevo token e invalidación determinista por versión de sesión', async () => {
      const legajoU19 = `U19_${Date.now()}`;
      const hash19 = await bcrypt.hash('inicial123456', 10);
      const ins19 = await client.query(`
        INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo, debe_cambiar_password)
        VALUES ($1, 'Usuario U19', $2, $3, TRUE, FALSE) RETURNING id
      `, [legajoU19, hash19, responsablePerfilId]);
      const u19Id = Number(ins19.rows[0].id);

      // Login inicial -> obtener token viejo
      const loginRes = await postJson('/api/auth/login', {
        legajo: legajoU19,
        password: 'inicial123456',
      });
      assert.strictEqual(loginRes.status, 200);
      const tokenViejo = (await loginRes.json()).token;

      // Cambiar contraseña inmediatamente
      const changeRes = await postJson('/api/auth/cambiar-password', {
        password_actual: 'inicial123456',
        password_nueva: 'nuevaClaveU19_2026',
      }, tokenViejo);
      assert.strictEqual(changeRes.status, 200);
      const tokenNuevo = (await changeRes.json()).token;
      assert.ok(tokenNuevo, 'Debe devolver un nuevo token');

      // Usar inmediatamente el token nuevo, SIN ESPERAS: 200
      const resNuevo = await getJson('/api/auth/me', tokenNuevo);
      assert.strictEqual(resNuevo.status, 200, 'El token nuevo debe funcionar inmediatamente');
      const meData = await resNuevo.json();
      assert.strictEqual(meData.id, u19Id);

      // Usar inmediatamente el token viejo: 401 SESION_INVALIDADA
      const resViejo = await getJson('/api/auth/me', tokenViejo);
      assert.strictEqual(resViejo.status, 401, 'El token viejo debe rechazarse inmediatamente con 401');
      const viejoData = await resViejo.json();
      assert.strictEqual(viejoData.codigo, 'SESION_INVALIDADA');
    });

  } finally {
    client.release();
  }
});
