import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission, requireAlgunPermiso } from './middleware.ts';
import { ErrorNegocio, responderError } from './intervenciones/errores.ts';
import { veCostos, puedeCargarCostos } from './repuestos/permisos.ts';
import {
  validarCantidad,
  validarCantidadDesdeCero,
  validarCosto,
  parseIdRuta,
  validarIdCuerpo,
  validarBooleano,
} from './repuestos/validaciones.ts';
import { moverStock, cambiarCosto } from './repuestos/stock.ts';

const repuestosApp = new Hono();

repuestosApp.use('*', jwtVerify, dbVerify);

export type EstadoStock = 'SIN_CONTROL' | 'SIN_STOCK' | 'BAJO' | 'OK';

export function calcularEstadoStock(
  llevaStock: boolean,
  cantidadDisponible: number,
  stockMinimo: number | null
): EstadoStock {
  if (!llevaStock) return 'SIN_CONTROL';
  if (cantidadDisponible <= 0) return 'SIN_STOCK';
  if (stockMinimo !== null && cantidadDisponible <= stockMinimo) return 'BAJO';
  return 'OK';
}

function armarFilaRepuesto(row: any, tienePermisoCostos: boolean) {
  const llevaStock = Boolean(row.lleva_stock);
  const cantidadDisponible = Number(row.cantidad_disponible);
  const stockMinimo =
    row.stock_minimo !== null && row.stock_minimo !== undefined
      ? Number(row.stock_minimo)
      : null;
  const costoUnitario = tienePermisoCostos
    ? row.costo_unitario !== null && row.costo_unitario !== undefined
      ? Number(row.costo_unitario)
      : 0
    : null;

  return {
    id: Number(row.id),
    codigo: row.codigo || null,
    nombre: row.nombre,
    unidad: row.unidad || 'unidad',
    lleva_stock: llevaStock,
    cantidad_disponible: cantidadDisponible,
    stock_minimo: stockMinimo,
    estado_stock: calcularEstadoStock(llevaStock, cantidadDisponible, stockMinimo),
    costo_unitario: costoUnitario,
    proveedor: row.proveedor_id
      ? {
          id: Number(row.proveedor_id),
          nombre: row.proveedor_nombre,
          activo: Boolean(row.proveedor_activo),
        }
      : null,
    ubicacion: row.ubicacion || null,
    activo: Boolean(row.activo),
  };
}

// 1. GET /opciones (declarado antes de /:id)
repuestosApp.get(
  '/opciones',
  requireAlgunPermiso(['REPUESTOS_GESTIONAR', 'INTERVENCIONES_CAMBIAR_ESTADO']),
  async (c) => {
    try {
      const tienePermisoCostos = veCostos(c);
      const res = await pool.query(`
        SELECT id, codigo, nombre, unidad, lleva_stock, cantidad_disponible, costo_unitario
        FROM repuestos
        WHERE activo = TRUE
        ORDER BY lower(trim(nombre)) ASC
      `);

      const opciones = res.rows.map((r) => ({
        id: Number(r.id),
        codigo: r.codigo || null,
        nombre: r.nombre,
        unidad: r.unidad || 'unidad',
        lleva_stock: Boolean(r.lleva_stock),
        cantidad_disponible: Number(r.cantidad_disponible),
        costo_unitario: tienePermisoCostos ? Number(r.costo_unitario) : null,
      }));

      return c.json(opciones, 200);
    } catch (err) {
      return responderError(c, err);
    }
  }
);

// 2. GET /
repuestosApp.get('/', requirePermission('REPUESTOS_GESTIONAR'), async (c) => {
  try {
    const all = c.req.query('all') === 'true';
    const whereClause = all ? '' : 'WHERE r.activo = TRUE';
    const tienePermisoCostos = veCostos(c);

    const sql = `
      SELECT
        r.*,
        p.nombre AS proveedor_nombre,
        p.activo AS proveedor_activo
      FROM repuestos r
      LEFT JOIN proveedores p ON p.id = r.proveedor_id
      ${whereClause}
      ORDER BY lower(trim(r.nombre)) ASC
    `;

    const res = await pool.query(sql);
    const filas = res.rows.map((r) => armarFilaRepuesto(r, tienePermisoCostos));
    return c.json(filas, 200);
  } catch (err) {
    return responderError(c, err);
  }
});

// Helper para obtener el detalle de un repuesto
async function obtenerDetalleRepuesto(id: number, tienePermisoCostos: boolean) {
  const sql = `
    SELECT
      r.*,
      p.nombre AS proveedor_nombre,
      p.activo AS proveedor_activo,
      COALESCE(ped.pedidos_abiertos, 0)::int AS pedidos_abiertos,
      COALESCE(con.consumos_vigentes, 0)::int AS consumos_vigentes
    FROM repuestos r
    LEFT JOIN proveedores p ON p.id = r.proveedor_id
    LEFT JOIN (
      SELECT repuesto_id, COUNT(*)::int AS pedidos_abiertos
      FROM pedidos_repuesto
      WHERE estado IN ('PENDIENTE', 'PEDIDO')
      GROUP BY repuesto_id
    ) ped ON ped.repuesto_id = r.id
    LEFT JOIN (
      SELECT repuesto_id, COUNT(*)::int AS consumos_vigentes
      FROM intervencion_repuestos
      WHERE anulado_en IS NULL
      GROUP BY repuesto_id
    ) con ON con.repuesto_id = r.id
    WHERE r.id = $1
  `;

  const res = await pool.query(sql, [id]);
  if (res.rows.length === 0) {
    return null;
  }
  const row = res.rows[0];
  const filaBase = armarFilaRepuesto(row, tienePermisoCostos);

  return {
    ...filaBase,
    descripcion: row.descripcion || null,
    creado_en: row.creado_en,
    actualizado_en: row.actualizado_en,
    pedidos_abiertos: Number(row.pedidos_abiertos || 0),
    consumos_vigentes: Number(row.consumos_vigentes || 0),
  };
}

// 3. GET /:id
repuestosApp.get('/:id', requirePermission('REPUESTOS_GESTIONAR'), async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
    }

    const detalle = await obtenerDetalleRepuesto(id, veCostos(c));
    if (!detalle) {
      throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
    }

    return c.json(detalle, 200);
  } catch (err) {
    return responderError(c, err);
  }
});

// 4. POST /
repuestosApp.post('/', requirePermission('REPUESTOS_GESTIONAR'), async (c) => {
  const client = await pool.connect();
  try {
    const userId = Number((c.get as any)('userId'));
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Cuerpo JSON inválido');
    }

    // 1. nombre
    const nombreRaw = typeof body.nombre === 'string' ? body.nombre.trim() : '';
    if (nombreRaw.length < 2 || nombreRaw.length > 150) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El nombre debe tener entre 2 y 150 caracteres');
    }

    // 2. codigo
    let codigo: string | null = null;
    if (body.codigo !== undefined && body.codigo !== null) {
      if (typeof body.codigo !== 'string') {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El código debe ser texto');
      }
      const cTrim = body.codigo.trim();
      if (cTrim.length > 40) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El código no puede tener más de 40 caracteres');
      }
      codigo = cTrim.length > 0 ? cTrim : null;
    }

    // 3. unidad
    let unidad = 'unidad';
    if (body.unidad !== undefined && body.unidad !== null) {
      if (typeof body.unidad !== 'string') {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La unidad debe ser texto');
      }
      const uTrim = body.unidad.trim();
      if (uTrim.length < 1 || uTrim.length > 20) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La unidad debe tener entre 1 y 20 caracteres');
      }
      unidad = uTrim;
    }

    // 4. lleva_stock
    let llevaStock = true;
    if (body.lleva_stock !== undefined) {
      validarBooleano(body.lleva_stock, 'lleva_stock');
      llevaStock = body.lleva_stock;
    }

    // 5. stock_inicial
    let stockInicial = 0;
    if (body.stock_inicial !== undefined && body.stock_inicial !== null) {
      if (!llevaStock) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Un repuesto sin control de stock no puede tener stock inicial');
      }
      stockInicial = validarCantidadDesdeCero(body.stock_inicial, 'stock_inicial');
    }

    // 6. stock_minimo
    let stockMinimo: number | null = null;
    if (body.stock_minimo !== undefined && body.stock_minimo !== null) {
      if (!llevaStock) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Un repuesto sin control de stock no puede tener stock mínimo');
      }
      stockMinimo = validarCantidadDesdeCero(body.stock_minimo, 'stock_minimo');
    }

    // 7. costo_unitario
    let costoUnitario = 0;
    if (body.costo_unitario !== undefined && body.costo_unitario !== null) {
      if (!puedeCargarCostos(c)) {
        throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tiene permiso para registrar costos');
      }
      costoUnitario = validarCosto(body.costo_unitario, 'costo_unitario');
    }

    // 8. proveedor_id
    let proveedorId: number | null = null;
    if (body.proveedor_id !== undefined && body.proveedor_id !== null) {
      proveedorId = validarIdCuerpo(body.proveedor_id, 'PROVEEDOR_INVALIDO', 'proveedor_id');
    }

    // 9. ubicacion y descripcion
    const ubicacion = typeof body.ubicacion === 'string' && body.ubicacion.trim() ? body.ubicacion.trim() : null;
    if (ubicacion && ubicacion.length > 100) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La ubicación no puede superar los 100 caracteres');
    }
    const descripcion = typeof body.descripcion === 'string' && body.descripcion.trim() ? body.descripcion.trim() : null;
    if (descripcion && descripcion.length > 1000) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La descripción no puede superar los 1000 caracteres');
    }

    // 10. Validar código duplicado
    if (codigo !== null) {
      const dup = await pool.query(
        'SELECT id FROM repuestos WHERE upper(trim(codigo)) = upper(trim($1))',
        [codigo]
      );
      if (dup.rows.length > 0) {
        throw new ErrorNegocio(409, 'CODIGO_DUPLICADO', 'Ya existe un repuesto con ese código');
      }
    }

    await client.query('BEGIN');

    if (proveedorId !== null) {
      const provRes = await client.query('SELECT id, activo FROM proveedores WHERE id = $1 FOR SHARE', [proveedorId]);
      if (provRes.rows.length === 0 || !provRes.rows[0].activo) {
        throw new ErrorNegocio(422, 'PROVEEDOR_INVALIDO', 'El proveedor no existe o está inactivo');
      }
    }

    let insRep: any;
    try {
      insRep = await client.query(
        `INSERT INTO repuestos (
           nombre, codigo, unidad, lleva_stock, cantidad_disponible, stock_minimo,
           costo_unitario, proveedor_id, proveedor, ubicacion, descripcion, activo, creado_en, actualizado_en
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10, TRUE, NOW(), NOW())
         RETURNING id`,
        [
          nombreRaw,
          codigo,
          unidad,
          llevaStock,
          llevaStock ? stockInicial : 0,
          stockMinimo,
          costoUnitario,
          proveedorId,
          ubicacion,
          descripcion,
        ]
      );
    } catch (dbErr: any) {
      if (dbErr.code === '23505' || dbErr.constraint === 'uq_repuestos_codigo') {
        throw new ErrorNegocio(409, 'CODIGO_DUPLICADO', 'Ya existe un repuesto con ese código');
      }
      throw dbErr;
    }
    const repuestoId = Number(insRep.rows[0].id);

    // Siempre agrega la fila ALTA al historial de costos
    await client.query(
      `INSERT INTO repuesto_costos (repuesto_id, costo_unitario, origen, registrado_por_usuario_id, registrado_en)
       VALUES ($1, $2, 'ALTA', $3, NOW())`,
      [repuestoId, costoUnitario, userId]
    );

    // Si stock_inicial > 0, crea un INGRESO con observación "Stock inicial"
    if (llevaStock && stockInicial > 0) {
      await client.query(
        `INSERT INTO movimientos_stock (
           repuesto_id, tipo, cantidad, delta, stock_resultante, costo_unitario, observacion, realizado_por_usuario_id, realizado_en
         ) VALUES ($1, 'INGRESO', $2, $2, $2, $3, 'Stock inicial', $4, NOW())`,
        [repuestoId, stockInicial, costoUnitario, userId]
      );
    }

    await client.query('COMMIT');

    const detalle = await obtenerDetalleRepuesto(repuestoId, veCostos(c));
    return c.json(detalle, 201);
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

// 5. PUT /:id
repuestosApp.put('/:id', requirePermission('REPUESTOS_GESTIONAR'), async (c) => {
  const client = await pool.connect();
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
    }
    const userId = Number((c.get as any)('userId'));

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Cuerpo JSON inválido');
    }

    // Mandar cantidad_disponible da 422
    if (body.cantidad_disponible !== undefined) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El stock se cambia con movimientos');
    }

    // Validar booleanos si vienen
    if (body.lleva_stock !== undefined) {
      validarBooleano(body.lleva_stock, 'lleva_stock');
    }
    if (body.activo !== undefined) {
      validarBooleano(body.activo, 'activo');
    }

    // Validar proveedor_id si viene
    if (body.proveedor_id !== undefined && body.proveedor_id !== null) {
      validarIdCuerpo(body.proveedor_id, 'PROVEEDOR_INVALIDO', 'proveedor_id');
    }

    await client.query('BEGIN');

    const exRes = await client.query('SELECT * FROM repuestos WHERE id = $1 FOR UPDATE', [id]);
    if (exRes.rows.length === 0) {
      throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
    }
    const actual = exRes.rows[0];

    // nombre
    let nombre = actual.nombre;
    if (body.nombre !== undefined) {
      const nombreRaw = typeof body.nombre === 'string' ? body.nombre.trim() : '';
      if (nombreRaw.length < 2 || nombreRaw.length > 150) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El nombre debe tener entre 2 y 150 caracteres');
      }
      nombre = nombreRaw;
    }

    // codigo
    let codigo = actual.codigo;
    if (body.codigo !== undefined) {
      if (body.codigo === null || body.codigo === '') {
        codigo = null;
      } else {
        if (typeof body.codigo !== 'string') {
          throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El código debe ser texto');
        }
        const cTrim = body.codigo.trim();
        if (cTrim.length > 40) {
          throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El código no puede superar los 40 caracteres');
        }
        codigo = cTrim.length > 0 ? cTrim : null;
      }
      if (codigo !== null) {
        const dup = await client.query(
          'SELECT id FROM repuestos WHERE upper(trim(codigo)) = upper(trim($1)) AND id <> $2',
          [codigo, id]
        );
        if (dup.rows.length > 0) {
          throw new ErrorNegocio(409, 'CODIGO_DUPLICADO', 'Ya existe un repuesto con ese código');
        }
      }
    }

    // unidad
    let unidad = actual.unidad;
    if (body.unidad !== undefined) {
      if (typeof body.unidad !== 'string') {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La unidad debe ser texto');
      }
      const uTrim = body.unidad.trim();
      if (uTrim.length < 1 || uTrim.length > 20) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La unidad debe tener entre 1 y 20 caracteres');
      }
      unidad = uTrim;
    }

    // proveedor_id
    let proveedorId = actual.proveedor_id;
    let actualizaProveedor = false;
    if (body.proveedor_id !== undefined) {
      actualizaProveedor = true;
      if (body.proveedor_id === null) {
        proveedorId = null;
      } else {
        const pId = validarIdCuerpo(body.proveedor_id, 'PROVEEDOR_INVALIDO', 'proveedor_id');
        const provRes = await client.query('SELECT id, activo FROM proveedores WHERE id = $1 FOR SHARE', [pId]);
        if (provRes.rows.length === 0 || !provRes.rows[0].activo) {
          throw new ErrorNegocio(422, 'PROVEEDOR_INVALIDO', 'El proveedor no existe o está inactivo');
        }
        proveedorId = pId;
      }
    }

    // lleva_stock
    let llevaStock = Boolean(actual.lleva_stock);
    if (body.lleva_stock !== undefined) {
      const nuevoLlevaStock = Boolean(body.lleva_stock);
      if (!nuevoLlevaStock && llevaStock) {
        const cantActual = Number(actual.cantidad_disponible);
        if (cantActual > 0) {
          throw new ErrorNegocio(409, 'TIENE_STOCK', 'El repuesto tiene stock acumulado', {
            cantidad_disponible: cantActual,
          });
        }
      }
      llevaStock = nuevoLlevaStock;
    }

    // stock_minimo
    let stockMinimo = actual.stock_minimo !== null ? Number(actual.stock_minimo) : null;
    if (!llevaStock) {
      stockMinimo = null;
    } else if (body.stock_minimo !== undefined) {
      if (body.stock_minimo === null) {
        stockMinimo = null;
      } else {
        stockMinimo = validarCantidadDesdeCero(body.stock_minimo, 'stock_minimo');
      }
    }

    // costo_unitario
    let nuevoCosto: number | undefined = undefined;
    if (body.costo_unitario !== undefined && body.costo_unitario !== null) {
      if (!puedeCargarCostos(c)) {
        throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tiene permiso para registrar costos');
      }
      nuevoCosto = validarCosto(body.costo_unitario, 'costo_unitario');
    }

    // ubicacion, descripcion, activo
    let ubicacion = actual.ubicacion;
    if (body.ubicacion !== undefined) {
      ubicacion = typeof body.ubicacion === 'string' && body.ubicacion.trim() ? body.ubicacion.trim() : null;
      if (ubicacion && ubicacion.length > 100) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La ubicación no puede superar los 100 caracteres');
      }
    }

    let descripcion = actual.descripcion;
    if (body.descripcion !== undefined) {
      descripcion = typeof body.descripcion === 'string' && body.descripcion.trim() ? body.descripcion.trim() : null;
      if (descripcion && descripcion.length > 1000) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La descripción no puede superar los 1000 caracteres');
      }
    }

    let activo = actual.activo;
    if (body.activo !== undefined) {
      activo = body.activo;
    }

    try {
      if (actualizaProveedor) {
        await client.query(
          `UPDATE repuestos
           SET nombre = $1, codigo = $2, unidad = $3, lleva_stock = $4, stock_minimo = $5,
               proveedor_id = $6, proveedor = NULL, ubicacion = $7, descripcion = $8, activo = $9, actualizado_en = NOW()
           WHERE id = $10`,
          [nombre, codigo, unidad, llevaStock, stockMinimo, proveedorId, ubicacion, descripcion, activo, id]
        );
      } else {
        await client.query(
          `UPDATE repuestos
           SET nombre = $1, codigo = $2, unidad = $3, lleva_stock = $4, stock_minimo = $5,
               proveedor_id = $6, ubicacion = $7, descripcion = $8, activo = $9, actualizado_en = NOW()
           WHERE id = $10`,
          [nombre, codigo, unidad, llevaStock, stockMinimo, proveedorId, ubicacion, descripcion, activo, id]
        );
      }
    } catch (dbErr: any) {
      if (dbErr.code === '23505' || dbErr.constraint === 'uq_repuestos_codigo') {
        throw new ErrorNegocio(409, 'CODIGO_DUPLICADO', 'Ya existe un repuesto con ese código');
      }
      throw dbErr;
    }

    if (nuevoCosto !== undefined) {
      await cambiarCosto(client, {
        repuestoId: id,
        costo: nuevoCosto,
        origen: 'EDICION',
        usuarioId: userId,
      });
    }

    await client.query('COMMIT');

    const detalle = await obtenerDetalleRepuesto(id, veCostos(c));
    return c.json(detalle, 200);
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

// 6. DELETE /:id
repuestosApp.delete('/:id', requirePermission('REPUESTOS_GESTIONAR'), async (c) => {
  const client = await pool.connect();
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
    }

    await client.query('BEGIN');

    const exRes = await client.query('SELECT id, activo, cantidad_disponible FROM repuestos WHERE id = $1 FOR UPDATE', [id]);
    if (exRes.rows.length === 0) {
      throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
    }
    const rep = exRes.rows[0];

    if (!rep.activo) {
      await client.query('COMMIT');
      return c.json({ ok: true, mensaje: 'Repuesto ya inactivo' }, 200);
    }

    const cantActual = Number(rep.cantidad_disponible);
    if (cantActual > 0) {
      throw new ErrorNegocio(409, 'TIENE_STOCK', 'El repuesto tiene stock mayor a 0', {
        cantidad_disponible: cantActual,
      });
    }

    const pedRes = await client.query(
      "SELECT COUNT(*)::int AS count FROM pedidos_repuesto WHERE repuesto_id = $1 AND estado IN ('PENDIENTE', 'PEDIDO')",
      [id]
    );
    const pedAbiertos = Number(pedRes.rows[0]?.count || 0);
    if (pedAbiertos > 0) {
      throw new ErrorNegocio(409, 'EN_USO', 'El repuesto tiene pedidos abiertos', {
        pedidos_abiertos: pedAbiertos,
      });
    }

    await client.query('UPDATE repuestos SET activo = FALSE, actualizado_en = NOW() WHERE id = $1', [id]);
    await client.query('COMMIT');
    return c.json({ ok: true, mensaje: 'Repuesto desactivado' }, 200);
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

// 7. GET /:id/movimientos?limite=
repuestosApp.get('/:id/movimientos', requirePermission('REPUESTOS_GESTIONAR'), async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
    }

    const existe = await pool.query('SELECT id FROM repuestos WHERE id = $1', [id]);
    if (existe.rows.length === 0) {
      throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
    }

    const rawLimite = Number(c.req.query('limite'));
    const limite = !isNaN(rawLimite) && rawLimite > 0 ? Math.min(rawLimite, 500) : 100;
    const tienePermisoCostos = veCostos(c);

    const sql = `
      SELECT
        ms.id,
        ms.tipo,
        ms.cantidad,
        ms.delta,
        ms.stock_resultante,
        ms.costo_unitario,
        ms.comprobante,
        ms.observacion,
        ms.intervencion_id,
        ms.realizado_en,
        u.id AS usuario_id,
        u.nombre AS usuario_nombre,
        u.apellido AS usuario_apellido,
        p.id AS proveedor_id,
        p.nombre AS proveedor_nombre
      FROM movimientos_stock ms
      LEFT JOIN usuarios u ON u.id = ms.realizado_por_usuario_id
      LEFT JOIN proveedores p ON p.id = ms.proveedor_id
      WHERE ms.repuesto_id = $1
      ORDER BY ms.realizado_en DESC, ms.id DESC
      LIMIT $2
    `;

    const res = await pool.query(sql, [id, limite]);
    const movimientos = res.rows.map((m) => ({
      id: Number(m.id),
      tipo: m.tipo,
      cantidad: Number(m.cantidad),
      delta: m.delta !== null ? Number(m.delta) : null,
      stock_resultante: m.stock_resultante !== null ? Number(m.stock_resultante) : null,
      costo_unitario: tienePermisoCostos && m.costo_unitario !== null ? Number(m.costo_unitario) : null,
      proveedor: m.proveedor_id
        ? {
            id: Number(m.proveedor_id),
            nombre: m.proveedor_nombre,
          }
        : null,
      comprobante: m.comprobante || null,
      observacion: m.observacion || null,
      intervencion_id: m.intervencion_id ? Number(m.intervencion_id) : null,
      realizado_por: m.usuario_id
        ? {
            id: Number(m.usuario_id),
            nombre: m.usuario_nombre,
            apellido: m.usuario_apellido || null,
          }
        : null,
      realizado_en: m.realizado_en,
    }));

    return c.json(movimientos, 200);
  } catch (err) {
    return responderError(c, err);
  }
});

// 8. POST /:id/movimientos
repuestosApp.post('/:id/movimientos', requirePermission('REPUESTOS_GESTIONAR'), async (c) => {
  const client = await pool.connect();
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
    }
    const userId = Number((c.get as any)('userId'));

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Cuerpo JSON inválido');
    }

    const tipo = body.tipo;
    if (tipo !== 'INGRESO' && tipo !== 'EGRESO' && tipo !== 'AJUSTE') {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Tipo de movimiento inválido');
    }

    // Bloquear repuesto y verificar estado
    await client.query('BEGIN');

    const repRes = await client.query(
      'SELECT id, activo, lleva_stock, cantidad_disponible, costo_unitario FROM repuestos WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (repRes.rows.length === 0) {
      throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
    }
    const rep = repRes.rows[0];

    if (!rep.activo) {
      throw new ErrorNegocio(409, 'REPUESTO_INACTIVO', 'El repuesto está inactivo');
    }
    if (!rep.lleva_stock) {
      throw new ErrorNegocio(409, 'REPUESTO_SIN_CONTROL_STOCK', 'El repuesto no lleva control de stock');
    }

    let delta = 0;
    let costoUnitario: number | null = null;
    let proveedorId: number | null = null;
    let comprobante: string | null = null;
    let observacion: string | null = null;

    if (tipo === 'INGRESO') {
      const cantidad = validarCantidad(body.cantidad, 'cantidad');
      delta = cantidad;

      if (body.costo_unitario !== undefined && body.costo_unitario !== null) {
        if (!puedeCargarCostos(c)) {
          throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tiene permiso para registrar costos');
        }
        costoUnitario = validarCosto(body.costo_unitario, 'costo_unitario');
      }

      if (body.proveedor_id !== undefined && body.proveedor_id !== null) {
        proveedorId = validarIdCuerpo(body.proveedor_id, 'PROVEEDOR_INVALIDO', 'proveedor_id');
        const provRes = await client.query('SELECT id, activo FROM proveedores WHERE id = $1 FOR SHARE', [proveedorId]);
        if (provRes.rows.length === 0 || !provRes.rows[0].activo) {
          throw new ErrorNegocio(422, 'PROVEEDOR_INVALIDO', 'El proveedor no existe o está inactivo');
        }
      }

      if (body.comprobante !== undefined && body.comprobante !== null) {
        const cTrim = typeof body.comprobante === 'string' ? body.comprobante.trim() : '';
        if (cTrim.length > 60) {
          throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El comprobante no puede superar los 60 caracteres');
        }
        comprobante = cTrim.length > 0 ? cTrim : null;
      }

      if (body.observacion !== undefined && body.observacion !== null) {
        const oTrim = typeof body.observacion === 'string' ? body.observacion.trim() : '';
        observacion = oTrim.length > 0 ? oTrim : null;
      }
    } else if (tipo === 'EGRESO') {
      const cantidad = validarCantidad(body.cantidad, 'cantidad');
      delta = -cantidad;

      const obsTrim = typeof body.observacion === 'string' ? body.observacion.trim() : '';
      if (obsTrim.length < 5) {
        throw new ErrorNegocio(422, 'MOTIVO_REQUERIDO', 'Debe indicar un motivo de al menos 5 caracteres');
      }
      observacion = obsTrim;
    } else if (tipo === 'AJUSTE') {
      const contada = validarCantidadDesdeCero(body.cantidad_contada, 'cantidad_contada');
      const obsTrim = typeof body.observacion === 'string' ? body.observacion.trim() : '';
      if (obsTrim.length < 5) {
        throw new ErrorNegocio(422, 'MOTIVO_REQUERIDO', 'Debe indicar un motivo de al menos 5 caracteres');
      }
      observacion = obsTrim;

      const actual = Number(rep.cantidad_disponible);
      if (contada === actual) {
        throw new ErrorNegocio(422, 'SIN_CAMBIOS', 'La cantidad contada coincide con el stock actual');
      }
      delta = Number((contada - actual).toFixed(3));
    }

    const mov = await moverStock(client, {
      repuestoId: id,
      tipo,
      delta,
      usuarioId: userId,
      proveedorId,
      comprobante,
      costoUnitario,
      observacion,
    });

    if (tipo === 'INGRESO' && costoUnitario !== null) {
      await cambiarCosto(client, {
        repuestoId: id,
        costo: costoUnitario,
        origen: 'INGRESO',
        usuarioId: userId,
      });
    }

    await client.query('COMMIT');

    const tienePermisoCostos = veCostos(c);
    const repuestoActualizado = await obtenerDetalleRepuesto(id, tienePermisoCostos);

    const movFormateado = {
      ...mov,
      costo_unitario: tienePermisoCostos ? mov.costo_unitario : null,
    };

    return c.json(
      {
        movimiento: movFormateado,
        repuesto: repuestoActualizado,
      },
      201
    );
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

// 9. GET /:id/usos
repuestosApp.get('/:id/usos', requirePermission('REPUESTOS_GESTIONAR'), async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
    }

    const exRes = await pool.query('SELECT id FROM repuestos WHERE id = $1', [id]);
    if (exRes.rows.length === 0) {
      throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
    }

    const tienePermisoCostos = veCostos(c);

    const sql = `
      SELECT
        ir.id AS consumo_id,
        ir.cantidad,
        ir.costo_unitario_aplicado,
        ROUND(ir.cantidad * ir.costo_unitario_aplicado, 2) AS importe,
        ir.creado_en,
        ir.anulado_en,
        i.id AS intervencion_id,
        i.estado AS intervencion_estado,
        m.id AS maquina_id,
        m.codigo AS maquina_codigo,
        m.nombre AS maquina_nombre
      FROM intervencion_repuestos ir
      JOIN intervenciones i ON i.id = ir.intervencion_id
      JOIN maquinas m ON m.id = i.maquina_id
      WHERE ir.repuesto_id = $1
      ORDER BY ir.creado_en DESC, ir.id DESC
      LIMIT 100
    `;

    const res = await pool.query(sql, [id]);
    const usos = res.rows.map((row) => {
      const cantidad = Number(row.cantidad);
      const costoAplicado = tienePermisoCostos ? Number(row.costo_unitario_aplicado) : null;
      const importe = tienePermisoCostos && row.importe !== null && row.importe !== undefined
        ? Number(row.importe)
        : null;

      return {
        consumo_id: Number(row.consumo_id),
        intervencion: {
          id: Number(row.intervencion_id),
          estado: row.intervencion_estado,
        },
        maquina: {
          id: Number(row.maquina_id),
          codigo: row.maquina_codigo,
          nombre: row.maquina_nombre,
        },
        cantidad,
        costo_unitario_aplicado: costoAplicado,
        importe,
        registrado_en: row.creado_en,
        anulado: Boolean(row.anulado_en),
      };
    });

    return c.json(usos, 200);
  } catch (err) {
    return responderError(c, err);
  }
});

// 10. GET /:id/costos
repuestosApp.get('/:id/costos', requirePermission('REPUESTOS_GESTIONAR'), async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
    }

    const exRes = await pool.query('SELECT id FROM repuestos WHERE id = $1', [id]);
    if (exRes.rows.length === 0) {
      throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
    }

    const tienePermisoCostos = veCostos(c);

    const sql = `
      SELECT
        rc.id,
        rc.costo_unitario,
        rc.origen,
        rc.registrado_en,
        u.id AS usuario_id,
        u.nombre AS usuario_nombre,
        u.apellido AS usuario_apellido
      FROM repuesto_costos rc
      LEFT JOIN usuarios u ON u.id = rc.registrado_por_usuario_id
      WHERE rc.repuesto_id = $1
      ORDER BY rc.registrado_en DESC, rc.id DESC
    `;

    const res = await pool.query(sql, [id]);
    const costos = res.rows.map((row) => ({
      id: Number(row.id),
      costo_unitario: tienePermisoCostos ? Number(row.costo_unitario) : null,
      origen: row.origen,
      registrado_por: row.usuario_id
        ? {
            id: Number(row.usuario_id),
            nombre: row.usuario_nombre,
            apellido: row.usuario_apellido || null,
          }
        : null,
      registrado_en: row.registrado_en,
    }));

    return c.json(costos, 200);
  } catch (err) {
    return responderError(c, err);
  }
});

export default repuestosApp;
