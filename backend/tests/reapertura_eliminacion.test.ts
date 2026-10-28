import { test } from 'node:test';
import assert from 'node:assert';
import { pool } from '../functions/db.ts';
import app from '../functions/api.ts';

// Configurar timeout de bloqueo para pruebas de concurrencia
process.env.LOCK_TIMEOUT = '3s';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (REAPERTURA Y ELIMINACION TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Etapa 6 — Reapertura de intervenciones, eliminación lógica y edición de intervenciones abiertas', async (t) => {
  const client = await pool.connect();
  const createdIntervencionIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];
  const createdSectorIds: number[] = [];

  const limpiarIntervenciones = async (ids: number[]) => {
    if (!ids || ids.length === 0) return;
    await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE intervencion_id = ANY($1))', [ids]);
    await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervencion_costos WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM documentos WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM intervencion_repuestos WHERE intervencion_id = ANY($1)', [ids]);
    await client.query('DELETE FROM movimientos_stock WHERE intervencion_id = ANY($1)', [ids]);
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

  let operario1Token = '';
  let operario1Id = 0;

  let operario2Token = '';
  let operario2Id = 0;

  let userSinConfirmarToken = '';
  let userSinConfirmarId = 0;

  let userSinEditarToken = '';
  let userSinEditarId = 0;

  let userSectoresToken = '';
  let userSectoresId = 0;

  let sector1Id = 0;
  let sector2Id = 0;
  let maquina1Id = 0;
  let maquina2Id = 0;

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

    // 3. Crear Resp1 (Responsable de mantenimiento con todos los permisos)
    const legajoR1 = 'R1_E6_' + Date.now();
    const resR1 = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'Resp Uno Etapa6', $2, $3) RETURNING id`,
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

    // 4. Crear Resp2
    const legajoR2 = 'R2_E6_' + Date.now();
    const resR2 = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'Resp Dos Etapa6', $2, $3) RETURNING id`,
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

    // 5. Crear Operario 1
    const legajoOp1 = 'OP1_E6_' + Date.now();
    const resOp1 = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'Operario Uno Etapa6', $2, $3) RETURNING id`,
      [legajoOp1, hash, perfilMap['OPERARIO']]
    );
    operario1Id = Number(resOp1.rows[0].id);
    createdUsuarioIds.push(operario1Id);
    const loginOp1 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoOp1, password: 'pass123' })
    });
    operario1Token = (await loginOp1.json()).token;

    // 6. Crear Operario 2
    const legajoOp2 = 'OP2_E6_' + Date.now();
    const resOp2 = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'Operario Dos Etapa6', $2, $3) RETURNING id`,
      [legajoOp2, hash, perfilMap['OPERARIO']]
    );
    operario2Id = Number(resOp2.rows[0].id);
    createdUsuarioIds.push(operario2Id);
    const loginOp2 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoOp2, password: 'pass123' })
    });
    operario2Token = (await loginOp2.json()).token;

    // 7. Crear Usuario sin confirmar recuperación (DENEGAR INTERVENCIONES_CONFIRMAR_RECUPERACION)
    const legajoSinConf = 'SINCONF_E6_' + Date.now();
    const resSinConf = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'User Sin Confirmar', $2, $3) RETURNING id`,
      [legajoSinConf, hash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    userSinConfirmarId = Number(resSinConf.rows[0].id);
    createdUsuarioIds.push(userSinConfirmarId);

    const resPermConf = await client.query("SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_CONFIRMAR_RECUPERACION'");
    const permConfId = resPermConf.rows[0].id;
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'DENEGAR', 'Excepcion de prueba', $3)`,
      [userSinConfirmarId, permConfId, adminId]
    );
    const loginSinConf = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoSinConf, password: 'pass123' })
    });
    userSinConfirmarToken = (await loginSinConf.json()).token;

    // 8. Crear Usuario sin editar (OPERARIO con DENEGAR INTERVENCIONES_EDITAR)
    const legajoSinEd = 'SINED_E6_' + Date.now();
    const resSinEd = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'User Sin Editar', $2, $3) RETURNING id`,
      [legajoSinEd, hash, perfilMap['OPERARIO']]
    );
    userSinEditarId = Number(resSinEd.rows[0].id);
    createdUsuarioIds.push(userSinEditarId);

    const resPermEd = await client.query("SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_EDITAR'");
    const permEdId = resPermEd.rows[0].id;
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'DENEGAR', 'Excepcion denegar edicion', $3)`,
      [userSinEditarId, permEdId, adminId]
    );
    const loginSinEd = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoSinEd, password: 'pass123' })
    });
    userSinEditarToken = (await loginSinEd.json()).token;

    // 9. Sectores y máquinas
    const resSec1 = await client.query("INSERT INTO sectores (nombre) VALUES ('Sector E6 Uno') RETURNING id");
    sector1Id = Number(resSec1.rows[0].id);
    createdSectorIds.push(sector1Id);

    const resSec2 = await client.query("INSERT INTO sectores (nombre) VALUES ('Sector E6 Dos') RETURNING id");
    sector2Id = Number(resSec2.rows[0].id);
    createdSectorIds.push(sector2Id);

    const resM1 = await client.query(
      "INSERT INTO maquinas (codigo, nombre, sector_id, estado) VALUES ($1, 'Maquina E6-1', $2, 'OPERATIVA') RETURNING id",
      ['MQ_E6_1_' + Date.now(), sector1Id]
    );
    maquina1Id = Number(resM1.rows[0].id);
    createdMaquinaIds.push(maquina1Id);

    const resM2 = await client.query(
      "INSERT INTO maquinas (codigo, nombre, sector_id, estado) VALUES ($1, 'Maquina E6-2', $2, 'OPERATIVA') RETURNING id",
      ['MQ_E6_2_' + Date.now(), sector2Id]
    );
    maquina2Id = Number(resM2.rows[0].id);
    createdMaquinaIds.push(maquina2Id);

    // 10. Crear Usuario con alcance SECTORES para VER y ELIMINAR asignado solo a Sector 1
    const legajoSect = 'SECT_E6_' + Date.now();
    const resSect = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'User Sectores Etapa6', $2, $3) RETURNING id`,
      [legajoSect, hash, perfilMap['OPERARIO']]
    );
    userSectoresId = Number(resSect.rows[0].id);
    createdUsuarioIds.push(userSectoresId);

    const resPermVer = await client.query("SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_VER'");
    const permVerId = resPermVer.rows[0].id;
    const resPermElim = await client.query("SELECT id FROM permisos WHERE codigo = 'INTERVENCIONES_ELIMINAR'");
    const permElimId = resPermElim.rows[0].id;

    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Ver solo su sector', $3)`,
      [userSectoresId, permVerId, adminId]
    );
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Eliminar solo su sector', $3)`,
      [userSectoresId, permElimId, adminId]
    );
    await client.query(
      `INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)`,
      [userSectoresId, sector1Id]
    );

    const loginSect = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoSect, password: 'pass123' })
    });
    userSectoresToken = (await loginSect.json()).token;

    // =========================================================================
    // 9.1 REABRIR
    // =========================================================================

    // R-01: FINALIZADA sin períodos; reabrir con maquina_detenida = false
    await t.test('R-01: FINALIZADA sin períodos; reabrir con maquina_detenida = false', async () => {
      // Setup: Crear y finalizar sin períodos
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion R-01 sin detencion' })
      });
      const dCrear = await resCrear.json();
      const intId = dCrear.id;
      createdIntervencionIds.push(intId);

      // Resolver ahora
      const resRes = await app.request(`/api/intervenciones/${intId}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          fecha_inicio: new Date().toISOString(),
          trabajo_realizado: 'Trabajo inicial R-01',
          ejecucion: 'INTERNA',
        })
      });
      assert.strictEqual(resRes.status, 200);
      const dRes = await resRes.json();
      const fechaFinAnterior = dRes.intervencion.fecha_finalizacion;
      assert.ok(fechaFinAnterior);

      // Reabrir
      const resReabrir = await app.request(`/api/intervenciones/${intId}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'FINALIZADA',
          motivo: 'Reapertura para pruebas R-01',
          maquina_detenida: false,
        })
      });
      assert.strictEqual(resReabrir.status, 200);
      const dReabrir = await resReabrir.json();
      assert.strictEqual(dReabrir.intervencion.estado, 'EN_PROCESO');
      assert.strictEqual(dReabrir.intervencion.fecha_finalizacion, null);
      assert.strictEqual(dReabrir.intervencion.trabajo_realizado, 'Trabajo inicial R-01');
      assert.strictEqual(dReabrir.intervencion.ejecucion, 'INTERNA');
      assert.ok(dReabrir.intervencion.fecha_inicio);
      assert.strictEqual(dReabrir.intervencion.responsable.id, resp1Id);

      // Verificar DB
      const resDB = await client.query('SELECT fecha_finalizacion, estado, trabajo_realizado, ejecucion FROM intervenciones WHERE id = $1', [intId]);
      assert.strictEqual(resDB.rows[0].estado, 'EN_PROCESO');
      assert.strictEqual(resDB.rows[0].fecha_finalizacion, null);
      assert.strictEqual(resDB.rows[0].trabajo_realizado, 'Trabajo inicial R-01');
      assert.strictEqual(resDB.rows[0].ejecucion, 'INTERNA');

      // Historial
      const resHist = await client.query(
        'SELECT estado_anterior, estado_nuevo, observacion FROM historial_estados_intervencion WHERE intervencion_id = $1 ORDER BY id DESC LIMIT 1',
        [intId]
      );
      assert.strictEqual(resHist.rows[0].estado_anterior, 'FINALIZADA');
      assert.strictEqual(resHist.rows[0].estado_nuevo, 'EN_PROCESO');
      assert.strictEqual(resHist.rows[0].observacion, 'Reapertura para pruebas R-01');

      // Auditoría REAPERTURA
      const resAud = await client.query(
        "SELECT tipo_evento, campo_modificado, valor_anterior, valor_nuevo, motivo FROM intervencion_auditoria WHERE intervencion_id = $1 AND tipo_evento = 'REAPERTURA'",
        [intId]
      );
      assert.strictEqual(resAud.rows.length, 1);
      assert.strictEqual(resAud.rows[0].campo_modificado, 'fecha_finalizacion');
      assert.strictEqual(new Date(resAud.rows[0].valor_anterior).toISOString(), new Date(fechaFinAnterior).toISOString());
      assert.strictEqual(resAud.rows[0].valor_nuevo, null);
      assert.strictEqual(resAud.rows[0].motivo, 'Reapertura para pruebas R-01');

      // Máquina sin cambios
      const resMq = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquina1Id]);
      assert.strictEqual(resMq.rows[0].estado, 'OPERATIVA');
    });

    // R-02: Sin motivo / menos de 5
    await t.test('R-02: Sin motivo / menos de 5', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion R-02' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          fecha_inicio: new Date().toISOString(),
          trabajo_realizado: 'Trabajo R-02',
          ejecucion: 'INTERNA',
        })
      });

      const resSinMotivo = await app.request(`/api/intervenciones/${intId}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'FINALIZADA', motivo: '1234', maquina_detenida: false })
      });
      assert.strictEqual(resSinMotivo.status, 422);
      const dError = await resSinMotivo.json();
      assert.strictEqual(dError.codigo, 'MOTIVO_REQUERIDO');
    });

    // R-03: Usuario sin REABRIR
    await t.test('R-03: Usuario sin REABRIR', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion R-03' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          fecha_inicio: new Date().toISOString(),
          trabajo_realizado: 'Trabajo R-03',
          ejecucion: 'INTERNA',
        })
      });

      const resReabrirOp = await app.request(`/api/intervenciones/${intId}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operario1Token}` },
        body: JSON.stringify({ estado_esperado: 'FINALIZADA', motivo: 'Intento de operario', maquina_detenida: false })
      });
      assert.strictEqual(resReabrirOp.status, 403);
    });

    // R-04: Reabrir desde PENDIENTE, EN_PROCESO, EN_ESPERA_REPUESTOS, CANCELADA
    await t.test('R-04: Reabrir desde PENDIENTE, EN_PROCESO, EN_ESPERA_REPUESTOS, CANCELADA', async () => {
      // 1. PENDIENTE
      const resP = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion R-04 PEND' })
      });
      const idP = (await resP.json()).id;
      createdIntervencionIds.push(idP);

      const resReabrirP = await app.request(`/api/intervenciones/${idP}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'Reabrir PENDIENTE', maquina_detenida: false })
      });
      assert.strictEqual(resReabrirP.status, 409);
      assert.strictEqual((await resReabrirP.json()).codigo, 'TRANSICION_NO_PERMITIDA');

      // 2. EN_PROCESO
      await app.request(`/api/intervenciones/${idP}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      const resReabrirEP = await app.request(`/api/intervenciones/${idP}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', motivo: 'Reabrir EN_PROCESO', maquina_detenida: false })
      });
      assert.strictEqual(resReabrirEP.status, 409);
      assert.strictEqual((await resReabrirEP.json()).codigo, 'TRANSICION_NO_PERMITIDA');

      // 3. EN_ESPERA_REPUESTOS
      await app.request(`/api/intervenciones/${idP}/espera-repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', observacion: 'Esperando repuestos' })
      });
      const resReabrirER = await app.request(`/api/intervenciones/${idP}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_ESPERA_REPUESTOS', motivo: 'Reabrir EN_ESPERA', maquina_detenida: false })
      });
      assert.strictEqual(resReabrirER.status, 409);
      assert.strictEqual((await resReabrirER.json()).codigo, 'TRANSICION_NO_PERMITIDA');

      // 4. CANCELADA
      await app.request(`/api/intervenciones/${idP}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_ESPERA_REPUESTOS', motivo: 'Cancelar intervencion' })
      });
      const resReabrirC = await app.request(`/api/intervenciones/${idP}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'CANCELADA', motivo: 'Reabrir CANCELADA', maquina_detenida: false })
      });
      assert.strictEqual(resReabrirC.status, 409);
      assert.strictEqual((await resReabrirC.json()).codigo, 'TRANSICION_NO_PERMITIDA');
    });

    // R-05: FINALIZADA con período todavía abierto (E7)
    await t.test('R-05: FINALIZADA con período todavía abierto (E7)', async () => {
      // Setup: Intervención que detuvo la máquina, finalizada sin recuperar máquina (período sigue abierto)
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion R-05' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      // Detener máquina
      await app.request(`/api/intervenciones/${intId}/registrar-detencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'EN_PROCESO', observacion: 'Detencion R-05' })
      });

      const resPeriodo = await client.query('SELECT id, desde FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL', [intId]);
      assert.strictEqual(resPeriodo.rows.length, 1);
      const periodoId = Number(resPeriodo.rows[0].id);
      const periodoDesde = resPeriodo.rows[0].desde;

      // Finalizar con maquina_recuperada = false
      await app.request(`/api/intervenciones/${intId}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Trabajo parcial R-05',
          ejecucion: 'INTERNA',
          maquina_recuperada: false,
          observacion_recuperacion: 'Sigue rota',
        })
      });

      // Máquina debe estar DETENIDA
      const resMqAntes = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquina1Id]);
      assert.strictEqual(resMqAntes.rows[0].estado, 'DETENIDA');

      // Reabrir (maquina_detenida es ignorado porque ya hay período abierto)
      const resReabrir = await app.request(`/api/intervenciones/${intId}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'FINALIZADA',
          motivo: 'Reapertura caso R-05 con periodo abierto',
          maquina_detenida: false,
        })
      });
      assert.strictEqual(resReabrir.status, 200);

      // Mismo período sigue abierto
      const resPeriodoDesp = await client.query('SELECT id, desde, hasta FROM intervencion_periodos_detencion WHERE intervencion_id = $1', [intId]);
      assert.strictEqual(resPeriodoDesp.rows.length, 1);
      assert.strictEqual(Number(resPeriodoDesp.rows[0].id), periodoId);
      assert.strictEqual(resPeriodoDesp.rows[0].hasta, null);
      assert.strictEqual(new Date(resPeriodoDesp.rows[0].desde).toISOString(), new Date(periodoDesde).toISOString());

      // Máquina pasa de DETENIDA a EN_MANTENIMIENTO
      const resMqDesp = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquina1Id]);
      assert.strictEqual(resMqDesp.rows[0].estado, 'EN_MANTENIMIENTO');

      // Limpiar finalizando con recuperación para restaurar máquina
      await app.request(`/api/intervenciones/${intId}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Trabajo cierre R-05',
          ejecucion: 'INTERNA',
          maquina_recuperada: true,
        })
      });
    });

    // R-06: Ejemplo 4 completo
    await t.test('R-06: Ejemplo 4 completo (08:00 a 12:00, reabre 15:00 a 17:00, inactividad = 360)', async () => {
      const T08 = '2026-03-01T08:00:00.000Z';
      const T12 = '2026-03-01T12:00:00.000Z';
      const T15 = '2026-03-01T15:00:00.000Z';
      const T17 = '2026-03-01T17:00:00.000Z';

      // 1. Crear intervención y setear período 1 a las 08:00
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion Ejemplo 4' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      // Iniciar en T08 y registrar detención en T08
      await client.query(
        "UPDATE intervenciones SET fecha_creacion = $1, estado = 'EN_PROCESO', fecha_inicio = $1, responsable_usuario_id = $2 WHERE id = $3",
        [T08, resp1Id, intId]
      );
      await client.query(
        "INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, abierto_por_usuario_id, observacion) VALUES ($1, $2, $3, $4, 'Parada 08:00')",
        [intId, maquina1Id, T08, resp1Id]
      );
      await client.query("UPDATE maquinas SET estado = 'DETENIDA' WHERE id = $1", [maquina1Id]);

      // 2. Finalizar a las 12:00 con recuperación
      const resFin1 = await app.request(`/api/intervenciones/${intId}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Turno manana completado',
          ejecucion: 'INTERNA',
          fecha_finalizacion: T12,
          maquina_recuperada: true,
        })
      });
      assert.strictEqual(resFin1.status, 200);

      // Verificar máquina OPERATIVA
      const resMq1 = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquina1Id]);
      assert.strictEqual(resMq1.rows[0].estado, 'OPERATIVA');

      // 3. Reabrir a las 15:00 con maquina_detenida = true
      const resReabrir = await app.request(`/api/intervenciones/${intId}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'FINALIZADA',
          motivo: 'Falla reiterada a las 15:00',
          maquina_detenida: true,
          desde: T15,
          observacion_detencion: 'Nueva detencion en reapertura',
        })
      });
      assert.strictEqual(resReabrir.status, 200);

      // Verificar máquina EN_MANTENIMIENTO
      const resMq2 = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquina1Id]);
      assert.strictEqual(resMq2.rows[0].estado, 'EN_MANTENIMIENTO');

      // 4. Finalizar a las 17:00 con recuperación
      const resFin2 = await app.request(`/api/intervenciones/${intId}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Turno tarde completado',
          ejecucion: 'INTERNA',
          fecha_finalizacion: T17,
          maquina_recuperada: true,
        })
      });
      assert.strictEqual(resFin2.status, 200);

      // Verificar máquina OPERATIVA al final
      const resMq3 = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquina1Id]);
      assert.strictEqual(resMq3.rows[0].estado, 'OPERATIVA');

      // Verificar los dos períodos exactos
      const resPer = await client.query('SELECT id, desde, hasta FROM intervencion_periodos_detencion WHERE intervencion_id = $1 ORDER BY desde ASC', [intId]);
      assert.strictEqual(resPer.rows.length, 2);
      assert.strictEqual(new Date(resPer.rows[0].desde).toISOString(), T08);
      assert.strictEqual(new Date(resPer.rows[0].hasta).toISOString(), T12);
      assert.strictEqual(new Date(resPer.rows[1].desde).toISOString(), T15);
      assert.strictEqual(new Date(resPer.rows[1].hasta).toISOString(), T17);

      // Verificar tiempo_inactividad_minutos = 360
      const resInt = await client.query('SELECT tiempo_inactividad_minutos FROM intervenciones WHERE id = $1', [intId]);
      assert.strictEqual(Number(resInt.rows[0].tiempo_inactividad_minutos), 360);
    });

    // R-07: Sin período abierto y sin maquina_detenida
    await t.test('R-07: Sin período abierto y sin maquina_detenida -> 422 DECISION_DETENCION_REQUERIDA', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion R-07' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          fecha_inicio: new Date().toISOString(),
          trabajo_realizado: 'Trabajo R-07',
          ejecucion: 'INTERNA',
        })
      });

      const resReabrir = await app.request(`/api/intervenciones/${intId}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'FINALIZADA',
          motivo: 'Reapertura sin decision detencion',
        })
      });
      assert.strictEqual(resReabrir.status, 422);
      assert.strictEqual((await resReabrir.json()).codigo, 'DECISION_DETENCION_REQUERIDA');

      // DB sin cambios
      const resDB = await client.query('SELECT estado FROM intervenciones WHERE id = $1', [intId]);
      assert.strictEqual(resDB.rows[0].estado, 'FINALIZADA');
    });

    // R-08: desde anterior al hasta del último período; desde futura
    await t.test('R-08: desde anterior al hasta del último período; desde futura -> 422 FECHA_INCOHERENTE', async () => {
      const T08 = '2026-03-01T08:00:00.000Z';
      const T12 = '2026-03-01T12:00:00.000Z';

      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion R-08' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      await client.query(
        "UPDATE intervenciones SET fecha_creacion = $1, estado = 'FINALIZADA', fecha_inicio = $1, fecha_finalizacion = $2, responsable_usuario_id = $3, trabajo_realizado = 'Trabajo R-08', ejecucion = 'INTERNA' WHERE id = $4",
        [T08, T12, resp1Id, intId]
      );
      await client.query(
        "INSERT INTO intervencion_periodos_detencion (intervencion_id, maquina_id, desde, hasta, abierto_por_usuario_id, confirmado_por_usuario_id) VALUES ($1, $2, $3, $4, $5, $5)",
        [intId, maquina1Id, T08, T12, resp1Id]
      );

      // Caso 1: desde anterior al hasta (11:00 vs 12:00)
      const resAnt = await app.request(`/api/intervenciones/${intId}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'FINALIZADA',
          motivo: 'Reabrir con fecha anterior',
          maquina_detenida: true,
          desde: '2026-03-01T11:00:00.000Z',
        })
      });
      assert.strictEqual(resAnt.status, 422);
      assert.strictEqual((await resAnt.json()).codigo, 'FECHA_INCOHERENTE');

      // Caso 2: desde futura
      const resFut = await app.request(`/api/intervenciones/${intId}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'FINALIZADA',
          motivo: 'Reabrir con fecha futura',
          maquina_detenida: true,
          desde: '2099-01-01T12:00:00.000Z',
        })
      });
      assert.strictEqual(resFut.status, 422);
      assert.strictEqual((await resFut.json()).codigo, 'FECHA_INCOHERENTE');
    });

    // R-09: Reabrir y volver a finalizar con otro trabajo_realizado y otra ejecucion
    await t.test('R-09: Reabrir y volver a finalizar con otro trabajo_realizado y ejecucion -> Auditoria OTRO', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion R-09' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      // Finalizar primero
      await app.request(`/api/intervenciones/${intId}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          fecha_inicio: new Date().toISOString(),
          trabajo_realizado: 'Trabajo Original R-09',
          ejecucion: 'INTERNA',
        })
      });

      // Reabrir
      await app.request(`/api/intervenciones/${intId}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'FINALIZADA',
          motivo: 'Reapertura para corregir informe',
          maquina_detenida: false,
        })
      });

      // Volver a finalizar con otros datos
      const resFin2 = await app.request(`/api/intervenciones/${intId}/finalizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          trabajo_realizado: 'Trabajo Corregido y Aumentado R-09',
          ejecucion: 'EXTERNA',
        })
      });
      assert.strictEqual(resFin2.status, 200);

      // Verificar dos filas OTRO en auditoría
      const resAud = await client.query(
        "SELECT campo_modificado, valor_anterior, valor_nuevo FROM intervencion_auditoria WHERE intervencion_id = $1 AND tipo_evento = 'OTRO' ORDER BY id ASC",
        [intId]
      );
      assert.strictEqual(resAud.rows.length, 2);

      const audTrabajo = resAud.rows.find(r => r.campo_modificado === 'trabajo_realizado');
      assert.ok(audTrabajo);
      assert.strictEqual(audTrabajo.valor_anterior, 'Trabajo Original R-09');
      assert.strictEqual(audTrabajo.valor_nuevo, 'Trabajo Corregido y Aumentado R-09');

      const audEjec = resAud.rows.find(r => r.campo_modificado === 'ejecucion');
      assert.ok(audEjec);
      assert.strictEqual(audEjec.valor_anterior, 'INTERNA');
      assert.strictEqual(audEjec.valor_nuevo, 'EXTERNA');
    });

    // R-10: Máquina FUERA_DE_SERVICIO; reabrir con maquina_detenida = true
    await t.test('R-10: Máquina FUERA_DE_SERVICIO; reabrir con maquina_detenida = true', async () => {
      // Poner máquina 2 en FUERA_DE_SERVICIO manualmente
      await client.query("UPDATE maquinas SET estado = 'FUERA_DE_SERVICIO' WHERE id = $1", [maquina2Id]);

      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina2Id, descripcion: 'Intervencion R-10' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          fecha_inicio: new Date().toISOString(),
          trabajo_realizado: 'Trabajo R-10',
          ejecucion: 'INTERNA',
        })
      });

      // Reabrir con detención
      const resReabrir = await app.request(`/api/intervenciones/${intId}/reabrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'FINALIZADA',
          motivo: 'Reapertura R-10 maquina FDS',
          maquina_detenida: true,
        })
      });
      assert.strictEqual(resReabrir.status, 200);

      // Período abierto registrado
      const resPer = await client.query('SELECT id, hasta FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL', [intId]);
      assert.strictEqual(resPer.rows.length, 1);

      // Máquina debe seguir FUERA_DE_SERVICIO
      const resMq = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquina2Id]);
      assert.strictEqual(resMq.rows[0].estado, 'FUERA_DE_SERVICIO');

      // Restaurar máquina a OPERATIVA
      await client.query("UPDATE maquinas SET estado = 'OPERATIVA' WHERE id = $1", [maquina2Id]);
    });

    // R-11: Dos reabrir simultáneos
    await t.test('R-11: Dos reabrir simultáneos -> Un 200 y un 409 ESTADO_DESACTUALIZADO', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion R-11' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          fecha_inicio: new Date().toISOString(),
          trabajo_realizado: 'Trabajo R-11',
          ejecucion: 'INTERNA',
        })
      });

      const bodyReabrir = JSON.stringify({
        estado_esperado: 'FINALIZADA',
        motivo: 'Reabrir carrera R-11',
        maquina_detenida: false,
      });

      const [res1, res2] = await Promise.all([
        app.request(`/api/intervenciones/${intId}/reabrir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: bodyReabrir,
        }),
        app.request(`/api/intervenciones/${intId}/reabrir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp2Token}` },
          body: bodyReabrir,
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(statuses, [200, 409]);

      // Solo una fila nueva de historial
      const resHist = await client.query(
        "SELECT COUNT(*) AS total FROM historial_estados_intervencion WHERE intervencion_id = $1 AND estado_anterior = 'FINALIZADA' AND estado_nuevo = 'EN_PROCESO'",
        [intId]
      );
      assert.strictEqual(Number(resHist.rows[0].total), 1);
    });

    // =========================================================================
    // 9.2 ELIMINACIÓN LÓGICA
    // =========================================================================

    // E-01: PENDIENTE sin actividad ni detención (con responsable asignado)
    await t.test('E-01: PENDIENTE sin actividad ni detención (con responsable asignado)', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion E-01' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      // Asignar responsable (sigue siendo PENDIENTE sin actividad operativa)
      await app.request(`/api/intervenciones/${intId}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ usuario_id: resp1Id, estado_esperado: 'PENDIENTE' })
      });

      const resHistAntes = await client.query('SELECT COUNT(*) AS total FROM historial_estados_intervencion WHERE intervencion_id = $1', [intId]);
      const histTotalAntes = Number(resHistAntes.rows[0].total);

      // Eliminar
      const resElim = await app.request(`/api/intervenciones/${intId}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: 'Eliminacion logica de prueba E-01' })
      });
      assert.strictEqual(resElim.status, 200);

      // Campos de eliminación en DB
      const resDB = await client.query('SELECT estado, eliminado_en, eliminado_por_usuario_id, motivo_eliminacion FROM intervenciones WHERE id = $1', [intId]);
      assert.strictEqual(resDB.rows[0].estado, 'PENDIENTE');
      assert.ok(resDB.rows[0].eliminado_en);
      assert.strictEqual(Number(resDB.rows[0].eliminado_por_usuario_id), resp1Id);
      assert.strictEqual(resDB.rows[0].motivo_eliminacion, 'Eliminacion logica de prueba E-01');

      // Auditoría ELIMINACION_LOGICA
      const resAud = await client.query("SELECT tipo_evento, motivo FROM intervencion_auditoria WHERE intervencion_id = $1 AND tipo_evento = 'ELIMINACION_LOGICA'", [intId]);
      assert.strictEqual(resAud.rows.length, 1);
      assert.strictEqual(resAud.rows[0].motivo, 'Eliminacion logica de prueba E-01');

      // No aparece en GET /
      const resList = await app.request('/api/intervenciones', {
        headers: { Authorization: `Bearer ${resp1Token}` }
      });
      const itemsList = await resList.json();
      assert.strictEqual(itemsList.some((i: any) => i.id === intId), false);

      // GET /:id da 404
      const resDetalle = await app.request(`/api/intervenciones/${intId}`, {
        headers: { Authorization: `Bearer ${resp1Token}` }
      });
      assert.strictEqual(resDetalle.status, 404);

      // Ninguna fila nueva en historial_estados_intervencion
      const resHistDesp = await client.query('SELECT COUNT(*) AS total FROM historial_estados_intervencion WHERE intervencion_id = $1', [intId]);
      assert.strictEqual(Number(resHistDesp.rows[0].total), histTotalAntes);
    });

    // E-02: Con período abierto, maquina_recuperada = true, sin otras causas
    await t.test('E-02: Con período abierto, maquina_recuperada = true, sin otras causas', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion E-02 detencion' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      // Abrir detención
      await app.request(`/api/intervenciones/${intId}/registrar-detencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', observacion: 'Detencion E-02' })
      });

      const resMqAntes = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquina1Id]);
      assert.strictEqual(resMqAntes.rows[0].estado, 'DETENIDA');

      // Eliminar con recuperación
      const resElim = await app.request(`/api/intervenciones/${intId}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          motivo: 'Eliminar intervencion con periodo abierto',
          maquina_recuperada: true,
        })
      });
      assert.strictEqual(resElim.status, 200);

      // Período cerrado con confirmación
      const resPer = await client.query('SELECT hasta, confirmado_por_usuario_id, observacion_confirmacion FROM intervencion_periodos_detencion WHERE intervencion_id = $1', [intId]);
      assert.strictEqual(resPer.rows.length, 1);
      assert.ok(resPer.rows[0].hasta);
      assert.strictEqual(Number(resPer.rows[0].confirmado_por_usuario_id), resp1Id);
      assert.strictEqual(resPer.rows[0].observacion_confirmacion, 'Cerrado por eliminación lógica');

      // Máquina vuelve a OPERATIVA
      const resMqDesp = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquina1Id]);
      assert.strictEqual(resMqDesp.rows[0].estado, 'OPERATIVA');
    });

    // E-03: Igual, pero otra intervención también detiene la máquina
    await t.test('E-03: Con período abierto, maquina_recuperada = true, pero otra intervención detiene la máquina', async () => {
      // Crear int 1
      const res1 = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion 1 E-03' })
      });
      const id1 = (await res1.json()).id;
      createdIntervencionIds.push(id1);

      // Crear int 2
      const res2 = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion 2 E-03' })
      });
      const id2 = (await res2.json()).id;
      createdIntervencionIds.push(id2);

      // Registrar detención en ambas
      await app.request(`/api/intervenciones/${id1}/registrar-detencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', observacion: 'Detencion 1' })
      });
      await app.request(`/api/intervenciones/${id2}/registrar-detencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', observacion: 'Detencion 2' })
      });

      // Eliminar int 1 con maquina_recuperada = true
      const resElim1 = await app.request(`/api/intervenciones/${id1}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: 'Eliminar int 1', maquina_recuperada: true })
      });
      assert.strictEqual(resElim1.status, 200);

      // Período de int 1 cerrado
      const resPer1 = await client.query('SELECT hasta FROM intervencion_periodos_detencion WHERE intervencion_id = $1', [id1]);
      assert.ok(resPer1.rows[0].hasta);

      // Máquina sigue DETENIDA debido a int 2
      const resMq = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquina1Id]);
      assert.strictEqual(resMq.rows[0].estado, 'DETENIDA');

      // Limpiar int 2 eliminándola también para restaurar máquina
      await app.request(`/api/intervenciones/${id2}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: 'Eliminar int 2', maquina_recuperada: true })
      });
      const resMqRest = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquina1Id]);
      assert.strictEqual(resMqRest.rows[0].estado, 'OPERATIVA');
    });

    // E-04: Con período abierto, maquina_recuperada = false
    await t.test('E-04: Con período abierto, maquina_recuperada = false, luego REACTIVAR -> OPERATIVA', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion E-04' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/registrar-detencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', observacion: 'Detencion E-04' })
      });

      // Eliminar con maquina_recuperada = false
      const resElim = await app.request(`/api/intervenciones/${intId}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          motivo: 'Eliminar con maquina_recuperada = false',
          maquina_recuperada: false,
          observacion_recuperacion: 'La maquina sigue en falla',
        })
      });
      assert.strictEqual(resElim.status, 200);

      // Período cerrado
      const resPer = await client.query('SELECT hasta FROM intervencion_periodos_detencion WHERE intervencion_id = $1', [intId]);
      assert.ok(resPer.rows[0].hasta);

      // Máquina sigue DETENIDA
      const resMq = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquina1Id]);
      assert.strictEqual(resMq.rows[0].estado, 'DETENIDA');

      // Reactivar máquina (D-30)
      const resReact = await app.request(`/api/maquinas/${maquina1Id}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ accion: 'REACTIVAR', motivo: 'Reactivacion manual tras eliminacion' })
      });
      assert.strictEqual(resReact.status, 200);

      const resMqOperativa = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquina1Id]);
      assert.strictEqual(resMqOperativa.rows[0].estado, 'OPERATIVA');
    });

    // E-05: Con período abierto: sin decisión; con true y sin CONFIRMAR_RECUPERACION
    await t.test('E-05: Con período abierto: sin decisión -> 422; sin permiso confirmacion -> 403', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion E-05' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/registrar-detencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', observacion: 'Detencion E-05' })
      });

      // 1. Sin decisión
      const resSinDec = await app.request(`/api/intervenciones/${intId}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: 'Eliminar sin decision' })
      });
      assert.strictEqual(resSinDec.status, 422);
      assert.strictEqual((await resSinDec.json()).codigo, 'DECISION_RECUPERACION_REQUERIDA');

      // 2. Con maquina_recuperada = true por usuario sin CONFIRMAR_RECUPERACION
      const resSinPerm = await app.request(`/api/intervenciones/${intId}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userSinConfirmarToken}` },
        body: JSON.stringify({ motivo: 'Eliminar con true sin permiso', maquina_recuperada: true })
      });
      assert.strictEqual(resSinPerm.status, 403);
      assert.strictEqual((await resSinPerm.json()).codigo, 'CONFIRMACION_NO_PERMITIDA');

      // Nada cambia: no eliminada, período abierto
      const resDB = await client.query('SELECT eliminado_en FROM intervenciones WHERE id = $1', [intId]);
      assert.strictEqual(resDB.rows[0].eliminado_en, null);
      const resPer = await client.query('SELECT hasta FROM intervencion_periodos_detencion WHERE intervencion_id = $1', [intId]);
      assert.strictEqual(resPer.rows[0].hasta, null);

      // Limpiar eliminando con resp1
      await app.request(`/api/intervenciones/${intId}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: 'Eliminar limpieza E-05', maquina_recuperada: true })
      });
    });

    // E-06: Bloqueos de eliminación
    await t.test('E-06: Bloqueos: EN_PROCESO, FINALIZADA, CANCELADA, costos, repuestos, documentos, multiples', async () => {
      // 1. EN_PROCESO (tiene estado no pendiente y tiene fecha inicio)
      const resEP = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion E-06 EP' })
      });
      const idEP = (await resEP.json()).id;
      createdIntervencionIds.push(idEP);
      await app.request(`/api/intervenciones/${idEP}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      const resElimEP = await app.request(`/api/intervenciones/${idEP}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: 'Eliminar EN_PROCESO' })
      });
      assert.strictEqual(resElimEP.status, 409);
      const dElimEP = await resElimEP.json();
      assert.strictEqual(dElimEP.codigo, 'ELIMINACION_NO_PERMITIDA');
      assert.deepStrictEqual(
        dElimEP.motivos.slice().sort(),
        ['ESTADO_NO_PENDIENTE', 'TIENE_FECHA_INICIO', 'TIENE_HISTORIAL'].sort()
      );

      // 2. Con renglón de costo
      const resCost = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion E-06 Costos' })
      });
      const idCost = (await resCost.json()).id;
      createdIntervencionIds.push(idCost);
      await client.query(
        "INSERT INTO intervencion_costos (intervencion_id, tipo, descripcion, importe, registrado_por_usuario_id, anulado_en, anulado_por_usuario_id, motivo_anulacion) VALUES ($1, 'MANO_OBRA', 'Costo prueba', 100, $2, NOW(), $2, 'Anulado')",
        [idCost, resp1Id]
      );
      const resElimCost = await app.request(`/api/intervenciones/${idCost}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: 'Eliminar con costos' })
      });
      assert.strictEqual(resElimCost.status, 409);
      const dElimCost = await resElimCost.json();
      assert.strictEqual(dElimCost.codigo, 'ELIMINACION_NO_PERMITIDA');
      assert.deepStrictEqual(
        dElimCost.motivos.slice().sort(),
        ['TIENE_COSTOS'].sort()
      );

      // 3. Con repuesto
      const resRep = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion E-06 Repuestos' })
      });
      const idRep = (await resRep.json()).id;
      createdIntervencionIds.push(idRep);
      const resRepRow = await client.query("SELECT id FROM repuestos LIMIT 1");
      let repuestoId = resRepRow.rows[0]?.id;
      if (!repuestoId) {
        const insRep = await client.query("INSERT INTO repuestos (nombre, costo_unitario, cantidad_disponible) VALUES ('Repuesto Test', 10.50, 100) RETURNING id");
        repuestoId = insRep.rows[0].id;
      }
      await client.query(
        "INSERT INTO intervencion_repuestos (intervencion_id, repuesto_id, cantidad, costo_unitario_aplicado) VALUES ($1, $2, 1, 10.50)",
        [idRep, repuestoId]
      );
      const resElimRep = await app.request(`/api/intervenciones/${idRep}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: 'Eliminar con repuesto' })
      });
      assert.strictEqual(resElimRep.status, 409);
      const dElimRep = await resElimRep.json();
      assert.strictEqual(dElimRep.codigo, 'ELIMINACION_NO_PERMITIDA');
      assert.deepStrictEqual(
        dElimRep.motivos.slice().sort(),
        ['TIENE_REPUESTOS'].sort()
      );

      // 4. Con documento
      const resDoc = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion E-06 Docs' })
      });
      const idDoc = (await resDoc.json()).id;
      createdIntervencionIds.push(idDoc);
      await client.query(
        "INSERT INTO documentos (intervencion_id, nombre_original, tamanio_bytes, mime_type, storage_key, subido_por_usuario_id) VALUES ($1, 'doc.pdf', 100, 'application/pdf', 'key_test', $2)",
        [idDoc, resp1Id]
      );
      const resElimDoc = await app.request(`/api/intervenciones/${idDoc}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: 'Eliminar con documento' })
      });
      assert.strictEqual(resElimDoc.status, 409);
      const dElimDoc = await resElimDoc.json();
      assert.strictEqual(dElimDoc.codigo, 'ELIMINACION_NO_PERMITIDA');
      assert.deepStrictEqual(
        dElimDoc.motivos.slice().sort(),
        ['TIENE_DOCUMENTOS'].sort()
      );

      // 5. Con varias causas a la vez (Costos + Repuestos + Docs + Estado no pendiente)
      const resMult = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion E-06 Mult' })
      });
      const idMult = (await resMult.json()).id;
      createdIntervencionIds.push(idMult);

      await app.request(`/api/intervenciones/${idMult}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      await client.query("INSERT INTO intervencion_costos (intervencion_id, tipo, descripcion, importe, registrado_por_usuario_id) VALUES ($1, 'OTRO', 'Costo mult', 50, $2)", [idMult, resp1Id]);
      await client.query("INSERT INTO intervencion_repuestos (intervencion_id, repuesto_id, cantidad, costo_unitario_aplicado) VALUES ($1, $2, 2, 15.00)", [idMult, repuestoId]);
      await client.query("INSERT INTO documentos (intervencion_id, nombre_original, tamanio_bytes, mime_type, storage_key, subido_por_usuario_id) VALUES ($1, 'doc2.pdf', 100, 'application/pdf', 'key_test2', $2)", [idMult, resp1Id]);

      const resElimMult = await app.request(`/api/intervenciones/${idMult}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: 'Eliminar con multiples causas' })
      });
      assert.strictEqual(resElimMult.status, 409);
      const dMult = await resElimMult.json();
      assert.strictEqual(dMult.codigo, 'ELIMINACION_NO_PERMITIDA');
      assert.deepStrictEqual(
        dMult.motivos.slice().sort(),
        ['ESTADO_NO_PENDIENTE', 'TIENE_COSTOS', 'TIENE_DOCUMENTOS', 'TIENE_FECHA_INICIO', 'TIENE_HISTORIAL', 'TIENE_REPUESTOS'].sort()
      );
    });

    // E-07: Sin motivo; sin permiso ELIMINAR
    await t.test('E-07: Sin motivo -> 422; sin permiso ELIMINAR -> 403', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion E-07' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      // Sin motivo
      const resSinMot = await app.request(`/api/intervenciones/${intId}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: '123' })
      });
      assert.strictEqual(resSinMot.status, 422);

      // Sin permiso ELIMINAR (Operario)
      const resSinPerm = await app.request(`/api/intervenciones/${intId}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operario1Token}` },
        body: JSON.stringify({ motivo: 'Operario intenta eliminar' })
      });
      assert.strictEqual(resSinPerm.status, 403);
    });

    // E-08: Eliminar una ya eliminada
    await t.test('E-08: Eliminar una ya eliminada -> 404', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion E-08' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      // Primera vez
      const resElim1 = await app.request(`/api/intervenciones/${intId}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: 'Primera eliminacion' })
      });
      assert.strictEqual(resElim1.status, 200);

      // Segunda vez
      const resElim2 = await app.request(`/api/intervenciones/${intId}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: 'Segunda eliminacion' })
      });
      assert.strictEqual(resElim2.status, 404);
    });

    // E-09: GET /?incluir_eliminadas=true con y sin ELIMINAR; usuario con VER alcance SECTORES
    await t.test('E-09: GET /?incluir_eliminadas=true con y sin ELIMINAR; alcance SECTORES', async () => {
      // 1. Sin permiso ELIMINAR -> 403
      const resSinPerm = await app.request('/api/intervenciones?incluir_eliminadas=true', {
        headers: { Authorization: `Bearer ${operario1Token}` }
      });
      assert.strictEqual(resSinPerm.status, 403);

      // 2. Con permiso ELIMINAR (resp1) -> 200 y contiene eliminadas
      const resConPerm = await app.request('/api/intervenciones?incluir_eliminadas=true', {
        headers: { Authorization: `Bearer ${resp1Token}` }
      });
      assert.strictEqual(resConPerm.status, 200);
      const items = await resConPerm.json();
      const elim = items.find((i: any) => i.eliminada === true);
      assert.ok(elim);
      assert.ok(elim.eliminado_en);
      assert.ok(elim.eliminado_por);
      assert.ok(elim.motivo_eliminacion);

      // 3. Usuario con SECTORES (asignado solo a Sector 1)
      // Crear y eliminar una en Sector 2
      const resM2Int = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina2Id, descripcion: 'Intervencion Sec2' })
      });
      const idM2 = (await resM2Int.json()).id;
      createdIntervencionIds.push(idM2);
      await app.request(`/api/intervenciones/${idM2}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: 'Eliminar en sector 2' })
      });

      const resSec = await app.request('/api/intervenciones?incluir_eliminadas=true', {
        headers: { Authorization: `Bearer ${userSectoresToken}` }
      });
      assert.strictEqual(resSec.status, 200);
      const itemsSec = await resSec.json();
      // No debe contener intervenciones de Maquina 2 (Sector 2)
      assert.strictEqual(itemsSec.some((i: any) => i.id === idM2), false);
    });

    // E-10: Fallo forzado (trigger) al insertar la auditoría de eliminación -> 500 y nada cambia
    await t.test('E-10: Fallo forzado (trigger) al insertar auditoría -> 500 y rollback completo', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion E-10' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/registrar-detencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', observacion: 'Detencion E-10' })
      });

      // Crear trigger que falla al insertar ELIMINACION_LOGICA
      await client.query(`
        CREATE OR REPLACE FUNCTION trigger_fallo_eliminacion()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.tipo_evento = 'ELIMINACION_LOGICA' THEN
            RAISE EXCEPTION 'Fallo forzado en auditoria de eliminacion';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      await client.query(`
        CREATE TRIGGER trg_test_fallo_eliminacion
        BEFORE INSERT ON intervencion_auditoria
        FOR EACH ROW EXECUTE FUNCTION trigger_fallo_eliminacion();
      `);

      try {
        const resElim = await app.request(`/api/intervenciones/${intId}/eliminar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ motivo: 'Eliminar con fallo forzado', maquina_recuperada: true })
        });
        assert.strictEqual(resElim.status, 500);

        // Verificar que no se eliminó y el período sigue abierto
        const resDB = await client.query('SELECT eliminado_en FROM intervenciones WHERE id = $1', [intId]);
        assert.strictEqual(resDB.rows[0].eliminado_en, null);

        const resPer = await client.query('SELECT hasta FROM intervencion_periodos_detencion WHERE intervencion_id = $1', [intId]);
        assert.strictEqual(resPer.rows[0].hasta, null);

        const resMq = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquina1Id]);
        assert.strictEqual(resMq.rows[0].estado, 'DETENIDA');
      } finally {
        // Remover trigger
        await client.query('DROP TRIGGER IF EXISTS trg_test_fallo_eliminacion ON intervencion_auditoria');
        await client.query('DROP FUNCTION IF EXISTS trigger_fallo_eliminacion');
      }

      // Limpiar eliminando con éxito
      await app.request(`/api/intervenciones/${intId}/eliminar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ motivo: 'Eliminar tras remover trigger', maquina_recuperada: true })
      });
    });

    // =========================================================================
    // 9.3 EDICIÓN
    // =========================================================================

    // D-01: Responsable edita descripcion y observaciones de una EN_PROCESO
    await t.test('D-01: Responsable edita descripcion y observaciones de EN_PROCESO -> 200 y 2 filas EDICION', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Descripcion Original D-01', observaciones: 'Obs Original D-01' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      await app.request(`/api/intervenciones/${intId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });

      const resHistAntes = await client.query('SELECT COUNT(*) AS total FROM historial_estados_intervencion WHERE intervencion_id = $1', [intId]);
      const histTotalAntes = Number(resHistAntes.rows[0].total);

      // Editar
      const resEdit = await app.request(`/api/intervenciones/${intId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'EN_PROCESO',
          descripcion: 'Descripcion Modificada D-01',
          observaciones: 'Obs Modificada D-01',
        })
      });
      assert.strictEqual(resEdit.status, 200);

      // Verificar DB
      const resDB = await client.query('SELECT descripcion, observaciones, estado FROM intervenciones WHERE id = $1', [intId]);
      assert.strictEqual(resDB.rows[0].descripcion, 'Descripcion Modificada D-01');
      assert.strictEqual(resDB.rows[0].observaciones, 'Obs Modificada D-01');
      assert.strictEqual(resDB.rows[0].estado, 'EN_PROCESO');

      // Dos filas en auditoría EDICION
      const resAud = await client.query(
        "SELECT campo_modificado, valor_anterior, valor_nuevo FROM intervencion_auditoria WHERE intervencion_id = $1 AND tipo_evento = 'EDICION' ORDER BY id ASC",
        [intId]
      );
      assert.strictEqual(resAud.rows.length, 2);
      assert.strictEqual(resAud.rows[0].campo_modificado, 'descripcion');
      assert.strictEqual(resAud.rows[0].valor_anterior, 'Descripcion Original D-01');
      assert.strictEqual(resAud.rows[0].valor_nuevo, 'Descripcion Modificada D-01');

      assert.strictEqual(resAud.rows[1].campo_modificado, 'observaciones');
      assert.strictEqual(resAud.rows[1].valor_anterior, 'Obs Original D-01');
      assert.strictEqual(resAud.rows[1].valor_nuevo, 'Obs Modificada D-01');

      // Historial y máquina sin cambios
      const resHistDesp = await client.query('SELECT COUNT(*) AS total FROM historial_estados_intervencion WHERE intervencion_id = $1', [intId]);
      assert.strictEqual(Number(resHistDesp.rows[0].total), histTotalAntes);
    });

    // D-02: Operario edita su propia PENDIENTE sin responsable
    await t.test('D-02: Operario edita su propia PENDIENTE sin responsable -> 200', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operario1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Descripcion Operario Original' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      const resEdit = await app.request(`/api/intervenciones/${intId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operario1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          descripcion: 'Descripcion Operario Editada',
        })
      });
      assert.strictEqual(resEdit.status, 200);

      const resDB = await client.query('SELECT descripcion FROM intervenciones WHERE id = $1', [intId]);
      assert.strictEqual(resDB.rows[0].descripcion, 'Descripcion Operario Editada');
    });

    // D-03: Operario edita su propia PENDIENTE ya tomada; una ajena
    await t.test('D-03: Operario edita PENDIENTE tomada -> 403; una ajena -> 404', async () => {
      // 1. Propia pero tomada / asignada
      const resCrearPropia = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operario1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Propia Tomada D-03' })
      });
      const idPropia = (await resCrearPropia.json()).id;
      createdIntervencionIds.push(idPropia);

      await app.request(`/api/intervenciones/${idPropia}/responsable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ usuario_id: resp1Id, estado_esperado: 'PENDIENTE' })
      });

      const resEditTomada = await app.request(`/api/intervenciones/${idPropia}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operario1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', descripcion: 'Intento de edicion tomada' })
      });
      assert.strictEqual(resEditTomada.status, 403);
      assert.strictEqual((await resEditTomada.json()).codigo, 'EDICION_NO_PERMITIDA');

      // 2. Ajena (creada por operario 2)
      const resCrearAjena = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operario2Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Ajena Operario 2' })
      });
      const idAjena = (await resCrearAjena.json()).id;
      createdIntervencionIds.push(idAjena);

      const resEditAjena = await app.request(`/api/intervenciones/${idAjena}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operario1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', descripcion: 'Intento de edicion ajena' })
      });
      assert.strictEqual(resEditAjena.status, 404);
    });

    // D-04: Editar FINALIZADA / CANCELADA
    await t.test('D-04: Editar FINALIZADA / CANCELADA -> 409 EDICION_NO_PERMITIDA', async () => {
      // 1. FINALIZADA
      const resF = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Para Finalizar D-04' })
      });
      const idF = (await resF.json()).id;
      createdIntervencionIds.push(idF);
      await app.request(`/api/intervenciones/${idF}/resolver-ahora`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({
          estado_esperado: 'PENDIENTE',
          fecha_inicio: new Date().toISOString(),
          trabajo_realizado: 'Trabajo D-04',
          ejecucion: 'INTERNA',
        })
      });

      const resEditF = await app.request(`/api/intervenciones/${idF}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'FINALIZADA', descripcion: 'Intento editar finalizada' })
      });
      assert.strictEqual(resEditF.status, 409);
      assert.strictEqual((await resEditF.json()).codigo, 'EDICION_NO_PERMITIDA');

      // 2. CANCELADA
      const resC = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Para Cancelar D-04' })
      });
      const idC = (await resC.json()).id;
      createdIntervencionIds.push(idC);
      await app.request(`/api/intervenciones/${idC}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'Cancelar D-04' })
      });

      const resEditC = await app.request(`/api/intervenciones/${idC}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'CANCELADA', descripcion: 'Intento editar cancelada' })
      });
      assert.strictEqual(resEditC.status, 409);
      assert.strictEqual((await resEditC.json()).codigo, 'EDICION_NO_PERMITIDA');
    });

    // D-05: Body con maquina_id o estado; body vacío; descripcion de 3 caracteres
    await t.test('D-05: Body con maquina_id o estado; body vacío; descripcion < 5 -> 422 DATOS_INVALIDOS', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Intervencion D-05' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      // Con maquina_id
      const resM = await app.request(`/api/intervenciones/${intId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', maquina_id: 2 })
      });
      assert.strictEqual(resM.status, 422);
      assert.strictEqual((await resM.json()).codigo, 'DATOS_INVALIDOS');

      // Con estado
      const resE = await app.request(`/api/intervenciones/${intId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', estado: 'EN_PROCESO' })
      });
      assert.strictEqual(resE.status, 422);

      // Body vacío
      const resVacio = await app.request(`/api/intervenciones/${intId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
      });
      assert.strictEqual(resVacio.status, 422);

      // Descripción corta (3 caracteres)
      const resCorta = await app.request(`/api/intervenciones/${intId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', descripcion: '123' })
      });
      assert.strictEqual(resCorta.status, 422);
    });

    // D-06: Mismos valores que los actuales -> 422 SIN_CAMBIOS
    await t.test('D-06: Mismos valores que los actuales -> 422 SIN_CAMBIOS', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Misma descripcion exacta' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      const resMismos = await app.request(`/api/intervenciones/${intId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', descripcion: 'Misma descripcion exacta' })
      });
      assert.strictEqual(resMismos.status, 422);
      assert.strictEqual((await resMismos.json()).codigo, 'SIN_CAMBIOS');
    });

    // D-07: Operario con EDITAR denegado por excepción
    await t.test('D-07: Operario con EDITAR denegado por excepción -> 403', async () => {
      const resCrear = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userSinEditarToken}` },
        body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Propia Sin Editar D-07' })
      });
      const intId = (await resCrear.json()).id;
      createdIntervencionIds.push(intId);

      const resEdit = await app.request(`/api/intervenciones/${intId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userSinEditarToken}` },
        body: JSON.stringify({ estado_esperado: 'PENDIENTE', descripcion: 'Intento de edicion denegado' })
      });
      assert.strictEqual(resEdit.status, 403);
    });

    // =========================================================================
    // 9.4 MATRIZ Y REGRESIÓN
    // =========================================================================

    // M-01: Matriz estado × acción
    await t.test('M-01: Matriz estado x acción (PENDIENTE, EN_PROCESO, EN_ESPERA_REPUESTOS, FINALIZADA, CANCELADA)', async () => {
      /*
        Matriz requerida:
        | Estado actual       | reabrir | eliminar (sin actividad) | editar (responsable) |
        | PENDIENTE           | 409     | 200                      | 200                  |
        | EN_PROCESO          | 409     | 409                      | 200                  |
        | EN_ESPERA_REPUESTOS | 409     | 409                      | 200                  |
        | FINALIZADA          | 200     | 409                      | 409                  |
        | CANCELADA           | 409     | 409                      | 409                  |
      */

      // 1. PENDIENTE
      {
        // Reabrir -> 409
        const rCrear = await app.request('/api/intervenciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Matriz PENDIENTE 1' })
        });
        const id1 = (await rCrear.json()).id;
        createdIntervencionIds.push(id1);
        const resR = await app.request(`/api/intervenciones/${id1}/reabrir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'Reabrir PENDIENTE matriz', maquina_detenida: false })
        });
        assert.strictEqual(resR.status, 409);

        // Editar -> 200
        const resEd = await app.request(`/api/intervenciones/${id1}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'PENDIENTE', descripcion: 'Matriz PENDIENTE Editada' })
        });
        assert.strictEqual(resEd.status, 200);

        // Eliminar -> 200
        const resEl = await app.request(`/api/intervenciones/${id1}/eliminar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ motivo: 'Eliminar PENDIENTE matriz' })
        });
        assert.strictEqual(resEl.status, 200);
      }

      // 2. EN_PROCESO
      {
        const rCrear = await app.request('/api/intervenciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Matriz EN_PROCESO' })
        });
        const id2 = (await rCrear.json()).id;
        createdIntervencionIds.push(id2);
        await app.request(`/api/intervenciones/${id2}/iniciar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
        });

        // Reabrir -> 409
        const resR = await app.request(`/api/intervenciones/${id2}/reabrir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'EN_PROCESO', motivo: 'Reabrir EN_PROCESO matriz', maquina_detenida: false })
        });
        assert.strictEqual(resR.status, 409);

        // Eliminar -> 409
        const resEl = await app.request(`/api/intervenciones/${id2}/eliminar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ motivo: 'Eliminar EN_PROCESO matriz' })
        });
        assert.strictEqual(resEl.status, 409);

        // Editar -> 200
        const resEd = await app.request(`/api/intervenciones/${id2}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'EN_PROCESO', descripcion: 'Matriz EN_PROCESO Editada' })
        });
        assert.strictEqual(resEd.status, 200);
      }

      // 3. EN_ESPERA_REPUESTOS
      {
        const rCrear = await app.request('/api/intervenciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Matriz EN_ESPERA' })
        });
        const id3 = (await rCrear.json()).id;
        createdIntervencionIds.push(id3);
        await app.request(`/api/intervenciones/${id3}/iniciar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'PENDIENTE' })
        });
        await app.request(`/api/intervenciones/${id3}/espera-repuestos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'EN_PROCESO', observacion: 'Esperando repuesto matriz' })
        });

        // Reabrir -> 409
        const resR = await app.request(`/api/intervenciones/${id3}/reabrir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'EN_ESPERA_REPUESTOS', motivo: 'Reabrir EN_ESPERA matriz', maquina_detenida: false })
        });
        assert.strictEqual(resR.status, 409);

        // Eliminar -> 409
        const resEl = await app.request(`/api/intervenciones/${id3}/eliminar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ motivo: 'Eliminar EN_ESPERA matriz' })
        });
        assert.strictEqual(resEl.status, 409);

        // Editar -> 200
        const resEd = await app.request(`/api/intervenciones/${id3}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'EN_ESPERA_REPUESTOS', descripcion: 'Matriz EN_ESPERA Editada' })
        });
        assert.strictEqual(resEd.status, 200);
      }

      // 4. FINALIZADA
      {
        const rCrear = await app.request('/api/intervenciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Matriz FINALIZADA' })
        });
        const id4 = (await rCrear.json()).id;
        createdIntervencionIds.push(id4);
        await app.request(`/api/intervenciones/${id4}/resolver-ahora`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({
            estado_esperado: 'PENDIENTE',
            fecha_inicio: new Date().toISOString(),
            trabajo_realizado: 'Trabajo matriz FINALIZADA',
            ejecucion: 'INTERNA',
          })
        });

        // Eliminar -> 409
        const resEl = await app.request(`/api/intervenciones/${id4}/eliminar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ motivo: 'Eliminar FINALIZADA matriz' })
        });
        assert.strictEqual(resEl.status, 409);

        // Editar -> 409
        const resEd = await app.request(`/api/intervenciones/${id4}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'FINALIZADA', descripcion: 'Matriz FINALIZADA Editada' })
        });
        assert.strictEqual(resEd.status, 409);

        // Reabrir -> 200
        const resR = await app.request(`/api/intervenciones/${id4}/reabrir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'FINALIZADA', motivo: 'Reabrir FINALIZADA matriz', maquina_detenida: false })
        });
        assert.strictEqual(resR.status, 200);
      }

      // 5. CANCELADA
      {
        const rCrear = await app.request('/api/intervenciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ maquina_id: maquina1Id, descripcion: 'Matriz CANCELADA' })
        });
        const id5 = (await rCrear.json()).id;
        createdIntervencionIds.push(id5);
        await app.request(`/api/intervenciones/${id5}/cancelar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'PENDIENTE', motivo: 'Cancelar matriz CANCELADA' })
        });

        // Reabrir -> 409
        const resR = await app.request(`/api/intervenciones/${id5}/reabrir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'CANCELADA', motivo: 'Reabrir CANCELADA matriz', maquina_detenida: false })
        });
        assert.strictEqual(resR.status, 409);

        // Eliminar -> 409
        const resEl = await app.request(`/api/intervenciones/${id5}/eliminar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ motivo: 'Eliminar CANCELADA matriz' })
        });
        assert.strictEqual(resEl.status, 409);

        // Editar -> 409
        const resEd = await app.request(`/api/intervenciones/${id5}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resp1Token}` },
          body: JSON.stringify({ estado_esperado: 'CANCELADA', descripcion: 'Matriz CANCELADA Editada' })
        });
        assert.strictEqual(resEd.status, 409);
      }
    });

  } finally {
    // Limpieza
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
      if (createdSectorIds.length > 0) {
        await client.query('DELETE FROM sectores WHERE id = ANY($1)', [createdSectorIds]);
      }
    } catch (err) {
      console.error('Error durante limpieza de pruebas Etapa 6:', err);
    } finally {
      client.release();
    }
  }
});
