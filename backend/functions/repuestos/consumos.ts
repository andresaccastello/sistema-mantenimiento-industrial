import pg from 'pg';
import { ErrorNegocio } from '../intervenciones/errores.ts';
import { UsuarioVisibilidad } from '../intervenciones/visibilidad.ts';
import { registrarAuditoria } from '../intervenciones/auditoria.ts';
import { recalcularCostosIntervencion } from '../intervenciones/costos.ts';
import { validarCosto, formatearCantidad } from './validaciones.ts';
import { moverStock, cambiarCosto } from './stock.ts';

/**
 * El registro de un consumo y su anulación (PV2.2, regla 4). Los usan
 * POST /:id/repuestos, /:id/repuestos/:consumoId/anular y el PATCH de una tarea preventiva.
 * Todas corren dentro de la transacción del llamador, con la intervención ya bloqueada.
 */

interface IntervencionConsumo {
  estado: string;
  responsable_usuario_id: number | null;
}

function controlarActorAbierta(usuario: UsuarioVisibilidad, intervencion: IntervencionConsumo) {
  if (!('INTERVENCIONES_CAMBIAR_ESTADO' in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tiene permiso para cambiar el estado de intervenciones');
  }
  const esResponsable =
    intervencion.responsable_usuario_id !== null &&
    Number(intervencion.responsable_usuario_id) === usuario.id;
  if (!esResponsable && !('INTERVENCIONES_ASIGNAR' in usuario.permisos)) {
    throw new ErrorNegocio(403, 'NO_ES_RESPONSABLE', 'No es el responsable asignado ni tiene permiso de asignación');
  }
}

/**
 * Permisos y estado para registrar un consumo. Con la intervención FINALIZADA exige el
 * motivo y lo devuelve recortado; en los otros estados devuelve null.
 */
export function autorizarRegistroConsumo(
  usuario: UsuarioVisibilidad,
  intervencion: IntervencionConsumo,
  motivo: unknown
): string | null {
  if (intervencion.estado === 'PENDIENTE' || intervencion.estado === 'CANCELADA') {
    throw new ErrorNegocio(409, 'ESTADO_NO_PERMITE_REPUESTOS', 'El estado de la intervención no permite registrar repuestos');
  }
  if (intervencion.estado === 'EN_PROCESO' || intervencion.estado === 'EN_ESPERA_REPUESTOS') {
    controlarActorAbierta(usuario, intervencion);
    return null;
  }
  if (intervencion.estado === 'FINALIZADA') {
    if (!('INTERVENCIONES_CORREGIR' in usuario.permisos)) {
      throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tiene permiso para corregir intervenciones finalizadas');
    }
    const motivoTrim = typeof motivo === 'string' ? motivo.trim() : '';
    if (motivoTrim.length < 5) {
      throw new ErrorNegocio(422, 'MOTIVO_REQUERIDO', 'Debe indicar un motivo de al menos 5 caracteres');
    }
    return motivoTrim;
  }
  return null;
}

/** Permisos y estado para anular un consumo. */
export function autorizarAnulacionConsumo(usuario: UsuarioVisibilidad, intervencion: IntervencionConsumo): void {
  if (intervencion.estado === 'PENDIENTE') {
    throw new ErrorNegocio(409, 'ESTADO_NO_PERMITE_REPUESTOS', 'El estado de la intervención no permite anular repuestos');
  }
  if (intervencion.estado === 'EN_PROCESO' || intervencion.estado === 'EN_ESPERA_REPUESTOS') {
    controlarActorAbierta(usuario, intervencion);
  } else if (intervencion.estado === 'FINALIZADA' || intervencion.estado === 'CANCELADA') {
    if (!('INTERVENCIONES_CORREGIR' in usuario.permisos)) {
      throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tiene permiso para corregir intervenciones cerradas');
    }
  }
}

export interface RegistrarConsumoParams {
  intervencionId: number;
  estadoIntervencion: string;
  usuarioId: number;
  repuestoId: number;
  /** Ya validada con validarCantidad. */
  cantidad: number;
  observacion: string | null;
  /** El motivo, con la intervención FINALIZADA. */
  motivo: string | null;
  /** Solo el POST de un consumo lo puede mandar, en un repuesto sin control de stock. */
  costoUnitario?: unknown;
  puedeCargarCostos?: boolean;
}

/** Registra el consumo: mueve el stock, recalcula los costos y audita. Devuelve el id del consumo. */
export async function registrarConsumo(client: pg.PoolClient, p: RegistrarConsumoParams): Promise<number> {
  const repRes = await client.query(
    'SELECT id, nombre, codigo, unidad, activo, lleva_stock, cantidad_disponible, costo_unitario FROM repuestos WHERE id = $1 FOR UPDATE',
    [p.repuestoId]
  );
  if (repRes.rows.length === 0) {
    throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
  }
  const repuesto = repRes.rows[0];
  if (!repuesto.activo) {
    throw new ErrorNegocio(409, 'REPUESTO_INACTIVO', 'El repuesto está inactivo');
  }

  const conCosto = p.costoUnitario !== undefined && p.costoUnitario !== null;
  let costoAplicado = Number(repuesto.costo_unitario);
  let movimientoId: number | null = null;

  if (repuesto.lleva_stock) {
    if (conCosto) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'No se puede definir costo unitario en repuestos con control de stock');
    }
    // Mover stock: EGRESO delta = -cantidad
    const mov = await moverStock(client, {
      repuestoId: p.repuestoId,
      tipo: 'EGRESO',
      delta: -p.cantidad,
      usuarioId: p.usuarioId,
      intervencionId: p.intervencionId,
      observacion: `Intervención N.º ${p.intervencionId}`,
    });
    movimientoId = mov.id;
  } else if (conCosto) {
    if (!p.puedeCargarCostos) {
      throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tiene permiso para registrar costos');
    }
    const nuevoCosto = validarCosto(p.costoUnitario, 'costo_unitario');
    costoAplicado = nuevoCosto;
    await cambiarCosto(client, {
      repuestoId: p.repuestoId,
      costo: nuevoCosto,
      origen: 'CONSUMO',
      usuarioId: p.usuarioId,
    });
  }

  const insConsumo = await client.query(
    `INSERT INTO intervencion_repuestos (
       intervencion_id, repuesto_id, cantidad, costo_unitario_aplicado, observacion,
       movimiento_id, registrado_por_usuario_id, creado_en
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING id`,
    [p.intervencionId, p.repuestoId, p.cantidad, costoAplicado, p.observacion, movimientoId, p.usuarioId]
  );
  const consumoId = Number(insConsumo.rows[0].id);

  await recalcularCostosIntervencion(client, p.intervencionId);

  if (p.estadoIntervencion === 'FINALIZADA') {
    await registrarAuditoria(client, {
      intervencionId: p.intervencionId,
      tipoEvento: 'CORRECCION_COSTO',
      campo: 'repuestos',
      valorNuevo: `Se agregó: ${repuesto.nombre} × ${formatearCantidad(p.cantidad)} ${repuesto.unidad || 'unidad'}`,
      motivo: p.motivo,
      usuarioId: p.usuarioId,
    });
  }

  return consumoId;
}

export interface AnularConsumoParams {
  intervencionId: number;
  estadoIntervencion: string;
  usuarioId: number;
  consumoId: number;
  motivo: string;
  /** Al desmarcar una tarea: un consumo ya anulado se saltea, en vez de dar 409. */
  saltearAnulado?: boolean;
}

/** Anula el consumo: devuelve el stock, recalcula los costos y audita. Devuelve false si se salteó. */
export async function anularConsumo(client: pg.PoolClient, p: AnularConsumoParams): Promise<boolean> {
  const conRes = await client.query(
    `SELECT ir.*, r.nombre AS repuesto_nombre, r.codigo AS repuesto_codigo, r.unidad AS repuesto_unidad, r.lleva_stock
     FROM intervencion_repuestos ir
     JOIN repuestos r ON r.id = ir.repuesto_id
     WHERE ir.id = $1 FOR UPDATE`,
    [p.consumoId]
  );
  if (conRes.rows.length === 0 || Number(conRes.rows[0].intervencion_id) !== p.intervencionId) {
    throw new ErrorNegocio(404, 'CONSUMO_NO_ENCONTRADO', 'Consumo no encontrado en esta intervención');
  }
  const consumo = conRes.rows[0];

  if (consumo.anulado_en !== null) {
    if (p.saltearAnulado) return false;
    throw new ErrorNegocio(409, 'CONSUMO_YA_ANULADO', 'El consumo ya fue anulado');
  }

  // Devolución de stock si movió stock y el repuesto todavía lleva stock
  let devolucionMovimientoId: number | null = null;
  if (consumo.movimiento_id !== null) {
    const repLock = await client.query('SELECT lleva_stock FROM repuestos WHERE id = $1 FOR UPDATE', [consumo.repuesto_id]);
    if (repLock.rows[0]?.lleva_stock) {
      const movDev = await moverStock(client, {
        repuestoId: Number(consumo.repuesto_id),
        tipo: 'DEVOLUCION',
        delta: Number(consumo.cantidad),
        usuarioId: p.usuarioId,
        intervencionId: p.intervencionId,
        observacion: `Devolución por anulación de consumo en intervención N.º ${p.intervencionId}`,
      });
      devolucionMovimientoId = movDev.id;
    }
  }

  await client.query(
    `UPDATE intervencion_repuestos
     SET anulado_en = NOW(),
         anulado_por_usuario_id = $1,
         motivo_anulacion = $2,
         devolucion_movimiento_id = $3
     WHERE id = $4`,
    [p.usuarioId, p.motivo, devolucionMovimientoId, p.consumoId]
  );

  await recalcularCostosIntervencion(client, p.intervencionId);

  if (p.estadoIntervencion === 'FINALIZADA' || p.estadoIntervencion === 'CANCELADA') {
    await registrarAuditoria(client, {
      intervencionId: p.intervencionId,
      tipoEvento: 'CORRECCION_COSTO',
      campo: 'repuestos',
      valorNuevo: `Se anuló: ${consumo.repuesto_nombre} × ${formatearCantidad(consumo.cantidad)} ${consumo.repuesto_unidad || 'unidad'}`,
      motivo: p.motivo,
      usuarioId: p.usuarioId,
    });
  }

  return true;
}

/** Bloquea los repuestos en orden de id, para que dos confirmaciones nunca se traben entre sí. */
export async function bloquearRepuestosOrdenados(client: pg.PoolClient, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await client.query('SELECT id FROM repuestos WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [ids]);
}
