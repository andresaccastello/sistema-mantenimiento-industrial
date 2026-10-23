import { test } from 'node:test';
import assert from 'node:assert';
import { pool } from '../functions/db.ts';
import app from '../functions/api.ts';
import { recalcularEstadoMaquina } from '../functions/intervenciones/recalculoMaquina.ts';

// Configurar timeout de bloqueo para pruebas de concurrencia (3s para absorber latencia de red en Neon)
process.env.LOCK_TIMEOUT = '3s';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (MOTOR ESTADOS TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Etapa 4A — Motor de estados: núcleo, asignación e inicio del trabajo', async (t) => {
  const client = await pool.connect();

  const limpiarIntervenciones = async (ids: number[]) => {
    if (!ids || ids.length === 0) return;
    await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervencion_costos WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM documentos WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervencion_repuestos WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM historial_estados_maquina WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [ids]);
  };

  const limpiarMaquina = async (mId: number) => {
    await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = $1', [mId]);
    await client.query('DELETE FROM maquinas WHERE id = $1', [mId]);
  };

  let adminToken = '';
  let adminId = 0;

  let resp1Token = '';
  let resp1Id = 0;

  let resp2Token = '';
  let resp2Id = 0;

  let operarioToken = '';
  let operarioId = 0;

  let sector1Id = 0;
  let sector2Id = 0;
  let maquinaId = 0;

  try {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('pass123', 10);

    // 1. Admin login
    const resAdmin = await client.query("SELECT id FROM usuarios WHERE legajo = 'ADMIN001' LIMIT 1");
    adminId = Number(resAdmin.rows[0].id);

    const loginAdmin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: 'ADMIN001', password: process.env.ADMIN_INITIAL_PASSWORD || 'admin' })
    });
    const dAdmin = await loginAdmin.json();
    adminToken = dAdmin.token;

    // 2. Perfiles
    const resPerfiles = await client.query("SELECT id, nombre FROM perfiles");
    const perfilMap = Object.fromEntries(resPerfiles.rows.map(r => [r.nombre, Number(r.id)]));

    // 3. Crear Resp1 (Responsable de mantenimiento)
    const legajoR1 = 'R1_' + Date.now();
    const resR1 = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'Resp Uno', $2, $3) RETURNING id`,
      [legajoR1, hash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    resp1Id = Number(resR1.rows[0].id);
    const loginR1 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoR1, password: 'pass123' })
    });
    resp1Token = (await loginR1.json()).token;

    // 4. Crear Resp2 (Responsable de mantenimiento)
    const legajoR2 = 'R2_' + Date.now();
    const resR2 = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'Resp Dos', $2, $3) RETURNING id`,
      [legajoR2, hash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    resp2Id = Number(resR2.rows[0].id);
    const loginR2 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoR2, password: 'pass123' })
    });
    resp2Token = (await loginR2.json()).token;

    // 5. Crear Operario
    const legajoOp = 'OP_' + Date.now();
    const resOp = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'Operario Motor', $2, $3) RETURNING id`,
      [legajoOp, hash, perfilMap['OPERARIO']]
    );
    operarioId = Number(resOp.rows[0].id);
    const loginOp = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoOp, password: 'pass123' })
    });
    operarioToken = (await loginOp.json()).token;

    // 6. Crear Sectores y Máquina base
    const resSec1 = await client.query(
      "INSERT INTO sectores (nombre) VALUES ('Sector Motor A ' || $1) RETURNING id",
      [Date.now()]
    );
    sector1Id = Number(resSec1.rows[0].id);

    const resSec2 = await client.query(
      "INSERT INTO sectores (nombre) VALUES ('Sector Motor B ' || $1) RETURNING id",
      [Date.now()]
    );
    sector2Id = Number(resSec2.rows[0].id);

    const resMaq = await client.query(
      "INSERT INTO maquinas (nombre, sector_id, estado) VALUES ('Torno Motor CNC', $1, 'OPERATIVA') RETURNING id",
      [sector1Id]
    );
    maquinaId = Number(resMaq.rows[0].id);

    // =========================================================================
    // 9.1 ASIGNACIÓN
    // =========================================================================

    // P-01: Responsable toma una PENDIENTE sin responsable
    await t.test('P-01: Responsable toma una PENDIENTE sin responsable', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion para P-01' })
      });
      const dataPost = await resPost.json();
      const intId = dataPost.id;

      const resTomar = await app.request(`/api/intervenciones/${intId}/tomar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(resTomar.status, 200);

      // Verificar BD: responsable = resp1Id, estado sigue PENDIENTE
      const checkI = await client.query('SELECT estado, responsable_usuario_id FROM intervenciones WHERE id = $1', [intId]);
      assert.strictEqual(Number(checkI.rows[0].responsable_usuario_id), resp1Id);
      assert.strictEqual(checkI.rows[0].estado, 'PENDIENTE');

      // Ninguna fila nueva en historial de estados (solo la inicial NULL -> PENDIENTE)
      const checkH = await client.query('SELECT count(*) FROM historial_estados_intervencion WHERE intervencion_id = $1', [intId]);
      assert.strictEqual(Number(checkH.rows[0].count), 1);

      // 1 fila ASIGNACION en intervencion_auditoria
      const checkA = await client.query(
        "SELECT tipo_evento, valor_anterior, valor_nuevo FROM intervencion_auditoria WHERE intervencion_id = $1 AND tipo_evento = 'ASIGNACION'",
        [intId]
      );
      assert.strictEqual(checkA.rows.length, 1);
      assert.strictEqual(checkA.rows[0].valor_anterior, null);
      assert.strictEqual(Number(checkA.rows[0].valor_nuevo), resp1Id);
    });

    // P-02: Tomar una ya asignada a otro -> 409 INTERVENCION_YA_ASIGNADA
    await t.test('P-02: Tomar una ya asignada a otro da 409', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion para P-02' })
      });
      const intId = (await resPost.json()).id;

      // Resp1 la toma
      await app.request(`/api/intervenciones/${intId}/tomar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      // Resp2 intenta tomarla
      const resTomar2 = await app.request(`/api/intervenciones/${intId}/tomar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp2Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(resTomar2.status, 409);
      const err = await resTomar2.json();
      assert.strictEqual(err.codigo, 'INTERVENCION_YA_ASIGNADA');
    });

    // P-03: Operario (sin ASIGNARSE) intenta tomar -> 403
    await t.test('P-03: Operario sin ASIGNARSE intenta tomar da 403', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion para P-03' })
      });
      const intId = (await resPost.json()).id;

      const resTomar = await app.request(`/api/intervenciones/${intId}/tomar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${operarioToken}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(resTomar.status, 403);
    });

    // P-04: Asignar a usuario inactivo, sin RECIBIR_ASIGNACION, o con DENEGAR -> 422 RESPONSABLE_NO_HABILITADO
    await t.test('P-04: Validar destinatario de asignación', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion para P-04' })
      });
      const intId = (await resPost.json()).id;

      // (a) Usuario inactivo
      const resInactivo = await client.query(
        "INSERT INTO usuarios (legajo, nombre, perfil_id, activo) VALUES ($1, 'Inactivo', $2, FALSE) RETURNING id",
        ['INAC_' + Date.now(), perfilMap['RESPONSABLE_MANTENIMIENTO']]
      );
      const inactivoId = Number(resInactivo.rows[0].id);

      const rA = await app.request(`/api/intervenciones/${intId}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ usuario_id: inactivoId, estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(rA.status, 422);
      assert.strictEqual((await rA.json()).codigo, 'RESPONSABLE_NO_HABILITADO');

      // (b) Usuario sin RECIBIR_ASIGNACION (Operario)
      const rB = await app.request(`/api/intervenciones/${intId}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ usuario_id: operarioId, estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(rB.status, 422);
      assert.strictEqual((await rB.json()).codigo, 'RESPONSABLE_NO_HABILITADO');

      // (c) Usuario con perfil RESPONSABLE pero con excepción DENEGAR sobre RECIBIR_ASIGNACION
      const permRecibir = await client.query("SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_RECIBIR_ASIGNACION'");
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, otorgado_por_usuario_id)
         VALUES ($1, $2, 'DENEGAR', $3)`,
        [resp2Id, permRecibir.rows[0].id, adminId]
      );

      const rC = await app.request(`/api/intervenciones/${intId}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ usuario_id: resp2Id, estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(rC.status, 422);
      assert.strictEqual((await rC.json()).codigo, 'RESPONSABLE_NO_HABILITADO');

      // Limpiar excepción
      await client.query('DELETE FROM usuario_permiso WHERE usuario_id = $1', [resp2Id]);
    });

    // P-05: Asignar a un usuario con VER alcance SECTORES que no incluye el sector de la máquina -> 422 RESPONSABLE_SIN_VISIBILIDAD
    await t.test('P-05: Asignar a usuario sin visibilidad de sector da 422', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion para P-05' })
      });
      const intId = (await resPost.json()).id;

      // Cambiar temporalmente a Resp2 su alcance de VER a SECTORES y asignarle solo sector2Id (la máquina está en sector1Id)
      const permVer = await client.query("SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_VER'");
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id)
         VALUES ($1, $2, 'CONCEDER', 'SECTORES', $3)`,
        [resp2Id, permVer.rows[0].id, adminId]
      );
      await client.query("INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [resp2Id, sector2Id]);

      const resAsig = await app.request(`/api/intervenciones/${intId}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ usuario_id: resp2Id, estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(resAsig.status, 422);
      assert.strictEqual((await resAsig.json()).codigo, 'RESPONSABLE_SIN_VISIBILIDAD');

      // Limpiar
      await client.query('DELETE FROM usuario_permiso WHERE usuario_id = $1', [resp2Id]);
      await client.query('DELETE FROM usuario_sector WHERE usuario_id = $1', [resp2Id]);
    });

    // P-06: Reasignar una EN_PROCESO: (a) sin motivo -> 422 MOTIVO_REQUERIDO, (b) con motivo -> 200
    await t.test('P-06: Reasignar en EN_PROCESO exige motivo', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion para P-06' })
      });
      const intId = (await resPost.json()).id;

      // Iniciar asignando a Resp1
      await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      // (a) Reasignar sin motivo -> 422
      const rA = await app.request(`/api/intervenciones/${intId}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ usuario_id: resp2Id, estado_esperado: 'EN_PROCESO' })
      });
      assert.strictEqual(rA.status, 422);
      assert.strictEqual((await rA.json()).codigo, 'MOTIVO_REQUERIDO');

      // (b) Reasignar con motivo -> 200
      const rB = await app.request(`/api/intervenciones/${intId}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ usuario_id: resp2Id, estado_esperado: 'EN_PROCESO', motivo: 'Cambio de turno técnico' })
      });
      assert.strictEqual(rB.status, 200);

      // Verificar en BD
      const row = await client.query('SELECT responsable_usuario_id, estado FROM intervenciones WHERE id = $1', [intId]);
      assert.strictEqual(Number(row.rows[0].responsable_usuario_id), resp2Id);
      assert.strictEqual(row.rows[0].estado, 'EN_PROCESO');
    });

    // P-07: Quitar responsable: (a) en PENDIENTE con motivo -> 200, (b) en EN_PROCESO -> 409, (c) propio responsable con ASIGNARSE en PENDIENTE -> 200
    await t.test('P-07: Quitar responsable en PENDIENTE y bloqueo en EN_PROCESO', async () => {
      // (a) en PENDIENTE con motivo
      const resPost1 = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion para P-07 a' })
      });
      const id1 = (await resPost1.json()).id;
      await app.request(`/api/intervenciones/${id1}/tomar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      const rA = await app.request(`/api/intervenciones/${id1}/responsable`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'Reorganización de tareas' })
      });
      assert.strictEqual(rA.status, 200);
      const ch1 = await client.query('SELECT responsable_usuario_id FROM intervenciones WHERE id = $1', [id1]);
      assert.strictEqual(ch1.rows[0].responsable_usuario_id, null);

      // (b) en EN_PROCESO -> 409 DESASIGNACION_NO_PERMITIDA
      const resPost2 = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion para P-07 b' })
      });
      const id2 = (await resPost2.json()).id;
      await app.request(`/api/intervenciones/${id2}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      const rB = await app.request(`/api/intervenciones/${id2}/responsable`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', motivo: 'Intento de quitar' })
      });
      assert.strictEqual(rB.status, 409);
      assert.strictEqual((await rB.json()).codigo, 'DESASIGNACION_NO_PERMITIDA');

      // (c) propio responsable con ASIGNARSE en PENDIENTE -> 200
      const resPost3 = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion para P-07 c' })
      });
      const id3 = (await resPost3.json()).id;
      await app.request(`/api/intervenciones/${id3}/tomar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      const rC = await app.request(`/api/intervenciones/${id3}/responsable`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'Tomada por error' })
      });
      assert.strictEqual(rC.status, 200);
      const ch3 = await client.query('SELECT responsable_usuario_id FROM intervenciones WHERE id = $1', [id3]);
      assert.strictEqual(ch3.rows[0].responsable_usuario_id, null);
    });

    // =========================================================================
    // 9.2 TRANSICIONES
    // =========================================================================

    // P-08: Iniciar sin responsable, usuario con ASIGNARSE -> queda asignado y EN_PROCESO
    await t.test('P-08: Iniciar sin responsable asigna automáticamente al usuario', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion P-08' })
      });
      const intId = (await resPost.json()).id;

      const resIni = await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(resIni.status, 200);

      const check = await client.query('SELECT estado, responsable_usuario_id, fecha_inicio FROM intervenciones WHERE id = $1', [intId]);
      assert.strictEqual(check.rows[0].estado, 'EN_PROCESO');
      assert.strictEqual(Number(check.rows[0].responsable_usuario_id), resp1Id);
      assert.ok(check.rows[0].fecha_inicio !== null);
    });

    // P-09: Iniciar sin responsable, usuario con CAMBIAR_ESTADO pero ASIGNARSE denegado -> 422 RESPONSABLE_REQUERIDO
    await t.test('P-09: Iniciar sin responsable y sin ASIGNARSE da 422', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion P-09' })
      });
      const intId = (await resPost.json()).id;

      // Denegar ASIGNARSE a resp2
      const permAsignarse = await client.query("SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_ASIGNARSE'");
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, otorgado_por_usuario_id)
         VALUES ($1, $2, 'DENEGAR', $3)`,
        [resp2Id, permAsignarse.rows[0].id, adminId]
      );

      const resIni = await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp2Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(resIni.status, 422);
      assert.strictEqual((await resIni.json()).codigo, 'RESPONSABLE_REQUERIDO');

      await client.query('DELETE FROM usuario_permiso WHERE usuario_id = $1', [resp2Id]);
    });

    // P-10: Iniciar asignada a otro: (a) usuario sin ASIGNAR -> 403, (b) usuario con ASIGNAR -> 200
    await t.test('P-10: Iniciar intervención asignada a otro (regla de actor D-23)', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion P-10' })
      });
      const intId = (await resPost.json()).id;

      // Asignar a resp1
      await app.request(`/api/intervenciones/${intId}/tomar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      // (a) resp2 sin INTERVENCIONES_ASIGNAR intenta iniciar intervención de resp1 -> 403 NO_ES_RESPONSABLE
      const permAsig = await client.query("SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_ASIGNAR'");
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id)
         VALUES ($1, $2, 'DENEGAR', 'TODAS', $3)`,
        [resp2Id, permAsig.rows[0].id, adminId]
      );

      const resA = await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp2Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(resA.status, 403);
      assert.strictEqual((await resA.json()).codigo, 'NO_ES_RESPONSABLE');

      await client.query('DELETE FROM usuario_permiso WHERE usuario_id = $1', [resp2Id]);

      // (b) admin (tiene INTERVENCIONES_ASIGNAR) la inicia
      const resB = await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(resB.status, 200);
      const ch = await client.query('SELECT responsable_usuario_id, estado FROM intervenciones WHERE id = $1', [intId]);
      assert.strictEqual(Number(ch.rows[0].responsable_usuario_id), resp1Id, 'El responsable no debe cambiar');
      assert.strictEqual(ch.rows[0].estado, 'EN_PROCESO');
    });

    // P-11: fecha_inicio incoherente vs válida
    await t.test('P-11: Validación de fecha_inicio al iniciar', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion P-11' })
      });
      const intId = (await resPost.json()).id;

      // (a) Anterior a la creación (año 2000)
      const rA = await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', fecha_inicio: '2000-01-01T00:00:00Z' })
      });
      assert.strictEqual(rA.status, 422);
      assert.strictEqual((await rA.json()).codigo, 'FECHA_INCOHERENTE');

      // (b) Futura (año 2099)
      const rB = await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', fecha_inicio: '2099-01-01T00:00:00Z' })
      });
      assert.strictEqual(rB.status, 422);
      assert.strictEqual((await rB.json()).codigo, 'FECHA_INCOHERENTE');

      // (c) Válida
      const fechaValida = new Date().toISOString();
      const rC = await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', fecha_inicio: fechaValida })
      });
      assert.strictEqual(rC.status, 200);
    });

    // P-12: estado_esperado desactualizado -> 409 ESTADO_DESACTUALIZADO
    await t.test('P-12: estado_esperado desactualizado da 409', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion P-12' })
      });
      const intId = (await resPost.json()).id;

      const res = await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO' }) // Esperaba EN_PROCESO pero está en PENDIENTE
      });
      assert.strictEqual(res.status, 409);
      assert.strictEqual((await res.json()).codigo, 'ESTADO_DESACTUALIZADO');
    });

    // P-13: Matriz estado x acción
    await t.test('P-13: Matriz completa estado x acción', async () => {
      // 1. PENDIENTE: iniciar 200, espera 409, reanudar 409
      const rP = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'P13 Pendiente' })
      });
      const idP = (await rP.json()).id;

      const rP_esp = await app.request(`/api/intervenciones/${idP}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', observacion: 'Falta repuesto' })
      });
      assert.strictEqual(rP_esp.status, 409);

      const rP_rean = await app.request(`/api/intervenciones/${idP}/reanudar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(rP_rean.status, 409);

      // Iniciar idP -> pasa a EN_PROCESO
      const rP_ini = await app.request(`/api/intervenciones/${idP}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(rP_ini.status, 200);

      // 2. EN_PROCESO: iniciar 409, espera 200, reanudar 409
      const rEP_ini = await app.request(`/api/intervenciones/${idP}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO' })
      });
      assert.strictEqual(rEP_ini.status, 409);

      const rEP_rean = await app.request(`/api/intervenciones/${idP}/reanudar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO' })
      });
      assert.strictEqual(rEP_rean.status, 409);

      const rEP_esp = await app.request(`/api/intervenciones/${idP}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', observacion: 'Falta correa' })
      });
      assert.strictEqual(rEP_esp.status, 200);

      // 3. EN_ESPERA_REPUESTOS: iniciar 409, espera 409, reanudar 200
      const rER_ini = await app.request(`/api/intervenciones/${idP}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'EN_ESPERA_REPUESTOS' })
      });
      assert.strictEqual(rER_ini.status, 409);

      const rER_esp = await app.request(`/api/intervenciones/${idP}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'EN_ESPERA_REPUESTOS', observacion: 'Otra cosa' })
      });
      assert.strictEqual(rER_esp.status, 409);

      const rER_rean = await app.request(`/api/intervenciones/${idP}/reanudar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'EN_ESPERA_REPUESTOS' })
      });
      assert.strictEqual(rER_rean.status, 200);

      // 4. FINALIZADA (setup SQL)
      await client.query("UPDATE intervenciones SET estado = 'FINALIZADA', fecha_finalizacion = NOW() WHERE id = $1", [idP]);
      for (const endpoint of ['iniciar', 'espera-repuestos', 'reanudar']) {
        const res = await app.request(`/api/intervenciones/${idP}/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
          body: JSON.stringify({ estado_esperado: 'FINALIZADA', observacion: 'test' })
        });
        assert.strictEqual(res.status, 409);
      }

      // 5. CANCELADA (setup SQL)
      await client.query("UPDATE intervenciones SET estado = 'CANCELADA' WHERE id = $1", [idP]);
      for (const endpoint of ['iniciar', 'espera-repuestos', 'reanudar']) {
        const res = await app.request(`/api/intervenciones/${idP}/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
          body: JSON.stringify({ estado_esperado: 'CANCELADA', observacion: 'test' })
        });
        assert.strictEqual(res.status, 409);
      }
    });

    // P-14: Pasar a espera: (a) sin observacion -> 422, (b) con observacion -> 200
    await t.test('P-14: Pasar a espera exige observación mínima de 5 caracteres', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion P-14' })
      });
      const intId = (await resPost.json()).id;

      await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      // (a) Sin observación o muy corta
      const rA = await app.request(`/api/intervenciones/${intId}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', observacion: 'fal' })
      });
      assert.strictEqual(rA.status, 422);
      assert.strictEqual((await rA.json()).codigo, 'OBSERVACION_REQUERIDA');

      // (b) Con observación
      const rB = await app.request(`/api/intervenciones/${intId}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', observacion: 'Falta rodamiento axial 50mm' })
      });
      assert.strictEqual(rB.status, 200);

      // Verificar en historial
      const hist = await client.query(
        "SELECT observacion FROM historial_estados_intervencion WHERE intervencion_id = $1 AND estado_nuevo = 'EN_ESPERA_REPUESTOS'",
        [intId]
      );
      assert.strictEqual(hist.rows[0].observacion, 'Falta rodamiento axial 50mm');
    });

    // P-15: Reanudar no modifica fecha_inicio
    await t.test('P-15: Reanudar preserva fecha_inicio original', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion P-15' })
      });
      const intId = (await resPost.json()).id;

      await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      const row1 = await client.query('SELECT fecha_inicio FROM intervenciones WHERE id = $1', [intId]);
      const fechaIni1 = row1.rows[0].fecha_inicio;

      await app.request(`/api/intervenciones/${intId}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', observacion: 'Faltan tornillos allen' })
      });

      await app.request(`/api/intervenciones/${intId}/reanudar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_ESPERA_REPUESTOS' })
      });

      const row2 = await client.query('SELECT fecha_inicio, estado FROM intervenciones WHERE id = $1', [intId]);
      assert.strictEqual(row2.rows[0].estado, 'EN_PROCESO');
      assert.strictEqual(new Date(row2.rows[0].fecha_inicio).toISOString(), new Date(fechaIni1).toISOString());
    });

    // P-16 y P-17: Fuera de alcance VER devuelve 404
    await t.test('P-16 y P-17: Operación y GET /:id fuera de alcance devuelve 404', async () => {
      // Máquina en sector 2
      const resM2 = await client.query(
        "INSERT INTO maquinas (nombre, sector_id) VALUES ('Maq Sector 2', $1) RETURNING id",
        [sector2Id]
      );
      const m2Id = Number(resM2.rows[0].id);

      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: m2Id, descripcion: 'Intervencion Sector 2' })
      });
      const intId = (await resPost.json()).id;

      // Resp2 tiene alcance SECTORES sobre sector1Id (no sobre sector2Id)
      const permVer = await client.query("SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_VER'");
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id)
         VALUES ($1, $2, 'CONCEDER', 'SECTORES', $3)`,
        [resp2Id, permVer.rows[0].id, adminId]
      );
      await client.query("INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [resp2Id, sector1Id]);

      // GET /:id fuera de alcance da 404
      const resGet = await app.request(`/api/intervenciones/${intId}`, {
        headers: { 'Authorization': `Bearer ${resp2Token}` }
      });
      assert.strictEqual(resGet.status, 404);
      assert.strictEqual((await resGet.json()).codigo, 'INTERVENCION_NO_ENCONTRADA');

      // POST /:id/iniciar fuera de alcance da 404
      const resIni = await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp2Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(resIni.status, 404);

      // Limpiar
      await client.query('DELETE FROM usuario_permiso WHERE usuario_id = $1', [resp2Id]);
      await client.query('DELETE FROM usuario_sector WHERE usuario_id = $1', [resp2Id]);
      await limpiarIntervenciones([intId]);
      await limpiarMaquina(m2Id);
    });

    // =========================================================================
    // 9.3 ESTADO DE LA MÁQUINA
    // =========================================================================

    // P-18: Intervención con detención: alta -> iniciar -> espera -> reanudar
    await t.test('P-18: Ciclo completo con detención (DETENIDA -> EN_MANTENIMIENTO -> DETENIDA -> EN_MANTENIMIENTO)', async () => {
      const resM = await client.query("INSERT INTO maquinas (nombre, sector_id, estado) VALUES ('Maq P18', $1, 'OPERATIVA') RETURNING id", [sector1Id]);
      const mId = Number(resM.rows[0].id);

      // Alta con detención -> pasa a DETENIDA
      const rAlta = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: mId, descripcion: 'Falla P18', detiene_maquina: true })
      });
      const intId = (await rAlta.json()).id;
      const c1 = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(c1.rows[0].estado, 'DETENIDA');

      // Iniciar -> pasa a EN_MANTENIMIENTO
      await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      const c2 = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(c2.rows[0].estado, 'EN_MANTENIMIENTO');

      // Espera -> pasa a DETENIDA
      await app.request(`/api/intervenciones/${intId}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', observacion: 'Falta repuesto X' })
      });
      const c3 = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(c3.rows[0].estado, 'DETENIDA');

      // Reanudar -> pasa a EN_MANTENIMIENTO
      await app.request(`/api/intervenciones/${intId}/reanudar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_ESPERA_REPUESTOS' })
      });
      const c4 = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(c4.rows[0].estado, 'EN_MANTENIMIENTO');

      // Exactamente 4 filas en historial_estados_maquina, todas con intervencion_id
      const histM = await client.query('SELECT estado_anterior, estado_nuevo, intervencion_id FROM historial_estados_maquina WHERE maquina_id = $1 ORDER BY cambiado_en ASC, id ASC', [mId]);
      assert.strictEqual(histM.rows.length, 4);
      assert.strictEqual(histM.rows[0].estado_nuevo, 'DETENIDA');
      assert.strictEqual(histM.rows[1].estado_nuevo, 'EN_MANTENIMIENTO');
      assert.strictEqual(histM.rows[2].estado_nuevo, 'DETENIDA');
      assert.strictEqual(histM.rows[3].estado_nuevo, 'EN_MANTENIMIENTO');
      assert.ok(histM.rows.every(r => Number(r.intervencion_id) === intId));

      // Cleanup
      await limpiarIntervenciones([intId]);
      await limpiarMaquina(mId);
    });

    // P-19: Intervención sin detención, iniciada -> Máquina sigue OPERATIVA, 0 filas en historial de máquina
    await t.test('P-19: Intervención sin detención iniciada mantiene máquina OPERATIVA', async () => {
      const resM = await client.query("INSERT INTO maquinas (nombre, sector_id, estado) VALUES ('Maq P19', $1, 'OPERATIVA') RETURNING id", [sector1Id]);
      const mId = Number(resM.rows[0].id);

      const rAlta = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: mId, descripcion: 'Falla P19 no detiene', detiene_maquina: false })
      });
      const intId = (await rAlta.json()).id;

      await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      const cM = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(cM.rows[0].estado, 'OPERATIVA');

      const hM = await client.query('SELECT count(*) FROM historial_estados_maquina WHERE maquina_id = $1', [mId]);
      assert.strictEqual(Number(hM.rows[0].count), 0);

      // Cleanup
      await limpiarIntervenciones([intId]);
      await limpiarMaquina(mId);
    });

    // P-20: Regresión del bug del alta: A detiene y está EN_PROCESO (EN_MANTENIMIENTO); se registra B con detención -> Sigue EN_MANTENIMIENTO
    await t.test('P-20: Registro concurrente de falla con detención preserva EN_MANTENIMIENTO', async () => {
      const resM = await client.query("INSERT INTO maquinas (nombre, sector_id, estado) VALUES ('Maq P20', $1, 'OPERATIVA') RETURNING id", [sector1Id]);
      const mId = Number(resM.rows[0].id);

      // A detiene y se inicia
      const rA = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: mId, descripcion: 'Intervencion A', detiene_maquina: true })
      });
      const idA = (await rA.json()).id;

      await app.request(`/api/intervenciones/${idA}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      // Máquina debe estar EN_MANTENIMIENTO
      const c1 = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(c1.rows[0].estado, 'EN_MANTENIMIENTO');

      // Se registra B con detención
      const rB = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: mId, descripcion: 'Intervencion B', detiene_maquina: true })
      });
      const idB = (await rB.json()).id;

      // La máquina NO debe bajar a DETENIDA; debe seguir EN_MANTENIMIENTO
      const c2 = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(c2.rows[0].estado, 'EN_MANTENIMIENTO');

      // A pasa a espera -> la máquina ahora pasa a DETENIDA (B sigue pendiente)
      await app.request(`/api/intervenciones/${idA}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', observacion: 'Falta repuesto A' })
      });
      const c3 = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(c3.rows[0].estado, 'DETENIDA');

      // Se inicia B -> la máquina vuelve a EN_MANTENIMIENTO
      await app.request(`/api/intervenciones/${idB}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp2Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      const c4 = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(c4.rows[0].estado, 'EN_MANTENIMIENTO');

      // Cleanup
      await limpiarIntervenciones([idA, idB]);
      await limpiarMaquina(mId);
    });

    // P-21: A detiene y está en espera; B no detiene y está EN_PROCESO -> DETENIDA (B no tiene período)
    await t.test('P-21: Intervención sin detención no convierte máquina detenida a EN_MANTENIMIENTO', async () => {
      const resM = await client.query("INSERT INTO maquinas (nombre, sector_id, estado) VALUES ('Maq P21', $1, 'OPERATIVA') RETURNING id", [sector1Id]);
      const mId = Number(resM.rows[0].id);

      // A detiene y pasa a espera
      const rA = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: mId, descripcion: 'Intervencion A', detiene_maquina: true })
      });
      const idA = (await rA.json()).id;
      await app.request(`/api/intervenciones/${idA}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      await app.request(`/api/intervenciones/${idA}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', observacion: 'Falta repuesto A' })
      });

      // B no detiene y se inicia
      const rB = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: mId, descripcion: 'Intervencion B sin detencion', detiene_maquina: false })
      });
      const idB = (await rB.json()).id;
      await app.request(`/api/intervenciones/${idB}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp2Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      // La máquina debe ser DETENIDA (B no tiene período de detención abierto)
      const c = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(c.rows[0].estado, 'DETENIDA');

      // Cleanup
      await limpiarIntervenciones([idA, idB]);
      await limpiarMaquina(mId);
    });

    // P-22: Máquina FUERA_DE_SERVICIO no altera su estado
    await t.test('P-22: Máquina FUERA_DE_SERVICIO no cambia de estado', async () => {
      const resM = await client.query("INSERT INTO maquinas (nombre, sector_id, estado) VALUES ('Maq P22', $1, 'FUERA_DE_SERVICIO') RETURNING id", [sector1Id]);
      const mId = Number(resM.rows[0].id);

      const rAlta = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: mId, descripcion: 'Intervencion en fuera de servicio', detiene_maquina: true })
      });
      const dataAlta = await rAlta.json();
      assert.strictEqual(dataAlta.maquina.estado_actual, 'FUERA_DE_SERVICIO');

      const intId = dataAlta.id;
      await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      const c = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(c.rows[0].estado, 'FUERA_DE_SERVICIO');

      // Cleanup
      await limpiarIntervenciones([intId]);
      await limpiarMaquina(mId);
    });

    // P-23: Intervención eliminada lógicamente no cuenta en recálculo
    await t.test('P-23: Período de intervención eliminada lógicamente no cuenta en recálculo', async () => {
      const resM = await client.query("INSERT INTO maquinas (nombre, sector_id, estado) VALUES ('Maq P23', $1, 'OPERATIVA') RETURNING id", [sector1Id]);
      const mId = Number(resM.rows[0].id);

      // A detiene y luego se elimina lógicamente por SQL
      const rA = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: mId, descripcion: 'Intervencion A', detiene_maquina: true })
      });
      const idA = (await rA.json()).id;
      await client.query("UPDATE intervenciones SET eliminado_en = NOW(), eliminado_por_usuario_id = $1, motivo_eliminacion = 'Test' WHERE id = $2", [adminId, idA]);

      // B no detiene y se inicia
      const rB = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: mId, descripcion: 'Intervencion B', detiene_maquina: false })
      });
      const idB = (await rB.json()).id;
      await app.request(`/api/intervenciones/${idB}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      // El período de A no debe contar: la máquina no debe quedar en DETENIDA ni EN_MANTENIMIENTO por A
      // B no detiene, sin períodos abiertos no cambia
      const c = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(c.rows[0].estado, 'DETENIDA'); // Tenía DETENIDA del alta de A; al eliminarse A sin confirmación se mantiene el estado

      // Cleanup
      await limpiarIntervenciones([idA, idB]);
      await limpiarMaquina(mId);
    });

    // P-24: recalcularEstadoMaquina directo: sin períodos abiertos, con confirmación = false y luego true
    await t.test('P-24: recalcularEstadoMaquina directo con confirmación', async () => {
      const resM = await client.query("INSERT INTO maquinas (nombre, sector_id, estado) VALUES ('Maq P24', $1, 'DETENIDA') RETURNING id", [sector1Id]);
      const mId = Number(resM.rows[0].id);

      // (1) Sin períodos abiertos y confirmacion = false -> no cambia
      const rFalse = await recalcularEstadoMaquina(client, mId, {
        usuarioId: adminId,
        confirmacion: false,
      });
      assert.strictEqual(rFalse.cambio, false);
      assert.strictEqual(rFalse.estadoNuevo, 'DETENIDA');

      // (2) Sin períodos abiertos y confirmacion = true -> OPERATIVA
      const rTrue = await recalcularEstadoMaquina(client, mId, {
        usuarioId: adminId,
        confirmacion: true,
        motivo: 'Recuperación confirmada',
      });
      assert.strictEqual(rTrue.cambio, true);
      assert.strictEqual(rTrue.estadoNuevo, 'OPERATIVA');
      assert.strictEqual(rTrue.estadoAnterior, 'DETENIDA');

      const dbCheck = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(dbCheck.rows[0].estado, 'OPERATIVA');

      await limpiarMaquina(mId);
    });

    // =========================================================================
    // 9.4 ATOMICIDAD Y CONCURRENCIA
    // =========================================================================

    // P-25: Fallo a mitad de transacción hace rollback completo
    await t.test('P-25: Fallo a mitad de transacción hace rollback sin efectos secundarios', async () => {
      const resM = await client.query("INSERT INTO maquinas (nombre, sector_id, estado) VALUES ('Maq P25', $1, 'OPERATIVA') RETURNING id", [sector1Id]);
      const mId = Number(resM.rows[0].id);

      const rPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: mId, descripcion: 'Intervencion P-25', detiene_maquina: true })
      });
      const intId = (await rPost.json()).id;

      // Crear función trigger para forzar fallo en historial_estados_intervencion para esta intervención
      await client.query(`
        CREATE OR REPLACE FUNCTION trigger_falla_p25() RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.intervencion_id = ${intId} AND NEW.estado_nuevo = 'EN_PROCESO' THEN
            RAISE EXCEPTION 'Falla simulada en mitad de transaccion';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_p25 ON historial_estados_intervencion;
        CREATE TRIGGER trg_p25 BEFORE INSERT ON historial_estados_intervencion
        FOR EACH ROW EXECUTE FUNCTION trigger_falla_p25();
      `);

      try {
        const resIni = await app.request(`/api/intervenciones/${intId}/iniciar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
        });
        assert.strictEqual(resIni.status, 500);

        // Verificar que no quedó ningún cambio
        const checkI = await client.query('SELECT estado, responsable_usuario_id, fecha_inicio FROM intervenciones WHERE id = $1', [intId]);
        assert.strictEqual(checkI.rows[0].estado, 'PENDIENTE');
        assert.strictEqual(checkI.rows[0].responsable_usuario_id, null);
        assert.strictEqual(checkI.rows[0].fecha_inicio, null);

        const checkM = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
        assert.strictEqual(checkM.rows[0].estado, 'DETENIDA');
      } finally {
        await client.query('DROP TRIGGER IF EXISTS trg_p25 ON historial_estados_intervencion');
        await client.query('DROP FUNCTION IF EXISTS trigger_falla_p25');
        await limpiarIntervenciones([intId]);
        await limpiarMaquina(mId);
      }
    });

    // P-26: Dos iniciar simultáneos con el mismo estado_esperado -> 1 exitoso (200) y 1 conflicto (409)
    await t.test('P-26: Concurrencia sobre la misma intervención (1 x 200, 1 x 409)', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion P-26' })
      });
      const intId = (await resPost.json()).id;

      const p1 = app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      const p2 = app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp2Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      const statuses = [r1.status, r2.status].sort();
      assert.deepStrictEqual(statuses, [200, 409]);

      // Solo una fila nueva en historial
      const hist = await client.query('SELECT count(*) FROM historial_estados_intervencion WHERE intervencion_id = $1 AND estado_nuevo = ' + "'EN_PROCESO'", [intId]);
      assert.strictEqual(Number(hist.rows[0].count), 1);
    });

    // P-27: Iniciar simultáneamente A y B de la misma máquina, ambas con detención -> Ambas 200, máquina EN_MANTENIMIENTO
    await t.test('P-27: Iniciar simultáneamente dos intervenciones con detención de la misma máquina', async () => {
      const resM = await client.query("INSERT INTO maquinas (nombre, sector_id, estado) VALUES ('Maq P27', $1, 'OPERATIVA') RETURNING id", [sector1Id]);
      const mId = Number(resM.rows[0].id);

      const rA = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: mId, descripcion: 'A detiene', detiene_maquina: true })
      });
      const idA = (await rA.json()).id;

      const rB = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: mId, descripcion: 'B detiene', detiene_maquina: true })
      });
      const idB = (await rB.json()).id;

      const p1 = app.request(`/api/intervenciones/${idA}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      const p2 = app.request(`/api/intervenciones/${idB}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp2Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      const [res1, res2] = await Promise.all([p1, p2]);
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res2.status, 200);

      const cM = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(cM.rows[0].estado, 'EN_MANTENIMIENTO');

      // Cleanup
      await limpiarIntervenciones([idA, idB]);
      await limpiarMaquina(mId);
    });

    // P-28: Bloqueo externo con FOR UPDATE genera 409 RECURSO_OCUPADO tras timeout (~1s)
    await t.test('P-28: Bloqueo externo genera 409 RECURSO_OCUPADO', async () => {
      const resPost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ maquina_id: maquinaId, descripcion: 'Intervencion P-28' })
      });
      const intId = (await resPost.json()).id;

      const lockingClient = await pool.connect();
      try {
        await lockingClient.query('BEGIN');
        await lockingClient.query('SELECT * FROM maquinas WHERE id = $1 FOR UPDATE', [maquinaId]);

        const start = Date.now();
        const res = await app.request(`/api/intervenciones/${intId}/iniciar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
        });
        const duration = Date.now() - start;

        assert.strictEqual(res.status, 409);
        const data = await res.json();
        assert.strictEqual(data.codigo, 'RECURSO_OCUPADO');
        assert.ok(duration >= 2500, `El timeout debería esperar cerca de 3000ms (duró ${duration}ms)`);

        await lockingClient.query('COMMIT');

        // Reintento exitoso
        const resReintento = await app.request(`/api/intervenciones/${intId}/iniciar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
        });
        assert.strictEqual(resReintento.status, 200);
      } finally {
        lockingClient.release();
      }
    });

    // =========================================================================
    // 9.5 MÁQUINAS Y REGRESIÓN
    // =========================================================================

    // P-29: POST con estado != OPERATIVA y PUT con estado dan 422 ESTADO_NO_EDITABLE
    await t.test('P-29: ABM de máquinas bloquea cambio libre de estado', async () => {
      // POST con estado != OPERATIVA
      const rPost = await app.request('/api/maquinas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ nombre: 'Maq Bloqueo Post', sector_id: sector1Id, estado: 'DETENIDA' })
      });
      assert.strictEqual(rPost.status, 422);
      assert.strictEqual((await rPost.json()).codigo, 'ESTADO_NO_EDITABLE');

      // PUT con estado
      const rPut = await app.request(`/api/maquinas/${maquinaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ estado: 'OPERATIVA' })
      });
      assert.strictEqual(rPut.status, 422);
      assert.strictEqual((await rPut.json()).codigo, 'ESTADO_NO_EDITABLE');

      // PUT sin estado sigue funcionando
      const rPutOk = await app.request(`/api/maquinas/${maquinaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ ubicacion: 'Nave Central Actualizada' })
      });
      assert.strictEqual(rPutOk.status, 200);
    });

  } finally {
    // Cleanup general
    await client.query('DELETE FROM usuario_permiso WHERE otorgado_por_usuario_id = $1', [adminId]);
    await client.query('DELETE FROM usuario_sector WHERE usuario_id IN ($1, $2, $3)', [resp1Id, resp2Id, operarioId]);
    
    // Intervenciones creadas durante el test
    const intCreadas = await client.query(
      'SELECT id FROM intervenciones WHERE creado_por_usuario_id IN ($1, $2, $3, $4)',
      [resp1Id, resp2Id, operarioId, adminId]
    );
    const intIds = intCreadas.rows.map(r => Number(r.id));
    if (intIds.length > 0) {
      await limpiarIntervenciones(intIds);
    }

    await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id IN (SELECT id FROM maquinas WHERE sector_id IN ($1, $2))', [sector1Id, sector2Id]);
    await client.query('DELETE FROM maquinas WHERE sector_id IN ($1, $2)', [sector1Id, sector2Id]);
    await client.query('DELETE FROM sectores WHERE id IN ($1, $2)', [sector1Id, sector2Id]);
    await client.query('DELETE FROM usuarios WHERE id IN ($1, $2, $3)', [resp1Id, resp2Id, operarioId]);
    client.release();
  }
});
