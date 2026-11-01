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
