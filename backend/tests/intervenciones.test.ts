import { test } from 'node:test';
import assert from 'node:assert';
import { pool } from '../functions/db.ts';
import app from '../functions/api.ts';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (INTERVENCIONES TESTS)');
  console.error('===============================================================');
  console.error(' Solo está permitida la ejecución contra rama aislada de Neon.');
  console.error('===============================================================');
  process.exit(1);
}

test('Etapa 3 — Registrar Falla y Consultar Intervenciones (E2E API)', async (t) => {
  const client = await pool.connect();
  let adminToken = '';
  let operarioToken = '';
  let operarioId = 0;
  let adminId = 0;
  let sectorId = 0;
  let maquinaOperativaId = 0;
  let intervencionSinDetenerId = 0;
  let intervencionConDetencionId = 0;

  try {
    // Setup inicial de datos
    // 1. Obtener Admin y login
    const resAdmin = await client.query("SELECT id FROM usuarios WHERE legajo = 'ADMIN001' LIMIT 1");
    adminId = resAdmin.rows[0].id;

    const resLoginAdmin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: 'ADMIN001', password: process.env.ADMIN_INITIAL_PASSWORD || 'admin' })
    });
    const dataAdmin = await resLoginAdmin.json();
    adminToken = dataAdmin.token;

    // 2. Crear Operario con perfil OPERARIO y login
    const legajoOp = 'OP_TEST_' + Date.now();
    const resPerfilOp = await client.query("SELECT id FROM perfiles WHERE nombre = 'OPERARIO'");
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('op1234', 10);

    const resOp = await client.query(
      `INSERT INTO usuarios (legajo, nombre, password_hash, perfil_id)
       VALUES ($1, 'Operario E2E', $2, $3) RETURNING id`,
      [legajoOp, hash, resPerfilOp.rows[0].id]
    );
    operarioId = resOp.rows[0].id;

    const resLoginOp = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: legajoOp, password: 'op1234' })
    });
    const dataOp = await resLoginOp.json();
    operarioToken = dataOp.token;

    // 3. Crear sector y máquina de prueba en estado OPERATIVA
    const resSec = await client.query(
      `INSERT INTO sectores (nombre, descripcion)
       VALUES ($1, 'Sector Pruebas Intervenciones') RETURNING id`,
      ['Sector E2E ' + Date.now()]
    );
    sectorId = resSec.rows[0].id;

    const resMaq = await client.query(
      `INSERT INTO maquinas (nombre, sector_id, estado, codigo)
       VALUES ('Torno CNC Test', $1, 'OPERATIVA', $2) RETURNING id`,
      [sectorId, 'M-E2E-' + Date.now()]
    );
    maquinaOperativaId = resMaq.rows[0].id;

    // -------------------------------------------------------------
    // TEST 1: Registrar falla que NO detiene la máquina
    // -------------------------------------------------------------
    await t.test('1. Operario registra falla sin detención (máquina permanece OPERATIVA)', async () => {
      const res = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${operarioToken}`
        },
        body: JSON.stringify({
          maquina_id: maquinaOperativaId,
          descripcion: 'Ruido leve en rodamiento principal durante giro rápido',
          detiene_maquina: false
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.estado, 'PENDIENTE');
      assert.strictEqual(data.detiene_maquina, false);
      assert.strictEqual(data.periodo_detencion_id, null);
      assert.strictEqual(data.maquina.estado_actual, 'OPERATIVA');
      intervencionSinDetenerId = data.id;

      // Verificar en BD que la máquina sigue OPERATIVA
      const dbMaq = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquinaOperativaId]);
      assert.strictEqual(dbMaq.rows[0].estado, 'OPERATIVA');

      // Verificar historial inicial de la intervención
      const dbHist = await client.query(
        'SELECT estado_anterior, estado_nuevo FROM historial_estados_intervencion WHERE intervencion_id = $1',
        [intervencionSinDetenerId]
      );
      assert.strictEqual(dbHist.rows.length, 1);
      assert.strictEqual(dbHist.rows[0].estado_anterior, null);
      assert.strictEqual(dbHist.rows[0].estado_nuevo, 'PENDIENTE');
    });

    // -------------------------------------------------------------
    // TEST 2: Registrar falla que SÍ detiene la máquina
    // -------------------------------------------------------------
    await t.test('2. Operario registra falla CON detención (máquina pasa a DETENIDA y abre período)', async () => {
      const res = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${operarioToken}`
        },
        body: JSON.stringify({
          maquina_id: maquinaOperativaId,
          descripcion: 'Falla crítica en husillo, humo visible. Máquina detenida de inmediato.',
          detiene_maquina: true
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.estado, 'PENDIENTE');
      assert.strictEqual(data.detiene_maquina, true);
      assert.ok(data.periodo_detencion_id > 0);
      assert.strictEqual(data.maquina.estado_actual, 'DETENIDA');
      intervencionConDetencionId = data.id;

      // Verificar en BD que la máquina cambió a DETENIDA
      const dbMaq = await client.query('SELECT estado FROM maquinas WHERE id = $1', [maquinaOperativaId]);
      assert.strictEqual(dbMaq.rows[0].estado, 'DETENIDA');

      // Verificar período abierto en intervencion_periodos_detencion
      const dbPeriodo = await client.query(
        'SELECT hasta, abierto_por_usuario_id FROM intervencion_periodos_detencion WHERE id = $1',
        [data.periodo_detencion_id]
      );
      assert.strictEqual(dbPeriodo.rows[0].hasta, null);
      assert.strictEqual(Number(dbPeriodo.rows[0].abierto_por_usuario_id), Number(operarioId));

      // Verificar trazabilidad en historial_estados_maquina
      const dbHistM = await client.query(
        'SELECT estado_anterior, estado_nuevo FROM historial_estados_maquina WHERE intervencion_id = $1',
        [intervencionConDetencionId]
      );
      assert.strictEqual(dbHistM.rows[0].estado_anterior, 'OPERATIVA');
      assert.strictEqual(dbHistM.rows[0].estado_nuevo, 'DETENIDA');
    });

    // -------------------------------------------------------------
    // TEST 3: Ciberseguridad y validación de entradas
    // -------------------------------------------------------------
    await t.test('3. Validación de entradas (descripción corta y máquina inexistente)', async () => {
      // Descripción demasiado corta
      const resCorta = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${operarioToken}`
        },
        body: JSON.stringify({ maquina_id: maquinaOperativaId, descripcion: 'chau' })
      });
      assert.strictEqual(resCorta.status, 400);

      // Máquina inexistente
      const resInexistente = await app.request('/api/intervenciones', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${operarioToken}`
        },
        body: JSON.stringify({ maquina_id: 99999999, descripcion: 'Falla en máquina que no existe' })
      });
      assert.strictEqual(resInexistente.status, 404);
    });

    // -------------------------------------------------------------
    // TEST 4: Control de alcance de visibilidad en GET /api/intervenciones
    // -------------------------------------------------------------
    await t.test('4. Alcance PROPIAS: Operario solo lista sus propias fallas reportadas', async () => {
      // Crear una intervención por el Admin (ajena al operario)
      const resAdminCrea = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion)
         VALUES ($1, 1, $2, 'Falla registrada exclusivamente por Admin') RETURNING id`,
        [maquinaOperativaId, adminId]
      );
      const intervencionAdminId = resAdminCrea.rows[0].id;

      // Consulta del operario
      const resOpList = await app.request('/api/intervenciones', {
        headers: { 'Authorization': `Bearer ${operarioToken}` }
      });
      assert.strictEqual(resOpList.status, 200);
      const listOp = await resOpList.json();

      // Debe ver sus 2 intervenciones creadas, pero NO la del admin
      const idsVistasPorOp = listOp.map((i: any) => i.id);
      assert.ok(idsVistasPorOp.includes(intervencionSinDetenerId));
      assert.ok(idsVistasPorOp.includes(intervencionConDetencionId));
      assert.strictEqual(idsVistasPorOp.includes(Number(intervencionAdminId)), false, 'Operario NO debe ver la intervención ajena del Admin');

      // Consulta del admin (alcance TODAS): debe ver todas
      const resAdminList = await app.request('/api/intervenciones', {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(resAdminList.status, 200);
      const listAdmin = await resAdminList.json();
      const idsVistasPorAdmin = listAdmin.map((i: any) => i.id);
      assert.ok(idsVistasPorAdmin.includes(Number(intervencionAdminId)));
    });

    // -------------------------------------------------------------
    // TEST 5: Filtro Vista "Sin Asignar" y detalle GET /:id
    // -------------------------------------------------------------
    await t.test('5. Vista Sin Asignar y detalle GET /api/intervenciones/:id', async () => {
      const resSinAsignar = await app.request('/api/intervenciones?sin_asignar=true', {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(resSinAsignar.status, 200);
      const listaSinAsignar = await resSinAsignar.json();
      assert.ok(listaSinAsignar.length > 0);
      // La primera debe ser la que detiene la máquina actualmente
      assert.strictEqual(listaSinAsignar[0].detiene_maquina_actualmente, true);

      // Detalle de intervención con detención
      const resDetalle = await app.request(`/api/intervenciones/${intervencionConDetencionId}`, {
        headers: { 'Authorization': `Bearer ${operarioToken}` }
      });
      assert.strictEqual(resDetalle.status, 200);
      const detalle = await resDetalle.json();
      assert.strictEqual(detalle.id, intervencionConDetencionId);
      assert.strictEqual(detalle.periodos_detencion.length, 1);
      assert.strictEqual(detalle.periodos_detencion[0].esta_abierto, true);
      assert.strictEqual(detalle.historial_estados.length, 1);
    });

  } finally {
    // Limpieza de datos temporales
    if (maquinaOperativaId > 0) {
      await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE maquina_id = $1)', [maquinaOperativaId]);
      await client.query('DELETE FROM notificaciones WHERE maquina_id = $1', [maquinaOperativaId]);
      await client.query('DELETE FROM intervencion_periodos_detencion WHERE maquina_id = $1', [maquinaOperativaId]);
      await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id IN ($1, $2)', [intervencionSinDetenerId, intervencionConDetencionId]);
      await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = $1', [maquinaOperativaId]);
      await client.query('DELETE FROM intervenciones WHERE maquina_id = $1', [maquinaOperativaId]);
      await client.query('DELETE FROM maquinas WHERE id = $1', [maquinaOperativaId]);
    }
    if (sectorId > 0) {
      await client.query('DELETE FROM sectores WHERE id = $1', [sectorId]);
    }
    if (operarioId > 0) {
      await client.query('DELETE FROM usuarios WHERE id = $1', [operarioId]);
    }
    client.release();
  }
});
