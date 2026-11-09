import { Hono } from 'hono';
import pg from 'pg';
import { pool } from './db.ts';
import { requirePermission } from './middleware.ts';
import { leerCuerpoObjeto } from './validations.ts';
import { ErrorNegocio, responderError } from './intervenciones/errores.ts';
import { conTransaccion } from './intervenciones/transaccion.ts';
import { bloquearIntervencion } from './intervenciones/bloqueos.ts';
import { UsuarioVisibilidad, puedeVerIntervencion } from './intervenciones/visibilidad.ts';
import { registrarAuditoria } from './intervenciones/auditoria.ts';
import { parseIdRuta } from './repuestos/validaciones.ts';
import { columnasPersona, getUsuarioContext, persona } from './preventivos/comun.ts';
import { proveedorSugerido, repuestoSugerido } from './preventivos/consultas.ts';

/**
 * Etapa PV1, sección 6.2: las tareas de una intervención preventiva.
 * Un Hono sin middleware propio, montado al final de intervenciones.ts, como el de costos.
 */
const intervencionTareasApp = new Hono();

const ESTADOS_ABIERTOS = ['PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS'];

function intervencionNoEncontrada(): ErrorNegocio {
  return new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
}

/**
 * Quién puede marcar las tareas (6.2). Devuelve null si puede, o el error que corresponde.
 * La usan el PATCH y el puede_marcar del GET.
 */
export function errorAlMarcar(
  usuario: UsuarioVisibilidad,
  intervencion: { estado: string; responsable_usuario_id: number | null }
): ErrorNegocio | null {
  const sinPermiso = new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tenés permiso para marcar las tareas de esta intervención');

  if (intervencion.estado === 'CANCELADA') {
    return new ErrorNegocio(409, 'ESTADO_NO_PERMITE_TAREAS', 'Las tareas de una intervención cancelada no se marcan');
  }
  if (intervencion.estado === 'FINALIZADA') {
    return 'INTERVENCIONES_CORREGIR' in usuario.permisos ? null : sinPermiso;
  }
  if (ESTADOS_ABIERTOS.includes(intervencion.estado)) {
    const cambia = 'INTERVENCIONES_CAMBIAR_ESTADO' in usuario.permisos;
    const esResponsable = intervencion.responsable_usuario_id === usuario.id;
    const asigna = 'INTERVENCIONES_ASIGNAR' in usuario.permisos;
    return cambia && (esResponsable || asigna) ? null : sinPermiso;
  }
  return sinPermiso;
}

const SQL_TAREAS = `
  SELECT it.id, it.plan_tarea_id, it.orden, it.accion, it.detalle,
         to_char(it.fecha_programada, 'YYYY-MM-DD') AS fecha_programada,
         it.hecha, it.hecha_en, it.observacion,
         r.id AS rep_id, r.codigo AS rep_codigo, r.nombre AS rep_nombre, r.unidad AS rep_unidad,
         pt.cantidad, pr.id AS prov_id, pr.nombre AS prov_nombre,
         ${columnasPersona('uh', 'hecha_por')}
  FROM intervencion_tareas it
  JOIN plan_tareas pt ON pt.id = it.plan_tarea_id
  LEFT JOIN repuestos r ON r.id = pt.repuesto_id
  LEFT JOIN proveedores pr ON pr.id = pt.proveedor_id
  LEFT JOIN usuarios uh ON uh.id = it.hecha_por_usuario_id
`;

/** Una tarea como en el GET: el repuesto, la cantidad y el proveedor salen de la tarea del plan de hoy. */
function tareaIntervencion(r: Record<string, any>) {
  return {
    id: Number(r.id),
    plan_tarea_id: Number(r.plan_tarea_id),
    orden: Number(r.orden),
    accion: r.accion,
    detalle: r.detalle,
    fecha_programada: r.fecha_programada,
    repuesto: repuestoSugerido(r),
    cantidad: r.cantidad === null ? null : Number(r.cantidad),
    proveedor: proveedorSugerido(r),
    hecha: Boolean(r.hecha),
    hecha_por: persona(r, 'hecha_por'),
    hecha_en: r.hecha_en,
    observacion: r.observacion,
  };
}

async function leerTarea(db: pg.Pool | pg.PoolClient, intervencionId: number, tareaId: number) {
  const r = await db.query(`${SQL_TAREAS} WHERE it.id = $1 AND it.intervencion_id = $2`, [tareaId, intervencionId]);
  return r.rows.length === 0 ? null : tareaIntervencion(r.rows[0]);
}

/**
 * GET /api/intervenciones/:id/tareas
 */
intervencionTareasApp.get('/:id/tareas', requirePermission('INTERVENCIONES_VER'), async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (id === null) throw intervencionNoEncontrada();
    const usuario = getUsuarioContext(c);

    const resI = await pool.query(
      `SELECT i.id, i.estado, i.responsable_usuario_id, i.creado_por_usuario_id, i.eliminado_en,
              i.plan_mantenimiento_id, m.sector_id
       FROM intervenciones i
       JOIN maquinas m ON m.id = i.maquina_id
       WHERE i.id = $1`,
      [id]
    );
    if (resI.rows.length === 0 || resI.rows[0].eliminado_en !== null) throw intervencionNoEncontrada();
    const i = resI.rows[0];
    const responsableId = i.responsable_usuario_id === null ? null : Number(i.responsable_usuario_id);
    const visible = puedeVerIntervencion(usuario, {
      creado_por_usuario_id: Number(i.creado_por_usuario_id),
      responsable_usuario_id: responsableId,
      sector_id: Number(i.sector_id),
    });
    if (!visible) throw intervencionNoEncontrada();

    const resT = await pool.query(`${SQL_TAREAS} WHERE it.intervencion_id = $1 ORDER BY it.orden, it.id`, [id]);
    const tareas = resT.rows.map(tareaIntervencion);
    const conPlan = i.plan_mantenimiento_id !== null;

    return c.json({
      tareas,
      resumen: { total: tareas.length, hechas: tareas.filter((x) => x.hecha).length },
      puede_marcar: conPlan && errorAlMarcar(usuario, { estado: i.estado, responsable_usuario_id: responsableId }) === null,
    });
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * PATCH /api/intervenciones/:id/tareas/:tareaId
 */
intervencionTareasApp.patch('/:id/tareas/:tareaId', async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    const tareaId = parseIdRuta(c.req.param('tareaId'));
    const usuario = getUsuarioContext(c);

    // Sin ninguno de los dos permisos no puede marcar en ningún estado
    if (!('INTERVENCIONES_CAMBIAR_ESTADO' in usuario.permisos) && !('INTERVENCIONES_CORREGIR' in usuario.permisos)) {
      throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tenés permiso para marcar las tareas de esta intervención');
    }
    if (id === null) throw intervencionNoEncontrada();

    const leido = await leerCuerpoObjeto(c);
    if (!leido.ok) return leido.response;
    const b = leido.body;

    if (typeof b.hecha !== 'boolean') {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo hecha es obligatorio y debe ser un booleano');
    }
    const hecha: boolean = b.hecha;
    let observacion: string | null | undefined;
    if ('observacion' in b) {
      if (b.observacion === null) {
        observacion = null;
      } else if (typeof b.observacion !== 'string') {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo observacion debe ser texto');
      } else {
        const o = b.observacion.trim();
        if (o.length > 500) {
          throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La observación no puede superar los 500 caracteres');
        }
        observacion = o.length > 0 ? o : null;
      }
    }

    await conTransaccion(async (client) => {
      const { intervencion } = await bloquearIntervencion(client, id, usuario);
      const error = errorAlMarcar(usuario, {
        estado: intervencion.estado,
        responsable_usuario_id:
          intervencion.responsable_usuario_id === null ? null : Number(intervencion.responsable_usuario_id),
      });
      if (error) throw error;

      const finalizada = intervencion.estado === 'FINALIZADA';
      const motivo = typeof b.motivo === 'string' ? b.motivo.trim() : '';
      if (finalizada && motivo.length < 5) {
        throw new ErrorNegocio(
          422,
          'MOTIVO_REQUERIDO',
          'Con la intervención finalizada, el motivo es obligatorio y debe tener al menos 5 caracteres'
        );
      }

      if (tareaId === null) throw new ErrorNegocio(404, 'TAREA_NO_ENCONTRADA', 'Tarea no encontrada');
      const resT = await client.query(
        'SELECT id, accion, hecha, observacion FROM intervencion_tareas WHERE id = $1 AND intervencion_id = $2 FOR UPDATE',
        [tareaId, id]
      );
      if (resT.rows.length === 0) throw new ErrorNegocio(404, 'TAREA_NO_ENCONTRADA', 'Tarea no encontrada');
      const actual = resT.rows[0];

      const cambiaHecha = Boolean(actual.hecha) !== hecha;
      const cambiaObservacion = observacion !== undefined && observacion !== actual.observacion;
      if (!cambiaHecha && !cambiaObservacion) return; // El mismo valor: nada cambia, ni deja auditoría

      if (cambiaHecha) {
        await client.query(
          `UPDATE intervencion_tareas
           SET hecha = $1,
               hecha_por_usuario_id = CASE WHEN $1 THEN $2::bigint ELSE NULL END,
               hecha_en = CASE WHEN $1 THEN NOW() ELSE NULL END
           WHERE id = $3`,
          [hecha, usuario.id, tareaId]
        );
      }
      if (cambiaObservacion) {
        await client.query('UPDATE intervencion_tareas SET observacion = $1 WHERE id = $2', [observacion, tareaId]);
      }

      // Con la intervención finalizada, cada corrección queda en la auditoría
      if (finalizada) {
        const textos: string[] = [];
        if (cambiaHecha) textos.push(hecha ? `Se marcó como hecha: ${actual.accion}` : `Se desmarcó: ${actual.accion}`);
        if (cambiaObservacion) textos.push(`Se cambió la observación: ${actual.accion}`);
        for (const texto of textos) {
          await registrarAuditoria(client, {
            intervencionId: id,
            tipoEvento: 'CORRECCION_TAREA',
            campo: 'tareas',
            valorNuevo: texto,
            motivo,
            usuarioId: usuario.id,
          });
        }
      }
    });

    const tarea = await leerTarea(pool, id, tareaId as number);
    const resP = await pool.query(
      `SELECT to_char(v.proxima_fecha, 'YYYY-MM-DD') AS proxima_fecha
       FROM intervencion_tareas it JOIN v_plan_tareas_estado v ON v.id = it.plan_tarea_id
       WHERE it.id = $1`,
      [tareaId]
    );
    return c.json({ ...tarea, proxima_fecha: resP.rows[0].proxima_fecha });
  } catch (error) {
    return responderError(c, error);
  }
});

export default intervencionTareasApp;
