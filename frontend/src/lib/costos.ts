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
  return null;
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
