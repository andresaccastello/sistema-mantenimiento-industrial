import pg from 'pg';
import { ErrorNegocio } from './errores.ts';
import { UsuarioVisibilidad, puedeVerIntervencion } from './visibilidad.ts';
import { validarFechaISO } from './fechas.ts';
import { recalcularEstadoMaquina } from './recalculoMaquina.ts';
import { registrarNotificaciones } from './auditoria.ts';
import { bloquearIntervencion } from './bloqueos.ts';

/**
 * 7.1 GET /api/maquinas/:id/detenciones-abiertas
 */
export async function obtenerDetencionesAbiertasMaquina(
  client: pg.PoolClient | pg.Pool,
  maquinaId: number,
  usuario: UsuarioVisibilidad
) {
  if (!('INTERVENCIONES_VER' in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tienes permiso para ver intervenciones');
  }

  // Verificar que la máquina exista
  const resM = await client.query('SELECT id, sector_id FROM maquinas WHERE id = $1', [maquinaId]);
  if (resM.rows.length === 0) {
    throw new ErrorNegocio(404, 'MAQUINA_NO_ENCONTRADA', 'Máquina no encontrada');
  }

  // Traer períodos abiertos con datos de intervención y usuarios
  const res = await client.query(
    `SELECT 
       pd.id AS periodo_id,
       pd.desde AS periodo_desde,
       pd.observacion AS periodo_observacion,
       pd.abierto_por_usuario_id,
       u_abierto.nombre AS abierto_por_nombre,
       i.id AS intervencion_id,
       i.descripcion AS intervencion_descripcion,
       i.estado AS intervencion_estado,
       i.creado_por_usuario_id,
       i.responsable_usuario_id,
       u_resp.nombre AS responsable_nombre,
       m.sector_id
     FROM intervencion_periodos_detencion pd
     JOIN intervenciones i ON pd.intervencion_id = i.id
     JOIN maquinas m ON pd.maquina_id = m.id
     LEFT JOIN usuarios u_abierto ON pd.abierto_por_usuario_id = u_abierto.id
     LEFT JOIN usuarios u_resp ON i.responsable_usuario_id = u_resp.id
     WHERE pd.maquina_id = $1
       AND pd.hasta IS NULL
       AND i.eliminado_en IS NULL
     ORDER BY pd.desde ASC`,
    [maquinaId]
  );

  // Filtrar según visibilidad del usuario (PROPIAS, SECTORES, TODAS)
  const visibles = res.rows.filter((row) => {
    const intervencion = {
      creado_por_usuario_id: Number(row.creado_por_usuario_id),
      responsable_usuario_id: row.responsable_usuario_id ? Number(row.responsable_usuario_id) : null,
      sector_id: Number(row.sector_id),
    };
    return puedeVerIntervencion(usuario, intervencion);
  });

  return visibles.map((row) => ({
    periodo: {
      id: Number(row.periodo_id),
      desde: row.periodo_desde,
      observacion: row.periodo_observacion,
      abierto_por_usuario_id: row.abierto_por_usuario_id ? Number(row.abierto_por_usuario_id) : null,
      abierto_por_nombre: row.abierto_por_nombre || null,
    },
    intervencion: {
      id: Number(row.intervencion_id),
      descripcion: row.intervencion_descripcion,
      estado: row.intervencion_estado,
      responsable_usuario_id: row.responsable_usuario_id ? Number(row.responsable_usuario_id) : null,
      responsable_nombre: row.responsable_nombre || null,
    },
  }));
}

/**
 * 7.2 POST /api/maquinas/:id/confirmar-recuperacion
 */
export async function confirmarRecuperacionMaquina(
  client: pg.PoolClient,
  maquinaId: number,
  usuario: UsuarioVisibilidad,
  body: {
    periodo_ids?: unknown;
    fecha_recuperacion?: unknown;
    observacion?: unknown;
  }
) {
  if (!('INTERVENCIONES_CONFIRMAR_RECUPERACION' in usuario.permisos)) {
    throw new ErrorNegocio(
      403,
      'PERMISO_INSUFICIENTE',
      'No posees permiso para confirmar la recuperación de la máquina'
    );
  }

  const periodoIdsRaw = body.periodo_ids;
  if (!Array.isArray(periodoIdsRaw) || periodoIdsRaw.length === 0) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Debe proporcionar una lista no vacía de periodo_ids');
  }

  // Verificar que todos sean números y sin repetidos
  const periodoIds: number[] = [];
  const setIds = new Set<number>();
  for (const item of periodoIdsRaw) {
    const num = Number(item);
    if (isNaN(num) || num <= 0 || setIds.has(num)) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'La lista de periodo_ids contiene valores inválidos o repetidos');
    }
    setIds.add(num);
    periodoIds.push(num);
  }

  // 1. Bloqueo de máquina FOR UPDATE
  const resM = await client.query('SELECT id, estado, sector_id FROM maquinas WHERE id = $1 FOR UPDATE', [maquinaId]);
  if (resM.rows.length === 0) {
    throw new ErrorNegocio(404, 'MAQUINA_NO_ENCONTRADA', 'Máquina no encontrada');
  }
  const maquina = resM.rows[0];

  // 2. Bloqueo de períodos FOR UPDATE (filtrado por maquina_id para no bloquear períodos ajenos)
  const resP = await client.query(
    `SELECT pd.id, pd.intervencion_id, pd.maquina_id, pd.desde, pd.hasta
     FROM intervencion_periodos_detencion pd
     WHERE pd.id = ANY($1) AND pd.maquina_id = $2
     FOR UPDATE`,
    [periodoIds, maquinaId]
  );
  const periodosEncontrados = new Map<number, any>(resP.rows.map((p) => [Number(p.id), p]));

  // 3. Bloqueo de intervenciones FOR UPDATE en orden ascendente
  const intervencionIds = Array.from(new Set(resP.rows.map((p) => Number(p.intervencion_id)))).sort((a, b) => a - b);
  let intervencionesMap = new Map<number, any>();
  if (intervencionIds.length > 0) {
    const resI = await client.query(
      `SELECT id, maquina_id, estado, creado_por_usuario_id, responsable_usuario_id, eliminado_en
       FROM intervenciones
       WHERE id = ANY($1)
       ORDER BY id ASC
       FOR UPDATE`,
      [intervencionIds]
    );
    intervencionesMap = new Map(resI.rows.map((i) => [Number(i.id), i]));
  }

  // Validación todo o nada
  const rechazados: number[] = [];
  for (const pid of periodoIds) {
    const p = periodosEncontrados.get(pid);
    if (!p) {
      rechazados.push(pid);
      continue;
    }
    if (Number(p.maquina_id) !== maquinaId) {
      rechazados.push(pid);
      continue;
    }
    if (p.hasta !== null) {
      rechazados.push(pid);
      continue;
    }
    const intervencion = intervencionesMap.get(Number(p.intervencion_id));
    if (!intervencion || intervencion.eliminado_en !== null) {
      rechazados.push(pid);
      continue;
    }
    // Visibilidad del usuario
    const visible = puedeVerIntervencion(usuario, {
      creado_por_usuario_id: Number(intervencion.creado_por_usuario_id),
      responsable_usuario_id: intervencion.responsable_usuario_id ? Number(intervencion.responsable_usuario_id) : null,
      sector_id: Number(maquina.sector_id),
    });
    if (!visible) {
      rechazados.push(pid);
      continue;
    }
  }

  if (rechazados.length > 0) {
    throw new ErrorNegocio(
      422,
      'PERIODO_INVALIDO',
      `Período(s) inválido(s) para recuperación: ${rechazados.join(', ')}`
    );
  }

  // Validar fecha_recuperacion
  let fechaRecuperacion: string;
  if (body.fecha_recuperacion !== undefined && body.fecha_recuperacion !== null && String(body.fecha_recuperacion).trim() !== '') {
    fechaRecuperacion = await validarFechaISO(client, body.fecha_recuperacion, 'fecha_recuperacion');
  } else {
    const resNow = await client.query('SELECT NOW() AS ahora');
    fechaRecuperacion = new Date(resNow.rows[0].ahora).toISOString();
  }

  // Validar coherencia temporal para cada período: desde <= hasta <= NOW()
  const resFutura = await client.query(
    `SELECT ($1::timestamptz > NOW() + INTERVAL '10 seconds') AS es_futura`,
    [fechaRecuperacion]
  );
  if (resFutura.rows[0]?.es_futura) {
    throw new ErrorNegocio(422, 'FECHA_INCOHERENTE', 'La fecha de recuperación no puede ser futura');
  }

  for (const pid of periodoIds) {
    const p = periodosEncontrados.get(pid)!;
    const resCheck = await client.query(
      `SELECT ($1::timestamptz >= $2::timestamptz) AS coherente`,
      [fechaRecuperacion, p.desde]
    );
    if (!resCheck.rows[0] || !resCheck.rows[0].coherente) {
      throw new ErrorNegocio(
        422,
        'FECHA_INCOHERENTE',
        'La fecha de recuperación debe ser mayor o igual a la de apertura'
      );
    }
  }

  const observacionConf = typeof body.observacion === 'string' ? body.observacion.trim() : null;

  // Cierre de cada período
  for (const pid of periodoIds) {
    await client.query(
      `UPDATE intervencion_periodos_detencion
       SET hasta = $1,
           confirmado_por_usuario_id = $2,
           observacion_confirmacion = $3
       WHERE id = $4`,
      [fechaRecuperacion, usuario.id, observacionConf, pid]
    );
  }

  // Recalcular tiempo_inactividad_minutos de cada intervención afectada
  for (const intId of intervencionIds) {
    await client.query(
      `UPDATE intervenciones
       SET tiempo_inactividad_minutos = (
         SELECT ROUND(EXTRACT(EPOCH FROM SUM(hasta - desde)) / 60)
         FROM intervencion_periodos_detencion
         WHERE intervencion_id = $1 AND hasta IS NOT NULL
       )
       WHERE id = $1`,
      [intId]
    );
  }

  // Recálculo de máquina con confirmacion = true
  const intervencionOrigen = intervencionIds.length === 1 ? intervencionIds[0] : null;
  const motivoHistorial = intervencionIds.length === 1
    ? (observacionConf || 'Recuperación de máquina confirmada')
    : `Recuperación de máquina confirmada (períodos: ${periodoIds.join(', ')})`;

  const recalculo = await recalcularEstadoMaquina(client, maquinaId, {
    usuarioId: usuario.id,
    intervencionId: intervencionOrigen,
    motivo: motivoHistorial,
    confirmacion: true,
  });

  const eventos: Array<{ tipo: string; payload: any }> = [
    {
      tipo: 'RECUPERACION_CONFIRMADA',
      payload: { maquinaId, periodoIds, intervencionIds },
    },
  ];

  if (recalculo.cambio) {
    eventos.push({
      tipo: 'MAQUINA_CAMBIO_ESTADO',
      payload: {
        maquinaId,
        estadoAnterior: recalculo.estadoAnterior,
        estadoNuevo: recalculo.estadoNuevo,
      },
    });
  }

  await registrarNotificaciones(client, eventos, { actorId: usuario.id });

  return {
    ok: true,
    periodos_cerrados: periodoIds,
    maquina_estado: recalculo.estadoNuevo,
  };
}

/**
 * 7.3 POST /api/maquinas/:id/estado (cambio manual)
 */
export async function cambiarEstadoManualMaquina(
  client: pg.PoolClient,
  maquinaId: number,
  usuario: UsuarioVisibilidad,
  body: {
    accion?: unknown;
    motivo?: unknown;
  }
) {
  if (!('MAQUINAS_CAMBIAR_ESTADO' in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No posees permiso para cambiar manualmente el estado de la máquina');
  }

  const accion = body.accion;
  if (accion !== 'FUERA_DE_SERVICIO' && accion !== 'REACTIVAR') {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Acción inválida. Debe ser FUERA_DE_SERVICIO o REACTIVAR');
  }

  const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';
  if (motivo.length < 5) {
    throw new ErrorNegocio(422, 'MOTIVO_REQUERIDO', 'Debe indicar un motivo de al menos 5 caracteres');
  }

  // Bloqueo de máquina FOR UPDATE
  const resM = await client.query('SELECT id, estado FROM maquinas WHERE id = $1 FOR UPDATE', [maquinaId]);
  if (resM.rows.length === 0) {
    throw new ErrorNegocio(404, 'MAQUINA_NO_ENCONTRADA', 'Máquina no encontrada');
  }
  const maquina = resM.rows[0];

  const eventos: Array<{ tipo: string; payload: any }> = [];

  if (accion === 'FUERA_DE_SERVICIO') {
    if (maquina.estado === 'FUERA_DE_SERVICIO') {
      throw new ErrorNegocio(422, 'SIN_CAMBIOS', 'La máquina ya se encuentra fuera de servicio');
    }

    await client.query('UPDATE maquinas SET estado = $1, actualizado_en = NOW() WHERE id = $2', [
      'FUERA_DE_SERVICIO',
      maquinaId,
    ]);

    await client.query(
      `INSERT INTO historial_estados_maquina (
         maquina_id, estado_anterior, estado_nuevo, intervencion_id, motivo, cambiado_por_usuario_id, cambiado_en
       )
       VALUES ($1, $2, 'FUERA_DE_SERVICIO', NULL, $3, $4, NOW())`,
      [maquinaId, maquina.estado, motivo, usuario.id]
    );

    eventos.push({
      tipo: 'MAQUINA_FUERA_DE_SERVICIO',
      payload: { maquinaId, estadoAnterior: maquina.estado, motivo },
    });

    await registrarNotificaciones(client, eventos, { actorId: usuario.id });

    return {
      ok: true,
      estado: 'FUERA_DE_SERVICIO',
    };
  }

  // accion === 'REACTIVAR' (D-30)
  // Consultar períodos abiertos
  const resP = await client.query(
    `SELECT pd.id, i.estado AS intervencion_estado
     FROM intervencion_periodos_detencion pd
     JOIN intervenciones i ON pd.intervencion_id = i.id
     WHERE pd.maquina_id = $1 
       AND pd.hasta IS NULL 
       AND i.eliminado_en IS NULL`,
    [maquinaId]
  );
  const periodosAbiertos = resP.rows;

  if (maquina.estado === 'FUERA_DE_SERVICIO') {
    // Sale de fuera de servicio derivando de sus períodos
    const recalculo = await recalcularEstadoMaquina(client, maquinaId, {
      usuarioId: usuario.id,
      intervencionId: null,
      motivo,
      confirmacion: true,
      salidaFueraDeServicio: true,
    });

    eventos.push({
      tipo: 'MAQUINA_REACTIVADA',
      payload: { maquinaId, estadoNuevo: recalculo.estadoNuevo, motivo },
    });

    await registrarNotificaciones(client, eventos, { actorId: usuario.id });

    return {
      ok: true,
      estado: recalculo.estadoNuevo,
    };
  }

  // Desde otro estado que no es FUERA_DE_SERVICIO:
  if (periodosAbiertos.length > 0) {
    throw new ErrorNegocio(
      409,
      'MAQUINA_CON_DETENCIONES_ABIERTAS',
      'La máquina tiene detenciones abiertas. Para confirmar recuperación utilice Confirmar recuperación.'
    );
  }

  if (maquina.estado === 'OPERATIVA') {
    throw new ErrorNegocio(422, 'SIN_CAMBIOS', 'La máquina ya se encuentra operativa y sin detenciones abiertas');
  }

  // Máquina en otro estado (ej. DETENIDA sin períodos abiertos): reactiva a OPERATIVA
  const recalculo = await recalcularEstadoMaquina(client, maquinaId, {
    usuarioId: usuario.id,
    intervencionId: null,
    motivo,
    confirmacion: true,
  });

  eventos.push({
    tipo: 'MAQUINA_REACTIVADA',
    payload: { maquinaId, estadoNuevo: 'OPERATIVA', motivo },
  });

  await registrarNotificaciones(client, eventos, { actorId: usuario.id });

  return {
    ok: true,
    estado: 'OPERATIVA',
  };
}

/**
 * Verificación sin efectos para REGISTRAR_DETENCION (API-01 / Etapa API.1).
 * Comprueba: permiso, estado y que no tenga período de detención abierto.
 */
export async function verificarRegistrarDetencion(
  client: pg.Pool | pg.PoolClient,
  intervencion: any,
  _maquina: any,
  usuario: UsuarioVisibilidad
): Promise<void> {
  if (!('INTERVENCIONES_CAMBIAR_ESTADO' in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No posees permiso para registrar detenciones');
  }

  const estadosPermitidos = ['PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS'];
  if (!estadosPermitidos.includes(intervencion.estado)) {
    throw new ErrorNegocio(
      409,
      'TRANSICION_NO_PERMITIDA',
      `No se permite registrar detención sobre una intervención en estado ${intervencion.estado}`
    );
  }

  // Verificar si ya tiene período abierto
  const resAbierto = await client.query(
    'SELECT id FROM intervencion_periodos_detencion WHERE intervencion_id = $1 AND hasta IS NULL LIMIT 1',
    [intervencion.id]
  );
  if (resAbierto.rows.length > 0) {
    throw new ErrorNegocio(409, 'DETENCION_YA_ABIERTA', 'La intervención ya cuenta con un período de detención abierto');
  }
}

/**
 * 6.4 POST /api/intervenciones/:id/registrar-detencion (D-27, RN-18)
 */
export async function registrarDetencionIntervencion(
  client: pg.PoolClient,
  intervencionId: number,
  usuario: UsuarioVisibilidad,
  body: {
    estado_esperado?: unknown;
    desde?: unknown;
    observacion?: unknown;
  }
) {
  if (!('INTERVENCIONES_CAMBIAR_ESTADO' in usuario.permisos)) {
    throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No posees permiso para registrar detenciones');
  }

  if (!body.estado_esperado || typeof body.estado_esperado !== 'string') {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo estado_esperado es obligatorio');
  }

  const { intervencion, maquina } = await bloquearIntervencion(client, intervencionId, usuario);

  if (body.estado_esperado !== intervencion.estado) {
    throw new ErrorNegocio(409, 'ESTADO_DESACTUALIZADO', 'El estado de la intervención ha cambiado concurrentemente');
  }

  await verificarRegistrarDetencion(client, intervencion, maquina, usuario);

  const observacion = typeof body.observacion === 'string' ? body.observacion.trim() : '';
  if (observacion.length < 5) {
    throw new ErrorNegocio(422, 'OBSERVACION_REQUERIDA', 'Debe indicar una observación de al menos 5 caracteres');
  }

  let desde: string;
  if (body.desde !== undefined && body.desde !== null && String(body.desde).trim() !== '') {
    desde = await validarFechaISO(client, body.desde, 'desde');
  } else {
    const resNow = await client.query('SELECT NOW() AS ahora');
    desde = new Date(resNow.rows[0].ahora).toISOString();
  }

  // Validar fecha_creacion <= desde <= NOW()
  const resCheck = await client.query(
    `SELECT (
       $1::timestamptz >= fecha_creacion
       AND $1::timestamptz <= NOW() + INTERVAL '10 seconds'
     ) AS coherente
     FROM intervenciones
     WHERE id = $2`,
    [desde, intervencionId]
  );
  if (!resCheck.rows[0] || !resCheck.rows[0].coherente) {
    throw new ErrorNegocio(
      422,
      'FECHA_INCOHERENTE',
      'La fecha de inicio de la detención debe ser mayor o igual a la creación de la intervención y menor o igual al instante actual'
    );
  }

  // Insertar período
  const resInsert = await client.query(
    `INSERT INTO intervencion_periodos_detencion (
       intervencion_id, maquina_id, desde, abierto_por_usuario_id, observacion
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, desde, observacion`,
    [intervencionId, maquina.id, desde, usuario.id, observacion]
  );
  const nuevoPeriodo = resInsert.rows[0];

  // Recalcular máquina (PENDIENTE o espera -> DETENIDA; EN_PROCESO -> EN_MANTENIMIENTO)
  const recalculo = await recalcularEstadoMaquina(client, maquina.id, {
    usuarioId: usuario.id,
    intervencionId,
    motivo: `Detención registrada por intervención #${intervencionId}`,
    confirmacion: false,
  });

  const eventos: Array<{ tipo: string; payload: any }> = [
    {
      tipo: 'DETENCION_REGISTRADA',
      payload: { intervencionId, maquinaId: maquina.id, periodoId: Number(nuevoPeriodo.id) },
    },
  ];

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

  return {
    ok: true,
    periodo: {
      id: Number(nuevoPeriodo.id),
      desde: nuevoPeriodo.desde,
      observacion: nuevoPeriodo.observacion,
    },
  };
}
