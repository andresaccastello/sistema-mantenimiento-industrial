import pg from 'pg';
import { ErrorNegocio } from './errores.ts';
import { UsuarioVisibilidad } from './visibilidad.ts';
import { validarFechaISO } from './fechas.ts';

export interface ValidacionRecuperacion {
  tienePeriodoAbierto: boolean;
  periodoId: number | null;
  maquinaRecuperada?: boolean;
  hasta?: string;
  observacionConfirmacion?: string | null;
}

export interface PeriodoRespuesta {
  id: number;
  cerrado: boolean;
  hasta: string | null;
  confirmado_por_usuario_id?: number | null;
  tiempo_inactividad_minutos?: number | null;
}

/**
 * Valida la decisión de recuperación antes de aplicar cualquier mutación.
 * Bloquea el período abierto con FOR UPDATE (orden: máquina -> intervención -> período).
 */
export async function validarDecisionRecuperacion(
  client: pg.PoolClient,
  opts: {
    intervencionId: number;
    maquinaId: number;
    usuario: UsuarioVisibilidad;
    maquinaRecuperada?: unknown;
    fechaRecuperacion?: unknown;
    fechaPorDefecto: string;
    observacionRecuperacion?: unknown;
  }
): Promise<ValidacionRecuperacion> {
  const { intervencionId, usuario, maquinaRecuperada, fechaRecuperacion, fechaPorDefecto, observacionRecuperacion } = opts;

  // 1. Buscar período abierto de la intervención con FOR UPDATE
  const resP = await client.query(
    `SELECT id, desde
     FROM intervencion_periodos_detencion
     WHERE intervencion_id = $1 AND hasta IS NULL
     FOR UPDATE`,
    [intervencionId]
  );

  // 2. Sin período abierto: maquina_recuperada y fecha_recuperacion se ignoran
  if (resP.rows.length === 0) {
    return {
      tienePeriodoAbierto: false,
      periodoId: null,
    };
  }

  const periodo = resP.rows[0];

  // 3. Con período abierto y maquina_recuperada ausente -> 422 DECISION_RECUPERACION_REQUERIDA
  if (typeof maquinaRecuperada !== 'boolean') {
    throw new ErrorNegocio(
      422,
      'DECISION_RECUPERACION_REQUERIDA',
      'La intervención tiene un período de detención abierto. Debe indicar explícitamente si la máquina fue recuperada (maquina_recuperada: true | false)'
    );
  }

  // 4. maquina_recuperada = true
  if (maquinaRecuperada === true) {
    // Exige INTERVENCIONES_CONFIRMAR_RECUPERACION efectivo (D-25)
    if (!('INTERVENCIONES_CONFIRMAR_RECUPERACION' in usuario.permisos)) {
      throw new ErrorNegocio(
        403,
        'CONFIRMACION_NO_PERMITIDA',
        'No posees permiso para confirmar la recuperación de la máquina'
      );
    }

    let hasta: string;
    if (fechaRecuperacion !== undefined && fechaRecuperacion !== null && String(fechaRecuperacion).trim() !== '') {
      hasta = await validarFechaISO(client, fechaRecuperacion, 'fecha_recuperacion');
    } else {
      hasta = fechaPorDefecto;
    }

    // Validar desde <= hasta <= NOW()
    const resCheck = await client.query(
      `SELECT (
         $1::timestamptz >= $2::timestamptz
         AND $1::timestamptz <= NOW() + INTERVAL '10 seconds'
       ) AS coherente`,
      [hasta, periodo.desde]
    );

    if (!resCheck.rows[0] || !resCheck.rows[0].coherente) {
      throw new ErrorNegocio(
        422,
        'FECHA_INCOHERENTE',
        'La fecha de recuperación debe ser mayor o igual al inicio de la detención y menor o igual al instante actual'
      );
    }

    return {
      tienePeriodoAbierto: true,
      periodoId: Number(periodo.id),
      maquinaRecuperada: true,
      hasta,
      observacionConfirmacion: typeof observacionRecuperacion === 'string' ? observacionRecuperacion.trim() : null,
    };
  }

  // 5. maquina_recuperada = false
  return {
    tienePeriodoAbierto: true,
    periodoId: Number(periodo.id),
    maquinaRecuperada: false,
  };
}

/**
 * Aplica el cierre del período (si fue recuperada) y actualiza tiempo_inactividad_minutos.
 */
export async function aplicarDecisionRecuperacion(
  client: pg.PoolClient,
  opts: {
    intervencionId: number;
    maquinaId: number;
    usuarioId: number;
    validacion: ValidacionRecuperacion;
    eventos: Array<{ tipo: string; payload: any }>;
  }
): Promise<PeriodoRespuesta | null> {
  const { intervencionId, maquinaId, usuarioId, validacion, eventos } = opts;

  if (!validacion.tienePeriodoAbierto || validacion.periodoId === null) {
    return null;
  }

  if (validacion.maquinaRecuperada === true) {
    // Cerrar período
    await client.query(
      `UPDATE intervencion_periodos_detencion
       SET hasta = $1,
           confirmado_por_usuario_id = $2,
           observacion_confirmacion = $3
       WHERE id = $4`,
      [validacion.hasta, usuarioId, validacion.observacionConfirmacion || null, validacion.periodoId]
    );

    // Recalcular tiempo_inactividad_minutos
    const resMin = await client.query(
      `UPDATE intervenciones
       SET tiempo_inactividad_minutos = (
         SELECT ROUND(EXTRACT(EPOCH FROM SUM(hasta - desde)) / 60)
         FROM intervencion_periodos_detencion
         WHERE intervencion_id = $1 AND hasta IS NOT NULL
       )
       WHERE id = $1
       RETURNING tiempo_inactividad_minutos`,
      [intervencionId]
    );

    const minutos = resMin.rows[0]?.tiempo_inactividad_minutos != null
      ? Number(resMin.rows[0].tiempo_inactividad_minutos)
      : 0;

    eventos.push({
      tipo: 'RECUPERACION_CONFIRMADA',
      payload: { intervencionId, maquinaId, periodoId: validacion.periodoId },
    });

    return {
      id: validacion.periodoId,
      cerrado: true,
      hasta: validacion.hasta!,
      confirmado_por_usuario_id: usuarioId,
      tiempo_inactividad_minutos: minutos,
    };
  }

  // maquinaRecuperada === false: período permanece abierto
  eventos.push({
    tipo: 'DETENCION_PENDIENTE_CONFIRMACION',
    payload: { intervencionId, maquinaId, periodoId: validacion.periodoId },
  });

  return {
    id: validacion.periodoId,
    cerrado: false,
    hasta: null,
  };
}
