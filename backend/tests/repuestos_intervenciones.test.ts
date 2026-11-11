import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';

// Configurar timeout de bloqueo para pruebas de concurrencia
process.env.LOCK_TIMEOUT = '3s';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (REPUESTOS INTERVENCIONES TESTS)');
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

async function getJson(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, { method: 'GET', headers });
}

async function postJson(path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function patchJson(path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'PATCH',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function putJson(path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'PUT',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function deleteJson(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(path, { method: 'DELETE', headers });
}

test('Etapa R1 — Repuestos y pedidos en la intervención, y reporte (RI-01 a RI-19)', async (t) => {
  let client = await pool.connect();

  const createdPlantaIds: number[] = [];
  const createdSectorIds: number[] = [];
  const createdMaquinaIds: number[] = [];
  const createdUsuarioIds: number[] = [];
  const createdProveedorIds: number[] = [];
  const createdRepuestoIds: number[] = [];
  const createdIntervencionIds: number[] = [];

  try {
    const suf = Date.now();
    const passHash = await bcrypt.hash('pass123', 10);

    // 1. Perfiles y Permisos
    const resPerfiles = await client.query('SELECT id, nombre FROM perfiles');
    const perfilMap: Record<string, number> = {};
    for (const r of resPerfiles.rows) {
      perfilMap[r.nombre] = Number(r.id);
    }

    const resPerms = await client.query('SELECT id, codigo FROM permisos');
    const permMap: Record<string, number> = {};
    for (const r of resPerms.rows) {
      permMap[r.codigo] = Number(r.id);
    }

    // 2. Plantas y Sectores (PL1 con S1, PL2 con S2)
    const resPL1 = await client.query(
      `INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id`,
      [`PL1_${suf}`]
    );
    const pl1Id = Number(resPL1.rows[0].id);
    createdPlantaIds.push(pl1Id);

    const resS1 = await client.query(
      `INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id`,
      [`S1_${suf}`, pl1Id]
    );
    const s1Id = Number(resS1.rows[0].id);
    createdSectorIds.push(s1Id);

    const resPL2 = await client.query(
      `INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id`,
      [`PL2_${suf}`]
    );
    const pl2Id = Number(resPL2.rows[0].id);
    createdPlantaIds.push(pl2Id);

    const resS2 = await client.query(
      `INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id`,
      [`S2_${suf}`, pl2Id]
    );
    const s2Id = Number(resS2.rows[0].id);
    createdSectorIds.push(s2Id);

    // Máquinas M1 en S1 y M2 en S2
    const resM1 = await client.query(
      `INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, TRUE) RETURNING id`,
      [`M1_${suf}`, `Maquina 1 ${suf}`, s1Id]
    );
    const m1Id = Number(resM1.rows[0].id);
    createdMaquinaIds.push(m1Id);

    const resM2 = await client.query(
      `INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, TRUE) RETURNING id`,
      [`M2_${suf}`, `Maquina 2 ${suf}`, s2Id]
    );
    const m2Id = Number(resM2.rows[0].id);
    createdMaquinaIds.push(m2Id);

    // 3. Usuarios
    // R: RESPONSABLE_MANTENIMIENTO, sectores S1 y S2
    const resR = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
       VALUES ($1, 'Resp', 'RI', $2, $3, TRUE, 1) RETURNING id, legajo, sesion_version`,
      [`R_${suf}`, passHash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    const userR = resR.rows[0];
    const rId = Number(userR.id);
    createdUsuarioIds.push(rId);
    await client.query(`INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2), ($1, $3)`, [rId, s1Id, s2Id]);
    const tokenR = await getTokenForUser(userR);

    // R2: Como R, con excepciones DENEGAR de INTERVENCIONES_ASIGNAR y REPUESTOS_GESTIONAR
    const resR2 = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
       VALUES ($1, 'RespDos', 'RI', $2, $3, TRUE, 1) RETURNING id, legajo, sesion_version`,
      [`R2_${suf}`, passHash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    const userR2 = resR2.rows[0];
    const r2Id = Number(userR2.id);
    createdUsuarioIds.push(r2Id);
    await client.query(`INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2), ($1, $3)`, [r2Id, s1Id, s2Id]);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'DENEGAR', 'Sin asignar', $3), ($1, $4, 'DENEGAR', 'Sin gestionar repuestos', $3)`,
      [r2Id, permMap['INTERVENCIONES_ASIGNAR'], rId, permMap['REPUESTOS_GESTIONAR']]
    );
    const tokenR2 = await getTokenForUser(userR2);

    // D: Depósito. Como R, con DENEGAR de INTERVENCIONES_ASIGNAR e INTERVENCIONES_CAMBIAR_ESTADO
    const resD = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
       VALUES ($1, 'Deposito', 'RI', $2, $3, TRUE, 1) RETURNING id, legajo, sesion_version`,
      [`D_${suf}`, passHash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    const userD = resD.rows[0];
    const dId = Number(userD.id);
    createdUsuarioIds.push(dId);
    await client.query(`INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2), ($1, $3)`, [dId, s1Id, s2Id]);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'DENEGAR', 'Sin asignar', $3), ($1, $4, 'DENEGAR', 'Sin cambiar estado', $3)`,
      [dId, permMap['INTERVENCIONES_ASIGNAR'], rId, permMap['INTERVENCIONES_CAMBIAR_ESTADO']]
    );
    const tokenD = await getTokenForUser(userD);

    // T: Técnico. Como R, con DENEGAR de REPUESTOS_GESTIONAR, COSTOS_VER y COSTOS_REGISTRAR
    const resT = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
       VALUES ($1, 'Tecnico', 'RI', $2, $3, TRUE, 1) RETURNING id, legajo, sesion_version`,
      [`T_${suf}`, passHash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    const userT = resT.rows[0];
    const tId = Number(userT.id);
    createdUsuarioIds.push(tId);
    await client.query(`INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2), ($1, $3)`, [tId, s1Id, s2Id]);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'DENEGAR', 'Excep', $3), ($1, $4, 'DENEGAR', 'Excep', $3), ($1, $5, 'DENEGAR', 'Excep', $3)`,
      [tId, permMap['REPUESTOS_GESTIONAR'], rId, permMap['COSTOS_VER'], permMap['COSTOS_REGISTRAR']]
    );
    const tokenT = await getTokenForUser(userT);

    // A: Administrador
    const resA = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
       VALUES ($1, 'Admin', 'RI', $2, $3, TRUE, 1) RETURNING id, legajo, sesion_version`,
      [`A_${suf}`, passHash, perfilMap['ADMINISTRADOR']]
    );
    const userA = resA.rows[0];
    const aId = Number(userA.id);
    createdUsuarioIds.push(aId);
    const tokenA = await getTokenForUser(userA);

    // O: Operario (crea las intervenciones)
    const resO = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
       VALUES ($1, 'Operario', 'RI', $2, $3, TRUE, 1) RETURNING id, legajo, sesion_version`,
      [`O_${suf}`, passHash, perfilMap['OPERARIO']]
    );
    const userO = resO.rows[0];
    const oId = Number(userO.id);
    createdUsuarioIds.push(oId);
    await client.query(`INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2), ($1, $3)`, [oId, s1Id, s2Id]);
    const tokenO = await getTokenForUser(userO);

    // O2: Operario sin intervenciones
    const resO2 = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
       VALUES ($1, 'OperarioDos', 'RI', $2, $3, TRUE, 1) RETURNING id, legajo, sesion_version`,
      [`O2_${suf}`, passHash, perfilMap['OPERARIO']]
    );
    const userO2 = resO2.rows[0];
    const o2Id = Number(userO2.id);
    createdUsuarioIds.push(o2Id);
    const tokenO2 = await getTokenForUser(userO2);

    // X: Operario con excepción CONCEDER de REPORTES_CONSULTAR en alcance SECTORES, solo sector S2
    const resX = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
       VALUES ($1, 'OperarioX', 'RI', $2, $3, TRUE, 1) RETURNING id, legajo, sesion_version`,
      [`X_${suf}`, passHash, perfilMap['OPERARIO']]
    );
    const userX = resX.rows[0];
    const xId = Number(userX.id);
    createdUsuarioIds.push(xId);
    await client.query(`INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)`, [xId, s2Id]);
    await client.query(
      `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
       VALUES ($1, $2, 'CONCEDER', 'SECTORES', 'Reportes para X', $3)`,
      [xId, permMap['REPORTES_CONSULTAR'], aId]
    );
    const tokenX = await getTokenForUser(userX);

    // 4. Proveedor Prov1
    const resProv = await postJson(
      '/api/proveedores',
      { nombre: `Prov1_${suf}`, email: `prov_${suf}@test.com`, cuit: '30-11111111-9' },
      tokenR
    );
    assert.strictEqual(resProv.status, 201);
    const prov1 = await resProv.json();
    const prov1Id = prov1.id;
    createdProveedorIds.push(prov1Id);

    // 5. Repuestos: P1 (stock 10, costo 100), P2 (sin stock, costo 50), P3 (inactivo)
    const resP1 = await postJson(
      '/api/repuestos',
      {
        codigo: `P1_${suf}`,
        nombre: `Repuesto P1 ${suf}`,
        unidad: 'u',
        lleva_stock: true,
        stock_inicial: 10,
        costo_unitario: 100,
      },
      tokenR
    );
    assert.strictEqual(resP1.status, 201);
    const p1 = await resP1.json();
    const p1Id = p1.id;
    createdRepuestoIds.push(p1Id);

    const resP2 = await postJson(
      '/api/repuestos',
      {
        codigo: `P2_${suf}`,
        nombre: `Repuesto P2 ${suf}`,
        unidad: 'u',
        lleva_stock: false,
        costo_unitario: 50,
      },
      tokenR
    );
    assert.strictEqual(resP2.status, 201);
    const p2 = await resP2.json();
    const p2Id = p2.id;
    createdRepuestoIds.push(p2Id);

    const resP3 = await postJson(
      '/api/repuestos',
      {
        codigo: `P3_${suf}`,
        nombre: `Repuesto P3 ${suf}`,
        unidad: 'u',
        lleva_stock: true,
        stock_inicial: 0,
        costo_unitario: 10,
      },
      tokenR
    );
    assert.strictEqual(resP3.status, 201);
    const p3 = await resP3.json();
    const p3Id = p3.id;
    createdRepuestoIds.push(p3Id);
    // Desactivar P3
    const resDelP3 = await deleteJson(`/api/repuestos/${p3Id}`, tokenR);
    assert.strictEqual(resDelP3.status, 200);

    // Helper para crear intervenciones
    async function crearIntervencion(maquinaId: number, tokenCreador = tokenO, desc = 'Falla prueba RI') {
      const res = await postJson('/api/intervenciones', { maquina_id: maquinaId, descripcion: desc }, tokenCreador);
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      createdIntervencionIds.push(data.id);
      return data.id;
    }

    // =========================================================================
    // RI-01: Estados
    // =========================================================================
    await t.test('RI-01: Estados de intervención y consumos', async () => {
      const intId = await crearIntervencion(m1Id);

      // PENDIENTE: 409 ESTADO_NO_PERMITE_REPUESTOS
      const rPend = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenR);
      assert.strictEqual(rPend.status, 409);
      const dPend = await rPend.json();
      assert.strictEqual(dPend.codigo, 'ESTADO_NO_PERMITE_REPUESTOS');

      // Pasar a EN_PROCESO
      const rIni = await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);
      assert.strictEqual(rIni.status, 200);

      // EN_PROCESO: 201
      const rProc = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenR);
      assert.strictEqual(rProc.status, 201);

      // Pasar a EN_ESPERA_REPUESTOS
      const rEsp = await postJson(
        `/api/intervenciones/${intId}/espera-repuestos`,
        { estado_esperado: 'EN_PROCESO', observacion: 'Falta repuesto para continuar' },
        tokenR
      );
      assert.strictEqual(rEsp.status, 200);

      // EN_ESPERA_REPUESTOS: 201
      const rEspRep = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenR);
      assert.strictEqual(rEspRep.status, 201);

      // Reanudar a EN_PROCESO y cancelar
      const rRean = await postJson(`/api/intervenciones/${intId}/reanudar`, { estado_esperado: 'EN_ESPERA_REPUESTOS' }, tokenR);
      assert.strictEqual(rRean.status, 200);

      const rCanc = await postJson(`/api/intervenciones/${intId}/cancelar`, { estado_esperado: 'EN_PROCESO', motivo: 'Cancelada prueba RI-01' }, tokenR);
      assert.strictEqual(rCanc.status, 200);

      // CANCELADA: 409 ESTADO_NO_PERMITE_REPUESTOS
      const rCancRep = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenR);
      assert.strictEqual(rCancRep.status, 409);
      assert.strictEqual((await rCancRep.json()).codigo, 'ESTADO_NO_PERMITE_REPUESTOS');

      // Eliminada: 404
      const intElimId = await crearIntervencion(m1Id);
      const rElim = await postJson(`/api/intervenciones/${intElimId}/eliminar`, { estado_esperado: 'PENDIENTE', motivo: 'Eliminada prueba RI-01' }, tokenA);
      assert.strictEqual(rElim.status, 200);

      const rRepElim = await postJson(`/api/intervenciones/${intElimId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenR);
      assert.strictEqual(rRepElim.status, 404);
      assert.strictEqual((await rRepElim.json()).codigo, 'INTERVENCION_NO_ENCONTRADA');
    });

    // =========================================================================
    // RI-02: Consumo con stock
    // =========================================================================
    let ri02ConsumoId = 0;
    let ri02IntId = 0;
    await t.test('RI-02: Consumo con stock', async () => {
      ri02IntId = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${ri02IntId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);

      // Resetear stock de P1 a 10 por si las pruebas anteriores lo movieron
      await client.query('UPDATE repuestos SET cantidad_disponible = 10, costo_unitario = 100 WHERE id = $1', [p1Id]);

      const res = await postJson(`/api/intervenciones/${ri02IntId}/repuestos`, { repuesto_id: p1Id, cantidad: 3 }, tokenR);
      assert.strictEqual(res.status, 201);
      const consumo = await res.json();
      ri02ConsumoId = consumo.id;

      // Stock pasa a 7
      const resRep = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [p1Id]);
      assert.strictEqual(Number(resRep.rows[0].cantidad_disponible), 7);

      // Movimiento EGRESO con intervencion_id, delta -3 y stock_resultante 7
      const resMov = await client.query('SELECT * FROM movimientos_stock WHERE id = $1', [consumo.movimiento_id]);
      assert.strictEqual(resMov.rowCount, 1);
      const mov = resMov.rows[0];
      assert.strictEqual(mov.tipo, 'EGRESO');
      assert.strictEqual(Number(mov.intervencion_id), ri02IntId);
      assert.strictEqual(Number(mov.delta), -3);
      assert.strictEqual(Number(mov.stock_resultante), 7);

      // Consumo con costo_unitario_aplicado 100
      assert.strictEqual(consumo.costo_unitario_aplicado, 100);
      assert.strictEqual(consumo.importe, 300);
      assert.strictEqual(consumo.movio_stock, true);

      // Intervención con costo_repuestos 300 y costo_total_estimado igual a costo_mano_obra + 300
      const resInt = await client.query('SELECT costo_mano_obra, costo_repuestos, costo_total_estimado FROM intervenciones WHERE id = $1', [ri02IntId]);
      const iRow = resInt.rows[0];
      assert.strictEqual(Number(iRow.costo_repuestos), 300);
      assert.strictEqual(Number(iRow.costo_total_estimado), Number(iRow.costo_mano_obra) + 300);
    });

    // =========================================================================
    // RI-03: Costo histórico
    // =========================================================================
    await t.test('RI-03: Costo histórico del repuesto', async () => {
      // R cambia costo de P1 a 150
      const rEdit = await putJson(`/api/repuestos/${p1Id}`, { costo_unitario: 150 }, tokenR);
      assert.strictEqual(rEdit.status, 200);

      // El consumo de RI-02 sigue en 100
      const resC02 = await client.query('SELECT costo_unitario_aplicado FROM intervencion_repuestos WHERE id = $1', [ri02ConsumoId]);
      assert.strictEqual(Number(resC02.rows[0].costo_unitario_aplicado), 100);

      // Consumo nuevo de P1 x 1 sale a 150
      const rConsNuevo = await postJson(`/api/intervenciones/${ri02IntId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenR);
      assert.strictEqual(rConsNuevo.status, 201);
      const cNuevo = await rConsNuevo.json();
      assert.strictEqual(cNuevo.costo_unitario_aplicado, 150);

      // costo_repuestos pasa a 450 (300 + 150)
      const resInt = await client.query('SELECT costo_repuestos FROM intervenciones WHERE id = $1', [ri02IntId]);
      assert.strictEqual(Number(resInt.rows[0].costo_repuestos), 450);
    });

    // =========================================================================
    // RI-04: Sin control de stock
    // =========================================================================
    let ri04ConsumoP2Id = 0;
    await t.test('RI-04: Repuestos sin control de stock', async () => {
      const intId = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);

      // P2 x 2: sin movimiento, movio_stock false
      const r1 = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p2Id, cantidad: 2 }, tokenR);
      assert.strictEqual(r1.status, 201);
      const d1 = await r1.json();
      assert.strictEqual(d1.movimiento_id, null);
      assert.strictEqual(d1.movio_stock, false);
      assert.strictEqual(d1.costo_unitario_aplicado, 50);
      ri04ConsumoP2Id = d1.id;

      // R con costo_unitario 60: se aplica 60, el costo de P2 pasa a 60 y hay fila CONSUMO en historial
      const r2 = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p2Id, cantidad: 1, costo_unitario: 60 }, tokenR);
      assert.strictEqual(r2.status, 201);
      const d2 = await r2.json();
      assert.strictEqual(d2.costo_unitario_aplicado, 60);

      const resP2DB = await client.query('SELECT costo_unitario FROM repuestos WHERE id = $1', [p2Id]);
      assert.strictEqual(Number(resP2DB.rows[0].costo_unitario), 60);

      const resHist = await client.query('SELECT * FROM repuesto_costos WHERE repuesto_id = $1 AND origen = $2', [p2Id, 'CONSUMO']);
      assert.ok(resHist.rowCount! >= 1);
      assert.strictEqual(Number(resHist.rows[0].costo_unitario), 60);

      // Asignar intervención a T para probar regla de actor
      await client.query('UPDATE intervenciones SET responsable_usuario_id = $1 WHERE id = $2', [tId, intId]);

      // T con costo_unitario: 403
      const r3 = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p2Id, cantidad: 1, costo_unitario: 70 }, tokenT);
      assert.strictEqual(r3.status, 403);
      assert.strictEqual((await r3.json()).codigo, 'PERMISO_INSUFICIENTE');

      // costo_unitario en P1 (con control de stock): 422
      const r4 = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1, costo_unitario: 120 }, tokenR);
      assert.strictEqual(r4.status, 422);
      assert.strictEqual((await r4.json()).codigo, 'DATOS_INVALIDOS');
    });

    // =========================================================================
    // RI-05: Datos
    // =========================================================================
    await t.test('RI-05: Validaciones de datos en consumos', async () => {
      const intId = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);

      // P1 x 99: 409 STOCK_INSUFICIENTE con disponible
      const rStock = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 99 }, tokenR);
      assert.strictEqual(rStock.status, 409);
      const dStock = await rStock.json();
      assert.strictEqual(dStock.codigo, 'STOCK_INSUFICIENTE');
      assert.ok(typeof dStock.disponible === 'number');

      // P3 (inactivo): 409 REPUESTO_INACTIVO
      const rInac = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p3Id, cantidad: 1 }, tokenR);
      assert.strictEqual(rInac.status, 409);
      assert.strictEqual((await rInac.json()).codigo, 'REPUESTO_INACTIVO');

      // Id inexistente: 404 REPUESTO_NO_ENCONTRADO
      const rNoEnc = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: 99999999, cantidad: 1 }, tokenR);
      assert.strictEqual(rNoEnc.status, 404);
      assert.strictEqual((await rNoEnc.json()).codigo, 'REPUESTO_NO_ENCONTRADO');

      // Cantidad 0, negativa, 4 decimales o como texto: 422
      const rCero = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 0 }, tokenR);
      assert.strictEqual(rCero.status, 422);

      const rNeg = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: -5 }, tokenR);
      assert.strictEqual(rNeg.status, 422);

      const rDec = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1.2345 }, tokenR);
      assert.strictEqual(rDec.status, 422);

      const rTxt = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 'dos' }, tokenR);
      assert.strictEqual(rTxt.status, 422);
    });

    // =========================================================================
    // RI-06: Permisos
    // =========================================================================
    await t.test('RI-06: Control de permisos en consumos', async () => {
      const intId = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);

      // O: 403 PERMISO_INSUFICIENTE
      const rO = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenO);
      assert.strictEqual(rO.status, 403);
      assert.strictEqual((await rO.json()).codigo, 'PERMISO_INSUFICIENTE');

      // D: 403 PERMISO_INSUFICIENTE
      const rD = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenD);
      assert.strictEqual(rD.status, 403);
      assert.strictEqual((await rD.json()).codigo, 'PERMISO_INSUFICIENTE');

      // R2: 403 NO_ES_RESPONSABLE
      const rR2 = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenR2);
      assert.strictEqual(rR2.status, 403);
      assert.strictEqual((await rR2.json()).codigo, 'NO_ES_RESPONSABLE');

      // O2, que no la ve: 404
      const rO2 = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenO2);
      assert.strictEqual(rO2.status, 404);
      assert.strictEqual((await rO2.json()).codigo, 'INTERVENCION_NO_ENCONTRADA');
    });

    // =========================================================================
    // RI-07: Anular
    // =========================================================================
    await t.test('RI-07: Anulación de consumos', async () => {
      // Sin motivo: 422 MOTIVO_REQUERIDO
      const rSinMot = await postJson(`/api/intervenciones/${ri02IntId}/repuestos/${ri02ConsumoId}/anular`, { motivo: 'abc' }, tokenR);
      assert.strictEqual(rSinMot.status, 422);
      assert.strictEqual((await rSinMot.json()).codigo, 'MOTIVO_REQUERIDO');

      // Obtener stock antes de anular
      const resStockAntes = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [p1Id]);
      const stockAntes = Number(resStockAntes.rows[0].cantidad_disponible);

      // El de RI-02 con motivo: 200
      const rAnular = await postJson(`/api/intervenciones/${ri02IntId}/repuestos/${ri02ConsumoId}/anular`, { motivo: 'Error en la carga inicial' }, tokenR);
      assert.strictEqual(rAnular.status, 200);
      const dAnul = await rAnular.json();
      assert.strictEqual(dAnul.anulado, true);
      assert.ok(dAnul.anulado_en);
      assert.strictEqual(dAnul.anulado_por.id, rId);
      assert.strictEqual(dAnul.motivo_anulacion, 'Error en la carga inicial');

      // DEVOLUCION con delta +3
      const resDev = await client.query('SELECT * FROM movimientos_stock WHERE tipo = $1 ORDER BY id DESC LIMIT 1', ['DEVOLUCION']);
      assert.strictEqual(resDev.rowCount, 1);
      assert.strictEqual(Number(resDev.rows[0].delta), 3);

      // El stock vuelve (+3)
      const resStockDesp = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [p1Id]);
      assert.strictEqual(Number(resStockDesp.rows[0].cantidad_disponible), stockAntes + 3);

      // costo_repuestos sin esos 300 (debe quedar en 150)
      const resInt = await client.query('SELECT costo_repuestos FROM intervenciones WHERE id = $1', [ri02IntId]);
      assert.strictEqual(Number(resInt.rows[0].costo_repuestos), 150);

      // Otra vez: 409 CONSUMO_YA_ANULADO
      const rOtraVez = await postJson(`/api/intervenciones/${ri02IntId}/repuestos/${ri02ConsumoId}/anular`, { motivo: 'Otra vez anular' }, tokenR);
      assert.strictEqual(rOtraVez.status, 409);
      assert.strictEqual((await rOtraVez.json()).codigo, 'CONSUMO_YA_ANULADO');

      // Uno de P2: 200, sin movimiento
      const rConsP2 = await postJson(`/api/intervenciones/${ri02IntId}/repuestos`, { repuesto_id: p2Id, cantidad: 1 }, tokenR);
      assert.strictEqual(rConsP2.status, 201);
      const cP2 = await rConsP2.json();

      const countMovAntes = await client.query('SELECT COUNT(*) FROM movimientos_stock');
      const rAnulP2 = await postJson(`/api/intervenciones/${ri02IntId}/repuestos/${cP2.id}/anular`, { motivo: 'Anulación de P2' }, tokenR);
      assert.strictEqual(rAnulP2.status, 200);
      const countMovDesp = await client.query('SELECT COUNT(*) FROM movimientos_stock');
      assert.strictEqual(Number(countMovAntes.rows[0].count), Number(countMovDesp.rows[0].count));

      // Un consumoId de otra intervención: 404 CONSUMO_NO_ENCONTRADO
      const otroIntId = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${otroIntId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);
      const rConsOtro = await postJson(`/api/intervenciones/${otroIntId}/repuestos/${ri02ConsumoId}/anular`, { motivo: 'Anular en otra intervencion' }, tokenR);
      assert.strictEqual(rConsOtro.status, 404);
      assert.strictEqual((await rConsOtro.json()).codigo, 'CONSUMO_NO_ENCONTRADO');
    });

    // =========================================================================
    // RI-08: FINALIZADA
    // =========================================================================
    await t.test('RI-08: Consumos en intervención FINALIZADA y auditoría', async () => {
      const intId = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);

      // Finalizar por la API
      const rFin = await postJson(
        `/api/intervenciones/${intId}/finalizar`,
        { estado_esperado: 'EN_PROCESO', trabajo_realizado: 'Reparación completada', ejecucion: 'INTERNA' },
        tokenR
      );
      assert.strictEqual(rFin.status, 200);

      // R registra: 403 PERMISO_INSUFICIENTE (no tiene INTERVENCIONES_CORREGIR)
      const rRegR = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenR);
      assert.strictEqual(rRegR.status, 403);
      assert.strictEqual((await rRegR.json()).codigo, 'PERMISO_INSUFICIENTE');

      // A sin motivo: 422 MOTIVO_REQUERIDO
      const rRegASinMot = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenA);
      assert.strictEqual(rRegASinMot.status, 422);
      assert.strictEqual((await rRegASinMot.json()).codigo, 'MOTIVO_REQUERIDO');

      // A con motivo: 201
      const rRegA = await postJson(
        `/api/intervenciones/${intId}/repuestos`,
        { repuesto_id: p1Id, cantidad: 1, motivo: 'Se olvidó cargar repuesto' },
        tokenA
      );
      assert.strictEqual(rRegA.status, 201);
      const cCreado = await rRegA.json();

      // Auditoría CORRECCION_COSTO con campo repuestos, valor_nuevo "Se agregó: ...", sin importe ni costo
      const resAud = await client.query(
        `SELECT * FROM intervencion_auditoria WHERE intervencion_id = $1 AND tipo_evento = 'CORRECCION_COSTO' ORDER BY id DESC LIMIT 1`,
        [intId]
      );
      assert.strictEqual(resAud.rowCount, 1);
      const audRow = resAud.rows[0];
      assert.strictEqual(audRow.campo_modificado, 'repuestos');
      assert.ok(audRow.valor_nuevo.startsWith('Se agregó:'));
      assert.ok(audRow.valor_nuevo.includes('1'));
      assert.strictEqual(audRow.motivo, 'Se olvidó cargar repuesto');
      assert.ok(!audRow.valor_nuevo.includes('$'));
      assert.ok(!audRow.valor_nuevo.toLowerCase().includes('costo'));
      assert.ok(!audRow.valor_nuevo.toLowerCase().includes('importe'));

      // A anula: 200 y otra auditoría con "Se anuló"
      const rAnulA = await postJson(
        `/api/intervenciones/${intId}/repuestos/${cCreado.id}/anular`,
        { motivo: 'Anulado por error de tipeo' },
        tokenA
      );
      assert.strictEqual(rAnulA.status, 200);

      const resAudAnul = await client.query(
        `SELECT * FROM intervencion_auditoria WHERE intervencion_id = $1 AND tipo_evento = 'CORRECCION_COSTO' ORDER BY id DESC LIMIT 1`,
        [intId]
      );
      assert.strictEqual(resAudAnul.rowCount, 1);
      const audAnulRow = resAudAnul.rows[0];
      assert.strictEqual(audAnulRow.campo_modificado, 'repuestos');
      assert.ok(audAnulRow.valor_nuevo.startsWith('Se anuló:'));
      assert.strictEqual(audAnulRow.motivo, 'Anulado por error de tipeo');
    });

    // =========================================================================
    // RI-09: CANCELADA (D-20)
    // =========================================================================
    await t.test('RI-09: Intervención CANCELADA no mueve stock, anulación posterior sí', async () => {
      const intId = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);

      // Registrar P1 x 2
      const rReg = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 2 }, tokenR);
      assert.strictEqual(rReg.status, 201);
      const consumo = await rReg.json();

      const resStock1 = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [p1Id]);
      const stockDespConsumo = Number(resStock1.rows[0].cantidad_disponible);

      // Cancelar por la API
      const rCanc = await postJson(`/api/intervenciones/${intId}/cancelar`, { estado_esperado: 'EN_PROCESO', motivo: 'Cancelada por cambio de orden' }, tokenR);
      assert.strictEqual(rCanc.status, 200);

      // El stock no cambia
      const resStock2 = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [p1Id]);
      assert.strictEqual(Number(resStock2.rows[0].cantidad_disponible), stockDespConsumo);

      // R anula: 403
      const rAnulR = await postJson(`/api/intervenciones/${intId}/repuestos/${consumo.id}/anular`, { motivo: 'Devolver stock' }, tokenR);
      assert.strictEqual(rAnulR.status, 403);

      // A anula con motivo: 200 y el stock vuelve
      const rAnulA = await postJson(`/api/intervenciones/${intId}/repuestos/${consumo.id}/anular`, { motivo: 'Devolver stock autorizado' }, tokenA);
      assert.strictEqual(rAnulA.status, 200);

      const resStock3 = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [p1Id]);
      assert.strictEqual(Number(resStock3.rows[0].cantidad_disponible), stockDespConsumo + 2);
    });

    // =========================================================================
    // RI-10: Reabrir
    // =========================================================================
    await t.test('RI-10: Reabrir intervención conserva consumos y permite registrar', async () => {
      const intId = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);

      await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenR);

      // Finalizar por API
      await postJson(`/api/intervenciones/${intId}/finalizar`, { estado_esperado: 'EN_PROCESO', trabajo_realizado: 'Hecho', ejecucion: 'INTERNA' }, tokenR);

      const resStockAntes = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [p1Id]);
      const stockAntesReabrir = Number(resStockAntes.rows[0].cantidad_disponible);

      // Reabrir por API
      const rReab = await postJson(`/api/intervenciones/${intId}/reabrir`, { estado_esperado: 'FINALIZADA', motivo: 'Reapertura para ajustar', maquina_detenida: false }, tokenR);
      assert.strictEqual(rReab.status, 200);

      // Consumos siguen y stock no cambia
      const resStockDesp = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [p1Id]);
      assert.strictEqual(Number(resStockDesp.rows[0].cantidad_disponible), stockAntesReabrir);

      // R vuelve a poder registrar
      const rReg = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenR);
      assert.strictEqual(rReg.status, 201);
    });

    // =========================================================================
    // RI-11: GET y lo que puede cada uno
    // =========================================================================
    await t.test('RI-11: GET consumos, orden y banderas de permisos', async () => {
      const intId = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);

      const rC1 = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p1Id, cantidad: 1 }, tokenR);
      const c1 = await rC1.json();
      const rC2 = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: p2Id, cantidad: 2 }, tokenR);
      const c2 = await rC2.json();

      // Anular c1
      await postJson(`/api/intervenciones/${intId}/repuestos/${c1.id}/anular`, { motivo: 'Anular para probar orden' }, tokenR);

      // GET con R (en EN_PROCESO)
      const resGetR = await getJson(`/api/intervenciones/${intId}/repuestos`, tokenR);
      assert.strictEqual(resGetR.status, 200);
      const dataR = await resGetR.json();

      // Orden del más viejo al más nuevo, con los anulados
      assert.strictEqual(dataR.consumos.length, 2);
      assert.strictEqual(dataR.consumos[0].id, c1.id);
      assert.strictEqual(dataR.consumos[0].anulado, true);
      assert.strictEqual(dataR.consumos[1].id, c2.id);
      assert.strictEqual(dataR.consumos[1].anulado, false);

      // puede_registrar y puede_anular true para R en EN_PROCESO
      assert.strictEqual(dataR.puede_registrar, true);
      assert.strictEqual(dataR.puede_anular, true);
      assert.strictEqual(dataR.ve_costos, true);
      assert.ok(dataR.total_repuestos !== null);

      // T y O: costo_unitario_aplicado, importe y total_repuestos en null, ve_costos false
      const resGetT = await getJson(`/api/intervenciones/${intId}/repuestos`, tokenT);
      const dataT = await resGetT.json();
      assert.strictEqual(dataT.ve_costos, false);
      assert.strictEqual(dataT.total_repuestos, null);
      assert.strictEqual(dataT.consumos[0].costo_unitario_aplicado, null);
      assert.strictEqual(dataT.consumos[0].importe, null);

      const resGetO = await getJson(`/api/intervenciones/${intId}/repuestos`, tokenO);
      const dataO = await resGetO.json();
      assert.strictEqual(dataO.ve_costos, false);
      assert.strictEqual(dataO.total_repuestos, null);
      assert.strictEqual(dataO.puede_registrar, false);
      assert.strictEqual(dataO.puede_anular, false);

      // Finalizar la intervención y chequear flags
      const rFin = await postJson(
        `/api/intervenciones/${intId}/finalizar`,
        { estado_esperado: 'EN_PROCESO', trabajo_realizado: 'Trabajo finalizado completo', ejecucion: 'INTERNA' },
        tokenR
      );
      assert.strictEqual(rFin.status, 200);

      const resGetRFin = await getJson(`/api/intervenciones/${intId}/repuestos`, tokenR);
      const dataRFin = await resGetRFin.json();
      assert.strictEqual(dataRFin.puede_registrar, false);
      assert.strictEqual(dataRFin.puede_anular, false);

      const resGetAFin = await getJson(`/api/intervenciones/${intId}/repuestos`, tokenA);
      const dataAFin = await resGetAFin.json();
      assert.strictEqual(dataAFin.puede_registrar, true);
      assert.strictEqual(dataAFin.puede_anular, true);
    });

    // =========================================================================
    // RI-12: Concurrencia
    // =========================================================================
    await t.test('RI-12: Concurrencia en consumos y anulaciones', async () => {
      // Repuesto propio con stock 2
      const resPConc = await postJson(
        '/api/repuestos',
        { codigo: `P_CONC_${suf}`, nombre: `P Conc ${suf}`, lleva_stock: true, stock_inicial: 2, costo_unitario: 50 },
        tokenR
      );
      assert.strictEqual(resPConc.status, 201);
      const pConc = await resPConc.json();
      createdRepuestoIds.push(pConc.id);

      const intId = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);

      // Dos consumos de 2 a la vez: uno 201 y otro 409
      const [rC1, rC2] = await Promise.all([
        postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: pConc.id, cantidad: 2 }, tokenR),
        postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: pConc.id, cantidad: 2 }, tokenR),
      ]);

      const statuses = [rC1.status, rC2.status].sort();
      assert.deepStrictEqual(statuses, [201, 409]);

      const exitoCons = rC1.status === 201 ? await rC1.json() : await rC2.json();

      // Queda en 0 con un solo egreso
      const resStock = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [pConc.id]);
      assert.strictEqual(Number(resStock.rows[0].cantidad_disponible), 0);

      const resMovs = await client.query('SELECT * FROM movimientos_stock WHERE repuesto_id = $1 AND tipo = $2', [pConc.id, 'EGRESO']);
      assert.strictEqual(resMovs.rowCount, 1);

      // Dos anulaciones a la vez del mismo consumo: una 200 y otra 409
      const [rA1, rA2] = await Promise.all([
        postJson(`/api/intervenciones/${intId}/repuestos/${exitoCons.id}/anular`, { motivo: 'Anulación concurrente' }, tokenR),
        postJson(`/api/intervenciones/${intId}/repuestos/${exitoCons.id}/anular`, { motivo: 'Anulación concurrente' }, tokenR),
      ]);

      const anulStatuses = [rA1.status, rA2.status].sort();
      assert.deepStrictEqual(anulStatuses, [200, 409]);

      // Una sola devolución
      const resDevs = await client.query('SELECT * FROM movimientos_stock WHERE repuesto_id = $1 AND tipo = $2', [pConc.id, 'DEVOLUCION']);
      assert.strictEqual(resDevs.rowCount, 1);
    });

    // =========================================================================
    // RI-13: Alta de pedidos
    // =========================================================================
    let ri13IntId = 0;
    await t.test('RI-13: Alta de pedidos de repuestos', async () => {
      ri13IntId = await crearIntervencion(m1Id);
      // EN_ESPERA_REPUESTOS
      await postJson(`/api/intervenciones/${ri13IntId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);
      await postJson(`/api/intervenciones/${ri13IntId}/espera-repuestos`, { estado_esperado: 'EN_PROCESO' }, tokenR);

      // Con P1 y sin fecha: PENDIENTE
      const rPend = await postJson(`/api/intervenciones/${ri13IntId}/pedidos`, { repuesto_id: p1Id, cantidad: 2 }, tokenR);
      assert.strictEqual(rPend.status, 201);
      const dPend = await rPend.json();
      assert.strictEqual(dPend.estado, 'PENDIENTE');
      assert.strictEqual(dPend.pedido_en, null);
      assert.strictEqual(dPend.esperado_para, null);

      // Con pedido_en 2026-11-03 y esperado_para 2026-11-10: PEDIDO y fechas devueltas exactamente así
      const rPed = await postJson(
        `/api/intervenciones/${ri13IntId}/pedidos`,
        { repuesto_id: p1Id, cantidad: 1, pedido_en: '2026-11-03', esperado_para: '2026-11-10' },
        tokenR
      );
      assert.strictEqual(rPed.status, 201);
      const dPed = await rPed.json();
      assert.strictEqual(dPed.estado, 'PEDIDO');
      assert.strictEqual(dPed.pedido_en, '2026-11-03');
      assert.strictEqual(dPed.esperado_para, '2026-11-10');

      // Solo con descripción: 201
      const rDesc = await postJson(`/api/intervenciones/${ri13IntId}/pedidos`, { descripcion: 'Rodamiento especial', cantidad: 1 }, tokenR);
      assert.strictEqual(rDesc.status, 201);

      // Sin repuesto ni descripción: 422
      const rVacio = await postJson(`/api/intervenciones/${ri13IntId}/pedidos`, { cantidad: 1 }, tokenR);
      assert.strictEqual(rVacio.status, 422);

      // esperado_para antes de pedido_en: 422
      const rIncoherente = await postJson(
        `/api/intervenciones/${ri13IntId}/pedidos`,
        { repuesto_id: p1Id, cantidad: 1, pedido_en: '2026-11-10', esperado_para: '2026-11-03' },
        tokenR
      );
      assert.strictEqual(rIncoherente.status, 422);

      // Fecha 2026-02-30: 422
      const rFechaInval = await postJson(
        `/api/intervenciones/${ri13IntId}/pedidos`,
        { repuesto_id: p1Id, cantidad: 1, pedido_en: '2026-02-30' },
        tokenR
      );
      assert.strictEqual(rFechaInval.status, 422);

      // En una PENDIENTE: 409 ESTADO_NO_PERMITE_PEDIDOS
      const intPendId = await crearIntervencion(m1Id);
      const rPendBloq = await postJson(`/api/intervenciones/${intPendId}/pedidos`, { repuesto_id: p1Id, cantidad: 1 }, tokenR);
      assert.strictEqual(rPendBloq.status, 409);
      assert.strictEqual((await rPendBloq.json()).codigo, 'ESTADO_NO_PERMITE_PEDIDOS');
    });

    // =========================================================================
    // RI-14: Permisos de pedidos
    // =========================================================================
    await t.test('RI-14: Control de permisos en pedidos', async () => {
      // D (con REPUESTOS_GESTIONAR) sí puede dar de alta, editar, recibir y cancelar pedidos
      const rAltaD = await postJson(`/api/intervenciones/${ri13IntId}/pedidos`, { repuesto_id: p1Id, cantidad: 1 }, tokenD);
      assert.strictEqual(rAltaD.status, 201);
      const pedD = await rAltaD.json();

      const rEditD = await patchJson(`/api/intervenciones/${ri13IntId}/pedidos/${pedD.id}`, { observacion: 'Obs por D' }, tokenD);
      assert.strictEqual(rEditD.status, 200);

      // R2: 403 NO_ES_RESPONSABLE
      const rR2 = await postJson(`/api/intervenciones/${ri13IntId}/pedidos`, { repuesto_id: p1Id, cantidad: 1 }, tokenR2);
      assert.strictEqual(rR2.status, 403);
      assert.strictEqual((await rR2.json()).codigo, 'NO_ES_RESPONSABLE');

      // O: 403 PERMISO_INSUFICIENTE
      const rO = await postJson(`/api/intervenciones/${ri13IntId}/pedidos`, { repuesto_id: p1Id, cantidad: 1 }, tokenO);
      assert.strictEqual(rO.status, 403);
      assert.strictEqual((await rO.json()).codigo, 'PERMISO_INSUFICIENTE');

      // GET /:id/pedidos verifica banderas
      const rGetD = await getJson(`/api/intervenciones/${ri13IntId}/pedidos`, tokenD);
      const dFlagsD = await rGetD.json();
      assert.strictEqual(dFlagsD.puede_crear, true);
      assert.strictEqual(dFlagsD.puede_gestionar, true);

      const rGetO = await getJson(`/api/intervenciones/${ri13IntId}/pedidos`, tokenO);
      const dFlagsO = await rGetO.json();
      assert.strictEqual(dFlagsO.puede_crear, false);
      assert.strictEqual(dFlagsO.puede_gestionar, false);
    });

    // =========================================================================
    // RI-15: Ciclo del pedido
    // =========================================================================
    await t.test('RI-15: Ciclo de vida del pedido', async () => {
      // Alta PENDIENTE
      const rAlta = await postJson(`/api/intervenciones/${ri13IntId}/pedidos`, { repuesto_id: p1Id, cantidad: 4, proveedor_id: prov1Id }, tokenR);
      assert.strictEqual(rAlta.status, 201);
      const pedido = await rAlta.json();

      // PATCH con pedido_en -> PEDIDO
      const rPatch1 = await patchJson(`/api/intervenciones/${ri13IntId}/pedidos/${pedido.id}`, { pedido_en: '2026-11-05' }, tokenR);
      assert.strictEqual(rPatch1.status, 200);
      assert.strictEqual((await rPatch1.json()).estado, 'PEDIDO');

      // PATCH con pedido_en: null -> PENDIENTE
      const rPatch2 = await patchJson(`/api/intervenciones/${ri13IntId}/pedidos/${pedido.id}`, { pedido_en: null }, tokenR);
      assert.strictEqual(rPatch2.status, 200);
      assert.strictEqual((await rPatch2.json()).estado, 'PENDIENTE');

      // Stock de P1 antes de recibir
      const resStockAntes = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [p1Id]);
      const stockAntes = Number(resStockAntes.rows[0].cantidad_disponible);

      // Recibir P1 x 4 con ingresar_stock: RECIBIDO, un INGRESO de 4 con el proveedor del pedido, movimiento_id completo, stock sube 4
      const rRecibir = await postJson(
        `/api/intervenciones/${ri13IntId}/pedidos/${pedido.id}/recibir`,
        { ingresar_stock: true, comprobante: 'FAC-001' },
        tokenR
      );
      assert.strictEqual(rRecibir.status, 200);
      const dRec = await rRecibir.json();
      assert.strictEqual(dRec.estado, 'RECIBIDO');
      assert.ok(dRec.ingreso_stock);

      const resStockDesp = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [p1Id]);
      assert.strictEqual(Number(resStockDesp.rows[0].cantidad_disponible), stockAntes + 4);

      const resMov = await client.query('SELECT * FROM movimientos_stock WHERE tipo = $1 AND proveedor_id = $2 ORDER BY id DESC LIMIT 1', ['INGRESO', prov1Id]);
      assert.strictEqual(resMov.rowCount, 1);
      assert.strictEqual(Number(resMov.rows[0].delta), 4);
      assert.strictEqual(resMov.rows[0].comprobante, 'FAC-001');

      // Recibir otra vez o editarlo: 409 PEDIDO_CERRADO
      const rRecOtraVez = await postJson(`/api/intervenciones/${ri13IntId}/pedidos/${pedido.id}/recibir`, {}, tokenR);
      assert.strictEqual(rRecOtraVez.status, 409);
      assert.strictEqual((await rRecOtraVez.json()).codigo, 'PEDIDO_CERRADO');

      const rEditCerrado = await patchJson(`/api/intervenciones/${ri13IntId}/pedidos/${pedido.id}`, { observacion: 'Intento' }, tokenR);
      assert.strictEqual(rEditCerrado.status, 409);
      assert.strictEqual((await rEditCerrado.json()).codigo, 'PEDIDO_CERRADO');

      // Recibir uno solo con descripción, con ingresar_stock: 422 PEDIDO_SIN_REPUESTO
      const rPedSoloDesc = await postJson(`/api/intervenciones/${ri13IntId}/pedidos`, { descripcion: 'Insumo sin catalogo', cantidad: 1 }, tokenR);
      const pedSoloDesc = await rPedSoloDesc.json();

      const rRecInval = await postJson(`/api/intervenciones/${ri13IntId}/pedidos/${pedSoloDesc.id}/recibir`, { ingresar_stock: true }, tokenR);
      assert.strictEqual(rRecInval.status, 422);
      assert.strictEqual((await rRecInval.json()).codigo, 'PEDIDO_SIN_REPUESTO');

      // recibido_en de mañana: 422 FECHA_INCOHERENTE
      const fechaManana = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const rManana = await postJson(`/api/intervenciones/${ri13IntId}/pedidos/${pedSoloDesc.id}/recibir`, { recibido_en: fechaManana }, tokenR);
      assert.strictEqual(rManana.status, 422);
      assert.strictEqual((await rManana.json()).codigo, 'FECHA_INCOHERENTE');

      // Cancelar sin motivo: 422. Con motivo: CANCELADO
      const rCancSinMot = await postJson(`/api/intervenciones/${ri13IntId}/pedidos/${pedSoloDesc.id}/cancelar`, { motivo: 'ab' }, tokenR);
      assert.strictEqual(rCancSinMot.status, 422);

      const rCancOk = await postJson(`/api/intervenciones/${ri13IntId}/pedidos/${pedSoloDesc.id}/cancelar`, { motivo: 'No se necesita más' }, tokenR);
      assert.strictEqual(rCancOk.status, 200);
      assert.strictEqual((await rCancOk.json()).estado, 'CANCELADO');
    });

    // =========================================================================
    // RI-16: Intervención cerrada
    // =========================================================================
    await t.test('RI-16: Recibir pedido con intervención cancelada funciona igual', async () => {
      const intId = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);
      await postJson(`/api/intervenciones/${intId}/espera-repuestos`, { estado_esperado: 'EN_PROCESO' }, tokenR);

      const rPed = await postJson(`/api/intervenciones/${intId}/pedidos`, { repuesto_id: p1Id, cantidad: 1 }, tokenR);
      const pedido = await rPed.json();

      // Cancelar la intervención
      await postJson(`/api/intervenciones/${intId}/cancelar`, { estado_esperado: 'EN_ESPERA_REPUESTOS', motivo: 'Intervención descartada' }, tokenR);

      // Recibirlo con ingresar_stock funciona igual
      const rRec = await postJson(`/api/intervenciones/${intId}/pedidos/${pedido.id}/recibir`, { ingresar_stock: true }, tokenR);
      assert.strictEqual(rRec.status, 200);
      assert.strictEqual((await rRec.json()).estado, 'RECIBIDO');
    });

    // =========================================================================
    // RI-17: Lista general
    // =========================================================================
    await t.test('RI-17: Lista general GET /api/pedidos-repuesto', async () => {
      // Sin parámetros: solo PENDIENTE y PEDIDO
      const rAbiertos = await getJson('/api/pedidos-repuesto', tokenR);
      assert.strictEqual(rAbiertos.status, 200);
      const dAbiertos = await rAbiertos.json();
      assert.ok(Array.isArray(dAbiertos));
      for (const p of dAbiertos) {
        assert.ok(p.estado === 'PENDIENTE' || p.estado === 'PEDIDO');
        assert.ok(p.intervencion && p.intervencion.id);
        assert.ok(p.maquina && p.maquina.codigo);
        assert.ok(p.sector && p.sector.nombre);
      }

      // estado=TODOS: también los cerrados
      const rTodos = await getJson('/api/pedidos-repuesto?estado=TODOS', tokenR);
      assert.strictEqual(rTodos.status, 200);
      const dTodos = await rTodos.json();
      assert.ok(dTodos.some((p: any) => p.estado === 'RECIBIDO' || p.estado === 'CANCELADO'));

      // estado=OTRO: 422
      const rInval = await getJson('/api/pedidos-repuesto?estado=OTRO', tokenR);
      assert.strictEqual(rInval.status, 422);

      // O: 403
      const rO = await getJson('/api/pedidos-repuesto', tokenO);
      assert.strictEqual(rO.status, 403);
    });

    // =========================================================================
    // RI-18: Reporte
    // =========================================================================
    await t.test('RI-18: Reporte GET /api/reportes/repuestos', async () => {
      // Repuestos propios del caso: Q1 (con stock) y Q2 (sin control)
      const resQ1 = await postJson(
        '/api/repuestos',
        { codigo: `Q1_${suf}`, nombre: `Q1 Repuesto ${suf}`, lleva_stock: true, stock_inicial: 20, costo_unitario: 100 },
        tokenR
      );
      const q1 = await resQ1.json();
      createdRepuestoIds.push(q1.id);

      const resQ2 = await postJson(
        '/api/repuestos',
        { codigo: `Q2_${suf}`, nombre: `Q2 Repuesto ${suf}`, lleva_stock: false, costo_unitario: 50 },
        tokenR
      );
      const q2 = await resQ2.json();
      createdRepuestoIds.push(q2.id);

      // Intervención en M1 (PL1, S1)
      const intM1 = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${intM1}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);

      // Q1 x 3 a 100
      const rM1C1 = await postJson(`/api/intervenciones/${intM1}/repuestos`, { repuesto_id: q1.id, cantidad: 3 }, tokenR);
      const m1C1 = await rM1C1.json();

      // Cambiar costo de Q1 a 150
      await putJson(`/api/repuestos/${q1.id}`, { costo_unitario: 150 }, tokenR);

      // Q1 x 1 a 150
      const rM1C2 = await postJson(`/api/intervenciones/${intM1}/repuestos`, { repuesto_id: q1.id, cantidad: 1 }, tokenR);
      const m1C2 = await rM1C2.json();

      // Intervención en M2 (PL2, S2)
      const intM2 = await crearIntervencion(m2Id);
      await postJson(`/api/intervenciones/${intM2}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);

      // Q2 x 5 a 60
      const rM2C1 = await postJson(`/api/intervenciones/${intM2}/repuestos`, { repuesto_id: q2.id, cantidad: 5, costo_unitario: 60 }, tokenR);
      const m2C1 = await rM2C1.json();

      // Consumo anulado (no debe contar)
      const rM1Anul = await postJson(`/api/intervenciones/${intM1}/repuestos`, { repuesto_id: q1.id, cantidad: 2 }, tokenR);
      const m1Anul = await rM1Anul.json();
      await postJson(`/api/intervenciones/${intM1}/repuestos/${m1Anul.id}/anular`, { motivo: 'Anulado para no contar' }, tokenR);

      // Consumo fuera del período (no debe contar)
      const rM1Fuera = await postJson(`/api/intervenciones/${intM1}/repuestos`, { repuesto_id: q1.id, cantidad: 2 }, tokenR);
      const m1Fuera = await rM1Fuera.json();

      // Período fijo en el pasado: 10 días
      const desdeFijo = '2026-06-01T00:00:00.000Z';
      const hastaFijo = '2026-06-11T00:00:00.000Z';

      // Ajustar fechas creado_en por SQL
      await client.query(
        `UPDATE intervencion_repuestos SET creado_en = '2026-06-05T12:00:00.000Z' WHERE id = ANY($1)`,
        [[m1C1.id, m1C2.id, m2C1.id, m1Anul.id]]
      );
      await client.query(
        `UPDATE intervencion_repuestos SET creado_en = '2026-05-15T12:00:00.000Z' WHERE id = $1`,
        [m1Fuera.id]
      );

      // Consulta general del período
      const rRepGeneral = await getJson(`/api/reportes/repuestos?desde=${encodeURIComponent(desdeFijo)}&hasta=${encodeURIComponent(hastaFijo)}`, tokenR);
      assert.strictEqual(rRepGeneral.status, 200);
      const repGen = await rRepGeneral.json();

      // Filtrar resultados a los datos de la prueba
      const consumosPrueba = repGen.por_repuesto.filter((p: any) => p.repuesto.id === q1.id || p.repuesto.id === q2.id);
      assert.strictEqual(consumosPrueba.length, 2);

      // Q1: cantidad 4, consumos 2, importe 450 (3x100 + 1x150)
      const pQ1 = consumosPrueba.find((p: any) => p.repuesto.id === q1.id);
      assert.strictEqual(pQ1.cantidad, 4);
      assert.strictEqual(pQ1.consumos, 2);
      assert.strictEqual(pQ1.intervenciones, 1);
      assert.strictEqual(pQ1.importe, 450);

      // Q2: cantidad 5, consumos 1, importe 300 (5x60)
      const pQ2 = consumosPrueba.find((p: any) => p.repuesto.id === q2.id);
      assert.strictEqual(pQ2.cantidad, 5);
      assert.strictEqual(pQ2.consumos, 1);
      assert.strictEqual(pQ2.intervenciones, 1);
      assert.strictEqual(pQ2.importe, 300);

      // Con ve_costos: Q1 va primero por importe (450 > 300)
      assert.strictEqual(consumosPrueba[0].repuesto.id, q1.id);
      assert.strictEqual(consumosPrueba[1].repuesto.id, q2.id);

      // por_maquina: M1 con 450 y M2 con 300
      const maqPrueba = repGen.por_maquina.filter((m: any) => m.maquina.id === m1Id || m.maquina.id === m2Id);
      assert.strictEqual(maqPrueba.length, 2);
      const maq1 = maqPrueba.find((m: any) => m.maquina.id === m1Id);
      const maq2 = maqPrueba.find((m: any) => m.maquina.id === m2Id);
      assert.strictEqual(maq1.importe, 450);
      assert.strictEqual(maq2.importe, 300);

      // Con planta_id de PL1: solo M1
      const rPL1 = await getJson(`/api/reportes/repuestos?desde=${encodeURIComponent(desdeFijo)}&hasta=${encodeURIComponent(hastaFijo)}&planta_id=${pl1Id}`, tokenR);
      const repPL1 = await rPL1.json();
      const maqPL1 = repPL1.por_maquina.filter((m: any) => m.maquina.id === m1Id || m.maquina.id === m2Id);
      assert.strictEqual(maqPL1.length, 1);
      assert.strictEqual(maqPL1[0].maquina.id, m1Id);

      // Con sector_id de S2: solo M2
      const rS2 = await getJson(`/api/reportes/repuestos?desde=${encodeURIComponent(desdeFijo)}&hasta=${encodeURIComponent(hastaFijo)}&sector_id=${s2Id}`, tokenR);
      const repS2 = await rS2.json();
      const maqS2 = repS2.por_maquina.filter((m: any) => m.maquina.id === m1Id || m.maquina.id === m2Id);
      assert.strictEqual(maqS2.length, 1);
      assert.strictEqual(maqS2[0].maquina.id, m2Id);

      // T: importes en null, ve_costos false, y Q2 primero (por cantidad 5 > 4)
      const rT = await getJson(`/api/reportes/repuestos?desde=${encodeURIComponent(desdeFijo)}&hasta=${encodeURIComponent(hastaFijo)}`, tokenT);
      assert.strictEqual(rT.status, 200);
      const repT = await rT.json();
      assert.strictEqual(repT.ve_costos, false);
      assert.strictEqual(repT.importe_total, null);

      const consumosT = repT.por_repuesto.filter((p: any) => p.repuesto.id === q1.id || p.repuesto.id === q2.id);
      assert.strictEqual(consumosT[0].repuesto.id, q2.id); // Q2 primero por cantidad
      assert.strictEqual(consumosT[0].importe, null);
      assert.strictEqual(consumosT[1].repuesto.id, q1.id);
      assert.strictEqual(consumosT[1].importe, null);

      // X: solo M2
      const rX = await getJson(`/api/reportes/repuestos?desde=${encodeURIComponent(desdeFijo)}&hasta=${encodeURIComponent(hastaFijo)}`, tokenX);
      assert.strictEqual(rX.status, 200);
      const repX = await rX.json();
      const maqX = repX.por_maquina.filter((m: any) => m.maquina.id === m1Id || m.maquina.id === m2Id);
      assert.strictEqual(maqX.length, 1);
      assert.strictEqual(maqX[0].maquina.id, m2Id);

      // O: 403
      const rO = await getJson(`/api/reportes/repuestos?desde=${encodeURIComponent(desdeFijo)}&hasta=${encodeURIComponent(hastaFijo)}`, tokenO);
      assert.strictEqual(rO.status, 403);

      // desde posterior a hasta: 422
      const rInval = await getJson(`/api/reportes/repuestos?desde=${encodeURIComponent(hastaFijo)}&hasta=${encodeURIComponent(desdeFijo)}`, tokenR);
      assert.strictEqual(rInval.status, 422);
    });

    // =========================================================================
    // RI-19: Bajas con pedidos abiertos
    // =========================================================================
    await t.test('RI-19: Bloqueo de baja de repuestos y proveedores con pedidos abiertos', async () => {
      // Repuesto sin stock y proveedor propio
      const rProv = await postJson('/api/proveedores', { nombre: `ProvBaja_${suf}` }, tokenR);
      const provBaja = await rProv.json();
      createdProveedorIds.push(provBaja.id);

      const rRep = await postJson('/api/repuestos', { codigo: `RepBaja_${suf}`, nombre: `Rep Baja ${suf}`, lleva_stock: false }, tokenR);
      const repBaja = await rRep.json();
      createdRepuestoIds.push(repBaja.id);

      // Pedido abierto asociando ambos
      const rPed = await postJson(
        `/api/intervenciones/${ri13IntId}/pedidos`,
        { repuesto_id: repBaja.id, proveedor_id: provBaja.id, cantidad: 1 },
        tokenR
      );
      assert.strictEqual(rPed.status, 201);
      const pedido = await rPed.json();

      // Desactivar el repuesto: 409 EN_USO con pedidos_abiertos 1
      const rDelRep = await deleteJson(`/api/repuestos/${repBaja.id}`, tokenR);
      assert.strictEqual(rDelRep.status, 409);
      const dDelRep = await rDelRep.json();
      assert.strictEqual(dDelRep.codigo, 'EN_USO');
      assert.strictEqual(dDelRep.pedidos_abiertos, 1);

      // Desactivar el proveedor: 409 EN_USO con pedidos_abiertos 1
      const rDelProv = await deleteJson(`/api/proveedores/${provBaja.id}`, tokenR);
      assert.strictEqual(rDelProv.status, 409);
      const dDelProv = await rDelProv.json();
      assert.strictEqual(dDelProv.codigo, 'EN_USO');
      assert.strictEqual(dDelProv.pedidos_abiertos, 1);

      // Cancelar el pedido
      const rCanc = await postJson(`/api/intervenciones/${ri13IntId}/pedidos/${pedido.id}/cancelar`, { motivo: 'Cancelado para permitir baja' }, tokenR);
      assert.strictEqual(rCanc.status, 200);

      // Ahora ambas bajas se permiten (200)
      const rDelRepOk = await deleteJson(`/api/repuestos/${repBaja.id}`, tokenR);
      assert.strictEqual(rDelRepOk.status, 200);

      const rDelProvOk = await deleteJson(`/api/proveedores/${provBaja.id}`, tokenR);
      assert.strictEqual(rDelProvOk.status, 200);
    });

    // =========================================================================
    // RI-20: Redondeo del importe en SQL y total de la intervención
    // =========================================================================
    await t.test('RI-20: Redondeo del importe en SQL y coincidencia con total', async () => {
      // Repuesto 1: costo 2.01
      const resR1 = await postJson(
        '/api/repuestos',
        { codigo: `R20_1_${suf}`, nombre: `R20 Repuesto 1 ${suf}`, costo_unitario: 2.01, lleva_stock: false },
        tokenR
      );
      const r1 = await resR1.json();
      createdRepuestoIds.push(r1.id);

      // Repuesto 2: costo 0.03
      const resR2 = await postJson(
        '/api/repuestos',
        { codigo: `R20_2_${suf}`, nombre: `R20 Repuesto 2 ${suf}`, costo_unitario: 0.03, lleva_stock: false },
        tokenR
      );
      const r2 = await resR2.json();
      createdRepuestoIds.push(r2.id);

      // Intervención en M1
      const intId = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);

      // Consumo 1: 0,5 x 2,01 -> 1,01
      const resC1 = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: r1.id, cantidad: 0.5 }, tokenR);
      assert.strictEqual(resC1.status, 201);
      const c1 = await resC1.json();
      assert.strictEqual(c1.importe, 1.01);

      // Consumo 2: 1,5 x 0,03 -> 0,05
      const resC2 = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: r2.id, cantidad: 1.5 }, tokenR);
      assert.strictEqual(resC2.status, 201);
      const c2 = await resC2.json();
      assert.strictEqual(c2.importe, 0.05);

      // GET /:id/repuestos: importes 1.01 y 0.05, total_repuestos 1.06
      const resLista = await getJson(`/api/intervenciones/${intId}/repuestos`, tokenR);
      const dLista = await resLista.json();
      assert.strictEqual(dLista.total_repuestos, 1.06);
      const con1 = dLista.consumos.find((c: any) => c.id === c1.id);
      const con2 = dLista.consumos.find((c: any) => c.id === c2.id);
      assert.strictEqual(con1.importe, 1.01);
      assert.strictEqual(con2.importe, 0.05);

      // En la base de datos: costo_repuestos es 1.06
      const resDb = await client.query('SELECT costo_repuestos FROM intervenciones WHERE id = $1', [intId]);
      assert.strictEqual(Number(resDb.rows[0].costo_repuestos), 1.06);

      // En el reporte: período aislado
      const desdeR20 = '2026-04-01T00:00:00.000Z';
      const hastaR20 = '2026-04-10T00:00:00.000Z';
      await client.query(
        "UPDATE intervencion_repuestos SET creado_en = '2026-04-05T12:00:00.000Z' WHERE id IN ($1, $2)",
        [c1.id, c2.id]
      );

      const resRep = await getJson(`/api/reportes/repuestos?desde=${encodeURIComponent(desdeR20)}&hasta=${encodeURIComponent(hastaR20)}`, tokenR);
      const dRep = await resRep.json();
      assert.strictEqual(dRep.importe_total, 1.06);
      const item1 = dRep.por_repuesto.find((p: any) => p.repuesto.id === r1.id);
      const item2 = dRep.por_repuesto.find((p: any) => p.repuesto.id === r2.id);
      assert.strictEqual(item1.importe, 1.01);
      assert.strictEqual(item2.importe, 0.05);
    });

    // =========================================================================
    // RI-21: Auditoría de cantidad con formatearCantidad y respuesta de POST
    // =========================================================================
    await t.test('RI-21: Auditoría con formato castellano y respuesta completa del POST', async () => {
      // Repuesto en litros
      const resLitro = await postJson(
        '/api/repuestos',
        { codigo: `ACE_${suf}`, nombre: `Aceite Industrial ${suf}`, unidad: 'litro', costo_unitario: 50, lleva_stock: false },
        tokenR
      );
      const repLitro = await resLitro.json();
      createdRepuestoIds.push(repLitro.id);

      // Intervención finalizada
      const intId = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);

      // Consumo inicial de 2 litros antes de finalizar
      const rCIni = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: repLitro.id, cantidad: 2 }, tokenR);
      const cIni = await rCIni.json();

      // Finalizar intervención
      const rFin = await postJson(
        `/api/intervenciones/${intId}/finalizar`,
        { estado_esperado: 'EN_PROCESO', trabajo_realizado: 'Reparación completada', ejecucion: 'INTERNA' },
        tokenR
      );
      assert.strictEqual(rFin.status, 200);

      // Registrar 1,5 litros con tokenA (tiene INTERVENCIONES_CORREGIR)
      const rAdd = await postJson(
        `/api/intervenciones/${intId}/repuestos`,
        { repuesto_id: repLitro.id, cantidad: 1.5, motivo: 'Ajuste de consumo post cierre' },
        tokenA
      );
      assert.strictEqual(rAdd.status, 201);
      const dAdd = await rAdd.json();

      // Verificar que el POST responde el formato completo igual al GET
      assert.ok(dAdd.id);
      assert.strictEqual(dAdd.cantidad, 1.5);
      assert.ok(dAdd.registrado_por);
      assert.strictEqual(typeof dAdd.registrado_por.id, 'number');
      assert.strictEqual(typeof dAdd.registrado_por.nombre, 'string');
      assert.ok(dAdd.registrado_por.nombre.length > 0);

      // Verificar texto de auditoría
      const resAud1 = await client.query(
        "SELECT * FROM intervencion_auditoria WHERE intervencion_id = $1 AND tipo_evento = 'CORRECCION_COSTO' ORDER BY id DESC LIMIT 1",
        [intId]
      );
      assert.strictEqual(resAud1.rowCount, 1);
      assert.strictEqual(resAud1.rows[0].valor_nuevo, `Se agregó: ${repLitro.nombre} × 1,5 litro`);

      // Anular el consumo de 2 litros
      const rAnul = await postJson(
        `/api/intervenciones/${intId}/repuestos/${cIni.id}/anular`,
        { motivo: 'Anulación de los 2 litros iniciales' },
        tokenA
      );
      assert.strictEqual(rAnul.status, 200);

      const resAud2 = await client.query(
        "SELECT * FROM intervencion_auditoria WHERE intervencion_id = $1 AND tipo_evento = 'CORRECCION_COSTO' ORDER BY id DESC LIMIT 1",
        [intId]
      );
      assert.strictEqual(resAud2.rowCount, 1);
      assert.strictEqual(resAud2.rows[0].valor_nuevo, `Se anuló: ${repLitro.nombre} × 2 litro`);
    });

    // =========================================================================
    // RI-22: Validación de repuesto_id e ingresar_stock
    // =========================================================================
    await t.test('RI-22: repuesto_id inválido da 422; ingresar_stock string da 422', async () => {
      const intId = await crearIntervencion(m1Id);
      await postJson(`/api/intervenciones/${intId}/iniciar`, { estado_esperado: 'PENDIENTE' }, tokenR);

      // repuesto_id con true, 1.5 y "7" dan 422
      const rTrue = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: true, cantidad: 1 }, tokenR);
      assert.strictEqual(rTrue.status, 422);

      const rDec = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: 1.5, cantidad: 1 }, tokenR);
      assert.strictEqual(rDec.status, 422);

      const rStr = await postJson(`/api/intervenciones/${intId}/repuestos`, { repuesto_id: "7", cantidad: 1 }, tokenR);
      assert.strictEqual(rStr.status, 422);

      // Pedido para probar ingresar_stock
      const rPed = await postJson(`/api/intervenciones/${intId}/pedidos`, { repuesto_id: p1Id, cantidad: 2 }, tokenR);
      assert.strictEqual(rPed.status, 201);
      const pedido = await rPed.json();

      const resStockAntes = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [p1Id]);
      const stockAntes = Number(resStockAntes.rows[0].cantidad_disponible);

      // ingresar_stock: "false" da 422 y el stock no cambia
      const rRec = await postJson(
        `/api/intervenciones/${intId}/pedidos/${pedido.id}/recibir`,
        { ingresar_stock: "false" },
        tokenR
      );
      assert.strictEqual(rRec.status, 422);

      const resStockDesp = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [p1Id]);
      assert.strictEqual(Number(resStockDesp.rows[0].cantidad_disponible), stockAntes);
    });

  } finally {
    client = await clienteSano(client);
    // Limpieza estricta en orden:
    // pedidos, consumos, movimientos, repuesto_costos, repuestos, proveedores,
    // intervenciones chain, maquinas, usuarios y sus asociaciones, sectores, plantas
    try {
      if (createdIntervencionIds.length > 0) {
        await client.query('DELETE FROM pedidos_repuesto WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_repuestos WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
      }
      if (createdRepuestoIds.length > 0) {
        await client.query('DELETE FROM pedidos_repuesto WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM intervencion_repuestos WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM movimientos_stock WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM repuesto_costos WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM repuestos WHERE id = ANY($1)', [createdRepuestoIds]);
      }
      if (createdProveedorIds.length > 0) {
        await client.query('DELETE FROM proveedores WHERE id = ANY($1)', [createdProveedorIds]);
      }
      if (createdIntervencionIds.length > 0) {
        await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE intervencion_id = ANY($1))', [createdIntervencionIds]);
        await client.query('DELETE FROM notificaciones WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_auditoria WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_costos WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM documentos WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM movimientos_stock WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM historial_estados_intervencion WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM historial_estados_maquina WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [createdIntervencionIds]);
      }
      if (createdMaquinaIds.length > 0) {
        await client.query('DELETE FROM intervencion_periodos_detencion WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
        await client.query('DELETE FROM historial_estados_maquina WHERE maquina_id = ANY($1)', [createdMaquinaIds]);
        await client.query('DELETE FROM maquinas WHERE id = ANY($1)', [createdMaquinaIds]);
      }
      if (createdUsuarioIds.length > 0) {
        await client.query('DELETE FROM usuario_sector WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query(
          'DELETE FROM auditoria_permisos WHERE sobre_usuario_id = ANY($1) OR realizado_por_usuario_id = ANY($1)',
          [createdUsuarioIds]
        );
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUsuarioIds]);
      }
      if (createdSectorIds.length > 0) {
        await client.query('DELETE FROM sectores WHERE id = ANY($1)', [createdSectorIds]);
      }
      if (createdPlantaIds.length > 0) {
        await client.query('DELETE FROM plantas WHERE id = ANY($1)', [createdPlantaIds]);
      }
    } finally {
      client.release();
    }
  }
});
