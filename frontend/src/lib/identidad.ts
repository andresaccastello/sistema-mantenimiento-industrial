/**
 * D1, 6: el nombre del sistema, el de la empresa y el logo, configurables.
 */

/** Hasta 300 KB, como la API y la base. */
export const LOGO_MAXIMO_BYTES = 300 * 1024;

export const TIPOS_LOGO = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const AYUDA_LOGO =
  'Se ve arriba a la izquierda y en la pantalla de ingreso. Recomendado: fondo transparente, unos 200 × 64 px.';

export const NOMBRE_SISTEMA_POR_OMISION = 'Sistema de Mantenimiento Industrial';

/** La dirección del logo, con `?v=<actualizado_en>`: al cambiarlo, el navegador no muestra el viejo. */
export function urlLogo(baseUrl: string, actualizadoEn: string | null | undefined): string {
  const url = `${baseUrl}/api/configuracion/logo`;
  return actualizadoEn ? `${url}?v=${encodeURIComponent(actualizadoEn)}` : url;
}

/**
 * Un primer control antes de subir: el tipo que declara el archivo y el tamaño. La API vuelve a
 * controlar el tipo por los primeros bytes. null si está bien.
 */
export function errorArchivoLogo(archivo: { size: number; type: string }): string | null {
  if (!(TIPOS_LOGO as readonly string[]).includes(archivo.type)) return 'El logo tiene que ser una imagen PNG, JPEG o WEBP.';
  if (archivo.size === 0) return 'El archivo está vacío.';
  if (archivo.size > LOGO_MAXIMO_BYTES) return 'El logo no puede pasar de 300 KB.';
  return null;
}

/** El error de cada campo de la identidad, o null; los nombres se recortan, como en la API. */
export function erroresIdentidad(nombreSistema: string, nombreEmpresa: string): { sistema: string | null; empresa: string | null } {
  const sistema = nombreSistema.trim();
  const empresa = nombreEmpresa.trim();
  return {
    sistema: sistema.length < 3 || sistema.length > 80 ? 'De 3 a 80 caracteres.' : null,
    empresa: empresa !== '' && (empresa.length < 2 || empresa.length > 120) ? 'De 2 a 120 caracteres, o vacío.' : null,
  };
}

/** El cuerpo de PUT /api/configuracion/identidad: la empresa vacía va como null. */
export function cuerpoIdentidad(nombreSistema: string, nombreEmpresa: string): { nombre_sistema: string; nombre_empresa: string | null } {
  const empresa = nombreEmpresa.trim();
  return { nombre_sistema: nombreSistema.trim(), nombre_empresa: empresa === '' ? null : empresa };
}

/** El título de la pestaña del navegador. */
export function tituloPestana(nombreSistema: string | null | undefined): string {
  return nombreSistema?.trim() || NOMBRE_SISTEMA_POR_OMISION;
}
