import { destinoInicio, PermisosAlcanceEntrada } from './inicio.js';
import { obtenerInfoEstado } from './estados.js';

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
