import { ErrorNegocio } from '../intervenciones/errores.ts';
import { parseId } from '../validations.ts';

const REGEX_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validarCantidad(val: unknown, campo = 'cantidad'): number {
  if (typeof val !== 'number' || isNaN(val) || !isFinite(val) || val <= 0 || val > 1000000) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El campo ${campo} debe ser un número mayor a 0 y hasta 1.000.000`);
  }
  const fixed = Number(val.toFixed(3));
  if (Math.abs(val - fixed) > 1e-9) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El campo ${campo} no puede tener más de 3 decimales`);
  }
  return fixed;
}

export function validarCantidadDesdeCero(val: unknown, campo = 'cantidad'): number {
  if (typeof val !== 'number' || isNaN(val) || !isFinite(val) || val < 0 || val > 1000000) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El campo ${campo} debe ser un número mayor o igual a 0 y hasta 1.000.000`);
  }
  const fixed = Number(val.toFixed(3));
  if (Math.abs(val - fixed) > 1e-9) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El campo ${campo} no puede tener más de 3 decimales`);
  }
  return fixed;
}

export function validarCosto(val: unknown, campo = 'costo_unitario'): number {
  if (typeof val !== 'number' || isNaN(val) || !isFinite(val) || val < 0 || val > 1000000000) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El campo ${campo} debe ser un número entre 0 y 1.000.000.000`);
  }
  const fixed = Number(val.toFixed(2));
  if (Math.abs(val - fixed) > 1e-9) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El campo ${campo} no puede tener más de 2 decimales`);
  }
  return fixed;
}

export function validarEmail(email: unknown): string | null {
  if (email === undefined || email === null || email === '') {
    return null;
  }
  if (typeof email !== 'string') {
    throw new ErrorNegocio(422, 'EMAIL_INVALIDO', 'El email debe ser texto');
  }
  const trimEmail = email.trim();
  if (trimEmail.length === 0) {
    return null;
  }
  if (trimEmail.length > 254 || !REGEX_EMAIL.test(trimEmail)) {
    throw new ErrorNegocio(422, 'EMAIL_INVALIDO', 'El formato del email no es válido');
  }
  return trimEmail.toLowerCase();
}

/**
 * Formatea una cantidad para textos de auditoría igual que formatCantidad del frontend:
 * 2 -> "2", 1.5 -> "1,5", 1234.25 -> "1.234,25", 0.125 -> "0,125"
 */
export function formatearCantidad(valor?: number | string | null): string {
  if (valor === null || valor === undefined) return '';
  const num = typeof valor === 'string' ? parseFloat(valor) : valor;
  if (typeof num !== 'number' || isNaN(num)) return '';
  const esNegativo = num < 0;
  const abs = Math.abs(num);
  const redondeado = Math.round(abs * 1000) / 1000;
  const partes = redondeado.toString().split('.');
  const enteroConPuntos = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const res = partes.length > 1 ? `${enteroConPuntos},${partes[1]}` : enteroConPuntos;
  return esNegativo ? `-${res}` : res;
}

export function parseIdRuta(val: unknown): number | null {
  // La ruta siempre trae texto: mismas reglas que parseId
  return typeof val === 'string' ? parseId(val) : null;
}

export function validarIdCuerpo(val: unknown, codigoError = 'DATOS_INVALIDOS', campo = 'id'): number {
  if (typeof val !== 'number' || !Number.isSafeInteger(val) || val <= 0) {
    throw new ErrorNegocio(422, codigoError, `El campo ${campo} debe ser un entero positivo`);
  }
  return val;
}

export function validarBooleano(val: unknown, campo: string): boolean {
  if (typeof val !== 'boolean') {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El campo ${campo} debe ser un booleano`);
  }
  return val;
}

