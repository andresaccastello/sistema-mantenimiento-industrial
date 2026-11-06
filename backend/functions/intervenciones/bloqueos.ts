import pg from 'pg';
import { ErrorNegocio } from './errores.ts';
import { puedeVerIntervencion, UsuarioVisibilidad } from './visibilidad.ts';

export interface IntervencionBloqueada {
  id: number;
  maquina_id: number;
  tipo_intervencion_id: number;
  creado_por_usuario_id: number;
  responsable_usuario_id: number | null;
  descripcion: string;
  estado: string;
  ejecucion: string | null;
  trabajo_realizado: string | null;
  fecha_creacion: string;
  fecha_inicio: string | null;
  fecha_finalizacion: string | null;
  tiempo_inactividad_minutos: number | null;
  observaciones: string | null;
  eliminado_en: string | null;
  actualizado_en: string;
}

export interface MaquinaBloqueada {
  id: number;
  nombre: string;
  sector_id: number;
  tipo: string | null;
  estado: string;
  ubicacion: string | null;
  observaciones: string | null;
  activo: boolean;
  codigo: string | null;
}

export interface BloqueoResultado {
  intervencion: IntervencionBloqueada;
  maquina: MaquinaBloqueada;
}

/**
 * Bloquea una intervención y su máquina asociada en orden determinista:
 * 1. Consulta maquina_id (sin bloqueo).
 * 2. Bloquea la fila de la máquina con FOR UPDATE.
 * 3. Bloquea la fila de la intervención con FOR UPDATE.
 * 4. Valida existencia, eliminación lógica y alcance de visibilidad.
 */
export async function bloquearIntervencion(
  client: pg.PoolClient,
  intervencionId: number,
  usuario?: UsuarioVisibilidad
): Promise<BloqueoResultado> {
  // 1. Obtener maquina_id sin bloqueo
  const resLookup = await client.query(
    'SELECT maquina_id FROM intervenciones WHERE id = $1',
    [intervencionId]
  );

  if (resLookup.rows.length === 0) {
    throw new ErrorNegocio(
      404,
      'INTERVENCION_NO_ENCONTRADA',
      'Intervención no encontrada'
    );
  }

  const maquinaId = Number(resLookup.rows[0].maquina_id);

  // 2. Bloquear primero la máquina
  const resM = await client.query(
    'SELECT * FROM maquinas WHERE id = $1 FOR UPDATE',
    [maquinaId]
  );

  if (resM.rows.length === 0) {
    throw new ErrorNegocio(
      404,
      'INTERVENCION_NO_ENCONTRADA',
      'Máquina asociada no encontrada'
    );
  }
  const maquina = resM.rows[0] as MaquinaBloqueada;

  // 3. Bloquear luego la intervención
  const resI = await client.query(
    'SELECT * FROM intervenciones WHERE id = $1 FOR UPDATE',
    [intervencionId]
  );

  if (resI.rows.length === 0 || resI.rows[0].eliminado_en !== null) {
    throw new ErrorNegocio(
      404,
      'INTERVENCION_NO_ENCONTRADA',
      'Intervención no encontrada'
    );
  }
  const intervencion = resI.rows[0] as IntervencionBloqueada;

  // 4. Validar visibilidad si se especificó el usuario
  if (usuario) {
    const visible = puedeVerIntervencion(usuario, {
      creado_por_usuario_id: Number(intervencion.creado_por_usuario_id),
      responsable_usuario_id: intervencion.responsable_usuario_id
        ? Number(intervencion.responsable_usuario_id)
        : null,
      sector_id: Number(maquina.sector_id),
    });

    if (!visible) {
      throw new ErrorNegocio(
        404,
        'INTERVENCION_NO_ENCONTRADA',
        'Intervención no encontrada'
      );
    }
  }

  return { intervencion, maquina };
}
