import pg from 'pg';
import { ErrorNegocio } from './errores.ts';

export interface CambioEstadoOpciones {
  intervencionId: number;
  estadoActual: string;
  estadoNuevo: string;
  usuarioId: number;
  observacion?: string | null;
  camposExtra?: Record<string, any>;
}

/**
 * Aplica el cambio de estado de una intervención de forma segura,
 * verificando concurrencia optimista sobre el estado actual
 * y registrando el cambio en historial_estados_intervencion.
 */
export async function registrarCambioEstado(
  client: pg.PoolClient,
  opts: CambioEstadoOpciones
): Promise<void> {
  const {
    intervencionId,
    estadoActual,
    estadoNuevo,
    usuarioId,
    observacion = null,
    camposExtra = {},
  } = opts;

  // Construir columnas adicionales para actualizar si las hay (ej. fecha_inicio, responsable_usuario_id)
  const setClauses: string[] = ['estado = $1', 'actualizado_en = NOW()'];
  const values: any[] = [estadoNuevo, intervencionId, estadoActual];

  for (const [key, val] of Object.entries(camposExtra)) {
    if (val !== undefined) {
      values.push(val);
      setClauses.push(`${key} = $${values.length}`);
    }
  }

  const query = `
    UPDATE intervenciones
    SET ${setClauses.join(', ')}
    WHERE id = $2 AND estado = $3
  `;

  const resUpdate = await client.query(query, values);

  if (resUpdate.rowCount === 0) {
    throw new ErrorNegocio(
      409,
      'ESTADO_DESACTUALIZADO',
      'El estado de la intervención cambió concurrentemente por otra operación'
    );
  }

  // Registrar en historial_estados_intervencion
  await client.query(
    `INSERT INTO historial_estados_intervencion (
       intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, observacion, cambiado_en
     )
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [intervencionId, estadoActual, estadoNuevo, usuarioId, observacion]
  );
}
