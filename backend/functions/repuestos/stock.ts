import { PoolClient } from 'pg';
import { ErrorNegocio } from '../intervenciones/errores.ts';

export interface MoverStockParams {
  repuestoId: number;
  tipo: 'INGRESO' | 'EGRESO' | 'AJUSTE' | 'DEVOLUCION';
  delta: number;
  usuarioId: number;
  intervencionId?: number | null;
  proveedorId?: number | null;
  comprobante?: string | null;
  costoUnitario?: number | null;
  observacion?: string | null;
}

export async function moverStock(client: PoolClient, params: MoverStockParams) {
  const {
    repuestoId,
    tipo,
    delta,
    usuarioId,
    intervencionId = null,
    proveedorId = null,
    comprobante = null,
    costoUnitario = null,
    observacion = null,
  } = params;

  // 1. SELECT … FROM repuestos WHERE id = $1 FOR UPDATE
  const res = await client.query(
    'SELECT id, activo, lleva_stock, cantidad_disponible FROM repuestos WHERE id = $1 FOR UPDATE',
    [repuestoId]
  );
  if (res.rows.length === 0) {
    throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'El repuesto no existe');
  }
  const repuesto = res.rows[0];

  // 2. Sin control de stock: 409 REPUESTO_SIN_CONTROL_STOCK
  if (!repuesto.lleva_stock) {
    throw new ErrorNegocio(409, 'REPUESTO_SIN_CONTROL_STOCK', 'El repuesto no lleva control de stock');
  }

  // 3. nuevo = actual + delta. Si da negativo: 409 STOCK_INSUFICIENTE, con disponible en la respuesta
  const actual = Number(repuesto.cantidad_disponible);
  const nuevo = Number((actual + delta).toFixed(3));
  if (nuevo < 0) {
    throw new ErrorNegocio(409, 'STOCK_INSUFICIENTE', 'Stock insuficiente para realizar la operación', {
      disponible: actual,
    });
  }

  // 4. Inserta el movimiento con cantidad = |delta|, delta y stock_resultante = nuevo
  const cantidad = Number(Math.abs(delta).toFixed(3));
  const ins = await client.query(
    `INSERT INTO movimientos_stock (
       repuesto_id,
       tipo,
       cantidad,
       delta,
       stock_resultante,
       costo_unitario,
       observacion,
       realizado_por_usuario_id,
       intervencion_id,
       proveedor_id,
       comprobante
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, tipo, cantidad, delta, stock_resultante, costo_unitario, comprobante, observacion, intervencion_id, realizado_en`,
    [
      repuestoId,
      tipo,
      cantidad,
      delta,
      nuevo,
      costoUnitario,
      observacion,
      usuarioId,
      intervencionId,
      proveedorId,
      comprobante,
    ]
  );
  const mov = ins.rows[0];

  // 5. Actualiza cantidad_disponible y actualizado_en
  await client.query(
    'UPDATE repuestos SET cantidad_disponible = $1, actualizado_en = NOW() WHERE id = $2',
    [nuevo, repuestoId]
  );

  // 6. Devuelve el movimiento formateado
  const userRes = await client.query(
    'SELECT id, nombre, apellido FROM usuarios WHERE id = $1',
    [usuarioId]
  );
  const provRes = proveedorId ? await client.query(
    'SELECT id, nombre FROM proveedores WHERE id = $1',
    [proveedorId]
  ) : null;

  return {
    id: Number(mov.id),
    tipo: mov.tipo,
    cantidad: Number(mov.cantidad),
    delta: Number(mov.delta),
    stock_resultante: Number(mov.stock_resultante),
    costo_unitario: mov.costo_unitario !== null ? Number(mov.costo_unitario) : null,
    proveedor: provRes && provRes.rows[0] ? {
      id: Number(provRes.rows[0].id),
      nombre: provRes.rows[0].nombre,
    } : null,
    comprobante: mov.comprobante || null,
    observacion: mov.observacion || null,
    intervencion_id: mov.intervencion_id ? Number(mov.intervencion_id) : null,
    realizado_por: userRes.rows[0] ? {
      id: Number(userRes.rows[0].id),
      nombre: userRes.rows[0].nombre,
      apellido: userRes.rows[0].apellido || null,
    } : null,
    realizado_en: mov.realizado_en,
  };
}

export interface CambiarCostoParams {
  repuestoId: number;
  costo: number;
  origen: 'ALTA' | 'EDICION' | 'INGRESO' | 'CONSUMO' | 'MIGRACION';
  usuarioId: number;
}

export async function cambiarCosto(client: PoolClient, params: CambiarCostoParams) {
  const { repuestoId, costo, origen, usuarioId } = params;

  const res = await client.query(
    'SELECT costo_unitario FROM repuestos WHERE id = $1 FOR UPDATE',
    [repuestoId]
  );
  if (res.rows.length === 0) {
    throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'El repuesto no existe');
  }

  const actual = Number(res.rows[0].costo_unitario);
  const nuevo = Number(costo.toFixed(2));

  if (actual !== nuevo) {
    await client.query(
      'UPDATE repuestos SET costo_unitario = $1, actualizado_en = NOW() WHERE id = $2',
      [nuevo, repuestoId]
    );

    await client.query(
      `INSERT INTO repuesto_costos (repuesto_id, costo_unitario, origen, registrado_por_usuario_id, registrado_en)
       VALUES ($1, $2, $3, $4, NOW())`,
      [repuestoId, nuevo, origen, usuarioId]
    );
  }
}
