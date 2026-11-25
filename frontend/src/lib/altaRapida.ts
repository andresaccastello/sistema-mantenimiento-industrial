/**
 * MQ1, 4.5: el alta rápida de un repuesto desde la intervención. Usa el POST /api/repuestos
 * que ya existe, siempre sin control de stock.
 */
import type { CuerpoRepuesto } from '../api/tipos';

export const ENLACE_ALTA_RAPIDA = 'No está en la lista: crear repuesto';
export const UNIDAD_POR_OMISION = 'unidad';

export interface BorradorAltaRapida {
  nombre: string;
  unidad: string;
  /** '' si no se cargó. */
  costo: number | string;
  proveedorId: string | null;
}

export type ResultadoAltaRapida =
  | { ok: true; cuerpo: CuerpoRepuesto }
  | { ok: false; campo: 'nombre' | 'unidad' | 'costo'; mensaje: string };

/** Valida el borrador y arma el cuerpo. Los mismos límites que la API. */
export function cuerpoAltaRapida(b: BorradorAltaRapida): ResultadoAltaRapida {
  const nombre = b.nombre.trim();
  if (nombre.length < 2 || nombre.length > 150) {
    return { ok: false, campo: 'nombre', mensaje: 'El nombre tiene que tener entre 2 y 150 caracteres.' };
  }
  const unidad = b.unidad.trim();
  if (unidad.length < 1 || unidad.length > 20) {
    return { ok: false, campo: 'unidad', mensaje: 'La unidad tiene que tener entre 1 y 20 caracteres.' };
  }
  const cuerpo: CuerpoRepuesto = { nombre, unidad, lleva_stock: false };

  if (b.costo !== '' && b.costo !== null && b.costo !== undefined) {
    const costo = Number(b.costo);
    if (!Number.isFinite(costo) || costo < 0) {
      return { ok: false, campo: 'costo', mensaje: 'El costo tiene que ser un número mayor o igual a 0.' };
    }
    cuerpo.costo_unitario = costo;
  }
  if (b.proveedorId) cuerpo.proveedor_id = Number(b.proveedorId);
  return { ok: true, cuerpo };
}
