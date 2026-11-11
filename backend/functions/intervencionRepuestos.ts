import { Hono } from 'hono';
import { pool } from './db.ts';
import { requirePermission } from './middleware.ts';
import { ErrorNegocio, responderError } from './intervenciones/errores.ts';
import { validarMotivo } from './validations.ts';
import { bloquearIntervencion } from './intervenciones/bloqueos.ts';
import { UsuarioVisibilidad, puedeVerIntervencion } from './intervenciones/visibilidad.ts';
import { veCostos, puedeCargarCostos } from './repuestos/permisos.ts';
import {
  validarCantidad,
  validarCosto,
  parseIdRuta,
  validarIdCuerpo,
  validarBooleano,
} from './repuestos/validaciones.ts';
import { moverStock, cambiarCosto } from './repuestos/stock.ts';
import {
  autorizarRegistroConsumo,
  autorizarAnulacionConsumo,
  registrarConsumo,
  anularConsumo,
} from './repuestos/consumos.ts';

const intervencionRepuestosApp = new Hono();

function getUsuarioContext(c: any): UsuarioVisibilidad {
  return {
    id: (c.get as any)('userId') as number,
    permisos: ((c.get as any)('userPermissionsMap') as Record<string, any>) || {},
    sectores: ((c.get as any)('userSectores') as number[]) || [],
  };
}

export function permisosRepuestos(
  usuario: UsuarioVisibilidad,
  intervencion: { estado: string; responsable_usuario_id: number | null }
): { puede_registrar: boolean; puede_anular: boolean } {
  const tieneCambiarEstado = 'INTERVENCIONES_CAMBIAR_ESTADO' in usuario.permisos;
  const esResponsable =
    intervencion.responsable_usuario_id !== null &&
    Number(intervencion.responsable_usuario_id) === usuario.id;
  const tieneAsignar = 'INTERVENCIONES_ASIGNAR' in usuario.permisos;
  const tieneCorregir = 'INTERVENCIONES_CORREGIR' in usuario.permisos;

  const esActor = esResponsable || tieneAsignar;

  let puede_registrar = false;
  let puede_anular = false;

  if (intervencion.estado === 'EN_PROCESO' || intervencion.estado === 'EN_ESPERA_REPUESTOS') {
    puede_registrar = tieneCambiarEstado && esActor;
    puede_anular = tieneCambiarEstado && esActor;
  } else if (intervencion.estado === 'FINALIZADA') {
    puede_registrar = tieneCorregir;
    puede_anular = tieneCorregir;
  } else if (intervencion.estado === 'CANCELADA') {
    puede_registrar = false;
    puede_anular = tieneCorregir;
  } else {
    // PENDIENTE
    puede_registrar = false;
    puede_anular = false;
  }

  return { puede_registrar, puede_anular };
}

export function validarAutorizacionPedidos(
  usuario: UsuarioVisibilidad,
  intervencion: { estado: string; responsable_usuario_id: number | null }
) {
  const tieneGestionarRepuestos = 'REPUESTOS_GESTIONAR' in usuario.permisos;
  if (tieneGestionarRepuestos) {
    return;
  }

  const tieneCambiarEstado = 'INTERVENCIONES_CAMBIAR_ESTADO' in usuario.permisos;
  const esResponsable =
    intervencion.responsable_usuario_id !== null &&
    Number(intervencion.responsable_usuario_id) === usuario.id;
  const tieneAsignar = 'INTERVENCIONES_ASIGNAR' in usuario.permisos;

  if (tieneCambiarEstado) {
    if (esResponsable || tieneAsignar) {
      return;
    }
    throw new ErrorNegocio(403, 'NO_ES_RESPONSABLE', 'No es el responsable de la intervención ni tiene permiso de asignación');
  }

  throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'Permisos insuficientes para gestionar pedidos de repuesto');
}

export function permisosPedidos(
  usuario: UsuarioVisibilidad,
  intervencion: { estado: string; responsable_usuario_id: number | null }
): { puede_crear: boolean; puede_gestionar: boolean } {
  const tieneGestionarRepuestos = 'REPUESTOS_GESTIONAR' in usuario.permisos;
  const tieneCambiarEstado = 'INTERVENCIONES_CAMBIAR_ESTADO' in usuario.permisos;
  const esResponsable =
    intervencion.responsable_usuario_id !== null &&
    Number(intervencion.responsable_usuario_id) === usuario.id;
  const tieneAsignar = 'INTERVENCIONES_ASIGNAR' in usuario.permisos;
  const esActor = esResponsable || tieneAsignar;

  const puede_gestionar = tieneGestionarRepuestos || (tieneCambiarEstado && esActor);
  const estadoPermiteCrear =
    intervencion.estado === 'EN_PROCESO' || intervencion.estado === 'EN_ESPERA_REPUESTOS';
  const puede_crear = puede_gestionar && estadoPermiteCrear;

  return { puede_crear, puede_gestionar };
}

function validarFechaYYYYMMDD(fechaStr: unknown, campo: string): string {
  if (typeof fechaStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El campo ${campo} debe tener formato YYYY-MM-DD`);
  }
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El campo ${campo} no es una fecha válida en el calendario`);
  }
  return fechaStr;
}

const SQL_CONSUMO_COMPLETO = `
  SELECT
    ir.*,
    ROUND(ir.cantidad * ir.costo_unitario_aplicado, 2) AS importe,
    r.codigo AS repuesto_codigo,
    r.nombre AS repuesto_nombre,
    r.unidad AS repuesto_unidad,
    reg.id AS reg_user_id,
    reg.nombre AS reg_user_nombre,
    reg.apellido AS reg_user_apellido,
    anul.id AS anul_user_id,
    anul.nombre AS anul_user_nombre,
    anul.apellido AS anul_user_apellido
  FROM intervencion_repuestos ir
  JOIN repuestos r ON r.id = ir.repuesto_id
  LEFT JOIN usuarios reg ON reg.id = ir.registrado_por_usuario_id
  LEFT JOIN usuarios anul ON anul.id = ir.anulado_por_usuario_id
`;

function armarConsumoRespuesta(row: any, tienePermisoCostos: boolean) {
  const cantidad = Number(row.cantidad);
  const costoAplicado = tienePermisoCostos ? Number(row.costo_unitario_aplicado) : null;
  const importe = tienePermisoCostos && row.importe !== null && row.importe !== undefined
    ? Number(row.importe)
    : null;

  return {
    id: Number(row.id),
    repuesto: {
      id: Number(row.repuesto_id),
      codigo: row.repuesto_codigo || null,
      nombre: row.repuesto_nombre,
      unidad: row.repuesto_unidad || 'unidad',
    },
    cantidad,
    costo_unitario_aplicado: costoAplicado,
    importe,
    observacion: row.observacion || null,
    registrado_por: row.reg_user_id
      ? {
          id: Number(row.reg_user_id),
          nombre: row.reg_user_nombre,
          apellido: row.reg_user_apellido || null,
        }
      : null,
    registrado_en: row.creado_en,
    movimiento_id: row.movimiento_id ? Number(row.movimiento_id) : null,
    movio_stock: row.movimiento_id !== null,
    anulado: row.anulado_en !== null,
    anulado_por: row.anul_user_id
      ? {
          id: Number(row.anul_user_id),
          nombre: row.anul_user_nombre,
          apellido: row.anul_user_apellido || null,
        }
      : null,
    anulado_en: row.anulado_en || null,
    motivo_anulacion: row.motivo_anulacion || null,
  };
}

function armarPedidoRespuesta(row: any) {
  return {
    id: Number(row.id),
    intervencion_id: Number(row.intervencion_id),
    repuesto: row.repuesto_id
      ? {
          id: Number(row.repuesto_id),
          codigo: row.repuesto_codigo || null,
          nombre: row.repuesto_nombre,
          unidad: row.repuesto_unidad || 'unidad',
          lleva_stock: Boolean(row.repuesto_lleva_stock),
        }
      : null,
    descripcion: row.descripcion || null,
    cantidad: Number(row.cantidad),
    proveedor: row.proveedor_id
      ? {
          id: Number(row.proveedor_id),
          nombre: row.proveedor_nombre,
        }
      : null,
    estado: row.estado,
    pedido_en: row.pedido_en_str || null,
    esperado_para: row.esperado_para_str || null,
    recibido_en: row.recibido_en || null,
    observacion: row.observacion || null,
    motivo_cancelacion: row.motivo_cancelacion || null,
    ingreso_stock: row.movimiento_id !== null,
    creado_por: row.creador_id
      ? {
          id: Number(row.creador_id),
          nombre: row.creador_nombre,
          apellido: row.creador_apellido || null,
        }
      : null,
    creado_en: row.creado_en,
    actualizado_en: row.actualizado_en,
  };
}

// -------------------------------------------------------------
// 5.1 Consumos en la intervención
// -------------------------------------------------------------

// GET /:id/repuestos
intervencionRepuestosApp.get('/:id/repuestos', requirePermission('INTERVENCIONES_VER'), async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }
    const usuario = getUsuarioContext(c);

    // Valida existencia, no eliminación y visibilidad sin bloquear
    const resI = await pool.query(
      `SELECT i.id, i.estado, i.responsable_usuario_id, i.creado_por_usuario_id, i.eliminado_en,
              i.costo_repuestos, m.sector_id
       FROM intervenciones i
       JOIN maquinas m ON m.id = i.maquina_id
       WHERE i.id = $1`,
      [id]
    );

    if (resI.rows.length === 0 || resI.rows[0].eliminado_en !== null) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }

    const intervencion = resI.rows[0];
    const visible = puedeVerIntervencion(usuario, {
      creado_por_usuario_id: Number(intervencion.creado_por_usuario_id),
      responsable_usuario_id: intervencion.responsable_usuario_id ? Number(intervencion.responsable_usuario_id) : null,
      sector_id: Number(intervencion.sector_id),
    });

    if (!visible) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }

    const tienePermisoCostos = veCostos(c);
    const { puede_registrar, puede_anular } = permisosRepuestos(usuario, intervencion);

    const sql = `
      ${SQL_CONSUMO_COMPLETO}
      WHERE ir.intervencion_id = $1
      ORDER BY ir.id ASC
    `;

    const res = await pool.query(sql, [id]);
    const consumos = res.rows.map((row) => armarConsumoRespuesta(row, tienePermisoCostos));
    const totalRepuestos = tienePermisoCostos ? Number(intervencion.costo_repuestos || 0) : null;

    return c.json(
      {
        consumos,
        total_repuestos: totalRepuestos,
        ve_costos: tienePermisoCostos,
        puede_registrar,
        puede_anular,
      },
      200
    );
  } catch (err) {
    return responderError(c, err);
  }
});

// POST /:id/repuestos
intervencionRepuestosApp.post('/:id/repuestos', async (c) => {
  const client = await pool.connect();
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }
    const usuario = getUsuarioContext(c);

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Cuerpo JSON inválido');
    }

    await client.query('BEGIN');

    // 1. Bloqueo de máquina e intervención y control de visibilidad
    const { intervencion } = await bloquearIntervencion(client, id, usuario);

    // 2. Control de permisos según el estado
    const motivo = autorizarRegistroConsumo(usuario, intervencion, body.motivo);

    // 3. Validar campos del consumo
    const repuestoId = validarIdCuerpo(body.repuesto_id, 'DATOS_INVALIDOS', 'repuesto_id');

    const cantidad = validarCantidad(body.cantidad, 'cantidad');

    const observacion = typeof body.observacion === 'string' && body.observacion.trim()
      ? body.observacion.trim()
      : null;
    if (observacion && observacion.length > 500) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La observación no puede superar los 500 caracteres');
    }

    // 4. Registrar el consumo: stock, costos y auditoría
    const consumoId = await registrarConsumo(client, {
      intervencionId: id,
      estadoIntervencion: intervencion.estado,
      usuarioId: usuario.id,
      repuestoId,
      cantidad,
      observacion,
      motivo,
      costoUnitario: body.costo_unitario,
      puedeCargarCostos: puedeCargarCostos(c),
    });

    await client.query('COMMIT');

    const tienePermisoCostos = veCostos(c);
    const resConsumo = await pool.query(
      `${SQL_CONSUMO_COMPLETO} WHERE ir.id = $1`,
      [consumoId]
    );

    return c.json(armarConsumoRespuesta(resConsumo.rows[0], tienePermisoCostos), 201);
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

// POST /:id/repuestos/:consumoId/anular
intervencionRepuestosApp.post('/:id/repuestos/:consumoId/anular', async (c) => {
  const client = await pool.connect();
  try {
    const id = parseIdRuta(c.req.param('id'));
    const consumoId = parseIdRuta(c.req.param('consumoId'));
    if (!id || !consumoId) {
      throw new ErrorNegocio(404, 'CONSUMO_NO_ENCONTRADO', 'Consumo no encontrado');
    }
    const usuario = getUsuarioContext(c);

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Cuerpo JSON inválido');
    }

    const motivoTrim = validarMotivo(body.motivo);

    await client.query('BEGIN');

    // 1. Bloqueo de máquina e intervención
    const { intervencion } = await bloquearIntervencion(client, id, usuario);

    // 2. Control de permisos
    autorizarAnulacionConsumo(usuario, intervencion);

    // 3. Anular: devolución de stock, costos y auditoría
    await anularConsumo(client, {
      intervencionId: id,
      estadoIntervencion: intervencion.estado,
      usuarioId: usuario.id,
      consumoId,
      motivo: motivoTrim,
    });

    await client.query('COMMIT');

    const tienePermisoCostos = veCostos(c);
    const resConsumo = await pool.query(
      `${SQL_CONSUMO_COMPLETO} WHERE ir.id = $1`,
      [consumoId]
    );

    return c.json(armarConsumoRespuesta(resConsumo.rows[0], tienePermisoCostos), 200);
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

// -------------------------------------------------------------
// 5.2 Pedidos en la intervención
// -------------------------------------------------------------

// GET /:id/pedidos
intervencionRepuestosApp.get('/:id/pedidos', requirePermission('INTERVENCIONES_VER'), async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }
    const usuario = getUsuarioContext(c);

    // Valida existencia, no eliminación y visibilidad sin bloquear
    const resI = await pool.query(
      `SELECT i.id, i.estado, i.responsable_usuario_id, i.creado_por_usuario_id, i.eliminado_en, m.sector_id
       FROM intervenciones i
       JOIN maquinas m ON m.id = i.maquina_id
       WHERE i.id = $1`,
      [id]
    );

    if (resI.rows.length === 0 || resI.rows[0].eliminado_en !== null) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }

    const intervencion = resI.rows[0];
    const visible = puedeVerIntervencion(usuario, {
      creado_por_usuario_id: Number(intervencion.creado_por_usuario_id),
      responsable_usuario_id: intervencion.responsable_usuario_id ? Number(intervencion.responsable_usuario_id) : null,
      sector_id: Number(intervencion.sector_id),
    });

    if (!visible) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }

    const { puede_crear, puede_gestionar } = permisosPedidos(usuario, intervencion);

    const sql = `
      SELECT
        pr.*,
        TO_CHAR(pr.pedido_en, 'YYYY-MM-DD') AS pedido_en_str,
        TO_CHAR(pr.esperado_para, 'YYYY-MM-DD') AS esperado_para_str,
        r.codigo AS repuesto_codigo,
        r.nombre AS repuesto_nombre,
        r.unidad AS repuesto_unidad,
        r.lleva_stock AS repuesto_lleva_stock,
        p.nombre AS proveedor_nombre,
        u.nombre AS creador_nombre,
        u.apellido AS creador_apellido,
        u.id AS creador_id
      FROM pedidos_repuesto pr
      LEFT JOIN repuestos r ON r.id = pr.repuesto_id
      LEFT JOIN proveedores p ON p.id = pr.proveedor_id
      LEFT JOIN usuarios u ON u.id = pr.creado_por_usuario_id
      WHERE pr.intervencion_id = $1
      ORDER BY
        CASE WHEN pr.estado IN ('PENDIENTE', 'PEDIDO') THEN 0 ELSE 1 END ASC,
        pr.id ASC
    `;

    const res = await pool.query(sql, [id]);
    const pedidos = res.rows.map(armarPedidoRespuesta);

    return c.json(
      {
        pedidos,
        puede_crear,
        puede_gestionar,
      },
      200
    );
  } catch (err) {
    return responderError(c, err);
  }
});

// POST /:id/pedidos
intervencionRepuestosApp.post('/:id/pedidos', async (c) => {
  const client = await pool.connect();
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }
    const usuario = getUsuarioContext(c);

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Cuerpo JSON inválido');
    }

    await client.query('BEGIN');

    const { intervencion } = await bloquearIntervencion(client, id, usuario);

    // Permisos y estado
    validarAutorizacionPedidos(usuario, intervencion);

    if (intervencion.estado !== 'EN_PROCESO' && intervencion.estado !== 'EN_ESPERA_REPUESTOS') {
      throw new ErrorNegocio(409, 'ESTADO_NO_PERMITE_PEDIDOS', 'El estado de la intervención no permite crear pedidos');
    }

    // Validar repuesto_id y descripción
    let repuestoId: number | null = null;
    if (body.repuesto_id !== undefined && body.repuesto_id !== null) {
      repuestoId = validarIdCuerpo(body.repuesto_id, 'REPUESTO_INVALIDO', 'repuesto_id');
      const repRes = await client.query('SELECT id, activo FROM repuestos WHERE id = $1 FOR SHARE', [repuestoId]);
      if (repRes.rows.length === 0 || !repRes.rows[0].activo) {
        throw new ErrorNegocio(422, 'REPUESTO_INVALIDO', 'El repuesto no existe o está inactivo');
      }
    }

    let descripcion: string | null = null;
    if (body.descripcion !== undefined && body.descripcion !== null) {
      const dTrim = typeof body.descripcion === 'string' ? body.descripcion.trim() : '';
      if (dTrim.length > 200) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La descripción no puede superar los 200 caracteres');
      }
      descripcion = dTrim.length > 0 ? dTrim : null;
    }

    if (repuestoId === null) {
      if (!descripcion || descripcion.length < 3) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Debe indicar un repuesto o una descripción de al menos 3 caracteres');
      }
    }

    // cantidad
    const cantidad = validarCantidad(body.cantidad, 'cantidad');

    // proveedor_id
    let proveedorId: number | null = null;
    if (body.proveedor_id !== undefined && body.proveedor_id !== null) {
      proveedorId = validarIdCuerpo(body.proveedor_id, 'PROVEEDOR_INVALIDO', 'proveedor_id');
      const provRes = await client.query('SELECT id, activo FROM proveedores WHERE id = $1 FOR SHARE', [proveedorId]);
      if (provRes.rows.length === 0 || !provRes.rows[0].activo) {
        throw new ErrorNegocio(422, 'PROVEEDOR_INVALIDO', 'El proveedor no existe o está inactivo');
      }
    }

    // pedido_en y esperado_para
    let pedidoEn: string | null = null;
    if (body.pedido_en !== undefined && body.pedido_en !== null) {
      pedidoEn = validarFechaYYYYMMDD(body.pedido_en, 'pedido_en');
    }

    let esperadoPara: string | null = null;
    if (body.esperado_para !== undefined && body.esperado_para !== null) {
      esperadoPara = validarFechaYYYYMMDD(body.esperado_para, 'esperado_para');
    }

    if (pedidoEn && esperadoPara && esperadoPara < pedidoEn) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La fecha esperada no puede ser anterior a la fecha de pedido');
    }

    const estado = pedidoEn ? 'PEDIDO' : 'PENDIENTE';

    const observacion = typeof body.observacion === 'string' && body.observacion.trim()
      ? body.observacion.trim()
      : null;
    if (observacion && observacion.length > 500) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La observación no puede superar los 500 caracteres');
    }

    const ins = await client.query(
      `INSERT INTO pedidos_repuesto (
         intervencion_id, repuesto_id, descripcion, cantidad, proveedor_id, estado,
         pedido_en, esperado_para, observacion, creado_por_usuario_id, actualizado_por_usuario_id,
         creado_en, actualizado_en
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, NOW(), NOW())
       RETURNING id`,
      [
        id,
        repuestoId,
        descripcion,
        cantidad,
        proveedorId,
        estado,
        pedidoEn,
        esperadoPara,
        observacion,
        usuario.id,
      ]
    );
    const pedidoId = Number(ins.rows[0].id);

    await client.query('COMMIT');

    const sqlDet = `
      SELECT
        pr.*,
        TO_CHAR(pr.pedido_en, 'YYYY-MM-DD') AS pedido_en_str,
        TO_CHAR(pr.esperado_para, 'YYYY-MM-DD') AS esperado_para_str,
        r.codigo AS repuesto_codigo,
        r.nombre AS repuesto_nombre,
        r.unidad AS repuesto_unidad,
        r.lleva_stock AS repuesto_lleva_stock,
        p.nombre AS proveedor_nombre,
        u.nombre AS creador_nombre,
        u.apellido AS creador_apellido,
        u.id AS creador_id
      FROM pedidos_repuesto pr
      LEFT JOIN repuestos r ON r.id = pr.repuesto_id
      LEFT JOIN proveedores p ON p.id = pr.proveedor_id
      LEFT JOIN usuarios u ON u.id = pr.creado_por_usuario_id
      WHERE pr.id = $1
    `;
    const resDet = await pool.query(sqlDet, [pedidoId]);
    return c.json(armarPedidoRespuesta(resDet.rows[0]), 201);
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

// PATCH /:id/pedidos/:pedidoId
intervencionRepuestosApp.patch('/:id/pedidos/:pedidoId', async (c) => {
  const client = await pool.connect();
  try {
    const id = parseIdRuta(c.req.param('id'));
    const pedidoId = parseIdRuta(c.req.param('pedidoId'));
    if (!id || !pedidoId) {
      throw new ErrorNegocio(404, 'PEDIDO_NO_ENCONTRADO', 'Pedido no encontrado');
    }
    const usuario = getUsuarioContext(c);

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Cuerpo JSON inválido');
    }

    await client.query('BEGIN');

    const { intervencion } = await bloquearIntervencion(client, id, usuario);
    validarAutorizacionPedidos(usuario, intervencion);

    const pedRes = await client.query(
      `SELECT pr.*,
              TO_CHAR(pr.pedido_en, 'YYYY-MM-DD') AS pedido_en_str,
              TO_CHAR(pr.esperado_para, 'YYYY-MM-DD') AS esperado_para_str
       FROM pedidos_repuesto pr
       WHERE pr.id = $1 FOR UPDATE`,
      [pedidoId]
    );
    if (pedRes.rows.length === 0 || Number(pedRes.rows[0].intervencion_id) !== id) {
      throw new ErrorNegocio(404, 'PEDIDO_NO_ENCONTRADO', 'Pedido no encontrado');
    }
    const actual = pedRes.rows[0];

    if (actual.estado === 'RECIBIDO' || actual.estado === 'CANCELADO') {
      throw new ErrorNegocio(409, 'PEDIDO_CERRADO', 'No se puede modificar un pedido cerrado');
    }

    let repuestoId = actual.repuesto_id;
    if (body.repuesto_id !== undefined) {
      if (body.repuesto_id === null) {
        repuestoId = null;
      } else {
        const rId = validarIdCuerpo(body.repuesto_id, 'REPUESTO_INVALIDO', 'repuesto_id');
        const repRes = await client.query('SELECT id, activo FROM repuestos WHERE id = $1 FOR SHARE', [rId]);
        if (repRes.rows.length === 0 || !repRes.rows[0].activo) {
          throw new ErrorNegocio(422, 'REPUESTO_INVALIDO', 'El repuesto no existe o está inactivo');
        }
        repuestoId = rId;
      }
    }

    let descripcion = actual.descripcion;
    if (body.descripcion !== undefined) {
      if (body.descripcion === null) {
        descripcion = null;
      } else {
        const dTrim = typeof body.descripcion === 'string' ? body.descripcion.trim() : '';
        if (dTrim.length > 200) {
          throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La descripción no puede superar los 200 caracteres');
        }
        descripcion = dTrim.length > 0 ? dTrim : null;
      }
    }

    if (repuestoId === null) {
      if (!descripcion || descripcion.length < 3) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Debe indicar un repuesto o una descripción de al menos 3 caracteres');
      }
    }

    let cantidad = Number(actual.cantidad);
    if (body.cantidad !== undefined) {
      cantidad = validarCantidad(body.cantidad, 'cantidad');
    }

    let proveedorId = actual.proveedor_id;
    if (body.proveedor_id !== undefined) {
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

    let pedidoEn = actual.pedido_en_str;
    if (body.pedido_en !== undefined) {
      if (body.pedido_en === null) {
        pedidoEn = null;
      } else {
        pedidoEn = validarFechaYYYYMMDD(body.pedido_en, 'pedido_en');
      }
    }

    let esperadoPara = actual.esperado_para_str;
    if (body.esperado_para !== undefined) {
      if (body.esperado_para === null) {
        esperadoPara = null;
      } else {
        esperadoPara = validarFechaYYYYMMDD(body.esperado_para, 'esperado_para');
      }
    }

    if (pedidoEn && esperadoPara && esperadoPara < pedidoEn) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La fecha esperada no puede ser anterior a la fecha de pedido');
    }

    const estado = pedidoEn ? 'PEDIDO' : 'PENDIENTE';

    let observacion = actual.observacion;
    if (body.observacion !== undefined) {
      if (body.observacion === null) {
        observacion = null;
      } else {
        const oTrim = typeof body.observacion === 'string' ? body.observacion.trim() : '';
        if (oTrim.length > 500) {
          throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La observación no puede superar los 500 caracteres');
        }
        observacion = oTrim.length > 0 ? oTrim : null;
      }
    }

    await client.query(
      `UPDATE pedidos_repuesto
       SET repuesto_id = $1, descripcion = $2, cantidad = $3, proveedor_id = $4,
           estado = $5, pedido_en = $6, esperado_para = $7, observacion = $8,
           actualizado_por_usuario_id = $9, actualizado_en = NOW()
       WHERE id = $10`,
      [
        repuestoId,
        descripcion,
        cantidad,
        proveedorId,
        estado,
        pedidoEn,
        esperadoPara,
        observacion,
        usuario.id,
        pedidoId,
      ]
    );

    await client.query('COMMIT');

    const sqlDet = `
      SELECT
        pr.*,
        TO_CHAR(pr.pedido_en, 'YYYY-MM-DD') AS pedido_en_str,
        TO_CHAR(pr.esperado_para, 'YYYY-MM-DD') AS esperado_para_str,
        r.codigo AS repuesto_codigo,
        r.nombre AS repuesto_nombre,
        r.unidad AS repuesto_unidad,
        r.lleva_stock AS repuesto_lleva_stock,
        p.nombre AS proveedor_nombre,
        u.nombre AS creador_nombre,
        u.apellido AS creador_apellido,
        u.id AS creador_id
      FROM pedidos_repuesto pr
      LEFT JOIN repuestos r ON r.id = pr.repuesto_id
      LEFT JOIN proveedores p ON p.id = pr.proveedor_id
      LEFT JOIN usuarios u ON u.id = pr.creado_por_usuario_id
      WHERE pr.id = $1
    `;
    const resDet = await pool.query(sqlDet, [pedidoId]);
    return c.json(armarPedidoRespuesta(resDet.rows[0]), 200);
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

// POST /:id/pedidos/:pedidoId/recibir
intervencionRepuestosApp.post('/:id/pedidos/:pedidoId/recibir', async (c) => {
  const client = await pool.connect();
  try {
    const id = parseIdRuta(c.req.param('id'));
    const pedidoId = parseIdRuta(c.req.param('pedidoId'));
    if (!id || !pedidoId) {
      throw new ErrorNegocio(404, 'PEDIDO_NO_ENCONTRADO', 'Pedido no encontrado');
    }
    const usuario = getUsuarioContext(c);

    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      // cuerpo opcional
    }

    await client.query('BEGIN');

    const { intervencion } = await bloquearIntervencion(client, id, usuario);
    validarAutorizacionPedidos(usuario, intervencion);

    const pedRes = await client.query(
      `SELECT pr.*,
              TO_CHAR(pr.pedido_en, 'YYYY-MM-DD') AS pedido_en_str,
              TO_CHAR(pr.esperado_para, 'YYYY-MM-DD') AS esperado_para_str
       FROM pedidos_repuesto pr
       WHERE pr.id = $1 FOR UPDATE`,
      [pedidoId]
    );
    if (pedRes.rows.length === 0 || Number(pedRes.rows[0].intervencion_id) !== id) {
      throw new ErrorNegocio(404, 'PEDIDO_NO_ENCONTRADO', 'Pedido no encontrado');
    }
    const pedido = pedRes.rows[0];

    if (pedido.estado === 'RECIBIDO' || pedido.estado === 'CANCELADO') {
      throw new ErrorNegocio(409, 'PEDIDO_CERRADO', 'No se puede recibir un pedido cerrado');
    }

    let recibidoEn: string = new Date().toISOString();
    if (body.recibido_en !== undefined && body.recibido_en !== null) {
      const dRec = new Date(body.recibido_en);
      if (isNaN(dRec.getTime())) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Fecha de recepción inválida');
      }
      if (dRec.getTime() > Date.now() + 60000) {
        throw new ErrorNegocio(422, 'FECHA_INCOHERENTE', 'La fecha de recepción no puede estar en el futuro');
      }
      recibidoEn = dRec.toISOString();
    }

    let ingresarStock = false;
    if (body.ingresar_stock !== undefined) {
      ingresarStock = validarBooleano(body.ingresar_stock, 'ingresar_stock');
    }
    let movimientoId: number | null = null;

    if (ingresarStock) {
      if (!pedido.repuesto_id) {
        throw new ErrorNegocio(422, 'PEDIDO_SIN_REPUESTO', 'El pedido no tiene un repuesto del catálogo asociado');
      }

      const repRes = await client.query(
        'SELECT id, activo, lleva_stock, costo_unitario FROM repuestos WHERE id = $1 FOR UPDATE',
        [pedido.repuesto_id]
      );
      if (repRes.rows.length === 0) {
        throw new ErrorNegocio(404, 'REPUESTO_NO_ENCONTRADO', 'Repuesto no encontrado');
      }
      const repuesto = repRes.rows[0];

      if (!repuesto.activo) {
        throw new ErrorNegocio(409, 'REPUESTO_INACTIVO', 'El repuesto está inactivo');
      }
      if (!repuesto.lleva_stock) {
        throw new ErrorNegocio(409, 'REPUESTO_SIN_CONTROL_STOCK', 'El repuesto no lleva control de stock');
      }

      let costoUnitario: number | null = null;
      if (body.costo_unitario !== undefined && body.costo_unitario !== null) {
        if (!puedeCargarCostos(c)) {
          throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tiene permiso para registrar costos');
        }
        costoUnitario = validarCosto(body.costo_unitario, 'costo_unitario');
      }

      const comprobante = typeof body.comprobante === 'string' && body.comprobante.trim()
        ? body.comprobante.trim()
        : null;
      if (comprobante && comprobante.length > 60) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El comprobante no puede superar los 60 caracteres');
      }

      const mov = await moverStock(client, {
        repuestoId: Number(pedido.repuesto_id),
        tipo: 'INGRESO',
        delta: Number(pedido.cantidad),
        usuarioId: usuario.id,
        intervencionId: id,
        proveedorId: pedido.proveedor_id ? Number(pedido.proveedor_id) : null,
        comprobante,
        costoUnitario,
        observacion: `Pedido N.º ${pedidoId} de la intervención N.º ${id}`,
      });
      movimientoId = mov.id;

      if (costoUnitario !== null) {
        await cambiarCosto(client, {
          repuestoId: Number(pedido.repuesto_id),
          costo: costoUnitario,
          origen: 'INGRESO',
          usuarioId: usuario.id,
        });
      }
    }

    await client.query(
      `UPDATE pedidos_repuesto
       SET estado = 'RECIBIDO', recibido_en = $1, movimiento_id = $2,
           actualizado_por_usuario_id = $3, actualizado_en = NOW()
       WHERE id = $4`,
      [recibidoEn, movimientoId, usuario.id, pedidoId]
    );

    await client.query('COMMIT');

    const sqlDet = `
      SELECT
        pr.*,
        TO_CHAR(pr.pedido_en, 'YYYY-MM-DD') AS pedido_en_str,
        TO_CHAR(pr.esperado_para, 'YYYY-MM-DD') AS esperado_para_str,
        r.codigo AS repuesto_codigo,
        r.nombre AS repuesto_nombre,
        r.unidad AS repuesto_unidad,
        r.lleva_stock AS repuesto_lleva_stock,
        p.nombre AS proveedor_nombre,
        u.nombre AS creador_nombre,
        u.apellido AS creador_apellido,
        u.id AS creador_id
      FROM pedidos_repuesto pr
      LEFT JOIN repuestos r ON r.id = pr.repuesto_id
      LEFT JOIN proveedores p ON p.id = pr.proveedor_id
      LEFT JOIN usuarios u ON u.id = pr.creado_por_usuario_id
      WHERE pr.id = $1
    `;
    const resDet = await pool.query(sqlDet, [pedidoId]);
    return c.json(armarPedidoRespuesta(resDet.rows[0]), 200);
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

// POST /:id/pedidos/:pedidoId/cancelar
intervencionRepuestosApp.post('/:id/pedidos/:pedidoId/cancelar', async (c) => {
  const client = await pool.connect();
  try {
    const id = parseIdRuta(c.req.param('id'));
    const pedidoId = parseIdRuta(c.req.param('pedidoId'));
    if (!id || !pedidoId) {
      throw new ErrorNegocio(404, 'PEDIDO_NO_ENCONTRADO', 'Pedido no encontrado');
    }
    const usuario = getUsuarioContext(c);

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Cuerpo JSON inválido');
    }

    const motivoTrim = validarMotivo(body.motivo);

    await client.query('BEGIN');

    const { intervencion } = await bloquearIntervencion(client, id, usuario);
    validarAutorizacionPedidos(usuario, intervencion);

    const pedRes = await client.query(
      `SELECT pr.*,
              TO_CHAR(pr.pedido_en, 'YYYY-MM-DD') AS pedido_en_str,
              TO_CHAR(pr.esperado_para, 'YYYY-MM-DD') AS esperado_para_str
       FROM pedidos_repuesto pr
       WHERE pr.id = $1 FOR UPDATE`,
      [pedidoId]
    );
    if (pedRes.rows.length === 0 || Number(pedRes.rows[0].intervencion_id) !== id) {
      throw new ErrorNegocio(404, 'PEDIDO_NO_ENCONTRADO', 'Pedido no encontrado');
    }
    const pedido = pedRes.rows[0];

    if (pedido.estado === 'RECIBIDO' || pedido.estado === 'CANCELADO') {
      throw new ErrorNegocio(409, 'PEDIDO_CERRADO', 'No se puede cancelar un pedido cerrado');
    }

    await client.query(
      `UPDATE pedidos_repuesto
       SET estado = 'CANCELADO', motivo_cancelacion = $1,
           actualizado_por_usuario_id = $2, actualizado_en = NOW()
       WHERE id = $3`,
      [motivoTrim, usuario.id, pedidoId]
    );

    await client.query('COMMIT');

    const sqlDet = `
      SELECT
        pr.*,
        TO_CHAR(pr.pedido_en, 'YYYY-MM-DD') AS pedido_en_str,
        TO_CHAR(pr.esperado_para, 'YYYY-MM-DD') AS esperado_para_str,
        r.codigo AS repuesto_codigo,
        r.nombre AS repuesto_nombre,
        r.unidad AS repuesto_unidad,
        r.lleva_stock AS repuesto_lleva_stock,
        p.nombre AS proveedor_nombre,
        u.nombre AS creador_nombre,
        u.apellido AS creador_apellido,
        u.id AS creador_id
      FROM pedidos_repuesto pr
      LEFT JOIN repuestos r ON r.id = pr.repuesto_id
      LEFT JOIN proveedores p ON p.id = pr.proveedor_id
      LEFT JOIN usuarios u ON u.id = pr.creado_por_usuario_id
      WHERE pr.id = $1
    `;
    const resDet = await pool.query(sqlDet, [pedidoId]);
    return c.json(armarPedidoRespuesta(resDet.rows[0]), 200);
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

export default intervencionRepuestosApp;
