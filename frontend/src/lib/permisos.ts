import { AlcancePermiso, ExcepcionPermisoDetalle, PerfilDetalle, PermisoCatalogo } from '../api/tipos';

export const GRUPOS_PERMISOS = [
  'Intervenciones',
  'Máquinas',
  'Reportes',
  'Avisos',
  'Usuarios y permisos',
  'Módulos futuros',
  'Otros',
] as const;

export type GrupoPermiso = typeof GRUPOS_PERMISOS[number];

export function etiquetaAlcance(alcance?: AlcancePermiso | string | null, usaAlcance = true): string {
  if (!usaAlcance) {
    return 'Sí';
  }

  if (alcance === 'PROPIAS') return 'Propias';
  if (alcance === 'SECTORES') return 'Sus sectores';
  if (alcance === 'TODAS') return 'Todas';

  return '—';
}

export function grupoPermiso(codigo: string): GrupoPermiso {
  if (codigo.startsWith('INTERVENCIONES_')) return 'Intervenciones';
  if (codigo.startsWith('MAQUINAS_')) return 'Máquinas';
  if (codigo.startsWith('REPORTES_')) return 'Reportes';
  if (codigo.startsWith('NOTIFICACIONES_')) return 'Avisos';
  if (codigo.startsWith('USUARIOS_') || codigo.startsWith('PERMISOS_')) return 'Usuarios y permisos';
  if (
    codigo.startsWith('REPUESTOS_') ||
    codigo.startsWith('COSTOS_') ||
    codigo.startsWith('DOCUMENTOS_') ||
    codigo.startsWith('PLANES_')
  ) {
    return 'Módulos futuros';
  }
  return 'Otros';
}

export interface FilaPermiso {
  permiso: PermisoCatalogo;
  grupo: GrupoPermiso;
  porPerfil: AlcancePermiso | string | null;
  excepcion: ExcepcionPermisoDetalle | null;
  resultado: AlcancePermiso | string | null;
}

export function filasPermisos(
  catalogo: PermisoCatalogo[],
  permisosPerfil: Array<{ codigo: string; alcance?: AlcancePermiso | null }>,
  excepciones: ExcepcionPermisoDetalle[],
  efectivos: Record<string, AlcancePermiso | string> | Array<{ codigo: string; alcance?: AlcancePermiso | null }>
): FilaPermiso[] {
  const getEfectivo = (codigo: string): AlcancePermiso | string | null => {
    if (Array.isArray(efectivos)) {
      const match = efectivos.find((e) => e.codigo === codigo);
      if (!match) return null;
      return match.alcance ?? 'TODAS';
    }
    if (efectivos && typeof efectivos === 'object' && codigo in efectivos) {
      return efectivos[codigo] ?? 'TODAS';
    }
    return null;
  };

  const filas: FilaPermiso[] = catalogo.map((permiso) => {
    const grupo = grupoPermiso(permiso.codigo);
    const pp = permisosPerfil.find((p) => p.codigo === permiso.codigo);
    const excepcion = excepciones.find((e) => e.codigo === permiso.codigo) || null;
    const resultado = getEfectivo(permiso.codigo);

    let porPerfil: AlcancePermiso | string | null = null;
    if (pp) {
      porPerfil = permiso.usa_alcance ? (pp.alcance ?? 'TODAS') : 'TODAS';
    }

    return {
      permiso,
      grupo,
      porPerfil,
      excepcion,
      resultado,
    };
  });

  // Agrupar por grupo en el orden de GRUPOS_PERMISOS y ordenar por nombre dentro de cada grupo
  const ordenGrupo = new Map<string, number>(GRUPOS_PERMISOS.map((g, idx) => [g, idx]));

  filas.sort((a, b) => {
    const ordenA = ordenGrupo.get(a.grupo) ?? 999;
    const ordenB = ordenGrupo.get(b.grupo) ?? 999;
    if (ordenA !== ordenB) {
      return ordenA - ordenB;
    }
    return a.permiso.nombre.localeCompare(b.permiso.nombre);
  });

  return filas;
}

export interface OpcionesExcepcion {
  gestionable: boolean;
  alcances: AlcancePermiso[];
}

export function opcionesExcepcion(
  permiso: PermisoCatalogo,
  permisosActor?: Record<string, AlcancePermiso | string> | Array<{ codigo: string; alcance?: AlcancePermiso | null }> | null
): OpcionesExcepcion {
  if (!permisosActor) {
    return { gestionable: false, alcances: [] };
  }

  const getActorVal = (codigo: string): AlcancePermiso | string | null => {
    if (Array.isArray(permisosActor)) {
      const match = permisosActor.find((p) => p.codigo === codigo);
      if (!match) return null;
      return match.alcance ?? 'TODAS';
    }
    if (typeof permisosActor === 'object' && codigo in permisosActor) {
      return permisosActor[codigo] ?? 'TODAS';
    }
    return null;
  };

  const actorAlcance = getActorVal(permiso.codigo);
  if (!actorAlcance) {
    return { gestionable: false, alcances: [] };
  }

  if (!permiso.usa_alcance) {
    return { gestionable: true, alcances: [] };
  }

  const jerarquia: AlcancePermiso[] = ['PROPIAS', 'SECTORES', 'TODAS'];
  if (actorAlcance === 'PROPIAS') {
    return { gestionable: true, alcances: ['PROPIAS'] };
  }
  if (actorAlcance === 'SECTORES') {
    return { gestionable: true, alcances: ['PROPIAS', 'SECTORES'] };
  }
  if (actorAlcance === 'TODAS') {
    return { gestionable: true, alcances: [...jerarquia] };
  }

  return { gestionable: true, alcances: [] };
}

const PESO_ALCANCE: Record<string, number> = {
  PROPIAS: 1,
  SECTORES: 2,
  TODAS: 3,
};

export function perfilAsignable(
  permisosDelPerfil: Array<{ codigo: string; alcance?: AlcancePermiso | null }>,
  permisosActor?: Record<string, AlcancePermiso | string> | Array<{ codigo: string; alcance?: AlcancePermiso | null }> | null
): boolean {
  if (!permisosActor) return false;

  const getActorVal = (codigo: string): AlcancePermiso | string | null => {
    if (Array.isArray(permisosActor)) {
      const match = permisosActor.find((p) => p.codigo === codigo);
      if (!match) return null;
      return match.alcance ?? 'TODAS';
    }
    if (typeof permisosActor === 'object' && codigo in permisosActor) {
      return permisosActor[codigo] ?? 'TODAS';
    }
    return null;
  };

  for (const permPerfil of permisosDelPerfil) {
    const actorAlcance = getActorVal(permPerfil.codigo);
    if (!actorAlcance) {
      return false;
    }

    if (permPerfil.alcance) {
      const pesoRequerido = PESO_ALCANCE[permPerfil.alcance] || 1;
      const pesoActor = PESO_ALCANCE[actorAlcance] || 3;
      if (pesoActor < pesoRequerido) {
        return false;
      }
    }
  }

  return true;
}

export interface FilaMatrizPerfiles {
  permiso: PermisoCatalogo;
  grupo: GrupoPermiso;
  celdas: Record<number, string>;
  valores: Record<number, string>;
}

export function matrizPerfiles(
  perfiles: PerfilDetalle[],
  catalogo: PermisoCatalogo[]
): FilaMatrizPerfiles[] {
  const ordenGrupo = new Map<string, number>(GRUPOS_PERMISOS.map((g, idx) => [g, idx]));

  const filas: FilaMatrizPerfiles[] = catalogo.map((permiso) => {
    const grupo = grupoPermiso(permiso.codigo);
    const celdas: Record<number, string> = {};

    for (const perfil of perfiles) {
      const pPerfil = perfil.permisos?.find((p) => p.codigo === permiso.codigo);
      if (!pPerfil) {
        celdas[perfil.id] = '—';
      } else {
        celdas[perfil.id] = etiquetaAlcance(pPerfil.alcance, permiso.usa_alcance);
      }
    }

    return {
      permiso,
      grupo,
      celdas,
      valores: celdas,
    };
  });

  filas.sort((a, b) => {
    const ordenA = ordenGrupo.get(a.grupo) ?? 999;
    const ordenB = ordenGrupo.get(b.grupo) ?? 999;
    if (ordenA !== ordenB) {
      return ordenA - ordenB;
    }
    return a.permiso.nombre.localeCompare(b.permiso.nombre);
  });

  return filas;
}

