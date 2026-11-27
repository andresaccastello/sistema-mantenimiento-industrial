/**
 * Lógica pura del Tablero (R1)
 * (sección 3.2 de docs/etapas/etapa-f3b-tablero-maquinas.md)
 */

import { vistasDisponibles } from './listado';

export type ClaveContadorIntervencion =
  | 'sin_asignar'
  | 'en_proceso'
  | 'en_espera_repuestos'
  | 'mias_abiertas';

export interface EnlacesTablero {
  OPERATIVA: string;
  DETENIDA: string;
  EN_MANTENIMIENTO: string;
  FUERA_DE_SERVICIO: string;
  sin_asignar: string;
  en_proceso: string;
  en_espera_repuestos: string;
  mias_abiertas: string;
}

function agregarPlanta(url: string, plantaId: number | null): string {
  if (plantaId === null || !Number.isInteger(plantaId) || plantaId <= 0) {
    return url;
  }
  return `${url}&planta=${plantaId}`;
}

/**
 * Devuelve el destino de cada contador del tablero.
 * Si hay planta elegida, todos los enlaces llevan planta=<id>.
 */
export function enlacesTablero(plantaId: number | null = null): EnlacesTablero {
  return {
    OPERATIVA: agregarPlanta('/maquinas?estado=OPERATIVA', plantaId),
    DETENIDA: agregarPlanta('/maquinas?estado=DETENIDA', plantaId),
    EN_MANTENIMIENTO: agregarPlanta('/maquinas?estado=EN_MANTENIMIENTO', plantaId),
    FUERA_DE_SERVICIO: agregarPlanta('/maquinas?estado=FUERA_DE_SERVICIO', plantaId),
    sin_asignar: agregarPlanta('/intervenciones?vista=sin-asignar', plantaId),
    en_proceso: agregarPlanta('/intervenciones?estado=EN_PROCESO', plantaId),
    en_espera_repuestos: agregarPlanta('/intervenciones?estado=EN_ESPERA_REPUESTOS', plantaId),
    mias_abiertas: agregarPlanta('/intervenciones?vista=mias', plantaId),
  };
}

/**
 * Devuelve qué contadores de intervenciones se muestran según los permisos:
 * - "Sin asignar" y "Asignadas a mí" siguen la regla de vistasDisponibles (pestañas de R2);
 * - "En proceso" y "Esperando repuestos" se muestran siempre.
 */
export function contadoresIntervencion(
  permisos: Record<string, unknown> = {}
): ClaveContadorIntervencion[] {
  const vistas = vistasDisponibles(permisos);
  const resultado: ClaveContadorIntervencion[] = [];

  if (vistas.includes('sin-asignar')) {
    resultado.push('sin_asignar');
  }

  resultado.push('en_proceso');
  resultado.push('en_espera_repuestos');

  if (vistas.includes('mias')) {
    resultado.push('mias_abiertas');
  }

  return resultado;
}

