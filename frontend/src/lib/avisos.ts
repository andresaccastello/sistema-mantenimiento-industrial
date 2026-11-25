/**
 * Lógica pura de avisos por email (Etapa N1b)
 */

import { ModoAviso } from '../api/tipos';
import { formatDentroDe } from './formato';

export interface TipoAvisoInfo {
  tipo_evento: string;
  nombre: string;
  destinatarios: string;
}

/**
 * Los 12 tipos de eventos notificables en el mismo orden que REGLAS_EVENTOS_NOTIFICACION del backend.
 */
export const TIPOS_AVISO: readonly TipoAvisoInfo[] = [
  {
    tipo_evento: 'FALLA_REGISTRADA',
    nombre: 'Falla reportada',
    destinatarios:
      'A quienes reciben avisos de fallas, según sus sectores. Es de prioridad alta si la máquina quedó detenida o si su criticidad es de prioridad alta.',
  },
  {
    tipo_evento: 'PARADA_CRITICA',
    nombre: 'Parada crítica',
    destinatarios:
      'A quienes reciben avisos de paradas críticas, según sus sectores, también a quien reportó. Sale cuando se detiene una máquina cuya criticidad es de prioridad alta. Siempre es de prioridad alta.',
  },
  {
    tipo_evento: 'INTERVENCION_ASIGNADA',
    nombre: 'Trabajo asignado',
    destinatarios: 'A quien queda como responsable.',
  },
  {
    tipo_evento: 'INTERVENCION_REASIGNADA',
    nombre: 'Trabajo reasignado',
    destinatarios: 'Al nuevo responsable y al anterior.',
  },
  {
    tipo_evento: 'INTERVENCION_DESASIGNADA',
    nombre: 'Responsable quitado',
    destinatarios: 'A quien deja de ser responsable.',
  },
  {
    tipo_evento: 'INTERVENCION_FINALIZADA',
    nombre: 'Intervención finalizada',
    destinatarios: 'A quien reportó la falla y al responsable.',
  },
  {
    tipo_evento: 'INTERVENCION_CANCELADA',
    nombre: 'Intervención cancelada',
    destinatarios: 'A quien reportó la falla y al responsable.',
  },
  {
    tipo_evento: 'INTERVENCION_REABIERTA',
    nombre: 'Intervención reabierta',
    destinatarios: 'A quien reportó la falla y al responsable.',
  },
  {
    tipo_evento: 'DETENCION_PENDIENTE_CONFIRMACION',
    nombre: 'Máquina para confirmar',
    destinatarios:
      'A quienes confirman que una máquina volvió a producir. Siempre es de prioridad alta.',
  },
  {
    tipo_evento: 'PREVENTIVO_VENCIMIENTO',
    nombre: 'Vencimiento de un preventivo',
    destinatarios:
      'Al responsable del plan o, si no tiene, a quienes gestionan los planes del sector. Es de prioridad alta si vence una tarea de una máquina de criticidad de prioridad alta.',
  },
  {
    tipo_evento: 'STOCK_BAJO',
    nombre: 'Stock bajo',
    destinatarios:
      'A quienes reciben avisos de stock bajo. Sale una vez cuando un repuesto llega a su stock mínimo, hasta que se repone.',
  },
  {
    tipo_evento: 'LECTURA_ATRASADA',
    nombre: 'Lecturas atrasadas',
    destinatarios:
      'Al responsable de cada plan que usa el medidor o, si no tiene, a quienes gestionan los planes del sector. Va uno por persona, con todos sus medidores atrasados juntos, y una sola vez por atraso.',
  },
] as const;

/**
 * Adónde lleva un aviso al tocarlo: las lecturas atrasadas, a la ronda con solo los atrasados
 * (LE1, 4.5); el stock bajo, a la ficha del repuesto, solo con REPUESTOS_GESTIONAR (AV1, 5);
 * si no, a su intervención o a su máquina. Sin destino, null.
 */
export function destinoAviso(
  n: {
    tipo_evento?: string;
    intervencion_id: number | null;
    maquina_id?: number | null;
    repuesto_id?: number | null;
  },
  opciones: { gestionaRepuestos?: boolean } = {}
): string | null {
  if (n.tipo_evento === 'LECTURA_ATRASADA') return '/lecturas?solo_atrasados=true';
  if (n.tipo_evento === 'STOCK_BAJO') {
    return opciones.gestionaRepuestos && n.repuesto_id ? `/repuestos/${n.repuesto_id}` : null;
  }
  if (n.intervencion_id) return `/intervenciones/${n.intervencion_id}`;
  if (n.maquina_id) return `/maquinas/${n.maquina_id}`;
  return null;
}

/** AV1, 5: la tarjeta "Paradas críticas" de Configuración. */
export const ETIQUETA_DETENCION_POSTERIOR =
  'Avisar también cuando la detención se registra después de reportar la falla';
export const AYUDA_PARADAS_CRITICAS =
  "Qué máquinas son críticas: la criticidad con prioridad alta, en Sectores y catálogos. Quién recibe el aviso: el permiso 'Recibir avisos de paradas críticas', en Perfiles o en cada usuario";

/** AV1, 5: junto al stock mínimo del repuesto. */
export const AYUDA_STOCK_MINIMO = 'Avisa cuando el stock llega a este número. Sin mínimo, no avisa';

export function nombreTipoAviso(tipo: string): string {
  const item = TIPOS_AVISO.find((t) => t.tipo_evento === tipo);
  return item ? item.nombre : tipo;
}

export function etiquetaModo(modo: ModoAviso | string): string {
  if (modo === 'NUNCA') return 'Nunca';
  if (modo === 'SOLO_ALTA') return 'Solo prioridad alta';
  if (modo === 'SIEMPRE') return 'Siempre';
  return modo;
}

export type ColorEstadoEnvio = 'amarillo' | 'marca' | 'rojo' | 'gris';

export interface EstadoEnvioInfo {
  etiqueta: string;
  color: ColorEstadoEnvio;
}

export function estadoEnvio(estado: string): EstadoEnvioInfo {
  switch (estado) {
    case 'PENDIENTE':
      return { etiqueta: 'Pendiente', color: 'amarillo' };
    case 'ENVIADO':
      return { etiqueta: 'Enviado', color: 'marca' };
    case 'ERROR':
      return { etiqueta: 'Con error', color: 'rojo' };
    case 'DESCARTADO':
      return { etiqueta: 'Descartado', color: 'gris' };
    default:
      return { etiqueta: estado, color: 'gris' };
  }
}

export interface DatosEnvioDetalle {
  estado: string;
  intentos?: number;
  proximo_intento_en?: string | null;
  ultimo_error?: string | null;
  destino?: string | null;
}

export function detalleEnvio(envio: DatosEnvioDetalle, ahora?: Date | string | number): string {
  if (envio.estado === 'PENDIENTE') {
    if (envio.proximo_intento_en && envio.intentos && envio.intentos > 0) {
      const dentroDe = formatDentroDe(envio.proximo_intento_en, ahora);
      return `Intento ${envio.intentos} de 5 falló. Reintenta ${dentroDe}.`;
    }
    return 'Sale en el próximo minuto.';
  }

  if (envio.estado === 'ERROR' || envio.estado === 'DESCARTADO') {
    return envio.ultimo_error || '';
  }

  if (envio.estado === 'ENVIADO') {
    return `Enviado a ${envio.destino || ''}`;
  }

  return '';
}
