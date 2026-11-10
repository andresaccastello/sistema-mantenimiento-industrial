import pg from 'pg';
import { ErrorNegocio } from '../intervenciones/errores.ts';
import { UsuarioVisibilidad } from '../intervenciones/visibilidad.ts';
import { validarResponsableHabilitado } from '../intervenciones/motor.ts';
import { registrarAuditoria, registrarNotificaciones } from '../intervenciones/auditoria.ts';
import { validarIdCuerpo } from '../repuestos/validaciones.ts';
import { MAXIMO_VALOR } from '../medidores/lecturas.ts';
import { bloquearPlan, columnasPersona, persona, planNoEncontrado, Persona } from './comun.ts';

const LARGO_DESCRIPCION = 2000;

function invalido(mensaje: string): ErrorNegocio {
  return new ErrorNegocio(422, 'DATOS_INVALIDOS', mensaje);
}

/** tarea_ids (6.1): opcional; si viene, de 1 a 50 ids sin repetidos, con su tipo real. */
export function validarTareaIds(raw: unknown): number[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) {
    throw invalido('tarea_ids debe ser un arreglo de 1 a 50 ids');
  }
  const ids = raw.map((x) => validarIdCuerpo(x, 'DATOS_INVALIDOS', 'tarea_ids'));
  if (new Set(ids).size !== ids.length) {
    throw invalido('tarea_ids no puede tener ids repetidos');
  }
  return ids;
}

/** "Preventivo: <plan>. Tareas: <acción 1>; <acción 2>.", recortada a 2000 con "…". */
function descripcionPreventivo(plan: string, acciones: string[]): string {
  const texto = `Preventivo: ${plan}. Tareas: ${acciones.join('; ')}.`;
  return texto.length <= LARGO_DESCRIPCION ? texto : `${texto.slice(0, LARGO_DESCRIPCION - 1)}…`;
}

export interface Generada {
  intervencion: { id: number; estado: string; responsable: Persona | null };
  responsable_omitido: boolean;
  tareas: Array<{ id: number; plan_tarea_id: number; orden: number; accion: string; fecha_programada: string | null }>;
}

/**
 * 6.1 Genera, desde el plan, una intervención PREVENTIVO con las tareas que vencen
 * (o las elegidas), dentro de la transacción del llamador.
 */
export async function generarDesdePlan(
  client: pg.PoolClient,
  planId: number | null,
  usuario: UsuarioVisibilidad,
  sectores: number[] | null,
  tareaIds: number[] | null
): Promise<Generada> {
  if (planId === null) throw planNoEncontrado();

  // 1. Bloqueos, en este orden: la máquina, el plan y sus tareas
  const resLookup = await client.query('SELECT maquina_id FROM planes_mantenimiento WHERE id = $1', [planId]);
  if (resLookup.rows.length === 0) throw planNoEncontrado();
  const resM = await client.query(
    'SELECT id, sector_id, activo FROM maquinas WHERE id = $1 FOR UPDATE',
    [resLookup.rows[0].maquina_id]
  );
  const maquina = resM.rows[0];
  const plan = await bloquearPlan(client, planId, sectores);
  await client.query('SELECT id FROM plan_tareas WHERE plan_id = $1 ORDER BY id FOR UPDATE', [planId]);

  if (!plan.activo) {
    throw new ErrorNegocio(409, 'PLAN_INACTIVO', 'El plan está inactivo');
  }
  if (!maquina.activo) {
    throw new ErrorNegocio(422, 'MAQUINA_INACTIVA', 'La máquina está inactiva');
  }

  // 2. Recién ahora, los estados
  const resEstados = await client.query(
    `SELECT id, orden, accion, detalle, activo, estado, intervencion_en_curso_id,
            to_char(proxima_fecha, 'YYYY-MM-DD') AS proxima_fecha, medidor_id, proximo_uso
     FROM v_plan_tareas_estado
     WHERE plan_id = $1
     ORDER BY orden, id`,
    [planId]
  );
  const estados = resEstados.rows;

  let elegidas: any[];
  if (tareaIds !== null) {
    for (const id of tareaIds) {
      const fila = estados.find((e) => Number(e.id) === id);
      if (!fila || !fila.activo || fila.estado === 'INACTIVA') {
        throw new ErrorNegocio(422, 'TAREA_INVALIDA', 'La tarea no es de este plan o está inactiva', { tarea_id: id });
      }
    }
    for (const id of tareaIds) {
      const fila = estados.find((e) => Number(e.id) === id);
      if (fila.estado === 'EN_CURSO') {
        throw new ErrorNegocio(409, 'TAREA_EN_CURSO', 'La tarea ya está en una intervención abierta', {
          tarea_id: id,
          intervencion_id: Number(fila.intervencion_en_curso_id),
        });
      }
    }
    elegidas = estados.filter((e) => tareaIds.includes(Number(e.id)));
  } else {
    elegidas = estados.filter((e) => e.estado === 'VENCIDA' || e.estado === 'PROXIMA');
  }
  if (elegidas.length === 0) {
    throw new ErrorNegocio(409, 'SIN_TAREAS_PARA_GENERAR', 'No hay tareas vencidas ni próximas para generar');
  }
  // La próxima por uso se calcula sin tope: guardada en uso_programado no puede superar numeric(14,2)
  for (const e of elegidas) {
    if (e.proximo_uso !== null && Number(e.proximo_uso) > MAXIMO_VALOR) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La próxima por uso de la tarea supera el máximo que se puede registrar', {
        tarea_id: Number(e.id),
      });
    }
  }

  // 3. La intervención, PENDIENTE, con el plan
  const resTipo = await client.query(`SELECT id FROM tipos_intervencion WHERE codigo = 'PREVENTIVO' LIMIT 1`);
  if (resTipo.rows.length === 0) {
    throw new Error('Tipo PREVENTIVO no configurado');
  }
  const resI = await client.query(
    `INSERT INTO intervenciones (
       maquina_id, tipo_intervencion_id, creado_por_usuario_id, descripcion, estado,
       plan_mantenimiento_id, fecha_creacion, actualizado_en
     ) VALUES ($1, $2, $3, $4, 'PENDIENTE', $5, NOW(), NOW())
     RETURNING id`,
    [
      plan.maquina_id,
      resTipo.rows[0].id,
      usuario.id,
      descripcionPreventivo(plan.nombre, elegidas.map((e) => e.accion)),
      plan.id,
    ]
  );
  const intervencionId = Number(resI.rows[0].id);

  // 4. El historial: NULL → PENDIENTE
  await client.query(
    `INSERT INTO historial_estados_intervencion (
       intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, observacion, cambiado_en
     ) VALUES ($1, NULL, 'PENDIENTE', $2, $3, NOW())`,
    [intervencionId, usuario.id, `Generada desde el plan «${plan.nombre}»`]
  );

  // 5. Las tareas, copiadas del plan, con sus repuestos previstos (también los inactivos).
  // Los repuestos se toman en orden de id, para no trabarse con una confirmación.
  await client.query(
    `SELECT r.id FROM repuestos r
     WHERE r.id IN (SELECT repuesto_id FROM plan_tarea_repuestos WHERE plan_tarea_id = ANY($1::bigint[]))
     ORDER BY r.id FOR KEY SHARE`,
    [elegidas.map((e) => e.id)]
  );
  const tareas: Generada['tareas'] = [];
  for (const e of elegidas) {
    const r = await client.query(
      `INSERT INTO intervencion_tareas (intervencion_id, plan_tarea_id, orden, accion, detalle, fecha_programada, medidor_id, uso_programado)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8)
       RETURNING id`,
      [intervencionId, e.id, e.orden, e.accion, e.detalle, e.proxima_fecha, e.medidor_id, e.proximo_uso]
    );
    await client.query(
      `INSERT INTO intervencion_tarea_repuestos (intervencion_tarea_id, repuesto_id, cantidad_prevista, orden)
       SELECT $1, repuesto_id, cantidad, orden FROM plan_tarea_repuestos WHERE plan_tarea_id = $2`,
      [r.rows[0].id, e.id]
    );
    tareas.push({
      id: Number(r.rows[0].id),
      plan_tarea_id: Number(e.id),
      orden: Number(e.orden),
      accion: e.accion,
      fecha_programada: e.proxima_fecha,
    });
  }

  // 6. El responsable del plan, si está habilitado
  let responsable: Persona | null = null;
  let responsableOmitido = false;
  const responsableId = plan.responsable_usuario_id;
  if (responsableId !== null) {
    let habilitado = true;
    try {
      await validarResponsableHabilitado(client, responsableId, plan.sector_id);
    } catch (err) {
      if (!(err instanceof ErrorNegocio)) throw err;
      habilitado = false;
    }

    if (habilitado) {
      await client.query(
        'UPDATE intervenciones SET responsable_usuario_id = $1, actualizado_en = NOW() WHERE id = $2',
        [responsableId, intervencionId]
      );
      await registrarAuditoria(client, {
        intervencionId,
        tipoEvento: 'ASIGNACION',
        campo: 'responsable_usuario_id',
        valorAnterior: null,
        valorNuevo: String(responsableId),
        motivo: 'Responsable del plan preventivo',
        usuarioId: usuario.id,
      });
      await registrarNotificaciones(
        client,
        [{ tipo: 'INTERVENCION_ASIGNADA', payload: { intervencionId, responsableId } }],
        { actorId: usuario.id }
      );
      const resR = await client.query(`SELECT ${columnasPersona('u', 'resp')} FROM usuarios u WHERE u.id = $1`, [responsableId]);
      responsable = persona(resR.rows[0], 'resp');
    } else {
      responsableOmitido = true;
    }
  }

  return {
    intervencion: { id: intervencionId, estado: 'PENDIENTE', responsable },
    responsable_omitido: responsableOmitido,
    tareas,
  };
}
