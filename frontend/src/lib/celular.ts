/**
 * Reglas de alcance y navegación en el celular (Etapa A1, sección 3, D-027).
 */
import { destinoInicio, type PermisosAlcanceEntrada } from './inicio';
import { vistaDetalle } from './intervenciones';
import { itemsMenu, verificarPermiso, type ItemMenu, type PermisosEntrada } from './menu';

/** El mismo corte que usa el Layout: menos de sm (48em = 768px). */
export const CORTE_CELULAR = '(max-width: 47.99em)';

/**
 * Evalúa si un ancho en píxeles (con base 1em = 16px) entra en CORTE_CELULAR (< 48em = 768px).
 */
export function esAnchoCelular(anchoPx: number): boolean {
  const match = CORTE_CELULAR.match(/max-width:\s*([\d.]+)em/);
  const maxEm = match ? Number(match[1]) : 47.99;
  return anchoPx <= maxEm * 16;
}

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
 * - /lecturas: con MAQUINAS_REGISTRAR_LECTURAS (LE1, 4.4, D-030)
 * - /rutinas: con RUTINAS_REALIZAR (RT1, 4, D-033)
 * - todo lo demás: no
 *
 * D1, 4 (D-031): con el modo simple apagado, el celular no limita nada: vale todo lo que permite
 * el perfil, como en la computadora (cada ruta controla su permiso).
 */
export function permitidaEnCelular(ruta: string, permisos?: PermisosAlcanceEntrada, modoSimple = true): boolean {
  if (!modoSimple) return true;
  const path = limpiarRuta(ruta);
  if (!path) return false;

  if (RUTAS_SIEMPRE_CELULAR.has(path)) {
    return true;
  }

  if (/^\/intervenciones\/[^/]+$/.test(path)) {
    return vistaDetalle(permisos) !== 'completa';
  }

  if (path === '/lecturas') {
    return verificarPermiso(permisos as PermisosEntrada, 'MAQUINAS_REGISTRAR_LECTURAS');
  }

  if (path === '/rutinas') {
    return verificarPermiso(permisos as PermisosEntrada, 'RUTINAS_REALIZAR');
  }

  return false;
}

/**
 * Ítems del menú y botones de secciones permitidas en el celular según los permisos del usuario (Etapa A2, sección 2).
 * D1, 4: con el modo simple apagado, el mismo menú de la computadora.
 */
export function itemsMenuCelular(permisos: PermisosEntrada, modoSimple = true): ItemMenu[] {
  if (!modoSimple) return itemsMenu(permisos, false);
  const items: ItemMenu[] = [
    {
      etiqueta: 'Mis reportes',
      ruta: '/mis-reportes',
      icono: 'IconTool',
    },
  ];

  // LE1, 4.4: la ronda de lecturas, después de Mis reportes
  if (verificarPermiso(permisos, 'MAQUINAS_REGISTRAR_LECTURAS')) {
    items.push({
      etiqueta: 'Lecturas',
      ruta: '/lecturas',
      icono: 'IconGauge',
    });
  }

  // RT1, 4: las tareas de rutina, después de Lecturas
  if (verificarPermiso(permisos, 'RUTINAS_REALIZAR')) {
    items.push({
      etiqueta: 'Tareas de hoy',
      ruta: '/rutinas',
      icono: 'IconChecklist',
    });
  }

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
 * Destino al entrar a `/` en el celular (Etapa A2, sección 2):
 * - con INTERVENCIONES_CREAR -> /mis-reportes
 * - si no, al tablero si lo tiene -> /tablero
 * - o a reportes -> /reportes
 * - si no tiene ninguno -> /mis-reportes
 */
export function destinoInicioCelular(
  permisos: PermisosAlcanceEntrada,
  modoSimple = true
): '/tablero' | '/reportes' | '/mis-reportes' {
  // D1, 4: con el modo simple apagado, el mismo destino que en la computadora
  if (!modoSimple) return destinoInicio(permisos);
  if (verificarPermiso(permisos as PermisosEntrada, 'INTERVENCIONES_CREAR')) {
    return '/mis-reportes';
  }
  if (destinoInicio(permisos) === '/tablero') {
    return '/tablero';
  }
  if (verificarPermiso(permisos as PermisosEntrada, 'REPORTES_CONSULTAR')) {
    return '/reportes';
  }
  return '/mis-reportes';
}

