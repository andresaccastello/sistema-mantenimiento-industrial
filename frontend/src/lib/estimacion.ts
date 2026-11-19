/**
 * Etapa HE1: el horómetro estimado (D-032). El ritmo de uso, la fecha estimada de una tarea y el
 * evento ESTIMADA del calendario. Lógica pura, sin React.
 */
import type { EstimacionTarea, PeriodoUso, RitmoMedidor, UsoEstimado } from '../api/tipos';

/** Días de cada período: la semana de 7 y el mes de 30, como en la API (1.1). */
export const DIAS_PERIODO: Record<PeriodoUso, number> = { DIA: 1, SEMANA: 7, MES: 30 };

/** Las opciones del selector del formulario (6). */
export const OPCIONES_PERIODO: Array<{ value: PeriodoUso; label: string }> = [
  { value: 'DIA', label: 'por día' },
  { value: 'SEMANA', label: 'por semana' },
  { value: 'MES', label: 'por mes' },
];

export const AYUDA_USO_ESTIMADO = 'Se usa para estimar cuándo toca cada tarea hasta que haya lecturas suficientes';

/** Un número en castellano, con hasta `decimales` decimales: "5,7", "1.250". */
export function numeroAR(n: number, decimales: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: decimales });
}

/** Un ritmo por día pasado a un período: 5,714 por día son 40 por semana. */
export function porDiaAPeriodo(porDia: number, periodo: PeriodoUso): number {
  return porDia * DIAS_PERIODO[periodo];
}

/** Un valor por período pasado a por día: 40 por semana son 5,714 por día. */
export function periodoAPorDia(valor: number, periodo: PeriodoUso): number {
  return valor / DIAS_PERIODO[periodo];
}

/** El desvío se muestra solo si el real se aparta más de un 25 % del declarado (D-032, 3). */
export function mostrarDesvio(desvioPct: number | null | undefined): boolean {
  return desvioPct !== null && desvioPct !== undefined && Math.abs(desvioPct) > 25;
}

/**
 * "Actualizar declarado": el ritmo real pasado al período que ya tenía elegido, redondeado a un
 * decimal. Sin declarado previo, por semana.
 */
export function propuestaDeclarado(ritmoPorDia: number, periodo: PeriodoUso | null): UsoEstimado {
  const p = periodo ?? 'SEMANA';
  return { valor: Math.round(porDiaAPeriodo(ritmoPorDia, p) * 10) / 10, periodo: p };
}

/**
 * El uso estimado del formulario: vacío es null; si no, un número mayor que 0 con hasta 2
 * decimales, como pide la API.
 */
export function usoDelFormulario(
  valor: number | string | null | undefined,
  periodo: PeriodoUso
): { uso: UsoEstimado | null; error: string | null } {
  if (valor === null || valor === undefined || String(valor).trim() === '') return { uso: null, error: null };
  const n = typeof valor === 'number' ? valor : Number(String(valor).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 999999999999.99) {
    return { uso: null, error: 'Ingresá un número mayor que 0, o dejalo vacío.' };
  }
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    return { uso: null, error: 'Como mucho, 2 decimales.' };
  }
  return { uso: { valor: n, periodo }, error: null };
}

/** Si el uso declarado cambió: para mandarlo en el PATCH solo cuando hace falta. */
export function cambioUso(antes: UsoEstimado | null, despues: UsoEstimado | null): boolean {
  if (antes === null || despues === null) return antes !== despues;
  return antes.valor !== despues.valor || antes.periodo !== despues.periodo;
}

/** "40 h por semana". */
export function textoUsoDeclarado(uso: UsoEstimado, unidad: string): string {
  const periodo = OPCIONES_PERIODO.find((o) => o.value === uso.periodo)?.label ?? '';
  return `${numeroAR(uso.valor, 2)} ${unidad} ${periodo}`;
}

/** "dd/mm" de una fecha YYYY-MM-DD. */
function diaMes(fecha: string): string {
  const [, m, d] = fecha.split('-');
  return `${d}/${m}`;
}

/** La fecha local, YYYY-MM-DD, de un momento de la API. */
function fechaLocal(iso: string): string {
  const d = new Date(iso);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** "13 al 20/11", o "28/10 al 20/11" si cambia el mes. */
export function textoPeriodoLecturas(desde: string, hasta: string): string {
  const a = fechaLocal(desde);
  const b = fechaLocal(hasta);
  const inicio = a.slice(0, 7) === b.slice(0, 7) ? String(Number(a.slice(8, 10))) : diaMes(a);
  return `${inicio} al ${diaMes(b)}`;
}

/** "+21 %", "-50 %". */
export function textoDesvio(desvioPct: number): string {
  return `${desvioPct > 0 ? '+' : ''}${desvioPct} %`;
}

/**
 * La línea del ritmo en el medidor (6):
 * - "Ritmo: 5,7 h/día (declarado: 40 h por semana)";
 * - "Ritmo: 6,9 h/día según lecturas (13 al 20/11) · declarado 5,7 h/día, +21 %";
 * - "Sin ritmo: cargá el uso estimado o al menos 3 lecturas en 7 días".
 */
export function textoRitmo(ritmo: RitmoMedidor | null, usoEstimado: UsoEstimado | null, unidad: string): string {
  if (!ritmo) return 'Sin ritmo: cargá el uso estimado o al menos 3 lecturas en 7 días';
  const porDia = `${numeroAR(ritmo.por_dia, 1)} ${unidad}/día`;
  if (ritmo.fuente === 'DECLARADO') {
    return usoEstimado ? `Ritmo: ${porDia} (declarado: ${textoUsoDeclarado(usoEstimado, unidad)})` : `Ritmo: ${porDia} (declarado)`;
  }
  let texto = `Ritmo: ${porDia} según lecturas`;
  if (ritmo.lecturas) texto += ` (${textoPeriodoLecturas(ritmo.lecturas.desde, ritmo.lecturas.hasta)})`;
  if (ritmo.declarado_por_dia !== null) {
    texto += ` · declarado ${numeroAR(ritmo.declarado_por_dia, 1)} ${unidad}/día`;
    if (ritmo.desvio_pct !== null) texto += `, ${textoDesvio(ritmo.desvio_pct)}`;
  }
  return texto;
}

/** "≈ 117 h hoy (estimado)". */
export function textoValorEstimado(valor: number, unidad: string): string {
  return `≈ ${numeroAR(Math.round(valor), 0)} ${unidad} hoy (estimado)`;
}

/** "≈ 06/12". */
export function formatoEstimada(fecha: string): string {
  return `≈ ${diaMes(fecha)}`;
}

/** El texto de la fuente: "declarado" o "según lecturas". */
export function textoFuente(fuente: EstimacionTarea['fuente']): string {
  return fuente === 'DECLARADO' ? 'declarado' : 'según lecturas';
}

/** El tooltip de la fecha estimada: "Estimada con 5,7 h/día (declarado)". */
export function tooltipEstimada(e: EstimacionTarea, unidad: string): string {
  return `Estimada con ${numeroAR(e.ritmo_por_dia, 1)} ${unidad}/día (${textoFuente(e.fuente)})`;
}

export const TEXTO_ESTIMADA_PASADA = 'Ya debería haber llegado: cargá una lectura';
export const TEXTO_CHIP_POR_USO = 'Por el ritmo, ya debería estar cerca';

/**
 * En el panel del día: "Vence al llegar a 200 h · estimada con 5,7 h/día (declarado)".
 */
export function textoPanelEstimada(proximo: number, unidad: string, e: EstimacionTarea): string {
  return `Vence al llegar a ${numeroAR(proximo, 2)} ${unidad} · estimada con ${numeroAR(e.ritmo_por_dia, 1)} ${unidad}/día (${textoFuente(e.fuente)})`;
}

/** El evento ESTIMADA: un color propio, que no usa ningún otro tipo, y su etiqueta. */
export const COLOR_ESTIMADA = 'violet';
export const ETIQUETA_ESTIMADA = 'Estimada por uso';

/** La entrada de la leyenda del calendario para el tipo nuevo. */
export const LEYENDA_ESTIMADA = { texto: ETIQUETA_ESTIMADA, color: COLOR_ESTIMADA, estimada: true as const };

/** En ListaPorUso: la fecha estimada, o "sin estimación". */
export function textoEstimacionLista(e: EstimacionTarea | null): string {
  if (!e) return 'sin estimación';
  return `${formatoEstimada(e.fecha)} (estimada)`;
}
