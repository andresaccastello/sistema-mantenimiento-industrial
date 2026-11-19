import { UsuarioListaItem } from '../api/tipos';
import { normalizarTexto } from './maquinas';
import { parsearId } from './formato';

export interface FiltrosUsuarios {
  texto: string;
  estado: 'activos' | 'inactivos' | 'todos';
  perfilId: number | null;
  sectorId: number | null;
}

export const FILTROS_USUARIOS_POR_DEFECTO: FiltrosUsuarios = {
  texto: '',
  estado: 'activos',
  perfilId: null,
  sectorId: null,
};

export function leerFiltrosUsuarios(
  params: URLSearchParams | Record<string, string | undefined>
): FiltrosUsuarios {
  const getParam = (key: string): string | null => {
    if (params instanceof URLSearchParams) {
      return params.get(key);
    }
    const val = params[key];
    return val !== undefined ? val : null;
  };

  const rawTexto = getParam('q') ?? '';
  const texto = rawTexto.trim();

  const rawEstado = getParam('estado');
  let estado: 'activos' | 'inactivos' | 'todos' = 'activos';
  if (rawEstado === 'activos' || rawEstado === 'inactivos' || rawEstado === 'todos') {
    estado = rawEstado;
  }

  const rawPerfil = getParam('perfil');
  const perfilId = parsearId(rawPerfil);

  const rawSector = getParam('sector');
  const sectorId = parsearId(rawSector);

  return {
    texto,
    estado,
    perfilId,
    sectorId,
  };
}

export function escribirFiltrosUsuarios(filtros: FiltrosUsuarios): URLSearchParams {
  const params = new URLSearchParams();

  if (filtros.texto.trim()) {
    params.set('q', filtros.texto.trim());
  }

  if (filtros.estado !== 'activos') {
    params.set('estado', filtros.estado);
  }

  if (filtros.perfilId !== null && filtros.perfilId > 0) {
    params.set('perfil', String(filtros.perfilId));
  }

  if (filtros.sectorId !== null && filtros.sectorId > 0) {
    params.set('sector', String(filtros.sectorId));
  }

  return params;
}

export function filtrarUsuarios(
  usuarios: UsuarioListaItem[],
  filtros: FiltrosUsuarios
): UsuarioListaItem[] {
  const normTexto = normalizarTexto(filtros.texto);

  return usuarios.filter((u) => {
    // 1. Filtro por estado
    if (filtros.estado === 'activos' && !u.activo) {
      return false;
    }
    if (filtros.estado === 'inactivos' && u.activo) {
      return false;
    }

    // 2. Filtro por perfil
    if (filtros.perfilId !== null && u.perfil.id !== filtros.perfilId) {
      return false;
    }

    // 3. Filtro por sector
    if (filtros.sectorId !== null) {
      const tieneSector = Array.isArray(u.sectores) && u.sectores.some((s) => s.id === filtros.sectorId);
      if (!tieneSector) return false;
    }

    // 4. Filtro por texto (legajo, nombre, apellido, email)
    if (normTexto) {
      const enLegajo = normalizarTexto(u.legajo).includes(normTexto);
      const enNombre = normalizarTexto(u.nombre).includes(normTexto);
      const enApellido = u.apellido ? normalizarTexto(u.apellido).includes(normTexto) : false;
      const enEmail = u.email ? normalizarTexto(u.email).includes(normTexto) : false;

      if (!enLegajo && !enNombre && !enApellido && !enEmail) {
        return false;
      }
    }

    return true;
  });
}

export function hayFiltrosUsuarios(filtros: FiltrosUsuarios): boolean {
  return (
    filtros.texto.trim() !== '' ||
    filtros.estado !== 'activos' ||
    filtros.perfilId !== null ||
    filtros.sectorId !== null
  );
}

export function validarPasswordTemporal(password: string, legajo: string): string | null {
  if (!password || password.length < 8) {
    return 'La contraseña temporal tiene que tener al menos 8 caracteres y no puede ser igual al legajo.';
  }

  if (password.trim().toLowerCase() === legajo.trim().toLowerCase()) {
    return 'La contraseña temporal tiene que tener al menos 8 caracteres y no puede ser igual al legajo.';
  }

  return null;
}

export function validarMotivo(motivo: string): string | null {
  if (!motivo || motivo.trim().length < 5) {
    return 'Indicá el motivo (al menos 5 caracteres).';
  }
  return null;
}

