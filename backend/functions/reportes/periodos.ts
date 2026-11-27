import { ErrorNegocio } from '../intervenciones/errores.ts';

/** GR1, 1: cómo se agrupa la evolución. */
export type AgrupacionEvolucion = 'mes' | 'semana';
export const AGRUPACIONES_EVOLUCION: readonly AgrupacionEvolucion[] = ['mes', 'semana'];

/** Como mucho 60 períodos por pedido. */
export const MAXIMO_PERIODOS = 60;
export const MENSAJE_DEMASIADOS_PERIODOS = 'Acortá el período o agrupá por mes';

/** Hasta 92 días, por semana; más largo, por mes. */
export const DIAS_MAXIMOS_POR_SEMANA = 92;

export interface PeriodoFechas {
  /** YYYY-MM-DD, local de la instalación. */
  inicio: string;
  fin: string;
}

function aFecha(texto: string): Date {
  const [y, m, d] = texto.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function aTexto(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function sumarDias(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * 86_400_000);
}

/** El lunes de la semana de la fecha (las semanas van de lunes a domingo). */
function lunesDe(fecha: Date): Date {
  return sumarDias(fecha, -((fecha.getUTCDay() + 6) % 7));
}

/** El primer día del mes siguiente. */
function mesSiguiente(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 1));
}

/** Sin `agrupar`: por semana hasta 92 días de intervalo, y por mes si es más largo. */
export function agrupacionPorOmision(minutosIntervalo: number): AgrupacionEvolucion {
  return minutosIntervalo <= DIAS_MAXIMOS_POR_SEMANA * 24 * 60 ? 'semana' : 'mes';
}

/**
 * Los períodos entre dos fechas locales, las dos incluidas: semanas de lunes a domingo o meses
 * calendario, con el primero y el último recortados a `desde` y `hasta`. Más de 60: 422.
 */
export function armarPeriodos(desde: string, hasta: string, agrupar: AgrupacionEvolucion): PeriodoFechas[] {
  const fin = aFecha(hasta);
  const periodos: PeriodoFechas[] = [];
  let inicio = aFecha(desde);
  while (inicio.getTime() <= fin.getTime()) {
    const siguiente = agrupar === 'semana' ? sumarDias(lunesDe(inicio), 7) : mesSiguiente(inicio);
    const ultimoDia = sumarDias(siguiente, -1);
    periodos.push({
      inicio: aTexto(inicio),
      fin: aTexto(ultimoDia.getTime() < fin.getTime() ? ultimoDia : fin),
    });
    if (periodos.length > MAXIMO_PERIODOS) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', MENSAJE_DEMASIADOS_PERIODOS);
    }
    inicio = siguiente;
  }
  return periodos;
}
