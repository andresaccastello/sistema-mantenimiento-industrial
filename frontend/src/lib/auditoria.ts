import { PermisoCatalogo, UsuarioAuditoriaRegistro } from '../api/tipos';
import { nombrePerfil } from './perfiles';
import { nombreCompleto } from './personas';
import { etiquetaAlcance } from './permisos';

export interface AuditoriaReferencias {
  perfiles?: Record<string, string>;
  sectores?: Record<string, string>;
}

export interface TextoAuditoria {
  titulo: string;
  detalle: string;
}

export function textoAuditoria(
  registro: { accion: string; detalle: any },
  referencias: AuditoriaReferencias = {},
  catalogo: PermisoCatalogo[] = []
): TextoAuditoria {
  const accion = registro.accion;
  const detalle = registro.detalle;

  // Si el detalle no es un objeto JSON, o es un primitivo/array
  const esObjetoValido = detalle !== null && typeof detalle === 'object' && !Array.isArray(detalle);

  // Helper para nombre de perfil
  const formatearPerfil = (id: any): string => {
    if (id === null || id === undefined) return '';
    const codONom = referencias.perfiles?.[String(id)];
    if (!codONom) return `Perfil ${id}`;
    return nombrePerfil(codONom);
  };

  // Helper para sectores
  const formatearSectores = (ids: any): string => {
    if (!Array.isArray(ids) || ids.length === 0) return 'ninguno';
    return ids.map((id) => referencias.sectores?.[String(id)] || `Sector ${id}`).join(', ');
  };

  // Helper para nombre de permiso
  const formatearPermiso = (codigo: string): string => {
    const p = catalogo.find((c) => c.codigo === codigo);
    return p ? p.nombre : codigo;
  };

  // Helper para efecto
  const formatearEfecto = (efectoObj: any, codigoPermiso: string): string => {
    if (!efectoObj) return '';
    const efecto = typeof efectoObj === 'string' ? efectoObj : efectoObj.efecto;
    if (efecto === 'DENEGAR') return 'Deniega';
    if (efecto === 'CONCEDER') {
      const p = catalogo.find((c) => c.codigo === codigoPermiso);
      const alcance = efectoObj.alcance;
      const usaAlcance = p ? p.usa_alcance : Boolean(alcance);
      if (usaAlcance && alcance) {
        return `Concede, ${etiquetaAlcance(alcance, true)}`;
      }
      return 'Concede';
    }
    return efecto || '';
  };

  switch (accion) {
    case 'USUARIO_CREADO': {
      if (!esObjetoValido) return { titulo: 'Alta del usuario', detalle: '' };
      const perfilTexto = formatearPerfil(detalle.perfil_id);
      const secTexto = formatearSectores(detalle.sectores);
      return {
        titulo: 'Alta del usuario',
        detalle: `Perfil ${perfilTexto}. Sectores: ${secTexto}.`,
      };
    }

    case 'USUARIO_MODIFICADO': {
      if (!esObjetoValido) return { titulo: 'Datos cambiados', detalle: '' };
      const ant = nombreCompleto(detalle.anterior);
      const nue = nombreCompleto(detalle.nuevo);
      return {
        titulo: 'Datos cambiados',
        detalle: `${ant} → ${nue}`,
      };
    }

    case 'PERFIL_CAMBIADO': {
      if (!esObjetoValido) return { titulo: 'Perfil cambiado', detalle: '' };
      const ant = formatearPerfil(detalle.anterior);
      const nue = formatearPerfil(detalle.nuevo);
      return {
        titulo: 'Perfil cambiado',
        detalle: `${ant} → ${nue}`,
      };
    }

    case 'SECTORES_CAMBIADOS': {
      if (!esObjetoValido) return { titulo: 'Sectores cambiados', detalle: '' };
      const ant = formatearSectores(detalle.anterior);
      const nue = formatearSectores(detalle.nuevo);
      return {
        titulo: 'Sectores cambiados',
        detalle: `${ant} → ${nue}`,
      };
    }

    case 'USUARIO_DESACTIVADO': {
      if (!esObjetoValido) return { titulo: 'Usuario desactivado', detalle: '' };
      const motivo = (detalle.motivo || '').trim();
      let d = `Motivo: ${motivo}.`;
      const abiertas = Number(detalle.intervenciones_abiertas_como_responsable ?? detalle.intervenciones_abiertas ?? 0);
      if (abiertas === 1) {
        d += ' Era responsable de 1 intervención abierta.';
      } else if (abiertas > 1) {
        d += ` Era responsable de ${abiertas} intervenciones abiertas.`;
      }
      return {
        titulo: 'Usuario desactivado',
        detalle: d,
      };
    }

    case 'USUARIO_REACTIVADO': {
      if (!esObjetoValido) return { titulo: 'Usuario reactivado', detalle: '' };
      const motivo = (detalle.motivo || '').trim();
      return {
        titulo: 'Usuario reactivado',
        detalle: `Motivo: ${motivo}.`,
      };
    }

    case 'PASSWORD_RESTABLECIDA':
      return {
        titulo: 'Contraseña restablecida',
        detalle: '',
      };

    case 'PASSWORD_CAMBIADA':
      return {
        titulo: 'Cambió su contraseña',
        detalle: '',
      };

    case 'EXCEPCION_CREADA': {
      if (!esObjetoValido) return { titulo: 'Excepción agregada', detalle: '' };
      const permTexto = formatearPermiso(detalle.codigo);
      const efectoTexto = formatearEfecto(detalle, detalle.codigo);
      const motivo = (detalle.motivo || '').trim();
      return {
        titulo: 'Excepción agregada',
        detalle: `${permTexto}: ${efectoTexto}. Motivo: ${motivo}.`,
      };
    }

    case 'EXCEPCION_MODIFICADA': {
      if (!esObjetoValido) return { titulo: 'Excepción cambiada', detalle: '' };
      const permTexto = formatearPermiso(detalle.codigo);
      const antTexto = formatearEfecto(detalle.anterior, detalle.codigo);
      const nueTexto = formatearEfecto(detalle, detalle.codigo);
      const motivo = (detalle.motivo || '').trim();
      return {
        titulo: 'Excepción cambiada',
        detalle: `${permTexto}: ${antTexto} → ${nueTexto}. Motivo: ${motivo}.`,
      };
    }

    case 'EXCEPCION_ELIMINADA': {
      if (!esObjetoValido) return { titulo: 'Excepción quitada', detalle: '' };
      const permTexto = formatearPermiso(detalle.codigo);
      const antTexto = formatearEfecto(detalle.anterior, detalle.codigo);
      const motivo = (detalle.motivo || '').trim();
      return {
        titulo: 'Excepción quitada',
        detalle: `${permTexto}: era ${antTexto}. Motivo: ${motivo}.`,
      };
    }

    default:
      return {
        titulo: accion,
        detalle: '',
      };
  }
}

