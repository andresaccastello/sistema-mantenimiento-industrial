/**
 * Destino de "Inicio" (sección 7.3 de docs/etapas/etapa-f0-base-frontend.md y Etapa A1)
 */
import { verificarPermiso, type PermisosEntrada } from './menu';

export type PermisosAlcanceEntrada =
  | Record<string, string | { alcance?: string } | unknown>
  | Array<{ codigo: string; alcance?: string | null }>
  | null
  | undefined;

/**
 * Determina la ruta a la que debe redirigir "Inicio":
 * - En computadora (enCelular = false):
 *   - Si INTERVENCIONES_VER tiene alcance TODAS o SECTORES -> /tablero
 *   - En cualquier otro caso -> /mis-reportes
 * - En celular (enCelular = true):
 *   - Con INTERVENCIONES_CREAR -> /reportar
 *   - Si no, al tablero si lo tiene -> /tablero
 *   - O a reportes si tiene REPORTES_CONSULTAR -> /reportes
 *   - En cualquier otro caso -> /mis-reportes
 */
export function destinoInicio(permisos: PermisosAlcanceEntrada, enCelular?: false): '/tablero' | '/mis-reportes';
export function destinoInicio(
  permisos: PermisosAlcanceEntrada,
  enCelular: boolean
): '/tablero' | '/mis-reportes' | '/reportar' | '/reportes';
export function destinoInicio(
  permisos: PermisosAlcanceEntrada,
  enCelular = false
): '/tablero' | '/mis-reportes' | '/reportar' | '/reportes' {
  if (enCelular) {
    if (verificarPermiso(permisos as PermisosEntrada, 'INTERVENCIONES_CREAR')) {
      return '/reportar';
    }
    if (destinoInicio(permisos, false) === '/tablero') {
      return '/tablero';
    }
    if (verificarPermiso(permisos as PermisosEntrada, 'REPORTES_CONSULTAR')) {
      return '/reportes';
    }
    return '/mis-reportes';
  }

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

/**
 * Determina si una ruta corresponde a "Inicio" (sección 4 de docs/etapas/etapa-f0-1-correcciones.md).
 * Devuelve true para '/' y para el destino que da destinoInicio(permisos).
 */
export function esRutaInicio(ruta: string, permisos: PermisosAlcanceEntrada): boolean {
  if (ruta === '/') {
    return true;
  }
  const destino = destinoInicio(permisos);
  return ruta === destino;
}
