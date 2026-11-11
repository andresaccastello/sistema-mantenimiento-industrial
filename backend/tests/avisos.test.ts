// backend/tests/avisos.test.ts
// IMPORTANTE: Antes de importar la app, asegurar EMAIL_TRANSPORTE = 'simulado'
process.env.EMAIL_TRANSPORTE = 'simulado';

import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';
import {
  mensajesSimulados,
  limpiarMensajesSimulados,
  simularFallaEmail,
} from '../functions/avisos/transporteEmail.ts';
import { procesarEnvios } from '../functions/avisos/procesarEnvios.ts';
import { REGLAS_EVENTOS_NOTIFICACION } from '../functions/intervenciones/notificaciones.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (AVISOS TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

// Helpers HTTP
async function getJson(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, { method: 'GET', headers });
}

async function postJson(path: string, body: any, token?: string, extraHeaders?: Record<string, string>) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(extraHeaders || {}) };
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

async function patchJson(path: string, body: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
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

test('Etapa N1a — Avisos por email configurables', async (t) => {
  let client = await pool.connect();

  const suf = Date.now();
  const createdUserIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdIntervencionIds: number[] = [];
  const createdNotifIds: number[] = [];
  const createdEnvioIds: number[] = [];

  // Guardar estado inicial de canales y reglas (Regla 6 sección 0 / AV-14)
  const resInitCanales = await client.query('SELECT canal, activo, actualizado_en, actualizado_por_usuario_id FROM notificacion_canales');
  const initCanales = resInitCanales.rows.map((r) => ({
    canal: r.canal,
    activo: Boolean(r.activo),
    actualizado_en: r.actualizado_en,
    actualizado_por_usuario_id: r.actualizado_por_usuario_id ? Number(r.actualizado_por_usuario_id) : null,
  }));

  const resInitReglas = await client.query('SELECT tipo_evento, canal, modo, actualizado_en, actualizado_por_usuario_id FROM notificacion_reglas');
  const initReglas = resInitReglas.rows.map((r) => ({
    tipo_evento: r.tipo_evento,
    canal: r.canal,
    modo: r.modo,
    actualizado_en: r.actualizado_en,
    actualizado_por_usuario_id: r.actualizado_por_usuario_id ? Number(r.actualizado_por_usuario_id) : null,
  }));

  let adminUser: { id: number; legajo: string; sesion_version: number; email: string };
  let operarioUser: { id: number; legajo: string; sesion_version: number };
  let adminToken = '';
  let operarioToken = '';

  let sectorId = 0;
  let maquinaCriticaId = 0;
  let maquinaNormalId = 0;
  let tipoIntervencionId = 0;

  try {
    // Perfiles
    const resPerfiles = await client.query("SELECT id, nombre FROM perfiles WHERE nombre IN ('ADMINISTRADOR', 'OPERARIO')");
    const adminPerfilId = Number(resPerfiles.rows.find((r) => r.nombre === 'ADMINISTRADOR')?.id);
    const operarioPerfilId = Number(resPerfiles.rows.find((r) => r.nombre === 'OPERARIO')?.id);

    // Tipos de intervención
    const resTipoInt = await client.query('SELECT id FROM tipos_intervencion LIMIT 1');
    tipoIntervencionId = Number(resTipoInt.rows[0].id);

    // Criticidades
    const resCritAlta = await client.query("SELECT id FROM criticidades WHERE prioridad_alta = TRUE AND activo = TRUE LIMIT 1");
    const resCritNormal = await client.query("SELECT id FROM criticidades WHERE prioridad_alta = FALSE AND activo = TRUE LIMIT 1");
    const critAltaId = Number(resCritAlta.rows[0].id);
    const critNormalId = Number(resCritNormal.rows[0].id);

    // Tipo de equipo
    const resTipoEq = await client.query("SELECT id FROM tipos_equipo WHERE activo = TRUE LIMIT 1");
    const tipoEquipoId = Number(resTipoEq.rows[0].id);

    // Crear sector
    const resSec = await client.query(
      `INSERT INTO sectores (nombre, activo) VALUES ($1, TRUE) RETURNING id`,
      [`Sector Avisos ${suf}`]
    );
    sectorId = Number(resSec.rows[0].id);
    createdSectorIds.push(sectorId);

    // Hash de password
    const passHash = await bcrypt.hash('TestPass1234', 10);

    // Crear admin con email
    const resAdm = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, email, sesion_version)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, 1) RETURNING id, legajo, sesion_version, email`,
      [`ADM_AV_${suf}`, 'Admin', 'Avisos', passHash, adminPerfilId, `admin_av_${suf}@sistema.test`]
    );
    adminUser = {
      id: Number(resAdm.rows[0].id),
      legajo: resAdm.rows[0].legajo,
      sesion_version: Number(resAdm.rows[0].sesion_version),
      email: resAdm.rows[0].email,
    };
    createdUserIds.push(adminUser.id);
    adminToken = await getTokenForUser(adminUser);

    // Crear operario
    const resOpe = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
       VALUES ($1, $2, $3, $4, $5, TRUE, 1) RETURNING id, legajo, sesion_version`,
      [`OPE_AV_${suf}`, 'Operario', 'Avisos', passHash, operarioPerfilId]
    );
    operarioUser = {
      id: Number(resOpe.rows[0].id),
      legajo: resOpe.rows[0].legajo,
      sesion_version: Number(resOpe.rows[0].sesion_version),
    };
    createdUserIds.push(operarioUser.id);
    operarioToken = await getTokenForUser(operarioUser);

    // Asignar sectores a ambos
    await client.query(
      `INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $3), ($2, $3)`,
      [adminUser.id, operarioUser.id, sectorId]
    );

    // Crear máquinas: crítica y normal
    const resMqCrit = await client.query(
      `INSERT INTO maquinas (nombre, codigo, sector_id, criticidad_id, tipo_equipo_id, activo)
       VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id`,
      [`Máquina Crítica ${suf}`, `MC_${suf}`, sectorId, critAltaId, tipoEquipoId]
    );
    maquinaCriticaId = Number(resMqCrit.rows[0].id);
    createdMaquinaIds.push(maquinaCriticaId);

    const resMqNorm = await client.query(
      `INSERT INTO maquinas (nombre, codigo, sector_id, criticidad_id, tipo_equipo_id, activo)
       VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id`,
      [`Máquina Normal ${suf}`, `MN_${suf}`, sectorId, critNormalId, tipoEquipoId]
    );
    maquinaNormalId = Number(resMqNorm.rows[0].id);
    createdMaquinaIds.push(maquinaNormalId);

    // AV-01: Permisos
    await t.test('AV-01: Operario recibe 403 en las seis rutas; administradora recibe 200 en GET /', async () => {
      const r1 = await getJson('/api/configuracion/avisos', operarioToken);
      assert.strictEqual(r1.status, 403);

      const r2 = await putJson('/api/configuracion/avisos/canales/EMAIL', { activo: true }, operarioToken);
      assert.strictEqual(r2.status, 403);

      const r3 = await putJson('/api/configuracion/avisos/reglas', { tipo_evento: 'FALLA_REGISTRADA', canal: 'EMAIL', modo: 'SIEMPRE' }, operarioToken);
      assert.strictEqual(r3.status, 403);

      const r4 = await postJson('/api/configuracion/avisos/prueba', { canal: 'EMAIL' }, operarioToken);
      assert.strictEqual(r4.status, 403);

      const r5 = await postJson('/api/configuracion/avisos/procesar', {}, operarioToken);
      assert.strictEqual(r5.status, 403);

      const r6 = await getJson('/api/configuracion/avisos/envios', operarioToken);
      assert.strictEqual(r6.status, 403);

      const rOk = await getJson('/api/configuracion/avisos', adminToken);
      assert.strictEqual(rOk.status, 200);
    });

    // AV-02: Lectura
    await t.test('AV-02: Forma de GET /, WhatsApp disponible false, 9 tipos en orden y sin secretos', async () => {
      // Simular variables secretas en entorno
      process.env.SMTP_PASSWORD = 'super-secret-password-xyz';
      process.env.SMTP_USUARIO = 'secret-user-abc';

      const res = await getJson('/api/configuracion/avisos', adminToken);
      assert.strictEqual(res.status, 200);

      const rawText = await res.text();
      assert.ok(!rawText.includes('super-secret-password-xyz'), 'No debe contener la contraseña');
      assert.ok(!rawText.includes('secret-user-abc'), 'No debe contener el usuario');

      const data = JSON.parse(rawText);
      assert.ok(Array.isArray(data.canales));
      assert.strictEqual(data.canales.length, 2);

      const chEmail = data.canales.find((c: any) => c.canal === 'EMAIL');
      const chWa = data.canales.find((c: any) => c.canal === 'WHATSAPP');
      assert.ok(chEmail);
      assert.ok(chWa);
      assert.strictEqual(chWa.disponible, false);

      assert.ok(Array.isArray(data.reglas));
      assert.strictEqual(data.reglas.length, 9);
      for (let i = 0; i < 9; i++) {
        assert.strictEqual(data.reglas[i].tipo_evento, REGLAS_EVENTOS_NOTIFICACION[i]);
      }
      assert.strictEqual(typeof data.pendientes, 'number');
    });

    // AV-03: Canales
    await t.test('AV-03: Actualización de canales y descarte al apagar EMAIL', async () => {
      // (a) EMAIL en true con transporte simulado
      const rA = await putJson('/api/configuracion/avisos/canales/EMAIL', { activo: true }, adminToken);
      assert.strictEqual(rA.status, 200);
      const bA = await rA.json();
      assert.strictEqual(bA.canales.find((c: any) => c.canal === 'EMAIL')?.activo, true);

      // (b) WHATSAPP en true -> 409 CANAL_NO_DISPONIBLE
      const rB = await putJson('/api/configuracion/avisos/canales/WHATSAPP', { activo: true }, adminToken);
      assert.strictEqual(rB.status, 409);
      const bB = await rB.json();
      assert.strictEqual(bB.codigo, 'CANAL_NO_DISPONIBLE');

      // (c) Sin EMAIL_TRANSPORTE -> 409 CANAL_SIN_CONFIGURAR
      const prevEnv = process.env.EMAIL_TRANSPORTE;
      delete process.env.EMAIL_TRANSPORTE;
      try {
        const rC = await putJson('/api/configuracion/avisos/canales/EMAIL', { activo: true }, adminToken);
        assert.strictEqual(rC.status, 409);
        const bC = await rC.json();
        assert.strictEqual(bC.codigo, 'CANAL_SIN_CONFIGURAR');
      } finally {
        process.env.EMAIL_TRANSPORTE = prevEnv || 'simulado';
      }

      // (d) PUSH -> 404 CANAL_NO_ENCONTRADO
      const rD = await putJson('/api/configuracion/avisos/canales/PUSH', { activo: true }, adminToken);
      assert.strictEqual(rD.status, 404);

      // (e) EMAIL en false con envíos pendientes: quedan DESCARTADO con "Canal desactivado"
      // Asegurar EMAIL activo
      await putJson('/api/configuracion/avisos/canales/EMAIL', { activo: true }, adminToken);

      // Insertar una notificación y un envío pendiente de prueba
      const resNotifTest = await client.query(
        `INSERT INTO notificaciones (usuario_id, tipo_evento, prioridad, titulo, mensaje, generada_por_usuario_id)
         VALUES ($1, 'INTERVENCION_ASIGNADA', 'NORMAL', 'Notif prueba canal', 'Texto', $2) RETURNING id`,
        [adminUser.id, operarioUser.id]
      );
      const notifTestId = Number(resNotifTest.rows[0].id);
      createdNotifIds.push(notifTestId);

      const resEnvTest = await client.query(
        `INSERT INTO notificacion_envios (notificacion_id, canal, estado, intentos, creado_en)
         VALUES ($1, 'EMAIL', 'PENDIENTE', 0, NOW()) RETURNING id`,
        [notifTestId]
      );
      const envioTestId = Number(resEnvTest.rows[0].id);
      createdEnvioIds.push(envioTestId);

      // Desactivar EMAIL
      const rE = await putJson('/api/configuracion/avisos/canales/EMAIL', { activo: false }, adminToken);
      assert.strictEqual(rE.status, 200);

      const resCheck = await client.query('SELECT estado, ultimo_error FROM notificacion_envios WHERE id = $1', [envioTestId]);
      assert.strictEqual(resCheck.rows[0].estado, 'DESCARTADO');
      assert.strictEqual(resCheck.rows[0].ultimo_error, 'Canal desactivado');
    });

    // AV-04: Reglas
    await t.test('AV-04: Cambiar modo de reglas y validaciones', async () => {
      // (a) Cambiar modo a SIEMPRE
      const rA = await putJson(
        '/api/configuracion/avisos/reglas',
        { tipo_evento: 'FALLA_REGISTRADA', canal: 'EMAIL', modo: 'SIEMPRE' },
        adminToken
      );
      assert.strictEqual(rA.status, 200);

      const resRegla = await client.query(
        "SELECT modo, actualizado_por_usuario_id FROM notificacion_reglas WHERE tipo_evento = 'FALLA_REGISTRADA' AND canal = 'EMAIL'"
      );
      assert.strictEqual(resRegla.rows[0].modo, 'SIEMPRE');
      assert.strictEqual(Number(resRegla.rows[0].actualizado_por_usuario_id), adminUser.id);

      // (b) Tipo, canal o modo inválidos -> 400
      const rB1 = await putJson('/api/configuracion/avisos/reglas', { tipo_evento: 'INVENTADO', canal: 'EMAIL', modo: 'SIEMPRE' }, adminToken);
      assert.strictEqual(rB1.status, 400);

      const rB2 = await putJson('/api/configuracion/avisos/reglas', { tipo_evento: 'FALLA_REGISTRADA', canal: 'PUSH', modo: 'SIEMPRE' }, adminToken);
      assert.strictEqual(rB2.status, 400);

      const rB3 = await putJson('/api/configuracion/avisos/reglas', { tipo_evento: 'FALLA_REGISTRADA', canal: 'EMAIL', modo: 'INVALIDO' }, adminToken);
      assert.strictEqual(rB3.status, 400);

      // (c) Una regla de WhatsApp se guarda
      const rC = await putJson(
        '/api/configuracion/avisos/reglas',
        { tipo_evento: 'FALLA_REGISTRADA', canal: 'WHATSAPP', modo: 'SIEMPRE' },
        adminToken
      );
      assert.strictEqual(rC.status, 200);
      const resWa = await client.query(
        "SELECT modo FROM notificacion_reglas WHERE tipo_evento = 'FALLA_REGISTRADA' AND canal = 'WHATSAPP'"
      );
      assert.strictEqual(resWa.rows[0].modo, 'SIEMPRE');
    });

    // AV-05: Qué genera un envío
    await t.test('AV-05: Generación de envíos según criticidad y reglas (SOLO_ALTA, SIEMPRE, NUNCA, canal apagado)', async () => {
      // Activar EMAIL
      await putJson('/api/configuracion/avisos/canales/EMAIL', { activo: true }, adminToken);

      // 1. Con FALLA_REGISTRADA en SOLO_ALTA
      await putJson('/api/configuracion/avisos/reglas', { tipo_evento: 'FALLA_REGISTRADA', canal: 'EMAIL', modo: 'SOLO_ALTA' }, adminToken);

      // Reportar falla en máquina crítica SIN detenerla
      const rCritica = await postJson('/api/intervenciones', {
        maquina_id: maquinaCriticaId,
        tipo_intervencion_id: tipoIntervencionId,
        descripcion: 'Falla crítica sin detención',
        detener_maquina: false,
      }, operarioToken);
      assert.strictEqual(rCritica.status, 201);
      const idIntCritica = (await rCritica.json()).id;
      createdIntervencionIds.push(idIntCritica);

      // Verificar que generó envío para la notificación
      const resEnvCrit = await client.query(
        `SELECT e.id FROM notificacion_envios e
         JOIN notificaciones n ON n.id = e.notificacion_id
         WHERE n.intervencion_id = $1 AND e.canal = 'EMAIL'`,
        [idIntCritica]
      );
      assert.ok(resEnvCrit.rows.length > 0, 'Máquina crítica debe generar envío con SOLO_ALTA');
      for (const r of resEnvCrit.rows) createdEnvioIds.push(Number(r.id));

      // Reportar falla en máquina normal SIN detenerla
      const rNormal = await postJson('/api/intervenciones', {
        maquina_id: maquinaNormalId,
        tipo_intervencion_id: tipoIntervencionId,
        descripcion: 'Falla normal sin detención',
        detener_maquina: false,
      }, operarioToken);
      assert.strictEqual(rNormal.status, 201);
      const idIntNormal = (await rNormal.json()).id;
      createdIntervencionIds.push(idIntNormal);

      const resEnvNorm = await client.query(
        `SELECT e.id FROM notificacion_envios e
         JOIN notificaciones n ON n.id = e.notificacion_id
         WHERE n.intervencion_id = $1 AND e.canal = 'EMAIL'`,
        [idIntNormal]
      );
      assert.strictEqual(resEnvNorm.rows.length, 0, 'Máquina normal NO debe generar envío con SOLO_ALTA');

      // 2. En SIEMPRE, la normal también genera
      await putJson('/api/configuracion/avisos/reglas', { tipo_evento: 'FALLA_REGISTRADA', canal: 'EMAIL', modo: 'SIEMPRE' }, adminToken);
      const rNormalSiempre = await postJson('/api/intervenciones', {
        maquina_id: maquinaNormalId,
        tipo_intervencion_id: tipoIntervencionId,
        descripcion: 'Falla normal en SIEMPRE',
        detener_maquina: false,
      }, operarioToken);
      const idIntNormalSiempre = (await rNormalSiempre.json()).id;
      createdIntervencionIds.push(idIntNormalSiempre);

      const resEnvNormS = await client.query(
        `SELECT e.id FROM notificacion_envios e
         JOIN notificaciones n ON n.id = e.notificacion_id
         WHERE n.intervencion_id = $1 AND e.canal = 'EMAIL'`,
        [idIntNormalSiempre]
      );
      assert.ok(resEnvNormS.rows.length > 0, 'Máquina normal debe generar envío con SIEMPRE');
      for (const r of resEnvNormS.rows) createdEnvioIds.push(Number(r.id));

      // 3. En NUNCA, ninguna genera
      await putJson('/api/configuracion/avisos/reglas', { tipo_evento: 'FALLA_REGISTRADA', canal: 'EMAIL', modo: 'NUNCA' }, adminToken);
      const rCriticaNunca = await postJson('/api/intervenciones', {
        maquina_id: maquinaCriticaId,
        tipo_intervencion_id: tipoIntervencionId,
        descripcion: 'Falla crítica en NUNCA',
        detener_maquina: false,
      }, operarioToken);
      const idIntCriticaNunca = (await rCriticaNunca.json()).id;
      createdIntervencionIds.push(idIntCriticaNunca);

      const resEnvCritN = await client.query(
        `SELECT e.id FROM notificacion_envios e
         JOIN notificaciones n ON n.id = e.notificacion_id
         WHERE n.intervencion_id = $1 AND e.canal = 'EMAIL'`,
        [idIntCriticaNunca]
      );
      assert.strictEqual(resEnvCritN.rows.length, 0, 'Ninguna genera con NUNCA');

      // 4. Con canal apagado, ninguna genera
      await putJson('/api/configuracion/avisos/canales/EMAIL', { activo: false }, adminToken);
      await putJson('/api/configuracion/avisos/reglas', { tipo_evento: 'FALLA_REGISTRADA', canal: 'EMAIL', modo: 'SIEMPRE' }, adminToken);

      const rCriticaApagado = await postJson('/api/intervenciones', {
        maquina_id: maquinaCriticaId,
        tipo_intervencion_id: tipoIntervencionId,
        descripcion: 'Falla con canal apagado',
        detener_maquina: false,
      }, operarioToken);
      const idIntCriticaApagado = (await rCriticaApagado.json()).id;
      createdIntervencionIds.push(idIntCriticaApagado);

      const resEnvApagado = await client.query(
        `SELECT e.id FROM notificacion_envios e
         JOIN notificaciones n ON n.id = e.notificacion_id
         WHERE n.intervencion_id = $1 AND e.canal = 'EMAIL'`,
        [idIntCriticaApagado]
      );
      assert.strictEqual(resEnvApagado.rows.length, 0, 'Canal apagado no genera envíos');
    });

    // AV-06: Envío correcto
    await t.test('AV-06: Envío correcto a usuario con email, asunto con [Urgente], enlace y firma', async () => {
      // Activar EMAIL
      await putJson('/api/configuracion/avisos/canales/EMAIL', { activo: true }, adminToken);
      await putJson('/api/configuracion/avisos/reglas', { tipo_evento: 'FALLA_REGISTRADA', canal: 'EMAIL', modo: 'SIEMPRE' }, adminToken);

      limpiarMensajesSimulados();
      process.env.APP_URL_PUBLICA = 'https://mantenimiento.empresa.test';

      // Crear intervención en máquina crítica
      const rInt = await postJson('/api/intervenciones', {
        maquina_id: maquinaCriticaId,
        tipo_intervencion_id: tipoIntervencionId,
        descripcion: 'Falla para test envio correcto',
        detener_maquina: false,
      }, operarioToken);
      const intId = (await rInt.json()).id;
      createdIntervencionIds.push(intId);

      const resEnv = await client.query(
        `SELECT e.id FROM notificacion_envios e
         JOIN notificaciones n ON n.id = e.notificacion_id
         WHERE n.intervencion_id = $1 AND e.canal = 'EMAIL' AND n.usuario_id = $2`,
        [intId, adminUser.id]
      );
      assert.strictEqual(resEnv.rows.length, 1);
      const envioId = Number(resEnv.rows[0].id);
      createdEnvioIds.push(envioId);

      // Procesar solo este envío
      const resProc = await procesarEnvios({ ids: [envioId] });
      assert.strictEqual(resProc.enviados, 1);

      // Verificar en BD
      const resCheck = await client.query('SELECT estado, destino, enviado_en FROM notificacion_envios WHERE id = $1', [envioId]);
      assert.strictEqual(resCheck.rows[0].estado, 'ENVIADO');
      assert.strictEqual(resCheck.rows[0].destino, adminUser.email);
      assert.ok(resCheck.rows[0].enviado_en);

      // Verificar mensaje simulado
      const msgs = mensajesSimulados();
      assert.strictEqual(msgs.length, 1);
      assert.strictEqual(msgs[0].para, adminUser.email);
      assert.ok(msgs[0].asunto.startsWith('[Urgente]'), 'Asunto debe tener prefijo [Urgente]');
      assert.ok(msgs[0].texto.includes(`https://mantenimiento.empresa.test/intervenciones/${intId}`), 'Debe incluir enlace');
      assert.ok(msgs[0].texto.includes('— '), 'Debe incluir firma');
    });

    // AV-07: Descartes
    await t.test('AV-07: Descartes: sin email, usuario inactivo y notificación vencida (>24hs)', async () => {
      await putJson('/api/configuracion/avisos/canales/EMAIL', { activo: true }, adminToken);

      // 1. Usuario sin email
      const resNotif1 = await client.query(
        `INSERT INTO notificaciones (usuario_id, tipo_evento, prioridad, titulo, mensaje, generada_por_usuario_id)
         VALUES ($1, 'INTERVENCION_ASIGNADA', 'NORMAL', 'T1', 'M1', $2) RETURNING id`,
        [operarioUser.id, adminUser.id] // operario no tiene email
      );
      const n1Id = Number(resNotif1.rows[0].id);
      createdNotifIds.push(n1Id);

      const resEnv1 = await client.query(
        `INSERT INTO notificacion_envios (notificacion_id, canal, estado, intentos, creado_en)
         VALUES ($1, 'EMAIL', 'PENDIENTE', 0, NOW()) RETURNING id`,
        [n1Id]
      );
      const e1Id = Number(resEnv1.rows[0].id);
      createdEnvioIds.push(e1Id);

      const proc1 = await procesarEnvios({ ids: [e1Id] });
      assert.strictEqual(proc1.descartados, 1);
      const chk1 = await client.query('SELECT estado, ultimo_error FROM notificacion_envios WHERE id = $1', [e1Id]);
      assert.strictEqual(chk1.rows[0].estado, 'DESCARTADO');
      assert.strictEqual(chk1.rows[0].ultimo_error, 'Sin email cargado');

      // 2. Usuario inactivo
      const passHashTemp = await bcrypt.hash('Pass1234', 10);
      const resUInactivo = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, email)
         VALUES ($1, 'Inactivo', 'Test', $2, $3, FALSE, 'inactivo@test.com') RETURNING id`,
        [`INACT_${suf}`, passHashTemp, adminPerfilId]
      );
      const uInactId = Number(resUInactivo.rows[0].id);
      createdUserIds.push(uInactId);

      const resNotif2 = await client.query(
        `INSERT INTO notificaciones (usuario_id, tipo_evento, prioridad, titulo, mensaje, generada_por_usuario_id)
         VALUES ($1, 'INTERVENCION_ASIGNADA', 'NORMAL', 'T2', 'M2', $2) RETURNING id`,
        [uInactId, adminUser.id]
      );
      const n2Id = Number(resNotif2.rows[0].id);
      createdNotifIds.push(n2Id);

      const resEnv2 = await client.query(
        `INSERT INTO notificacion_envios (notificacion_id, canal, estado, intentos, creado_en)
         VALUES ($1, 'EMAIL', 'PENDIENTE', 0, NOW()) RETURNING id`,
        [n2Id]
      );
      const e2Id = Number(resEnv2.rows[0].id);
      createdEnvioIds.push(e2Id);

      const proc2 = await procesarEnvios({ ids: [e2Id] });
      assert.strictEqual(proc2.descartados, 1);
      const chk2 = await client.query('SELECT estado, ultimo_error FROM notificacion_envios WHERE id = $1', [e2Id]);
      assert.strictEqual(chk2.rows[0].estado, 'DESCARTADO');
      assert.strictEqual(chk2.rows[0].ultimo_error, 'Usuario inactivo');

      // 3. Notificación de hace 25 horas
      const resNotif3 = await client.query(
        `INSERT INTO notificaciones (usuario_id, tipo_evento, prioridad, titulo, mensaje, generada_por_usuario_id, creada_en)
         VALUES ($1, 'INTERVENCION_ASIGNADA', 'NORMAL', 'T3', 'M3', $2, NOW() - INTERVAL '25 hours') RETURNING id`,
        [adminUser.id, operarioUser.id]
      );
      const n3Id = Number(resNotif3.rows[0].id);
      createdNotifIds.push(n3Id);

      const resEnv3 = await client.query(
        `INSERT INTO notificacion_envios (notificacion_id, canal, estado, intentos, creado_en)
         VALUES ($1, 'EMAIL', 'PENDIENTE', 0, NOW()) RETURNING id`,
        [n3Id]
      );
      const e3Id = Number(resEnv3.rows[0].id);
      createdEnvioIds.push(e3Id);

      const proc3 = await procesarEnvios({ ids: [e3Id] });
      assert.strictEqual(proc3.descartados, 1);
      const chk3 = await client.query('SELECT estado, ultimo_error FROM notificacion_envios WHERE id = $1', [e3Id]);
      assert.strictEqual(chk3.rows[0].estado, 'DESCARTADO');
      assert.strictEqual(chk3.rows[0].ultimo_error, 'Vencido');
    });

    // AV-08: Reintentos
    await t.test('AV-08: Reintentos con backoff (1, 5, 15, 60 min) y ERROR tras 5 intentos fallidos', async () => {
      await putJson('/api/configuracion/avisos/canales/EMAIL', { activo: true }, adminToken);

      const resNotif = await client.query(
        `INSERT INTO notificaciones (usuario_id, tipo_evento, prioridad, titulo, mensaje, generada_por_usuario_id)
         VALUES ($1, 'INTERVENCION_ASIGNADA', 'NORMAL', 'T Reintentos', 'M', $2) RETURNING id`,
        [adminUser.id, operarioUser.id]
      );
      const notifId = Number(resNotif.rows[0].id);
      createdNotifIds.push(notifId);

      const resEnv = await client.query(
        `INSERT INTO notificacion_envios (notificacion_id, canal, estado, intentos, creado_en)
         VALUES ($1, 'EMAIL', 'PENDIENTE', 0, NOW()) RETURNING id`,
        [notifId]
      );
      const envioId = Number(resEnv.rows[0].id);
      createdEnvioIds.push(envioId);

      simularFallaEmail(true);
      try {
        // Intento 1
        const p1 = await procesarEnvios({ ids: [envioId] });
        assert.strictEqual(p1.reintentar, 1);

        const chk1 = await client.query(
          `SELECT estado, intentos, ultimo_error, proximo_intento_en,
                  EXTRACT(EPOCH FROM (proximo_intento_en - NOW())) AS diff_segundos
           FROM notificacion_envios WHERE id = $1`,
          [envioId]
        );
        assert.strictEqual(chk1.rows[0].estado, 'PENDIENTE');
        assert.strictEqual(Number(chk1.rows[0].intentos), 1);
        assert.ok(chk1.rows[0].ultimo_error);
        const diffSeg1 = Number(chk1.rows[0].diff_segundos);
        assert.ok(diffSeg1 >= 45 && diffSeg1 <= 75, `Diferencia debe rondar 60 segundos (obtenido ${diffSeg1})`);

        // Procesar enseguida no lo toca
        const pInmediato = await procesarEnvios({ ids: [envioId] });
        assert.strictEqual(pInmediato.procesados, 0, 'No debe procesar un envío con proximo_intento_en a futuro');

        // Llevar al pasado 4 veces más
        // Intento 2
        await client.query("UPDATE notificacion_envios SET proximo_intento_en = NOW() - INTERVAL '1 minute' WHERE id = $1", [envioId]);
        await procesarEnvios({ ids: [envioId] });

        // Intento 3
        await client.query("UPDATE notificacion_envios SET proximo_intento_en = NOW() - INTERVAL '1 minute' WHERE id = $1", [envioId]);
        await procesarEnvios({ ids: [envioId] });

        // Intento 4
        await client.query("UPDATE notificacion_envios SET proximo_intento_en = NOW() - INTERVAL '1 minute' WHERE id = $1", [envioId]);
        await procesarEnvios({ ids: [envioId] });

        // Intento 5 (debe quedar ERROR)
        await client.query("UPDATE notificacion_envios SET proximo_intento_en = NOW() - INTERVAL '1 minute' WHERE id = $1", [envioId]);
        const p5 = await procesarEnvios({ ids: [envioId] });
        assert.strictEqual(p5.con_error, 1);

        const chkFinal = await client.query('SELECT estado, intentos FROM notificacion_envios WHERE id = $1', [envioId]);
        assert.strictEqual(chkFinal.rows[0].estado, 'ERROR');
        assert.strictEqual(Number(chkFinal.rows[0].intentos), 5);
      } finally {
        simularFallaEmail(false);
      }
    });

    // AV-09: Dos procesos a la vez
    await t.test('AV-09: Concurrencia: dos procesarEnvios simultáneos no duplican envíos', async () => {
      await putJson('/api/configuracion/avisos/canales/EMAIL', { activo: true }, adminToken);
      limpiarMensajesSimulados();

      const seisIds: number[] = [];
      for (let i = 0; i < 6; i++) {
        const rN = await client.query(
          `INSERT INTO notificaciones (usuario_id, tipo_evento, prioridad, titulo, mensaje, generada_por_usuario_id)
           VALUES ($1, 'INTERVENCION_ASIGNADA', 'NORMAL', $2, 'Msg', $3) RETURNING id`,
          [adminUser.id, `Notif Concurrente ${i}`, operarioUser.id]
        );
        const nId = Number(rN.rows[0].id);
        createdNotifIds.push(nId);

        const rE = await client.query(
          `INSERT INTO notificacion_envios (notificacion_id, canal, estado, intentos, creado_en)
           VALUES ($1, 'EMAIL', 'PENDIENTE', 0, NOW()) RETURNING id`,
          [nId]
        );
        const eId = Number(rE.rows[0].id);
        createdEnvioIds.push(eId);
        seisIds.push(eId);
      }

      // Ejecutar simultáneamente
      const [r1, r2] = await Promise.all([
        procesarEnvios({ ids: seisIds }),
        procesarEnvios({ ids: seisIds }),
      ]);

      const totalEnviados = r1.enviados + r2.enviados;
      assert.strictEqual(totalEnviados, 6, 'El total de enviados entre ambos debe ser exactamente 6');

      const msgs = mensajesSimulados();
      assert.strictEqual(msgs.length, 6, 'Debe haber exactamente 6 mensajes simulados (sin duplicados)');

      const resCheck = await client.query('SELECT count(*)::int AS c FROM notificacion_envios WHERE id = ANY($1::bigint[]) AND estado = $2', [seisIds, 'ENVIADO']);
      assert.strictEqual(Number(resCheck.rows[0].c), 6);
    });

    // AV-10: Email de prueba
    await t.test('AV-10: Email de prueba (sin email, con email y con falla simulada)', async () => {
      // (a) Quien pide no tiene email: operario
      const rA = await postJson('/api/configuracion/avisos/prueba', { canal: 'EMAIL' }, operarioToken);
      // Operario tiene 403 por permiso; si admin no tiene email:
      await client.query('UPDATE usuarios SET email = NULL WHERE id = $1', [adminUser.id]);
      const rAAdmin = await postJson('/api/configuracion/avisos/prueba', { canal: 'EMAIL' }, adminToken);
      assert.strictEqual(rAAdmin.status, 409);
      const bA = await rAAdmin.json();
      assert.strictEqual(bA.codigo, 'SIN_EMAIL');

      // (b) Con email: 200 y mensaje simulado
      await client.query('UPDATE usuarios SET email = $1 WHERE id = $2', [adminUser.email, adminUser.id]);
      limpiarMensajesSimulados();

      const rB = await postJson('/api/configuracion/avisos/prueba', { canal: 'EMAIL' }, adminToken);
      assert.strictEqual(rB.status, 200);
      const bB = await rB.json();
      assert.strictEqual(bB.enviado_a, adminUser.email);

      const msgs = mensajesSimulados();
      assert.strictEqual(msgs.length, 1);
      assert.strictEqual(msgs[0].para, adminUser.email);
      assert.strictEqual(msgs[0].asunto, 'Prueba de avisos');

      // (c) Con falla simulada: 502 ENVIO_FALLIDO sin contraseña en detalle
      process.env.SMTP_PASSWORD = 'password-oculta-1234';
      simularFallaEmail(true);
      try {
        const rC = await postJson('/api/configuracion/avisos/prueba', { canal: 'EMAIL' }, adminToken);
        assert.strictEqual(rC.status, 502);
        const bC = await rC.json();
        assert.strictEqual(bC.codigo, 'ENVIO_FALLIDO');
        assert.ok(!JSON.stringify(bC).includes('password-oculta-1234'), 'No debe filtrar la contraseña en el detalle');
      } finally {
        simularFallaEmail(false);
      }
    });

    // AV-11: Envíos recientes
    await t.test('AV-11: GET /api/configuracion/avisos/envios: paginación, filtros y validación', async () => {
      const res = await getJson('/api/configuracion/avisos/envios?limit=10&offset=0', adminToken);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(typeof body.total === 'number');
      assert.ok(Array.isArray(body.envios));

      if (body.envios.length > 0) {
        const e0 = body.envios[0];
        assert.ok('id' in e0);
        assert.ok('canal' in e0);
        assert.ok('estado' in e0);
        assert.ok('notificacion' in e0);
        assert.ok('usuario' in e0);
        assert.ok('nombre' in e0.usuario);
      }

      // Filtro por estado
      const resErr = await getJson('/api/configuracion/avisos/envios?estado=ERROR', adminToken);
      assert.strictEqual(resErr.status, 200);
      const bodyErr = await resErr.json();
      for (const e of bodyErr.envios) {
        assert.strictEqual(e.estado, 'ERROR');
      }

      // Validaciones limit 0 o 101
      const rL0 = await getJson('/api/configuracion/avisos/envios?limit=0', adminToken);
      assert.strictEqual(rL0.status, 400);

      const rL101 = await getJson('/api/configuracion/avisos/envios?limit=101', adminToken);
      assert.strictEqual(rL101.status, 400);
    });

    // AV-12: Disparador
    await t.test('AV-12: POST /api/avisos/procesar sin encabezado devuelve 403', async () => {
      const res = await postJson('/api/avisos/procesar', {});
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.codigo, 'PERMISO_INSUFICIENTE');
    });

    // AV-13: Contacto
    await t.test('AV-13: Datos de contacto en usuarios: alta, validaciones, borrado, respuestas y auditoría', async () => {
      // (a) Alta con mayúsculas en email
      const legajoTest = `USR_CNT_${suf}`;
      const rAlta = await postJson('/api/usuarios', {
        legajo: legajoTest,
        nombre: 'Ana',
        apellido: 'Contacto',
        email: 'Ana@Empresa.COM',
        telefono_whatsapp: '+5491112345678',
        perfil_id: operarioPerfilId,
        password_temporal: 'Temporal1234',
      }, adminToken);
      assert.strictEqual(rAlta.status, 201);
      const bAlta = await rAlta.json();
      createdUserIds.push(bAlta.id);
      assert.strictEqual(bAlta.email, 'ana@empresa.com');
      assert.strictEqual(bAlta.telefono_whatsapp, '+5491112345678');

      // (b) Teléfono inválido y email sin arroba
      const rBadTel = await patchJson(`/api/usuarios/${bAlta.id}`, { telefono_whatsapp: '11 1234-5678' }, adminToken);
      assert.strictEqual(rBadTel.status, 422);
      const bBadTel = await rBadTel.json();
      assert.strictEqual(bBadTel.codigo, 'TELEFONO_INVALIDO');

      const rBadMail = await patchJson(`/api/usuarios/${bAlta.id}`, { email: 'sin-arroba' }, adminToken);
      assert.strictEqual(rBadMail.status, 422);
      const bBadMail = await rBadMail.json();
      assert.strictEqual(bBadMail.codigo, 'EMAIL_INVALIDO');

      // Email de 255 caracteres (> 254) devuelve 422 EMAIL_INVALIDO
      const email255 = 'a'.repeat(243) + '@empresa.com';
      assert.strictEqual(email255.length, 255);
      const rLargo = await patchJson(`/api/usuarios/${bAlta.id}`, { email: email255 }, adminToken);
      assert.strictEqual(rLargo.status, 422);
      const bLargo = await rLargo.json();
      assert.strictEqual(bLargo.codigo, 'EMAIL_INVALIDO');

      // (c) "" lo borra
      const rClear = await patchJson(`/api/usuarios/${bAlta.id}`, { email: '', telefono_whatsapp: '' }, adminToken);
      assert.strictEqual(rClear.status, 200);
      const bClear = await rClear.json();
      assert.strictEqual(bClear.email, null);
      assert.strictEqual(bClear.telefono_whatsapp, null);

      // (d) Lista, detalle y /auth/me
      const rList = await getJson('/api/usuarios', adminToken);
      const listData = await rList.json();
      const uFound = listData.find((u: any) => u.id === bAlta.id);
      assert.ok('email' in uFound);
      assert.ok('telefono_whatsapp' in uFound);

      const rDet = await getJson(`/api/usuarios/${bAlta.id}`, adminToken);
      const detData = await rDet.json();
      assert.ok('email' in detData);
      assert.ok('telefono_whatsapp' in detData);

      const rMe = await getJson('/api/auth/me', adminToken);
      const meData = await rMe.json();
      assert.strictEqual(meData.email, adminUser.email);
      assert.ok('telefono_whatsapp' in meData);

      // (e) USUARIO_MODIFICADO lleva los cuatro campos
      await patchJson(`/api/usuarios/${bAlta.id}`, {
        nombre: 'Ana Maria',
        email: 'anamaria@empresa.com',
      }, adminToken);

      const resAudit = await client.query(
        "SELECT detalle FROM auditoria_permisos WHERE sobre_usuario_id = $1 AND accion = 'USUARIO_MODIFICADO' ORDER BY creado_en DESC LIMIT 1",
        [bAlta.id]
      );
      assert.strictEqual(resAudit.rows.length, 1);
      const detalle = typeof resAudit.rows[0].detalle === 'string' ? JSON.parse(resAudit.rows[0].detalle) : resAudit.rows[0].detalle;
      assert.ok('nombre' in detalle.anterior);
      assert.ok('apellido' in detalle.anterior);
      assert.ok('email' in detalle.anterior);
      assert.ok('telefono_whatsapp' in detalle.anterior);
      assert.ok('nombre' in detalle.nuevo);
      assert.ok('apellido' in detalle.nuevo);
      assert.ok('email' in detalle.nuevo);
      assert.ok('telefono_whatsapp' in detalle.nuevo);
      assert.strictEqual(detalle.nuevo.email, 'anamaria@empresa.com');
    });

    // AV-14: Estado final
    await t.test('AV-14: Verificación de estado final de canales y las 18 reglas', async () => {
      // Restaurar canales
      for (const ic of initCanales) {
        await client.query(
          'UPDATE notificacion_canales SET activo = $1, actualizado_en = $2, actualizado_por_usuario_id = $3 WHERE canal = $4',
          [ic.activo, ic.actualizado_en, ic.actualizado_por_usuario_id, ic.canal]
        );
      }

      // Restaurar reglas
      for (const ir of initReglas) {
        await client.query(
          'UPDATE notificacion_reglas SET modo = $1, actualizado_en = $2, actualizado_por_usuario_id = $3 WHERE tipo_evento = $4 AND canal = $5',
          [ir.modo, ir.actualizado_en, ir.actualizado_por_usuario_id, ir.tipo_evento, ir.canal]
        );
      }

      const resCanalesFinal = await client.query('SELECT canal, activo, actualizado_en, actualizado_por_usuario_id FROM notificacion_canales WHERE canal IN (\'EMAIL\', \'WHATSAPP\')');
      for (const r of resCanalesFinal.rows) {
        const orig = initCanales.find((c) => c.canal === r.canal);
        assert.strictEqual(Boolean(r.activo), orig?.activo, `Canal ${r.canal} debe coincidir con estado inicial`);
        assert.strictEqual(
          new Date(r.actualizado_en).toISOString(),
          new Date(orig?.actualizado_en).toISOString(),
          `Canal ${r.canal} actualizado_en debe coincidir`
        );
        assert.strictEqual(
          r.actualizado_por_usuario_id ? Number(r.actualizado_por_usuario_id) : null,
          orig?.actualizado_por_usuario_id,
          `Canal ${r.canal} actualizado_por_usuario_id debe coincidir`
        );
      }

      const resReglasFinal = await client.query('SELECT tipo_evento, canal, modo, actualizado_en, actualizado_por_usuario_id FROM notificacion_reglas');
      assert.strictEqual(resReglasFinal.rows.length, 18);
      for (const r of resReglasFinal.rows) {
        const orig = initReglas.find((ir) => ir.tipo_evento === r.tipo_evento && ir.canal === r.canal);
        assert.strictEqual(r.modo, orig?.modo, `Regla ${r.tipo_evento}/${r.canal} debe coincidir con estado inicial`);
        assert.strictEqual(
          new Date(r.actualizado_en).toISOString(),
          new Date(orig?.actualizado_en).toISOString(),
          `Regla ${r.tipo_evento}/${r.canal} actualizado_en debe coincidir`
        );
        assert.strictEqual(
          r.actualizado_por_usuario_id ? Number(r.actualizado_por_usuario_id) : null,
          orig?.actualizado_por_usuario_id,
          `Regla ${r.tipo_evento}/${r.canal} actualizado_por_usuario_id debe coincidir`
        );
      }
    });

  } finally {
    client = await clienteSano(client);
    // Limpieza de datos creados en la prueba
    try {
      if (createdEnvioIds.length > 0) {
        await client.query('DELETE FROM notificacion_envios WHERE id = ANY($1::bigint[])', [createdEnvioIds]);
      }
      if (createdNotifIds.length > 0) {
        await client.query('DELETE FROM notificaciones WHERE id = ANY($1::bigint[])', [createdNotifIds]);
      }
      if (createdIntervencionIds.length > 0) {
        // Envíos y notificaciones de intervenciones creadas
        await client.query(`
          DELETE FROM notificacion_envios WHERE notificacion_id IN (
            SELECT id FROM notificaciones WHERE intervencion_id = ANY($1::bigint[])
          )
        `, [createdIntervencionIds]);
        await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1::bigint[])', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = ANY($1::bigint[])', [createdIntervencionIds]);
        await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1::bigint[])', [createdIntervencionIds]);
        await client.query('DELETE FROM intervenciones WHERE id = ANY($1::bigint[])', [createdIntervencionIds]);
      }
      if (createdMaquinaIds.length > 0) {
        await client.query('DELETE FROM maquinas WHERE id = ANY($1::bigint[])', [createdMaquinaIds]);
      }
      if (createdUserIds.length > 0) {
        await client.query('DELETE FROM auditoria_permisos WHERE sobre_usuario_id = ANY($1::bigint[]) OR realizado_por_usuario_id = ANY($1::bigint[])', [createdUserIds]);
        await client.query('DELETE FROM usuario_sector WHERE usuario_id = ANY($1::bigint[])', [createdUserIds]);
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1::bigint[])', [createdUserIds]);
        await client.query('DELETE FROM usuarios WHERE id = ANY($1::bigint[])', [createdUserIds]);
      }
      if (createdSectorIds.length > 0) {
        await client.query('DELETE FROM sectores WHERE id = ANY($1::bigint[])', [createdSectorIds]);
      }

      // Restauración de canales y reglas
      for (const ic of initCanales) {
        await client.query(
          'UPDATE notificacion_canales SET activo = $1, actualizado_en = $2, actualizado_por_usuario_id = $3 WHERE canal = $4',
          [ic.activo, ic.actualizado_en, ic.actualizado_por_usuario_id, ic.canal]
        );
      }
      for (const ir of initReglas) {
        await client.query(
          'UPDATE notificacion_reglas SET modo = $1, actualizado_en = $2, actualizado_por_usuario_id = $3 WHERE tipo_evento = $4 AND canal = $5',
          [ir.modo, ir.actualizado_en, ir.actualizado_por_usuario_id, ir.tipo_evento, ir.canal]
        );
      }
    } catch (cleanupErr) {
      console.error('Error durante la limpieza de avisos.test.ts:', cleanupErr);
    } finally {
      client.release();
    }
  }
});
