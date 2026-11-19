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
  console.error(' BLOQUEO DE SEGURIDAD (REPUESTOS TESTS)');
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

test('Etapa R1 — Repuestos, proveedores y stock (RE-01 a RE-09)', async (t) => {
  let client = await pool.connect();

  const createdUsuarioIds: number[] = [];
  const createdProveedorIds: number[] = [];
  const createdRepuestoIds: number[] = [];
  const createdIntervencionIds: number[] = [];

  try {
    const suf = Date.now();
    const passHash = await bcrypt.hash('pass123', 10);

    // Perfiles
    const resPerfiles = await client.query('SELECT id, nombre FROM perfiles');
    const perfilMap: Record<string, number> = {};
    for (const r of resPerfiles.rows) {
      perfilMap[r.nombre] = Number(r.id);
    }

    // 1. Usuario G (gestor): RESPONSABLE_MANTENIMIENTO
    const resG = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
       VALUES ($1, 'Gestor', 'RE', $2, $3, TRUE, 1) RETURNING id, legajo, sesion_version`,
      [`G_${suf}`, passHash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    const userG = resG.rows[0];
    createdUsuarioIds.push(Number(userG.id));
    const tokenG = await getTokenForUser(userG);

    // 2. Usuario T (técnico): RESPONSABLE_MANTENIMIENTO con excepciones DENEGAR de REPUESTOS_GESTIONAR, COSTOS_VER y COSTOS_REGISTRAR
    const resT = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
       VALUES ($1, 'Tecnico', 'RE', $2, $3, TRUE, 1) RETURNING id, legajo, sesion_version`,
      [`T_${suf}`, passHash, perfilMap['RESPONSABLE_MANTENIMIENTO']]
    );
    const userT = resT.rows[0];
    createdUsuarioIds.push(Number(userT.id));

    // Permisos a denegar para T
    const permRes = await client.query(
      "SELECT id, codigo FROM permisos WHERE codigo IN ('REPUESTOS_GESTIONAR', 'COSTOS_VER', 'COSTOS_REGISTRAR')"
    );
    for (const p of permRes.rows) {
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, otorgado_por_usuario_id, motivo)
         VALUES ($1, $2, 'DENEGAR', $3, 'Excepción prueba RE')`,
        [userT.id, p.id, userG.id]
      );
    }
    const tokenT = await getTokenForUser(userT);

    // 3. Usuario O: OPERARIO
    const resO = await client.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
       VALUES ($1, 'Operario', 'RE', $2, $3, TRUE, 1) RETURNING id, legajo, sesion_version`,
      [`O_${suf}`, passHash, perfilMap['OPERARIO']]
    );
    const userO = resO.rows[0];
    createdUsuarioIds.push(Number(userO.id));
    const tokenO = await getTokenForUser(userO);

    // RE-01: Permisos
    await t.test('RE-01: Control de permisos', async () => {
      // O: 403 en GET /api/repuestos, POST /api/repuestos, GET /api/proveedores, GET /api/repuestos/opciones, GET /api/proveedores/opciones
      const r1 = await getJson('/api/repuestos', tokenO);
      assert.strictEqual(r1.status, 403);

      const r2 = await postJson('/api/repuestos', { nombre: 'Test' }, tokenO);
      assert.strictEqual(r2.status, 403);

      const r3 = await getJson('/api/proveedores', tokenO);
      assert.strictEqual(r3.status, 403);

      const r4 = await getJson('/api/repuestos/opciones', tokenO);
      assert.strictEqual(r4.status, 403);

      const r5 = await getJson('/api/proveedores/opciones', tokenO);
      assert.strictEqual(r5.status, 403);

      // T: 403 en GET /api/repuestos
      const rT1 = await getJson('/api/repuestos', tokenT);
      assert.strictEqual(rT1.status, 403);

      // T: 200 en las dos /opciones, con costo_unitario en null
      const rTRepOpc = await getJson('/api/repuestos/opciones', tokenT);
      assert.strictEqual(rTRepOpc.status, 200);
      const dataTRepOpc = await rTRepOpc.json();
      assert.ok(Array.isArray(dataTRepOpc));
      for (const item of dataTRepOpc) {
        assert.strictEqual(item.costo_unitario, null);
      }

      const rTProvOpc = await getJson('/api/proveedores/opciones', tokenT);
      assert.strictEqual(rTProvOpc.status, 200);

      // G: /opciones con costo
      const rGRepOpc = await getJson('/api/repuestos/opciones', tokenG);
      assert.strictEqual(rGRepOpc.status, 200);
      const dataGRepOpc = await rGRepOpc.json();
      assert.ok(Array.isArray(dataGRepOpc));
      if (dataGRepOpc.length > 0) {
        assert.notStrictEqual(dataGRepOpc[0].costo_unitario, null);
      }
    });

    // RE-02: Proveedores
    await t.test('RE-02: Catálogo de proveedores', async () => {
      const nombreProv = `Proveedor RE_${suf}`;

      // Alta: 201
      const resAlta = await postJson(
        '/api/proveedores',
        {
          nombre: nombreProv,
          contacto: 'Juan Pérez',
          telefono: '011 4444-5555',
          email: 'contacto@proveedor-re.com',
          notas: 'Notas proveedor',
        },
        tokenG
      );
      assert.strictEqual(resAlta.status, 201);
      const prov1 = await resAlta.json();
      createdProveedorIds.push(prov1.id);
      assert.strictEqual(prov1.nombre, nombreProv);
      assert.strictEqual(prov1.activo, true);
      assert.strictEqual(prov1.repuestos_activos, 0);

      // Otro con el mismo nombre en mayúsculas y espacios: 409 NOMBRE_DUPLICADO
      const resDup = await postJson(
        '/api/proveedores',
        { nombre: `   ${nombreProv.toUpperCase()}   ` },
        tokenG
      );
      assert.strictEqual(resDup.status, 409);
      assert.strictEqual((await resDup.json()).codigo, 'NOMBRE_DUPLICADO');

      // Email inválido: 422 EMAIL_INVALIDO
      const resEmailErr = await postJson(
        '/api/proveedores',
        { nombre: `Otro Prov_${suf}`, email: 'invalido-sin-arroba' },
        tokenG
      );
      assert.strictEqual(resEmailErr.status, 422);
      assert.strictEqual((await resEmailErr.json()).codigo, 'EMAIL_INVALIDO');

      // Crear un repuesto activo que tiene como habitual a prov1
      const resRep = await postJson(
        '/api/repuestos',
        {
          nombre: `Repuesto Para Prov_${suf}`,
          proveedor_id: prov1.id,
        },
        tokenG
      );
      assert.strictEqual(resRep.status, 201);
      const rep1 = await resRep.json();
      createdRepuestoIds.push(rep1.id);

      // Desactivar prov1: 409 EN_USO, con repuestos_activos 1
      const resDelEnUso = await deleteJson(`/api/proveedores/${prov1.id}`, tokenG);
      assert.strictEqual(resDelEnUso.status, 409);
      const dataEnUso = await resDelEnUso.json();
      assert.strictEqual(dataEnUso.codigo, 'EN_USO');
      assert.strictEqual(dataEnUso.repuestos_activos, 1);

      // Crear otro proveedor sin uso
      const resProvSinUso = await postJson(
        '/api/proveedores',
        { nombre: `Prov Sin Uso_${suf}` },
        tokenG
      );
      assert.strictEqual(resProvSinUso.status, 201);
      const provSinUso = await resProvSinUso.json();
      createdProveedorIds.push(provSinUso.id);

      // Desactivar el sin uso: 200
      const resDelOk = await deleteJson(`/api/proveedores/${provSinUso.id}`, tokenG);
      assert.strictEqual(resDelOk.status, 200);

      // No sale en GET /, ni en /opciones
      const resListActivos = await getJson('/api/proveedores', tokenG);
      const listActivos = await resListActivos.json();
      assert.ok(!listActivos.some((p: any) => p.id === provSinUso.id));

      const resListOpc = await getJson('/api/proveedores/opciones', tokenG);
      const listOpc = await resListOpc.json();
      assert.ok(!listOpc.some((p: any) => p.id === provSinUso.id));

      // Sale en ?all=true con activo: false
      const resListAll = await getJson('/api/proveedores?all=true', tokenG);
      const listAll = await resListAll.json();
      const inactivo = listAll.find((p: any) => p.id === provSinUso.id);
      assert.ok(inactivo);
      assert.strictEqual(inactivo.activo, false);

      // Reactivar con PUT y activo: true: vuelve a salir
      const resReactivar = await putJson(
        `/api/proveedores/${provSinUso.id}`,
        { activo: true },
        tokenG
      );
      assert.strictEqual(resReactivar.status, 200);
      assert.strictEqual((await resReactivar.json()).activo, true);

      const resListPost = await getJson('/api/proveedores', tokenG);
      const listPost = await resListPost.json();
      assert.ok(listPost.some((p: any) => p.id === provSinUso.id));
    });

    // RE-03: Alta de repuesto
    await t.test('RE-03: Alta de repuesto', async () => {
      // Sin stock inicial: cantidad 0, SIN_STOCK y una fila ALTA en el historial
      const resSinStock = await postJson(
        '/api/repuestos',
        {
          nombre: `Repuesto Sin Stock_${suf}`,
          codigo: `COD-SS-${suf}`,
          costo_unitario: 50.25,
        },
        tokenG
      );
      assert.strictEqual(resSinStock.status, 201);
      const repSS = await resSinStock.json();
      createdRepuestoIds.push(repSS.id);
      assert.strictEqual(repSS.cantidad_disponible, 0);
      assert.strictEqual(repSS.estado_stock, 'SIN_STOCK');

      const resCostosSS = await getJson(`/api/repuestos/${repSS.id}/costos`, tokenG);
      const costosSS = await resCostosSS.json();
      assert.strictEqual(costosSS.length, 1);
      assert.strictEqual(costosSS[0].origen, 'ALTA');
      assert.strictEqual(costosSS[0].costo_unitario, 50.25);

      // Con stock_inicial 10: INGRESO "Stock inicial" con delta 10 y stock_resultante 10
      const resConStock = await postJson(
        '/api/repuestos',
        {
          nombre: `Repuesto Con Stock_${suf}`,
          codigo: `COD-CS-${suf}`,
          stock_inicial: 10,
        },
        tokenG
      );
      assert.strictEqual(resConStock.status, 201);
      const repCS = await resConStock.json();
      createdRepuestoIds.push(repCS.id);
      assert.strictEqual(repCS.cantidad_disponible, 10);

      const resMovsCS = await getJson(`/api/repuestos/${repCS.id}/movimientos`, tokenG);
      const movsCS = await resMovsCS.json();
      assert.strictEqual(movsCS.length, 1);
      assert.strictEqual(movsCS[0].tipo, 'INGRESO');
      assert.strictEqual(movsCS[0].observacion, 'Stock inicial');
      assert.strictEqual(movsCS[0].delta, 10);
      assert.strictEqual(movsCS[0].stock_resultante, 10);

      // Código repetido con otras mayúsculas: 409 CODIGO_DUPLICADO
      const resDupCod = await postJson(
        '/api/repuestos',
        {
          nombre: `Repuesto Codigo Dup_${suf}`,
          codigo: `cod-cs-${suf}`,
        },
        tokenG
      );
      assert.strictEqual(resDupCod.status, 409);
      assert.strictEqual((await resDupCod.json()).codigo, 'CODIGO_DUPLICADO');

      // Sin stock y con stock_inicial o con stock_minimo: 422
      const resSinStockConIni = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Sin Stock Ini_${suf}`,
          lleva_stock: false,
          stock_inicial: 5,
        },
        tokenG
      );
      assert.strictEqual(resSinStockConIni.status, 422);

      const resSinStockConMin = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Sin Stock Min_${suf}`,
          lleva_stock: false,
          stock_minimo: 5,
        },
        tokenG
      );
      assert.strictEqual(resSinStockConMin.status, 422);

      // Cantidad con 4 decimales: 422. Cantidad como texto: 422
      const res4Dec = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep 4 Dec_${suf}`,
          stock_inicial: 1.1234,
        },
        tokenG
      );
      assert.strictEqual(res4Dec.status, 422);

      const resTexto = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Cant Texto_${suf}`,
          stock_inicial: '10',
        },
        tokenG
      );
      assert.strictEqual(resTexto.status, 422);

      // Proveedor inactivo: 422 PROVEEDOR_INVALIDO
      const pInactRes = await client.query(
        "INSERT INTO proveedores (nombre, activo) VALUES ($1, FALSE) RETURNING id",
        [`Prov Inactivo_${suf}`]
      );
      const provInactivoId = Number(pInactRes.rows[0].id);
      createdProveedorIds.push(provInactivoId);

      const resProvInact = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Prov Inact_${suf}`,
          proveedor_id: provInactivoId,
        },
        tokenG
      );
      assert.strictEqual(resProvInact.status, 422);
      assert.strictEqual((await resProvInact.json()).codigo, 'PROVEEDOR_INVALIDO');
    });

    // RE-04: estado_stock
    await t.test('RE-04: Cálculo de estado_stock y tipos numéricos', async () => {
      // Repuesto con stock_minimo = 5 y stock_inicial = 6 -> OK
      const rOk = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Estado OK_${suf}`,
          stock_minimo: 5,
          stock_inicial: 6,
        },
        tokenG
      );
      const repOk = await rOk.json();
      createdRepuestoIds.push(repOk.id);
      assert.strictEqual(repOk.estado_stock, 'OK');

      // Repuesto con stock_minimo = 5 y stock_inicial = 5 -> BAJO
      const rBajo = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Estado Bajo_${suf}`,
          stock_minimo: 5,
          stock_inicial: 5,
        },
        tokenG
      );
      const repBajo = await rBajo.json();
      createdRepuestoIds.push(repBajo.id);
      assert.strictEqual(repBajo.estado_stock, 'BAJO');

      // Repuesto con stock_minimo = 5 y stock_inicial = 0 -> SIN_STOCK
      const rSin = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Estado Sin_${suf}`,
          stock_minimo: 5,
          stock_inicial: 0,
        },
        tokenG
      );
      const repSin = await rSin.json();
      createdRepuestoIds.push(repSin.id);
      assert.strictEqual(repSin.estado_stock, 'SIN_STOCK');

      // Repuesto sin stock (lleva_stock: false) -> SIN_CONTROL
      const rSinCtrl = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Sin Ctrl_${suf}`,
          lleva_stock: false,
        },
        tokenG
      );
      const repSinCtrl = await rSinCtrl.json();
      createdRepuestoIds.push(repSinCtrl.id);
      assert.strictEqual(repSinCtrl.estado_stock, 'SIN_CONTROL');

      // En GET /, todos los numeric son números
      const resLista = await getJson('/api/repuestos', tokenG);
      const lista = await resLista.json();
      const filaOk = lista.find((item: any) => item.id === repOk.id);
      assert.ok(filaOk);
      assert.strictEqual(typeof filaOk.cantidad_disponible, 'number');
      assert.strictEqual(typeof filaOk.stock_minimo, 'number');
      assert.strictEqual(typeof filaOk.costo_unitario, 'number');
    });

    // RE-05: Edición
    await t.test('RE-05: Edición de repuesto', async () => {
      const resBase = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Para Edicion_${suf}`,
          stock_inicial: 3,
          costo_unitario: 100,
        },
        tokenG
      );
      const repBase = await resBase.json();
      createdRepuestoIds.push(repBase.id);

      // Costo nuevo: fila EDICION y el costo anterior sigue en el historial
      const resCostoNuevo = await putJson(
        `/api/repuestos/${repBase.id}`,
        { costo_unitario: 150 },
        tokenG
      );
      assert.strictEqual(resCostoNuevo.status, 200);

      const resHist1 = await getJson(`/api/repuestos/${repBase.id}/costos`, tokenG);
      const hist1 = await resHist1.json();
      assert.strictEqual(hist1.length, 2);
      assert.strictEqual(hist1[0].origen, 'EDICION');
      assert.strictEqual(hist1[0].costo_unitario, 150);
      assert.strictEqual(hist1[1].origen, 'ALTA');
      assert.strictEqual(hist1[1].costo_unitario, 100);

      // El mismo costo: no agrega fila
      const resMismoCosto = await putJson(
        `/api/repuestos/${repBase.id}`,
        { costo_unitario: 150 },
        tokenG
      );
      assert.strictEqual(resMismoCosto.status, 200);

      const resHist2 = await getJson(`/api/repuestos/${repBase.id}/costos`, tokenG);
      const hist2 = await resHist2.json();
      assert.strictEqual(hist2.length, 2);

      // Mandar cantidad_disponible: 422
      const resCantDisp = await putJson(
        `/api/repuestos/${repBase.id}`,
        { cantidad_disponible: 10 },
        tokenG
      );
      assert.strictEqual(resCantDisp.status, 422);

      // Dejar de llevar stock con 3 en stock: 409 TIENE_STOCK
      const resDejarConStock = await putJson(
        `/api/repuestos/${repBase.id}`,
        { lleva_stock: false },
        tokenG
      );
      assert.strictEqual(resDejarConStock.status, 409);
      const dataDejar = await resDejarConStock.json();
      assert.strictEqual(dataDejar.codigo, 'TIENE_STOCK');
      assert.strictEqual(dataDejar.cantidad_disponible, 3);

      // Crear otro con 0 en stock
      const resZero = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Zero Stock_${suf}`,
          stock_inicial: 0,
          stock_minimo: 5,
        },
        tokenG
      );
      const repZero = await resZero.json();
      createdRepuestoIds.push(repZero.id);

      // Con 0: 200, y el mínimo queda en null
      const resDejarZero = await putJson(
        `/api/repuestos/${repZero.id}`,
        { lleva_stock: false },
        tokenG
      );
      assert.strictEqual(resDejarZero.status, 200);
      const modZero = await resDejarZero.json();
      assert.strictEqual(modZero.lleva_stock, false);
      assert.strictEqual(modZero.stock_minimo, null);
    });

    // RE-06: Movimientos
    let repMovId = 0;
    await t.test('RE-06: Movimientos manuales', async () => {
      // Repuesto con 10
      const rIni = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Para Movimientos_${suf}`,
          stock_inicial: 10,
          costo_unitario: 50,
        },
        tokenG
      );
      const repMov = await rIni.json();
      repMovId = repMov.id;
      createdRepuestoIds.push(repMovId);

      // Proveedor para el movimiento
      const rProv = await postJson(
        '/api/proveedores',
        { nombre: `Prov Para Mov_${suf}` },
        tokenG
      );
      const provMov = await rProv.json();
      createdProveedorIds.push(provMov.id);

      // INGRESO de 5, con costo nuevo, proveedor y comprobante: stock 15, costo actualizado, fila INGRESO en historial
      const resIng = await postJson(
        `/api/repuestos/${repMovId}/movimientos`,
        {
          tipo: 'INGRESO',
          cantidad: 5,
          costo_unitario: 65,
          proveedor_id: provMov.id,
          comprobante: 'FAC-A-0001',
          observacion: 'Compra repuesto',
        },
        tokenG
      );
      assert.strictEqual(resIng.status, 201);
      const dataIng = await resIng.json();
      assert.strictEqual(dataIng.repuesto.cantidad_disponible, 15);
      assert.strictEqual(dataIng.repuesto.costo_unitario, 65);
      assert.strictEqual(dataIng.movimiento.delta, 5);
      assert.strictEqual(dataIng.movimiento.stock_resultante, 15);

      const resHistIng = await getJson(`/api/repuestos/${repMovId}/costos`, tokenG);
      const histIng = await resHistIng.json();
      assert.strictEqual(histIng[0].origen, 'INGRESO');
      assert.strictEqual(histIng[0].costo_unitario, 65);

      // EGRESO sin motivo: 422 MOTIVO_REQUERIDO
      const resEgSinMotivo = await postJson(
        `/api/repuestos/${repMovId}/movimientos`,
        {
          tipo: 'EGRESO',
          cantidad: 2,
        },
        tokenG
      );
      assert.strictEqual(resEgSinMotivo.status, 422);
      assert.strictEqual((await resEgSinMotivo.json()).codigo, 'MOTIVO_REQUERIDO');

      // EGRESO de 16: 409 STOCK_INSUFICIENTE, con disponible 15
      const resEgExc = await postJson(
        `/api/repuestos/${repMovId}/movimientos`,
        {
          tipo: 'EGRESO',
          cantidad: 16,
          observacion: 'Rotura de prueba excedente',
        },
        tokenG
      );
      assert.strictEqual(resEgExc.status, 409);
      const dataEgExc = await resEgExc.json();
      assert.strictEqual(dataEgExc.codigo, 'STOCK_INSUFICIENTE');
      assert.strictEqual(dataEgExc.disponible, 15);

      // EGRESO de 2 con motivo: stock 13
      const resEgOk = await postJson(
        `/api/repuestos/${repMovId}/movimientos`,
        {
          tipo: 'EGRESO',
          cantidad: 2,
          observacion: 'Rotura en banco de pruebas',
        },
        tokenG
      );
      assert.strictEqual(resEgOk.status, 201);
      assert.strictEqual((await resEgOk.json()).repuesto.cantidad_disponible, 13);

      // AJUSTE a 13: 422 SIN_CAMBIOS
      const resAjSinCambio = await postJson(
        `/api/repuestos/${repMovId}/movimientos`,
        {
          tipo: 'AJUSTE',
          cantidad_contada: 13,
          observacion: 'Conteo coincide exactamente',
        },
        tokenG
      );
      assert.strictEqual(resAjSinCambio.status, 422);
      assert.strictEqual((await resAjSinCambio.json()).codigo, 'SIN_CAMBIOS');

      // AJUSTE a 12: delta -1
      const resAjOk = await postJson(
        `/api/repuestos/${repMovId}/movimientos`,
        {
          tipo: 'AJUSTE',
          cantidad_contada: 12,
          observacion: 'Falta 1 unidad contada',
        },
        tokenG
      );
      assert.strictEqual(resAjOk.status, 201);
      const dataAjOk = await resAjOk.json();
      assert.strictEqual(dataAjOk.movimiento.delta, -1);
      assert.strictEqual(dataAjOk.repuesto.cantidad_disponible, 12);

      // tipo DEVOLUCION: 422
      const resDevManual = await postJson(
        `/api/repuestos/${repMovId}/movimientos`,
        {
          tipo: 'DEVOLUCION',
          cantidad: 2,
        },
        tokenG
      );
      assert.strictEqual(resDevManual.status, 422);

      // En uno sin stock: 409 REPUESTO_SIN_CONTROL_STOCK
      const rNoStock = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Sin Stock Control_${suf}`,
          lleva_stock: false,
        },
        tokenG
      );
      const repNoStock = await rNoStock.json();
      createdRepuestoIds.push(repNoStock.id);

      const resMovNoStock = await postJson(
        `/api/repuestos/${repNoStock.id}/movimientos`,
        {
          tipo: 'INGRESO',
          cantidad: 5,
        },
        tokenG
      );
      assert.strictEqual(resMovNoStock.status, 409);
      assert.strictEqual((await resMovNoStock.json()).codigo, 'REPUESTO_SIN_CONTROL_STOCK');

      // En uno inactivo: 409 REPUESTO_INACTIVO
      const rInact = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Inactivo Mov_${suf}`,
          stock_inicial: 0,
        },
        tokenG
      );
      const repInact = await rInact.json();
      createdRepuestoIds.push(repInact.id);
      await deleteJson(`/api/repuestos/${repInact.id}`, tokenG);

      const resMovInact = await postJson(
        `/api/repuestos/${repInact.id}/movimientos`,
        {
          tipo: 'INGRESO',
          cantidad: 5,
        },
        tokenG
      );
      assert.strictEqual(resMovInact.status, 409);
      assert.strictEqual((await resMovInact.json()).codigo, 'REPUESTO_INACTIVO');
    });

    // RE-07: Coherencia
    await t.test('RE-07: Coherencia de movimientos', async () => {
      // Del repuesto de RE-06, ordenando por id:
      const resRaw = await client.query(
        'SELECT * FROM movimientos_stock WHERE repuesto_id = $1 ORDER BY id ASC',
        [repMovId]
      );
      const movs = resRaw.rows;
      assert.ok(movs.length >= 4); // stock inicial (10), ingreso (5), egreso (2), ajuste (-1)

      let sumaDeltas = 0;
      let stockEsperado = 0;
      for (const m of movs) {
        const d = Number(m.delta);
        const res = Number(m.stock_resultante);
        stockEsperado += d;
        sumaDeltas += d;
        assert.strictEqual(res, stockEsperado);
      }

      const repRes = await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [repMovId]);
      const cantActual = Number(repRes.rows[0].cantidad_disponible);
      assert.strictEqual(cantActual, 12);
      assert.strictEqual(cantActual, stockEsperado);
      assert.strictEqual(cantActual, sumaDeltas);

      // GET /:id/movimientos los trae del más nuevo al más viejo, con realizado_por
      const resApi = await getJson(`/api/repuestos/${repMovId}/movimientos`, tokenG);
      assert.strictEqual(resApi.status, 200);
      const movsApi = await resApi.json();
      assert.strictEqual(movsApi.length, movs.length);
      assert.ok(movsApi[0].id > movsApi[1].id);
      assert.ok(movsApi[0].realizado_por);
      assert.strictEqual(movsApi[0].realizado_por.nombre, 'Gestor');
    });

    // RE-08: Concurrencia
    await t.test('RE-08: Concurrencia de movimientos', async () => {
      const rConc = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Concurrente_${suf}`,
          stock_inicial: 4,
        },
        tokenG
      );
      const repConc = await rConc.json();
      createdRepuestoIds.push(repConc.id);

      // Dos EGRESO de 4 a la vez: uno 201 y otro 409
      const [res1, res2] = await Promise.all([
        postJson(
          `/api/repuestos/${repConc.id}/movimientos`,
          { tipo: 'EGRESO', cantidad: 4, observacion: 'Consumo simultáneo 1' },
          tokenG
        ),
        postJson(
          `/api/repuestos/${repConc.id}/movimientos`,
          { tipo: 'EGRESO', cantidad: 4, observacion: 'Consumo simultáneo 2' },
          tokenG
        ),
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(statuses, [201, 409]);

      // Queda en 0, con un solo egreso
      const repFinal = await getJson(`/api/repuestos/${repConc.id}`, tokenG);
      const dataFinal = await repFinal.json();
      assert.strictEqual(dataFinal.cantidad_disponible, 0);

      const movsFinal = await getJson(`/api/repuestos/${repConc.id}/movimientos`, tokenG);
      const dataMovs = await movsFinal.json();
      const egresos = dataMovs.filter((m: any) => m.tipo === 'EGRESO');
      assert.strictEqual(egresos.length, 1);
    });

    // RE-09: Desactivar
    await t.test('RE-09: Desactivar y reactivar repuesto', async () => {
      // Con stock: 409 TIENE_STOCK
      const rStock = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Con Stock Desact_${suf}`,
          stock_inicial: 5,
        },
        tokenG
      );
      const repStock = await rStock.json();
      createdRepuestoIds.push(repStock.id);

      const resDelStock = await deleteJson(`/api/repuestos/${repStock.id}`, tokenG);
      assert.strictEqual(resDelStock.status, 409);
      assert.strictEqual((await resDelStock.json()).codigo, 'TIENE_STOCK');

      // Sin stock: 200, y otra vez: 200
      const rZero = await postJson(
        '/api/repuestos',
        {
          nombre: `Rep Sin Stock Desact_${suf}`,
          stock_inicial: 0,
        },
        tokenG
      );
      const repZero = await rZero.json();
      createdRepuestoIds.push(repZero.id);

      const resDel1 = await deleteJson(`/api/repuestos/${repZero.id}`, tokenG);
      assert.strictEqual(resDel1.status, 200);

      const resDel2 = await deleteJson(`/api/repuestos/${repZero.id}`, tokenG);
      assert.strictEqual(resDel2.status, 200);

      // Inactivo: no sale en GET / ni en /opciones
      const resLista = await getJson('/api/repuestos', tokenG);
      const lista = await resLista.json();
      assert.ok(!lista.some((r: any) => r.id === repZero.id));

      const resOpc = await getJson('/api/repuestos/opciones', tokenG);
      const opc = await resOpc.json();
      assert.ok(!opc.some((r: any) => r.id === repZero.id));

      // Reactivar: vuelve a salir
      const resReac = await putJson(`/api/repuestos/${repZero.id}`, { activo: true }, tokenG);
      assert.strictEqual(resReac.status, 200);

      const resListaPost = await getJson('/api/repuestos', tokenG);
      const listaPost = await resListaPost.json();
      assert.ok(listaPost.some((r: any) => r.id === repZero.id));
    });

    // =========================================================================
    // RE-10: Ids de ruta y booleanos mal validados
    // =========================================================================
    await t.test('RE-10: Ids de ruta y booleanos mal validados', async () => {
      // Repuestos: ids de ruta inválidos dan 404
      for (const badId of ['1.5', 'abc']) {
        const r1 = await getJson(`/api/repuestos/${badId}`, tokenG);
        assert.strictEqual(r1.status, 404);
        const r2 = await putJson(`/api/repuestos/${badId}`, { nombre: 'Cambio' }, tokenG);
        assert.strictEqual(r2.status, 404);
        const r3 = await deleteJson(`/api/repuestos/${badId}`, tokenG);
        assert.strictEqual(r3.status, 404);
        const r4 = await getJson(`/api/repuestos/${badId}/movimientos`, tokenG);
        assert.strictEqual(r4.status, 404);
        const r5 = await postJson(`/api/repuestos/${badId}/movimientos`, { tipo: 'EGRESO', cantidad: 1, observacion: 'Motivo prueba' }, tokenG);
        assert.strictEqual(r5.status, 404);
        const r6 = await getJson(`/api/repuestos/${badId}/usos`, tokenG);
        assert.strictEqual(r6.status, 404);
        const r7 = await getJson(`/api/repuestos/${badId}/costos`, tokenG);
        assert.strictEqual(r7.status, 404);
      }

      // Proveedores: ids de ruta inválidos dan 404
      for (const badId of ['1.5', 'abc']) {
        const p1 = await putJson(`/api/proveedores/${badId}`, { nombre: 'Cambio' }, tokenG);
        assert.strictEqual(p1.status, 404);
        const p2 = await deleteJson(`/api/proveedores/${badId}`, tokenG);
        assert.strictEqual(p2.status, 404);
      }

      // Repuesto y proveedor de prueba para booleanos
      const rRep = await postJson(
        '/api/repuestos',
        { nombre: `Rep Bool_${suf}`, stock_inicial: 0 },
        tokenG
      );
      const rep = await rRep.json();
      createdRepuestoIds.push(rep.id);

      const rProv = await postJson(
        '/api/proveedores',
        { nombre: `Prov Bool_${suf}` },
        tokenG
      );
      const prov = await rProv.json();
      createdProveedorIds.push(prov.id);

      // lleva_stock: "false" da 422
      const rBadLlevaStockPost = await postJson(
        '/api/repuestos',
        { nombre: `Rep Bad Bool_${suf}`, lleva_stock: "false" as any },
        tokenG
      );
      assert.strictEqual(rBadLlevaStockPost.status, 422);

      const rBadLlevaStockPut = await putJson(
        `/api/repuestos/${rep.id}`,
        { lleva_stock: "false" as any },
        tokenG
      );
      assert.strictEqual(rBadLlevaStockPut.status, 422);

      // activo: 1 da 422
      const rBadActivoRep = await putJson(
        `/api/repuestos/${rep.id}`,
        { activo: 1 as any },
        tokenG
      );
      assert.strictEqual(rBadActivoRep.status, 422);

      const rBadActivoProv = await putJson(
        `/api/proveedores/${prov.id}`,
        { activo: 1 as any },
        tokenG
      );
      assert.strictEqual(rBadActivoProv.status, 422);
    });

    // =========================================================================
    // RE-11: Concurrencia
    // =========================================================================
    await t.test('RE-11: Casos de concurrencia (10 intentos de cada caso)', async () => {
      const maqRes = await client.query('SELECT id FROM maquinas WHERE activo = TRUE LIMIT 1');
      assert.ok(maqRes.rows.length > 0, 'Debe haber al menos una máquina');
      const maquinaId = maqRes.rows[0].id;

      const tipoRes = await client.query('SELECT id FROM tipos_intervencion WHERE activo = TRUE LIMIT 1');
      const tipoId = tipoRes.rows[0]?.id || 1;

      const intRes = await client.query(
        `INSERT INTO intervenciones (maquina_id, tipo_intervencion_id, estado, creado_por_usuario_id, descripcion, fecha_creacion)
         VALUES ($1, $2, 'EN_PROCESO', $3, 'Intervención prueba RE-11', NOW()) RETURNING id`,
        [maquinaId, tipoId, userG.id]
      );
      const intervencionId = intRes.rows[0].id;
      createdIntervencionIds.push(intervencionId);

      // Caso 1: Desactivar un repuesto y un ingreso (10 intentos)
      for (let i = 0; i < 10; i++) {
        const rR = await postJson('/api/repuestos', { nombre: `Rep Conc1_${i}_${suf}`, stock_inicial: 0 }, tokenG);
        const rep = await rR.json();
        createdRepuestoIds.push(rep.id);

        const [resDel, resIng] = await Promise.all([
          deleteJson(`/api/repuestos/${rep.id}`, tokenG),
          postJson(`/api/repuestos/${rep.id}/movimientos`, { tipo: 'INGRESO', cantidad: 5, observacion: 'Ingreso concurrente' }, tokenG),
        ]);
        assert.ok(resDel.status !== 500, `Caso 1 del no debe dar 500 (dio ${resDel.status})`);
        assert.ok(resIng.status !== 500, `Caso 1 ing no debe dar 500 (dio ${resIng.status})`);

        const dbRes = await client.query('SELECT activo, cantidad_disponible FROM repuestos WHERE id = $1', [rep.id]);
        const rAct = dbRes.rows[0];
        if (!rAct.activo) {
          assert.strictEqual(Number(rAct.cantidad_disponible), 0, 'No puede quedar inactivo con stock');
        }
      }

      // Caso 2: Desactivar un repuesto y el alta de un pedido (10 intentos)
      for (let i = 0; i < 10; i++) {
        const rR = await postJson('/api/repuestos', { nombre: `Rep Conc2_${i}_${suf}`, stock_inicial: 0 }, tokenG);
        const rep = await rR.json();
        createdRepuestoIds.push(rep.id);

        const [resDel, resPed] = await Promise.all([
          deleteJson(`/api/repuestos/${rep.id}`, tokenG),
          postJson(`/api/intervenciones/${intervencionId}/pedidos`, { repuesto_id: rep.id, cantidad: 1 }, tokenG),
        ]);
        assert.ok(resDel.status !== 500, `Caso 2 del no debe dar 500 (dio ${resDel.status})`);
        assert.ok(resPed.status !== 500, `Caso 2 ped no debe dar 500 (dio ${resPed.status})`);

        const dbRes = await client.query('SELECT activo FROM repuestos WHERE id = $1', [rep.id]);
        const rAct = dbRes.rows[0];
        if (!rAct.activo) {
          const pedAbiertos = await client.query(
            "SELECT COUNT(*)::int AS count FROM pedidos_repuesto WHERE repuesto_id = $1 AND estado IN ('PENDIENTE', 'PEDIDO')",
            [rep.id]
          );
          assert.strictEqual(Number(pedAbiertos.rows[0].count), 0, 'No puede quedar inactivo con pedidos abiertos');
        }
      }

      // Caso 3: Desactivar un repuesto y editar su ubicación (10 intentos)
      for (let i = 0; i < 10; i++) {
        const rR = await postJson('/api/repuestos', { nombre: `Rep Conc3_${i}_${suf}`, stock_inicial: 0 }, tokenG);
        const rep = await rR.json();
        createdRepuestoIds.push(rep.id);

        const [resDel, resPut] = await Promise.all([
          deleteJson(`/api/repuestos/${rep.id}`, tokenG),
          putJson(`/api/repuestos/${rep.id}`, { ubicacion: `Estante Conc_${i}` }, tokenG),
        ]);
        assert.ok(resDel.status !== 500, `Caso 3 del no debe dar 500 (dio ${resDel.status})`);
        assert.ok(resPut.status !== 500, `Caso 3 put no debe dar 500 (dio ${resPut.status})`);

        if (resDel.status === 200) {
          const dbRes = await client.query('SELECT activo FROM repuestos WHERE id = $1', [rep.id]);
          assert.strictEqual(dbRes.rows[0].activo, false, 'No puede quedar reactivado si DELETE respondió 200');
        }
      }

      // Caso 4: Dejar de llevar stock y un ingreso (10 intentos)
      for (let i = 0; i < 10; i++) {
        const rR = await postJson('/api/repuestos', { nombre: `Rep Conc4_${i}_${suf}`, stock_inicial: 0, lleva_stock: true }, tokenG);
        const rep = await rR.json();
        createdRepuestoIds.push(rep.id);

        const [resPut, resIng] = await Promise.all([
          putJson(`/api/repuestos/${rep.id}`, { lleva_stock: false }, tokenG),
          postJson(`/api/repuestos/${rep.id}/movimientos`, { tipo: 'INGRESO', cantidad: 5, observacion: 'Ingreso conc' }, tokenG),
        ]);
        assert.ok(resPut.status !== 500, `Caso 4 put no debe dar 500 (dio ${resPut.status})`);
        assert.ok(resIng.status !== 500, `Caso 4 ing no debe dar 500 (dio ${resIng.status})`);
      }

      // Caso 5: Dos proveedores con el mismo nombre (10 intentos)
      for (let i = 0; i < 10; i++) {
        const nombre = `Prov Conc Dup ${suf}_${i}`;
        const [p1, p2] = await Promise.all([
          postJson('/api/proveedores', { nombre }, tokenG),
          postJson('/api/proveedores', { nombre }, tokenG),
        ]);
        assert.ok(p1.status !== 500, `Caso 5 p1 no debe dar 500 (dio ${p1.status})`);
        assert.ok(p2.status !== 500, `Caso 5 p2 no debe dar 500 (dio ${p2.status})`);
        const statuses = [p1.status, p2.status].sort();
        assert.deepStrictEqual(statuses, [201, 409]);
        const d1 = p1.status === 201 ? await p1.json() : await p2.json();
        createdProveedorIds.push(d1.id);
      }

      // Caso 6: Dos repuestos con el mismo código (10 intentos)
      for (let i = 0; i < 10; i++) {
        const codigo = `C-CONC-${suf}-${i}`;
        const [r1, r2] = await Promise.all([
          postJson('/api/repuestos', { nombre: `Rep Conc 6A_${i}`, codigo }, tokenG),
          postJson('/api/repuestos', { nombre: `Rep Conc 6B_${i}`, codigo }, tokenG),
        ]);
        assert.ok(r1.status !== 500, `Caso 6 r1 no debe dar 500 (dio ${r1.status})`);
        assert.ok(r2.status !== 500, `Caso 6 r2 no debe dar 500 (dio ${r2.status})`);
        const statuses = [r1.status, r2.status].sort();
        assert.deepStrictEqual(statuses, [201, 409]);
        const d1 = r1.status === 201 ? await r1.json() : await r2.json();
        createdRepuestoIds.push(d1.id);
      }
    });

    // =========================================================================
    // RE-12: Repuesto con texto viejo y PUT con proveedor_id: null
    // =========================================================================
    await t.test('RE-12: Repuesto con texto viejo y PUT con proveedor_id: null', async () => {
      const resSql = await client.query(
        "INSERT INTO repuestos (nombre, proveedor) VALUES ('Repuesto Texto Viejo', 'Casa Vieja') RETURNING id"
      );
      const repId = resSql.rows[0].id;
      createdRepuestoIds.push(repId);

      const resPut = await putJson(`/api/repuestos/${repId}`, { proveedor_id: null }, tokenG);
      assert.strictEqual(resPut.status, 200);

      const resDb = await client.query('SELECT proveedor, proveedor_id FROM repuestos WHERE id = $1', [repId]);
      assert.strictEqual(resDb.rows[0].proveedor, null);
      assert.strictEqual(resDb.rows[0].proveedor_id, null);
    });

  } finally {
    client = await clienteSano(client);
    // Limpieza estricta en orden: movimientos, historial costos, repuestos, proveedores, excepciones, usuarios
    try {
      if (createdIntervencionIds.length > 0) {
        await client.query('DELETE FROM pedidos_repuesto WHERE intervencion_id = ANY($1)', [createdIntervencionIds]);
        await client.query('DELETE FROM intervenciones WHERE id = ANY($1)', [createdIntervencionIds]);
      }
      if (createdRepuestoIds.length > 0) {
        await client.query('DELETE FROM movimientos_stock WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM repuesto_costos WHERE repuesto_id = ANY($1)', [createdRepuestoIds]);
        await client.query('DELETE FROM repuestos WHERE id = ANY($1)', [createdRepuestoIds]);
      }
      if (createdProveedorIds.length > 0) {
        await client.query('DELETE FROM proveedores WHERE id = ANY($1)', [createdProveedorIds]);
      }
      if (createdUsuarioIds.length > 0) {
        await client.query(
          'DELETE FROM auditoria_permisos WHERE sobre_usuario_id = ANY($1) OR realizado_por_usuario_id = ANY($1)',
          [createdUsuarioIds]
        );
        await client.query('DELETE FROM usuario_permiso WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
        await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [createdUsuarioIds]);
      }
    } finally {
      client.release();
    }
  }
});
