/**
 * Filtros y utilidades para el listado de máquinas (R4)
 * (sección 3.1 de docs/etapas/etapa-f3b-tablero-maquinas.md)
 */

import { parsearId } from './formato';
import { normalizarTexto } from './maquinas';

export interface FiltrosMaquinas {
  texto: string;             // código, nombre o modelo
  estados: string[];         // de la máquina; vacío = todos
  criticidades: number[];    // ids; vacío = todas
  tipoEquipoId: number | null;
  sectorId: number | null;
  plantaId: number | null;
  inactivas: boolean;        // incluir desactivadas (solo con MAQUINAS_GESTIONAR)
}

export const FILTROS_MAQUINAS_POR_DEFECTO: FiltrosMaquinas = {
  texto: '',
  estados: [],
  criticidades: [],
  tipoEquipoId: null,
  sectorId: null,
  plantaId: null,
  inactivas: false,
};

export const ESTADOS_MAQUINA_VALIDOS = [
  'OPERATIVA',
  'DETENIDA',
  'EN_MANTENIMIENTO',
  'FUERA_DE_SERVICIO',
];

export interface MaquinaFiltrable {
  nombre: string;
  codigo?: string | null;
  modelo?: string | null;
  estado: string;
  activo: boolean;
  criticidad: { id: number };
  tipo_equipo: { id: number };
  sector: {
    id: number;
    planta?: { id: number } | null;
  };
}

/**
 * Lee los filtros de máquinas desde URLSearchParams.
 * Claves: q, estado (separados por coma), criticidad (ids separados por coma),
 * tipo, sector, planta e inactivas=1.
 * Valores inválidos se reemplazan por el valor de omisión.
 * inactivas sin permiso queda en false.
 */
export function leerFiltrosMaquinas(
  params: URLSearchParams,
  puedeVerInactivas = false
): FiltrosMaquinas {
  const qParam = params.get('q');
  const texto = qParam ? qParam.trim().slice(0, 100) : '';

  const estadoParam = params.get('estado');
  let estados: string[] = [];
  if (estadoParam) {
    estados = estadoParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => ESTADOS_MAQUINA_VALIDOS.includes(s));
  }

  const criticidadParam = params.get('criticidad');
  let criticidades: number[] = [];
  if (criticidadParam) {
    for (const part of criticidadParam.split(',')) {
      const id = parsearId(part);
      if (id !== null && !criticidades.includes(id)) {
        criticidades.push(id);
      }
    }
  }

  const tipoEquipoId = parsearId(params.get('tipo'));
  const sectorId = parsearId(params.get('sector'));
  const plantaId = parsearId(params.get('planta'));

  const inactivas = Boolean(puedeVerInactivas && params.get('inactivas') === '1');

  return {
    texto,
    estados,
    criticidades,
    tipoEquipoId,
    sectorId,
    plantaId,
    inactivas,
  };
}

/**
 * Serializa los filtros de máquinas a URLSearchParams, omitiendo las claves
 * que tienen su valor por omisión.
 */
export function escribirFiltrosMaquinas(filtros: FiltrosMaquinas): URLSearchParams {
  const params = new URLSearchParams();

  const qTrim = filtros.texto.trim();
  if (qTrim.length > 0) {
    params.set('q', qTrim);
  }

  if (filtros.estados.length > 0) {
    params.set('estado', filtros.estados.join(','));
  }

  if (filtros.criticidades.length > 0) {
    params.set('criticidad', filtros.criticidades.join(','));
  }

  if (filtros.tipoEquipoId !== null) {
    params.set('tipo', String(filtros.tipoEquipoId));
  }

  if (filtros.sectorId !== null) {
    params.set('sector', String(filtros.sectorId));
  }

  if (filtros.plantaId !== null) {
    params.set('planta', String(filtros.plantaId));
  }

  if (filtros.inactivas) {
    params.set('inactivas', '1');
  }

  return params;
}

/**
 * Aplica todos los filtros en memoria sobre la lista de máquinas,
 * conservando el orden de entrada.
 */
export function filtrarMaquinas<T extends MaquinaFiltrable>(
  maquinas: T[],
  filtros: FiltrosMaquinas
): T[] {
  const normTexto = normalizarTexto(filtros.texto);

  return maquinas.filter((m) => {
    if (!filtros.inactivas && !m.activo) {
      return false;
    }

    if (filtros.estados.length > 0 && !filtros.estados.includes(m.estado)) {
      return false;
    }

    if (filtros.criticidades.length > 0 && !filtros.criticidades.includes(m.criticidad.id)) {
      return false;
    }

    if (filtros.tipoEquipoId !== null && m.tipo_equipo.id !== filtros.tipoEquipoId) {
      return false;
    }

    if (filtros.sectorId !== null && m.sector.id !== filtros.sectorId) {
      return false;
    }

    if (filtros.plantaId !== null && (m.sector.planta?.id ?? null) !== filtros.plantaId) {
      return false;
    }

    if (normTexto) {
      const enNombre = normalizarTexto(m.nombre).includes(normTexto);
      const enCodigo = m.codigo ? normalizarTexto(m.codigo).includes(normTexto) : false;
      const enModelo = m.modelo ? normalizarTexto(m.modelo).includes(normTexto) : false;
      if (!enNombre && !enCodigo && !enModelo) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Devuelve true si hay algún filtro activo. inactivas no cuenta.
 */
export function hayFiltrosMaquinas(filtros: FiltrosMaquinas): boolean {
  return (
    filtros.texto.trim().length > 0 ||
    filtros.estados.length > 0 ||
    filtros.criticidades.length > 0 ||
    filtros.tipoEquipoId !== null ||
    filtros.sectorId !== null ||
    filtros.plantaId !== null
  );
}

