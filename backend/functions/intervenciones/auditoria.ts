import pg from 'pg';
import { registrarNotificaciones as registrarNotificacionesMotor } from './notificaciones.ts';

export interface AuditoriaOpciones {
  intervencionId: number;
  tipoEvento: string;
  campo?: string | null;
  valorAnterior?: string | null;
  valorNuevo?: string | null;
  motivo?: string | null;
  usuarioId: number;
}

/**
 * Registra una acción de auditoría en la tabla intervencion_auditoria.
 */
export async function registrarAuditoria(
  client: pg.PoolClient,
  opts: AuditoriaOpciones
): Promise<void> {
  const {
    intervencionId,
    tipoEvento,
    campo = null,
    valorAnterior = null,
    valorNuevo = null,
    motivo = null,
    usuarioId,
  } = opts;

  await client.query(
    `INSERT INTO intervencion_auditoria (
       intervencion_id, tipo_evento, campo_modificado, valor_anterior, valor_nuevo, motivo, realizado_por_usuario_id, creado_en
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [intervencionId, tipoEvento, campo, valorAnterior, valorNuevo, motivo, usuarioId]
  );
}

/**
 * Punto de enganche para generación de notificaciones (Etapa 7).
 * Delega en el motor de notificaciones pasando actorId y eventos.
 */
export async function registrarNotificaciones(
  client: pg.PoolClient,
  eventos: Array<{ tipo: string; payload: any }>,
  opts?: { actorId?: number | null }
): Promise<void> {
  return registrarNotificacionesMotor(client, eventos, opts);
}
