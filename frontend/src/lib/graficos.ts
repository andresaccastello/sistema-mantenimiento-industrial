/**
 * Etapa GR1, 3 (D-036): la lógica pura de los gráficos de Reportes. El top N con "Otras", las
 * etiquetas de los períodos, las conclusiones de los títulos y el formato de ejes y tooltips.
 */
import { formatCantidad, formatDuracion, formatMoneda } from './formato';

export type AgrupacionEvolucion = 'mes' | 'semana';

// ---------------------------------------------------------------------------
// Top N con "Otras"
// ---------------------------------------------------------------------------

export interface ItemRanking {
  clave: string;
  etiqueta: string;
  valor: number;
}

/**
 * Las primeras `n` de mayor a menor y, si sobra algo, la suma del resto en una barra "Otras".
 * "Otras" no aparece si el resto suma 0.
 */
export function topConOtras(items: ItemRanking[], n: number, etiquetaOtras = 'Otras'): ItemRanking[] {
  const ordenados = [...items].sort((a, b) => b.valor - a.valor);
  const primeros = ordenados.slice(0, n);
  const resto = ordenados.slice(n).reduce((acc, i) => acc + i.valor, 0);
  return resto > 0 ? [...primeros, { clave: '__otras', etiqueta: etiquetaOtras, valor: resto }] : primeros;
}

// ---------------------------------------------------------------------------
// Etiquetas de los períodos
// ---------------------------------------------------------------------------

export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function aFechaUtc(texto: string): Date {
  const [y, m, d] = texto.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dosDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

/** El lunes de la semana de una fecha YYYY-MM-DD. */
function lunesDe(fecha: string): Date {
  const d = aFechaUtc(fecha);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
}

/** Por mes, "sep 26"; por semana, "23/11", con el lunes aunque el período esté recortado. */
export function etiquetaPeriodo(inicio: string, agrupar: AgrupacionEvolucion): string {
  if (agrupar === 'mes') {
    const [y, m] = inicio.split('-').map(Number);
    return `${MESES_CORTOS[m - 1]} ${String(y).slice(-2)}`;
  }
  const lunes = lunesDe(inicio);
  return `${dosDigitos(lunes.getUTCDate())}/${dosDigitos(lunes.getUTCMonth() + 1)}`;
}

/** Un período entero: una semana de lunes a domingo, o un mes del 1 al último día. */
export function periodoCompleto(p: { inicio: string; fin: string }, agrupar: AgrupacionEvolucion): boolean {
  const ini = aFechaUtc(p.inicio);
  const fin = aFechaUtc(p.fin);
  if (agrupar === 'semana') {
    return ini.getUTCDay() === 1 && fin.getTime() - ini.getTime() === 6 * 86_400_000;
  }
  const ultimo = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 0));
  return ini.getUTCDate() === 1 && fin.getTime() === ultimo.getTime();
}

// ---------------------------------------------------------------------------
// Las conclusiones de los títulos
// ---------------------------------------------------------------------------

/** Una diferencia menor al 10 % entre el primer y el último período completo es "estable". */
export const UMBRAL_ESTABLE = 0.1;

export interface SujetoConclusion {
  /** "Las fallas", "El costo". */
  texto: string;
  plural: boolean;
}

/**
 * La evolución: compara el primer período completo con el último completo. Con menos de dos
 * períodos completos no hay conclusión (null), y el que llama pone un título descriptivo.
 */
export function conclusionEvolucion(
  periodos: { inicio: string; fin: string }[],
  valores: number[],
  agrupar: AgrupacionEvolucion,
  sujeto: SujetoConclusion,
  formatear: (n: number) => string = formatEntero
): string | null {
  const completos = periodos.map((p, i) => (periodoCompleto(p, agrupar) ? i : -1)).filter((i) => i >= 0);
  if (completos.length < 2) return null;
  const a = valores[completos[0]];
  const b = valores[completos[completos.length - 1]];
  const por = agrupar === 'mes' ? 'por mes' : 'por semana';
  const estable = a === b || (a !== 0 && Math.abs(b - a) / Math.abs(a) < UMBRAL_ESTABLE);
  if (estable) {
    return `${sujeto.texto} ${sujeto.plural ? 'se mantuvieron estables' : 'se mantuvo estable'}, en ${formatear(b)} ${por}`;
  }
  const verbo = b < a ? (sujeto.plural ? 'bajaron' : 'bajó') : sujeto.plural ? 'subieron' : 'subió';
  return `${sujeto.texto} ${verbo} de ${formatear(a)} a ${formatear(b)} ${por}`;
}

/** El primero de un ranking "concentra" algo si se lleva el 25 % o más del total. */
export const UMBRAL_CONCENTRA = 0.25;

/**
 * El ranking: el porcentaje que concentra el primero, sobre el total de todos (no solo del top).
 * Por debajo del umbral, dice que está repartido. Sin total, null.
 */
export function conclusionRanking(
  items: ItemRanking[],
  queMide: string,
  ninguno: string
): string | null {
  const total = items.reduce((acc, i) => acc + Math.max(0, i.valor), 0);
  if (items.length === 0 || total <= 0) return null;
  const primero = [...items].sort((a, b) => b.valor - a.valor)[0];
  const parte = primero.valor / total;
  if (parte >= UMBRAL_CONCENTRA) {
    return `${primero.etiqueta} concentra el ${Math.round(parte * 100)} % ${queMide}`;
  }
  return `${ninguno} pasa del ${Math.round(UMBRAL_CONCENTRA * 100)} % ${queMide}`;
}

/** Una parte "predomina" si se lleva el 60 % o más. */
export const UMBRAL_PREDOMINA = 0.6;

/**
 * La proporción: "El 70 % de la inactividad fue correctiva". Si ninguna parte llega al 60 %,
 * "La inactividad se repartió entre correctiva y preventiva". Sin total, null.
 */
export function conclusionProporcion(
  partes: { etiqueta: string; valor: number }[],
  sujeto: string
): string | null {
  const total = partes.reduce((acc, p) => acc + Math.max(0, p.valor), 0);
  if (total <= 0) return null;
  const mayor = [...partes].sort((a, b) => b.valor - a.valor)[0];
  const parte = mayor.valor / total;
  if (parte >= UMBRAL_PREDOMINA) {
    return `El ${Math.round(parte * 100)} % de ${sujeto} fue ${mayor.etiqueta.toLowerCase()}`;
  }
  const nombres = partes.filter((p) => p.valor > 0).map((p) => p.etiqueta.toLowerCase());
  const lista = nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}` : nombres[0];
  return `${sujeto.charAt(0).toUpperCase()}${sujeto.slice(1)} se repartió entre ${lista}`;
}

// ---------------------------------------------------------------------------
// Formato de ejes y tooltips
// ---------------------------------------------------------------------------

/** Un entero con los miles con punto: 1234 -> "1.234". */
export function formatEntero(n: number): string {
  return formatCantidad(Math.round(n));
}

/** El eje de la plata, corto: "$ 950", "$ 120 mil", "$ 1,2 M". */
export function formatPesosEje(n: number): string {
  const abs = Math.abs(n);
  const signo = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${signo}$ ${formatCantidad(Math.round(abs / 100_000) / 10)} M`;
  if (abs >= 1_000) return `${signo}$ ${formatCantidad(Math.round(abs / 1_000))} mil`;
  return `${signo}$ ${formatCantidad(Math.round(abs))}`;
}

/** El tooltip de la plata, como en el resto del sistema: "$ 12.345,50". */
export function formatPesos(n: number): string {
  return formatMoneda(n);
}

/** El eje de los tiempos, en horas: 90 -> "1,5 h". */
export function formatHorasEje(minutos: number): string {
  return `${formatCantidad(Math.round((minutos / 60) * 10) / 10)} h`;
}

/** El tooltip de los tiempos, como en el resto del sistema: "2 h 30 min". */
export function formatTiempo(minutos: number): string {
  return formatDuracion(Math.round(minutos));
}

/** El eje y el tooltip de los porcentajes, desde una fracción: 0.974 -> "97,4 %". */
export function formatPorcentajeFraccion(fraccion: number): string {
  return `${formatCantidad(Math.round(fraccion * 1000) / 10)} %`;
}

/** Algún valor distinto de 0: si no, va "Sin datos en el período". */
export function hayValores(valores: number[]): boolean {
  return valores.some((v) => v !== 0);
}

/** Una etiqueta larga del eje, cortada con "…" (en el celular, el eje es angosto). */
export function acortar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}
