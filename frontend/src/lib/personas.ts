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
