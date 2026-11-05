/**
 * Ítems del menú según permisos (sección 7.2 de docs/etapas/etapa-f0-base-frontend.md)
 */

export interface ItemMenu {
  etiqueta: string;
  ruta: string;
  icono: string;
}

export type PermisosEntrada =
  | Record<string, unknown>
  | string[]
  | Set<string>
  | null
  | undefined;

function verificarPermiso(permisos: PermisosEntrada, codigo: string): boolean {
  if (!permisos) return false;

  if (Array.isArray(permisos)) {
    return permisos.some((p) => {
      if (typeof p === 'string') return p === codigo;
      if (typeof p === 'object' && p !== null && 'codigo' in p) {
        return (p as { codigo: string }).codigo === codigo;
      }
      return false;
    });
  }

  if (permisos instanceof Set) {
    return permisos.has(codigo);
  }

  if (typeof permisos === 'object') {
    return Boolean((permisos as Record<string, unknown>)[codigo]);
  }

  return false;
}

/**
 * Devuelve en orden canónico los ítems de navegación según los permisos dados.
 */
export function itemsMenu(permisos: PermisosEntrada): ItemMenu[] {
  const items: ItemMenu[] = [
    {
      etiqueta: 'Inicio',
      ruta: '/',
      icono: 'IconHome',
    },
  ];

  if (verificarPermiso(permisos, 'INTERVENCIONES_CREAR')) {
    items.push({
      etiqueta: 'Reportar falla',
      ruta: '/reportar',
      icono: 'IconAlertTriangle',
    });
  }

  if (verificarPermiso(permisos, 'INTERVENCIONES_VER')) {
    items.push({
      etiqueta: 'Intervenciones',
      ruta: '/intervenciones',
      icono: 'IconTool',
    });
  }

  // Máquinas siempre visible
  items.push({
    etiqueta: 'Máquinas',
    ruta: '/maquinas',
    icono: 'IconCpu',
  });

  if (verificarPermiso(permisos, 'REPORTES_CONSULTAR')) {
    items.push({
      etiqueta: 'Reportes',
      ruta: '/reportes',
      icono: 'IconReportAnalytics',
    });
  }

  if (verificarPermiso(permisos, 'USUARIOS_GESTIONAR')) {
    items.push({
      etiqueta: 'Usuarios',
      ruta: '/usuarios',
      icono: 'IconUsers',
    });
  }

  if (verificarPermiso(permisos, 'MAQUINAS_GESTIONAR')) {
    items.push({
      etiqueta: 'Sectores y catálogos',
      ruta: '/sectores',
      icono: 'IconBuildingFactory2',
    });
  }

  if (verificarPermiso(permisos, 'CONFIGURACION_GESTIONAR')) {
    items.push({
      etiqueta: 'Configuración',
      ruta: '/configuracion',
      icono: 'IconSettings',
    });
  }

  return items;
}
