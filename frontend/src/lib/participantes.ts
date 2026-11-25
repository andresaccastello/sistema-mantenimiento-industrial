/**
 * MQ1, 4.2: la línea "Participaron" del detalle de la intervención.
 */
import type { ParticipantesIntervencion } from '../api/tipos';

/** "Luis Pérez" -> "L. Pérez". Sin apellido, el nombre tal cual. */
export function nombreCorto(persona: { nombre?: string | null; apellido?: string | null }): string {
  const nombre = (persona.nombre || '').trim();
  const apellido = (persona.apellido || '').trim();
  if (!apellido) return nombre;
  if (!nombre) return apellido;
  return `${nombre.charAt(0).toUpperCase()}. ${apellido}`;
}

export function hayParticipantes(p?: ParticipantesIntervencion | null): boolean {
  return Boolean(p && (p.internos.length > 0 || p.externos.length > 0));
}

/** Los internos, separados por coma: "L. Pérez, M. Gómez". */
export function textoInternos(p: ParticipantesIntervencion): string {
  return p.internos.map(nombreCorto).join(', ');
}

/**
 * La línea entera: "Participaron: L. Pérez, M. Gómez · Servicios Eléctricos Ramírez".
 * Sin participantes, null: no se muestra.
 */
export function textoParticiparon(p?: ParticipantesIntervencion | null): string | null {
  if (!p || !hayParticipantes(p)) return null;
  const partes = [textoInternos(p), p.externos.map((x) => x.nombre).join(', ')].filter((x) => x !== '');
  return `Participaron: ${partes.join(' · ')}`;
}
