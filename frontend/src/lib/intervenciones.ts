import { destinoInicio, PermisosAlcanceEntrada } from './inicio.js';
import { obtenerInfoEstado } from './estados.js';
import { formatDuracion } from './formato.js';
import { nombreCompleto } from './personas.js';
import type { Persona, AuditoriaItem, HistorialEstado } from '../api/tipos';

export const ESTADOS_ABIERTOS = ['PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS'] as const;
export const ESTADOS_CERRADOS = ['FINALIZADA', 'CANCELADA'] as const;

export const PERMISOS_GESTION = [
  'INTERVENCIONES_ASIGNAR',
  'INTERVENCIONES_ASIGNARSE',
  'INTERVENCIONES_RECIBIR_ASIGNACION',
  'INTERVENCIONES_CAMBIAR_ESTADO',
  'INTERVENCIONES_FINALIZAR',
  'INTERVENCIONES_CANCELAR',
  'INTERVENCIONES_REABRIR',
  'INTERVENCIONES_GESTIONAR',
  'INTERVENCIONES_ELIMINAR',
  'INTERVENCIONES_CORREGIR',
  'INTERVENCIONES_CONFIRMAR_RECUPERACION',
] as const;

function tienePermisoGestion(permisos: PermisosAlcanceEntrada): boolean {
  if (!permisos) return false;
  if (Array.isArray(permisos)) {
    return permisos.some((p) => PERMISOS_GESTION.includes(p.codigo as any));
  }
  return PERMISOS_GESTION.some((c) => {
    const val = (permisos as Record<string, unknown>)[c];
    return val !== undefined && val !== null && val !== false;
  });
}

/**
 * Devuelve 'simple' (O3) o 'completa' (R3 en F2).
 * 'simple' cuando destinoInicio(permisos) es '/mis-reportes' y el usuario no tiene ningún permiso de gestión.
 * 'completa' en cualquier otro caso.
 */
export function vistaDetalle(permisos: PermisosAlcanceEntrada): 'simple' | 'completa' {
  if (destinoInicio(permisos) !== '/mis-reportes') {
    return 'completa';
  }
  if (tienePermisoGestion(permisos)) {
    return 'completa';
  }
  return 'simple';
}

export interface HistorialItemEntrada {
  estado_anterior?: string | null;
  estado_nuevo: string;
  cambiado_en: string;
  fecha_efectiva?: string | null;
}

export interface ItemHistorialResultado {
  titulo: string;
  fecha: string;
  estado: string;
}

/**
 * Recibe un ítem de historial_estados y devuelve { titulo, fecha, estado }.
 */
export function itemHistorial(h: HistorialItemEntrada): ItemHistorialResultado {
  const titulo =
    h.estado_anterior === null || h.estado_anterior === undefined
      ? 'Reporte registrado'
      : obtenerInfoEstado('intervencion', h.estado_nuevo).texto;

  const fecha = h.fecha_efectiva || h.cambiado_en;

  return {
    titulo,
    fecha,
    estado: h.estado_nuevo,
  };
}

export interface ReporteEditableCampos {
  descripcion?: string | null;
  observaciones?: string | null;
}

function normalizarCampo(texto?: string | null): string {
  if (texto === null || texto === undefined) return '';
  return texto.trim();
}

/**
 * Devuelve true si alguno de los campos { descripcion, observaciones } cambió.
 * Compara los textos recortados y trata null, undefined y "" como iguales.
 */
export function hayCambiosReporte(
  actual: ReporteEditableCampos,
  editado: ReporteEditableCampos
): boolean {
  const descActual = normalizarCampo(actual?.descripcion);
  const descEditado = normalizarCampo(editado?.descripcion);
  if (descActual !== descEditado) return true;

  const obsActual = normalizarCampo(actual?.observaciones);
  const obsEditado = normalizarCampo(editado?.observaciones);
  if (obsActual !== obsEditado) return true;

  return false;
}

/**
 * Devuelve { etiqueta, texto, enCurso } para la columna "Tiempo" de la lista de intervenciones (R2).
 */
export function tiempoLista(item: {
  estado: string;
  tiempos?: {
    espera_minutos?: number | null;
    espera_en_curso?: boolean;
    duracion_bruta_minutos?: number | null;
    tiempo_total_minutos?: number | null;
    trabajo_en_curso?: boolean;
  } | null;
}): {
  etiqueta: string | null;
  texto: string;
  enCurso: boolean;
} {
  const estado = item.estado;
  const tiempos = item.tiempos;

  if (estado === 'PENDIENTE') {
    const mins = tiempos?.espera_minutos ?? null;
    return {
      etiqueta: 'Espera',
      texto: formatDuracion(mins),
      enCurso: Boolean(tiempos?.espera_en_curso),
    };
  }

  if (estado === 'EN_PROCESO' || estado === 'EN_ESPERA_REPUESTOS') {
    const mins = tiempos?.duracion_bruta_minutos ?? null;
    return {
      etiqueta: 'Trabajo',
      texto: formatDuracion(mins),
      enCurso: Boolean(tiempos?.trabajo_en_curso),
    };
  }

  if (estado === 'FINALIZADA') {
    const mins = tiempos?.tiempo_total_minutos ?? null;
    return {
      etiqueta: 'Total',
      texto: formatDuracion(mins),
      enCurso: false,
    };
  }

  return {
    etiqueta: null,
    texto: '—',
    enCurso: false,
  };
}

/**
 * Devuelve en ISO la fecha más tardía entre fecha_creacion y el hasta de los períodos de detención cerrados.
 * Es el límite inferior de "¿Desde cuándo?" al reabrir con una detención nueva.
 */
export function minimoNuevaDetencion(detalle: {
  fecha_creacion: string;
  periodos_detencion?: Array<{ hasta: string | null }> | null;
}): string {
  let resultado = detalle.fecha_creacion;
  let maxMs = new Date(detalle.fecha_creacion).getTime();

  if (detalle.periodos_detencion && Array.isArray(detalle.periodos_detencion)) {
    for (const p of detalle.periodos_detencion) {
      if (p.hasta) {
        const ms = new Date(p.hasta).getTime();
        if (ms > maxMs) {
          maxMs = ms;
          resultado = p.hasta;
        }
      }
    }
  }

  return resultado;
}

export interface EventoHistorial {
  clave: string;            // única, para React
  titulo: string;
  fecha: string;            // cuándo ocurrió
  registrado: string;       // cuándo se cargó
  mostrarRegistrado: boolean;
  persona: Persona | null;  // quién lo hizo
  detalle: string | null;
  estado: string | null;    // para el color del punto; null en los de auditoría
}

const TEXTOS_AUTOMATICOS = [
  'Intervención tomada por el responsable',
  'Asignación de responsable',
  'Asignación automática al iniciar trabajo',
];

/**
 * Arma el historial de R3 combinando historial_estados y auditoria.
 * Ordenado por fecha de registro ascendente; a igual registro, primero auditoría y luego estado.
 */
export function eventosHistorial(detalle: {
  historial_estados?: HistorialEstado[] | null;
  auditoria?: AuditoriaItem[] | null;
}): EventoHistorial[] {
  const eventosEstado: EventoHistorial[] = [];
  if (detalle.historial_estados && Array.isArray(detalle.historial_estados)) {
    for (const h of detalle.historial_estados) {
      const info = itemHistorial(h);
      let mostrarRegistrado = false;
      if (h.fecha_efectiva) {
        const diffMs = Math.abs(new Date(h.fecha_efectiva).getTime() - new Date(h.cambiado_en).getTime());
        mostrarRegistrado = diffMs >= 60000;
      }
      eventosEstado.push({
        clave: `estado-${h.id}`,
        titulo: info.titulo,
        fecha: info.fecha,
        registrado: h.cambiado_en,
        mostrarRegistrado,
        persona: h.cambiado_por,
        detalle: h.observacion || null,
        estado: info.estado,
      });
    }
  }

  const eventosAuditoria: EventoHistorial[] = [];
  if (detalle.auditoria && Array.isArray(detalle.auditoria)) {
    for (const a of detalle.auditoria) {
      const respAntTexto = a.responsable_anterior ? nombreCompleto(a.responsable_anterior) : '—';
      const respNueTexto = a.responsable_nuevo ? nombreCompleto(a.responsable_nuevo) : '—';

      let titulo: string | null = null;
      let detalleTexto: string | null = null;

      if (a.tipo_evento === 'ASIGNACION') {
        const esMismo = Boolean(
          a.realizado_por &&
          a.responsable_nuevo &&
          Number(a.realizado_por.id) === Number(a.responsable_nuevo.id)
        );

        if (!a.responsable_anterior) {
          titulo = esMismo ? `Tomada por ${respNueTexto}` : `Asignada a ${respNueTexto}`;
        } else {
          titulo = `Reasignada de ${respAntTexto} a ${respNueTexto}`;
        }

        const esAuto = a.motivo ? TEXTOS_AUTOMATICOS.includes(a.motivo.trim()) : false;
        detalleTexto = esAuto || !a.motivo ? null : a.motivo;
      } else if (a.tipo_evento === 'DESASIGNACION') {
        titulo = `Se quitó el responsable (${respAntTexto})`;
        const esAuto = a.motivo ? TEXTOS_AUTOMATICOS.includes(a.motivo.trim()) : false;
        detalleTexto = esAuto || !a.motivo ? null : a.motivo;
      } else if (a.tipo_evento === 'EDICION') {
        if (a.campo_modificado === 'descripcion') {
          titulo = 'Se editó la descripción';
          detalleTexto = 'Antes: ' + (a.valor_anterior ?? '');
        } else if (a.campo_modificado === 'observaciones') {
          titulo = 'Se editaron las observaciones';
          detalleTexto = 'Antes: ' + (a.valor_anterior && a.valor_anterior.trim() ? a.valor_anterior : '(vacío)');
        }
      } else if (a.tipo_evento === 'OTRO') {
        if (a.campo_modificado === 'trabajo_realizado') {
          titulo = 'Se reemplazó el trabajo realizado';
          detalleTexto = 'Antes: ' + (a.valor_anterior ?? '');
        } else if (a.campo_modificado === 'ejecucion') {
          titulo = 'Cambió quién hizo el trabajo';
          const val = a.valor_anterior === 'EXTERNA' ? 'Servicio externo' : 'Personal propio';
          detalleTexto = 'Antes: ' + val;
        }
      }

      if (titulo) {
        eventosAuditoria.push({
          clave: `auditoria-${a.id}`,
          titulo,
          fecha: a.creado_en,
          registrado: a.creado_en,
          mostrarRegistrado: false,
          persona: a.realizado_por,
          detalle: detalleTexto,
          estado: null,
        });
      }
    }
  }

  const itemsConOrden = [
    ...eventosAuditoria.map((item, idx) => ({ item, tipo: 0, idx })),
    ...eventosEstado.map((item, idx) => ({ item, tipo: 1, idx })),
  ];

  itemsConOrden.sort((a, b) => {
    const tA = new Date(a.item.registrado).getTime();
    const tB = new Date(b.item.registrado).getTime();
    if (tA !== tB) {
      return tA - tB;
    }
    if (a.tipo !== b.tipo) {
      return a.tipo - b.tipo; // Auditoría (0) antes que Estado (1)
    }
    return a.idx - b.idx;
  });

  return itemsConOrden.map((x) => x.item);
}
