export function codigoDesdeNombre(nombre: string): string {
  if (!nombre || !nombre.trim()) return '';

  // 1. Reemplazar 'ñ' / 'Ñ' por 'N'
  let s = nombre.replace(/ñ/gi, 'N');

  // 2. Quitar tildes y diacríticos
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 3. Mayúsculas
  s = s.toUpperCase();

  // 4. Lo que no es letra ni número pasa a '_'
  s = s.replace(/[^A-Z0-9]+/g, '_');

  // 5. Sin '_' repetidos ni en los extremos
  s = s.replace(/^_+|_+$/g, '');

  if (!s) return '';

  // 6. Si empieza con un número, se le antepone 'N_'
  if (/^[0-9]/.test(s)) {
    s = `N_${s}`;
  }

  // 7. Hasta 30 caracteres, sin '_' final
  s = s.slice(0, 30);
  s = s.replace(/_+$/, '');

  return s;
}

export function codigoValido(codigo: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,29}$/.test(codigo);
}

export function moverEnOrden(ids: number[], id: number, direccion: -1 | 1): number[] {
  const copia = [...ids];
  const idx = copia.indexOf(id);
  if (idx === -1) return copia;

  const targetIdx = idx + direccion;
  if (targetIdx < 0 || targetIdx >= copia.length) {
    return copia;
  }

  const temp = copia[idx];
  copia[idx] = copia[targetIdx];
  copia[targetIdx] = temp;

  return copia;
}

export function motivoNoDesactivableSector(sector: {
  maquinas_activas?: number;
  usuarios_activos?: number;
}): string | null {
  const maquinas = Number(sector.maquinas_activas ?? 0);
  const usuarios = Number(sector.usuarios_activos ?? 0);

  if (maquinas <= 0 && usuarios <= 0) {
    return null;
  }

  const maqTexto = maquinas === 1 ? '1 máquina activa' : `${maquinas} máquinas activas`;
  const usuTexto = usuarios === 1 ? '1 usuario activo' : `${usuarios} usuarios activos`;

  if (maquinas > 0 && usuarios > 0) {
    return `Tiene ${maqTexto} y ${usuTexto}. Pasá las máquinas a otro sector o desactivalas, y quitales el sector a los usuarios, antes de desactivarlo.`;
  }

  if (maquinas > 0) {
    return `Tiene ${maqTexto}. Pasá las máquinas a otro sector o desactivalas antes de desactivarlo.`;
  }

  return `Tiene ${usuTexto}. Quitales el sector a los usuarios antes de desactivarlo.`;
}

export function motivoNoDesactivablePlanta(planta: {
  sectores_activos?: number;
}): string | null {
  const sectores = Number(planta.sectores_activos ?? 0);
  if (sectores <= 0) {
    return null;
  }

  if (sectores === 1) {
    return 'Tiene 1 sector activo. Pasalos a otra planta o desactivalos antes de desactivarla.';
  }

  return `Tiene ${sectores} sectores activos. Pasalos a otra planta o desactivalos antes de desactivarla.`;
}

export function motivoNoDesactivableCatalogo(
  item: { por_omision?: boolean; maquinas_activas?: number },
  entidad: 'criticidad' | 'tipo'
): string | null {
  if (item.por_omision) {
    return 'Es el valor por omisión. Marcá otro antes de desactivarlo.';
  }

  const maquinas = Number(item.maquinas_activas ?? 0);
  if (maquinas <= 0) {
    return null;
  }

  const usoVerbo = maquinas === 1 ? 'Lo usa 1 máquina activa' : `Lo usan ${maquinas} máquinas activas`;
  const nombreEntidad = entidad === 'criticidad' ? 'la criticidad' : 'el tipo';

  return `${usoVerbo}. Cambiales ${nombreEntidad} antes de desactivarlo.`;
}

