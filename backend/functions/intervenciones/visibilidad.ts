import { AlcancePermiso } from './permisos.ts';

export interface UsuarioVisibilidad {
  id: number;
  permisos: Record<string, AlcancePermiso>;
  sectores: number[];
}

export interface IntervencionVisibilidad {
  creado_por_usuario_id: number;
  responsable_usuario_id: number | null;
  sector_id: number;
}

/**
 * Determina si un usuario tiene visibilidad sobre una intervención
 * según su permiso INTERVENCIONES_VER y el alcance configurado.
 */
export function puedeVerIntervencion(
  usuario: UsuarioVisibilidad,
  intervencion: IntervencionVisibilidad
): boolean {
  if (!('INTERVENCIONES_VER' in usuario.permisos)) {
    return false;
  }

  const alcance = usuario.permisos['INTERVENCIONES_VER'];

  if (alcance === 'TODAS') {
    return true;
  }

  if (alcance === 'SECTORES') {
    return usuario.sectores.includes(Number(intervencion.sector_id));
  }

  if (alcance === 'PROPIAS') {
    return (
      Number(intervencion.creado_por_usuario_id) === usuario.id ||
      Number(intervencion.responsable_usuario_id) === usuario.id
    );
  }

  return false;
}
