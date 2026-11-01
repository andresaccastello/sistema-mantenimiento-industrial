export interface MaquinaIdentificable {
  nombre: string;
  codigo?: string | null;
}

export interface MaquinaConSector extends MaquinaIdentificable {
  sector: {
    id: number;
    nombre?: string;
  };
}

/**
 * Pasa a minúsculas, quita las tildes (NFD) y recorta espacios.
 */
export function normalizarTexto(texto: string): string {
  if (!texto) return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Con código: "M-012 · Torno CNC". Sin código: "Torno CNC".
 */
export function etiquetaMaquina(maquina: MaquinaIdentificable): string {
  const nombre = (maquina.nombre || '').trim();
  const codigo = (maquina.codigo || '').trim();
  if (codigo) {
    return `${codigo} · ${nombre}`;
  }
  return nombre;
}

/**
 * Si el texto está vacío, devuelve true.
 * Si no, true cuando el texto normalizado está en nombre o código normalizado.
 */
export function coincideMaquina(maquina: MaquinaIdentificable, texto: string): boolean {
  const normTexto = normalizarTexto(texto);
  if (!normTexto) {
    return true;
  }
  const normNombre = normalizarTexto(maquina.nombre);
  if (normNombre.includes(normTexto)) {
    return true;
  }
  if (maquina.codigo) {
    const normCodigo = normalizarTexto(maquina.codigo);
    if (normCodigo.includes(normTexto)) {
      return true;
    }
  }
  return false;
}

/**
 * Agrupa máquinas en { propias, otras } según los sectores del usuario.
 * Cada grupo ordenado por nombre con localeCompare(..., 'es').
 */
export function agruparMaquinas<T extends MaquinaConSector>(
  maquinas: T[],
  sectoresUsuario: number[] = []
): { propias: T[]; otras: T[] } {
  const setSectores = new Set(sectoresUsuario);
  const propias: T[] = [];
  const otras: T[] = [];

  for (const m of maquinas) {
    if (setSectores.has(m.sector.id)) {
      propias.push(m);
    } else {
      otras.push(m);
    }
  }

  propias.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  otras.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return { propias, otras };
}

/**
 * 0 o menos -> null
 * 1 -> "Esta máquina ya tiene 1 falla abierta."
 * N -> "Esta máquina ya tiene N fallas abiertas."
 */
export function textoFallasAbiertas(cantidad: number): string | null {
  if (cantidad <= 0) return null;
  if (cantidad === 1) return 'Esta máquina ya tiene 1 falla abierta.';
  return `Esta máquina ya tiene ${cantidad} fallas abiertas.`;
}
