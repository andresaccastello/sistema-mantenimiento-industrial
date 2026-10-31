/**
 * Destino de "Inicio" (sección 7.3 de docs/etapas/etapa-f0-base-frontend.md)
 */

export type PermisosAlcanceEntrada =
  | Record<string, string | { alcance?: string } | unknown>
  | Array<{ codigo: string; alcance?: string | null }>
  | null
  | undefined;

/**
 * Determina la ruta a la que debe redirigir "Inicio":
 * - Si INTERVENCIONES_VER tiene alcance TODAS o SECTORES -> /tablero
 * - En cualquier otro caso (PROPIAS, sin permiso, etc.) -> /mis-reportes
 */
export function destinoInicio(permisos: PermisosAlcanceEntrada): '/tablero' | '/mis-reportes' {
  if (!permisos) {
    return '/mis-reportes';
  }

  let alcance: string | null = null;

  if (Array.isArray(permisos)) {
    const p = permisos.find((item) => item.codigo === 'INTERVENCIONES_VER');
    if (p && p.alcance) {
      alcance = p.alcance;
    }
  } else if (typeof permisos === 'object') {
    const valor = permisos['INTERVENCIONES_VER'];
    if (typeof valor === 'string') {
      alcance = valor;
    } else if (typeof valor === 'object' && valor !== null && 'alcance' in valor) {
      alcance = String((valor as { alcance?: unknown }).alcance ?? '');
    }
  }

  if (alcance === 'TODAS' || alcance === 'SECTORES') {
    return '/tablero';
  }

  return '/mis-reportes';
}
