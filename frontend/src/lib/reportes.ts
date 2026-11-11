import { formatCantidad, parsearId } from './formato';
import type { AgrupacionPreventivos, GrupoCumplimientoPreventivos } from '../api/tipos';

export type { AgrupacionPreventivos };

export type PeriodoOpcion = '7d' | '30d' | '90d' | 'mes' | 'mes-anterior' | 'personalizado';
export type VistaReporte = 'indicadores' | 'inactividad' | 'tiempos' | 'repuestos' | 'preventivos' | 'costos';
export type AgrupacionTiempos = 'ejecucion' | 'tipo' | 'sector';
export type AgrupacionReporte = AgrupacionTiempos | AgrupacionPreventivos;

export interface FiltrosReportes {
  periodo: PeriodoOpcion;
  desde: string | null;
  hasta: string | null;
  planta: number | null;
  sector: number | null;
  vista: VistaReporte;
  agrupar: AgrupacionReporte;
}

export const FILTROS_REPORTES_POR_DEFECTO: FiltrosReportes = {
  periodo: '30d',
  desde: null,
  hasta: null,
  planta: null,
  sector: null,
  vista: 'indicadores',
  agrupar: 'ejecucion',
};

const PERIODOS_VALIDOS: Set<string> = new Set(['7d', '30d', '90d', 'mes', 'mes-anterior', 'personalizado']);
const VISTAS_VALIDAS: Set<string> = new Set(['indicadores', 'inactividad', 'tiempos', 'repuestos', 'preventivos', 'costos']);
const AGRUPACIONES_VALIDAS: Set<string> = new Set(['ejecucion', 'tipo', 'sector', 'maquina', 'plan']);

const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lee los filtros de reportes desde URLSearchParams, Record o string.
 * Los valores inválidos se reemplazan por los de omisión.
 * Un personalizado con desde posterior a hasta, o al que le falta uno de los dos, vuelve a 30d.
 */
export function leerFiltrosReportes(
  params: URLSearchParams | Record<string, string | undefined> | string
): FiltrosReportes {
  const getParam = (key: string): string | null => {
    if (typeof params === 'string') {
      const sp = new URLSearchParams(params.startsWith('?') ? params.slice(1) : params);
      return sp.get(key);
    }
    if (params instanceof URLSearchParams) {
      return params.get(key);
    }
    const val = params[key];
    return val !== undefined && val !== null ? String(val) : null;
  };

  // 1. Periodo
  const rawPeriodo = getParam('periodo');
  let periodo: PeriodoOpcion = '30d';
  if (rawPeriodo && PERIODOS_VALIDOS.has(rawPeriodo)) {
    periodo = rawPeriodo as PeriodoOpcion;
  }

  // 2. Fechas personalizado
  const rawDesde = getParam('desde');
  const rawHasta = getParam('hasta');

  let desde: string | null = null;
  let hasta: string | null = null;

  if (periodo === 'personalizado') {
    const desdeValido = rawDesde && REGEX_FECHA.test(rawDesde);
    const hastaValido = rawHasta && REGEX_FECHA.test(rawHasta);

    if (desdeValido && hastaValido && rawDesde! <= rawHasta!) {
      desde = rawDesde!;
      hasta = rawHasta!;
    } else {
      // Si falta uno o desde es posterior a hasta, vuelve a 30d
      periodo = '30d';
      desde = null;
      hasta = null;
    }
  }

  // 3. Planta y sector
  const rawPlanta = getParam('planta') ?? getParam('planta_id') ?? getParam('plantaId');
  const planta = parsearId(rawPlanta);

  const rawSector = getParam('sector') ?? getParam('sector_id') ?? getParam('sectorId');
  const sector = parsearId(rawSector);

  // 4. Vista
  const rawVista = getParam('vista');
  let vista: VistaReporte = 'indicadores';
  if (rawVista && VISTAS_VALIDAS.has(rawVista)) {
    vista = rawVista as VistaReporte;
  }

  // 5. Agrupar
  const rawAgrupar = getParam('agrupar');
  let agrupar: AgrupacionReporte = 'ejecucion';
  if (rawAgrupar && AGRUPACIONES_VALIDAS.has(rawAgrupar)) {
    agrupar = rawAgrupar as AgrupacionReporte;
  }

  return {
    periodo,
    desde,
    hasta,
    planta,
    sector,
    vista,
    agrupar,
  };
}

/**
 * Escribe los filtros en URLSearchParams.
 * Los valores por omisión no se escriben para mantener la URL limpia.
 */
export function escribirFiltrosReportes(f: FiltrosReportes): URLSearchParams {
  const params = new URLSearchParams();

  if (f.periodo !== '30d') {
    params.set('periodo', f.periodo);
  }

  if (f.periodo === 'personalizado') {
    if (f.desde) params.set('desde', f.desde);
    if (f.hasta) params.set('hasta', f.hasta);
  }

  if (f.planta !== null && f.planta !== undefined && f.planta > 0) {
    params.set('planta', String(f.planta));
  }

  if (f.sector !== null && f.sector !== undefined && f.sector > 0) {
    params.set('sector', String(f.sector));
  }

  if (f.vista !== 'indicadores') {
    params.set('vista', f.vista);
  }

  if (f.agrupar !== 'ejecucion') {
    params.set('agrupar', f.agrupar);
  }

  return params;
}

/**
 * Calcula el rango de fechas en ISO respetando la hora local del navegador:
 * - Nd: desde ahora menos N días hasta ahora
 * - mes: desde el día 1 a las 00:00 hasta ahora
 * - mes-anterior: el mes calendario completo (del día 1 00:00 al día 1 00:00 de este mes)
 * - personalizado: desde las 00:00 del día desde hasta las 00:00 del día siguiente a hasta
 */
export function rangoDePeriodo(
  filtros: FiltrosReportes,
  ahoraInput: Date | string = new Date()
): { desde: string; hasta: string } {
  const ahora = typeof ahoraInput === 'string' ? new Date(ahoraInput) : ahoraInput;

  if (filtros.periodo === 'personalizado' && filtros.desde && filtros.hasta) {
    const [dY, dM, dD] = filtros.desde.split('-').map(Number);
    const [hY, hM, hD] = filtros.hasta.split('-').map(Number);

    const d = new Date(dY, dM - 1, dD, 0, 0, 0, 0);
    const h = new Date(hY, hM - 1, hD + 1, 0, 0, 0, 0);

    return {
      desde: d.toISOString(),
      hasta: h.toISOString(),
    };
  }

  if (filtros.periodo === 'mes') {
    const d = new Date(ahora.getFullYear(), ahora.getMonth(), 1, 0, 0, 0, 0);
    return {
      desde: d.toISOString(),
      hasta: ahora.toISOString(),
    };
  }

  if (filtros.periodo === 'mes-anterior') {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1, 0, 0, 0, 0);
    const h = new Date(ahora.getFullYear(), ahora.getMonth(), 1, 0, 0, 0, 0);
    return {
      desde: d.toISOString(),
      hasta: h.toISOString(),
    };
  }

  // Días hacia atrás (7d, 30d, 90d u omisión)
  let dias = 30;
  if (filtros.periodo === '7d') dias = 7;
  else if (filtros.periodo === '90d') dias = 90;

  const d = new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);
  return {
    desde: d.toISOString(),
    hasta: ahora.toISOString(),
  };
}

/**
 * Formato de porcentaje:
 * 0.99374 -> "99,4 %"
 * 1 -> "100 %"
 * null -> "—"
 */
export function formatPorcentaje(fraccion: number | null | undefined): string {
  if (fraccion === null || fraccion === undefined || isNaN(fraccion)) {
    return '—';
  }

  const pct = fraccion * 100;
  const redondeado1 = Number(pct.toFixed(1));

  if (Number.isInteger(redondeado1)) {
    return `${redondeado1} %`;
  }

  return `${redondeado1.toFixed(1).replace('.', ',')} %`;
}

/**
 * Formato de horas:
 * 239 -> "239 h"
 * 12.5 -> "12,5 h"
 * null -> "—"
 */
export function formatHoras(horas: number | null | undefined): string {
  if (horas === null || horas === undefined || isNaN(horas)) {
    return '—';
  }

  const h = Number(horas);
  if (Number.isInteger(h)) {
    return `${h} h`;
  }

  const redondeado = Number(h.toFixed(1));
  if (Number.isInteger(redondeado)) {
    return `${redondeado} h`;
  }

  return `${redondeado.toFixed(1).replace('.', ',')} h`;
}

export interface FilaInactividadBarra {
  correctivo?: number;
  correctivo_minutos?: number;
  preventivo?: number;
  preventivo_minutos?: number;
  por_tipo?: {
    CORRECTIVO?: number;
    PREVENTIVO?: number;
  };
}

/**
 * Calcula el ancho porcentual de las barras de inactividad por fila.
 * La fila con más inactividad ocupa el 100 %. Si todas están en 0, todo da 0.
 */
export function barrasInactividad(
  filas: FilaInactividadBarra[]
): Array<{ correctivo: number; preventivo: number }> {
  if (filas.length === 0) return [];

  const desgloses = filas.map((fila) => {
    const corr = Number(fila.correctivo ?? fila.correctivo_minutos ?? fila.por_tipo?.CORRECTIVO ?? 0);
    const prev = Number(fila.preventivo ?? fila.preventivo_minutos ?? fila.por_tipo?.PREVENTIVO ?? 0);
    const total = corr + prev;
    return { corr, prev, total };
  });

  const maxTotal = Math.max(0, ...desgloses.map((d) => d.total));

  if (maxTotal === 0) {
    return desgloses.map(() => ({ correctivo: 0, preventivo: 0 }));
  }

  return desgloses.map(({ corr, prev }) => {
    const cPct = (corr / maxTotal) * 100;
    const pPct = (prev / maxTotal) * 100;
    return {
      correctivo: Number(cPct.toFixed(1)),
      preventivo: Number(pPct.toFixed(1)),
    };
  });
}

/**
 * Formatea una celda para CSV en castellano (separador ;, decimales con coma, comillas si hace falta).
 */
function formatearCeldaCsv(valor: any): string {
  if (valor === null || valor === undefined) {
    return '';
  }

  if (typeof valor === 'number') {
    return String(valor).replace('.', ',');
  }

  const str = String(valor);
  if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Genera un archivo CSV compatible con Excel en castellano:
 * - Empieza con BOM (\uFEFF)
 * - Separador ';'
 * - Comillas dobles escapadas ("")
 * - Decimales con coma
 * - Saltos de línea \r\n
 */
export function aCsv(columnas: string[], filas: any[][]): string {
  const encabezado = columnas.map(formatearCeldaCsv).join(';');
  const lineas = filas.map((fila) => fila.map(formatearCeldaCsv).join(';'));
  const cuerpo = [encabezado, ...lineas].join('\r\n') + '\r\n';
  return '\uFEFF' + cuerpo;
}

function fechaLocalYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Genera el nombre del archivo de descarga:
 * Ejemplo: reporte-inactividad-2026-10-06-a-2026-11-05.csv
 * Usa fechas locales con el último día incluido (restando 1 segundo si cae a medianoche).
 */
export function nombreArchivoReporte(vista: string, desde: string, hasta: string): string {
  const dDate = new Date(desde);
  const hDate = new Date(hasta);
  const hDateInclusive = (() => {
    if (hDate.getHours() === 0 && hDate.getMinutes() === 0 && hDate.getSeconds() === 0) {
      return new Date(hDate.getTime() - 1000);
    }
    return hDate;
  })();
  const d = fechaLocalYMD(dDate);
  const h = fechaLocalYMD(hDateInclusive);
  return `reporte-${vista}-${d}-a-${h}.csv`;
}

export interface FilaTiemposVisual {
  grupo: string;
  cantidad: number;
  espera_promedio_minutos: number | null;
  duracion_neta_promedio_minutos: number | null;
  duracion_bruta_promedio_minutos: number | null;
  duracion_neta_total_minutos: number | null;
}

/**
 * Transforma una fila de tiempos de la API a su representación visual/CSV.
 */
export function filaTiempos(fila: any, agrupar: AgrupacionTiempos): FilaTiemposVisual {
  let grupo = 'Sin definir';
  if (agrupar === 'ejecucion') {
    const val = fila.ejecucion ?? fila.grupo;
    if (val === 'INTERNA') grupo = 'Interna';
    else if (val === 'EXTERNA') grupo = 'Externa';
    else grupo = 'Sin definir';
  } else if (agrupar === 'tipo') {
    grupo = fila.tipo?.nombre ?? fila.grupo ?? 'Sin definir';
  } else if (agrupar === 'sector') {
    grupo = fila.sector?.nombre ?? fila.grupo ?? 'Sin definir';
  }

  return {
    grupo,
    cantidad: Number(fila.cantidad ?? 0),
    espera_promedio_minutos:
      fila.espera_promedio_minutos !== undefined && fila.espera_promedio_minutos !== null
        ? Number(fila.espera_promedio_minutos)
        : fila.respuesta_promedio_minutos !== undefined && fila.respuesta_promedio_minutos !== null
          ? Number(fila.respuesta_promedio_minutos)
          : null,
    duracion_neta_promedio_minutos:
      fila.duracion_neta_promedio_minutos !== undefined && fila.duracion_neta_promedio_minutos !== null
        ? Number(fila.duracion_neta_promedio_minutos)
        : null,
    duracion_bruta_promedio_minutos:
      fila.duracion_bruta_promedio_minutos !== undefined && fila.duracion_bruta_promedio_minutos !== null
        ? Number(fila.duracion_bruta_promedio_minutos)
        : null,
    duracion_neta_total_minutos:
      fila.duracion_neta_total_minutos !== undefined && fila.duracion_neta_total_minutos !== null
        ? Number(fila.duracion_neta_total_minutos)
        : null,
  };
}

/**
 * Descarga en el navegador un archivo de texto/csv creado dinámicamente.
 */
export function descargarCsv(nombreArchivo: string, contenidoCsv: string) {
  const blob = new Blob([contenidoCsv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.setAttribute('download', nombreArchivo);
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

/**
 * Formato corto de fecha DD/MM/YYYY en hora local.
 */
export function formatFechaCorta(fecha?: string | Date | null): string {
  if (!fecha) return '—';
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha;
  if (isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export interface DatosReporteRepuestos {
  ve_costos?: boolean;
  por_repuesto?: Array<{
    repuesto: { id?: number; codigo?: string | null; nombre: string; unidad: string };
    cantidad: number;
    consumos: number;
    intervenciones: number;
    importe?: number | null;
  }>;
}

/**
 * Devuelve { columnas, filas } para la tabla y el CSV de repuestos más usados.
 * Si ve_costos es false, la columna Importe no se incluye.
 */
export function filasReporteRepuestos(datos?: DatosReporteRepuestos | null): {
  columnas: string[];
  filas: any[][];
} {
  const veCostos = Boolean(datos?.ve_costos);
  const columnas = veCostos
    ? ['Repuesto', 'Cantidad', 'Unidad', 'Consumos', 'Intervenciones', 'Importe']
    : ['Repuesto', 'Cantidad', 'Unidad', 'Consumos', 'Intervenciones'];

  const items = datos?.por_repuesto || [];
  const filas = items.map((item) => {
    const r = item.repuesto;
    const nombre = r.codigo ? `${r.codigo} · ${r.nombre}` : r.nombre;
    const base: any[] = [nombre, item.cantidad, r.unidad, item.consumos, item.intervenciones];
    if (veCostos) {
      base.push(item.importe ?? null);
    }
    return base;
  });

  return { columnas, filas };
}



/**
 * La pestaña Costos solo se muestra con COSTOS_VER. Sin ese permiso,
 * vista=costos vuelve a Indicadores.
 */
export function vistaReporteVisible(vista: VistaReporte, veCostos: boolean): VistaReporte {
  return vista === 'costos' && !veCostos ? 'indicadores' : vista;
}

export interface DatosReporteCostos {
  por_maquina?: Array<{
    maquina: { id?: number; codigo?: string | null; nombre: string };
    sector?: { id?: number; nombre: string } | null;
    repuestos: number;
    mano_obra: number;
    otros: number;
    total: number;
  }>;
}

/**
 * Devuelve { columnas, filas } para la tabla y el CSV de costos por máquina.
 */
export function filasReporteCostos(datos?: DatosReporteCostos | null): {
  columnas: string[];
  filas: Array<Array<string | number>>;
} {
  const columnas = ['Máquina', 'Sector', 'Repuestos', 'Mano de obra', 'Otros', 'Total'];
  const filas = (datos?.por_maquina || []).map((m) => {
    const nombre = m.maquina.codigo ? `${m.maquina.codigo} · ${m.maquina.nombre}` : m.maquina.nombre;
    return [nombre, m.sector?.nombre || '—', m.repuestos, m.mano_obra, m.otros, m.total];
  });
  return { columnas, filas };
}

/**
 * Devuelve una agrupación válida para Tiempos ('ejecucion' | 'tipo' | 'sector').
 */
export function agruparDeTiempos(agrupar?: string | null): AgrupacionTiempos {
  if (agrupar === 'ejecucion' || agrupar === 'tipo' || agrupar === 'sector') {
    return agrupar;
  }
  return 'ejecucion';
}

/**
 * Devuelve una agrupación válida para Preventivos ('sector' | 'maquina' | 'plan').
 */
export function agruparDePreventivos(agrupar?: string | null): AgrupacionPreventivos {
  if (agrupar === 'sector' || agrupar === 'maquina' || agrupar === 'plan') {
    return agrupar;
  }
  return 'sector';
}

/**
 * Formato del porcentaje de cumplimiento (Etapa R1, sección 3):
 * 81 -> "81,0 %"
 * 81.25 -> "81,3 %"
 * null -> "—"
 */
export function textoCumplimiento(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || isNaN(valor)) {
    return '—';
  }
  return `${Number(valor).toFixed(1).replace('.', ',')} %`;
}

/**
 * Color del porcentaje de cumplimiento (Etapa R1, sección 3):
 * >= 90: 'green'
 * >= 70: 'yellow'
 * < 70: 'red'
 * null: 'gray'
 */
export function colorCumplimiento(valor: number | null | undefined): 'green' | 'yellow' | 'red' | 'gray' {
  if (valor === null || valor === undefined || isNaN(valor)) {
    return 'gray';
  }
  if (valor >= 90) return 'green';
  if (valor >= 70) return 'yellow';
  return 'red';
}

/**
 * Formato del atraso promedio en días:
 * 3.5 -> "3,5 días"
 * 1 -> "1 día"
 * null -> "—"
 */
export function textoAtrasoPromedio(dias: number | null | undefined): string {
  if (dias === null || dias === undefined || isNaN(dias)) {
    return '—';
  }
  const redondeado = Number(Number(dias).toFixed(1));
  return `${formatCantidad(redondeado)} ${redondeado === 1 ? 'día' : 'días'}`;
}

/**
 * Nombre visual del grupo en el reporte de preventivos (Etapa R1, sección 3):
 * - sector: "Pintura"
 * - maquina: "PIN-01 · Cámara de pintura" (o solo el nombre si no tiene código)
 * - plan: "Plan mensual (PIN-01)" (o el nombre de la máquina si no tiene código)
 */
export function nombreGrupoPreventivos(
  grupo: Partial<GrupoCumplimientoPreventivos> & Record<string, any>,
  agrupar: AgrupacionPreventivos
): string {
  if (agrupar === 'sector') {
    return grupo.sector?.nombre ?? '—';
  }
  if (agrupar === 'maquina') {
    const m = grupo.maquina;
    if (!m) return '—';
    return m.codigo ? `${m.codigo} · ${m.nombre}` : m.nombre;
  }
  const p = grupo.plan;
  const m = grupo.maquina;
  if (!p) return '—';
  const refMaquina = m?.codigo || m?.nombre;
  return refMaquina ? `${p.nombre} (${refMaquina})` : p.nombre;
}

/**
 * Devuelve { columnas, filas } para el CSV del reporte de preventivos (Etapa R1, sección 3).
 */
export function filasReportePreventivos(
  datos: GrupoCumplimientoPreventivos[] | { grupos?: GrupoCumplimientoPreventivos[] } | null | undefined,
  agrupar: AgrupacionPreventivos
): {
  columnas: string[];
  filas: Array<Array<string | number | null>>;
} {
  const columnas = ['Grupo', 'Hechas', 'A tiempo', 'Tarde', 'Vencidas sin hacer', 'Cumplimiento', 'Atraso'];
  const grupos = Array.isArray(datos) ? datos : datos?.grupos || [];
  const filas = grupos.map((g) => [
    nombreGrupoPreventivos(g, agrupar),
    g.hechas,
    g.a_tiempo,
    g.tarde,
    g.vencidas_sin_hacer,
    g.cumplimiento,
    g.atraso_promedio_dias,
  ]);
  return { columnas, filas };
}

