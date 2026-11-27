import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission } from './middleware.ts';
import { ErrorNegocio, responderError } from './intervenciones/errores.ts';

const pedidosRepuestoApp = new Hono();

pedidosRepuestoApp.use('*', jwtVerify, dbVerify);

// GET /api/pedidos-repuesto
pedidosRepuestoApp.get('/', requirePermission('REPUESTOS_GESTIONAR'), async (c) => {
  try {
    const rawEstado = c.req.query('estado') || 'ABIERTOS';
    if (rawEstado !== 'ABIERTOS' && rawEstado !== 'TODOS') {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Filtro de estado inválido');
    }

    let estadoClause = '';
    if (rawEstado === 'ABIERTOS') {
      estadoClause = "AND pr.estado IN ('PENDIENTE', 'PEDIDO')";
    }

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
        u.id AS creador_id,
        i.id AS intervencion_id,
        i.estado AS intervencion_estado,
        i.descripcion AS intervencion_descripcion,
        m.id AS maquina_id,
        m.codigo AS maquina_codigo,
        m.nombre AS maquina_nombre,
        s.id AS sector_id,
        s.nombre AS sector_nombre
      FROM pedidos_repuesto pr
      JOIN intervenciones i ON i.id = pr.intervencion_id
      JOIN maquinas m ON m.id = i.maquina_id
      JOIN sectores s ON s.id = m.sector_id
      LEFT JOIN repuestos r ON r.id = pr.repuesto_id
      LEFT JOIN proveedores p ON p.id = pr.proveedor_id
      LEFT JOIN usuarios u ON u.id = pr.creado_por_usuario_id
      WHERE i.eliminado_en IS NULL
      ${estadoClause}
      ORDER BY pr.esperado_para ASC NULLS LAST, pr.id ASC
    `;

    const res = await pool.query(sql);
    const lista = res.rows.map((row) => ({
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
      intervencion: {
        id: Number(row.intervencion_id),
        estado: row.intervencion_estado,
        descripcion: row.intervencion_descripcion,
      },
      maquina: {
        id: Number(row.maquina_id),
        codigo: row.maquina_codigo,
        nombre: row.maquina_nombre,
      },
      sector: {
        id: Number(row.sector_id),
        nombre: row.sector_nombre,
      },
    }));

    return c.json(lista, 200);
  } catch (err) {
    return responderError(c, err);
  }
});

export default pedidosRepuestoApp;
