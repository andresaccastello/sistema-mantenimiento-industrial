/**
 * Lógica pura de la ronda de lecturas (Etapa LE1, sección 4.6, D-030).
 *
 * La unidad es la del medidor, tal como se cargó: "faltan 160 horas".
 */
import type { MedidorRonda, ResultadoLecturaRonda, TareaRonda } from '../api/tipos';
import { leerValorMedidor, textoValorMedidor } from './medidores';

// ---------------------------------------------------------------------------
// Qué se manda
// ---------------------------------------------------------------------------

/** Lo escrito en cada campo, por id de medidor. */
export type ValoresRonda = Record<number, string | number | null | undefined>;

export interface LecturaAMandar {
  medidor_id: number;
  valor: number;
  observacion: null;
}

function vacio(valor: unknown): boolean {
  return valor === null || valor === undefined || String(valor).trim() === '';
}

/**
 * El error de un campo antes de mandar, o null si está bien o vacío:
 * "Menor que la última (12.340 horas)".
 */
export function errorValorRonda(
  valor: string | number | null | undefined,
  medidor: Pick<MedidorRonda, 'ultima' | 'unidad'>
): string | null {
  if (vacio(valor)) return null;
  const n = leerValorMedidor(valor);
  if (n === null) return 'Ingresá un número desde 0, con hasta 2 decimales.';
  if (medidor.ultima && n < medidor.ultima.valor) {
    return `Menor que la última (${textoValorMedidor(medidor.ultima.valor, medidor.unidad)})`;
  }
  return null;
}

/** Las lecturas que se mandan: las de campos completos, sin las que tienen un error. */
export function lecturasAMandar(medidores: readonly MedidorRonda[], valores: ValoresRonda): LecturaAMandar[] {
  const lista: LecturaAMandar[] = [];
  for (const m of medidores) {
    const escrito = valores[m.id];
    if (vacio(escrito) || errorValorRonda(escrito, m) !== null) continue;
    lista.push({ medidor_id: m.id, valor: leerValorMedidor(escrito) as number, observacion: null });
  }
  return lista;
}

/** Cuántos campos tienen un error: con alguno, el botón no se habilita. */
export function camposConError(medidores: readonly MedidorRonda[], valores: ValoresRonda): number {
  return medidores.filter((m) => errorValorRonda(valores[m.id], m) !== null).length;
}

/** Cuántos campos tienen algo escrito, para avisar al salir. */
export function camposCompletos(valores: ValoresRonda): number {
  return Object.values(valores).filter((v) => !vacio(v)).length;
}

/** "Guardar 5 lecturas" en la computadora; "Guardar (5)" en el celular. */
export function textoBotonGuardar(cantidad: number, enCelular: boolean): string {
  if (enCelular) return `Guardar (${cantidad})`;
  return cantidad === 1 ? 'Guardar 1 lectura' : `Guardar ${cantidad} lecturas`;
}

/** "Tenés 3 lecturas sin guardar. ¿Salir igual?" */
export function textoSalirSinGuardar(cantidad: number): string {
  const lecturas = cantidad === 1 ? '1 lectura' : `${cantidad} lecturas`;
  return `Tenés ${lecturas} sin guardar. ¿Salir igual?`;
}

// ---------------------------------------------------------------------------
// Lo que se muestra de cada medidor
// ---------------------------------------------------------------------------

/** "hoy", "ayer", "hace 8 días". */
export function textoDiasSinLectura(dias: number): string {
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  return `hace ${dias} días`;
}

/** "Última: 12.340 horas · hace 8 días", o "Sin lecturas". */
export function textoUltimaRonda(m: Pick<MedidorRonda, 'ultima' | 'unidad' | 'dias_sin_lectura'>): string {
  if (!m.ultima) return 'Sin lecturas';
  return `Última: ${textoValorMedidor(m.ultima.valor, m.unidad)} · ${textoDiasSinLectura(m.dias_sin_lectura)}`;
}

/** "faltan 160 horas" o "se pasó por 20 horas"; sin lectura, null. */
export function textoFaltan(faltan: number | null, unidad: string): string | null {
  if (faltan === null) return null;
  return faltan < 0 ? `se pasó por ${textoValorMedidor(-faltan, unidad)}` : `faltan ${textoValorMedidor(faltan, unidad)}`;
}

/** "Cambiar aceite · faltan 160 horas". */
export function textoTareaRonda(t: Pick<TareaRonda, 'accion' | 'faltan_uso'>, unidad: string): string {
  const faltan = textoFaltan(t.faltan_uso, unidad);
  return faltan ? `${t.accion} · ${faltan}` : t.accion;
}

/** La tarea más cercana: la que menos le falta; sin lecturas, la primera. */
export function tareaMasCercana(tareas: readonly TareaRonda[]): TareaRonda | null {
  if (tareas.length === 0) return null;
  const conUso = tareas.filter((t) => t.faltan_uso !== null);
  if (conUso.length === 0) return tareas[0];
  return conUso.reduce((a, b) => ((b.faltan_uso as number) < (a.faltan_uso as number) ? b : a));
}

// ---------------------------------------------------------------------------
// 4.2 Después de guardar
// ---------------------------------------------------------------------------

export interface Consecuencia {
  texto: string;
  /** Con una intervención generada, para el enlace. */
  intervencionId?: number;
}

/**
 * Lo que cambió en un medidor guardado:
 * - "Cambiar aceite pasó a Próxima: faltan 105 horas" (si antes no estaba próxima; si ya lo
 *   estaba, "está Próxima");
 * - "Cambiar aceite está Vencida: se pasó por 20 horas";
 * - "Se generó la intervención N.º 85", una por intervención generada de sus planes.
 * Al día, sin lectura o ya en curso, no hay nada que contar.
 */
export function consecuenciasLectura(
  antes: readonly TareaRonda[],
  despues: readonly TareaRonda[],
  unidad: string,
  generadas: ReadonlyArray<{ plan_id: number; intervencion_id: number }>
): Consecuencia[] {
  const lineas: Consecuencia[] = [];
  for (const t of despues) {
    const previa = antes.find((x) => x.tarea_id === t.tarea_id);
    const faltan = textoFaltan(t.faltan_uso, unidad);
    if (t.estado === 'PROXIMA') {
      const verbo = previa?.estado === 'PROXIMA' ? 'está' : 'pasó a';
      lineas.push({ texto: `${t.accion} ${verbo} Próxima${faltan ? `: ${faltan}` : ''}` });
    } else if (t.estado === 'VENCIDA') {
      lineas.push({ texto: `${t.accion} está Vencida${faltan ? `: ${faltan}` : ''}` });
    }
  }
  const planes = new Set(despues.map((t) => t.plan.id));
  for (const g of generadas) {
    if (planes.has(g.plan_id)) {
      lineas.push({ texto: `Se generó la intervención N.º ${g.intervencion_id}`, intervencionId: g.intervencion_id });
    }
  }
  return lineas;
}

/** Las tareas que cambiaron de estado a uno de los dos que importan. */
function cambiosDeEstado(
  medidores: readonly MedidorRonda[],
  resultados: readonly ResultadoLecturaRonda[],
  estado: 'PROXIMA' | 'VENCIDA'
): number {
  let n = 0;
  for (const r of resultados) {
    if (!r.ok) continue;
    const antes = medidores.find((m) => m.id === r.medidor_id)?.tareas ?? [];
    for (const t of r.tareas) {
      const previa = antes.find((x) => x.tarea_id === t.tarea_id);
      if (t.estado === estado && previa?.estado !== estado) n++;
    }
  }
  return n;
}

/**
 * El aviso de arriba: "Se guardaron 4 lecturas. 1 no se pudo guardar." Si alguna tarea cambió
 * de estado, también: "2 tareas pasaron a próxima."
 */
export function resumenRonda(medidores: readonly MedidorRonda[], resultados: readonly ResultadoLecturaRonda[]): string {
  const guardadas = resultados.filter((r) => r.ok).length;
  const fallidas = resultados.length - guardadas;
  const partes: string[] = [];
  if (guardadas > 0) partes.push(guardadas === 1 ? 'Se guardó 1 lectura.' : `Se guardaron ${guardadas} lecturas.`);
  if (fallidas > 0) partes.push(fallidas === 1 ? '1 no se pudo guardar.' : `${fallidas} no se pudieron guardar.`);
  for (const [estado, nombre] of [['PROXIMA', 'próxima'], ['VENCIDA', 'vencida']] as const) {
    const n = cambiosDeEstado(medidores, resultados, estado);
    if (n > 0) partes.push(n === 1 ? `1 tarea pasó a ${nombre}.` : `${n} tareas pasaron a ${nombre}.`);
  }
  return partes.join(' ');
}

// ---------------------------------------------------------------------------
// 4.5 "Leer cada", en el formulario del medidor
// ---------------------------------------------------------------------------

/** Por omisión, un medidor nuevo se lee cada 7 días. */
export const LEER_CADA_POR_OMISION = 7;

/**
 * "Leer cada" escrito: vacío es null (sin aviso de atraso); si no, un entero de 1 a 365.
 * Inválido: undefined.
 */
export function leerCadaDias(valor: string | number | null | undefined): number | null | undefined {
  if (vacio(valor)) return null;
  const texto = String(valor).trim();
  if (!/^\d+$/.test(texto)) return undefined;
  const n = Number(texto);
  return n >= 1 && n <= 365 ? n : undefined;
}

/** El error de "Leer cada", o null si está bien. */
export function errorLeerCada(valor: string | number | null | undefined): string | null {
  return leerCadaDias(valor) === undefined ? 'Ingresá un número entero de días, de 1 a 365, o dejalo vacío.' : null;
}

// ---------------------------------------------------------------------------
// 4.5 Los filtros, en la URL
// ---------------------------------------------------------------------------

export interface FiltrosLecturas {
  planta_id: number | null;
  sector_id: number | null;
  maquina_id: number | null;
  solo_atrasados: boolean;
}

function idDe(texto: string | null): number | null {
  if (texto === null || !/^\d+$/.test(texto)) return null;
  const n = Number(texto);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Los filtros de `/lecturas?...`: lo que no es un id se ignora. */
export function leerFiltrosLecturas(params: URLSearchParams): FiltrosLecturas {
  return {
    planta_id: idDe(params.get('planta_id')),
    sector_id: idDe(params.get('sector_id')),
    maquina_id: idDe(params.get('maquina_id')),
    solo_atrasados: params.get('solo_atrasados') === 'true',
  };
}

/** Los parámetros de la URL y de la API: solo los que tienen valor. */
export function parametrosFiltrosLecturas(f: FiltrosLecturas): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.planta_id !== null) p.planta_id = String(f.planta_id);
  if (f.sector_id !== null) p.sector_id = String(f.sector_id);
  if (f.maquina_id !== null) p.maquina_id = String(f.maquina_id);
  if (f.solo_atrasados) p.solo_atrasados = 'true';
  return p;
}
