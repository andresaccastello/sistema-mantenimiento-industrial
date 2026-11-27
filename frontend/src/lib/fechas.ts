/**
 * Utilidades para manejo de fechas y momentos (sección 4.2 de docs/etapas/etapa-f2-intervenciones.md)
 */

import { formatFechaHora } from './formato';

export interface Momento {
  modo: 'ahora' | 'otra';
  fecha: string | null;
}

/**
 * Devuelve YYYY-MM-DD HH:mm:ss en hora local, con ceros a la izquierda.
 */
export function fechaLocalTexto(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  const h = String(fecha.getHours()).padStart(2, '0');
  const min = String(fecha.getMinutes()).padStart(2, '0');
  const s = String(fecha.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

/**
 * Acepta YYYY-MM-DD HH:mm o YYYY-MM-DD HH:mm:ss en hora local.
 * Devuelve YYYY-MM-DDTHH:mm:ss±hh:mm, con la diferencia horaria local de esa fecha.
 * Si el texto no es una fecha real (ej: 30 de febrero) o no tiene ese formato, devuelve null.
 */
export function fechaLocalAIso(texto: string | null | undefined): string | null {
  if (!texto || typeof texto !== 'string') return null;

  const match = texto.trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const min = Number(match[5]);
  const sec = match[6] !== undefined ? Number(match[6]) : 0;

  const d = new Date(year, month - 1, day, hour, min, sec);

  // Validar coherencia de calendario (para descartar 30 de febrero, mes 13, horas > 23, etc.)
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day ||
    d.getHours() !== hour ||
    d.getMinutes() !== min ||
    d.getSeconds() !== sec
  ) {
    return null;
  }

  const yStr = String(year).padStart(4, '0');
  const mStr = String(month).padStart(2, '0');
  const dStr = String(day).padStart(2, '0');
  const hStr = String(hour).padStart(2, '0');
  const minStr = String(min).padStart(2, '0');
  const sStr = String(sec).padStart(2, '0');

  const offsetTotal = -d.getTimezoneOffset();
  const signo = offsetTotal >= 0 ? '+' : '-';
  const offAbs = Math.abs(offsetTotal);
  const offH = String(Math.floor(offAbs / 60)).padStart(2, '0');
  const offM = String(offAbs % 60).padStart(2, '0');

  return `${yStr}-${mStr}-${dStr}T${hStr}:${minStr}:${sStr}${signo}${offH}:${offM}`;
}

/**
 * Valida un momento de diálogo.
 * Devuelve texto de error o null si es válido.
 */
export function validarMomento(
  momento: Momento,
  minimo?: string | Date | null,
  ahora: Date = new Date()
): string | null {
  if (momento.modo === 'ahora') {
    return null;
  }

  if (!momento.fecha || !momento.fecha.trim()) {
    return 'Indicá la fecha y la hora.';
  }

  const iso = fechaLocalAIso(momento.fecha);
  if (!iso) {
    return 'La fecha no es válida.';
  }

  const dateElegida = new Date(iso);

  if (minimo) {
    const minDate = minimo instanceof Date ? minimo : new Date(minimo);
    if (!isNaN(minDate.getTime())) {
      const minElegido = Math.floor(dateElegida.getTime() / 60000);
      const minMinimo = Math.floor(minDate.getTime() / 60000);
      if (minElegido < minMinimo) {
        return `No puede ser anterior al ${formatFechaHora(minDate)}.`;
      }
    }
  }

  if (dateElegida.getTime() > ahora.getTime()) {
    return 'No puede ser posterior a este momento.';
  }

  return null;
}

/**
 * Convierte un momento a formato ISO para enviar al backend.
 * - 'ahora' -> undefined
 * - 'otra' -> fechaLocalAIso(fecha), ajustando al mínimo si quedó antes por cuestión de segundos.
 */
export function momentoAIso(momento: Momento, minimo?: string | Date | null): string | undefined {
  if (momento.modo === 'ahora' || !momento.fecha) {
    return undefined;
  }

  const iso = fechaLocalAIso(momento.fecha);
  if (!iso) return undefined;

  if (minimo) {
    const minDate = minimo instanceof Date ? minimo : new Date(minimo);
    if (!isNaN(minDate.getTime())) {
      const elegidaDate = new Date(iso);
      if (elegidaDate.getTime() < minDate.getTime()) {
        return minDate.toISOString();
      }
    }
  }

  return iso;
}

/**
 * Recibe dos días YYYY-MM-DD (o null). Devuelve { desde?, hasta? } para el listado.
 */
export function rangoDiasAIso(
  desde: string | null | undefined,
  hasta: string | null | undefined
): { desde?: string; hasta?: string } {
  const res: { desde?: string; hasta?: string } = {};

  if (desde && /^\d{4}-\d{2}-\d{2}$/.test(desde.trim())) {
    const isoDesde = fechaLocalAIso(`${desde.trim()} 00:00:00`);
    if (isoDesde) res.desde = isoDesde;
  }

  if (hasta && /^\d{4}-\d{2}-\d{2}$/.test(hasta.trim())) {
    const isoHasta = fechaLocalAIso(`${hasta.trim()} 23:59:59`);
    if (isoHasta) res.hasta = isoHasta;
  }

  return res;
}

/**
 * Minutos enteros (hacia abajo) entre desde y hasta.
 * Si hasta es null, usa ahora. Nunca negativo.
 */
export function minutosEntre(
  desde: string | Date,
  hasta?: string | Date | null,
  ahora: Date = new Date()
): number {
  const d = desde instanceof Date ? desde : new Date(desde);
  const h = !hasta ? ahora : hasta instanceof Date ? hasta : new Date(hasta);

  if (isNaN(d.getTime()) || isNaN(h.getTime())) return 0;

  const diffMs = h.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  return Math.max(0, mins);
}
