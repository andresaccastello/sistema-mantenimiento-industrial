import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { pool } from '../functions/db.ts';
import { clienteSano } from './conexion.ts';
import app from '../functions/api.ts';
import { JWT_SECRET } from '../functions/config.ts';

// Timeout de bloqueo para la prueba de concurrencia
process.env.LOCK_TIMEOUT = '5s';

// Identificación estricta de la rama de Neon
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (PEDIDOS Y COMPRAS TESTS)');
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
}

async function pedir(method: string, path: string, token: string | null, body?: unknown): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await app.request(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const texto = await r.text();
  let cuerpo: any = texto;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    // no es JSON
  }
  return { status: r.status, cuerpo };
}

test('Etapa PC1 — Pedidos que se usan al recibir y compras (PC-01 a PC-15)', async (t) => {
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

    const perfilMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, nombre FROM perfiles')).rows) {
      perfilMap[r.nombre] = Number(r.id);
    }
    const permMap: Record<string, number> = {};
    for (const r of (await client.query('SELECT id, codigo FROM permisos')).rows) {
      permMap[r.codigo] = Number(r.id);
    }

    // Planta, sector y máquina
    const plId = Number((await client.query(
      'INSERT INTO plantas (nombre, activo) VALUES ($1, TRUE) RETURNING id', [`PC_PL_${suf}`]
    )).rows[0].id);
    createdPlantaIds.push(plId);
    const sId = Number((await client.query(
      'INSERT INTO sectores (nombre, planta_id, activo) VALUES ($1, $2, TRUE) RETURNING id', [`PC_S_${suf}`, plId]
    )).rows[0].id);
    createdSectorIds.push(sId);
    const mRes = await client.query(
      'INSERT INTO maquinas (codigo, nombre, sector_id, activo) VALUES ($1, $2, $3, TRUE) RETURNING id, codigo',
      [`PC_M_${suf}`, `Maquina PC ${suf}`, sId]
    );
    const mId = Number(mRes.rows[0].id);
    const mCodigo = mRes.rows[0].codigo as string;
    createdMaquinaIds.push(mId);

    // Usuarios
    async function crearUsuario(clave: string, perfil: string, sectores: number[]) {
      const res = await client.query(
        `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, sesion_version)
         VALUES ($1, $2, 'PC', $3, $4, TRUE, 1) RETURNING id, legajo, sesion_version`,
        [`PC_${clave}_${suf}`, clave, passHash, perfilMap[perfil]]
      );
      const u = res.rows[0];
      const id = Number(u.id);
      createdUsuarioIds.push(id);
      for (const s of sectores) {
        await client.query('INSERT INTO usuario_sector (usuario_id, sector_id) VALUES ($1, $2)', [id, s]);
      }
      return { id, token: await getTokenForUser({ id, legajo: u.legajo, sesion_version: Number(u.sesion_version) }) };
    }
    const A = await crearUsuario('Admin', 'ADMINISTRADOR', []);
    const R = await crearUsuario('Resp', 'RESPONSABLE_MANTENIMIENTO', [sId]);
    const O = await crearUsuario('Operario', 'OPERARIO', [sId]);
    async function excepcion(usuarioId: number, permiso: string, efecto: 'CONCEDER' | 'DENEGAR', alcance: string | null) {
      if (alcance === null) {
        await client.query(
          `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, motivo, otorgado_por_usuario_id)
           VALUES ($1, $2, $3, 'Prueba PC', $4)`,
          [usuarioId, permMap[permiso], efecto, A.id]
        );
        return;
      }
      await client.query(
        `INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id)
         VALUES ($1, $2, $3, $4, 'Prueba PC', $5)`,
        [usuarioId, permMap[permiso], efecto, alcance, A.id]
      );
    }
    // T: como R, sin poder cargar costos
    const T = await crearUsuario('Tecnico', 'RESPONSABLE_MANTENIMIENTO', [sId]);
    await excepcion(T.id, 'REPUESTOS_GESTIONAR', 'DENEGAR', null);
    await excepcion(T.id, 'COSTOS_REGISTRAR', 'DENEGAR', null);
    // C1: consulta, sin COSTOS_VER
    const C1 = await crearUsuario('ConsultaSinCostos', 'CONSULTA', []);
    await excepcion(C1.id, 'COSTOS_VER', 'DENEGAR', null);
    // C2: reportes con alcance de su sector, y COSTOS_VER
    const C2 = await crearUsuario('ReportesSector', 'OPERARIO', [sId]);
    await excepcion(C2.id, 'REPORTES_CONSULTAR', 'CONCEDER', 'SECTORES');
    await excepcion(C2.id, 'COSTOS_VER', 'CONCEDER', 'TODAS');

    // Proveedores
    async function crearProveedor(nombre: string) {
      const r = await pedir('POST', '/api/proveedores', R.token, { nombre: `${nombre} ${suf}` });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      createdProveedorIds.push(Number(r.cuerpo.id));
      return Number(r.cuerpo.id);
    }
    const provA = await crearProveedor('Proveedor PC A');
    const provB = await crearProveedor('Proveedor PC B');

    // Repuestos
    let numeroRepuesto = 0;
    async function crearRepuesto(llevaStock: boolean, costo: number, stockInicial = 0) {
      numeroRepuesto++;
      const r = await pedir('POST', '/api/repuestos', R.token, {
        codigo: `PC${numeroRepuesto}_${suf}`,
        nombre: `Repuesto PC ${numeroRepuesto}`,
        unidad: 'unidad',
        lleva_stock: llevaStock,
        ...(llevaStock ? { stock_inicial: stockInicial } : {}),
        costo_unitario: costo,
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      createdRepuestoIds.push(Number(r.cuerpo.id));
      return Number(r.cuerpo.id);
    }

    // Intervenciones
    async function crearIntervencion(iniciar = true) {
      const r = await pedir('POST', '/api/intervenciones', O.token, { maquina_id: mId, descripcion: 'Falla prueba PC' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      const id = Number(r.cuerpo.id);
      createdIntervencionIds.push(id);
      if (iniciar) {
        const ini = await pedir('POST', `/api/intervenciones/${id}/iniciar`, R.token, { estado_esperado: 'PENDIENTE' });
        assert.strictEqual(ini.status, 200, JSON.stringify(ini.cuerpo));
      }
      return id;
    }
    async function crearPedido(intId: number, body: Record<string, unknown>) {
      const r = await pedir('POST', `/api/intervenciones/${intId}/pedidos`, R.token, body);
      assert.strictEqual(r.status, 201, JSON.stringify(r.cuerpo));
      return Number(r.cuerpo.id);
    }
    const recibir = (intId: number, pedidoId: number, body?: unknown, token = R.token) =>
      pedir('POST', `/api/intervenciones/${intId}/pedidos/${pedidoId}/recibir`, token, body);

    // Lecturas de la base
    const stock = async (repId: number) =>
      Number((await client.query('SELECT cantidad_disponible FROM repuestos WHERE id = $1', [repId])).rows[0].cantidad_disponible);
    const movimientos = async (repId: number) =>
      (await client.query(
        'SELECT tipo, cantidad, costo_unitario, comprobante, proveedor_id FROM movimientos_stock WHERE repuesto_id = $1 ORDER BY id',
        [repId]
      )).rows.map((m) => ({
        tipo: m.tipo,
        cantidad: Number(m.cantidad),
        costo_unitario: m.costo_unitario === null ? null : Number(m.costo_unitario),
        comprobante: m.comprobante,
        proveedor_id: m.proveedor_id === null ? null : Number(m.proveedor_id),
      }));
    const consumos = async (intId: number) =>
      (await client.query(
        `SELECT id, repuesto_id, cantidad, costo_unitario_aplicado, observacion, anulado_en
         FROM intervencion_repuestos WHERE intervencion_id = $1 ORDER BY id`,
        [intId]
      )).rows.map((x) => ({
        id: Number(x.id),
        repuesto_id: Number(x.repuesto_id),
        cantidad: Number(x.cantidad),
        costo: Number(x.costo_unitario_aplicado),
        observacion: x.observacion,
        anulado: x.anulado_en !== null,
      }));
    const pedidoFila = async (pedidoId: number) => {
      const p = (await client.query(
        `SELECT estado, repuesto_id, movimiento_id, costo_unitario, comprobante, consumo_id
         FROM pedidos_repuesto WHERE id = $1`,
        [pedidoId]
      )).rows[0];
      return {
        estado: p.estado,
        repuesto_id: p.repuesto_id === null ? null : Number(p.repuesto_id),
        movimiento_id: p.movimiento_id === null ? null : Number(p.movimiento_id),
        costo_unitario: p.costo_unitario === null ? null : Number(p.costo_unitario),
        comprobante: p.comprobante,
        consumo_id: p.consumo_id === null ? null : Number(p.consumo_id),
      };
    };
    const costoRepuestos = async (intId: number) =>
      Number((await client.query('SELECT costo_repuestos FROM intervenciones WHERE id = $1', [intId])).rows[0].costo_repuestos ?? 0);
    /** Lo que no tiene que cambiar cuando una recepción falla. */
    const foto = async (intId: number, pedidoId: number, repId: number) => ({
      pedido: await pedidoFila(pedidoId),
      stock: await stock(repId),
      movimientos: await movimientos(repId),
      consumos: await consumos(intId),
      costo: await costoRepuestos(intId),
    });

    // =========================================================================
    // PC-01: Recibir sin campos nuevos, igual que hoy
    // =========================================================================
    await t.test('PC-01: Recibir sin campos nuevos', async () => {
      const intId = await crearIntervencion();
      const rep = await crearRepuesto(true, 100, 2);

      // Con stock: un ingreso de lo pedido, sin costo ni comprobante, y nada más
      const ped1 = await crearPedido(intId, { repuesto_id: rep, cantidad: 3, proveedor_id: provA });
      const r1 = await recibir(intId, ped1, { ingresar_stock: true });
      assert.strictEqual(r1.status, 200, JSON.stringify(r1.cuerpo));
      assert.strictEqual(r1.cuerpo.estado, 'RECIBIDO');
      assert.strictEqual(r1.cuerpo.ingreso_stock, true);
      assert.deepStrictEqual(
        [r1.cuerpo.costo_unitario, r1.cuerpo.comprobante, r1.cuerpo.consumo_id],
        [null, null, null]
      );
      assert.strictEqual(r1.cuerpo.intervencion_estado, 'EN_PROCESO');
      assert.strictEqual(r1.cuerpo.pedidos_abiertos, 0);
      assert.deepStrictEqual((await movimientos(rep)).slice(1), [
        { tipo: 'INGRESO', cantidad: 3, costo_unitario: null, comprobante: null, proveedor_id: provA },
      ]);
      assert.strictEqual(await stock(rep), 5);
      assert.deepStrictEqual(await consumos(intId), []);

      // Sin stock y sin cuerpo: solo queda recibido
      const ped2 = await crearPedido(intId, { repuesto_id: rep, cantidad: 1 });
      const r2 = await pedir('POST', `/api/intervenciones/${intId}/pedidos/${ped2}/recibir`, R.token);
      assert.strictEqual(r2.status, 200, JSON.stringify(r2.cuerpo));
      assert.strictEqual(r2.cuerpo.ingreso_stock, false);
      assert.deepStrictEqual(await pedidoFila(ped2), {
        estado: 'RECIBIDO', repuesto_id: rep, movimiento_id: null, costo_unitario: null, comprobante: null, consumo_id: null,
      });
      assert.strictEqual(await stock(rep), 5);
      assert.deepStrictEqual(await consumos(intId), []);
    });

    // =========================================================================
    // PC-02: Con stock: recibe 10, usa 4
    // =========================================================================
    let pc02 = { intId: 0, pedidoId: 0, rep: 0, consumoId: 0 };
    await t.test('PC-02: Con stock, recibe 10 y usa 4', async () => {
      const intId = await crearIntervencion();
      const rep = await crearRepuesto(true, 100, 2);
      const pedidoId = await crearPedido(intId, { repuesto_id: rep, cantidad: 10, proveedor_id: provA });
      const costoAntes = await costoRepuestos(intId);

      const r = await recibir(intId, pedidoId, {
        ingresar_stock: true,
        costo_unitario: 150,
        comprobante: 'A-0001-00000001',
        usar: { cantidad: 4 },
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));

      assert.deepStrictEqual((await movimientos(rep)).slice(1), [
        { tipo: 'INGRESO', cantidad: 10, costo_unitario: 150, comprobante: 'A-0001-00000001', proveedor_id: provA },
        { tipo: 'EGRESO', cantidad: 4, costo_unitario: null, comprobante: null, proveedor_id: null },
      ]);
      const cons = await consumos(intId);
      assert.strictEqual(cons.length, 1);
      assert.deepStrictEqual(
        { repuesto_id: cons[0].repuesto_id, cantidad: cons[0].cantidad, costo: cons[0].costo, observacion: cons[0].observacion },
        { repuesto_id: rep, cantidad: 4, costo: 150, observacion: `Pedido N.º ${pedidoId}` }
      );
      assert.strictEqual(await stock(rep), 8, 'El stock sube 6');
      assert.strictEqual(await costoRepuestos(intId), costoAntes + 600);

      const p = await pedidoFila(pedidoId);
      assert.strictEqual(p.consumo_id, cons[0].id);
      assert.strictEqual(p.costo_unitario, 150);
      assert.strictEqual(p.comprobante, 'A-0001-00000001');
      assert.deepStrictEqual(
        [r.cuerpo.consumo_id, r.cuerpo.costo_unitario, r.cuerpo.comprobante, r.cuerpo.ingreso_stock],
        [cons[0].id, 150, 'A-0001-00000001', true]
      );

      // El GET de los pedidos suma los tres campos
      const lista = await pedir('GET', `/api/intervenciones/${intId}/pedidos`, R.token);
      assert.strictEqual(lista.status, 200);
      const item = lista.cuerpo.pedidos.find((x: any) => x.id === pedidoId);
      assert.deepStrictEqual(
        [item.costo_unitario, item.comprobante, item.consumo_id],
        [150, 'A-0001-00000001', cons[0].id]
      );
      // Sin permiso de costos, el costo va en null
      const sinCostos = await pedir('GET', `/api/intervenciones/${intId}/pedidos`, C1.token);
      assert.strictEqual(sinCostos.status, 200);
      const itemT = sinCostos.cuerpo.pedidos.find((x: any) => x.id === pedidoId);
      assert.strictEqual(itemT.costo_unitario, null);
      assert.strictEqual(itemT.comprobante, 'A-0001-00000001');

      pc02 = { intId, pedidoId, rep, consumoId: cons[0].id };
    });

    // =========================================================================
    // PC-03: Con stock y usar, sin ingresar_stock
    // =========================================================================
    await t.test('PC-03: Con stock y usar, sin ingresar_stock', async () => {
      const intId = await crearIntervencion();
      const rep = await crearRepuesto(true, 100, 2);
      const pedidoId = await crearPedido(intId, { repuesto_id: rep, cantidad: 5 });
      const antes = await foto(intId, pedidoId, rep);

      for (const ingresar of [false, undefined]) {
        const r = await recibir(intId, pedidoId, { ingresar_stock: ingresar, usar: { cantidad: 2 } });
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], JSON.stringify(r.cuerpo));
      }
      assert.deepStrictEqual(await foto(intId, pedidoId, rep), antes);
    });

    // =========================================================================
    // PC-04: Con stock: usar 11 de 10, y usar 0
    // =========================================================================
    await t.test('PC-04: Con stock, usar más de lo recibido o 0', async () => {
      const intId = await crearIntervencion();
      const rep = await crearRepuesto(true, 100, 2);
      const pedidoId = await crearPedido(intId, { repuesto_id: rep, cantidad: 10 });
      const antes = await foto(intId, pedidoId, rep);

      for (const cantidad of [11, 0]) {
        const r = await recibir(intId, pedidoId, { ingresar_stock: true, usar: { cantidad } });
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], `usar ${cantidad}: ${JSON.stringify(r.cuerpo)}`);
      }
      assert.deepStrictEqual(await foto(intId, pedidoId, rep), antes);
    });

    // =========================================================================
    // PC-05: Sin stock: recibe 2 a $85.000 y los usa
    // =========================================================================
    await t.test('PC-05: Sin stock, recibe 2 a $85.000 y los usa', async () => {
      const intId = await crearIntervencion();
      const rep = await crearRepuesto(false, 70000);
      const pedidoId = await crearPedido(intId, { repuesto_id: rep, cantidad: 2, proveedor_id: provB });

      const r = await recibir(intId, pedidoId, { costo_unitario: 85000, comprobante: 'B-0002-00000045', usar: { cantidad: 2 } });
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));

      const cons = await consumos(intId);
      assert.strictEqual(cons.length, 1);
      assert.deepStrictEqual([cons[0].repuesto_id, cons[0].cantidad, cons[0].costo], [rep, 2, 85000]);
      const p = await pedidoFila(pedidoId);
      assert.deepStrictEqual(
        [p.estado, p.costo_unitario, p.comprobante, p.consumo_id, p.movimiento_id],
        ['RECIBIDO', 85000, 'B-0002-00000045', cons[0].id, null]
      );
      assert.deepStrictEqual(await movimientos(rep), [], 'Sin movimientos de stock');
      assert.strictEqual(await costoRepuestos(intId), 170000);

      // Sin costo en el cuerpo, el uso sale al costo del repuesto, como hoy
      const ped2 = await crearPedido(intId, { repuesto_id: rep, cantidad: 1 });
      const r2 = await recibir(intId, ped2, { usar: { cantidad: 1 } });
      assert.strictEqual(r2.status, 200, JSON.stringify(r2.cuerpo));
      const cons2 = await consumos(intId);
      assert.strictEqual(cons2[1].costo, 85000, 'El costo del repuesto, que actualizó el uso anterior');
      assert.strictEqual((await pedidoFila(ped2)).costo_unitario, null);
    });

    // =========================================================================
    // PC-06: Sin stock: usar 1 de 2
    // =========================================================================
    await t.test('PC-06: Sin stock, usar una parte', async () => {
      const intId = await crearIntervencion();
      const rep = await crearRepuesto(false, 500);
      const pedidoId = await crearPedido(intId, { repuesto_id: rep, cantidad: 2 });
      const antes = await foto(intId, pedidoId, rep);

      const r = await recibir(intId, pedidoId, { usar: { cantidad: 1 } });
      assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], JSON.stringify(r.cuerpo));
      assert.deepStrictEqual(await foto(intId, pedidoId, rep), antes);
    });

    // =========================================================================
    // PC-07: Texto libre
    // =========================================================================
    await t.test('PC-07: Pedido de texto libre', async () => {
      const intId = await crearIntervencion();
      const rep = await crearRepuesto(false, 1200);
      const libre = await crearPedido(intId, { descripcion: 'Correa trapezoidal A-42', cantidad: 1 });

      // usar sin repuesto_id
      const sinRep = await recibir(intId, libre, { usar: { cantidad: 1 } });
      assert.deepStrictEqual([sinRep.status, sinRep.cuerpo.codigo], [422, 'PEDIDO_SIN_REPUESTO'], JSON.stringify(sinRep.cuerpo));
      assert.strictEqual((await pedidoFila(libre)).estado, 'PENDIENTE');

      // repuesto_id sin usar
      const sinUsar = await recibir(intId, libre, { repuesto_id: rep });
      assert.deepStrictEqual([sinUsar.status, sinUsar.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);

      // Con repuesto_id: se asocia y se usa
      const conRep = await recibir(intId, libre, { repuesto_id: rep, usar: { cantidad: 1 } });
      assert.strictEqual(conRep.status, 200, JSON.stringify(conRep.cuerpo));
      assert.strictEqual(conRep.cuerpo.repuesto.id, rep);
      assert.strictEqual(conRep.cuerpo.descripcion, 'Correa trapezoidal A-42');
      const cons = await consumos(intId);
      assert.deepStrictEqual([cons.length, cons[0].repuesto_id, cons[0].cantidad, cons[0].costo], [1, rep, 1, 1200]);
      const p = await pedidoFila(libre);
      assert.deepStrictEqual([p.repuesto_id, p.consumo_id], [rep, cons[0].id]);

      // repuesto_id en un pedido que ya tiene repuesto
      const otro = await crearRepuesto(false, 10);
      const conRepuesto = await crearPedido(intId, { repuesto_id: rep, cantidad: 1 });
      const r = await recibir(intId, conRepuesto, { repuesto_id: otro, usar: { cantidad: 1 } });
      assert.deepStrictEqual([r.status, r.cuerpo.codigo], [422, 'DATOS_INVALIDOS'], JSON.stringify(r.cuerpo));
      assert.strictEqual((await pedidoFila(conRepuesto)).estado, 'PENDIENTE');
    });

    // =========================================================================
    // PC-08: usar con la intervención finalizada o cancelada
    // =========================================================================
    await t.test('PC-08: usar con la intervención cerrada', async () => {
      const rep = await crearRepuesto(true, 100, 0);

      // Finalizada
      const intF = await crearIntervencion();
      const pedF = await crearPedido(intF, { repuesto_id: rep, cantidad: 2 });
      const fin = await pedir('POST', `/api/intervenciones/${intF}/finalizar`, R.token, {
        estado_esperado: 'EN_PROCESO', trabajo_realizado: 'Arreglo provisorio', ejecucion: 'INTERNA',
      });
      assert.strictEqual(fin.status, 200, JSON.stringify(fin.cuerpo));
      const rF = await recibir(intF, pedF, { ingresar_stock: true, usar: { cantidad: 1 }, motivo: 'Corrección con motivo' });
      assert.deepStrictEqual([rF.status, rF.cuerpo.codigo], [409, 'ESTADO_NO_PERMITE_REPUESTOS'], JSON.stringify(rF.cuerpo));
      assert.strictEqual(await stock(rep), 0);

      // Cancelada
      const intC = await crearIntervencion();
      const pedC = await crearPedido(intC, { repuesto_id: rep, cantidad: 3 });
      const canc = await pedir('POST', `/api/intervenciones/${intC}/cancelar`, R.token, {
        estado_esperado: 'EN_PROCESO', motivo: 'Se descartó la reparación',
      });
      assert.strictEqual(canc.status, 200, JSON.stringify(canc.cuerpo));
      const rC = await recibir(intC, pedC, { ingresar_stock: true, usar: { cantidad: 1 } });
      assert.deepStrictEqual([rC.status, rC.cuerpo.codigo], [409, 'ESTADO_NO_PERMITE_REPUESTOS'], JSON.stringify(rC.cuerpo));

      // Sin usar, se reciben igual y entran al stock
      const okF = await recibir(intF, pedF, { ingresar_stock: true });
      assert.strictEqual(okF.status, 200, JSON.stringify(okF.cuerpo));
      assert.strictEqual(okF.cuerpo.intervencion_estado, 'FINALIZADA');
      const okC = await recibir(intC, pedC, { ingresar_stock: true });
      assert.strictEqual(okC.status, 200, JSON.stringify(okC.cuerpo));
      assert.strictEqual(okC.cuerpo.intervencion_estado, 'CANCELADA');
      assert.strictEqual(await stock(rep), 5);
      assert.deepStrictEqual([...(await consumos(intF)), ...(await consumos(intC))], []);
    });

    // =========================================================================
    // PC-09: El uso falla: no se recibe nada
    // =========================================================================
    await t.test('PC-09: El uso falla con el repuesto inactivo', async () => {
      const intId = await crearIntervencion();

      // Sin stock
      const repSin = await crearRepuesto(false, 300);
      const pedSin = await crearPedido(intId, { repuesto_id: repSin, cantidad: 1 });
      // Con stock
      const repCon = await crearRepuesto(true, 300, 4);
      const pedCon = await crearPedido(intId, { repuesto_id: repCon, cantidad: 2 });
      await client.query('UPDATE repuestos SET activo = FALSE WHERE id = ANY($1)', [[repSin, repCon]]);

      const antesSin = await consumos(intId);
      const rSin = await recibir(intId, pedSin, { costo_unitario: 350, usar: { cantidad: 1 } });
      assert.deepStrictEqual([rSin.status, rSin.cuerpo.codigo], [409, 'REPUESTO_INACTIVO'], JSON.stringify(rSin.cuerpo));
      assert.deepStrictEqual(await pedidoFila(pedSin), {
        estado: 'PENDIENTE', repuesto_id: repSin, movimiento_id: null, costo_unitario: null, comprobante: null, consumo_id: null,
      });
      assert.deepStrictEqual(await consumos(intId), antesSin);

      const antesCon = await foto(intId, pedCon, repCon);
      const rCon = await recibir(intId, pedCon, { ingresar_stock: true, usar: { cantidad: 2 } });
      assert.deepStrictEqual([rCon.status, rCon.cuerpo.codigo], [409, 'REPUESTO_INACTIVO'], JSON.stringify(rCon.cuerpo));
      assert.deepStrictEqual(await foto(intId, pedCon, repCon), antesCon);
      assert.strictEqual(await stock(repCon), 4);
    });

    // =========================================================================
    // PC-10: costo_unitario sin permiso de costos
    // =========================================================================
    await t.test('PC-10: costo_unitario sin permiso de costos', async () => {
      const intId = await crearIntervencion();
      const repSin = await crearRepuesto(false, 300);
      const repCon = await crearRepuesto(true, 300, 0);
      const pedSin = await crearPedido(intId, { repuesto_id: repSin, cantidad: 1 });
      const pedCon = await crearPedido(intId, { repuesto_id: repCon, cantidad: 1 });

      const rSin = await recibir(intId, pedSin, { costo_unitario: 400 }, T.token);
      assert.deepStrictEqual([rSin.status, rSin.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE'], JSON.stringify(rSin.cuerpo));
      const rCon = await recibir(intId, pedCon, { ingresar_stock: true, costo_unitario: 400 }, T.token);
      assert.deepStrictEqual([rCon.status, rCon.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE'], JSON.stringify(rCon.cuerpo));
      assert.strictEqual((await pedidoFila(pedSin)).estado, 'PENDIENTE');
      assert.strictEqual((await pedidoFila(pedCon)).estado, 'PENDIENTE');

      // Sin costo, T recibe igual
      const ok = await recibir(intId, pedSin, { comprobante: 'R-0003' }, T.token);
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.cuerpo));
      assert.strictEqual((await pedidoFila(pedSin)).comprobante, 'R-0003');
    });

    // =========================================================================
    // PC-11: pedidos_abiertos
    // =========================================================================
    await t.test('PC-11: pedidos_abiertos', async () => {
      const intId = await crearIntervencion();
      const rep = await crearRepuesto(false, 100);
      const ped1 = await crearPedido(intId, { repuesto_id: rep, cantidad: 1 });
      const ped2 = await crearPedido(intId, { descripcion: 'Retén de aceite 35x52', cantidad: 2, pedido_en: '2026-11-01' });
      const esp = await pedir('POST', `/api/intervenciones/${intId}/espera-repuestos`, R.token, {
        estado_esperado: 'EN_PROCESO', observacion: 'Esperando los dos pedidos',
      });
      assert.strictEqual(esp.status, 200, JSON.stringify(esp.cuerpo));

      const r1 = await recibir(intId, ped1, {});
      assert.strictEqual(r1.status, 200, JSON.stringify(r1.cuerpo));
      assert.deepStrictEqual([r1.cuerpo.intervencion_estado, r1.cuerpo.pedidos_abiertos], ['EN_ESPERA_REPUESTOS', 1]);
      const r2 = await recibir(intId, ped2, {});
      assert.strictEqual(r2.status, 200, JSON.stringify(r2.cuerpo));
      assert.deepStrictEqual([r2.cuerpo.intervencion_estado, r2.cuerpo.pedidos_abiertos], ['EN_ESPERA_REPUESTOS', 0]);
    });

    // =========================================================================
    // PC-12: Anular el uso que vino de un pedido
    // =========================================================================
    await t.test('PC-12: Anular el uso que vino de un pedido', async () => {
      const { intId, pedidoId, rep, consumoId } = pc02;
      assert.ok(consumoId > 0, 'PC-02 dejó un uso');
      const stockAntes = await stock(rep);
      const r = await pedir('POST', `/api/intervenciones/${intId}/repuestos/${consumoId}/anular`, R.token, {
        motivo: 'Se usó otro repuesto',
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      assert.strictEqual(await stock(rep), stockAntes + 4, 'El stock vuelve');
      const p = await pedidoFila(pedidoId);
      assert.deepStrictEqual([p.estado, p.consumo_id], ['RECIBIDO', consumoId], 'El pedido sigue recibido');
    });

    // =========================================================================
    // PC-13: Compras
    // =========================================================================
    let pc13 = { desde: '', hasta: '', comprobantes: [] as string[] };
    await t.test('PC-13: Compras', async () => {
      // Lo de la prueba se arma antes de la ventana: los repuestos nacen sin stock inicial
      const repManual = await crearRepuesto(true, 4000, 0);
      const repPedStock = await crearRepuesto(true, 150, 0);
      const repPedSin = await crearRepuesto(false, 900);
      const repSinProv = await crearRepuesto(true, 40, 0);
      const intId = await crearIntervencion();
      const pedStock = await crearPedido(intId, { repuesto_id: repPedStock, cantidad: 3, proveedor_id: provB });
      const pedSin = await crearPedido(intId, { repuesto_id: repPedSin, cantidad: 2, proveedor_id: provB });
      const pedLibre = await crearPedido(intId, { descripcion: 'Junta de tapa especial', cantidad: 1 });
      const pedSinProv = await crearPedido(intId, { repuesto_id: repSinProv, cantidad: 1 });

      const desde = new Date((await client.query('SELECT NOW() AS t')).rows[0].t).toISOString();

      // 1. Ingreso manual con proveedor
      const m1 = await pedir('POST', `/api/repuestos/${repManual}/movimientos`, R.token, {
        tipo: 'INGRESO', cantidad: 100, costo_unitario: 5000, proveedor_id: provA, comprobante: `A-0001-${suf}`,
      });
      assert.strictEqual(m1.status, 201, JSON.stringify(m1.cuerpo));
      // 2. Ingreso manual sin proveedor: no es compra
      const m2 = await pedir('POST', `/api/repuestos/${repManual}/movimientos`, R.token, {
        tipo: 'INGRESO', cantidad: 5, costo_unitario: 10,
      });
      assert.strictEqual(m2.status, 201, JSON.stringify(m2.cuerpo));
      // 3. Pedido que entra al stock
      const r3 = await recibir(intId, pedStock, { ingresar_stock: true, costo_unitario: 200, comprobante: `B-0001-${suf}` });
      assert.strictEqual(r3.status, 200, JSON.stringify(r3.cuerpo));
      // 4. Pedido sin stock
      const r4 = await recibir(intId, pedSin, { costo_unitario: 1000, comprobante: `B-0002-${suf}` });
      assert.strictEqual(r4.status, 200, JSON.stringify(r4.cuerpo));
      // 5. Pedido de texto libre, sin costo ni proveedor
      const r5 = await recibir(intId, pedLibre, {});
      assert.strictEqual(r5.status, 200, JSON.stringify(r5.cuerpo));
      // 6. Pedido sin proveedor que entra al stock: es compra, en "Sin proveedor"
      const r6 = await recibir(intId, pedSinProv, { ingresar_stock: true, costo_unitario: 50 });
      assert.strictEqual(r6.status, 200, JSON.stringify(r6.cuerpo));

      const hasta = new Date((await client.query('SELECT NOW() AS t')).rows[0].t).toISOString();
      const hoy: string = (await client.query(`SELECT to_char(hoy_instalacion(), 'YYYY-MM-DD') AS h`)).rows[0].h;

      const r = await pedir('GET', `/api/reportes/compras?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`, A.token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
      const c = r.cuerpo;

      assert.strictEqual(c.compras, 5);
      assert.strictEqual(c.total, 500000 + 600 + 2000 + 50);
      assert.strictEqual(c.sin_costo, 1);
      assert.strictEqual(c.ingresos_sin_proveedor, 1);
      assert.deepStrictEqual(
        c.por_proveedor.map((g: any) => [g.proveedor?.id ?? null, g.compras, g.importe]),
        [[provA, 1, 500000], [provB, 2, 2600], [null, 2, 50]]
      );

      const fila = (pred: (f: any) => boolean) => c.filas.filter(pred);
      const f1 = fila((f) => f.comprobante === `A-0001-${suf}`);
      assert.deepStrictEqual(f1, [{
        fecha: hoy,
        proveedor: { id: provA, nombre: `Proveedor PC A ${suf}` },
        comprobante: `A-0001-${suf}`,
        repuesto: { id: repManual, codigo: `PC${numeroRepuesto - 3}_${suf}`, nombre: `Repuesto PC ${numeroRepuesto - 3}` },
        descripcion: null,
        cantidad: 100, unidad: 'unidad',
        costo_unitario: 5000, importe: 500000,
        origen: { tipo: 'STOCK', intervencion: null },
      }]);
      // El pedido que entró al stock, una sola vez y por su movimiento
      const f3 = fila((f) => f.repuesto?.id === repPedStock);
      assert.strictEqual(f3.length, 1);
      assert.deepStrictEqual(f3[0].origen, { tipo: 'STOCK', intervencion: { id: intId, maquina: { id: mId, codigo: mCodigo } } });
      assert.deepStrictEqual([f3[0].cantidad, f3[0].costo_unitario, f3[0].importe], [3, 200, 600]);
      const f4 = fila((f) => f.repuesto?.id === repPedSin);
      assert.deepStrictEqual(
        [f4.length, f4[0].origen.tipo, f4[0].importe, f4[0].comprobante],
        [1, 'INTERVENCION', 2000, `B-0002-${suf}`]
      );
      const f5 = fila((f) => f.descripcion === 'Junta de tapa especial');
      assert.deepStrictEqual(
        [f5.length, f5[0].repuesto, f5[0].proveedor, f5[0].costo_unitario, f5[0].importe, f5[0].origen.tipo],
        [1, null, null, null, null, 'INTERVENCION']
      );
      const f6 = fila((f) => f.repuesto?.id === repSinProv);
      assert.deepStrictEqual([f6.length, f6[0].proveedor, f6[0].importe, f6[0].origen.tipo], [1, null, 50, 'STOCK']);
      assert.ok(c.filas.every((f: any) => f.fecha === hoy));

      pc13 = { desde, hasta, comprobantes: [`A-0001-${suf}`, `B-0001-${suf}`, `B-0002-${suf}`] };
    });

    // =========================================================================
    // PC-14: Compras, permisos y filtros
    // =========================================================================
    await t.test('PC-14: Compras, permisos y filtros', async () => {
      const q = `desde=${encodeURIComponent(pc13.desde)}&hasta=${encodeURIComponent(pc13.hasta)}`;
      for (const [quien, token] of [['sin COSTOS_VER', C1.token], ['alcance de sector', C2.token], ['operario', O.token]] as const) {
        const r = await pedir('GET', `/api/reportes/compras?${q}`, token);
        assert.deepStrictEqual([r.status, r.cuerpo.codigo], [403, 'PERMISO_INSUFICIENTE'], quien);
      }

      // Por proveedor
      const porProv = await pedir('GET', `/api/reportes/compras?${q}&proveedor_id=${provB}`, A.token);
      assert.strictEqual(porProv.status, 200, JSON.stringify(porProv.cuerpo));
      assert.strictEqual(porProv.cuerpo.compras, 2);
      assert.ok(porProv.cuerpo.filas.every((f: any) => f.proveedor?.id === provB));
      assert.strictEqual(porProv.cuerpo.total, 2600);
      assert.strictEqual(porProv.cuerpo.ingresos_sin_proveedor, 0);
      assert.deepStrictEqual(porProv.cuerpo.por_proveedor.map((g: any) => g.proveedor.id), [provB]);

      // Período: antes de la ventana no está ninguna de estas compras; con el proveedor A están
      // solo las recepciones de PC-01 (3, sin costo) y PC-02 (10 a $150)
      const antesDesde = new Date(new Date(pc13.desde).getTime() - 86400000).toISOString();
      const antesHasta = new Date(new Date(pc13.desde).getTime() - 1000).toISOString();
      const antes = await pedir(
        'GET',
        `/api/reportes/compras?desde=${encodeURIComponent(antesDesde)}&hasta=${encodeURIComponent(antesHasta)}&proveedor_id=${provA}`,
        A.token
      );
      assert.strictEqual(antes.status, 200, JSON.stringify(antes.cuerpo));
      assert.ok(!antes.cuerpo.filas.some((f: any) => pc13.comprobantes.includes(f.comprobante)));
      assert.deepStrictEqual(
        [antes.cuerpo.compras, antes.cuerpo.total, antes.cuerpo.sin_costo],
        [2, 1500, 1]
      );

      // Parámetros inválidos
      const malProv = await pedir('GET', `/api/reportes/compras?${q}&proveedor_id=abc`, A.token);
      assert.deepStrictEqual([malProv.status, malProv.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
      const alReves = await pedir(
        'GET', `/api/reportes/compras?desde=${encodeURIComponent(pc13.hasta)}&hasta=${encodeURIComponent(pc13.desde)}`, A.token
      );
      assert.deepStrictEqual([alReves.status, alReves.cuerpo.codigo], [422, 'DATOS_INVALIDOS']);
    });

    // =========================================================================
    // PC-15: Concurrencia
    // =========================================================================
    await t.test('PC-15: Dos recepciones a la vez del mismo pedido', async () => {
      const intId = await crearIntervencion();
      const rep = await crearRepuesto(true, 100, 0);
      const pedidoId = await crearPedido(intId, { repuesto_id: rep, cantidad: 6 });
      const cuerpo = { ingresar_stock: true, costo_unitario: 120, usar: { cantidad: 2 } };

      const [r1, r2] = await Promise.all([recibir(intId, pedidoId, cuerpo), recibir(intId, pedidoId, cuerpo)]);
      const estados = [r1.status, r2.status].sort();
      assert.deepStrictEqual(estados, [200, 409], `${JSON.stringify(r1.cuerpo)} ${JSON.stringify(r2.cuerpo)}`);
      const rechazada = r1.status === 409 ? r1 : r2;
      assert.strictEqual(rechazada.cuerpo.codigo, 'PEDIDO_CERRADO');

      const movs = await movimientos(rep);
      assert.deepStrictEqual(movs.map((m) => [m.tipo, m.cantidad]), [['INGRESO', 6], ['EGRESO', 2]]);
      assert.strictEqual((await consumos(intId)).length, 1);
      assert.strictEqual(await stock(rep), 4);
    });
  } finally {
    client = await clienteSano(client);
    // Limpieza: los pedidos primero (apuntan a los usos), después los usos, el stock y lo demás
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
        await client.query('DELETE FROM notificacion_envios WHERE notificacion_id IN (SELECT id FROM notificaciones WHERE usuario_id = ANY($1))', [createdUsuarioIds]);
        await client.query('DELETE FROM notificaciones WHERE usuario_id = ANY($1)', [createdUsuarioIds]);
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
