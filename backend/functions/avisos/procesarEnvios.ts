import { pool } from '../db.ts';
import {
  estadoEmail,
  obtenerTransporteEmail,
  sanitizarError,
} from './transporteEmail.ts';

export interface OpcionesProcesarEnvios {
  limite?: number;
  presupuestoMs?: number;
  ids?: number[];
}

export interface ResultadoProcesarEnvios {
  sin_transporte?: boolean;
  procesados: number;
  enviados: number;
  descartados: number;
  con_error: number;
  reintentar: number;
}

function escaparHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Procesa la bandeja de notificaciones pendientes para EMAIL.
 * Cada envío se ejecuta en su propia transacción para evitar bloqueos largos y colisiones.
 */
export async function procesarEnvios(
  opciones?: OpcionesProcesarEnvios
): Promise<ResultadoProcesarEnvios> {
  const estado = estadoEmail();
  if (!estado.configurado) {
    return {
      sin_transporte: true,
      procesados: 0,
      enviados: 0,
      descartados: 0,
      con_error: 0,
      reintentar: 0,
    };
  }

  const transporte = obtenerTransporteEmail();
  if (!transporte) {
    return {
      sin_transporte: true,
      procesados: 0,
      enviados: 0,
      descartados: 0,
      con_error: 0,
      reintentar: 0,
    };
  }

  const limite = opciones?.limite ?? 50;
  const presupuestoMs = opciones?.presupuestoMs ?? 50000;
  const filtroIds = opciones?.ids && opciones.ids.length > 0 ? opciones.ids : null;

  const inicio = Date.now();
  let procesados = 0;
  let enviados = 0;
  let descartados = 0;
  let con_error = 0;
  let reintentar = 0;

  // Obtener marca una vez para el lote
  let nombreFirma = 'Sistema de Mantenimiento Industrial';
  try {
    const resCfg = await pool.query(
      'SELECT nombre_sistema, nombre_empresa FROM configuracion_sistema WHERE id = 1'
    );
    if (resCfg.rows.length > 0) {
      nombreFirma = resCfg.rows[0].nombre_empresa || resCfg.rows[0].nombre_sistema || nombreFirma;
    }
  } catch (err) {
    console.error('No se pudo obtener configuracion_sistema:', err);
  }

  while (procesados < limite && Date.now() - inicio < presupuestoMs) {
    const client = await pool.connect();
    let row: any = null;

    try {
      await client.query('BEGIN');

      const queryParams: any[] = [];
      let queryIdsClause = '';
      if (filtroIds) {
        queryParams.push(filtroIds);
        queryIdsClause = `AND e.id = ANY($${queryParams.length}::bigint[])`;
      }

      const resEnvio = await client.query(
        `SELECT 
           e.id, 
           e.notificacion_id, 
           e.intentos,
           n.tipo_evento, 
           n.prioridad, 
           n.titulo, 
           n.mensaje, 
           n.intervencion_id, 
           n.creada_en,
           u.id AS usuario_id, 
           u.email, 
           u.activo AS usuario_activo,
           c.activo AS canal_activo
         FROM notificacion_envios e
         JOIN notificaciones n ON n.id = e.notificacion_id
         JOIN usuarios u ON u.id = n.usuario_id
         JOIN notificacion_canales c ON c.canal = e.canal
         WHERE e.estado = 'PENDIENTE' 
           AND e.canal = 'EMAIL'
           AND (e.proximo_intento_en IS NULL OR e.proximo_intento_en <= NOW())
           ${queryIdsClause}
         ORDER BY e.creado_en ASC, e.id ASC
         LIMIT 1
         FOR UPDATE OF e SKIP LOCKED`,
        queryParams
      );

      if (resEnvio.rows.length === 0) {
        // No hay más registros pendientes
        await client.query('COMMIT');
        break;
      }

      row = resEnvio.rows[0];
      procesados++;

      // Validar motivos de descarte
      if (!row.canal_activo) {
        await client.query(
          `UPDATE notificacion_envios 
           SET estado = 'DESCARTADO', ultimo_error = 'Canal desactivado'
           WHERE id = $1`,
          [row.id]
        );
        descartados++;
        await client.query('COMMIT');
        continue;
      }

      if (!row.usuario_activo) {
        await client.query(
          `UPDATE notificacion_envios 
           SET estado = 'DESCARTADO', ultimo_error = 'Usuario inactivo'
           WHERE id = $1`,
          [row.id]
        );
        descartados++;
        await client.query('COMMIT');
        continue;
      }

      const emailDestino = row.email ? String(row.email).trim() : '';
      if (!emailDestino) {
        await client.query(
          `UPDATE notificacion_envios 
           SET estado = 'DESCARTADO', ultimo_error = 'Sin email cargado'
           WHERE id = $1`,
          [row.id]
        );
        descartados++;
        await client.query('COMMIT');
        continue;
      }

      const edadMs = Date.now() - new Date(row.creada_en).getTime();
      if (edadMs > 24 * 60 * 60 * 1000) {
        await client.query(
          `UPDATE notificacion_envios 
           SET estado = 'DESCARTADO', ultimo_error = 'Vencido'
           WHERE id = $1`,
          [row.id]
        );
        descartados++;
        await client.query('COMMIT');
        continue;
      }

      // Preparar contenido del email
      const prefijo = row.prioridad === 'ALTA' ? '[Urgente] ' : '';
      const asunto = `${prefijo}${row.titulo}`;

      const appUrl = process.env.APP_URL_PUBLICA ? process.env.APP_URL_PUBLICA.replace(/\/+$/, '') : '';
      let texto = row.mensaje;
      let html = `<p>${escaparHtml(row.mensaje).replace(/\n/g, '<br />')}</p>`;

      if (appUrl && row.intervencion_id) {
        const link = `${appUrl}/intervenciones/${row.intervencion_id}`;
        texto += `\n\nVer en el sistema: ${link}`;
        html += `<p><a href="${link}">Ver en el sistema: ${link}</a></p>`;
      }

      texto += `\n\n— ${nombreFirma}`;
      html += `<p>— ${escaparHtml(nombreFirma)}</p>`;

      try {
        await transporte.enviar({
          para: emailDestino,
          asunto,
          texto,
          html,
        });

        await client.query(
          `UPDATE notificacion_envios 
           SET estado = 'ENVIADO', 
               enviado_en = NOW(), 
               destino = $1, 
               ultimo_error = NULL
           WHERE id = $2`,
          [emailDestino, row.id]
        );
        enviados++;
        await client.query('COMMIT');
      } catch (sendErr: any) {
        con_error++;
        const nuevosIntentos = Number(row.intentos) + 1;
        const errTexto = sanitizarError(sendErr);

        if (nuevosIntentos >= 5) {
          await client.query(
            `UPDATE notificacion_envios 
             SET estado = 'ERROR', 
                 intentos = $1, 
                 ultimo_error = $2
             WHERE id = $3`,
            [nuevosIntentos, errTexto, row.id]
          );
        } else {
          reintentar++;
          const minutosBackoff = [1, 5, 15, 60][nuevosIntentos - 1] ?? 60;
          await client.query(
            `UPDATE notificacion_envios 
             SET intentos = $1, 
                 ultimo_error = $2, 
                 proximo_intento_en = NOW() + ($3 || ' minutes')::interval
             WHERE id = $4`,
            [nuevosIntentos, errTexto, `${minutosBackoff}`, row.id]
          );
        }
        await client.query('COMMIT');
      }
    } catch (dbErr) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Error procesando un envío:', dbErr);
    } finally {
      client.release();
    }
  }

  return {
    procesados,
    enviados,
    descartados,
    con_error,
    reintentar,
  };
}
