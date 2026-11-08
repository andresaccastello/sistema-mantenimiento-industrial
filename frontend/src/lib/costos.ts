/**
 * Lógica pura de los costos de la intervención.
 * Según la sección 8.2 de docs/etapas/etapa-c1-costos.md.
 */

import type { CuerpoCosto, ResumenCostos, TipoCosto } from '../api/tipos';
import { formatCantidad, formatMoneda } from './formato';

const ETIQUETAS_TIPO_COSTO: Record<string, string> = {
  MANO_OBRA: 'Mano de obra',
  SERVICIO_EXTERNO: 'Servicio externo',
  TRANSPORTE: 'Transporte',
  OTRO: 'Otro',
  AJUSTE: 'Ajuste',
};

/**
 * "Mano de obra", "Servicio externo", "Transporte", "Otro" o "Ajuste".
 * Un valor desconocido sale tal cual.
 */
export function etiquetaTipoCosto(tipo: string): string {
  return Object.prototype.hasOwnProperty.call(ETIQUETAS_TIPO_COSTO, tipo)
    ? ETIQUETAS_TIPO_COSTO[tipo]
    : tipo;
}

/**
 * Horas de mano de obra: 2.5 -> "2,5 h"; 1 -> "1 h"; null -> "—".
 */
export function formatHoras(valor?: number | null): string {
  if (valor === null || valor === undefined || typeof valor !== 'number' || isNaN(valor)) {
    return '—';
  }
  return `${formatCantidad(valor)} h`;
}

/**
 * Lo mismo que calcula la API: ROUND(horas * valor_hora, 2).
 * Con enteros (centésimos de hora por centavos) y el redondeo de ROUND de SQL
 * (la mitad se aleja del cero), sin errores de coma flotante.
 */
export function importeManoObra(horas: number, valorHora: number): number {
  const centesimos = Math.round(horas * 100);
  const centavos = Math.round(valorHora * 100);
  const producto = centesimos * centavos; // en diezmilésimos de peso
  const signo = producto < 0 ? -1 : 1;
  const abs = Math.abs(producto);
  const resto = abs % 100;
  const importeCentavos = (abs - resto) / 100 + (resto >= 50 ? 1 : 0);
  return (signo * importeCentavos) / 100;
}

function aNumero(valor: unknown): { vacio: boolean; texto: string; n: number } {
  if (valor === null || valor === undefined || String(valor).trim() === '') {
    return { vacio: true, texto: '', n: NaN };
  }
  const texto = String(valor).trim().replace(',', '.');
  return { vacio: false, texto, n: Number(texto) };
}

function decimales(texto: string): number {
  const partes = texto.split('.');
  return partes.length > 1 ? partes[1].length : 0;
}

/**
 * Valida las horas de mano de obra. Devuelve el mensaje de error o null.
 */
export function validarHoras(valor: unknown): string | null {
  const { vacio, texto, n } = aNumero(valor);
  if (vacio) return 'Ingresá las horas.';
  if (isNaN(n) || n <= 0) return 'Tienen que ser más que cero.';
  if (decimales(texto) > 2) return 'Hasta dos decimales.';
  if (n > 1000) return 'Hasta 1.000 horas.';
  return null;
}

/** Máximo del importe de un renglón, cargado o calculado, igual que la API. */
const MAXIMO_IMPORTE = 1000000000;
/** Máximo del valor hora, igual que la API. */
const MAXIMO_VALOR_HORA = 10000000;

/**
 * Valida el importe de un renglón según su tipo. Devuelve el mensaje de error o null.
 * Solo el ajuste puede ser negativo, pero no cero.
 */
export function validarImporteCosto(tipo: TipoCosto | string, valor: unknown): string | null {
  const { vacio, texto, n } = aNumero(valor);
  if (vacio || isNaN(n)) return 'Ingresá un importe.';
  if (tipo !== 'AJUSTE' && n < 0) return 'No puede ser negativo.';
  if (tipo === 'AJUSTE' && n === 0) return 'El ajuste no puede ser cero.';
  if (decimales(texto) > 2) return 'Hasta dos decimales.';
  // El mismo máximo que la API; en el ajuste, en valor absoluto (C1.2, sección 4)
  if (Math.abs(n) > MAXIMO_IMPORTE) return 'Hasta $ 1.000.000.000.';
  return null;
}

/**
 * Valida el valor hora de la mano de obra. Vacío es válido: es opcional.
 * Devuelve el mensaje de error o null.
 */
export function validarValorHora(valor: unknown): string | null {
  const { vacio, texto, n } = aNumero(valor);
  if (vacio) return null;
  if (isNaN(n)) return 'Ingresá un importe.';
  if (n < 0) return 'No puede ser negativo.';
  if (decimales(texto) > 2) return 'Hasta dos decimales.';
  if (n > MAXIMO_VALOR_HORA) return 'Hasta $ 10.000.000.';
  return null;
}

/** Motivo del ajuste o de la corrección: al menos 5 caracteres. */
export function validarMotivoCosto(motivo: string): string | null {
  return motivo.trim().length < 5 ? 'Ingresá un motivo de al menos 5 caracteres.' : null;
}

export interface CamposCosto {
  tipo: TipoCosto;
  descripcion?: string | null;
  /** Mano de obra: true si la hizo un externo (va el proveedor), false si fue interna (va la persona). */
  externa?: boolean;
  usuarioId?: number | null;
  proveedorId?: number | null;
  horas?: number | null;
  valorHora?: number | null;
  importe?: number | null;
  motivo?: string | null;
}

function texto(valor?: string | null): string | undefined {
  const t = valor === null || valor === undefined ? '' : valor.trim();
  return t === '' ? undefined : t;
}

function numero(valor?: number | null): number | undefined {
  return valor === null || valor === undefined ? undefined : valor;
}

/**
 * Arma el cuerpo de POST /api/intervenciones/:id/costos, exacto según el tipo:
 * - manda valor_hora o importe, nunca los dos;
 * - manda usuario_id o proveedor_id;
 * - sin campos que no van en ese tipo.
 *
 * Si falta un dato obligatorio del tipo, lanza un error en vez de armar un cuerpo
 * incompleto. El diálogo los valida antes de llamarla.
 */
export function cuerpoCosto(campos: CamposCosto): CuerpoCosto {
  const descripcion = texto(campos.descripcion);
  const motivo = texto(campos.motivo);
  const importe = numero(campos.importe);

  if (campos.tipo === 'MANO_OBRA') {
    const horas = numero(campos.horas);
    if (horas === undefined) {
      throw new Error('Faltan las horas de la mano de obra.');
    }
    const cuerpo: CuerpoCosto = { tipo: 'MANO_OBRA', horas };

    if (campos.externa) {
      const proveedorId = numero(campos.proveedorId);
      if (proveedorId === undefined) throw new Error('Falta el proveedor de la mano de obra externa.');
      cuerpo.proveedor_id = proveedorId;
    } else {
      const usuarioId = numero(campos.usuarioId);
      if (usuarioId === undefined) throw new Error('Falta la persona de la mano de obra interna.');
      cuerpo.usuario_id = usuarioId;
    }

    const valorHora = numero(campos.valorHora);
    if (valorHora !== undefined) {
      cuerpo.valor_hora = valorHora;
    } else {
      if (importe === undefined) throw new Error('Falta el importe de la mano de obra.');
      cuerpo.importe = importe;
    }

    if (descripcion !== undefined) cuerpo.descripcion = descripcion;
    if (motivo !== undefined) cuerpo.motivo = motivo;
    return cuerpo;
  }

  if (descripcion === undefined) {
    throw new Error('Falta la descripción.');
  }
  if (importe === undefined) {
    throw new Error('Falta el importe.');
  }

  if (campos.tipo === 'AJUSTE') {
    if (motivo === undefined) throw new Error('Falta el motivo del ajuste.');
    return { tipo: 'AJUSTE', descripcion, importe, motivo };
  }

  const cuerpo: CuerpoCosto = { tipo: campos.tipo, descripcion, importe };
  const proveedorId = numero(campos.proveedorId);
  if (proveedorId !== undefined) cuerpo.proveedor_id = proveedorId;
  if (motivo !== undefined) cuerpo.motivo = motivo;
  return cuerpo;
}

export interface FilaResumenCostos {
  clave: keyof ResumenCostos;
  etiqueta: string;
  importe: number;
  esTotal: boolean;
}

const ORDEN_RESUMEN: Array<[Exclude<keyof ResumenCostos, 'total'>, string]> = [
  ['repuestos', 'Repuestos'],
  ['mano_obra', 'Mano de obra'],
  ['servicio_externo', 'Servicio externo'],
  ['transporte', 'Transporte'],
  ['otro', 'Otro'],
  ['ajuste', 'Ajuste'],
];

/**
 * Las filas del resumen: Repuestos, Mano de obra, Servicio externo, Transporte,
 * Otro y Ajuste. Solo las que no son 0, salvo Repuestos, que va siempre.
 * Al final, siempre, el Total.
 */
export function filasResumenCostos(resumen: ResumenCostos): FilaResumenCostos[] {
  const filas: FilaResumenCostos[] = [];
  for (const [clave, etiqueta] of ORDEN_RESUMEN) {
    const importe = resumen[clave];
    if (clave === 'repuestos' || importe !== 0) {
      filas.push({ clave, etiqueta, importe, esTotal: false });
    }
  }
  filas.push({ clave: 'total', etiqueta: 'Total', importe: resumen.total, esTotal: true });
  return filas;
}

/**
 * Texto del 409 TOTAL_NEGATIVO: "El total de la intervención quedaría en $ −500,00.".
 * Si la respuesta no trae el total, el texto sale sin el importe.
 */
export function textoTotalNegativo(totalResultante: unknown): string {
  if (typeof totalResultante !== 'number' || isNaN(totalResultante)) {
    return 'El total de la intervención quedaría negativo.';
  }
  const signo = totalResultante < 0 ? '−' : '';
  const sinSigno = formatMoneda(Math.abs(totalResultante)).replace(/^\$ /, '');
  return `El total de la intervención quedaría en $ ${signo}${sinSigno}.`;
}

// -------------------------------------------------------------
// Etapa C1.2: varios costos en un guardado
// -------------------------------------------------------------

/** Las pestañas del diálogo, en orden. */
export const TIPOS_COSTO: TipoCosto[] = ['MANO_OBRA', 'SERVICIO_EXTERNO', 'TRANSPORTE', 'OTRO', 'AJUSTE'];

/**
 * Lo que se escribe en una pestaña del diálogo. Los ids van como los da el Select;
 * los números, como los da el campo numérico. El motivo es solo el del ajuste: el
 * de la corrección, con la intervención finalizada, es uno para todas.
 */
export interface BorradorCosto {
  /** Mano de obra: true si la hizo un externo. */
  externa: boolean;
  usuarioId: string | null;
  proveedorId: string | null;
  horas: number | string;
  valorHora: number | string;
  importe: number | string;
  descripcion: string;
  motivo: string;
}

export type CampoBorradorCosto =
  | 'persona'
  | 'proveedor'
  | 'horas'
  | 'valorHora'
  | 'importe'
  | 'descripcion'
  | 'motivo';

/** Los errores de una pestaña, por campo. Sin la clave, el campo está bien. */
export type ErroresBorradorCosto = Partial<Record<CampoBorradorCosto, string>>;

export function borradorVacio(): BorradorCosto {
  return {
    externa: false,
    usuarioId: null,
    proveedorId: null,
    horas: '',
    valorHora: '',
    importe: '',
    descripcion: '',
    motivo: '',
  };
}

function lleno(valor: unknown): boolean {
  return valor !== null && valor !== undefined && String(valor).trim() !== '';
}

/**
 * Verdadero si la pestaña tiene algo escrito. No cuentan el selector
 * Interna/Externa solo ni los textos con solo espacios.
 */
export function borradorEmpezado(b: BorradorCosto): boolean {
  return [b.usuarioId, b.proveedorId, b.horas, b.valorHora, b.importe, b.descripcion, b.motivo].some(lleno);
}

/** Si el tipo muestra el proveedor: la mano de obra externa, servicio externo, transporte y otro. */
export function llevaProveedor(tipo: TipoCosto, b: BorradorCosto): boolean {
  return (tipo === 'MANO_OBRA' && b.externa) || tipo === 'SERVICIO_EXTERNO' || tipo === 'TRANSPORTE' || tipo === 'OTRO';
}

/** Mano de obra con valor hora: el importe lo calcula la API. */
export function conValorHora(tipo: TipoCosto, b: BorradorCosto): boolean {
  return tipo === 'MANO_OBRA' && lleno(b.valorHora);
}

/**
 * Valida una pestaña con los mensajes del diálogo y los límites de la API.
 * El motivo del ajuste se controla solo sin finalizar; con la intervención
 * finalizada, el motivo de la corrección es aparte.
 */
export function validarBorrador(
  tipo: TipoCosto,
  b: BorradorCosto,
  opciones: { finalizada: boolean }
): ErroresBorradorCosto {
  const e: ErroresBorradorCosto = {};
  const desc = b.descripcion.trim();

  if (tipo === 'MANO_OBRA') {
    if (b.externa && !lleno(b.proveedorId)) e.proveedor = 'Elegí el proveedor.';
    if (!b.externa && !lleno(b.usuarioId)) e.persona = 'Elegí la persona.';
    const errHoras = validarHoras(b.horas);
    if (errHoras) e.horas = errHoras;
    if (conValorHora(tipo, b)) {
      const errValor = validarValorHora(b.valorHora);
      if (errValor) {
        e.valorHora = errValor;
      } else if (!errHoras && importeManoObra(Number(b.horas), Number(b.valorHora)) > MAXIMO_IMPORTE) {
        e.valorHora = 'El importe calculado pasa de $ 1.000.000.000.';
      }
    } else {
      const errImporte = validarImporteCosto(tipo, b.importe);
      if (errImporte) e.importe = errImporte;
    }
    if (desc !== '' && (desc.length < 3 || desc.length > 200)) {
      e.descripcion = 'Entre 3 y 200 caracteres.';
    }
  } else {
    if (desc.length < 3 || desc.length > 200) {
      e.descripcion = 'Ingresá una descripción de 3 a 200 caracteres.';
    }
    const errImporte = validarImporteCosto(tipo, b.importe);
    if (errImporte) e.importe = errImporte;
  }

  if (tipo === 'AJUSTE' && !opciones.finalizada) {
    const errMotivo = validarMotivoCosto(b.motivo);
    if (errMotivo) e.motivo = errMotivo;
  }
  return e;
}

/** Los campos de cuerpoCosto para una pestaña. */
export function camposDeBorrador(tipo: TipoCosto, b: BorradorCosto, motivo: string | null): CamposCosto {
  const esManoObra = tipo === 'MANO_OBRA';
  const valorHora = conValorHora(tipo, b);
  return {
    tipo,
    externa: b.externa,
    descripcion: b.descripcion,
    usuarioId: lleno(b.usuarioId) ? Number(b.usuarioId) : null,
    proveedorId: llevaProveedor(tipo, b) && lleno(b.proveedorId) ? Number(b.proveedorId) : null,
    horas: esManoObra ? Number(b.horas) : null,
    valorHora: valorHora ? Number(b.valorHora) : null,
    importe: valorHora ? null : Number(b.importe),
    motivo,
  };
}

/**
 * Los cuerpos del lote: las pestañas empezadas, en el orden de las pestañas, con
 * cuerpoCosto. Con la intervención finalizada, el motivo de la corrección va en
 * todos; si no, solo el ajuste lleva su motivo.
 */
export function cuerposLote(
  borradores: Record<TipoCosto, BorradorCosto>,
  opciones: { finalizada: boolean; motivoCorreccion: string }
): CuerpoCosto[] {
  return TIPOS_COSTO.filter((tipo) => borradorEmpezado(borradores[tipo])).map((tipo) => {
    const b = borradores[tipo];
    const motivo = opciones.finalizada ? opciones.motivoCorreccion : tipo === 'AJUSTE' ? b.motivo : null;
    return cuerpoCosto(camposDeBorrador(tipo, b, motivo));
  });
}

/** "Agregar costo" con 0 o 1; "Agregar 2 costos" con 2 o más. */
export function textoBotonAgregar(n: number): string {
  return n <= 1 ? 'Agregar costo' : `Agregar ${n} costos`;
}

/** "Costo agregado." con 0 o 1; "Se agregaron 3 costos." con más. */
export function textoCostosAgregados(n: number): string {
  return n <= 1 ? 'Costo agregado.' : `Se agregaron ${n} costos.`;
}
