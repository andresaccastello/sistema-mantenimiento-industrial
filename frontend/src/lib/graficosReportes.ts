/**
 * Etapa GR1, 4 (D-036): los datos y los títulos de los gráficos de cada pestaña de Reportes, a
 * partir de las respuestas de la API. Sin React: las pantallas solo dibujan lo que sale de acá.
 */
import type {
  EvolucionReporte,
  GrupoCumplimientoPreventivos,
  InactividadMaquinaFila,
  IndicadoresReporte,
  ReporteCostosRespuesta,
  ReporteRepuestosRespuesta,
  TiemposAgrupadosFila,
} from '../api/tipos';
import {
  AgrupacionEvolucion,
  COLOR_CORRECTIVO,
  COLOR_PREVENTIVO,
  ItemRanking,
  conclusionEvolucion,
  conclusionProporcion,
  conclusionRanking,
  etiquetaPeriodo,
  formatPesos,
  formatPesosEje,
  hayValores,
  topConOtras,
} from './graficos';
import { AgrupacionTiempos, AgrupacionPreventivos, filaTiempos, nombreGrupoPreventivos } from './reportes';

/** El ranking: 10 en la computadora y 5 en el celular. */
export function cantidadRanking(celular: boolean): number {
  return celular ? 5 : 10;
}

function porPeriodo(agrupar: AgrupacionEvolucion): string {
  return agrupar === 'mes' ? 'por mes' : 'por semana';
}

/** "01/09 al 07/09", para el título del tooltip de un período. */
function rangoPeriodo(p: { inicio: string; fin: string }): string {
  const corto = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
  return p.inicio === p.fin ? corto(p.inicio) : `${corto(p.inicio)} al ${corto(p.fin)}`;
}

/** Cómo se nombra una máquina en los gráficos: el código, o el nombre si no tiene. */
export function etiquetaMaquina(m: { codigo: string | null; nombre: string }): string {
  return m.codigo && m.codigo.trim() !== '' ? m.codigo : m.nombre;
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

export interface FilaEvolucion {
  etiqueta: string;
  titulo: string;
  fallas: number;
  preventivas: number;
  disponibilidad: number | null;
  [clave: string]: string | number | null;
}

/** La evolución: fallas y preventivas hechas en barras, y la disponibilidad en línea. */
export function filasEvolucion(evolucion: EvolucionReporte): FilaEvolucion[] {
  return evolucion.periodos.map((p) => ({
    etiqueta: etiquetaPeriodo(p.inicio, evolucion.agrupar),
    titulo: rangoPeriodo(p),
    fallas: p.fallas,
    preventivas: p.preventivas_finalizadas,
    disponibilidad: p.disponibilidad,
  }));
}

/** El título de la evolución: lo que pasó con las fallas, o uno descriptivo. */
export function tituloEvolucion(evolucion: EvolucionReporte): string {
  return (
    conclusionEvolucion(
      evolucion.periodos,
      evolucion.periodos.map((p) => p.fallas),
      evolucion.agrupar,
      { texto: 'Las fallas', plural: true }
    ) ?? `Fallas y preventivas hechas ${porPeriodo(evolucion.agrupar)}`
  );
}

export function evolucionVacia(evolucion: EvolucionReporte): boolean {
  return !hayValores(evolucion.periodos.flatMap((p) => [p.fallas, p.preventivas_finalizadas, p.inactividad_minutos]));
}

/** La inactividad correctiva contra la preventiva, de /indicadores. */
export function partesInactividad(
  ind: IndicadoresReporte
): { clave: string; etiqueta: string; valor: number; color: string }[] {
  return [
    { clave: 'correctiva', etiqueta: 'Correctiva', valor: ind.inactividad_correctiva_minutos, color: COLOR_CORRECTIVO },
    { clave: 'preventiva', etiqueta: 'Preventiva', valor: ind.inactividad_preventiva_minutos, color: COLOR_PREVENTIVO },
  ];
}

export function tituloInactividadTipo(ind: IndicadoresReporte): string {
  return conclusionProporcion(partesInactividad(ind), 'la inactividad') ?? 'Inactividad correctiva y preventiva';
}

// ---------------------------------------------------------------------------
// Inactividad
// ---------------------------------------------------------------------------

export function itemsInactividad(filas: InactividadMaquinaFila[]): ItemRanking[] {
  return filas.map((f) => ({ clave: String(f.maquina.id), etiqueta: etiquetaMaquina(f.maquina), valor: f.inactividad_minutos }));
}

/** Las N máquinas con más horas paradas, con "Otras", y su título. */
export function rankingInactividad(filas: InactividadMaquinaFila[], n: number): { items: ItemRanking[]; titulo: string } {
  const todos = itemsInactividad(filas).filter((i) => i.valor > 0);
  return {
    items: topConOtras(todos, n),
    titulo:
      conclusionRanking(todos, 'de las horas paradas', 'Ninguna máquina') ??
      `Las ${n} máquinas con más horas paradas`,
  };
}

// ---------------------------------------------------------------------------
// Tiempos
// ---------------------------------------------------------------------------

const NOMBRE_AGRUPAR_TIEMPOS: Record<AgrupacionTiempos, string> = {
  ejecucion: 'ejecución',
  tipo: 'tipo',
  sector: 'sector',
};

/**
 * Los promedios de cada grupo: espera (la respuesta), trabajo (la duración neta) y total (la
 * espera más la duración bruta: desde que se reportó hasta que terminó).
 */
export function filasTiemposGrafico(data: TiemposAgrupadosFila[], agrupar: AgrupacionTiempos) {
  return data.map((t) => {
    const f = filaTiempos(t, agrupar);
    const espera = f.espera_promedio_minutos ?? 0;
    return {
      etiqueta: f.grupo,
      espera,
      trabajo: f.duracion_neta_promedio_minutos ?? 0,
      total: espera + (f.duracion_bruta_promedio_minutos ?? 0),
    };
  });
}

export function tituloTiempos(agrupar: AgrupacionTiempos): string {
  return `Promedio de espera, trabajo y total por ${NOMBRE_AGRUPAR_TIEMPOS[agrupar]}`;
}

// ---------------------------------------------------------------------------
// Repuestos
// ---------------------------------------------------------------------------

/**
 * Los N repuestos con más importe usado. Sin importes (sin COSTOS_VER), por consumos: las veces
 * que se usó cada uno.
 */
export function rankingRepuestos(
  datos: ReporteRepuestosRespuesta,
  n: number
): { items: ItemRanking[]; titulo: string; porImporte: boolean } {
  const porImporte = datos.ve_costos;
  const todos = datos.por_repuesto
    .map((r) => ({
      clave: String(r.repuesto.id),
      etiqueta: r.repuesto.codigo && r.repuesto.codigo.trim() !== '' ? r.repuesto.codigo : r.repuesto.nombre,
      valor: porImporte ? (r.importe ?? 0) : r.consumos,
    }))
    .filter((i) => i.valor > 0);
  const titulo = porImporte
    ? (conclusionRanking(todos, 'del importe usado', 'Ningún repuesto') ?? `Los ${n} repuestos con más importe usado`)
    : (conclusionRanking(todos, 'de los consumos', 'Ningún repuesto') ?? `Los ${n} repuestos más usados`);
  return { items: topConOtras(todos, n, 'Otros'), titulo, porImporte };
}

// ---------------------------------------------------------------------------
// Preventivos
// ---------------------------------------------------------------------------

const NOMBRE_AGRUPAR_PREVENTIVOS: Record<AgrupacionPreventivos, string> = {
  sector: 'sector',
  maquina: 'máquina',
  plan: 'plan',
};

/**
 * El cumplimiento (de 0 a 100) de cada grupo, de menor a mayor: los N más bajos, que son los que
 * hay que mirar. Los grupos sin cumplimiento (nada para medir) no van.
 */
export function rankingCumplimiento(
  grupos: GrupoCumplimientoPreventivos[],
  agrupar: AgrupacionPreventivos,
  n: number
): { items: ItemRanking[]; titulo: string } {
  const medibles = grupos
    .filter((g) => g.cumplimiento !== null && g.cumplimiento !== undefined)
    .map((g, i) => ({
      clave: String(i),
      etiqueta: nombreGrupoPreventivos(g, agrupar),
      valor: Math.max(0, Math.min(100, Number(g.cumplimiento))),
    }))
    .sort((a, b) => a.valor - b.valor);
  const nombre = NOMBRE_AGRUPAR_PREVENTIVOS[agrupar];
  return {
    items: medibles.slice(0, n),
    titulo: medibles.length > n ? `Cumplimiento por ${nombre}: los ${n} más bajos` : `Cumplimiento por ${nombre}`,
  };
}

// ---------------------------------------------------------------------------
// Costos
// ---------------------------------------------------------------------------

export interface FilaCostoPeriodo {
  etiqueta: string;
  titulo: string;
  repuestos: number;
  mano_obra: number;
  servicio_externo: number;
  /** Transporte, otro y ajuste juntos; nunca negativo. */
  otros: number;
  /** Lo que daba "otros" antes de recortarlo a 0. */
  otros_real: number;
  otros_recortado: boolean;
  [clave: string]: string | number | boolean;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * El costo de cada período, partido por tipo. Un ajuste negativo va sumado a "otros"; si eso deja
 * "otros" en negativo, se dibuja 0 y el tooltip lo aclara.
 */
export function filasCostoPeriodo(evolucion: EvolucionReporte): FilaCostoPeriodo[] {
  return evolucion.periodos.map((p) => {
    const c = p.costo ?? { repuestos: 0, mano_obra: 0, servicio_externo: 0, transporte: 0, otro: 0, ajuste: 0, total: 0 };
    const otrosReal = centavos(c.transporte + c.otro + c.ajuste);
    return {
      etiqueta: etiquetaPeriodo(p.inicio, evolucion.agrupar),
      titulo: rangoPeriodo(p),
      repuestos: c.repuestos,
      mano_obra: c.mano_obra,
      servicio_externo: c.servicio_externo,
      otros: Math.max(0, otrosReal),
      otros_real: otrosReal,
      otros_recortado: otrosReal < 0,
    };
  });
}

/** La aclaración del tooltip cuando "otros" se recortó a 0. */
export function notaOtrosRecortado(fila: { otros_real: number; otros_recortado: boolean }): string | null {
  return fila.otros_recortado
    ? `Otros dio ${formatPesos(fila.otros_real)} por un ajuste negativo: se muestra en 0.`
    : null;
}

export function tituloCostoPeriodo(evolucion: EvolucionReporte): string {
  return (
    conclusionEvolucion(
      evolucion.periodos,
      evolucion.periodos.map((p) => p.costo?.total ?? 0),
      evolucion.agrupar,
      { texto: 'El costo', plural: false },
      formatPesosEje
    ) ?? `Costo ${porPeriodo(evolucion.agrupar)}, por tipo`
  );
}

export function costoPeriodoVacio(evolucion: EvolucionReporte): boolean {
  return !hayValores(evolucion.periodos.map((p) => p.costo?.total ?? 0));
}

/** Las N máquinas que más costaron, con "Otras", y su título. */
export function rankingCostosMaquinas(datos: ReporteCostosRespuesta, n: number): { items: ItemRanking[]; titulo: string } {
  const todos = datos.por_maquina
    .map((m) => ({ clave: String(m.maquina.id), etiqueta: etiquetaMaquina(m.maquina), valor: m.total }))
    .filter((i) => i.valor > 0);
  return {
    items: topConOtras(todos, n),
    titulo: conclusionRanking(todos, 'del costo', 'Ninguna máquina') ?? `Las ${n} máquinas que más costaron`,
  };
}

// ---------------------------------------------------------------------------
// El resumen del celular
// ---------------------------------------------------------------------------

/** Con 7 días hay una sola semana: en lugar del gráfico, este texto. */
export const TEXTO_EVOLUCION_7_DIAS = 'Elegí 30 días para ver la evolución';

/** El título de las fallas por semana del resumen: lo que pasó, o uno descriptivo. */
export function tituloFallasSemana(evolucion: EvolucionReporte): string {
  return (
    conclusionEvolucion(
      evolucion.periodos,
      evolucion.periodos.map((p) => p.fallas),
      evolucion.agrupar,
      { texto: 'Las fallas', plural: true }
    ) ?? `Fallas ${porPeriodo(evolucion.agrupar)}`
  );
}

/** Las fallas por semana, en barras solas. */
export function filasFallasSemana(evolucion: EvolucionReporte) {
  return evolucion.periodos.map((p) => ({
    etiqueta: etiquetaPeriodo(p.inicio, evolucion.agrupar),
    titulo: rangoPeriodo(p),
    fallas: p.fallas,
  }));
}
