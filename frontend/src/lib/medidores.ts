/**
 * Lógica pura de medidores y lecturas (Etapa PV4, sección 2.3).
 *
 * La unidad la pasa siempre quien llama: viene del medidor.
 */
import type { LecturaMedidor } from '../api/tipos';
import { formatCantidad, formatFechaHora } from './formato';

/** El mayor valor de una lectura en la API: numeric(14,2). */
export const MAXIMO_VALOR_MEDIDOR = 999999999999.99;

/** Las unidades que se ofrecen; se puede escribir otra. */
export const UNIDADES_MEDIDOR = ['horas', 'km', 'ciclos', 'piezas'];

const MENSAJE_NUMERO = 'Ingresá un número desde 0, con hasta 2 decimales.';

function vacio(valor: unknown): boolean {
  return valor === null || valor === undefined || String(valor).trim() === '';
}

/**
 * Un valor de medidor escrito, como número: de 0 al máximo de la API y con hasta 2
 * decimales. Vacío o inválido: null. Acepta la coma decimal.
 */
export function leerValorMedidor(valor: number | string | null | undefined): number | null {
  if (vacio(valor)) return null;
  const n = typeof valor === 'number' ? valor : Number(String(valor).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > MAXIMO_VALOR_MEDIDOR) return null;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return null;
  return n;
}

/** "512,5 horas", "1.240 km". Sin unidad, solo el número. */
export function textoValorMedidor(valor: number, unidad: string): string {
  const numero = formatCantidad(valor);
  return unidad ? `${numero} ${unidad}` : numero;
}

/** La fecha, sin la hora, de un momento de la API: "10/11/2026". */
export function fechaDeMomento(iso: string | null | undefined): string {
  return formatFechaHora(iso).slice(0, 10);
}

/** "Última: 512,5 horas, el 10/11/2026", o null sin lecturas. */
export function textoUltimaLectura(ultima: { valor: number; registrada_en: string } | null, unidad: string): string | null {
  if (!ultima) return null;
  return `Última: ${textoValorMedidor(ultima.valor, unidad)}, el ${fechaDeMomento(ultima.registrada_en)}`;
}

// ---------------------------------------------------------------------------
// El medidor
// ---------------------------------------------------------------------------

export interface BorradorMedidor {
  nombre: string;
  unidad: string;
  /** Solo en el alta; vacía no se manda. */
  lecturaInicial: number | string;
}

export type ErroresMedidor = Partial<Record<'nombre' | 'unidad' | 'lecturaInicial', string>>;

export interface CuerpoMedidor {
  nombre?: string;
  unidad?: string;
  lectura_inicial?: number;
}

export function borradorMedidorVacio(): BorradorMedidor {
  return { nombre: '', unidad: '', lecturaInicial: '' };
}

/** Nombre de 3 a 60, unidad de 1 a 20 y lectura inicial vacía o válida. Vacío si está bien. */
export function validarMedidor(b: BorradorMedidor): ErroresMedidor {
  const errores: ErroresMedidor = {};
  const nombre = b.nombre.trim();
  if (nombre.length < 3 || nombre.length > 60) errores.nombre = 'Escribí el nombre (de 3 a 60 caracteres).';
  const unidad = b.unidad.trim();
  if (unidad.length < 1 || unidad.length > 20) errores.unidad = 'Escribí la unidad (de 1 a 20 caracteres).';
  if (!vacio(b.lecturaInicial) && leerValorMedidor(b.lecturaInicial) === null) errores.lecturaInicial = MENSAJE_NUMERO;
  return errores;
}

/**
 * Sin `original`, el alta (la máquina la suma quien llama). Con `original`, la edición:
 * solo el nombre o la unidad que cambiaron.
 */
export function cuerpoMedidor(b: BorradorMedidor, original?: BorradorMedidor): CuerpoMedidor {
  const nombre = b.nombre.trim();
  const unidad = b.unidad.trim();
  if (original) {
    const cambios: CuerpoMedidor = {};
    if (nombre !== original.nombre.trim()) cambios.nombre = nombre;
    if (unidad !== original.unidad.trim()) cambios.unidad = unidad;
    return cambios;
  }
  const cuerpo: CuerpoMedidor = { nombre, unidad };
  const inicial = leerValorMedidor(b.lecturaInicial);
  if (inicial !== null) cuerpo.lectura_inicial = inicial;
  return cuerpo;
}

// ---------------------------------------------------------------------------
// Las lecturas
// ---------------------------------------------------------------------------

/** 'NUEVA': no puede bajar de la última. 'PASADA' (una corrección de antes): no puede pasarla. */
export type ModoLectura = 'NUEVA' | 'PASADA';

/** El error de una lectura, o null si está bien. */
export function validarLectura(
  texto: number | string | null | undefined,
  ultima: number | null,
  modo: ModoLectura,
  unidad: string
): string | null {
  if (vacio(texto)) return 'Ingresá la lectura.';
  const valor = leerValorMedidor(texto);
  if (valor === null) return MENSAJE_NUMERO;
  if (ultima !== null && modo === 'NUEVA' && valor < ultima) {
    return `No puede ser menor que la última (${textoValorMedidor(ultima, unidad)}).`;
  }
  if (ultima !== null && modo === 'PASADA' && valor > ultima) {
    return `No puede ser mayor que la última (${textoValorMedidor(ultima, unidad)}).`;
  }
  return null;
}

/** Si la lectura pasa del doble de la última (mayor que 0), el aviso; si no, null. */
export function avisoSalto(valor: number | string | null | undefined, ultima: number | null, unidad: string): string | null {
  const n = leerValorMedidor(valor);
  if (n === null || ultima === null || ultima <= 0 || n <= ultima * 2) return null;
  return `Sube de ${formatCantidad(ultima)} a ${textoValorMedidor(n, unidad)}. Revisá que esté bien.`;
}

/** "Manual" o "Al hacer una tarea". El enlace a la intervención lo pone el componente. */
export function textoOrigenLectura(l: Pick<LecturaMedidor, 'origen'>): string {
  return l.origen === 'TAREA' ? 'Al hacer una tarea' : 'Manual';
}

/** El valor de `ultima` que manda la API con LECTURA_MENOR y LECTURA_MAYOR, o null. */
export function ultimaDeError(datos: Record<string, unknown> | undefined): number | null {
  const ultima = datos?.ultima;
  if (typeof ultima !== 'object' || ultima === null) return null;
  const valor = (ultima as Record<string, unknown>).valor;
  return typeof valor === 'number' ? valor : null;
}
