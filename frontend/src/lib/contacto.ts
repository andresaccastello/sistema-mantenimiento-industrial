/**
 * Funciones de normalización y validación de datos de contacto (Etapa N1b)
 */

export function normalizarEmail(texto?: string | null): string | null {
  if (texto === null || texto === undefined) {
    return null;
  }
  const recortado = texto.trim().toLowerCase();
  return recortado === '' ? null : recortado;
}

export function validarEmail(email?: string | null): string | null {
  if (email === null || email === undefined || email === '') {
    return null;
  }
  const patron = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  if (!patron.test(email)) {
    return 'El email no tiene un formato válido.';
  }
  return null;
}

export function normalizarTelefono(texto?: string | null): string | null {
  if (texto === null || texto === undefined) {
    return null;
  }
  let s = texto.replace(/[\s\-\.\(\)]/g, '');
  if (s.startsWith('00')) {
    s = '+' + s.slice(2);
  }
  return s === '' ? null : s;
}

export function validarTelefono(tel?: string | null): string | null {
  if (tel === null || tel === undefined || tel === '') {
    return null;
  }
  const patron = /^\+[1-9][0-9]{7,14}$/;
  if (!patron.test(tel)) {
    return 'El número tiene que estar en formato internacional, por ejemplo +5491112345678.';
  }
  return null;
}
