/**
 * Formato de tiempos legibles para el frontend
 * Según sección 7.1 de docs/etapas/etapa-f0-base-frontend.md
 */

/**
 * Formatea una cantidad de minutos en texto legible:
 * - null -> "—"
 * - 0 -> "0 min"
 * - menos de 60 -> "N min"
 * - menos de 24 h -> "H h M min" (si M es 0, solo "H h")
 * - 24 h o más -> "D d H h" (si H es 0, solo "D d")
 */
export function formatDuracion(minutos: number | null): string {
  if (minutos === null || minutos === undefined) {
    return '—';
  }

  if (minutos === 0) {
    return '0 min';
  }

  if (minutos < 60) {
    return `${minutos} min`;
  }

  if (minutos < 1440) {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    if (m === 0) {
      return `${h} h`;
    }
    return `${h} h ${m} min`;
  }

  const d = Math.floor(minutos / 1440);
  const h = Math.floor((minutos % 1440) / 60);
  if (h === 0) {
    return `${d} d`;
  }
  return `${d} d ${h} h`;
}

/**
 * Formatea el tiempo transcurrido desde una fecha ISO o Date hasta `ahora`:
 * - menos de 1 minuto, o fecha en el futuro -> "recién"
 * - cualquier otra -> "hace " + formatDuracion(diferencia)
 */
export function formatHace(fechaISO: string | Date, ahora?: Date | string | number): string {
  const f = typeof fechaISO === 'string' ? new Date(fechaISO) : fechaISO;
  const a = ahora ? (typeof ahora === 'string' || typeof ahora === 'number' ? new Date(ahora) : ahora) : new Date();

  const diffMs = a.getTime() - f.getTime();

  // Si la diferencia es menor a 1 minuto (60.000 ms) o está en el futuro
  if (diffMs < 60_000) {
    return 'recién';
  }

  const minutos = Math.floor(diffMs / 60_000);
  return `hace ${formatDuracion(minutos)}`;
}

/**
 * Formatea el tiempo restante hasta una fecha ISO o Date en el futuro desde `ahora`:
 * - menos de 1 minuto (o fecha pasada) -> "en menos de 1 min"
 * - cualquier otra -> "en " + formatDuracion(minutos)
 */
export function formatDentroDe(fechaISO: string | Date, ahora?: Date | string | number): string {
  const f = typeof fechaISO === 'string' ? new Date(fechaISO) : fechaISO;
  const a = ahora ? (typeof ahora === 'string' || typeof ahora === 'number' ? new Date(ahora) : ahora) : new Date();

  const diffMs = f.getTime() - a.getTime();

  if (diffMs < 60_000) {
    return 'en menos de 1 min';
  }

  const minutos = Math.floor(diffMs / 60_000);
  return `en ${formatDuracion(minutos)}`;
}

/**
 * Formatea una fecha ISO o Date en "DD/MM/YYYY HH:mm" en hora local con ceros a la izquierda.
 * null, undefined o fecha inválida -> "—"
 */
export function formatFechaHora(fecha?: string | Date | null): string {
  if (fecha === null || fecha === undefined) {
    return '—';
  }
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha;
  if (isNaN(d.getTime())) {
    return '—';
  }
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');

  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/**
 * Parsea un ID como entero positivo.
 * Devuelve el número si el texto es un entero positivo y, si no, null.
 */
export function parsearId(texto?: string | number | null): number | null {
  if (texto === null || texto === undefined || texto === '') {
    return null;
  }
  const str = String(texto).trim();
  if (!/^\d+$/.test(str)) {
    return null;
  }
  const n = Number(str);
  if (!Number.isSafeInteger(n) || n <= 0) {
    return null;
  }
  return n;
}

/**
 * Formatea un valor monetario en pesos con dos decimales, separador de miles con punto
 * y coma para decimales.
 * Ejemplos:
 * 12345.5 -> "$ 12.345,50"
 * 0 -> "$ 0,00"
 * null / undefined -> "—"
 * Usa espacio común (U+0020), no espacio duro.
 */
export function formatMoneda(valor?: number | null): string {
  if (valor === null || valor === undefined || typeof valor !== 'number' || isNaN(valor)) {
    return '—';
  }
  const esNegativo = valor < 0;
  const abs = Math.abs(valor);
  const partes = abs.toFixed(2).split('.');
  const enteroConPuntos = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const res = `$ ${enteroConPuntos},${partes[1]}`;
  return esNegativo ? `-${res}` : res;
}

/**
 * Formatea una cantidad numérica con hasta 3 decimales, omitiendo decimales innecesarios,
 * separador de miles con punto y coma para decimales.
 * Ejemplos:
 * 2 -> "2"
 * 1.5 -> "1,5"
 * 1234.25 -> "1.234,25"
 * 0.125 -> "0,125"
 * null / undefined -> "—"
 */
export function formatCantidad(valor?: number | null): string {
  if (valor === null || valor === undefined || typeof valor !== 'number' || isNaN(valor)) {
    return '—';
  }
  const esNegativo = valor < 0;
  const abs = Math.abs(valor);
  const redondeado = Math.round(abs * 1000) / 1000;
  const partes = redondeado.toString().split('.');
  const enteroConPuntos = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const res = partes.length > 1 ? `${enteroConPuntos},${partes[1]}` : enteroConPuntos;
  return esNegativo ? `-${res}` : res;
}

