import { test } from 'node:test';
import assert from 'node:assert';
import { pool } from '../functions/db.ts';
import app from '../functions/api.ts';

// Configurar timeout de bloqueo para pruebas de concurrencia (3s para absorber latencia de red en Neon)
process.env.LOCK_TIMEOUT = '3s';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (MOTOR CIERRES TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Etapa 4B — Motor de estados: cierres, recuperación de la máquina y estado manual', async (t) => {
  const client = await pool.connect();
  const createdIntervencionIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];

  const limpiarIntervenciones = async (ids: number[]) => {
    if (!ids || ids.length === 0) return;
    await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE intervencion_id = ANY($1))', [ids]);
    await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [ids]);
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
    await client.query('DELETE FROM intervencion_periodos_detencion WHERE maquina_id = $1', [mId]);
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

  let userSinConfirmarToken = '';
  let userSinConfirmarId = 0;

  let userConCancelToken = '';
  let userConCancelId = 0;

  let userSectoresToken = '';
  let userSectoresId = 0;

  let userFinalizarSinAsignarToken = '';
  let userFinalizarSinAsignarId = 0;

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
    const legajoR1 = 'R1_4B_' + Date.now();
    const resR1 = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'Resp Uno 4B', $2, $3) RETURNING id`,
      [legajoR1, hash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    resp1Id = Number(resR1.rows[0].id);
    createdUsuarioIds.push(resp1Id);
    const loginR1 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoR1, password: 'pass123' })
    });
    resp1Token = (await loginR1.json()).token;

    // 4. Crear Resp2 (Responsable de mantenimiento)
    const legajoR2 = 'R2_4B_' + Date.now();
    const resR2 = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'Resp Dos 4B', $2, $3) RETURNING id`,
      [legajoR2, hash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    resp2Id = Number(resR2.rows[0].id);
    createdUsuarioIds.push(resp2Id);
    const loginR2 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoR2, password: 'pass123' })
    });
    resp2Token = (await loginR2.json()).token;

    // 5. Crear Operario (sin asignar ni finalizar por defecto)
    const legajoOp = 'OP_4B_' + Date.now();
    const resOp = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'Operario 4B', $2, $3) RETURNING id`,
      [legajoOp, hash, perfilMap['OPERARIO']]
    );
    operarioId = Number(resOp.rows[0].id);
    createdUsuarioIds.push(operarioId);
    const loginOp = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoOp, password: 'pass123' })
    });
    operarioToken = (await loginOp.json()).token;

    // 6. User sin confirmar (Responsable con excepción DENEGAR en CONFIRMAR_RECUPERACION)
    const legajoSinConf = 'SC_4B_' + Date.now();
    const resSC = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'Resp Sin Confirmar', $2, $3) RETURNING id`,
      [legajoSinConf, hash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    userSinConfirmarId = Number(resSC.rows[0].id);
    createdUsuarioIds.push(userSinConfirmarId);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, otorgado_por_usuario_id)
       VALUES ($1, (SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_CONFIRMAR_RECUPERACION'), 'DENEGAR', $2)`,
      [userSinConfirmarId, adminId]
    );
    const loginSC = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoSinConf, password: 'pass123' })
    });
    userSinConfirmarToken = (await loginSC.json()).token;

    // 7. User con Cancelar pero sin ASIGNAR (Operario con excepción CONCEDER en CANCELAR)
    const legajoCC = 'CC_4B_' + Date.now();
    const resCC = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'Operario Con Cancelar', $2, $3) RETURNING id`,
      [legajoCC, hash, perfilMap['OPERARIO']]
    );
    userConCancelId = Number(resCC.rows[0].id);
    createdUsuarioIds.push(userConCancelId);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, otorgado_por_usuario_id)
       VALUES ($1, (SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_CANCELAR'), 'CONCEDER', $2)`,
      [userConCancelId, adminId]
    );
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id)
       VALUES ($1, (SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_VER'), 'CONCEDER', 'TODAS', $2)`,
      [userConCancelId, adminId]
    );
    const loginCC = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoCC, password: 'pass123' })
    });
    userConCancelToken = (await loginCC.json()).token;

    // 8. Sectores y Máquina base
    const resSec1 = await client.query(
      "INSERT INTO sectores (nombre) VALUES ('Sector Cierres A ' || $1) RETURNING id",
      [Date.now()]
    );
    sector1Id = Number(resSec1.rows[0].id);

    const resSec2 = await client.query(
      "INSERT INTO sectores (nombre) VALUES ('Sector Cierres B ' || $1) RETURNING id",
      [Date.now() + 1]
    );
    sector2Id = Number(resSec2.rows[0].id);

    // 9. User con alcance SECTORES (solo sector 1)
    const legajoSec = 'SEC_4B_' + Date.now();
    const resUSec = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'User Sectores', $2, $3) RETURNING id`,
      [legajoSec, hash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    userSectoresId = Number(resUSec.rows[0].id);
    createdUsuarioIds.push(userSectoresId);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id)
       VALUES ($1, (SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_VER'), 'CONCEDER', 'SECTORES', $2)`,
      [userSectoresId, adminId]
    );
    await client.query(
      `INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)`,
      [userSectoresId, sector1Id]
    );
    const loginUSec = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoSec, password: 'pass123' })
    });
    userSectoresToken = (await loginUSec.json()).token;

    // 10. User con FINALIZAR pero sin ASIGNAR (para B-07)
    const legajoFSA = 'FSA_4B_' + Date.now();
    const resFSA = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'User Finalizar Sin Asignar', $2, $3) RETURNING id`,
      [legajoFSA, hash, perfilMap['OPERARIO']]
    );
    userFinalizarSinAsignarId = Number(resFSA.rows[0].id);
    createdUsuarioIds.push(userFinalizarSinAsignarId);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, otorgado_por_usuario_id)
       VALUES ($1, (SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_FINALIZAR'), 'CONCEDER', $2)`,
      [userFinalizarSinAsignarId, adminId]
    );
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, otorgado_por_usuario_id)
       VALUES ($1, (SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_VER'), 'CONCEDER', 'TODAS', $2)`,
      [userFinalizarSinAsignarId, adminId]
    );
    const loginFSA = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoFSA, password: 'pass123' })
    });
    userFinalizarSinAsignarToken = (await loginFSA.json()).token;

    // Crear máquina base
    const insMaq = await client.query(
      `INSERT INTO maquinas (nombre, codigo, sector_id, tipo, estado)
       VALUES ($1, $2, $3, 'TORNO', 'OPERATIVA') RETURNING id`,
      ['Torno Test 4B ' + Date.now(), 'MAQ4B_' + Date.now(), sector1Id]
    );
    maquinaId = Number(insMaq.rows[0].id);
    createdMaquinaIds.push(maquinaId);

    // Helpers de test
    const crearIntervencion = async (data: any, token: string = adminToken) => {
      const res = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          maquina_id: maquinaId,
          sector_id: sector1Id,
          tipo: 'CORRECTIVO',
          prioridad: 'MEDIA',
          descripcion: 'Intervencion test 4B',
          detiene_maquina: false,
          ...data
        })
      });
      const body = await res.json();
      if (res.status === 201 && body.id) {
        createdIntervencionIds.push(body.id);
      }
      return { res, body };
    };

    const iniciarIntervencion = async (id: number, token: string = resp1Token) => {
      const res = await app.request(`/api/intervenciones/${id}/iniciar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE'
        })
      });
      assert.strictEqual(res.status, 200, `iniciarIntervencion falló con status ${res.status}`);
      return res;
    };

    const crearMaquina = async (datos: Partial<{ nombre: string; estado: string; sector_id: number }> = {}) => {
      const ins = await client.query(
        `INSERT INTO maquinas (nombre, codigo, sector_id, tipo, estado)
         VALUES ($1, $2, $3, 'TORNO', $4) RETURNING id`,
        [
          datos.nombre || ('Torno 4B ' + Date.now() + '_' + Math.floor(Math.random() * 100000)),
          'MAQ4B_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
          datos.sector_id || sector1Id,
          datos.estado || 'OPERATIVA'
        ]
      );
      const mId = Number(ins.rows[0].id);
      createdMaquinaIds.push(mId);
      return mId;
    };

    // =========================================================================
    // 9.1 FINALIZAR (T6)
    // =========================================================================

    await t.test('B-01: Finalizar una intervención sin detención', async () => {
      const { body: inv } = await crearIntervencion({ detiene_maquina: false });
      await iniciarIntervencion(inv.id, resp1Token);

      const res = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resp1Token}`
        },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Se reparó la placa sin detener la máquina',
          ejecucion: 'INTERNA'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.intervencion.estado, 'FINALIZADA');
      assert.strictEqual(data.periodo, null);

      const checkDb = await client.query('SELECT * FROM intervenciones WHERE id = $1', [inv.id]);
      const row = checkDb.rows[0];
      assert.strictEqual(row.estado, 'FINALIZADA');
      assert.ok(row.fecha_finalizacion);
      assert.strictEqual(row.trabajo_realizado, 'Se reparó la placa sin detener la máquina');
      assert.strictEqual(row.ejecucion, 'INTERNA');

      const hist = await client.query(
        'SELECT * FROM historial_estados_intervencion WHERE intervencion_id = $1 AND estado_nuevo = $2',
        [inv.id, 'FINALIZADA']
      );
      assert.strictEqual(hist.rows.length, 1);

      const maq = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquinaId]);
      assert.strictEqual(maq.rows[0].estado, 'OPERATIVA');
    });

    await t.test('B-02: Validaciones de finalizar', async () => {
      const { body: inv } = await crearIntervencion({ detiene_maquina: false });
      await iniciarIntervencion(inv.id, resp1Token);

      // (a) Sin trabajo_realizado
      const r1 = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', ejecucion: 'INTERNA' })
      });
      assert.strictEqual(r1.status, 422);

      // (b) Ejecucion invalida
      const r2 = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', trabajo_realizado: 'ok', ejecucion: 'MIXTA' })
      });
      assert.strictEqual(r2.status, 422);

      // (c) fecha_finalizacion < fecha_inicio
      const r3 = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'ok',
          ejecucion: 'INTERNA',
          fecha_finalizacion: '2020-01-01T00:00:00Z'
        })
      });
      assert.strictEqual(r3.status, 422);

      // (d) fecha futura
      const r4 = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'ok',
          ejecucion: 'INTERNA',
          fecha_finalizacion: '2099-01-01T00:00:00Z'
        })
      });
      assert.strictEqual(r4.status, 422);

      // (e) fecha sin zona horaria
      const r5 = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'ok',
          ejecucion: 'INTERNA',
          fecha_finalizacion: '2026-10-23 12:00:00'
        })
      });
      assert.strictEqual(r5.status, 422);

      const checkDb = await client.query('SELECT estado FROM intervenciones WHERE id = $1', [inv.id]);
      assert.strictEqual(checkDb.rows[0].estado, 'EN_PROCESO');
    });

    await t.test('B-03: Con período abierto y sin maquina_recuperada', async () => {
      const { body: inv } = await crearIntervencion({ detiene_maquina: true });
      await iniciarIntervencion(inv.id, resp1Token);

      const res = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Reparación de motor',
          ejecucion: 'INTERNA'
        })
      });

      assert.strictEqual(res.status, 422);
      const data = await res.json();
      assert.strictEqual(data.codigo, 'DECISION_RECUPERACION_REQUERIDA');

      const checkDb = await client.query('SELECT estado FROM intervenciones WHERE id = $1', [inv.id]);
      assert.strictEqual(checkDb.rows[0].estado, 'EN_PROCESO');

      const checkPer = await client.query(
        'SELECT * FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL',
        [inv.id]
      );
      assert.strictEqual(checkPer.rows.length, 1);
    });

    await t.test('B-04: Con período abierto, maquina_recuperada = true, sin fecha_recuperacion', async () => {
      const mId = await crearMaquina();
      const { body: inv } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      await iniciarIntervencion(inv.id, resp1Token);

      const res = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Cambio de rodamiento y prueba completa',
          ejecucion: 'INTERNA',
          maquina_recuperada: true
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.intervencion.estado, 'FINALIZADA');
      assert.ok(data.periodo);
      assert.ok(data.periodo.hasta);
      assert.strictEqual(data.periodo.confirmado_por_usuario_id, resp1Id);

      const checkDb = await client.query('SELECT tiempo_inactividad_minutos FROM intervenciones WHERE id = $1', [inv.id]);
      assert.ok(checkDb.rows[0].tiempo_inactividad_minutos !== null);

      const maq = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(maq.rows[0].estado, 'OPERATIVA');
    });

    await t.test('B-05: maquina_recuperada = true con CONFIRMAR_RECUPERACION denegado por excepción', async () => {
      const { body: inv } = await crearIntervencion({ detiene_maquina: true });
      // Iniciar con userSinConfirmar
      await app.request(`/api/intervenciones/${inv.id}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userSinConfirmarToken}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', fecha_inicio: new Date().toISOString() })
      });

      const res = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userSinConfirmarToken}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Trabajo terminado',
          ejecucion: 'INTERNA',
          maquina_recuperada: true
        })
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.codigo, 'CONFIRMACION_NO_PERMITIDA');

      const checkDb = await client.query('SELECT estado FROM intervenciones WHERE id = $1', [inv.id]);
      assert.strictEqual(checkDb.rows[0].estado, 'EN_PROCESO');

      const checkPer = await client.query(
        'SELECT * FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL',
        [inv.id]
      );
      assert.strictEqual(checkPer.rows.length, 1);
    });

    await t.test('B-06: maquina_recuperada = false (era EN_MANTENIMIENTO)', async () => {
      const mId = await crearMaquina();
      const { body: inv } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      await iniciarIntervencion(inv.id, resp1Token);

      // La maquina esta en EN_MANTENIMIENTO
      let maq = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(maq.rows[0].estado, 'EN_MANTENIMIENTO');

      const res = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Se retiró el motor pero falta ensamblar en banco',
          ejecucion: 'INTERNA',
          maquina_recuperada: false
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.intervencion.estado, 'FINALIZADA');

      // Período sigue abierto
      const checkPer = await client.query(
        'SELECT * FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL',
        [inv.id]
      );
      assert.strictEqual(checkPer.rows.length, 1);

      // Máquina pasa a DETENIDA
      maq = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(maq.rows[0].estado, 'DETENIDA');

      // Limpiar cerrando el periodo para no afectar tests subsiguientes
      await client.query('UPDATE intervencion_periodos_detencion SET hasta = NOW(), confirmado_por_usuario_id = $2 WHERE intervencion_id = $1', [inv.id, resp1Id]);
      await client.query("UPDATE maquinas SET estado = 'OPERATIVA' WHERE id = $1", [mId]);
    });

    await t.test('B-07: Finaliza alguien que no es el responsable y no tiene ASIGNAR', async () => {
      const { body: inv } = await crearIntervencion({ detiene_maquina: false });
      await iniciarIntervencion(inv.id, resp1Token);

      // Intentar finalizar con usuario que tiene FINALIZAR pero no ASIGNAR ni es el responsable
      const res = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userFinalizarSinAsignarToken}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Intento de usuario sin asignar',
          ejecucion: 'INTERNA'
        })
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.codigo, 'NO_ES_RESPONSABLE');
    });

    await t.test('B-08: Finalizar desde EN_ESPERA_REPUESTOS', async () => {
      const { body: inv } = await crearIntervencion({ detiene_maquina: false });
      await iniciarIntervencion(inv.id, resp1Token);

      // Pasar a espera repuestos
      await app.request(`/api/intervenciones/${inv.id}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', motivo: 'Falta correa dentada' })
      });

      const res = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_ESPERA_REPUESTOS',
          trabajo_realizado: 'Intento directo',
          ejecucion: 'INTERNA'
        })
      });

      assert.strictEqual(res.status, 409);
      const data = await res.json();
      assert.strictEqual(data.codigo, 'TRANSICION_NO_PERMITIDA');
    });

    // =========================================================================
    // 9.2 EJEMPLOS DEL ANÁLISIS (SECCIÓN 4.6)
    // =========================================================================

    await t.test('B-09: Ejemplo 1 — A detiene, B no detiene', async () => {
      const mId = await crearMaquina();

      // 08:00 A detiene
      const { body: a } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true, descripcion: 'Intervencion A motor' });
      let mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'DETENIDA');

      // 08:30 B no detiene
      const { body: b } = await crearIntervencion({ maquina_id: mId, detiene_maquina: false, descripcion: 'Intervencion B luces' });
      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'DETENIDA');

      // 09:00 Se resuelve y finaliza B (resolver ahora)
      const resB = await app.request(`/api/intervenciones/${b.id}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          trabajo_realizado: 'Se cambiaron lámparas',
          ejecucion: 'INTERNA',
          fecha_inicio: new Date().toISOString()
        })
      });
      assert.strictEqual(resB.status, 200);
      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'DETENIDA');

      // 10:00 A pasa a EN_PROCESO
      await iniciarIntervencion(a.id, resp1Token);
      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'EN_MANTENIMIENTO');

      // 13:00 A finalizada con recuperación
      const resA = await app.request(`/api/intervenciones/${a.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Motor reparado y probado',
          ejecucion: 'INTERNA',
          maquina_recuperada: true
        })
      });
      assert.strictEqual(resA.status, 200);
      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'OPERATIVA');

      // Historial de maquina exacto
      const histM = await client.query(
        'SELECT estado_anterior, estado_nuevo FROM historial_estados_maquina WHERE maquina_id = $1 ORDER BY id ASC',
        [mId]
      );
      assert.strictEqual(histM.rows.length, 3);
      assert.deepStrictEqual(histM.rows[0], { estado_anterior: 'OPERATIVA', estado_nuevo: 'DETENIDA' });
      assert.deepStrictEqual(histM.rows[1], { estado_anterior: 'DETENIDA', estado_nuevo: 'EN_MANTENIMIENTO' });
      assert.deepStrictEqual(histM.rows[2], { estado_anterior: 'EN_MANTENIMIENTO', estado_nuevo: 'OPERATIVA' });
    });

    await t.test('B-10: Ejemplo 2 — A y B detienen la máquina', async () => {
      const mId = await crearMaquina();

      // 08:00 A detiene
      const { body: a } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      await iniciarIntervencion(a.id, resp1Token);

      // 10:00 B detiene (queda en PENDIENTE)
      const { body: b } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });

      let mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'EN_MANTENIMIENTO');

      // 12:00 Se finaliza A y se confirma su recuperación
      const resA = await app.request(`/api/intervenciones/${a.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Causa A solucionada',
          ejecucion: 'INTERNA',
          maquina_recuperada: true
        })
      });
      assert.strictEqual(resA.status, 200);

      // Después de A: máquina sigue DETENIDA (porque B detiene y no está EN_PROCESO, NUNCA OPERATIVA)
      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'DETENIDA');

      // 14:00 Se resuelve B con recuperación
      const resB = await app.request(`/api/intervenciones/${b.id}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          trabajo_realizado: 'Causa B solucionada',
          ejecucion: 'INTERNA',
          fecha_inicio: new Date().toISOString(),
          maquina_recuperada: true
        })
      });
      assert.strictEqual(resB.status, 200);

      // Después de B: OPERATIVA
      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'OPERATIVA');
    });

    await t.test('B-11: Ejemplo 3 — Finalización administrativa sin recuperación y posterior confirmación', async () => {
      const mId = await crearMaquina();

      const { body: a } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      await iniciarIntervencion(a.id, resp1Token);

      // Finalizar con "maquina_recuperada = false"
      const resFin = await app.request(`/api/intervenciones/${a.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Finalización administrativa sin validar funcionamiento',
          ejecucion: 'INTERNA',
          maquina_recuperada: false
        })
      });
      assert.strictEqual(resFin.status, 200);

      let aRow = await client.query('SELECT estado FROM intervenciones WHERE id = $1', [a.id]);
      assert.strictEqual(aRow.rows[0].estado, 'FINALIZADA');

      let perRow = await client.query(
        'SELECT * FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL',
        [a.id]
      );
      assert.strictEqual(perRow.rows.length, 1);
      const periodoId = Number(perRow.rows[0].id);

      let mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'DETENIDA');

      // Día siguiente: "Confirmar recuperación" desde la máquina
      const resConf = await app.request(`/api/maquinas/${mId}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          periodo_ids: [periodoId]
        })
      });
      assert.strictEqual(resConf.status, 200);

      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'OPERATIVA');

      perRow = await client.query('SELECT hasta FROM intervencion_periodos_detencion WHERE id = $1', [periodoId]);
      assert.ok(perRow.rows[0].hasta !== null);
    });

    await t.test('B-12: Ejemplo 5 — Concurrencia en finalización con recuperación', async () => {
      const mId = await crearMaquina();

      const { body: a } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      const { body: b } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });

      await iniciarIntervencion(a.id, resp1Token);
      await iniciarIntervencion(b.id, resp2Token);

      // Finalizar A y B simultáneamente con recuperación
      const [resA, resB] = await Promise.all([
        app.request(`/api/intervenciones/${a.id}/finalizar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({
            estado_esperado: 'EN_PROCESO',
            trabajo_realizado: 'Finalizado A concurrente',
            ejecucion: 'INTERNA',
            maquina_recuperada: true
          })
        }),
        app.request(`/api/intervenciones/${b.id}/finalizar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp2Token}` },
          body: JSON.stringify({
            estado_esperado: 'EN_PROCESO',
            trabajo_realizado: 'Finalizado B concurrente',
            ejecucion: 'INTERNA',
            maquina_recuperada: true
          })
        })
      ]);

      assert.strictEqual(resA.status, 200);
      assert.strictEqual(resB.status, 200);

      const mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'OPERATIVA');

      // Ningún período abierto
      const pers = await client.query(
        'SELECT * FROM intervencion_periodos_detencion WHERE maquina_id = $1 AND hasta IS NULL',
        [mId]
      );
      assert.strictEqual(pers.rows.length, 0);

      // Exactamente una fila que lleva a OPERATIVA en el historial y es la última
      const histM = await client.query(
        'SELECT estado_anterior, estado_nuevo FROM historial_estados_maquina WHERE maquina_id = $1 ORDER BY id ASC',
        [mId]
      );
      const aOperativa = histM.rows.filter(r => r.estado_nuevo === 'OPERATIVA');
      assert.strictEqual(aOperativa.length, 1);
      assert.strictEqual(histM.rows[histM.rows.length - 1].estado_nuevo, 'OPERATIVA');
    });

    // =========================================================================
    // 9.3 RESOLVER AHORA (T2)
    // =========================================================================

    await t.test('B-13: PENDIENTE sin responsable ni detención, usuario con ASIGNARSE', async () => {
      const { body: inv } = await crearIntervencion({ detiene_maquina: false });

      const fechaIni = new Date().toISOString();
      const res = await app.request(`/api/intervenciones/${inv.id}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          trabajo_realizado: 'Ajuste de tuerca en 5 minutos',
          ejecucion: 'INTERNA',
          fecha_inicio: fechaIni
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.intervencion.estado, 'FINALIZADA');
      assert.strictEqual(data.intervencion.responsable.id, resp1Id);

      // Auditoría de asignación
      const aud = await client.query(
        `SELECT * FROM intervencion_auditoria WHERE intervencion_id = $1 AND (campo_modificado = 'responsable_usuario_id' OR tipo_evento = 'ASIGNACION')`,
        [inv.id]
      );
      assert.ok(aud.rows.length >= 1);

      // Exactamente 2 filas de historial en orden PENDIENTE->EN_PROCESO, EN_PROCESO->FINALIZADA
      const hist = await client.query(
        'SELECT estado_anterior, estado_nuevo, observacion FROM historial_estados_intervencion WHERE intervencion_id = $1 AND estado_anterior IS NOT NULL ORDER BY id ASC',
        [inv.id]
      );
      assert.strictEqual(hist.rows.length, 2);
      assert.strictEqual(hist.rows[0].estado_anterior, 'PENDIENTE');
      assert.strictEqual(hist.rows[0].estado_nuevo, 'EN_PROCESO');
      assert.strictEqual(hist.rows[0].observacion, 'Resolución inmediata');
      assert.strictEqual(hist.rows[1].estado_anterior, 'EN_PROCESO');
      assert.strictEqual(hist.rows[1].estado_nuevo, 'FINALIZADA');
    });

    await t.test('B-14: Con detención y recuperación: DETENIDA -> OPERATIVA directo', async () => {
      const mId = await crearMaquina();

      const { body: inv } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      // Maquina paso a DETENIDA
      let mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'DETENIDA');

      const res = await app.request(`/api/intervenciones/${inv.id}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          trabajo_realizado: 'Se destrabó el vástago inmediatamente',
          ejecucion: 'INTERNA',
          fecha_inicio: new Date().toISOString(),
          maquina_recuperada: true
        })
      });

      assert.strictEqual(res.status, 200);
      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'OPERATIVA');

      // Historial de maquina: DETENIDA -> OPERATIVA directo, NINGUNA con EN_MANTENIMIENTO
      const histM = await client.query(
        'SELECT estado_anterior, estado_nuevo FROM historial_estados_maquina WHERE maquina_id = $1 ORDER BY id ASC',
        [mId]
      );
      assert.strictEqual(histM.rows.some(r => r.estado_nuevo === 'EN_MANTENIMIENTO'), false);
      assert.strictEqual(histM.rows[histM.rows.length - 1].estado_nuevo, 'OPERATIVA');
    });

    await t.test('B-15: Validaciones de fechas en resolver-ahora', async () => {
      const { body: inv } = await crearIntervencion({ detiene_maquina: false });

      // (a) Sin fecha_inicio
      const r1 = await app.request(`/api/intervenciones/${inv.id}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          trabajo_realizado: 'Test',
          ejecucion: 'INTERNA'
        })
      });
      assert.strictEqual(r1.status, 422);

      // (b) fecha_inicio > fecha_finalizacion
      const r2 = await app.request(`/api/intervenciones/${inv.id}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          trabajo_realizado: 'Test',
          ejecucion: 'INTERNA',
          fecha_inicio: '2026-10-23T15:00:00Z',
          fecha_finalizacion: '2026-10-23T14:00:00Z'
        })
      });
      assert.strictEqual(r2.status, 422);

      // (c) fecha_inicio < fecha_creacion
      const r3 = await app.request(`/api/intervenciones/${inv.id}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          trabajo_realizado: 'Test',
          ejecucion: 'INTERNA',
          fecha_inicio: '2020-01-01T00:00:00Z'
        })
      });
      assert.strictEqual(r3.status, 422);

      const checkDb = await client.query('SELECT estado FROM intervenciones WHERE id = $1', [inv.id]);
      assert.strictEqual(checkDb.rows[0].estado, 'PENDIENTE');
    });

    await t.test('B-16: Usuario sin FINALIZAR intenta resolver-ahora', async () => {
      const { body: inv } = await crearIntervencion({ detiene_maquina: false });

      // Operario no tiene FINALIZAR
      const res = await app.request(`/api/intervenciones/${inv.id}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          trabajo_realizado: 'Intento',
          ejecucion: 'INTERNA',
          fecha_inicio: new Date().toISOString()
        })
      });

      assert.strictEqual(res.status, 403);
    });

    // =========================================================================
    // 9.4 CANCELAR (T3, T7, T8)
    // =========================================================================

    await t.test('B-17: Cancelar desde PENDIENTE, EN_PROCESO y EN_ESPERA_REPUESTOS con motivo', async () => {
      // 1. Cancelar PENDIENTE (T3)
      const { body: i1 } = await crearIntervencion({ detiene_maquina: false });
      const r1 = await app.request(`/api/intervenciones/${i1.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'Cancelada en pendiente por duplicado' })
      });
      assert.strictEqual(r1.status, 200);
      const row1 = (await client.query('SELECT estado FROM intervenciones WHERE id = $1', [i1.id])).rows[0];
      assert.strictEqual(row1.estado, 'CANCELADA');
      const h1 = (await client.query('SELECT observacion FROM historial_estados_intervencion WHERE intervencion_id = $1 ORDER BY id DESC LIMIT 1', [i1.id])).rows[0];
      assert.strictEqual(h1.observacion, 'Cancelada en pendiente por duplicado');

      // 2. Cancelar EN_PROCESO (T7)
      const { body: i2 } = await crearIntervencion({ detiene_maquina: false });
      await iniciarIntervencion(i2.id, resp1Token);
      const r2 = await app.request(`/api/intervenciones/${i2.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', motivo: 'Cancelada en proceso por cambio de plan' })
      });
      assert.strictEqual(r2.status, 200);
      const row2 = (await client.query('SELECT estado FROM intervenciones WHERE id = $1', [i2.id])).rows[0];
      assert.strictEqual(row2.estado, 'CANCELADA');

      // 3. Cancelar EN_ESPERA_REPUESTOS (T8)
      const { body: i3 } = await crearIntervencion({ detiene_maquina: false });
      await iniciarIntervencion(i3.id, resp1Token);
      await app.request(`/api/intervenciones/${i3.id}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', motivo: 'Esperando pieza' })
      });
      const r3 = await app.request(`/api/intervenciones/${i3.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_ESPERA_REPUESTOS', motivo: 'No se consigue repuesto y se da de baja' })
      });
      assert.strictEqual(r3.status, 200);
      const row3 = (await client.query('SELECT estado FROM intervenciones WHERE id = $1', [i3.id])).rows[0];
      assert.strictEqual(row3.estado, 'CANCELADA');
    });

    await t.test('B-18: Sin motivo o con menos de 5 caracteres al cancelar', async () => {
      const { body: inv } = await crearIntervencion({ detiene_maquina: false });

      // Sin motivo
      const r1 = await app.request(`/api/intervenciones/${inv.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(r1.status, 422);
      assert.strictEqual((await r1.json()).codigo, 'MOTIVO_REQUERIDO');

      // Menos de 5 chars
      const r2 = await app.request(`/api/intervenciones/${inv.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'chau' })
      });
      assert.strictEqual(r2.status, 422);
      assert.strictEqual((await r2.json()).codigo, 'MOTIVO_REQUERIDO');
    });

    await t.test('B-19: T7 conserva lo cargado', async () => {
      const { body: inv } = await crearIntervencion({ detiene_maquina: false });
      await iniciarIntervencion(inv.id, resp1Token);

      const r = await app.request(`/api/intervenciones/${inv.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', motivo: 'Cancelada conservando datos' })
      });
      assert.strictEqual(r.status, 200);

      const checkDb = await client.query('SELECT * FROM intervenciones WHERE id = $1', [inv.id]);
      const row = checkDb.rows[0];
      assert.strictEqual(Number(row.responsable_usuario_id), resp1Id);
      assert.ok(row.fecha_inicio);
      assert.strictEqual(row.fecha_finalizacion, null);
    });

    await t.test('B-20: Cancela un usuario con CANCELAR que no es responsable ni tiene ASIGNAR (D-28)', async () => {
      const { body: inv } = await crearIntervencion({ detiene_maquina: false });
      await iniciarIntervencion(inv.id, resp1Token);

      // Cancelar con userConCancel (tiene CANCELAR pero no es responsable ni tiene ASIGNAR)
      const res = await app.request(`/api/intervenciones/${inv.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userConCancelToken}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          motivo: 'Cancelada por usuario auditor con permiso de cancelacion'
        })
      });

      assert.strictEqual(res.status, 200);
      const row = (await client.query('SELECT estado FROM intervenciones WHERE id = $1', [inv.id])).rows[0];
      assert.strictEqual(row.estado, 'CANCELADA');
    });

    await t.test('B-21: Con período abierto, maquina_recuperada = false al cancelar', async () => {
      const mId = await crearMaquina();

      const { body: inv } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      await iniciarIntervencion(inv.id, resp1Token);

      const res = await app.request(`/api/intervenciones/${inv.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          motivo: 'Cancelada pero la máquina sigue rota físicamente',
          maquina_recuperada: false
        })
      });
      assert.strictEqual(res.status, 200);

      // Periodo sigue abierto
      const pers = await client.query(
        'SELECT id FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL',
        [inv.id]
      );
      assert.strictEqual(pers.rows.length, 1);
      const perId = Number(pers.rows[0].id);

      // Maquina pasa a DETENIDA
      let mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'DETENIDA');

      // Luego confirmar recuperación -> OPERATIVA
      const rConf = await app.request(`/api/maquinas/${mId}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ periodo_ids: [perId] })
      });
      assert.strictEqual(rConf.status, 200);

      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'OPERATIVA');
    });

    await t.test('B-22: Cancelar una FINALIZADA o CANCELADA', async () => {
      const { body: i1 } = await crearIntervencion({ detiene_maquina: false });
      await iniciarIntervencion(i1.id, resp1Token);
      await app.request(`/api/intervenciones/${i1.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', trabajo_realizado: 'ok', ejecucion: 'INTERNA' })
      });

      const rFin = await app.request(`/api/intervenciones/${i1.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'FINALIZADA', motivo: 'Intento cancelar finalizada' })
      });
      assert.strictEqual(rFin.status, 409);

      const { body: i2 } = await crearIntervencion({ detiene_maquina: false });
      await app.request(`/api/intervenciones/${i2.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'Cancelada 1' })
      });

      const rCanc = await app.request(`/api/intervenciones/${i2.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'CANCELADA', motivo: 'Intento cancelar cancelada' })
      });
      assert.strictEqual(rCanc.status, 409);
    });

    // =========================================================================
    // 9.5 CONFIRMAR RECUPERACIÓN Y DETENCIONES
    // =========================================================================

    await t.test('B-23: Dos períodos abiertos; se confirma uno y luego el otro', async () => {
      const mId = await crearMaquina();

      const { body: i1 } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      const { body: i2 } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });

      const p1 = Number((await client.query('SELECT id FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL', [i1.id])).rows[0].id);
      const p2 = Number((await client.query('SELECT id FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL', [i2.id])).rows[0].id);

      // Se confirma p1
      const r1 = await app.request(`/api/maquinas/${mId}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ periodo_ids: [p1] })
      });
      assert.strictEqual(r1.status, 200);

      // Sigue DETENIDA
      let mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'DETENIDA');

      // Se confirma p2
      const r2 = await app.request(`/api/maquinas/${mId}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ periodo_ids: [p2] })
      });
      assert.strictEqual(r2.status, 200);

      // Ahora es OPERATIVA
      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'OPERATIVA');
    });

    await t.test('B-24: periodo_ids con errores (rollback y nada se cierra)', async () => {
      // Crear máquina 2 para prueba de período ajeno
      const insM2 = await client.query(
        `INSERT INTO maquinas (nombre, codigo, sector_id, tipo, estado)
         VALUES ($1, $2, $3, 'FRESADORA', 'OPERATIVA') RETURNING id`,
        ['Fresadora 4B ' + Date.now(), 'MAQ2_4B_' + Date.now(), sector2Id]
      );
      const m2Id = Number(insM2.rows[0].id);
      createdMaquinaIds.push(m2Id);

      const { body: iValida } = await crearIntervencion({ maquina_id: maquinaId, detiene_maquina: true });
      const pValido = Number((await client.query('SELECT id FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL', [iValida.id])).rows[0].id);

      const { body: iAjena } = await crearIntervencion({ maquina_id: m2Id, sector_id: sector2Id, detiene_maquina: true });
      const pAjeno = Number((await client.query('SELECT id FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL', [iAjena.id])).rows[0].id);

      // 1. Periodo de otra maquina
      const r1 = await app.request(`/api/maquinas/${maquinaId}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ periodo_ids: [pValido, pAjeno] })
      });
      assert.strictEqual(r1.status, 422);
      assert.strictEqual((await r1.json()).codigo, 'PERIODO_INVALIDO');

      // 2. Periodo ya cerrado
      const { body: iCerrada } = await crearIntervencion({ maquina_id: maquinaId, detiene_maquina: true });
      const pCerrado = Number((await client.query('SELECT id FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL', [iCerrada.id])).rows[0].id);
      await client.query('UPDATE intervencion_periodos_detencion SET hasta = NOW(), confirmado_por_usuario_id = $2 WHERE id = $1', [pCerrado, resp1Id]);

      const r2 = await app.request(`/api/maquinas/${maquinaId}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ periodo_ids: [pValido, pCerrado] })
      });
      assert.strictEqual(r2.status, 422);
      assert.strictEqual((await r2.json()).codigo, 'PERIODO_INVALIDO');

      // 3. Periodo inexistente
      const r3 = await app.request(`/api/maquinas/${maquinaId}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ periodo_ids: [pValido, 99999999] })
      });
      assert.strictEqual(r3.status, 422);
      assert.strictEqual((await r3.json()).codigo, 'PERIODO_INVALIDO');

      // 4. Periodo no visible (para usuario de alcance SECTORES)
      // iAjena está en sector 2, userSectores solo ve sector 1
      const r4 = await app.request(`/api/maquinas/${m2Id}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userSectoresToken}` },
        body: JSON.stringify({ periodo_ids: [pAjeno] })
      });
      assert.strictEqual(r4.status, 422);
      assert.strictEqual((await r4.json()).codigo, 'PERIODO_INVALIDO');

      // Verificar que el periodo válido NO se cerró en ninguno de los casos
      const checkPVal = (await client.query('SELECT hasta FROM intervencion_periodos_detencion WHERE id = $1', [pValido])).rows[0];
      assert.strictEqual(checkPVal.hasta, null);

      // Limpiar períodos
      await client.query('UPDATE intervencion_periodos_detencion SET hasta = NOW(), confirmado_por_usuario_id = $3 WHERE id IN ($1, $2)', [pValido, pAjeno, resp1Id]);
      await client.query("UPDATE maquinas SET estado = 'OPERATIVA' WHERE id IN ($1, $2)", [maquinaId, m2Id]);
    });

    await t.test('B-25: Usuario sin CONFIRMAR_RECUPERACION', async () => {
      const mId = await crearMaquina();
      const { body: inv } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      const pId = Number((await client.query('SELECT id FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL', [inv.id])).rows[0].id);

      // userSinConfirmar tiene la excepción concedido=false
      const res = await app.request(`/api/maquinas/${mId}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userSinConfirmarToken}` },
        body: JSON.stringify({ periodo_ids: [pId] })
      });
      assert.strictEqual(res.status, 403);

      await client.query('UPDATE intervencion_periodos_detencion SET hasta = NOW(), confirmado_por_usuario_id = $2 WHERE id = $1', [pId, resp1Id]);
      await client.query("UPDATE maquinas SET estado = 'OPERATIVA' WHERE id = $1", [mId]);
    });

    await t.test('B-26: fecha_recuperacion anterior a desde o futura', async () => {
      const mId = await crearMaquina();
      const { body: inv } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      const pId = Number((await client.query('SELECT id FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL', [inv.id])).rows[0].id);

      // Anterior a desde
      const r1 = await app.request(`/api/maquinas/${mId}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ periodo_ids: [pId], fecha_recuperacion: '2020-01-01T00:00:00Z' })
      });
      assert.strictEqual(r1.status, 422);
      assert.strictEqual((await r1.json()).codigo, 'FECHA_INCOHERENTE');

      // Futura
      const r2 = await app.request(`/api/maquinas/${mId}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ periodo_ids: [pId], fecha_recuperacion: '2099-01-01T00:00:00Z' })
      });
      assert.strictEqual(r2.status, 422);
      assert.strictEqual((await r2.json()).codigo, 'FECHA_INCOHERENTE');

      await client.query('UPDATE intervencion_periodos_detencion SET hasta = NOW(), confirmado_por_usuario_id = $2 WHERE id = $1', [pId, resp1Id]);
      await client.query("UPDATE maquinas SET estado = 'OPERATIVA' WHERE id = $1", [mId]);
    });

    await t.test('B-27: Confirmar con intervención todavía EN_PROCESO (D-31) y finalizarla después', async () => {
      const mId = await crearMaquina();

      const { body: inv } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      await iniciarIntervencion(inv.id, resp1Token);

      const pId = Number((await client.query('SELECT id FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL', [inv.id])).rows[0].id);

      // Confirmar recuperación antes de finalizar (mientras está EN_PROCESO)
      const rConf = await app.request(`/api/maquinas/${mId}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ periodo_ids: [pId] })
      });
      assert.strictEqual(rConf.status, 200);

      let mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'OPERATIVA');

      // Ahora finalizar la intervención: como ya no tiene período abierto, NO pide maquina_recuperada
      const rFin = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Ajustes finales de lubricación',
          ejecucion: 'INTERNA'
        })
      });
      assert.strictEqual(rFin.status, 200);
      const dataFin = await rFin.json();
      assert.strictEqual(dataFin.periodo, null);
    });

    await t.test('B-28: tiempo_inactividad_minutos acumulado', async () => {
      const { body: inv } = await crearIntervencion({ detiene_maquina: false });

      // Ajustar primer periodo: 4 horas atrás
      const insP1 = await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id)
         VALUES ($1, $2, NOW() - INTERVAL '4 hours', NOW(), $3, $3) RETURNING id`,
        [inv.id, maquinaId, resp1Id]
      );

      // Calcular tiempo inicial cerrando un período (o ejecutando el update directo)
      await client.query(
        `UPDATE intervenciones i
         SET tiempo_inactividad_minutos = COALESCE((
           SELECT ROUND(SUM(EXTRACT(EPOCH FROM (p.hasta - p.desde)) / 60))
           FROM intervencion_periodos_detencion p
           WHERE p.intervencion_id = i.id AND p.hasta IS NOT NULL
         ), 0)
         WHERE id = $1`,
        [inv.id]
      );
      let invRow = (await client.query('SELECT tiempo_inactividad_minutos FROM intervenciones WHERE id = $1', [inv.id])).rows[0];
      assert.strictEqual(Number(invRow.tiempo_inactividad_minutos), 240);

      // Insertar segundo período cerrado de 2 horas (por ejemplo 10h a 8h atrás)
      await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id)
         VALUES ($1, $2, NOW() - INTERVAL '10 hours', NOW() - INTERVAL '8 hours', $3, $3)`,
        [inv.id, maquinaId, resp1Id]
      );

      // Crear un tercer período abierto y cerrarlo via endpoint
      const insP3 = await client.query(
        `INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, abierto_por_usuario_id)
         VALUES ($1, $2, NOW(), $3) RETURNING id`,
        [inv.id, maquinaId, resp1Id]
      );
      const p3Id = Number(insP3.rows[0].id);

      await app.request(`/api/maquinas/${maquinaId}/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ periodo_ids: [p3Id] })
      });

      invRow = (await client.query('SELECT tiempo_inactividad_minutos FROM intervenciones WHERE id = $1', [inv.id])).rows[0];
      // 240 + 120 + 0 = 360
      assert.strictEqual(Number(invRow.tiempo_inactividad_minutos), 360);
    });

    await t.test('B-29: GET /detenciones-abiertas con usuario de alcance SECTORES', async () => {
      // Máquina 1 en sector 1 (visible) y Máquina 2 en sector 2 (no visible)
      const insM2 = await client.query(
        `INSERT INTO maquinas (nombre, codigo, sector_id, tipo, estado)
         VALUES ($1, $2, $3, 'FRESADORA B29', 'OPERATIVA') RETURNING id`,
        ['Fresadora B29 ' + Date.now(), 'MAQB29_' + Date.now(), sector2Id]
      );
      const m2Id = Number(insM2.rows[0].id);
      createdMaquinaIds.push(m2Id);

      const { body: iSec1 } = await crearIntervencion({ maquina_id: maquinaId, detiene_maquina: true });
      const { body: iSec2 } = await crearIntervencion({ maquina_id: m2Id, sector_id: sector2Id, detiene_maquina: true });

      // userSectores solo tiene alcance sobre sector1Id
      const res1 = await app.request(`/api/maquinas/${maquinaId}/detenciones-abiertas`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${userSectoresToken}` }
      });
      assert.strictEqual(res1.status, 200);
      const list1 = await res1.json();
      assert.ok(list1.some((p: any) => p.intervencion?.id === iSec1.id || p.intervencion_id === iSec1.id));

      const res2 = await app.request(`/api/maquinas/${m2Id}/detenciones-abiertas`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${userSectoresToken}` }
      });
      assert.strictEqual(res2.status, 200);
      const list2 = await res2.json();
      assert.strictEqual(list2.length, 0);

      await client.query('UPDATE intervencion_periodos_detencion SET hasta = NOW(), confirmado_por_usuario_id = $3 WHERE intervencion_id IN ($1, $2)', [iSec1.id, iSec2.id, resp1Id]);
      await client.query("UPDATE maquinas SET estado = 'OPERATIVA' WHERE id IN ($1, $2)", [maquinaId, m2Id]);
    });

    await t.test('B-30: Registrar detención en EN_PROCESO y en PENDIENTE', async () => {
      const mId = await crearMaquina();

      // 1. En EN_PROCESO
      const { body: i1 } = await crearIntervencion({ maquina_id: mId, detiene_maquina: false });
      await iniciarIntervencion(i1.id, resp1Token);

      const r1 = await app.request(`/api/intervenciones/${i1.id}/registrar-detencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', desde: new Date().toISOString(), observacion: 'Se detuvo en pleno ensayo' })
      });
      assert.strictEqual(r1.status, 200);
      let mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'EN_MANTENIMIENTO');

      // 2. En PENDIENTE (usando otra máquina para aislar)
      const m3Id = await crearMaquina();

      const { body: i2 } = await crearIntervencion({ maquina_id: m3Id, detiene_maquina: false });
      const r2 = await app.request(`/api/intervenciones/${i2.id}/registrar-detencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', desde: new Date().toISOString(), observacion: 'Se paró antes de asignar' })
      });
      assert.strictEqual(r2.status, 200);
      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [m3Id]);
      assert.strictEqual(mRow.rows[0].estado, 'DETENIDA');

      await client.query('UPDATE intervencion_periodos_detencion SET hasta = NOW(), confirmado_por_usuario_id = $3 WHERE intervencion_id IN ($1, $2)', [i1.id, i2.id, resp1Id]);
      await client.query("UPDATE maquinas SET estado = 'OPERATIVA' WHERE id IN ($1, $2)", [mId, m3Id]);
    });

    await t.test('B-31: Registrar detención con período ya abierto y en FINALIZADA', async () => {
      const mId = await crearMaquina();
      const { body: i1 } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });

      // Periodo ya abierto
      const r1 = await app.request(`/api/intervenciones/${i1.id}/registrar-detencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', desde: new Date().toISOString(), observacion: 'Periodo ya abierto' })
      });
      assert.strictEqual(r1.status, 409);
      assert.strictEqual((await r1.json()).codigo, 'DETENCION_YA_ABIERTA');

      // En FINALIZADA
      const { body: i2 } = await crearIntervencion({ maquina_id: mId, detiene_maquina: false });
      await iniciarIntervencion(i2.id, resp1Token);
      await app.request(`/api/intervenciones/${i2.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', trabajo_realizado: 'ok para finalizar', ejecucion: 'INTERNA' })
      });

      const r2 = await app.request(`/api/intervenciones/${i2.id}/registrar-detencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'FINALIZADA', desde: new Date().toISOString(), observacion: 'Intento registrar en finalizada' })
      });
      assert.strictEqual(r2.status, 409);
      assert.strictEqual((await r2.json()).codigo, 'TRANSICION_NO_PERMITIDA');

      await client.query('UPDATE intervencion_periodos_detencion SET hasta = NOW(), confirmado_por_usuario_id = $2 WHERE intervencion_id = $1', [i1.id, resp1Id]);
      await client.query("UPDATE maquinas SET estado = 'OPERATIVA' WHERE id = $1", [mId]);
    });

    // =========================================================================
    // 9.6 ESTADO MANUAL DE MÁQUINA
    // =========================================================================

    await t.test('B-32: FUERA_DE_SERVICIO desde OPERATIVA con motivo; sin motivo; sin permiso', async () => {
      const mId = await crearMaquina();

      // Sin motivo -> 422
      const r1 = await app.request(`/api/maquinas/${mId}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ accion: 'FUERA_DE_SERVICIO' })
      });
      assert.strictEqual(r1.status, 422);

      // Sin permiso -> 403 (operario no tiene MAQUINAS_CAMBIAR_ESTADO)
      const r2 = await app.request(`/api/maquinas/${mId}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operarioToken}` },
        body: JSON.stringify({ accion: 'FUERA_DE_SERVICIO', motivo: 'Baja preventiva' })
      });
      assert.strictEqual(r2.status, 403);

      // Con motivo y permiso -> 200
      const r3 = await app.request(`/api/maquinas/${mId}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ accion: 'FUERA_DE_SERVICIO', motivo: 'Mantenimiento anual mayor programado' })
      });
      assert.strictEqual(r3.status, 200);

      const mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'FUERA_DE_SERVICIO');

      const hRow = (await client.query(
        'SELECT intervencion_id, motivo FROM historial_estados_maquina WHERE maquina_id = $1 ORDER BY id DESC LIMIT 1',
        [mId]
      )).rows[0];
      assert.strictEqual(hRow.intervencion_id, null);
      assert.strictEqual(hRow.motivo, 'Mantenimiento anual mayor programado');
    });

    await t.test('B-33: Máquina FUERA_DE_SERVICIO con período abierto: iniciar y finalizar con recuperación', async () => {
      const mId = await crearMaquina({ estado: 'FUERA_DE_SERVICIO' });
      const { body: inv } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });

      // Iniciar
      await iniciarIntervencion(inv.id, resp1Token);
      let mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'FUERA_DE_SERVICIO');

      // Finalizar con recuperación
      const rFin = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Terminado trabajo',
          ejecucion: 'INTERNA',
          maquina_recuperada: true
        })
      });
      assert.strictEqual(rFin.status, 200);

      // Sigue FUERA_DE_SERVICIO y el período se cerró
      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'FUERA_DE_SERVICIO');

      const pRow = (await client.query('SELECT hasta FROM intervencion_periodos_detencion WHERE intervencion_id = $1', [inv.id])).rows[0];
      assert.ok(pRow.hasta !== null);
    });

    await t.test('B-34: REACTIVAR desde FUERA_DE_SERVICIO (a) espera repuestos, (b) EN_PROCESO, (c) sin períodos', async () => {
      const mId = await crearMaquina({ estado: 'FUERA_DE_SERVICIO' });

      // (a) con período abierto de intervención en espera -> DETENIDA
      const { body: i1 } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      await iniciarIntervencion(i1.id, resp1Token);
      await app.request(`/api/intervenciones/${i1.id}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', motivo: 'Espera pieza' })
      });

      const rA = await app.request(`/api/maquinas/${mId}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ accion: 'REACTIVAR', motivo: 'Reactivar máquina caso a' })
      });
      assert.strictEqual(rA.status, 200);
      let mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'DETENIDA');

      // Volver a FUERA_DE_SERVICIO
      await client.query("UPDATE maquinas SET estado = 'FUERA_DE_SERVICIO' WHERE id = $1", [mId]);

      // (b) con una EN_PROCESO con período -> EN_MANTENIMIENTO
      const { body: i2 } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      await iniciarIntervencion(i2.id, resp1Token);

      const rB = await app.request(`/api/maquinas/${mId}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ accion: 'REACTIVAR', motivo: 'Reactivar máquina caso b' })
      });
      assert.strictEqual(rB.status, 200);
      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'EN_MANTENIMIENTO');

      // Limpiar períodos anteriores y volver a FUERA_DE_SERVICIO
      await client.query('UPDATE intervencion_periodos_detencion SET hasta = NOW(), confirmado_por_usuario_id = $3 WHERE intervencion_id IN ($1, $2)', [i1.id, i2.id, resp1Id]);
      await client.query("UPDATE maquinas SET estado = 'FUERA_DE_SERVICIO' WHERE id = $1", [mId]);

      // (c) sin períodos -> OPERATIVA
      const rC = await app.request(`/api/maquinas/${mId}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ accion: 'REACTIVAR', motivo: 'Reactivar máquina caso c' })
      });
      assert.strictEqual(rC.status, 200);
      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'OPERATIVA');
    });

    await t.test('B-35: REACTIVAR desde DETENIDA (a) con períodos abiertos, (b) sin períodos', async () => {
      const mId = await crearMaquina();

      // (a) con períodos abiertos -> 409 MAQUINA_CON_DETENCIONES_ABIERTAS
      const { body: inv } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      let mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'DETENIDA');

      const rA = await app.request(`/api/maquinas/${mId}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ accion: 'REACTIVAR', motivo: 'Intento reactivar con periodos abiertos' })
      });
      assert.strictEqual(rA.status, 409);
      assert.strictEqual((await rA.json()).codigo, 'MAQUINA_CON_DETENCIONES_ABIERTAS');

      // (b) sin períodos abiertos (configurado por SQL) -> OPERATIVA
      await client.query('UPDATE intervencion_periodos_detencion SET hasta = NOW(), confirmado_por_usuario_id = $2 WHERE intervencion_id = $1', [inv.id, resp1Id]);
      // Dejamos la maquina en DETENIDA sin períodos abiertos
      await client.query("UPDATE maquinas SET estado = 'DETENIDA' WHERE id = $1", [mId]);

      const rB = await app.request(`/api/maquinas/${mId}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ accion: 'REACTIVAR', motivo: 'Reactivacion sin impedimentos' })
      });
      assert.strictEqual(rB.status, 200);
      mRow = await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId]);
      assert.strictEqual(mRow.rows[0].estado, 'OPERATIVA');
    });

    // =========================================================================
    // 9.7 MATRIZ, ATOMICIDAD Y REGRESIÓN
    // =========================================================================

    await t.test('B-36: Matriz estado × acción', async () => {
      // Matriz:
      // PENDIENTE: finalizar 409, resolver-ahora 200, cancelar 200, registrar-detencion 200
      // EN_PROCESO: finalizar 200, resolver-ahora 409, cancelar 200, registrar-detencion 200
      // EN_ESPERA_REPUESTOS: finalizar 409, resolver-ahora 409, cancelar 200, registrar-detencion 200
      // FINALIZADA: finalizar 409, resolver-ahora 409, cancelar 409, registrar-detencion 409
      // CANCELADA: finalizar 409, resolver-ahora 409, cancelar 409, registrar-detencion 409

      const estados = ['PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS', 'FINALIZADA', 'CANCELADA'] as const;
      const matrizEsperada: Record<string, { finalizar: number; 'resolver-ahora': number; cancelar: number; 'registrar-detencion': number }> = {
        PENDIENTE: { finalizar: 409, 'resolver-ahora': 200, cancelar: 200, 'registrar-detencion': 200 },
        EN_PROCESO: { finalizar: 200, 'resolver-ahora': 409, cancelar: 200, 'registrar-detencion': 200 },
        EN_ESPERA_REPUESTOS: { finalizar: 409, 'resolver-ahora': 409, cancelar: 200, 'registrar-detencion': 200 },
        FINALIZADA: { finalizar: 409, 'resolver-ahora': 409, cancelar: 409, 'registrar-detencion': 409 },
        CANCELADA: { finalizar: 409, 'resolver-ahora': 409, cancelar: 409, 'registrar-detencion': 409 }
      };

      for (const st of estados) {
        // Para cada celda, creamos una intervención y la llevamos al estado 'st' sin períodos de detención abiertos
        // 1. finalizar
        {
          const { body: inv } = await crearIntervencion({ detiene_maquina: false });
          if (st === 'EN_PROCESO' || st === 'EN_ESPERA_REPUESTOS') {
            await iniciarIntervencion(inv.id, resp1Token);
            if (st === 'EN_ESPERA_REPUESTOS') {
              await app.request(`/api/intervenciones/${inv.id}/espera-repuestos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
                body: JSON.stringify({ estado_esperado: 'EN_PROCESO', motivo: 'Espera test' })
              });
            }
          } else if (st === 'FINALIZADA') {
            await iniciarIntervencion(inv.id, resp1Token);
            await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
              body: JSON.stringify({ estado_esperado: 'EN_PROCESO', trabajo_realizado: 'ok', ejecucion: 'INTERNA' })
            });
          } else if (st === 'CANCELADA') {
            await app.request(`/api/intervenciones/${inv.id}/cancelar`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
              body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'Cancelada test' })
            });
          }

          const res = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
            body: JSON.stringify({ estado_esperado: st, trabajo_realizado: 'Test matriz', ejecucion: 'INTERNA' })
          });
          assert.strictEqual(res.status, matrizEsperada[st].finalizar, `Fallo finalizar en estado ${st}`);
        }

        // 2. resolver-ahora
        {
          const { body: inv } = await crearIntervencion({ detiene_maquina: false });
          if (st === 'EN_PROCESO' || st === 'EN_ESPERA_REPUESTOS') {
            await iniciarIntervencion(inv.id, resp1Token);
            if (st === 'EN_ESPERA_REPUESTOS') {
              await app.request(`/api/intervenciones/${inv.id}/espera-repuestos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
                body: JSON.stringify({ estado_esperado: 'EN_PROCESO', motivo: 'Espera test' })
              });
            }
          } else if (st === 'FINALIZADA') {
            await iniciarIntervencion(inv.id, resp1Token);
            await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
              body: JSON.stringify({ estado_esperado: 'EN_PROCESO', trabajo_realizado: 'ok', ejecucion: 'INTERNA' })
            });
          } else if (st === 'CANCELADA') {
            await app.request(`/api/intervenciones/${inv.id}/cancelar`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
              body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'Cancelada test' })
            });
          }

          const res = await app.request(`/api/intervenciones/${inv.id}/resolver-ahora`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
            body: JSON.stringify({
              estado_esperado: st,
              trabajo_realizado: 'Test matriz',
              ejecucion: 'INTERNA',
              fecha_inicio: new Date().toISOString()
            })
          });
          assert.strictEqual(res.status, matrizEsperada[st]['resolver-ahora'], `Fallo resolver-ahora en estado ${st}`);
        }

        // 3. cancelar
        {
          const { body: inv } = await crearIntervencion({ detiene_maquina: false });
          if (st === 'EN_PROCESO' || st === 'EN_ESPERA_REPUESTOS') {
            await iniciarIntervencion(inv.id, resp1Token);
            if (st === 'EN_ESPERA_REPUESTOS') {
              await app.request(`/api/intervenciones/${inv.id}/espera-repuestos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
                body: JSON.stringify({ estado_esperado: 'EN_PROCESO', motivo: 'Espera test' })
              });
            }
          } else if (st === 'FINALIZADA') {
            await iniciarIntervencion(inv.id, resp1Token);
            await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
              body: JSON.stringify({ estado_esperado: 'EN_PROCESO', trabajo_realizado: 'ok', ejecucion: 'INTERNA' })
            });
          } else if (st === 'CANCELADA') {
            await app.request(`/api/intervenciones/${inv.id}/cancelar`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
              body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'Cancelada test' })
            });
          }

          const res = await app.request(`/api/intervenciones/${inv.id}/cancelar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
            body: JSON.stringify({ estado_esperado: st, motivo: 'Cancelacion para test de matriz' })
          });
          assert.strictEqual(res.status, matrizEsperada[st].cancelar, `Fallo cancelar en estado ${st}`);
        }

        // 4. registrar-detencion
        {
          const { body: inv } = await crearIntervencion({ detiene_maquina: false });
          if (st === 'EN_PROCESO' || st === 'EN_ESPERA_REPUESTOS') {
            await iniciarIntervencion(inv.id, resp1Token);
            if (st === 'EN_ESPERA_REPUESTOS') {
              await app.request(`/api/intervenciones/${inv.id}/espera-repuestos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
                body: JSON.stringify({ estado_esperado: 'EN_PROCESO', motivo: 'Espera test' })
              });
            }
          } else if (st === 'FINALIZADA') {
            await iniciarIntervencion(inv.id, resp1Token);
            await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
              body: JSON.stringify({ estado_esperado: 'EN_PROCESO', trabajo_realizado: 'ok', ejecucion: 'INTERNA' })
            });
          } else if (st === 'CANCELADA') {
            await app.request(`/api/intervenciones/${inv.id}/cancelar`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
              body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'Cancelada test' })
            });
          }

          const res = await app.request(`/api/intervenciones/${inv.id}/registrar-detencion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
            body: JSON.stringify({ estado_esperado: st, desde: new Date().toISOString(), observacion: 'Detencion matriz test' })
          });
          assert.strictEqual(res.status, matrizEsperada[st]['registrar-detencion'], `Fallo registrar-detencion en estado ${st}`);
        }
      }
    });

    await t.test('B-37: Trigger temporal que falla al cerrar el período durante finalizar con recuperación', async () => {
      const mId = await crearMaquina();
      const { body: inv } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      await iniciarIntervencion(inv.id, resp1Token);

      // Crear trigger temporal que aborta el UPDATE de intervencion_periodos_detencion
      await client.query(`
        CREATE OR REPLACE FUNCTION fail_update_periodo_test() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'Fallo forzado para prueba atomica B-37';
        END;
        $$ LANGUAGE plpgsql;
      `);

      await client.query(`
        CREATE TRIGGER trg_test_fail_periodo
        BEFORE UPDATE ON intervencion_periodos_detencion
        FOR EACH ROW EXECUTE FUNCTION fail_update_periodo_test();
      `);

      try {
        const res = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({
            estado_esperado: 'EN_PROCESO',
            trabajo_realizado: 'Trabajo con fallo forzado',
            ejecucion: 'INTERNA',
            maquina_recuperada: true
          })
        });

        assert.strictEqual(res.status, 500);

        // Verificar atomicidad en DB:
        // Intervencion sigue EN_PROCESO
        const iRow = (await client.query('SELECT estado, tiempo_inactividad_minutos FROM intervenciones WHERE id = $1', [inv.id])).rows[0];
        assert.strictEqual(iRow.estado, 'EN_PROCESO');
        assert.strictEqual(iRow.tiempo_inactividad_minutos, null);

        // Sin fila nueva de historial a FINALIZADA
        const hRows = await client.query(
          "SELECT * FROM historial_estados_intervencion WHERE intervencion_id = $1 AND estado_nuevo = 'FINALIZADA'",
          [inv.id]
        );
        assert.strictEqual(hRows.rows.length, 0);

        // Período sigue abierto
        const pRows = await client.query(
          'SELECT * FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL',
          [inv.id]
        );
        assert.strictEqual(pRows.rows.length, 1);

        // Máquina sin cambios (sigue EN_MANTENIMIENTO)
        const mRow = (await client.query('SELECT estado FROM maquinas WHERE id = $1', [mId])).rows[0];
        assert.strictEqual(mRow.estado, 'EN_MANTENIMIENTO');
      } finally {
        await client.query('DROP TRIGGER IF EXISTS trg_test_fail_periodo ON intervencion_periodos_detencion');
        await client.query('DROP FUNCTION IF EXISTS fail_update_periodo_test()');
      }
    });

    await t.test('B-38b: GET /api/intervenciones/:id devuelve trabajo_realizado y observacion_confirmacion', async () => {
      const mId = await crearMaquina();
      const { body: inv } = await crearIntervencion({ maquina_id: mId, detiene_maquina: true });
      await iniciarIntervencion(inv.id, resp1Token);

      const rFin = await app.request(`/api/intervenciones/${inv.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Reparación de motor y calibrado de rodamientos',
          ejecucion: 'INTERNA',
          maquina_recuperada: true,
          observacion_recuperacion: 'Máquina recuperada y probada a plena carga'
        })
      });
      assert.strictEqual(rFin.status, 200);

      const resGet = await app.request(`/api/intervenciones/${inv.id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${resp1Token}` }
      });
      assert.strictEqual(resGet.status, 200);
      const data = await resGet.json();

      assert.strictEqual(data.trabajo_realizado, 'Reparación de motor y calibrado de rodamientos');
      assert.ok(Array.isArray(data.periodos_detencion));
      assert.strictEqual(data.periodos_detencion.length, 1);
      assert.strictEqual(data.periodos_detencion[0].observacion_confirmacion, 'Máquina recuperada y probada a plena carga');
    });

    await t.test('B-39: Responsable desactivado a mitad del trabajo permite a usuario con ASIGNAR continuar y cerrar, pero bloquea iniciar nueva', async () => {
      // 1. Crear usuario responsable dedicado para B-39
      const legajoB39 = 'R_B39_' + Date.now();
      const resB39 = await client.query(
        `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id, activo)
         VALUES ($1, 'Resp B39 Test', $2, $3, true) RETURNING id`,
        [legajoB39, hash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
      );
      const userB39Id = Number(resB39.rows[0].id);
      createdUsuarioIds.push(userB39Id);

      await client.query(
        'INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)',
        [userB39Id, sector1Id]
      );

      const loginB39 = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legajo: legajoB39, password: 'pass123' })
      });
      const userB39Token = (await loginB39.json()).token;

      // 2. Intervención 1: el responsable la inicia
      const { body: inv1 } = await crearIntervencion({ detiene_maquina: false });
      const rIni = await app.request(`/api/intervenciones/${inv1.id}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userB39Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(rIni.status, 200);

      const checkIni = await client.query('SELECT estado, responsable_usuario_id FROM intervenciones WHERE id = $1', [inv1.id]);
      assert.strictEqual(checkIni.rows[0].estado, 'EN_PROCESO');
      assert.strictEqual(Number(checkIni.rows[0].responsable_usuario_id), userB39Id);

      // 3. Desactivar al responsable por SQL
      await client.query('UPDATE usuarios SET activo = false WHERE id = $1', [userB39Id]);

      // 4. Usuario con INTERVENCIONES_ASIGNAR (adminToken) la pasa a espera -> 200 y responsable intacto
      const rEspera = await app.request(`/api/intervenciones/${inv1.id}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', observacion: 'Esperando repuestos especiales' })
      });
      assert.strictEqual(rEspera.status, 200);

      const checkEsp = await client.query('SELECT estado, responsable_usuario_id FROM intervenciones WHERE id = $1', [inv1.id]);
      assert.strictEqual(checkEsp.rows[0].estado, 'EN_ESPERA_REPUESTOS');
      assert.strictEqual(Number(checkEsp.rows[0].responsable_usuario_id), userB39Id);

      // 5. Usuario con INTERVENCIONES_ASIGNAR la reanuda -> 200 y responsable intacto
      const rReanudar = await app.request(`/api/intervenciones/${inv1.id}/reanudar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'EN_ESPERA_REPUESTOS' })
      });
      assert.strictEqual(rReanudar.status, 200);

      const checkRean = await client.query('SELECT estado, responsable_usuario_id FROM intervenciones WHERE id = $1', [inv1.id]);
      assert.strictEqual(checkRean.rows[0].estado, 'EN_PROCESO');
      assert.strictEqual(Number(checkRean.rows[0].responsable_usuario_id), userB39Id);

      // 6. Usuario con INTERVENCIONES_ASIGNAR la finaliza -> 200 y responsable intacto
      const rFin = await app.request(`/api/intervenciones/${inv1.id}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Finalizado por supervisor ante baja de responsable',
          ejecucion: 'INTERNA'
        })
      });
      assert.strictEqual(rFin.status, 200);

      const checkFin = await client.query('SELECT estado, responsable_usuario_id FROM intervenciones WHERE id = $1', [inv1.id]);
      assert.strictEqual(checkFin.rows[0].estado, 'FINALIZADA');
      assert.strictEqual(Number(checkFin.rows[0].responsable_usuario_id), userB39Id);

      // 7. Y el mismo responsable desactivado en una PENDIENTE asignada: iniciar → 422 RESPONSABLE_NO_HABILITADO
      const { body: inv2 } = await crearIntervencion({ detiene_maquina: false });
      await client.query('UPDATE intervenciones SET responsable_usuario_id = $1 WHERE id = $2', [userB39Id, inv2.id]);

      const rIniBloqueado = await app.request(`/api/intervenciones/${inv2.id}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(rIniBloqueado.status, 422);
      const dataBloqueado = await rIniBloqueado.json();
      assert.strictEqual(dataBloqueado.codigo, 'RESPONSABLE_NO_HABILITADO');
    });

    await t.test('B-40: resolver-ahora sin estado_esperado -> 422 DATOS_INVALIDOS y la intervención sigue PENDIENTE', async () => {
      const { body: inv } = await crearIntervencion({ detiene_maquina: false });

      const resSinEstado = await app.request(`/api/intervenciones/${inv.id}/resolver-ahora`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          trabajo_realizado: 'Se arregló sin estado esperado',
          ejecucion: 'INTERNA',
        }),
      });

      assert.strictEqual(resSinEstado.status, 422);
      const dataError = await resSinEstado.json();
      assert.strictEqual(dataError.codigo, 'DATOS_INVALIDOS');

      const checkDb = await client.query('SELECT estado FROM intervenciones WHERE id = $1', [inv.id]);
      assert.strictEqual(checkDb.rows[0].estado, 'PENDIENTE');
    });

  } finally {
    // Limpieza general
    try {
      await limpiarIntervenciones(createdIntervencionIds);
      for (const mId of createdMaquinaIds) {
        await limpiarMaquina(mId);
      }
      if (createdUsuarioIds.length > 0) {
        await client.query('DELETE FROM usuario_sector WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUsuarioIds]);
      }
    } catch (e) {
      console.error('Error durante la limpieza final de tests 4B:', e);
    }
    client.release();
  }
});
