/**
 * Formateo legible de nombres de perfiles (sección 3 de docs/etapas/etapa-f0-1-correcciones.md)
 */

const NOMBRES_CONOCIDOS: Record<string, string> = {
  ADMINISTRADOR: 'Administrador',
  RESPONSABLE_MANTENIMIENTO: 'Responsable de mantenimiento',
  OPERARIO: 'Operario',
  CONSULTA: 'Consulta',
  DIRECCION: 'Dirección',
  I_D: 'I+D',
};

/**
 * Devuelve el nombre legible de un perfil según su código:
 * - Para perfiles conocidos devuelve el texto canónico.
 * - Para otros códigos, reemplaza '_' por espacio y pone solo la primera letra en mayúscula.
 * - Si es null, undefined o vacío, devuelve "".
 */
export function nombrePerfil(codigo?: string | null): string {
  if (!codigo || !codigo.trim()) {
    return '';
  }

  const cod = codigo.trim();
  if (NOMBRES_CONOCIDOS[cod]) {
    return NOMBRES_CONOCIDOS[cod];
  }

  const normalizado = cod.replace(/_/g, ' ').toLowerCase();
  return normalizado.charAt(0).toUpperCase() + normalizado.slice(1);
}
