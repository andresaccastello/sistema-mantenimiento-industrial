export interface PersonaNombre {
  nombre?: string | null;
  apellido?: string | null;
}

export function nombreCompleto(persona?: PersonaNombre | null): string {
  if (!persona) return '';
  const nombre = (persona.nombre || '').trim();
  const apellido = (persona.apellido || '').trim();

  if (nombre && apellido) {
    return `${nombre} ${apellido}`;
  }
  return nombre || apellido;
}

/** El legajo del usuario "Sistema", autor de lo automático (PV5, D-025). */
export const LEGAJO_SISTEMA = 'SISTEMA';

/**
 * El autor con su legajo: "Ana Pérez · 1234". El usuario del sistema va como "Sistema",
 * sin legajo (PV5, 5).
 */
export function textoAutor(persona: PersonaNombre & { legajo?: string | null }): string {
  if (persona.legajo === LEGAJO_SISTEMA) return nombreCompleto(persona) || 'Sistema';
  return `${nombreCompleto(persona)} · ${persona.legajo || '—'}`;
}
