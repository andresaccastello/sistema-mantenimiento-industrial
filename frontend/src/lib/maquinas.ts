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

export type CodigoAccionMaquina =
  | 'CONFIRMAR_RECUPERACION'
  | 'REPORTAR_FALLA'
  | 'FUERA_DE_SERVICIO'
  | 'VOLVER_A_SERVICIO'
  | 'EDITAR'
  | 'DESACTIVAR'
  | 'REACTIVAR';

export interface MaquinaEstadoPermisos {
  activo: boolean;
  estado: string;
  intervenciones_abiertas?: number;
}

export interface AccionesMaquinaResultado {
  todas: CodigoAccionMaquina[];
  principal: CodigoAccionMaquina | null;
  botones: CodigoAccionMaquina[];
  menu: CodigoAccionMaquina[];
}

export function etiquetaAccionMaquina(codigo: CodigoAccionMaquina): string {
  switch (codigo) {
    case 'CONFIRMAR_RECUPERACION':
      return 'Confirmar que volvió a funcionar';
    case 'REPORTAR_FALLA':
      return 'Reportar falla';
    case 'FUERA_DE_SERVICIO':
      return 'Dejar fuera de servicio';
    case 'VOLVER_A_SERVICIO':
      return 'Volver a servicio';
    case 'EDITAR':
      return 'Editar';
    case 'DESACTIVAR':
      return 'Desactivar';
    case 'REACTIVAR':
      return 'Reactivar';
  }
}

/**
 * Devuelve las acciones disponibles sobre una máquina según estado, permisos y detenciones abiertas.
 * (Sección 3.3 de docs/etapas/etapa-f3b-tablero-maquinas.md)
 */
export function accionesMaquina(
  maquina: MaquinaEstadoPermisos,
  permisos: Record<string, unknown> = {},
  cantidadDetencionesAbiertas = 0
): AccionesMaquinaResultado {
  const todas: CodigoAccionMaquina[] = [];

  if (permisos['INTERVENCIONES_CONFIRMAR_RECUPERACION'] && cantidadDetencionesAbiertas > 0) {
    todas.push('CONFIRMAR_RECUPERACION');
  }

  if (permisos['INTERVENCIONES_CREAR'] && maquina.activo) {
    todas.push('REPORTAR_FALLA');
  }

  if (
    permisos['MAQUINAS_CAMBIAR_ESTADO'] &&
    maquina.activo &&
    maquina.estado !== 'FUERA_DE_SERVICIO'
  ) {
    todas.push('FUERA_DE_SERVICIO');
  }

  if (permisos['MAQUINAS_CAMBIAR_ESTADO'] && maquina.estado === 'FUERA_DE_SERVICIO') {
    todas.push('VOLVER_A_SERVICIO');
  }

  if (permisos['MAQUINAS_GESTIONAR']) {
    todas.push('EDITAR');
  }

  if (permisos['MAQUINAS_GESTIONAR'] && maquina.activo) {
    todas.push('DESACTIVAR');
  }

  if (permisos['MAQUINAS_GESTIONAR'] && !maquina.activo) {
    todas.push('REACTIVAR');
  }

  let principal: CodigoAccionMaquina | null = null;
  if (todas.includes('CONFIRMAR_RECUPERACION')) {
    principal = 'CONFIRMAR_RECUPERACION';
  } else if (todas.includes('REPORTAR_FALLA')) {
    principal = 'REPORTAR_FALLA';
  }

  const menu: CodigoAccionMaquina[] = todas.filter(
    (a) => a === 'DESACTIVAR' || a === 'REACTIVAR'
  );
  const botones: CodigoAccionMaquina[] = todas.filter(
    (a) => a !== principal && a !== 'DESACTIVAR' && a !== 'REACTIVAR'
  );

  return {
    todas,
    principal,
    botones,
    menu,
  };
}

/**
 * Devuelve el motivo por el cual una máquina no se puede desactivar, o null si se puede.
 */
export function motivoNoDesactivable(
  maquina: { intervenciones_abiertas: number },
  cantidadDetencionesAbiertas: number
): string | null {
  if (maquina.intervenciones_abiertas > 0) {
    if (maquina.intervenciones_abiertas === 1) {
      return 'Tiene 1 intervención abierta. Cerrala o cancelala antes de desactivarla.';
    }
    return `Tiene ${maquina.intervenciones_abiertas} intervenciones abiertas. Cerralas o cancelalas antes de desactivarla.`;
  }

  if (cantidadDetencionesAbiertas > 0) {
    return 'Tiene detenciones sin confirmar. Confirmá que volvió a funcionar antes de desactivarla.';
  }

  return null;
}

function formatearFechaYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Devuelve { desde, hasta } en formato YYYY-MM-DD.
 * hasta es el día de ahora y desde, dias - 1 días antes.
 */
export function rangoUltimosDias(
  dias: number,
  ahora: Date = new Date()
): { desde: string; hasta: string } {
  const hastaDate = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const desdeDate = new Date(
    ahora.getFullYear(),
    ahora.getMonth(),
    ahora.getDate() - (dias - 1)
  );
  return {
    desde: formatearFechaYMD(desdeDate),
    hasta: formatearFechaYMD(hastaDate),
  };
}
