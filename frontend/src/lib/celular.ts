/**
 * Reglas de alcance y navegación en el celular (Etapa A1, sección 3, D-027).
 */
import { destinoInicio, type PermisosAlcanceEntrada } from './inicio';
import { vistaDetalle } from './intervenciones';
import { verificarPermiso, type ItemMenu, type PermisosEntrada } from './menu';

/** El mismo corte que usa el Layout: debajo de sm (48em). */
export const CORTE_CELULAR = '(max-width: 48em)';

const RUTAS_SIEMPRE_CELULAR = new Set([
  '/ingreso',
  '/cambiar-password',
  '/mi-cuenta',
  '/notificaciones',
  '/reportar',
  '/mis-reportes',
  '/tablero',
  '/reportes',
]);

function limpiarRuta(ruta: string): string {
  const sinQuery = (ruta || '').split(/[?#]/)[0].trim();
  if (sinQuery.length > 1 && sinQuery.endsWith('/')) {
    return sinQuery.slice(0, -1);
  }
  return sinQuery;
}

/**
 * Dice si una ruta se puede usar en el celular (Etapa A1, 3.2):
 * - /ingreso, /cambiar-password, /mi-cuenta y /notificaciones: sí
 * - /reportar y /mis-reportes: sí
 * - /intervenciones/:id: solo cuando se muestra el reporte del operario (vistaDetalle !== 'completa')
 * - /tablero y /reportes: sí
 * - todo lo demás: no
 */
export function permitidaEnCelular(ruta: string, permisos?: PermisosAlcanceEntrada): boolean {
  const path = limpiarRuta(ruta);
  if (!path) return false;

  if (RUTAS_SIEMPRE_CELULAR.has(path)) {
    return true;
  }

  if (/^\/intervenciones\/[^/]+$/.test(path)) {
    return vistaDetalle(permisos) !== 'completa';
  }

  return false;
}

/**
 * Ítems del menú y botones de secciones permitidas en el celular según los permisos del usuario.
 */
export function itemsMenuCelular(permisos: PermisosEntrada): ItemMenu[] {
  const items: ItemMenu[] = [];

  if (verificarPermiso(permisos, 'INTERVENCIONES_CREAR')) {
    items.push({
      etiqueta: 'Reportar falla',
      ruta: '/reportar',
      icono: 'IconAlertTriangle',
    });
  }

  items.push({
    etiqueta: 'Mis reportes',
    ruta: '/mis-reportes',
    icono: 'IconTool',
  });

  if (destinoInicio(permisos as PermisosAlcanceEntrada) === '/tablero') {
    items.push({
      etiqueta: 'Tablero',
      ruta: '/tablero',
      icono: 'IconHome',
    });
  }

  if (verificarPermiso(permisos, 'REPORTES_CONSULTAR')) {
    items.push({
      etiqueta: 'Reportes',
      ruta: '/reportes',
      icono: 'IconReportAnalytics',
    });
  }

  return items;
}

/**
 * Destino al entrar a `/` en el celular (Etapa A1, 3.2):
 * - con INTERVENCIONES_CREAR -> /reportar
 * - si no, al tablero si lo tiene -> /tablero
 * - o a reportes -> /reportes
 * - si no tiene ninguno -> /mis-reportes
 */
export function destinoInicioCelular(
  permisos: PermisosAlcanceEntrada
): '/reportar' | '/tablero' | '/reportes' | '/mis-reportes' {
  if (verificarPermiso(permisos as PermisosEntrada, 'INTERVENCIONES_CREAR')) {
    return '/reportar';
  }
  if (destinoInicio(permisos) === '/tablero') {
    return '/tablero';
  }
  if (verificarPermiso(permisos as PermisosEntrada, 'REPORTES_CONSULTAR')) {
    return '/reportes';
  }
  return '/mis-reportes';
}
