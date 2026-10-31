/**
 * Manejo de token en sessionStorage (sección 4.2 de docs/etapas/etapa-f0-base-frontend.md)
 */

const TOKEN_KEY = 'smi_auth_token';

export function obtenerToken(): string | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch (err) {
    console.error('Error al leer token de sessionStorage:', err);
    return null;
  }
}

export function guardarToken(token: string): void {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch (err) {
    console.error('Error al guardar token en sessionStorage:', err);
  }
}

export function eliminarToken(): void {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch (err) {
    console.error('Error al eliminar token de sessionStorage:', err);
  }
}
