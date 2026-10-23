import pg from 'pg';

export interface RecalculoOpciones {
  usuarioId: number;
  intervencionId?: number | null;
  motivo?: string;
  confirmacion?: boolean;
}

export interface RecalculoResultado {
  estadoAnterior: string;
  estadoNuevo: string;
  cambio: boolean;
}

/**
 * Recalcula el estado operativo de una máquina de acuerdo a la matriz de períodos abiertos
 * y estados de intervención (Tabla 4.2 del análisis funcional).
 * 
 * Debe ejecutarse con la fila de la máquina ya bloqueada (FOR UPDATE).
 */
export async function recalcularEstadoMaquina(
  client: pg.PoolClient,
  maquinaId: number,
  opts: RecalculoOpciones
): Promise<RecalculoResultado> {
  const { usuarioId, intervencionId = null, motivo = 'Recálculo automático de estado', confirmacion = false } = opts;

  // 1. Obtener estado actual
  const resM = await client.query(
    'SELECT estado FROM maquinas WHERE id = $1',
    [maquinaId]
  );
  if (resM.rows.length === 0) {
    throw new Error(`Máquina ${maquinaId} no encontrada`);
  }
  const estadoActual = resM.rows[0].estado;

  // Regla 1: Si la máquina está FUERA_DE_SERVICIO, el recálculo automático no altera su estado
  if (estadoActual === 'FUERA_DE_SERVICIO') {
    return {
      estadoAnterior: estadoActual,
      estadoNuevo: estadoActual,
      cambio: false,
    };
  }

  // 2. Consultar períodos abiertos de intervenciones no eliminadas
  const resPeriodos = await client.query(
    `SELECT pd.id, i.estado AS intervencion_estado
     FROM intervencion_periodos_detencion pd
     JOIN intervenciones i ON pd.intervencion_id = i.id
     WHERE pd.maquina_id = $1 
       AND pd.hasta IS NULL 
       AND i.eliminado_en IS NULL`,
    [maquinaId]
  );

  const periodosAbiertos = resPeriodos.rows;
  let estadoResultante = estadoActual;

  if (periodosAbiertos.length > 0) {
    const hayEnProceso = periodosAbiertos.some(
      (p: { intervencion_estado: string }) => p.intervencion_estado === 'EN_PROCESO'
    );

    // Regla 2: Hay períodos abiertos y al menos una está EN_PROCESO
    // Regla 3: Hay períodos abiertos y ninguna está EN_PROCESO
    estadoResultante = hayEnProceso ? 'EN_MANTENIMIENTO' : 'DETENIDA';
  } else {
    // Regla 4: Sin períodos abiertos y confirmación = true -> OPERATIVA
    // Regla 5: Sin períodos abiertos y confirmación = false -> No cambia
    if (confirmacion === true) {
      estadoResultante = 'OPERATIVA';
    }
  }

  // Si hay cambio de estado, persistir en maquinas y en historial_estados_maquina
  if (estadoResultante !== estadoActual) {
    await client.query(
      'UPDATE maquinas SET estado = $1, actualizado_en = NOW() WHERE id = $2',
      [estadoResultante, maquinaId]
    );

    await client.query(
      `INSERT INTO historial_estados_maquina (
         maquina_id, estado_anterior, estado_nuevo, intervencion_id, motivo, cambiado_por_usuario_id, cambiado_en
       )
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [maquinaId, estadoActual, estadoResultante, intervencionId, motivo, usuarioId]
    );

    return {
      estadoAnterior: estadoActual,
      estadoNuevo: estadoResultante,
      cambio: true,
    };
  }

  return {
    estadoAnterior: estadoActual,
    estadoNuevo: estadoActual,
    cambio: false,
  };
}
