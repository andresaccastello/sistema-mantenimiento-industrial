import pg from 'pg';
import { ErrorNegocio } from './errores.ts';
import { resolverPermisosEfectivos } from './permisos.ts';
import { UsuarioVisibilidad } from './visibilidad.ts';
import { bloquearIntervencion } from './bloqueos.ts';
import { recalcularEstadoMaquina } from './recalculoMaquina.ts';
import { registrarCambioEstado } from './cambioEstado.ts';
import { registrarAuditoria, registrarNotificaciones } from './auditoria.ts';
import { AccionTransicion, buscarTransicion, buscarTransicionPorAccion } from './transiciones.ts';

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
  ]);

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
      payload: { intervencionId, responsableId: destinatarioId },
    },
  ]);

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
    { tipo: 'INTERVENCION_DESASIGNADA', payload: { intervencionId, responsableAnteriorId: responsableActual } },
  ]);

  return { ok: true };
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
  // 1. Obtener la definición de la transición por acción
  const transicion = buscarTransicionPorAccion(accion);
  if (!transicion) {
    throw new ErrorNegocio(
      409,
      'TRANSICION_NO_PERMITIDA',
      `Acción de transición desconocida: ${accion}`
    );
  }

  // 2. Validar permiso tomado directamente de transicion.permiso
  if (!(transicion.permiso in usuario.permisos)) {
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

  // 4. Validar que la acción admite el estado actual
  if (intervencion.estado !== transicion.desde) {
    throw new ErrorNegocio(
      409,
      'TRANSICION_NO_PERMITIDA',
      `La acción ${accion} no está permitida desde el estado ${intervencion.estado}`
    );
  }

  const responsableId = intervencion.responsable_usuario_id
    ? Number(intervencion.responsable_usuario_id)
    : null;

  const camposExtra: Record<string, any> = {};
  const eventos: Array<{ tipo: string; payload: any }> = [];

  // =========================================================
  // REGLAS ESPECÍFICAS SEGÚN LA TRANSICIÓN
  // =========================================================

  if (accion === 'INICIAR') {
    // T1: PENDIENTE -> EN_PROCESO
    let nuevoResponsableId = responsableId;

    if (responsableId === null) {
      // Caso sin responsable: si el usuario tiene INTERVENCIONES_ASIGNARSE y es habilitado, se asigna
      const tieneAsignarse = 'INTERVENCIONES_ASIGNARSE' in usuario.permisos;
      if (!tieneAsignarse) {
        throw new ErrorNegocio(
          422,
          'RESPONSABLE_REQUERIDO',
          'La intervención no tiene responsable asignado y no posees permiso para asignártela'
        );
      }

      await validarResponsableHabilitado(client, usuario.id, maquina.sector_id);
      nuevoResponsableId = usuario.id;
      camposExtra.responsable_usuario_id = usuario.id;

      await registrarAuditoria(client, {
        intervencionId,
        tipoEvento: 'ASIGNACION',
        campo: 'responsable_usuario_id',
        valorAnterior: null,
        valorNuevo: String(usuario.id),
        motivo: 'Asignación automática al iniciar trabajo',
        usuarioId: usuario.id,
      });

      eventos.push({ tipo: 'INTERVENCION_ASIGNADA', payload: { intervencionId, responsableId: usuario.id } });
    } else {
      // Responsable ya asignado: aplicar regla de actor (D-23)
      const esResponsable = responsableId === usuario.id;
      const tieneAsignar = 'INTERVENCIONES_ASIGNAR' in usuario.permisos;

      if (!esResponsable && !tieneAsignar) {
        throw new ErrorNegocio(
          403,
          'NO_ES_RESPONSABLE',
          'Solo el responsable asignado o un usuario con permiso de asignación puede iniciar este trabajo'
        );
      }

      // El responsable asignado debe seguir habilitado
      await validarResponsableHabilitado(client, responsableId, maquina.sector_id);
    }

    // fecha_inicio: validar formato y coherencia si viene en el body
    if (params.fechaInicio !== undefined && params.fechaInicio !== null) {
      // Validar formato ISO 8601 con zona horaria explícita (Z o ±hh:mm / ±hhmm)
      const ISO_TZ_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
      if (
        typeof params.fechaInicio !== 'string' ||
        !ISO_TZ_REGEX.test(params.fechaInicio) ||
        isNaN(Date.parse(params.fechaInicio))
      ) {
        throw new ErrorNegocio(
          422,
          'DATOS_INVALIDOS',
          'La fecha_inicio debe tener formato ISO 8601 con zona horaria explícita (Z o ±hh:mm)'
        );
      }

      const resValida = await client.query(
        `SELECT (
           $1::timestamptz >= fecha_creacion 
           AND $1::timestamptz <= NOW()
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
        const resNow = await client.query('SELECT NOW() AS ahora');
        camposExtra.fecha_inicio = resNow.rows[0].ahora;
      }
    }

    eventos.push({ tipo: 'INTERVENCION_INICIADA', payload: { intervencionId, responsableId: nuevoResponsableId } });

  } else if (accion === 'ESPERAR_REPUESTOS') {
    // T4: EN_PROCESO -> EN_ESPERA_REPUESTOS
    const esResponsable = responsableId === usuario.id;
    const tieneAsignar = 'INTERVENCIONES_ASIGNAR' in usuario.permisos;

    if (!esResponsable && !tieneAsignar) {
      throw new ErrorNegocio(
        403,
        'NO_ES_RESPONSABLE',
        'Solo el responsable asignado o un supervisor con permiso de asignación puede pasar a espera de repuestos'
      );
    }

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
    // T5: EN_ESPERA_REPUESTOS -> EN_PROCESO
    const esResponsable = responsableId === usuario.id;
    const tieneAsignar = 'INTERVENCIONES_ASIGNAR' in usuario.permisos;

    if (!esResponsable && !tieneAsignar) {
      throw new ErrorNegocio(
        403,
        'NO_ES_RESPONSABLE',
        'Solo el responsable asignado o un supervisor con permiso de asignación puede reanudar el trabajo'
      );
    }

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
  await registrarNotificaciones(client, eventos);

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
      estado_nuevo: recalculo.estadoNuevo,
      cambio: recalculo.cambio,
    },
  };
}
