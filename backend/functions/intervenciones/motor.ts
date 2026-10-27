import pg from 'pg';
import { ErrorNegocio } from './errores.ts';
import { resolverPermisosEfectivos } from './permisos.ts';
import { UsuarioVisibilidad } from './visibilidad.ts';
import { bloquearIntervencion } from './bloqueos.ts';
import { recalcularEstadoMaquina } from './recalculoMaquina.ts';
import { registrarCambioEstado } from './cambioEstado.ts';
import { registrarAuditoria, registrarNotificaciones } from './auditoria.ts';
import { AccionTransicion, buscarTransicion, transicionesDeAccion } from './transiciones.ts';
import { validarFechaISO } from './fechas.ts';
import { validarDecisionRecuperacion, aplicarDecisionRecuperacion } from './recuperacion.ts';

/**
 * Verifica si un usuario es "responsable habilitado" para una intervención concreta:
 * - Usuario activo.
 * - Con permiso INTERVENCIONES_RECIBIR_ASIGNACION efectivo (incluidas excepciones).
 * - Con visibilidad sobre la intervención (si su alcance es PROPIAS, la asignación la vuelve propia y cuenta como visible;
 *   si es SECTORES, el sector de la máquina debe estar entre sus sectores).
 */
export async function validarResponsableHabilitado(
  db: pg.Pool | pg.PoolClient,
  usuarioId: number,
  maquinaSectorId: number
): Promise<{ id: number; legajo: string; nombre: string }> {
  const resUser = await db.query(
    'SELECT id, legajo, nombre, activo FROM usuarios WHERE id = $1',
    [usuarioId]
  );

  if (resUser.rows.length === 0 || !resUser.rows[0].activo) {
    throw new ErrorNegocio(
      422,
      'RESPONSABLE_NO_HABILITADO',
      'El usuario no existe o se encuentra inactivo'
    );
  }

  const perms = await resolverPermisosEfectivos(db, usuarioId);
  if (!('INTERVENCIONES_RECIBIR_ASIGNACION' in perms.permisos)) {
    throw new ErrorNegocio(
      422,
      'RESPONSABLE_NO_HABILITADO',
      'El usuario no tiene permiso para ser designado responsable de intervenciones'
    );
  }

  // Verificar visibilidad del destinatario
  if (!('INTERVENCIONES_VER' in perms.permisos)) {
    throw new ErrorNegocio(
      422,
      'RESPONSABLE_SIN_VISIBILIDAD',
      'El usuario no tiene permiso de visualización para acceder a esta intervención'
    );
  }

  const alcanceVer = perms.permisos['INTERVENCIONES_VER'];
  if (alcanceVer === 'SECTORES' && !perms.sectores.includes(Number(maquinaSectorId))) {
    throw new ErrorNegocio(
      422,
      'RESPONSABLE_SIN_VISIBILIDAD',
      'El usuario no tiene alcance sobre el sector de la máquina asignada'
    );
  }

  return {
    id: Number(resUser.rows[0].id),
    legajo: resUser.rows[0].legajo,
    nombre: resUser.rows[0].nombre,
  };
}

/**
 * 5.1 POST /:id/tomar
 */
export async function tomarIntervencionServicio(
  client: pg.PoolClient,
  intervencionId: number,
  usuario: UsuarioVisibilidad,
  estadoEsperado: string
) {
  if (!('INTERVENCIONES_ASIGNARSE' in usuario.permisos)) {
    throw new ErrorNegocio(
      403,
      'PERMISO_INSUFICIENTE',
      'No tienes permiso para asignarte intervenciones'
    );
  }

  const { intervencion, maquina } = await bloquearIntervencion(
    client,
    intervencionId,
    usuario
  );

  if (intervencion.estado !== 'PENDIENTE') {
    throw new ErrorNegocio(
      409,
      'TRANSICION_NO_PERMITIDA',
      `Solo se pueden tomar intervenciones en estado PENDIENTE (estado actual: ${intervencion.estado})`
    );
  }

  if (estadoEsperado !== intervencion.estado) {
    throw new ErrorNegocio(
      409,
      'ESTADO_DESACTUALIZADO',
      'El estado de la intervención ha cambiado por otra operación'
    );
  }

  if (intervencion.responsable_usuario_id !== null) {
    if (Number(intervencion.responsable_usuario_id) === usuario.id) {
      throw new ErrorNegocio(
        422,
        'RESPONSABLE_SIN_CAMBIOS',
        'Ya eres el responsable asignado de esta intervención'
      );
    }
    throw new ErrorNegocio(
      409,
      'INTERVENCION_YA_ASIGNADA',
      'La intervención ya fue asignada a otro responsable'
    );
  }

  // Validar que el usuario sea responsable habilitado
  await validarResponsableHabilitado(client, usuario.id, maquina.sector_id);

  // Asignar responsable (sin cambiar estado ni historial_estados_intervencion)
  await client.query(
    'UPDATE intervenciones SET responsable_usuario_id = $1, actualizado_en = NOW() WHERE id = $2',
    [usuario.id, intervencionId]
  );

  await registrarAuditoria(client, {
    intervencionId,
    tipoEvento: 'ASIGNACION',
    campo: 'responsable_usuario_id',
    valorAnterior: null,
    valorNuevo: String(usuario.id),
    motivo: 'Intervención tomada por el responsable',
    usuarioId: usuario.id,
  });

  await registrarNotificaciones(client, [
    { tipo: 'INTERVENCION_ASIGNADA', payload: { intervencionId, responsableId: usuario.id } },
  ], { actorId: usuario.id });

  return { ok: true, responsable_id: usuario.id };
}

/**
 * 5.2 PUT /:id/responsable
 */
export async function asignarResponsableServicio(
  client: pg.PoolClient,
  intervencionId: number,
  usuario: UsuarioVisibilidad,
  destinatarioId: number,
  motivo: string | null,
  estadoEsperado: string
) {
  if (!('INTERVENCIONES_ASIGNAR' in usuario.permisos)) {
    throw new ErrorNegocio(
      403,
      'PERMISO_INSUFICIENTE',
      'No tienes permiso para asignar responsables a intervenciones'
    );
  }

  const { intervencion, maquina } = await bloquearIntervencion(
    client,
    intervencionId,
    usuario
  );

  const estadosPermitidos = ['PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS'];
  if (!estadosPermitidos.includes(intervencion.estado)) {
    throw new ErrorNegocio(
      409,
      'TRANSICION_NO_PERMITIDA',
      `No se puede asignar responsable en estado ${intervencion.estado}`
    );
  }

  if (estadoEsperado !== intervencion.estado) {
    throw new ErrorNegocio(
      409,
      'ESTADO_DESACTUALIZADO',
      'El estado de la intervención ha cambiado por otra operación'
    );
  }

  const responsableAnteriorId = intervencion.responsable_usuario_id
    ? Number(intervencion.responsable_usuario_id)
    : null;

  if (responsableAnteriorId === destinatarioId) {
    throw new ErrorNegocio(
      422,
      'RESPONSABLE_SIN_CAMBIOS',
      'El usuario indicado ya es el responsable de esta intervención'
    );
  }

  // Reasignación exige motivo obligatorio
  const esReasignacion = responsableAnteriorId !== null;
  const motivoLimpio = motivo ? motivo.trim() : '';

  if (esReasignacion && motivoLimpio.length === 0) {
    throw new ErrorNegocio(
      422,
      'MOTIVO_REQUERIDO',
      'El motivo de reasignación es obligatorio'
    );
  }

  // Validar destinatario
  const datosDestinatario = await validarResponsableHabilitado(
    client,
    destinatarioId,
    maquina.sector_id
  );

  await client.query(
    'UPDATE intervenciones SET responsable_usuario_id = $1, actualizado_en = NOW() WHERE id = $2',
    [destinatarioId, intervencionId]
  );

  await registrarAuditoria(client, {
    intervencionId,
    tipoEvento: 'ASIGNACION',
    campo: 'responsable_usuario_id',
    valorAnterior: responsableAnteriorId !== null ? String(responsableAnteriorId) : null,
    valorNuevo: String(destinatarioId),
    motivo: motivoLimpio || (esReasignacion ? null : 'Asignación de responsable'),
    usuarioId: usuario.id,
  });

  await registrarNotificaciones(client, [
    {
      tipo: esReasignacion ? 'INTERVENCION_REASIGNADA' : 'INTERVENCION_ASIGNADA',
      payload: {
        intervencionId,
        responsableId: destinatarioId,
        responsableAnteriorId: esReasignacion ? responsableAnteriorId : null,
        motivo: motivoLimpio || null,
      },
    },
  ], { actorId: usuario.id });

  return { ok: true, responsable: datosDestinatario };
}

/**
 * 5.3 DELETE /:id/responsable
 */
export async function desasignarResponsableServicio(
  client: pg.PoolClient,
  intervencionId: number,
  usuario: UsuarioVisibilidad,
  motivo: string | null,
  estadoEsperado: string
) {
  const { intervencion } = await bloquearIntervencion(
    client,
    intervencionId,
    usuario
  );

  const responsableActual = intervencion.responsable_usuario_id
    ? Number(intervencion.responsable_usuario_id)
    : null;

  // Verificación de permiso: INTERVENCIONES_ASIGNAR o (es el responsable y tiene INTERVENCIONES_ASIGNARSE)
  const tieneAsignar = 'INTERVENCIONES_ASIGNAR' in usuario.permisos;
  const esPropioResponsableConAsignarse =
    responsableActual === usuario.id && 'INTERVENCIONES_ASIGNARSE' in usuario.permisos;

  if (!tieneAsignar && !esPropioResponsableConAsignarse) {
    throw new ErrorNegocio(
      403,
      'PERMISO_INSUFICIENTE',
      'No tienes permiso para quitar el responsable de esta intervención'
    );
  }

  if (intervencion.estado !== 'PENDIENTE') {
    throw new ErrorNegocio(
      409,
      'DESASIGNACION_NO_PERMITIDA',
      `No se puede quitar el responsable en estado ${intervencion.estado}. En este estado solo se permite reasignar.`
    );
  }

  if (estadoEsperado !== intervencion.estado) {
    throw new ErrorNegocio(
      409,
      'ESTADO_DESACTUALIZADO',
      'El estado de la intervención ha cambiado por otra operación'
    );
  }

  if (responsableActual === null) {
    throw new ErrorNegocio(
      422,
      'RESPONSABLE_SIN_CAMBIOS',
      'La intervención no tiene ningún responsable asignado'
    );
  }

  const motivoLimpio = motivo ? motivo.trim() : '';
  if (motivoLimpio.length === 0) {
    throw new ErrorNegocio(
      422,
      'MOTIVO_REQUERIDO',
      'El motivo para quitar el responsable es obligatorio'
    );
  }

  await client.query(
    'UPDATE intervenciones SET responsable_usuario_id = NULL, actualizado_en = NOW() WHERE id = $1',
    [intervencionId]
  );

  await registrarAuditoria(client, {
    intervencionId,
    tipoEvento: 'DESASIGNACION',
    campo: 'responsable_usuario_id',
    valorAnterior: String(responsableActual),
    valorNuevo: null,
    motivo: motivoLimpio,
    usuarioId: usuario.id,
  });

  await registrarNotificaciones(client, [
    { tipo: 'INTERVENCION_DESASIGNADA', payload: { intervencionId, responsableAnteriorId: responsableActual, motivo: motivoLimpio } },
  ], { actorId: usuario.id });

  return { ok: true };
}

/**
 * Implementación unificada de la Regla de Actor (D-23, D-28).
 * Se aplica cuando la transición tiene `requiereActor: true`.
 *
 * - Si no hay responsable asignado (en PENDIENTE para INICIAR o RESOLVER_AHORA):
 *   El usuario debe poseer INTERVENCIONES_ASIGNARSE para auto-asignarse (y estar habilitado).
 *   Si no lo posee, lanza 422 RESPONSABLE_REQUERIDO.
 * - Si ya hay responsable asignado:
 *   El usuario debe ser el responsable asignado O poseer INTERVENCIONES_ASIGNAR.
 *   Si no, lanza 403 NO_ES_RESPONSABLE.
 *   El responsable asignado debe seguir habilitado (422 RESPONSABLE_NO_HABILITADO).
 */
export async function aplicarReglaActor(
  client: pg.PoolClient,
  opts: {
    intervencionId: number;
    intervencion: any;
    maquina: any;
    usuario: UsuarioVisibilidad;
    validaHabilitacion?: boolean;
    camposExtra?: Record<string, any>;
    eventos?: Array<{ tipo: string; payload: any }>;
    motivoAutoAsignacion?: string;
  }
): Promise<{ responsableId: number; autoAsignado: boolean }> {
  const { intervencionId, intervencion, maquina, usuario, validaHabilitacion, camposExtra, eventos, motivoAutoAsignacion } = opts;
  const responsableId = intervencion.responsable_usuario_id
    ? Number(intervencion.responsable_usuario_id)
    : null;

  if (responsableId === null) {
    const tieneAsignarse = 'INTERVENCIONES_ASIGNARSE' in usuario.permisos;
    if (!tieneAsignarse) {
      throw new ErrorNegocio(
        422,
        'RESPONSABLE_REQUERIDO',
        'La intervención no tiene responsable asignado y no posees permiso para asignártela'
      );
    }

    await validarResponsableHabilitado(client, usuario.id, maquina.sector_id);

    if (camposExtra) {
      camposExtra.responsable_usuario_id = usuario.id;
    } else {
      await client.query('UPDATE intervenciones SET responsable_usuario_id = $1 WHERE id = $2', [
        usuario.id,
        intervencionId,
      ]);
    }

    await registrarAuditoria(client, {
      intervencionId,
      tipoEvento: 'ASIGNACION',
      campo: 'responsable_usuario_id',
      valorAnterior: null,
      valorNuevo: String(usuario.id),
      motivo: motivoAutoAsignacion || 'Asignación automática al iniciar trabajo',
      usuarioId: usuario.id,
    });

    if (eventos) {
      eventos.push({
        tipo: 'INTERVENCION_ASIGNADA',
        payload: { intervencionId, responsableId: usuario.id },
      });
    }

    return { responsableId: usuario.id, autoAsignado: true };
  } else {
    const esResponsable = responsableId === usuario.id;
    const tieneAsignar = 'INTERVENCIONES_ASIGNAR' in usuario.permisos;

    if (!esResponsable && !tieneAsignar) {
      throw new ErrorNegocio(
        403,
        'NO_ES_RESPONSABLE',
        'Solo el responsable asignado o un usuario con permiso de asignación puede realizar esta acción'
      );
    }

    if (validaHabilitacion) {
      await validarResponsableHabilitado(client, responsableId, maquina.sector_id);
    }

    return { responsableId, autoAsignado: false };
  }
}

/**
 * 6. Transición de estado (T1, T4, T5)
 */
export async function ejecutarTransicionServicio(
  client: pg.PoolClient,
  intervencionId: number,
  usuario: UsuarioVisibilidad,
  accion: AccionTransicion,
  params: {
    estadoEsperado: string;
    observacion?: string | null;
    fechaInicio?: string | null;
  }
) {
  // 1. Obtener las definiciones de transición para la acción
  const transiciones = transicionesDeAccion(accion);
  if (transiciones.length === 0) {
    throw new ErrorNegocio(
      409,
      'TRANSICION_NO_PERMITIDA',
      `Acción de transición desconocida: ${accion}`
    );
  }

  // 2. Validar permiso tomado de las filas de la acción (todas comparten el mismo permiso)
  const permisoRequerido = transiciones[0].permiso;
  if (!(permisoRequerido in usuario.permisos)) {
    throw new ErrorNegocio(
      403,
      'PERMISO_INSUFICIENTE',
      'No tienes permiso para ejecutar este cambio de estado'
    );
  }

  const { intervencion, maquina } = await bloquearIntervencion(
    client,
    intervencionId,
    usuario
  );

  // 3. Validar estado esperado coincidente
  if (params.estadoEsperado !== intervencion.estado) {
    throw new ErrorNegocio(
      409,
      'ESTADO_DESACTUALIZADO',
      'El estado de la intervención ha cambiado concurrentemente'
    );
  }

  // 4. Seleccionar la fila de transición cuyo 'desde' coincide con el estado actual
  const transicion = transiciones.find((t) => t.desde === intervencion.estado);
  if (!transicion) {
    throw new ErrorNegocio(
      409,
      'TRANSICION_NO_PERMITIDA',
      `La acción ${accion} no está permitida desde el estado ${intervencion.estado}`
    );
  }

  const camposExtra: Record<string, any> = {};
  const eventos: Array<{ tipo: string; payload: any }> = [];

  // =========================================================
  // REGLAS ESPECÍFICAS SEGÚN LA TRANSICIÓN
  // =========================================================

  let nuevoResponsableId: number | null = intervencion.responsable_usuario_id
    ? Number(intervencion.responsable_usuario_id)
    : null;

  if (transicion.requiereActor) {
    const resActor = await aplicarReglaActor(client, {
      intervencionId,
      intervencion,
      maquina,
      usuario,
      validaHabilitacion: transicion.validaHabilitacion,
      camposExtra,
      eventos,
      motivoAutoAsignacion: 'Asignación automática al iniciar trabajo',
    });
    nuevoResponsableId = resActor.responsableId;
  }

  if (accion === 'INICIAR') {
    // fecha_inicio: validar formato y coherencia si viene en el body
    if (params.fechaInicio !== undefined && params.fechaInicio !== null) {
      await validarFechaISO(client, params.fechaInicio, 'fecha_inicio');

      const resValida = await client.query(
        `SELECT (
           $1::timestamptz >= fecha_creacion 
           AND $1::timestamptz <= NOW() + INTERVAL '10 seconds'
         ) AS fecha_valida
         FROM intervenciones
         WHERE id = $2`,
        [params.fechaInicio, intervencionId]
      );

      if (!resValida.rows[0] || !resValida.rows[0].fecha_valida) {
        throw new ErrorNegocio(
          422,
          'FECHA_INCOHERENTE',
          'La fecha de inicio debe ser mayor o igual a la creación y menor o igual a la fecha actual'
        );
      }

      // Solo si es nula se graba
      if (intervencion.fecha_inicio === null) {
        camposExtra.fecha_inicio = params.fechaInicio;
      }
    } else {
      if (intervencion.fecha_inicio === null) {
        // Por defecto NOW()
        camposExtra.fecha_inicio = new Date().toISOString();
      }
    }

    eventos.push({ tipo: 'INTERVENCION_INICIADA', payload: { intervencionId, responsableId: nuevoResponsableId } });

  } else if (accion === 'ESPERAR_REPUESTOS') {
    const obs = params.observacion ? params.observacion.trim() : '';
    if (obs.length < 5) {
      throw new ErrorNegocio(
        422,
        'OBSERVACION_REQUERIDA',
        'Debe indicar detalladamente qué repuesto o insumo falta (mínimo 5 caracteres)'
      );
    }

    eventos.push({ tipo: 'INTERVENCION_EN_ESPERA', payload: { intervencionId } });

  } else if (accion === 'REANUDAR') {
    // No modifica fecha_inicio
    eventos.push({ tipo: 'INTERVENCION_REANUDADA', payload: { intervencionId } });
  }

  // 4. Registrar cambio de estado e historial
  await registrarCambioEstado(client, {
    intervencionId,
    estadoActual: transicion.desde,
    estadoNuevo: transicion.hacia,
    usuarioId: usuario.id,
    observacion: params.observacion ? params.observacion.trim() : null,
    camposExtra,
    fechaEfectiva: accion === 'INICIAR' ? (camposExtra.fecha_inicio || intervencion.fecha_inicio) : null,
  });

  // 5. Recalcular estado de la máquina
  const recalculo = await recalcularEstadoMaquina(client, maquina.id, {
    usuarioId: usuario.id,
    intervencionId,
    motivo: `Transición ${transicion.codigo} (${accion}): ${transicion.desde} ➔ ${transicion.hacia}`,
  });

  if (recalculo.cambio) {
    eventos.push({
      tipo: 'MAQUINA_CAMBIO_ESTADO',
      payload: {
        maquinaId: maquina.id,
        estadoAnterior: recalculo.estadoAnterior,
        estadoNuevo: recalculo.estadoNuevo,
      },
    });
  }

  // 6. Enganche de notificaciones
  await registrarNotificaciones(client, eventos, { actorId: usuario.id });

  // 7. Consultar datos actualizados de la intervención para la respuesta
  const resActualizado = await client.query(
    `SELECT i.id, i.estado, i.fecha_inicio,
            u.id AS resp_id, u.legajo AS resp_legajo, u.nombre AS resp_nombre
     FROM intervenciones i
     LEFT JOIN usuarios u ON i.responsable_usuario_id = u.id
     WHERE i.id = $1`,
    [intervencionId]
  );
  const row = resActualizado.rows[0];

  return {
    intervencion: {
      id: Number(row.id),
      estado: row.estado,
      fecha_inicio: row.fecha_inicio,
      responsable: row.resp_id
        ? {
            id: Number(row.resp_id),
            legajo: row.resp_legajo,
            nombre: row.resp_nombre,
          }
        : null,
    },
    maquina: {
      id: Number(maquina.id),
      estado_anterior: recalculo.estadoAnterior,
      estadoNuevo: recalculo.estadoNuevo,
      cambio: recalculo.cambio,
    },
  };
}

/**
 * 6.1 POST /api/intervenciones/:id/finalizar (T6)
 */
export async function finalizarIntervencionServicio(
  client: pg.PoolClient,
  intervencionId: number,
  usuario: UsuarioVisibilidad,
  body: {
    estado_esperado: string;
    fecha_finalizacion?: unknown;
    trabajo_realizado?: unknown;
    ejecucion?: unknown;
    observacion?: unknown;
    maquina_recuperada?: unknown;
    fecha_recuperacion?: unknown;
    observacion_recuperacion?: unknown;
  }
) {
  const transiciones = transicionesDeAccion('FINALIZAR');
  if (transiciones.length === 0) {
    throw new ErrorNegocio(409, 'TRANSICION_NO_PERMITIDA', 'Acción no permitida: FINALIZAR');
  }

  const permisoRequerido = transiciones[0].permiso;
  if (!(permisoRequerido in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No posees permiso para finalizar intervenciones');
  }

  const { intervencion, maquina } = await bloquearIntervencion(client, intervencionId, usuario);

  if (body.estado_esperado !== intervencion.estado) {
    throw new ErrorNegocio(409, 'ESTADO_DESACTUALIZADO', 'El estado de la intervención ha cambiado concurrentemente');
  }

  const transicion = transiciones.find((t) => t.desde === intervencion.estado);
  if (!transicion) {
    throw new ErrorNegocio(
      409,
      'TRANSICION_NO_PERMITIDA',
      `No se puede finalizar una intervención en estado ${intervencion.estado}`
    );
  }

  if (!(transicion.permiso in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No posees permiso para finalizar intervenciones');
  }

  if (transicion.requiereActor) {
    await aplicarReglaActor(client, {
      intervencionId,
      intervencion,
      maquina,
      usuario,
      validaHabilitacion: transicion.validaHabilitacion,
    });
  }

  // Validaciones de datos
  const trabajoRealizado = typeof body.trabajo_realizado === 'string' ? body.trabajo_realizado.trim() : '';
  if (trabajoRealizado.length < 5) {
    throw new ErrorNegocio(
      422,
      'TRABAJO_REALIZADO_REQUERIDO',
      'El trabajo realizado es obligatorio y debe tener al menos 5 caracteres'
    );
  }

  if (body.ejecucion !== 'INTERNA' && body.ejecucion !== 'EXTERNA') {
    throw new ErrorNegocio(
      422,
      'EJECUCION_REQUERIDA',
      'Debe indicar si la ejecución fue INTERNA o EXTERNA'
    );
  }

  let fechaFinalizacion: string;
  if (body.fecha_finalizacion !== undefined && body.fecha_finalizacion !== null && String(body.fecha_finalizacion).trim() !== '') {
    fechaFinalizacion = await validarFechaISO(client, body.fecha_finalizacion, 'fecha_finalizacion');
  } else {
    const resNow = await client.query('SELECT NOW() AS ahora');
    fechaFinalizacion = new Date(resNow.rows[0].ahora).toISOString();
  }

  // Coherencia: fecha_inicio <= fecha_finalizacion <= NOW()
  const resCoherente = await client.query(
    `SELECT (
       $1::timestamptz >= $2::timestamptz
       AND $1::timestamptz <= NOW() + INTERVAL '10 seconds'
     ) AS coherente`,
    [fechaFinalizacion, intervencion.fecha_inicio]
  );
  if (!resCoherente.rows[0] || !resCoherente.rows[0].coherente) {
    throw new ErrorNegocio(
      422,
      'FECHA_INCOHERENTE',
      'La fecha de finalización debe ser mayor o igual a la de inicio y menor o igual al instante actual'
    );
  }

  // Decisión de recuperación (validación antes de mutar)
  const validacionRecup = await validarDecisionRecuperacion(client, {
    intervencionId,
    maquinaId: maquina.id,
    usuario,
    maquinaRecuperada: body.maquina_recuperada,
    fechaRecuperacion: body.fecha_recuperacion,
    fechaPorDefecto: fechaFinalizacion,
    observacionRecuperacion: body.observacion_recuperacion,
  });

  // Mutaciones:
  await registrarCambioEstado(client, {
    intervencionId,
    estadoActual: transicion.desde,
    estadoNuevo: transicion.hacia,
    usuarioId: usuario.id,
    observacion: typeof body.observacion === 'string' ? body.observacion.trim() : null,
    camposExtra: {
      fecha_finalizacion: fechaFinalizacion,
      trabajo_realizado: trabajoRealizado,
      ejecucion: body.ejecucion,
    },
    fechaEfectiva: fechaFinalizacion,
  });

  // 5.4 Auditoría de trabajo_realizado / ejecucion al volver a finalizar (tras reapertura)
  if (
    intervencion.trabajo_realizado !== null &&
    intervencion.trabajo_realizado !== undefined &&
    intervencion.trabajo_realizado !== trabajoRealizado
  ) {
    await registrarAuditoria(client, {
      intervencionId,
      tipoEvento: 'OTRO',
      campo: 'trabajo_realizado',
      valorAnterior: intervencion.trabajo_realizado,
      valorNuevo: trabajoRealizado,
      motivo: 'Nueva finalización tras reapertura',
      usuarioId: usuario.id,
    });
  }

  if (
    intervencion.ejecucion !== null &&
    intervencion.ejecucion !== undefined &&
    intervencion.ejecucion !== body.ejecucion
  ) {
    await registrarAuditoria(client, {
      intervencionId,
      tipoEvento: 'OTRO',
      campo: 'ejecucion',
      valorAnterior: intervencion.ejecucion,
      valorNuevo: String(body.ejecucion),
      motivo: 'Nueva finalización tras reapertura',
      usuarioId: usuario.id,
    });
  }

  const eventos: Array<{ tipo: string; payload: any }> = [
    { tipo: 'INTERVENCION_FINALIZADA', payload: { intervencionId } },
  ];

  const periodo = await aplicarDecisionRecuperacion(client, {
    intervencionId,
    maquinaId: maquina.id,
    usuarioId: usuario.id,
    validacion: validacionRecup,
    eventos,
  });

  const recalculo = await recalcularEstadoMaquina(client, maquina.id, {
    usuarioId: usuario.id,
    intervencionId,
    motivo: 'Intervención finalizada',
    confirmacion: validacionRecup.maquinaRecuperada === true,
  });

  if (recalculo.cambio) {
    eventos.push({
      tipo: 'MAQUINA_CAMBIO_ESTADO',
      payload: {
        maquinaId: maquina.id,
        estadoAnterior: recalculo.estadoAnterior,
        estadoNuevo: recalculo.estadoNuevo,
      },
    });
  }

  await registrarNotificaciones(client, eventos, { actorId: usuario.id });

  // Consultar intervención actualizada
  const resAct = await client.query(
    `SELECT i.id, i.estado, i.fecha_inicio, i.fecha_finalizacion, i.trabajo_realizado, i.ejecucion, i.tiempo_inactividad_minutos,
            u.id AS resp_id, u.legajo AS resp_legajo, u.nombre AS resp_nombre
     FROM intervenciones i
     LEFT JOIN usuarios u ON i.responsable_usuario_id = u.id
     WHERE i.id = $1`,
    [intervencionId]
  );
  const row = resAct.rows[0];

  return {
    intervencion: {
      id: Number(row.id),
      estado: row.estado,
      fecha_inicio: row.fecha_inicio,
      fecha_finalizacion: row.fecha_finalizacion,
      trabajo_realizado: row.trabajo_realizado,
      ejecucion: row.ejecucion,
      tiempo_inactividad_minutos: row.tiempo_inactividad_minutos != null ? Number(row.tiempo_inactividad_minutos) : null,
      responsable: row.resp_id
        ? { id: Number(row.resp_id), legajo: row.resp_legajo, nombre: row.resp_nombre }
        : null,
    },
    maquina: {
      id: Number(maquina.id),
      estado_anterior: recalculo.estadoAnterior,
      estado_nuevo: recalculo.estadoNuevo,
      cambio: recalculo.cambio,
    },
    periodo,
  };
}

/**
 * 6.2 POST /api/intervenciones/:id/resolver-ahora (T2)
 */
export async function resolverAhoraIntervencionServicio(
  client: pg.PoolClient,
  intervencionId: number,
  usuario: UsuarioVisibilidad,
  body: {
    estado_esperado: string;
    fecha_inicio?: unknown;
    fecha_finalizacion?: unknown;
    trabajo_realizado?: unknown;
    ejecucion?: unknown;
    observacion?: unknown;
    maquina_recuperada?: unknown;
    fecha_recuperacion?: unknown;
    observacion_recuperacion?: unknown;
  }
) {
  const transiciones = transicionesDeAccion('RESOLVER_AHORA');
  if (transiciones.length === 0) {
    throw new ErrorNegocio(409, 'TRANSICION_NO_PERMITIDA', 'Acción no permitida: RESOLVER_AHORA');
  }

  const permisoRequerido = transiciones[0].permiso;
  if (!(permisoRequerido in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No posees permiso para finalizar intervenciones');
  }

  const { intervencion, maquina } = await bloquearIntervencion(client, intervencionId, usuario);

  if (body.estado_esperado !== intervencion.estado) {
    throw new ErrorNegocio(409, 'ESTADO_DESACTUALIZADO', 'El estado de la intervención ha cambiado concurrentemente');
  }

  const transicion = transiciones.find((t) => t.desde === intervencion.estado);
  if (!transicion) {
    throw new ErrorNegocio(
      409,
      'TRANSICION_NO_PERMITIDA',
      `No se puede resolver inmediatamente una intervención en estado ${intervencion.estado}`
    );
  }

  if (!(transicion.permiso in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No posees permiso para finalizar intervenciones');
  }

  let responsableId = intervencion.responsable_usuario_id ? Number(intervencion.responsable_usuario_id) : null;
  if (transicion.requiereActor) {
    const resActor = await aplicarReglaActor(client, {
      intervencionId,
      intervencion,
      maquina,
      usuario,
      validaHabilitacion: transicion.validaHabilitacion,
      motivoAutoAsignacion: 'Asignación automática por resolución inmediata',
    });
    responsableId = resActor.responsableId;
  }

  // fecha_inicio es obligatoria
  if (body.fecha_inicio === undefined || body.fecha_inicio === null || String(body.fecha_inicio).trim() === '') {
    throw new ErrorNegocio(
      422,
      'DATOS_INVALIDOS',
      'La fecha_inicio es obligatoria para resolver inmediatamente'
    );
  }
  const fechaInicio = await validarFechaISO(client, body.fecha_inicio, 'fecha_inicio');

  let fechaFinalizacion: string;
  if (body.fecha_finalizacion !== undefined && body.fecha_finalizacion !== null && String(body.fecha_finalizacion).trim() !== '') {
    fechaFinalizacion = await validarFechaISO(client, body.fecha_finalizacion, 'fecha_finalizacion');
  } else {
    const resNow = await client.query('SELECT NOW() AS ahora');
    fechaFinalizacion = new Date(resNow.rows[0].ahora).toISOString();
  }

  // Coherencia: fecha_creacion <= fecha_inicio <= fecha_finalizacion <= NOW()
  const resCoherente = await client.query(
    `SELECT (
       $1::timestamptz >= fecha_creacion
       AND $2::timestamptz >= $1::timestamptz
       AND $2::timestamptz <= NOW() + INTERVAL '10 seconds'
     ) AS coherente
     FROM intervenciones WHERE id = $3`,
    [fechaInicio, fechaFinalizacion, intervencionId]
  );
  if (!resCoherente.rows[0] || !resCoherente.rows[0].coherente) {
    throw new ErrorNegocio(
      422,
      'FECHA_INCOHERENTE',
      'Las fechas deben cumplir: fecha_creacion <= fecha_inicio <= fecha_finalizacion <= fecha actual'
    );
  }

  // Validaciones de datos
  const trabajoRealizado = typeof body.trabajo_realizado === 'string' ? body.trabajo_realizado.trim() : '';
  if (trabajoRealizado.length < 5) {
    throw new ErrorNegocio(
      422,
      'TRABAJO_REALIZADO_REQUERIDO',
      'El trabajo realizado es obligatorio y debe tener al menos 5 caracteres'
    );
  }

  if (body.ejecucion !== 'INTERNA' && body.ejecucion !== 'EXTERNA') {
    throw new ErrorNegocio(
      422,
      'EJECUCION_REQUERIDA',
      'Debe indicar si la ejecución fue INTERNA o EXTERNA'
    );
  }

  // Decisión de recuperación (validación antes de mutar)
  const validacionRecup = await validarDecisionRecuperacion(client, {
    intervencionId,
    maquinaId: maquina.id,
    usuario,
    maquinaRecuperada: body.maquina_recuperada,
    fechaRecuperacion: body.fecha_recuperacion,
    fechaPorDefecto: fechaFinalizacion,
    observacionRecuperacion: body.observacion_recuperacion,
  });

  // EXACTAMENTE DOS FILAS EN HISTORIAL (D-30):
  // 1. PENDIENTE -> EN_PROCESO
  await registrarCambioEstado(client, {
    intervencionId,
    estadoActual: 'PENDIENTE',
    estadoNuevo: 'EN_PROCESO',
    usuarioId: usuario.id,
    observacion: 'Resolución inmediata',
    camposExtra: {
      fecha_inicio: fechaInicio,
    },
    fechaEfectiva: fechaInicio,
  });

  // 2. EN_PROCESO -> FINALIZADA (transicion.hacia)
  await registrarCambioEstado(client, {
    intervencionId,
    estadoActual: 'EN_PROCESO',
    estadoNuevo: transicion.hacia,
    usuarioId: usuario.id,
    observacion: typeof body.observacion === 'string' ? body.observacion.trim() : null,
    camposExtra: {
      fecha_finalizacion: fechaFinalizacion,
      trabajo_realizado: trabajoRealizado,
      ejecucion: body.ejecucion,
    },
    fechaEfectiva: fechaFinalizacion,
  });

  const eventos: Array<{ tipo: string; payload: any }> = [
    { tipo: 'INTERVENCION_INICIADA', payload: { intervencionId, responsableId } },
    { tipo: 'INTERVENCION_FINALIZADA', payload: { intervencionId } },
  ];

  const periodo = await aplicarDecisionRecuperacion(client, {
    intervencionId,
    maquinaId: maquina.id,
    usuarioId: usuario.id,
    validacion: validacionRecup,
    eventos,
  });

  // Recálculo de máquina UNA SOLA VEZ AL FINAL
  const recalculo = await recalcularEstadoMaquina(client, maquina.id, {
    usuarioId: usuario.id,
    intervencionId,
    motivo: 'Resolución inmediata',
    confirmacion: validacionRecup.maquinaRecuperada === true,
  });

  if (recalculo.cambio) {
    eventos.push({
      tipo: 'MAQUINA_CAMBIO_ESTADO',
      payload: {
        maquinaId: maquina.id,
        estadoAnterior: recalculo.estadoAnterior,
        estadoNuevo: recalculo.estadoNuevo,
      },
    });
  }

  await registrarNotificaciones(client, eventos, { actorId: usuario.id });

  // Consultar intervención actualizada
  const resAct = await client.query(
    `SELECT i.id, i.estado, i.fecha_inicio, i.fecha_finalizacion, i.trabajo_realizado, i.ejecucion, i.tiempo_inactividad_minutos,
            u.id AS resp_id, u.legajo AS resp_legajo, u.nombre AS resp_nombre
     FROM intervenciones i
     LEFT JOIN usuarios u ON i.responsable_usuario_id = u.id
     WHERE i.id = $1`,
    [intervencionId]
  );
  const row = resAct.rows[0];

  return {
    intervencion: {
      id: Number(row.id),
      estado: row.estado,
      fecha_inicio: row.fecha_inicio,
      fecha_finalizacion: row.fecha_finalizacion,
      trabajo_realizado: row.trabajo_realizado,
      ejecucion: row.ejecucion,
      tiempo_inactividad_minutos: row.tiempo_inactividad_minutos != null ? Number(row.tiempo_inactividad_minutos) : null,
      responsable: row.resp_id
        ? { id: Number(row.resp_id), legajo: row.resp_legajo, nombre: row.resp_nombre }
        : null,
    },
    maquina: {
      id: Number(maquina.id),
      estado_anterior: recalculo.estadoAnterior,
      estado_nuevo: recalculo.estadoNuevo,
      cambio: recalculo.cambio,
    },
    periodo,
  };
}

/**
 * 6.3 POST /api/intervenciones/:id/cancelar (T3, T7, T8)
 */
export async function cancelarIntervencionServicio(
  client: pg.PoolClient,
  intervencionId: number,
  usuario: UsuarioVisibilidad,
  body: {
    estado_esperado: string;
    motivo?: unknown;
    maquina_recuperada?: unknown;
    fecha_recuperacion?: unknown;
    observacion_recuperacion?: unknown;
  }
) {
  const transiciones = transicionesDeAccion('CANCELAR');
  if (transiciones.length === 0) {
    throw new ErrorNegocio(409, 'TRANSICION_NO_PERMITIDA', 'Acción no permitida: CANCELAR');
  }

  const permisoRequerido = transiciones[0].permiso;
  if (!(permisoRequerido in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No posees permiso para cancelar intervenciones');
  }

  const { intervencion, maquina } = await bloquearIntervencion(client, intervencionId, usuario);

  if (body.estado_esperado !== intervencion.estado) {
    throw new ErrorNegocio(409, 'ESTADO_DESACTUALIZADO', 'El estado de la intervención ha cambiado concurrentemente');
  }

  const transicion = transiciones.find((t) => t.desde === intervencion.estado);
  if (!transicion) {
    throw new ErrorNegocio(
      409,
      'TRANSICION_NO_PERMITIDA',
      `No se puede cancelar una intervención en estado ${intervencion.estado}`
    );
  }

  if (!(transicion.permiso in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No posees permiso para cancelar intervenciones');
  }

  if (transicion.requiereActor) {
    await aplicarReglaActor(client, {
      intervencionId,
      intervencion,
      maquina,
      usuario,
      validaHabilitacion: transicion.validaHabilitacion,
    });
  }

  // Motivo de cancelación obligatorio (min 5 caracteres)
  const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';
  if (motivo.length < 5) {
    throw new ErrorNegocio(422, 'MOTIVO_REQUERIDO', 'Debe indicar un motivo de cancelación de al menos 5 caracteres');
  }

  // Decisión de recuperación (validación antes de mutar)
  const resNow = await client.query('SELECT NOW() AS ahora');
  const nowISO = new Date(resNow.rows[0].ahora).toISOString();

  const validacionRecup = await validarDecisionRecuperacion(client, {
    intervencionId,
    maquinaId: maquina.id,
    usuario,
    maquinaRecuperada: body.maquina_recuperada,
    fechaRecuperacion: body.fecha_recuperacion,
    fechaPorDefecto: nowISO,
    observacionRecuperacion: body.observacion_recuperacion,
  });

  // Mutaciones:
  await registrarCambioEstado(client, {
    intervencionId,
    estadoActual: transicion.desde,
    estadoNuevo: transicion.hacia,
    usuarioId: usuario.id,
    observacion: motivo,
  });

  const eventos: Array<{ tipo: string; payload: any }> = [
    { tipo: 'INTERVENCION_CANCELADA', payload: { intervencionId, motivo } },
  ];

  const periodo = await aplicarDecisionRecuperacion(client, {
    intervencionId,
    maquinaId: maquina.id,
    usuarioId: usuario.id,
    validacion: validacionRecup,
    eventos,
  });

  const recalculo = await recalcularEstadoMaquina(client, maquina.id, {
    usuarioId: usuario.id,
    intervencionId,
    motivo: `Intervención cancelada: ${motivo}`,
    confirmacion: validacionRecup.maquinaRecuperada === true,
  });

  if (recalculo.cambio) {
    eventos.push({
      tipo: 'MAQUINA_CAMBIO_ESTADO',
      payload: {
        maquinaId: maquina.id,
        estadoAnterior: recalculo.estadoAnterior,
        estadoNuevo: recalculo.estadoNuevo,
      },
    });
  }

  await registrarNotificaciones(client, eventos, { actorId: usuario.id });

  // Consultar intervención actualizada
  const resAct = await client.query(
    `SELECT i.id, i.estado, i.fecha_inicio, i.fecha_finalizacion, i.trabajo_realizado, i.ejecucion, i.tiempo_inactividad_minutos,
            u.id AS resp_id, u.legajo AS resp_legajo, u.nombre AS resp_nombre
     FROM intervenciones i
     LEFT JOIN usuarios u ON i.responsable_usuario_id = u.id
     WHERE i.id = $1`,
    [intervencionId]
  );
  const row = resAct.rows[0];

  return {
    intervencion: {
      id: Number(row.id),
      estado: row.estado,
      fecha_inicio: row.fecha_inicio,
      fecha_finalizacion: row.fecha_finalizacion,
      trabajo_realizado: row.trabajo_realizado,
      ejecucion: row.ejecucion,
      tiempo_inactividad_minutos: row.tiempo_inactividad_minutos != null ? Number(row.tiempo_inactividad_minutos) : null,
      responsable: row.resp_id
        ? { id: Number(row.resp_id), legajo: row.resp_legajo, nombre: row.resp_nombre }
        : null,
    },
    maquina: {
      id: Number(maquina.id),
      estado_anterior: recalculo.estadoAnterior,
      estado_nuevo: recalculo.estadoNuevo,
      cambio: recalculo.cambio,
    },
    periodo,
  };
}

/**
 * 5. POST /api/intervenciones/:id/reabrir (T9)
 */
export async function reabrirIntervencionServicio(
  client: pg.PoolClient,
  intervencionId: number,
  usuario: UsuarioVisibilidad,
  body: {
    estado_esperado: string;
    motivo?: unknown;
    maquina_detenida?: unknown;
    desde?: unknown;
    observacion_detencion?: unknown;
  }
) {
  const transiciones = transicionesDeAccion('REABRIR');
  if (transiciones.length === 0) {
    throw new ErrorNegocio(409, 'TRANSICION_NO_PERMITIDA', 'Acción no permitida: REABRIR');
  }

  const permisoRequerido = transiciones[0].permiso;
  if (!(permisoRequerido in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No posees permiso para reabrir intervenciones');
  }

  const { intervencion, maquina } = await bloquearIntervencion(client, intervencionId, usuario);

  if (body.estado_esperado !== intervencion.estado) {
    throw new ErrorNegocio(409, 'ESTADO_DESACTUALIZADO', 'El estado de la intervención ha cambiado concurrentemente');
  }

  const transicion = transiciones.find((t) => t.desde === intervencion.estado);
  if (!transicion) {
    throw new ErrorNegocio(
      409,
      'TRANSICION_NO_PERMITIDA',
      `No se puede reabrir una intervención en estado ${intervencion.estado}`
    );
  }

  if (!(transicion.permiso in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No posees permiso para reabrir intervenciones');
  }

  const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';
  if (motivo.length < 5) {
    throw new ErrorNegocio(422, 'MOTIVO_REQUERIDO', 'El motivo de la reapertura es obligatorio y debe tener al menos 5 caracteres');
  }

  // 3. Período de detención (E9, ejemplo 4):
  const resPeriodoAbierto = await client.query(
    'SELECT id, desde FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL FOR UPDATE',
    [intervencionId]
  );

  let periodoVigente: any = null;
  let seAbrioPeriodo = false;

  if (resPeriodoAbierto.rows.length > 0) {
    // Si tiene período abierto (ej. E7): continúa sin cambios. maquina_detenida y desde se ignoran.
    const pRow = resPeriodoAbierto.rows[0];
    periodoVigente = {
      id: Number(pRow.id),
      cerrado: false,
      hasta: null,
    };
  } else {
    // Si no tiene período abierto: maquina_detenida es obligatorio (boolean)
    if (body.maquina_detenida === undefined || body.maquina_detenida === null || typeof body.maquina_detenida !== 'boolean') {
      throw new ErrorNegocio(422, 'DECISION_DETENCION_REQUERIDA', 'Debe indicar si la máquina volvió a detenerse (maquina_detenida)');
    }

    if (body.maquina_detenida === true) {
      let desdeISO: string;
      if (body.desde !== undefined && body.desde !== null && String(body.desde).trim() !== '') {
        desdeISO = await validarFechaISO(client, body.desde, 'desde');
      } else {
        const resNow = await client.query('SELECT NOW() AS ahora');
        desdeISO = new Date(resNow.rows[0].ahora).toISOString();
      }

      // Validar: desde >= fecha_creacion y desde <= NOW()
      const resCheckCreacion = await client.query(
        `SELECT (
           $1::timestamptz >= $2::timestamptz
           AND $1::timestamptz <= NOW() + INTERVAL '10 seconds'
         ) AS coherente`,
        [desdeISO, intervencion.fecha_creacion]
      );
      if (!resCheckCreacion.rows[0] || !resCheckCreacion.rows[0].coherente) {
        throw new ErrorNegocio(
          422,
          'FECHA_INCOHERENTE',
          'La fecha de la detención debe ser mayor o igual a la creación de la intervención y menor o igual al instante actual'
        );
      }

      // Validar: desde >= hasta del último período cerrado
      const resUltimo = await client.query(
        `SELECT hasta FROM intervencion_periodos_detencion
         WHERE intervencion_id = $1 AND hasta IS NOT NULL
         ORDER BY hasta DESC, id DESC LIMIT 1`,
        [intervencionId]
      );
      if (resUltimo.rows.length > 0) {
        const hastaUltimo = resUltimo.rows[0].hasta;
        const resCheckUltimo = await client.query(
          `SELECT ($1::timestamptz >= $2::timestamptz) AS coherente`,
          [desdeISO, hastaUltimo]
        );
        if (!resCheckUltimo.rows[0] || !resCheckUltimo.rows[0].coherente) {
          throw new ErrorNegocio(
            422,
            'FECHA_INCOHERENTE',
            'La fecha de la nueva detención debe ser mayor o igual a la finalización del último período cerrado'
          );
        }
      }

      const obsDetencion = typeof body.observacion_detencion === 'string' && body.observacion_detencion.trim() !== ''
        ? body.observacion_detencion.trim()
        : null;

      const resIns = await client.query(
        `INSERT INTO intervencion_periodos_detencion (
           intervencion_id, maquina_id, desde, abierto_por_usuario_id, observacion
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [intervencionId, maquina.id, desdeISO, usuario.id, obsDetencion]
      );
      seAbrioPeriodo = true;
      periodoVigente = {
        id: Number(resIns.rows[0].id),
        cerrado: false,
        hasta: null,
      };
    } else {
      periodoVigente = null;
    }
  }

  // 4. Mutaciones:
  await registrarCambioEstado(client, {
    intervencionId,
    estadoActual: transicion.desde,
    estadoNuevo: transicion.hacia,
    usuarioId: usuario.id,
    observacion: motivo,
    camposExtra: {
      fecha_finalizacion: null,
    },
  });

  // Auditoría REAPERTURA con fecha previa y valor nuevo NULL
  const fechaAnterior = intervencion.fecha_finalizacion
    ? new Date(intervencion.fecha_finalizacion).toISOString()
    : null;

  await registrarAuditoria(client, {
    intervencionId,
    tipoEvento: 'REAPERTURA',
    campo: 'fecha_finalizacion',
    valorAnterior: fechaAnterior,
    valorNuevo: null,
    motivo,
    usuarioId: usuario.id,
  });

  // 5. Recalcular máquina
  const recalculo = await recalcularEstadoMaquina(client, maquina.id, {
    usuarioId: usuario.id,
    intervencionId,
    motivo: `Reapertura de intervención: ${motivo}`,
    confirmacion: false,
  });

  // 6. Eventos
  const eventos: Array<{ tipo: string; payload: any }> = [
    { tipo: 'INTERVENCION_REABIERTA', payload: { intervencionId, motivo } },
  ];

  if (seAbrioPeriodo) {
    eventos.push({
      tipo: 'DETENCION_REGISTRADA',
      payload: { intervencionId, maquinaId: maquina.id, periodoId: periodoVigente.id },
    });
  }

  if (recalculo.cambio) {
    eventos.push({
      tipo: 'MAQUINA_CAMBIO_ESTADO',
      payload: {
        maquinaId: maquina.id,
        estadoAnterior: recalculo.estadoAnterior,
        estadoNuevo: recalculo.estadoNuevo,
      },
    });
  }

  await registrarNotificaciones(client, eventos, { actorId: usuario.id });

  // Consultar intervención actualizada
  const resAct = await client.query(
    `SELECT i.id, i.estado, i.fecha_inicio, i.fecha_finalizacion, i.trabajo_realizado, i.ejecucion, i.tiempo_inactividad_minutos,
            u.id AS resp_id, u.legajo AS resp_legajo, u.nombre AS resp_nombre
     FROM intervenciones i
     LEFT JOIN usuarios u ON i.responsable_usuario_id = u.id
     WHERE i.id = $1`,
    [intervencionId]
  );
  const row = resAct.rows[0];

  return {
    intervencion: {
      id: Number(row.id),
      estado: row.estado,
      fecha_inicio: row.fecha_inicio,
      fecha_finalizacion: row.fecha_finalizacion,
      trabajo_realizado: row.trabajo_realizado,
      ejecucion: row.ejecucion,
      tiempo_inactividad_minutos: row.tiempo_inactividad_minutos != null ? Number(row.tiempo_inactividad_minutos) : null,
      responsable: row.resp_id
        ? { id: Number(row.resp_id), legajo: row.resp_legajo, nombre: row.resp_nombre }
        : null,
    },
    maquina: {
      id: Number(maquina.id),
      estado_anterior: recalculo.estadoAnterior,
      estado_nuevo: recalculo.estadoNuevo,
      cambio: recalculo.cambio,
    },
    periodo: periodoVigente,
  };
}

/**
 * 6. POST /api/intervenciones/:id/eliminar (Eliminación lógica)
 */
export async function eliminarIntervencionServicio(
  client: pg.PoolClient,
  intervencionId: number,
  usuario: UsuarioVisibilidad,
  body: {
    motivo?: unknown;
    maquina_recuperada?: unknown;
    observacion_recuperacion?: unknown;
  }
) {
  if (!('INTERVENCIONES_ELIMINAR' in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No posees permiso para eliminar intervenciones');
  }

  const { intervencion, maquina } = await bloquearIntervencion(client, intervencionId, usuario);

  const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';
  if (motivo.length < 5) {
    throw new ErrorNegocio(422, 'MOTIVO_REQUERIDO', 'El motivo de la eliminación es obligatorio y debe tener al menos 5 caracteres');
  }

  // 3. Evaluar condiciones de actividad relevante
  const motivosBloqueo: string[] = [];

  if (intervencion.estado !== 'PENDIENTE') {
    motivosBloqueo.push('ESTADO_NO_PENDIENTE');
  }

  if (intervencion.fecha_inicio !== null && intervencion.fecha_inicio !== undefined) {
    motivosBloqueo.push('TIENE_FECHA_INICIO');
  }

  const resCostos = await client.query('SELECT 1 FROM intervencion_costos WHERE intervencion_id = $1 LIMIT 1', [intervencionId]);
  if (resCostos.rows.length > 0) {
    motivosBloqueo.push('TIENE_COSTOS');
  }

  const resRepuestos = await client.query('SELECT 1 FROM intervencion_repuestos WHERE intervencion_id = $1 LIMIT 1', [intervencionId]);
  if (resRepuestos.rows.length > 0) {
    motivosBloqueo.push('TIENE_REPUESTOS');
  }

  const resMovStock = await client.query('SELECT 1 FROM movimientos_stock WHERE intervencion_id = $1 LIMIT 1', [intervencionId]);
  if (resMovStock.rows.length > 0) {
    motivosBloqueo.push('TIENE_MOVIMIENTOS_STOCK');
  }

  const resDocs = await client.query('SELECT 1 FROM documentos WHERE intervencion_id = $1 LIMIT 1', [intervencionId]);
  if (resDocs.rows.length > 0) {
    motivosBloqueo.push('TIENE_DOCUMENTOS');
  }

  const resHist = await client.query('SELECT COUNT(*) AS total FROM historial_estados_intervencion WHERE intervencion_id = $1', [intervencionId]);
  const totalHist = Number(resHist.rows[0]?.total || 0);
  if (totalHist > 1) {
    motivosBloqueo.push('TIENE_HISTORIAL');
  } else if (totalHist === 1) {
    const resSingleHist = await client.query(
      'SELECT estado_anterior, estado_nuevo FROM historial_estados_intervencion WHERE intervencion_id = $1',
      [intervencionId]
    );
    const single = resSingleHist.rows[0];
    if (single.estado_anterior !== null || single.estado_nuevo !== 'PENDIENTE') {
      motivosBloqueo.push('TIENE_HISTORIAL');
    }
  }

  if (motivosBloqueo.length > 0) {
    throw new ErrorNegocio(
      409,
      'ELIMINACION_NO_PERMITIDA',
      'No se puede eliminar la intervención porque registra actividad previa',
      { motivos: motivosBloqueo }
    );
  }

  // 4. Período abierto (D-34)
  const resPeriodoAbierto = await client.query(
    'SELECT id FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL FOR UPDATE',
    [intervencionId]
  );

  let confirmacionRecalculo = false;
  const eventos: Array<{ tipo: string; payload: any }> = [];

  if (resPeriodoAbierto.rows.length > 0) {
    if (body.maquina_recuperada === undefined || body.maquina_recuperada === null || typeof body.maquina_recuperada !== 'boolean') {
      throw new ErrorNegocio(422, 'DECISION_RECUPERACION_REQUERIDA', 'Debe indicar la decisión sobre la recuperación de la máquina (maquina_recuperada)');
    }

    if (body.maquina_recuperada === true) {
      if (!('INTERVENCIONES_CONFIRMAR_RECUPERACION' in usuario.permisos)) {
        throw new ErrorNegocio(403, 'CONFIRMACION_NO_PERMITIDA', 'No posees permiso para confirmar la recuperación de la máquina');
      }
      confirmacionRecalculo = true;
    }

    const obsConf = typeof body.observacion_recuperacion === 'string' && body.observacion_recuperacion.trim() !== ''
      ? `Cerrado por eliminación lógica - ${body.observacion_recuperacion.trim()}`
      : 'Cerrado por eliminación lógica';

    const periodoId = resPeriodoAbierto.rows[0].id;

    await client.query(
      `UPDATE intervencion_periodos_detencion
       SET hasta = NOW(),
           confirmado_por_usuario_id = $1,
           observacion_confirmacion = $2
       WHERE id = $3`,
      [usuario.id, obsConf, periodoId]
    );

    // Recalcular tiempo_inactividad_minutos
    await client.query(
      `UPDATE intervenciones
       SET tiempo_inactividad_minutos = (
         SELECT ROUND(EXTRACT(EPOCH FROM SUM(hasta - desde)) / 60)
         FROM intervencion_periodos_detencion
         WHERE intervencion_id = $1 AND hasta IS NOT NULL
       )
       WHERE id = $1`,
      [intervencionId]
    );

    const recalculo = await recalcularEstadoMaquina(client, maquina.id, {
      usuarioId: usuario.id,
      intervencionId,
      motivo: 'Eliminación lógica de intervención',
      confirmacion: confirmacionRecalculo,
    });

    if (recalculo.cambio) {
      eventos.push({
        tipo: 'MAQUINA_CAMBIO_ESTADO',
        payload: {
          maquinaId: maquina.id,
          estadoAnterior: recalculo.estadoAnterior,
          estadoNuevo: recalculo.estadoNuevo,
        },
      });
    }
  }

  // 5. Mutaciones
  await client.query(
    `UPDATE intervenciones
     SET eliminado_en = NOW(),
         eliminado_por_usuario_id = $1,
         motivo_eliminacion = $2,
         actualizado_en = NOW()
     WHERE id = $3`,
    [usuario.id, motivo, intervencionId]
  );

  // Auditoría ELIMINACION_LOGICA
  await registrarAuditoria(client, {
    intervencionId,
    tipoEvento: 'ELIMINACION_LOGICA',
    campo: 'eliminado_en',
    valorAnterior: null,
    valorNuevo: new Date().toISOString(),
    motivo,
    usuarioId: usuario.id,
  });

  // 6. Eventos
  eventos.push({
    tipo: 'INTERVENCION_ELIMINADA',
    payload: { intervencionId, maquinaId: maquina.id },
  });

  await registrarNotificaciones(client, eventos, { actorId: usuario.id });

  return {
    ok: true,
    eliminada: true,
    intervencion_id: intervencionId,
  };
}

/**
 * 7. PATCH /api/intervenciones/:id (Edición)
 */
export async function editarIntervencionServicio(
  client: pg.PoolClient,
  intervencionId: number,
  usuario: UsuarioVisibilidad,
  body: Record<string, any>
) {
  if (!('INTERVENCIONES_EDITAR' in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No posees permiso para editar intervenciones');
  }

  const { intervencion, maquina } = await bloquearIntervencion(client, intervencionId, usuario);

  if (!body.estado_esperado || typeof body.estado_esperado !== 'string') {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo estado_esperado es obligatorio');
  }

  if (body.estado_esperado !== intervencion.estado) {
    throw new ErrorNegocio(409, 'ESTADO_DESACTUALIZADO', 'El estado de la intervención ha cambiado concurrentemente');
  }

  // 2. Estados editables
  const estadosEditables = ['PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS'];
  if (!estadosEditables.includes(intervencion.estado)) {
    throw new ErrorNegocio(409, 'EDICION_NO_PERMITIDA', `No se permite la edición de intervenciones en estado ${intervencion.estado}`);
  }

  // 3. Alcance de INTERVENCIONES_EDITAR
  const alcanceEditar = usuario.permisos['INTERVENCIONES_EDITAR'];
  if (alcanceEditar === 'PROPIAS') {
    const esPropia = Number(intervencion.creado_por_usuario_id) === usuario.id;
    const esPendiente = intervencion.estado === 'PENDIENTE';
    const sinResponsable = intervencion.responsable_usuario_id === null;

    if (!esPropia || !esPendiente || !sinResponsable) {
      throw new ErrorNegocio(
        403,
        'EDICION_NO_PERMITIDA',
        'Con alcance PROPIAS solo puedes editar intervenciones creadas por ti, en estado PENDIENTE y sin responsable asignado'
      );
    }
  } else if (alcanceEditar === 'SECTORES') {
    if (!usuario.sectores.includes(Number(maquina.sector_id))) {
      throw new ErrorNegocio(403, 'EDICION_NO_PERMITIDA', 'No tienes alcance sobre el sector de la máquina asociada');
    }
  }

  // 4. Campos aceptados: solo descripcion y observaciones (además de estado_esperado)
  for (const key of Object.keys(body)) {
    if (!['estado_esperado', 'descripcion', 'observaciones'].includes(key)) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `Campo no permitido para edición: ${key}`);
    }
  }

  if (body.descripcion === undefined && body.observaciones === undefined) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Debe especificar al menos descripción u observaciones');
  }

  let nuevaDescripcion = intervencion.descripcion;
  let nuevoObservaciones = intervencion.observaciones;
  let cambioDescripcion = false;
  let cambioObservaciones = false;

  // 5. Validaciones
  if (body.descripcion !== undefined) {
    if (typeof body.descripcion !== 'string') {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La descripción debe ser una cadena de texto');
    }
    const descTrim = body.descripcion.trim();
    if (descTrim.length < 5 || descTrim.length > 2000) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La descripción debe tener entre 5 y 2000 caracteres');
    }
    if (descTrim !== intervencion.descripcion) {
      nuevaDescripcion = descTrim;
      cambioDescripcion = true;
    }
  }

  if (body.observaciones !== undefined) {
    let obsVal: string | null = null;
    if (body.observaciones !== null) {
      if (typeof body.observaciones !== 'string') {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Las observaciones deben ser una cadena de texto o null');
      }
      const obsTrim = body.observaciones.trim();
      if (obsTrim.length > 2000) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Las observaciones no pueden superar los 2000 caracteres');
      }
      obsVal = obsTrim.length > 0 ? obsTrim : null;
    }
    if (obsVal !== intervencion.observaciones) {
      nuevoObservaciones = obsVal;
      cambioObservaciones = true;
    }
  }

  // 6. Sin cambios
  if (!cambioDescripcion && !cambioObservaciones) {
    throw new ErrorNegocio(422, 'SIN_CAMBIOS', 'Los valores enviados no presentan cambios respecto de los actuales');
  }

  // 8. Mutación en base de datos
  await client.query(
    `UPDATE intervenciones
     SET descripcion = $1,
         observaciones = $2,
         actualizado_en = NOW()
     WHERE id = $3`,
    [nuevaDescripcion, nuevoObservaciones, intervencionId]
  );

  // 7. Auditoría EDICION por campo modificado
  if (cambioDescripcion) {
    await registrarAuditoria(client, {
      intervencionId,
      tipoEvento: 'EDICION',
      campo: 'descripcion',
      valorAnterior: intervencion.descripcion,
      valorNuevo: nuevaDescripcion,
      motivo: 'Edición de datos de intervención',
      usuarioId: usuario.id,
    });
  }

  if (cambioObservaciones) {
    await registrarAuditoria(client, {
      intervencionId,
      tipoEvento: 'EDICION',
      campo: 'observaciones',
      valorAnterior: intervencion.observaciones,
      valorNuevo: nuevoObservaciones,
      motivo: 'Edición de datos de intervención',
      usuarioId: usuario.id,
    });
  }

  const resAct = await client.query(
    `SELECT i.id, i.descripcion, i.observaciones, i.estado, i.actualizado_en
     FROM intervenciones i
     WHERE i.id = $1`,
    [intervencionId]
  );
  const row = resAct.rows[0];

  return {
    id: Number(row.id),
    descripcion: row.descripcion,
    observaciones: row.observaciones,
    estado: row.estado,
    actualizado_en: row.actualizado_en,
  };
}
