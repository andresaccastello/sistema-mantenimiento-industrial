/**
 * Etapa CAL1, 3.7: la lógica del calendario de preventivos (D-028).
 * Las fechas van como texto YYYY-MM-DD y la cuenta de días es aritmética pura sobre
 * año, mes y día: no pasa por Date ni por ninguna zona horaria, así que un día no se corre.
 */
import { obtenerInfoEstado } from './estados';

export type VistaCalendario = 'mes' | 'semana';

export interface ParamsCalendario {
  vista: VistaCalendario;
  fecha: string;
}

export interface Rango {
  desde: string;
  hasta: string;
}

export interface DiaGrilla {
  fecha: string;
  /** false en los días de otro mes, que van atenuados. */
  delMes: boolean;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Los títulos de las columnas, de lunes a domingo. */
export const DIAS_SEMANA_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Aritmética de fechas sobre el calendario civil
// ---------------------------------------------------------------------------

function partes(fecha: string): [number, number, number] {
  return [Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)), Number(fecha.slice(8, 10))];
}

function texto(a: number, m: number, d: number): string {
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Días desde el 1970-01-01 (algoritmo days_from_civil). */
function aNumero(fecha: string): number {
  const [a0, m, d] = partes(fecha);
  const a = m <= 2 ? a0 - 1 : a0;
  const era = Math.floor(a / 400);
  const ae = a - era * 400;
  const dda = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const dde = ae * 365 + Math.floor(ae / 4) - Math.floor(ae / 100) + dda;
  return era * 146097 + dde - 719468;
}

/** La inversa de aNumero (civil_from_days). */
function deNumero(n: number): string {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const dde = z - era * 146097;
  const ae = Math.floor((dde - Math.floor(dde / 1460) + Math.floor(dde / 36524) - Math.floor(dde / 146096)) / 365);
  const dda = dde - (365 * ae + Math.floor(ae / 4) - Math.floor(ae / 100));
  const mp = Math.floor((5 * dda + 2) / 153);
  const d = dda - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return texto(ae + era * 400 + (m <= 2 ? 1 : 0), m, d);
}

export function sumarDias(fecha: string, dias: number): string {
  return deNumero(aNumero(fecha) + dias);
}

/** 0 = lunes … 6 = domingo. El 1970-01-01 fue jueves. */
export function diaSemana(fecha: string): number {
  return (((aNumero(fecha) + 3) % 7) + 7) % 7;
}

function diasDelMes(a: number, m: number): number {
  return aNumero(m === 12 ? texto(a + 1, 1, 1) : texto(a, m + 1, 1)) - aNumero(texto(a, m, 1));
}

/** YYYY-MM-DD y una fecha que existe. */
export function esFechaValida(valor: string | null | undefined): valor is string {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [a, m, d] = partes(valor);
  return m >= 1 && m <= 12 && d >= 1 && d <= diasDelMes(a, m);
}

/** Hoy en la computadora, sin pasar por UTC. */
export function hoyLocal(ahora = new Date()): string {
  return texto(ahora.getFullYear(), ahora.getMonth() + 1, ahora.getDate());
}

const lunesDe = (fecha: string) => sumarDias(fecha, -diaSemana(fecha));

// ---------------------------------------------------------------------------
// Períodos
// ---------------------------------------------------------------------------

/** El rango del período: el mes, de lunes a domingo completos; o la semana de lunes a domingo. */
export function rangoCalendario(vista: VistaCalendario, fecha: string): Rango {
  if (vista === 'semana') {
    const desde = lunesDe(fecha);
    return { desde, hasta: sumarDias(desde, 6) };
  }
  const [a, m] = partes(fecha);
  const primero = texto(a, m, 1);
  const ultimo = texto(a, m, diasDelMes(a, m));
  return { desde: lunesDe(primero), hasta: sumarDias(lunesDe(ultimo), 6) };
}

/** Una fecha del período anterior (−1) o siguiente (+1). En el mes, el día se acota al último del mes. */
export function moverPeriodo(vista: VistaCalendario, fecha: string, delta: number): string {
  if (vista === 'semana') return sumarDias(fecha, 7 * delta);
  const [a, m, d] = partes(fecha);
  const total = a * 12 + (m - 1) + delta;
  const na = Math.floor(total / 12);
  const nm = total - na * 12 + 1;
  return texto(na, nm, Math.min(d, diasDelMes(na, nm)));
}

/** Las filas de la grilla del mes: de 4 a 6 semanas, de lunes a domingo. */
export function semanasDelMes(fecha: string): DiaGrilla[][] {
  const { desde, hasta } = rangoCalendario('mes', fecha);
  const mes = fecha.slice(0, 7);
  const filas: DiaGrilla[][] = [];
  for (let dia = desde; dia <= hasta; dia = sumarDias(dia, 7)) {
    filas.push(Array.from({ length: 7 }, (_, i) => {
      const f = sumarDias(dia, i);
      return { fecha: f, delMes: f.slice(0, 7) === mes };
    }));
  }
  return filas;
}

/** Los siete días de la semana de la fecha. */
export function diasDeLaSemana(fecha: string): string[] {
  const desde = lunesDe(fecha);
  return Array.from({ length: 7 }, (_, i) => sumarDias(desde, i));
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

/** Los eventos agrupados por día, sin cambiar el orden en que vinieron. */
export function eventosPorDia<T extends { fecha: string }>(eventos: readonly T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const e of eventos) {
    const lista = mapa.get(e.fecha);
    if (lista) lista.push(e);
    else mapa.set(e.fecha, [e]);
  }
  return mapa;
}

/** Los que entran en la celda y cuántos quedan para "+N más". */
export function visiblesEnCelda<T>(eventos: readonly T[], maximo: number): { visibles: T[]; mas: number } {
  return { visibles: eventos.slice(0, maximo), mas: Math.max(0, eventos.length - maximo) };
}

export interface EventoParaVer {
  tipo: 'HECHA' | 'PENDIENTE' | 'PREVISTA';
  estado: string | null;
}

/** El color: el del estado en las pendientes, teal en las hechas y gris en las previstas. */
export function colorEvento(e: EventoParaVer): string {
  if (e.tipo === 'HECHA') return 'teal';
  if (e.tipo === 'PREVISTA') return 'gray';
  return obtenerInfoEstado('tarea_preventiva', e.estado ?? '').color;
}

/** "Hecha", "Prevista" o el texto del estado. */
export function textoEvento(e: EventoParaVer): string {
  if (e.tipo === 'HECHA') return 'Hecha';
  if (e.tipo === 'PREVISTA') return 'Prevista';
  return obtenerInfoEstado('tarea_preventiva', e.estado ?? '').texto;
}

/** La leyenda, en el orden de 3.6. */
export const LEYENDA_CALENDARIO: Array<{ texto: string; color: string; prevista?: boolean }> = [
  ...(['VENCIDA', 'PROXIMA', 'AL_DIA', 'EN_CURSO'] as const).map((estado) => ({
    texto: obtenerInfoEstado('tarea_preventiva', estado).texto,
    color: obtenerInfoEstado('tarea_preventiva', estado).color,
  })),
  { texto: 'Hecha', color: 'teal' },
  { texto: 'Prevista', color: 'gray', prevista: true },
];

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

/** "Noviembre 2026", o en la semana "9 al 15 de noviembre de 2026". */
export function textoTituloPeriodo(vista: VistaCalendario, fecha: string): string {
  if (vista === 'mes') {
    const [a, m] = partes(fecha);
    return `${mayuscula(MESES[m - 1])} ${a}`;
  }
  const { desde, hasta } = rangoCalendario('semana', fecha);
  const [a1, m1, d1] = partes(desde);
  const [a2, m2, d2] = partes(hasta);
  if (a1 !== a2) return `${d1} de ${MESES[m1 - 1]} de ${a1} al ${d2} de ${MESES[m2 - 1]} de ${a2}`;
  if (m1 !== m2) return `${d1} de ${MESES[m1 - 1]} al ${d2} de ${MESES[m2 - 1]} de ${a2}`;
  return `${d1} al ${d2} de ${MESES[m2 - 1]} de ${a2}`;
}

/** "Jueves 12 de noviembre", el título del panel del día. */
export function textoDia(fecha: string): string {
  const [, m, d] = partes(fecha);
  return `${mayuscula(DIAS_SEMANA[diaSemana(fecha)])} ${d} de ${MESES[m - 1]}`;
}

// ---------------------------------------------------------------------------
// La dirección
// ---------------------------------------------------------------------------

/** `cal` y `fecha` de la dirección. Sin ellos, o inválidos: mes y hoy. */
export function leerParamsCalendario(params: URLSearchParams, hoy: string): ParamsCalendario {
  const fecha = params.get('fecha');
  return {
    vista: params.get('cal') === 'semana' ? 'semana' : 'mes',
    fecha: esFechaValida(fecha) ? fecha : hoy,
  };
}

/** Una copia de los parámetros, con `cal` y `fecha`. */
export function escribirParamsCalendario(params: URLSearchParams, c: ParamsCalendario): URLSearchParams {
  const nuevos = new URLSearchParams(params);
  nuevos.set('cal', c.vista);
  nuevos.set('fecha', c.fecha);
  return nuevos;
}
