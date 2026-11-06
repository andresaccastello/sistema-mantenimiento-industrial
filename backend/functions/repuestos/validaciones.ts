import { ErrorNegocio } from '../intervenciones/errores.ts';

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
