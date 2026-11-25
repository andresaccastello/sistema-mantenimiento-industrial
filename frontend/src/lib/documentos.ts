/**
 * MQ1, 4.1: los documentos de la máquina, como enlaces (D-035).
 */
import type { DocumentoMaquina, TipoDocumento } from '../api/tipos';

/** El nombre del ícono de Tabler de cada tipo: el componente lo traduce al ícono. */
export type IconoDocumento = 'book' | 'photo' | 'video' | 'list' | 'ruler' | 'file';

export interface InfoTipoDocumento {
  codigo: TipoDocumento;
  /** En singular, para el formulario. */
  etiqueta: string;
  /** En plural, para el título de cada grupo de la lista. */
  grupo: string;
  icono: IconoDocumento;
}

/** En el orden de la lista, el mismo que usa la API. */
export const TIPOS_DOCUMENTO: InfoTipoDocumento[] = [
  { codigo: 'MANUAL', etiqueta: 'Manual', grupo: 'Manuales', icono: 'book' },
  { codigo: 'FOTO', etiqueta: 'Foto', grupo: 'Fotos', icono: 'photo' },
  { codigo: 'VIDEO', etiqueta: 'Video', grupo: 'Videos', icono: 'video' },
  { codigo: 'INSTRUCTIVO', etiqueta: 'Instructivo', grupo: 'Instructivos', icono: 'list' },
  { codigo: 'PLANO', etiqueta: 'Plano', grupo: 'Planos', icono: 'ruler' },
  { codigo: 'OTRO', etiqueta: 'Otro', grupo: 'Otros', icono: 'file' },
];

export const AYUDA_ENLACE_DOCUMENTO =
  'Pegá el enlace al archivo (en SAE, una carpeta compartida o la web del fabricante)';

export function infoTipoDocumento(tipo: string): InfoTipoDocumento {
  return TIPOS_DOCUMENTO.find((t) => t.codigo === tipo) ?? TIPOS_DOCUMENTO[TIPOS_DOCUMENTO.length - 1];
}

/** Los documentos agrupados por tipo, en el orden de TIPOS_DOCUMENTO; sin grupos vacíos. */
export function agruparDocumentos(
  documentos: DocumentoMaquina[]
): Array<{ tipo: InfoTipoDocumento; documentos: DocumentoMaquina[] }> {
  return TIPOS_DOCUMENTO.map((tipo) => ({
    tipo,
    documentos: documentos.filter((d) => infoTipoDocumento(d.tipo).codigo === tipo.codigo),
  })).filter((g) => g.documentos.length > 0);
}

/** null si el enlace sirve; si no, el mensaje. Igual que la API: solo http o https. */
export function validarEnlaceDocumento(url: string): string | null {
  const u = url.trim();
  if (u === '') return 'Pegá el enlace';
  if (!/^https?:\/\//i.test(u)) return 'El enlace tiene que empezar con http:// o https://';
  if (u.length > 1000) return 'El enlace no puede superar los 1000 caracteres';
  return null;
}
