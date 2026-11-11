import pg from 'pg';
import { ErrorNegocio } from '../intervenciones/errores.ts';
import { UsuarioVisibilidad } from '../intervenciones/visibilidad.ts';
import { getUserScope } from '../middleware.ts';

/**
 * "Hoy" de la instalación (D-021, punto 6): la función de la 018, la misma que usa
 * la vista v_plan_tareas_estado. Se usa donde no hay una tarea de la que leerlo.
 */
export const SQL_HOY = 'hoy_instalacion()';

export interface Hoy {
  hoy: string;
  /** hoy − 10 años y hoy + 10 años: el rango de primera_fecha */
  minimo: string;
  maximo: string;
}

export async function obtenerHoy(db: pg.Pool | pg.PoolClient): Promise<Hoy> {
  const r = await db.query(
    `SELECT to_char(h.hoy, 'YYYY-MM-DD') AS hoy,
            to_char(h.hoy - interval '10 years', 'YYYY-MM-DD') AS minimo,
            to_char(h.hoy + interval '10 years', 'YYYY-MM-DD') AS maximo
     FROM (SELECT ${SQL_HOY} AS hoy) h`
  );
  return r.rows[0];
}

export interface Persona {
  id: number;
  legajo: string;
  nombre: string;
  apellido: string | null;
}

/** { id, legajo, nombre, apellido } con las columnas `<prefijo>_id`, `<prefijo>_legajo`… o null. */
export function persona(r: Record<string, any>, prefijo: string): Persona | null {
  const id = r[`${prefijo}_id`];
  if (id === null || id === undefined) return null;
  return {
    id: Number(id),
    legajo: r[`${prefijo}_legajo`],
    nombre: r[`${prefijo}_nombre`],
    apellido: r[`${prefijo}_apellido`] ?? null,
  };
}

/** Las columnas de una persona para persona(), desde el alias de usuarios. */
export function columnasPersona(alias: string, prefijo: string): string {
  return `${alias}.id AS ${prefijo}_id, ${alias}.legajo AS ${prefijo}_legajo,
          ${alias}.nombre AS ${prefijo}_nombre, ${alias}.apellido AS ${prefijo}_apellido`;
}

export function getUsuarioContext(c: any): UsuarioVisibilidad {
  return {
    id: (c.get as any)('userId') as number,
    permisos: ((c.get as any)('userPermissionsMap') as Record<string, any>) || {},
    sectores: ((c.get as any)('userSectores') as number[]) || [],
  };
}

/**
 * Alcance de PLANES_GESTIONAR (4.1): con TODAS, todo; con otro alcance, solo las
 * máquinas de sus sectores, como en los reportes. null = sin restricción.
 */
export function sectoresDelAlcance(c: any): number[] | null {
  const alcance = getUserScope(c, 'PLANES_GESTIONAR');
  if (alcance === 'TODAS') return null;
  return getUsuarioContext(c).sectores;
}

export function planNoEncontrado(): ErrorNegocio {
  return new ErrorNegocio(404, 'PLAN_NO_ENCONTRADO', 'Plan no encontrado');
}

export interface PlanBloqueado {
  id: number;
  maquina_id: number;
  sector_id: number;
  nombre: string;
  activo: boolean;
  responsable_usuario_id: number | null;
  maquina_activa: boolean;
}

/**
 * Bloquea el plan con FOR UPDATE (4.5). Un plan de otro sector da 404, como si no existiera.
 */
export async function bloquearPlan(
  client: pg.PoolClient,
  planId: number | null,
  sectores: number[] | null
): Promise<PlanBloqueado> {
  if (planId === null) throw planNoEncontrado();
  const r = await client.query(
    `SELECT p.id, p.maquina_id, p.nombre, p.activo, p.responsable_usuario_id,
            m.sector_id, m.activo AS maquina_activa
     FROM planes_mantenimiento p
     JOIN maquinas m ON m.id = p.maquina_id
     WHERE p.id = $1
     FOR UPDATE OF p`,
    [planId]
  );
  if (r.rows.length === 0) throw planNoEncontrado();
  const x = r.rows[0];
  if (sectores !== null && !sectores.includes(Number(x.sector_id))) throw planNoEncontrado();
  return {
    id: Number(x.id),
    maquina_id: Number(x.maquina_id),
    sector_id: Number(x.sector_id),
    nombre: x.nombre,
    activo: Boolean(x.activo),
    responsable_usuario_id: x.responsable_usuario_id === null ? null : Number(x.responsable_usuario_id),
    maquina_activa: Boolean(x.maquina_activa),
  };
}

/** Un único repetido: el nombre del plan en la máquina (4.5), nunca 500. */
export function traducirDuplicado(err: any): unknown {
  if (err && err.code === '23505' && err.constraint === 'uq_planes_maquina_nombre') {
    return new ErrorNegocio(409, 'PLAN_DUPLICADO', 'Ya existe un plan con ese nombre en la máquina');
  }
  return err;
}
