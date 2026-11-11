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
import { proveedorSugerido } from './preventivos/consultas.ts';
import { validarCantidad, validarIdCuerpo } from './repuestos/validaciones.ts';
import {
  anularConsumo,
  autorizarAnulacionConsumo,
  autorizarRegistroConsumo,
  bloquearRepuestosOrdenados,
  registrarConsumo,
} from './repuestos/consumos.ts';
import {
  bloquearMedidor,
  errorLecturaMenor,
  registrarLectura,
  ultimaLectura,
  validarValorMedidor,
} from './medidores/lecturas.ts';

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
         it.hecha, it.hecha_en, it.observacion, it.medidor_id, it.uso_programado, it.valor_medidor,
         md.nombre AS medidor_nombre, md.unidad AS medidor_unidad, md.activo AS medidor_activo,
         ul.valor AS ultima_valor, ul.registrada_en AS ultima_en,
         pr.id AS prov_id, pr.nombre AS prov_nombre,
         ${columnasPersona('uh', 'hecha_por')}
  FROM intervencion_tareas it
  JOIN plan_tareas pt ON pt.id = it.plan_tarea_id
  LEFT JOIN proveedores pr ON pr.id = pt.proveedor_id
  LEFT JOIN usuarios uh ON uh.id = it.hecha_por_usuario_id
  LEFT JOIN medidores md ON md.id = it.medidor_id
  LEFT JOIN LATERAL (
    SELECT l.valor, l.registrada_en
    FROM lecturas_medidor l
    WHERE l.medidor_id = it.medidor_id AND l.anulada_en IS NULL
    ORDER BY l.valor DESC, l.id DESC
    LIMIT 1
  ) ul ON TRUE
`;

/** Ve el stock quien puede abrir las opciones de repuestos de la intervención. */
function veStock(usuario: UsuarioVisibilidad): boolean {
  return ['REPUESTOS_GESTIONAR', 'INTERVENCIONES_CAMBIAR_ESTADO', 'PLANES_GESTIONAR'].some((p) => p in usuario.permisos);
}

type EstadoPrevisto = 'PREVISTO' | 'USADO' | 'NO_USADO';

/** Los previstos de las tareas, por tarea y en su orden, con su consumo (D-022). */
async function previstosDeTareas(
  db: pg.Pool | pg.PoolClient,
  tareas: Array<{ id: unknown; hecha: unknown }>,
  conStock: boolean
) {
  const porTarea = new Map<number, Array<Record<string, unknown>>>();
  if (tareas.length === 0) return porTarea;
  const hechas = new Map(tareas.map((t) => [Number(t.id), Boolean(t.hecha)]));
  const res = await db.query(
    `SELECT itr.id, itr.intervencion_tarea_id, itr.cantidad_prevista,
            r.id AS rep_id, r.codigo AS rep_codigo, r.nombre AS rep_nombre, r.unidad AS rep_unidad,
            r.lleva_stock, r.cantidad_disponible,
            ir.id AS consumo_id, ir.cantidad AS consumo_cantidad, ir.anulado_en
     FROM intervencion_tarea_repuestos itr
     JOIN repuestos r ON r.id = itr.repuesto_id
     LEFT JOIN intervencion_repuestos ir ON ir.id = itr.consumo_id
     WHERE itr.intervencion_tarea_id = ANY($1::bigint[])
     ORDER BY itr.intervencion_tarea_id, itr.orden`,
    [[...hechas.keys()]]
  );
  for (const x of res.rows) {
    const tareaId = Number(x.intervencion_tarea_id);
    const conConsumo = x.consumo_id !== null;
    const anulado = conConsumo && x.anulado_en !== null;
    const estado: EstadoPrevisto = !hechas.get(tareaId) ? 'PREVISTO' : conConsumo && !anulado ? 'USADO' : 'NO_USADO';
    if (!porTarea.has(tareaId)) porTarea.set(tareaId, []);
    porTarea.get(tareaId)!.push({
      id: Number(x.id),
      repuesto: {
        id: Number(x.rep_id),
        codigo: x.rep_codigo,
        nombre: x.rep_nombre,
        unidad: x.rep_unidad,
        lleva_stock: Boolean(x.lleva_stock),
        cantidad_disponible: conStock ? Number(x.cantidad_disponible) : null,
      },
      cantidad_prevista: Number(x.cantidad_prevista),
      estado,
      consumo: conConsumo ? { id: Number(x.consumo_id), cantidad: Number(x.consumo_cantidad), anulado } : null,
    });
  }
  return porTarea;
}

/** `uso` de una tarea de la intervención (4.4), o null si la fila no tiene medidor. */
function usoIntervencion(r: Record<string, any>) {
  if (r.medidor_id === null) return null;
  return {
    medidor: {
      id: Number(r.medidor_id),
      nombre: r.medidor_nombre,
      unidad: r.medidor_unidad,
      activo: Boolean(r.medidor_activo),
      ultima_lectura: r.ultima_valor === null ? null : { valor: Number(r.ultima_valor), registrada_en: r.ultima_en },
    },
    programado: Number(r.uso_programado),
    valor: r.valor_medidor === null ? null : Number(r.valor_medidor),
  };
}

/** Una tarea como en el GET: el proveedor sale de la tarea del plan de hoy; los previstos, de la intervención. */
function tareaIntervencion(r: Record<string, any>, repuestosPrevistos: Array<Record<string, unknown>>) {
  return {
    id: Number(r.id),
    plan_tarea_id: Number(r.plan_tarea_id),
    orden: Number(r.orden),
    accion: r.accion,
    detalle: r.detalle,
    fecha_programada: r.fecha_programada,
    repuestos_previstos: repuestosPrevistos,
    uso: usoIntervencion(r),
    proveedor: proveedorSugerido(r),
    hecha: Boolean(r.hecha),
    hecha_por: persona(r, 'hecha_por'),
    hecha_en: r.hecha_en,
    observacion: r.observacion,
  };
}

async function leerTarea(db: pg.Pool | pg.PoolClient, intervencionId: number, tareaId: number, conStock: boolean) {
  const r = await db.query(`${SQL_TAREAS} WHERE it.id = $1 AND it.intervencion_id = $2`, [tareaId, intervencionId]);
  if (r.rows.length === 0) return null;
  const previstos = await previstosDeTareas(db, r.rows, conStock);
  return tareaIntervencion(r.rows[0], previstos.get(tareaId) ?? []);
}

function lecturaRequerida(): ErrorNegocio {
  return new ErrorNegocio(422, 'LECTURA_REQUERIDA', 'Cargá la lectura del medidor para marcar la tarea como hecha');
}

function conPrevisto(err: unknown, previstoId: number): unknown {
  if (err instanceof ErrorNegocio) {
    return new ErrorNegocio(err.status, err.codigo, err.mensaje, { ...(err.detalles || {}), previsto_id: previstoId });
  }
  return err;
}

interface PrevistoFila {
  id: number;
  repuesto_id: number;
  consumo_id: number | null;
}

/** `repuestos` del PATCH: los previstos que se usaron, de esta tarea, sin repetir, en el orden de la tarea. */
function validarUsados(raw: unknown, previstos: PrevistoFila[]): Array<{ previsto: PrevistoFila; cantidad: number }> {
  if (!Array.isArray(raw)) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo repuestos es obligatorio al marcar una tarea con repuestos previstos');
  }
  const cantidades = new Map<number, number>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Cada repuesto usado debe ser un objeto');
    }
    const b = item as Record<string, unknown>;
    const id = validarIdCuerpo(b.id, 'DATOS_INVALIDOS', 'id');
    if (!previstos.some((p) => p.id === id)) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Ese repuesto no está previsto en esta tarea', { previsto_id: id });
    }
    if (cantidades.has(id)) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El repuesto previsto está repetido', { previsto_id: id });
    }
    try {
      cantidades.set(id, validarCantidad(b.cantidad, 'cantidad'));
    } catch (err) {
      throw conPrevisto(err, id);
    }
  }
  return previstos.filter((p) => cantidades.has(p.id)).map((previsto) => ({ previsto, cantidad: cantidades.get(previsto.id)! }));
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
    const previstos = await previstosDeTareas(pool, resT.rows, veStock(usuario));
    const tareas = resT.rows.map((t) => tareaIntervencion(t, previstos.get(Number(t.id)) ?? []));
    const conPlan = i.plan_mantenimiento_id !== null;
    const previstosSinConfirmar = tareas
      .filter((t) => !t.hecha)
      .reduce((total, t) => total + t.repuestos_previstos.length, 0);

    return c.json({
      tareas,
      resumen: {
        total: tareas.length,
        hechas: tareas.filter((x) => x.hecha).length,
        previstos_sin_confirmar: previstosSinConfirmar,
      },
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
    let lectura: number | undefined;
    if ('lectura' in b) {
      if (!hecha) throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo lectura solo va al marcar la tarea como hecha');
      lectura = validarValorMedidor(b.lectura, 'lectura');
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
        'SELECT id, accion, hecha, observacion, medidor_id FROM intervencion_tareas WHERE id = $1 AND intervencion_id = $2 FOR UPDATE',
        [tareaId, id]
      );
      if (resT.rows.length === 0) throw new ErrorNegocio(404, 'TAREA_NO_ENCONTRADA', 'Tarea no encontrada');
      const actual = resT.rows[0];
      const medidorId = actual.medidor_id === null ? null : Number(actual.medidor_id);
      if (lectura !== undefined && medidorId === null) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Esta tarea no tiene medidor');
      }

      const cambiaHecha = Boolean(actual.hecha) !== hecha;
      const cambiaObservacion = observacion !== undefined && observacion !== actual.observacion;
      if (!cambiaHecha && !cambiaObservacion) return; // El mismo valor: nada cambia, ni deja auditoría

      const resPrevistos = await client.query(
        'SELECT id, repuesto_id, consumo_id FROM intervencion_tarea_repuestos WHERE intervencion_tarea_id = $1 ORDER BY orden FOR UPDATE',
        [tareaId]
      );
      const previstos: PrevistoFila[] = resPrevistos.rows.map((p) => ({
        id: Number(p.id),
        repuesto_id: Number(p.repuesto_id),
        consumo_id: p.consumo_id === null ? null : Number(p.consumo_id),
      }));

      // Al marcar con previstos: se registra lo que se usó, todo o nada (D-022)
      if (cambiaHecha && hecha && previstos.length > 0) {
        if (intervencion.estado === 'PENDIENTE') {
          throw new ErrorNegocio(409, 'ESTADO_NO_PERMITE_REPUESTOS', 'Iniciá el trabajo para confirmar los repuestos de esta tarea.');
        }
        const motivoConsumo = autorizarRegistroConsumo(usuario, intervencion, b.motivo);
        const usados = validarUsados(b.repuestos, previstos);
        await bloquearRepuestosOrdenados(client, usados.map((u) => u.previsto.repuesto_id));
        for (const { previsto, cantidad } of usados) {
          try {
            const consumoId = await registrarConsumo(client, {
              intervencionId: id,
              estadoIntervencion: intervencion.estado,
              usuarioId: usuario.id,
              repuestoId: previsto.repuesto_id,
              cantidad,
              observacion: `Previsto en la tarea «${actual.accion}»`,
              motivo: motivoConsumo,
            });
            await client.query('UPDATE intervencion_tarea_repuestos SET consumo_id = $1 WHERE id = $2', [consumoId, previsto.id]);
          } catch (err) {
            throw conPrevisto(err, previsto.id);
          }
        }
      }

      // Al desmarcar: se anulan sus consumos y el stock vuelve; los ya anulados se saltean
      if (cambiaHecha && !hecha) {
        const conConsumo = previstos.filter((p) => p.consumo_id !== null);
        if (conConsumo.length > 0) {
          autorizarAnulacionConsumo(usuario, intervencion);
          await bloquearRepuestosOrdenados(client, conConsumo.map((p) => p.repuesto_id));
          for (const p of conConsumo) {
            await anularConsumo(client, {
              intervencionId: id,
              estadoIntervencion: intervencion.estado,
              usuarioId: usuario.id,
              consumoId: p.consumo_id as number,
              motivo: finalizada ? motivo : `Se desmarcó la tarea «${actual.accion}»`,
              saltearAnulado: true,
            });
          }
          await client.query('UPDATE intervencion_tarea_repuestos SET consumo_id = NULL WHERE intervencion_tarea_id = $1', [tareaId]);
        }
      }

      // Al marcar con medidor: el valor al hacerla, con el medidor bloqueado al final (4.4)
      let valorMedidor: number | null = null;
      let unidadMedidor = '';
      if (cambiaHecha && hecha && medidorId !== null) {
        const medidor = await bloquearMedidor(client, medidorId);
        unidadMedidor = medidor.unidad;
        const ultima = await ultimaLectura(client, medidorId);
        if (finalizada) {
          // Es una corrección: un valor de antes, que no registra ninguna lectura
          if (lectura === undefined) throw lecturaRequerida();
          if (ultima !== null && lectura > ultima.valor) {
            throw new ErrorNegocio(422, 'LECTURA_MAYOR', 'La lectura es mayor que la última registrada', { ultima });
          }
          valorMedidor = lectura;
        } else if (lectura === undefined) {
          if (ultima === null) throw lecturaRequerida();
          valorMedidor = ultima.valor;
        } else {
          if (ultima !== null && lectura < ultima.valor) throw errorLecturaMenor(ultima);
          if (ultima === null || lectura > ultima.valor) {
            await registrarLectura(client, {
              medidor,
              valor: lectura,
              usuarioId: usuario.id,
              origen: 'TAREA',
              intervencionTareaId: tareaId,
            });
          }
          valorMedidor = lectura;
        }
      }

      if (cambiaHecha) {
        await client.query(
          `UPDATE intervencion_tareas
           SET hecha = $1,
               hecha_por_usuario_id = CASE WHEN $1 THEN $2::bigint ELSE NULL END,
               hecha_en = CASE WHEN $1 THEN NOW() ELSE NULL END,
               valor_medidor = $4::numeric
           WHERE id = $3`,
          [hecha, usuario.id, tareaId, valorMedidor]
        );
      }
      if (cambiaObservacion) {
        await client.query('UPDATE intervencion_tareas SET observacion = $1 WHERE id = $2', [observacion, tareaId]);
      }

      // Con la intervención finalizada, cada corrección queda en la auditoría
      if (finalizada) {
        const textos: string[] = [];
        if (cambiaHecha) {
          const conMedidor = valorMedidor === null ? '' : `, con el medidor en ${String(valorMedidor).replace('.', ',')} ${unidadMedidor}`;
          textos.push(hecha ? `Se marcó como hecha: ${actual.accion}${conMedidor}` : `Se desmarcó: ${actual.accion}`);
        }
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

    const tarea = await leerTarea(pool, id, tareaId as number, veStock(usuario));
    const resP = await pool.query(
      `SELECT to_char(v.proxima_fecha, 'YYYY-MM-DD') AS proxima_fecha, v.proximo_uso
       FROM intervencion_tareas it JOIN v_plan_tareas_estado v ON v.id = it.plan_tarea_id
       WHERE it.id = $1`,
      [tareaId]
    );
    const { proxima_fecha, proximo_uso } = resP.rows[0];
    return c.json({ ...tarea, proxima_fecha, proximo_uso: proximo_uso === null ? null : Number(proximo_uso) });
  } catch (error) {
    return responderError(c, error);
  }
});

export default intervencionTareasApp;
