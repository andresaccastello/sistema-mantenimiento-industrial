import { Context } from 'hono';
import { pool } from '../db.ts';
import { getUserScope } from '../middleware.ts';
import { parseId } from '../validations.ts';
import { responderError, ErrorNegocio } from '../intervenciones/errores.ts';
import { validarIntervaloReporte } from '../intervalos.ts';

function numeroONull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/**
 * Etapa PC1, sección 5: GET /api/reportes/compras?desde=&hasta=&proveedor_id=
 * Lo que se compró en el período (D-029). Una compra es:
 * 1. un movimiento INGRESO con proveedor, o que viene de un pedido (un pedido recibido es
 *    compra siempre, aunque no tenga proveedor: va en "Sin proveedor");
 * 2. un pedido RECIBIDO sin movimiento: un repuesto sin stock, o uno de texto libre.
 * Un pedido que entró al stock cuenta por su movimiento, una sola vez. El uso de algo
 * comprado no es otra compra. Los ingresos manuales sin proveedor no son compra: se cuentan aparte.
 */
export async function reporteCompras(c: Context) {
  try {
    // D6: alcance a todas las máquinas y COSTOS_VER. Una compra para stock no es de ningún sector
    const permisos = ((c.get as any)('userPermissionsMap') as Record<string, unknown>) || {};
    if (getUserScope(c, 'REPORTES_CONSULTAR') !== 'TODAS') {
      throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'El reporte de compras pide alcance a todas las máquinas');
    }
    if (!('COSTOS_VER' in permisos)) {
      throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tiene permiso para ver costos');
    }

    const { desde, hasta } = await validarIntervaloReporte(pool, c.req.query('desde'), c.req.query('hasta'));

    let proveedorId: number | null = null;
    const proveedorQuery = c.req.query('proveedor_id');
    if (proveedorQuery !== undefined && proveedorQuery !== null && proveedorQuery.trim() !== '') {
      proveedorId = parseId(proveedorQuery);
      if (!proveedorId) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El proveedor_id debe ser un entero válido');
      }
    }

    const params: unknown[] = [desde, hasta];
    let filtroProveedor = '';
    if (proveedorId !== null) {
      params.push(proveedorId);
      filtroProveedor = `AND x.proveedor_id = $${params.length}`;
    }

    const res = await pool.query(
      `WITH zona AS (
         SELECT COALESCE(
           (SELECT zona_horaria FROM configuracion_sistema WHERE id = 1),
           'America/Argentina/Buenos_Aires'
         ) AS zona
       ),
       compras AS (
         -- 1. Ingresos al stock con proveedor, o de un pedido
         SELECT 1 AS clase, ms.id, ms.realizado_en AS momento, ms.proveedor_id, ms.comprobante,
                ms.repuesto_id, NULL::text AS descripcion, ms.cantidad, ms.costo_unitario,
                'STOCK'::text AS origen, pr.intervencion_id
         FROM movimientos_stock ms
         LEFT JOIN pedidos_repuesto pr ON pr.movimiento_id = ms.id
         WHERE ms.tipo = 'INGRESO' AND (ms.proveedor_id IS NOT NULL OR pr.id IS NOT NULL)
         UNION ALL
         -- 2. Pedidos recibidos sin ingreso al stock
         SELECT 2, pr.id, pr.recibido_en, pr.proveedor_id, pr.comprobante,
                pr.repuesto_id, pr.descripcion, pr.cantidad, pr.costo_unitario,
                'INTERVENCION'::text, pr.intervencion_id
         FROM pedidos_repuesto pr
         WHERE pr.estado = 'RECIBIDO' AND pr.movimiento_id IS NULL
       )
       SELECT to_char((x.momento AT TIME ZONE z.zona)::date, 'YYYY-MM-DD') AS fecha,
              x.clase, x.id, x.proveedor_id, p.nombre AS proveedor_nombre, x.comprobante,
              r.id AS repuesto_id, r.codigo AS repuesto_codigo, r.nombre AS repuesto_nombre,
              COALESCE(r.unidad, 'unidad') AS unidad, x.descripcion,
              x.cantidad, x.costo_unitario, ROUND(x.cantidad * x.costo_unitario, 2) AS importe,
              x.origen, i.id AS intervencion_id, m.id AS maquina_id, m.codigo AS maquina_codigo
       FROM compras x
       CROSS JOIN zona z
       LEFT JOIN proveedores p ON p.id = x.proveedor_id
       LEFT JOIN repuestos r ON r.id = x.repuesto_id
       LEFT JOIN intervenciones i ON i.id = x.intervencion_id
       LEFT JOIN maquinas m ON m.id = i.maquina_id
       WHERE x.momento >= $1::timestamptz AND x.momento <= $2::timestamptz
         ${filtroProveedor}
       ORDER BY (x.momento AT TIME ZONE z.zona)::date DESC, x.id DESC, x.clase ASC`,
      params
    );

    // Los ingresos manuales sin proveedor: no son compra. Con un proveedor elegido, no hay ninguno
    let ingresosSinProveedor = 0;
    if (proveedorId === null) {
      const resSin = await pool.query(
        `SELECT count(*)::int AS n
         FROM movimientos_stock ms
         WHERE ms.tipo = 'INGRESO' AND ms.proveedor_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM pedidos_repuesto pr WHERE pr.movimiento_id = ms.id)
           AND ms.realizado_en >= $1::timestamptz AND ms.realizado_en <= $2::timestamptz`,
        [desde, hasta]
      );
      ingresosSinProveedor = Number(resSin.rows[0].n);
    }

    const filas = res.rows.map((r) => ({
      fecha: r.fecha as string,
      proveedor: r.proveedor_id === null ? null : { id: Number(r.proveedor_id), nombre: r.proveedor_nombre as string },
      comprobante: (r.comprobante as string | null) || null,
      repuesto:
        r.repuesto_id === null
          ? null
          : { id: Number(r.repuesto_id), codigo: (r.repuesto_codigo as string | null) || null, nombre: r.repuesto_nombre as string },
      descripcion: (r.descripcion as string | null) || null,
      cantidad: Number(r.cantidad),
      unidad: r.unidad as string,
      costo_unitario: numeroONull(r.costo_unitario),
      importe: numeroONull(r.importe),
      origen: {
        tipo: r.origen as 'STOCK' | 'INTERVENCION',
        intervencion:
          r.intervencion_id === null
            ? null
            : { id: Number(r.intervencion_id), maquina: { id: Number(r.maquina_id), codigo: (r.maquina_codigo as string | null) || null } },
      },
    }));

    // Por proveedor: importe de mayor a menor; sin proveedor, como uno más (proveedor null)
    const grupos = new Map<string, { proveedor: { id: number; nombre: string } | null; compras: number; importe: number }>();
    let total = 0;
    let sinCosto = 0;
    for (const f of filas) {
      const clave = f.proveedor ? String(f.proveedor.id) : 'sin';
      let g = grupos.get(clave);
      if (!g) {
        g = { proveedor: f.proveedor, compras: 0, importe: 0 };
        grupos.set(clave, g);
      }
      g.compras++;
      if (f.importe === null) {
        sinCosto++;
      } else {
        g.importe = Math.round((g.importe + f.importe) * 100) / 100;
        total = Math.round((total + f.importe) * 100) / 100;
      }
    }
    const porProveedor = [...grupos.values()].sort(
      (a, b) =>
        b.importe - a.importe ||
        (a.proveedor === null ? 1 : 0) - (b.proveedor === null ? 1 : 0) ||
        (a.proveedor?.nombre ?? '').localeCompare(b.proveedor?.nombre ?? '', 'es')
    );

    return c.json({
      desde,
      hasta,
      total,
      compras: filas.length,
      sin_costo: sinCosto,
      ingresos_sin_proveedor: ingresosSinProveedor,
      por_proveedor: porProveedor,
      filas,
    });
  } catch (error) {
    return responderError(c, error);
  }
}
