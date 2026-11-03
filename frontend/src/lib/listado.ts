/**
 * Filtros y utilidades para el listado de intervenciones (R2)
 * (sección 4.3 de docs/etapas/etapa-f2-intervenciones.md)
 */

import { parsearId } from './formato';
import { rangoDiasAIso } from './fechas';

export type VistaIntervenciones = 'sin-asignar' | 'mias' | 'abiertas' | 'cerradas';

export interface FiltrosIntervenciones {
  vista: VistaIntervenciones;
  estados: string[];          // vacío = todos los de la vista
  sectorId: number | null;
  maquinaId: number | null;
  desde: string | null;       // 'YYYY-MM-DD', fecha de reporte
  hasta: string | null;
  texto: string;
  pagina: number;             // desde 1
}

export const FILTROS_POR_DEFECTO: FiltrosIntervenciones = {
  vista: 'abiertas',
  estados: [],
  sectorId: null,
  maquinaId: null,
  desde: null,
  hasta: null,
  texto: '',
  pagina: 1,
};

const ESTADOS_POR_VISTA: Record<VistaIntervenciones, string[]> = {
  'sin-asignar': [],
  mias: ['PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS'],
  abiertas: ['PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS'],
  cerradas: ['FINALIZADA', 'CANCELADA'],
};

/**
 * Devuelve las vistas disponibles según los permisos del usuario en el orden estándar.
 */
export function vistasDisponibles(permisos: Record<string, any> = {}): VistaIntervenciones[] {
  const vistas: VistaIntervenciones[] = [];

  const puedeAsignar = Boolean(permisos['INTERVENCIONES_ASIGNAR'] || permisos['INTERVENCIONES_ASIGNARSE']);
  if (puedeAsignar) {
    vistas.push('sin-asignar');
  }

  const puedeRecibir = Boolean(permisos['INTERVENCIONES_RECIBIR_ASIGNACION']);
  if (puedeRecibir) {
    vistas.push('mias');
  }

  vistas.push('abiertas');
  vistas.push('cerradas');

  return vistas;
}

function esDiaValido(str: string | null | undefined): boolean {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str.trim())) return false;
  const [y, m, d] = str.trim().split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
}

/**
 * Lee los filtros desde URLSearchParams.
 * Reemplaza valores inválidos por los valores por defecto.
 */
export function leerFiltros(
  params: URLSearchParams,
  vistasPermitidas: VistaIntervenciones[] = ['abiertas', 'cerradas']
): FiltrosIntervenciones {
  const vistaParam = params.get('vista') as VistaIntervenciones | null;
  const vistaValida: VistaIntervenciones =
    vistaParam && vistasPermitidas.includes(vistaParam) ? vistaParam : 'abiertas';

  const permitidos = ESTADOS_POR_VISTA[vistaValida];
  const estadoParam = params.get('estado');
  let estados: string[] = [];
  if (estadoParam) {
    estados = estadoParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => permitidos.includes(s));
  }

  const sectorId = parsearId(params.get('sector'));
  const maquinaId = parsearId(params.get('maquina'));

  const desdeParam = params.get('desde');
  const desde = esDiaValido(desdeParam) ? desdeParam!.trim() : null;

  const hastaParam = params.get('hasta');
  const hasta = esDiaValido(hastaParam) ? hastaParam!.trim() : null;

  const qParam = params.get('q');
  const texto = qParam ? qParam.trim().slice(0, 100) : '';

  const paginaParam = Number(params.get('pagina'));
  const pagina = Number.isInteger(paginaParam) && paginaParam > 0 ? paginaParam : 1;

  return {
    vista: vistaValida,
    estados,
    sectorId,
    maquinaId,
    desde,
    hasta,
    texto,
    pagina,
  };
}

/**
 * Serializa los filtros a URLSearchParams, omitiendo las claves que tienen valor por omisión.
 */
export function escribirFiltros(filtros: FiltrosIntervenciones): URLSearchParams {
  const params = new URLSearchParams();

  if (filtros.vista !== 'abiertas') {
    params.set('vista', filtros.vista);
  }

  if (filtros.estados.length > 0) {
    params.set('estado', filtros.estados.join(','));
  }

  if (filtros.sectorId !== null) {
    params.set('sector', String(filtros.sectorId));
  }

  if (filtros.maquinaId !== null) {
    params.set('maquina', String(filtros.maquinaId));
  }

  if (filtros.desde !== null) {
    params.set('desde', filtros.desde);
  }

  if (filtros.hasta !== null) {
    params.set('hasta', filtros.hasta);
  }

  const qTrim = filtros.texto.trim();
  if (qTrim.length > 0) {
    params.set('q', qTrim);
  }

  if (filtros.pagina > 1) {
    params.set('pagina', String(filtros.pagina));
  }

  return params;
}

/**
 * Devuelve los parámetros para GET /api/intervenciones según los filtros.
 */
export function paramsListado(
  filtros: FiltrosIntervenciones,
  tamanio: number
): Record<string, string | number | boolean> {
  const p: Record<string, string | number | boolean> = {
    limit: tamanio,
    offset: (filtros.pagina - 1) * tamanio,
  };

  if (filtros.vista === 'sin-asignar') {
    p.sin_asignar = true;
  } else if (filtros.vista === 'mias') {
    p.mias = true;
    const est =
      filtros.estados.length > 0
        ? filtros.estados
        : ESTADOS_POR_VISTA.mias;
    p.estado = est.join(',');
  } else if (filtros.vista === 'abiertas') {
    const est =
      filtros.estados.length > 0
        ? filtros.estados
        : ESTADOS_POR_VISTA.abiertas;
    p.estado = est.join(',');
  } else if (filtros.vista === 'cerradas') {
    const est =
      filtros.estados.length > 0
        ? filtros.estados
        : ESTADOS_POR_VISTA.cerradas;
    p.estado = est.join(',');
  }

  if (filtros.sectorId !== null) {
    p.sector_id = filtros.sectorId;
  }
  if (filtros.maquinaId !== null) {
    p.maquina_id = filtros.maquinaId;
  }

  const { desde, hasta } = rangoDiasAIso(filtros.desde, filtros.hasta);
  if (desde) p.desde = desde;
  if (hasta) p.hasta = hasta;

  const qTrim = filtros.texto.trim();
  if (qTrim.length >= 2) {
    p.q = qTrim;
  }

  return p;
}

/**
 * Devuelve true si hay filtros activos (estados, sector, máquina, fechas o texto).
 * La vista y la página no cuentan.
 */
export function hayFiltros(filtros: FiltrosIntervenciones): boolean {
  return (
    filtros.estados.length > 0 ||
    filtros.sectorId !== null ||
    filtros.maquinaId !== null ||
    filtros.desde !== null ||
    filtros.hasta !== null ||
    filtros.texto.trim().length > 0
  );
}

/**
 * Valida y ajusta la página actual según el total de elementos y tamaño de página:
 * - 1, si total es 0 o página < 1;
 * - la última página, si página es mayor;
 * - si no, página.
 */
export function paginaValida(pagina: number, total: number, tamanio: number): number {
  if (total <= 0 || tamanio <= 0) return 1;
  const ultimaPagina = Math.ceil(total / tamanio);
  if (pagina < 1) return 1;
  if (pagina > ultimaPagina) return ultimaPagina;
  return pagina;
}
