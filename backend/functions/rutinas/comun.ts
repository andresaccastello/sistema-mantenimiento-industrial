import pg from 'pg';
import { ErrorNegocio } from '../intervenciones/errores.ts';
import { getUserScope } from '../middleware.ts';
import { Persona, columnasPersona, getUsuarioContext, persona } from '../preventivos/comun.ts';

/**
 * Etapa RT1: las tareas de rutina del operario (D-033). Lo que comparten la gestión, las tareas
 * de hoy y el reporte.
 */

export type Frecuencia = 'DIARIA' | 'SEMANAL';
export const FRECUENCIAS: readonly Frecuencia[] = ['DIARIA', 'SEMANAL'];
export type EstadoPeriodo = 'HECHA' | 'NO_HECHA' | 'PENDIENTE';

export function invalido(mensaje: string): ErrorNegocio {
  return new ErrorNegocio(422, 'DATOS_INVALIDOS', mensaje);
}

export function rutinaNoEncontrada(): ErrorNegocio {
  return new ErrorNegocio(404, 'RUTINA_NO_ENCONTRADA', 'Tarea de rutina no encontrada');
}

export function sinAlcance(): ErrorNegocio {
  return new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tenés alcance sobre el sector de esta máquina');
}

/** Un único repetido de la base, nunca 500: la descripción entre las activas, o la marca del período. */
export function traducirUnico(err: any): unknown {
  if (err && err.code === '23505') {
    if (err.constraint === 'uq_rutinas_maquina_descripcion') {
      return new ErrorNegocio(409, 'RUTINA_DUPLICADA', 'Ya hay una tarea de rutina activa con esa descripción en la máquina');
    }
    if (err.constraint === 'uq_rutina_registros_periodo') {
      return new ErrorNegocio(409, 'RUTINA_YA_HECHA', 'La tarea ya está marcada como hecha en este período');
    }
  }
  return err;
}

/**
 * Los sectores del alcance de un permiso: null es sin restricción (TODAS); con otro alcance, los
 * sectores del usuario (usuario_sector). Sin el permiso, una lista vacía.
 */
export function sectoresDePermiso(c: any, permiso: string): number[] | null {
  const alcance = getUserScope(c, permiso);
  if (alcance === null) return [];
  if (alcance === 'TODAS') return null;
  return getUsuarioContext(c).sectores;
}

export function alcanza(sectores: number[] | null, sectorId: number): boolean {
  return sectores === null || sectores.includes(sectorId);
}

/** Las columnas de la forma de una rutina (2), sobre r (rutinas), m (maquinas), s (sectores) y pl (plantas). */
export const COLUMNAS_RUTINA = `
  r.id, r.descripcion, r.frecuencia, r.incluye_sabado, r.activa,
  to_char(r.vigente_desde, 'YYYY-MM-DD') AS vigente_desde,
  to_char(r.baja_en, 'YYYY-MM-DD') AS baja_en,
  m.id AS maquina_id, m.codigo AS maquina_codigo, m.nombre AS maquina_nombre,
  s.id AS sector_id, s.nombre AS sector_nombre,
  pl.id AS planta_id, pl.nombre AS planta_nombre`;

export const FROM_RUTINA = `
  FROM rutinas r
  JOIN maquinas m ON m.id = r.maquina_id
  JOIN sectores s ON s.id = m.sector_id
  LEFT JOIN plantas pl ON pl.id = s.planta_id`;

/** El orden de las listas: planta, sector, código de máquina y descripción. */
export const ORDEN_MAQUINA = `pl.nombre NULLS LAST, s.nombre, COALESCE(m.codigo, m.nombre), m.id`;

export interface Rutina {
  id: number;
  descripcion: string;
  frecuencia: Frecuencia;
  incluye_sabado: boolean;
  activa: boolean;
  vigente_desde: string;
  baja_en: string | null;
  maquina: {
    id: number;
    codigo: string | null;
    nombre: string;
    sector: { id: number; nombre: string };
    planta: { id: number; nombre: string } | null;
  };
}

export function rutinaDeFila(r: Record<string, any>): Rutina {
  return {
    id: Number(r.id),
    descripcion: r.descripcion,
    frecuencia: r.frecuencia,
    incluye_sabado: Boolean(r.incluye_sabado),
    activa: Boolean(r.activa),
    vigente_desde: r.vigente_desde,
    baja_en: r.baja_en ?? null,
    maquina: {
      id: Number(r.maquina_id),
      codigo: r.maquina_codigo ?? null,
      nombre: r.maquina_nombre,
      sector: { id: Number(r.sector_id), nombre: r.sector_nombre },
      planta: r.planta_id === null || r.planta_id === undefined ? null : { id: Number(r.planta_id), nombre: r.planta_nombre },
    },
  };
}

export async function obtenerRutina(db: pg.Pool | pg.PoolClient, id: number): Promise<Rutina> {
  const r = await db.query(`SELECT ${COLUMNAS_RUTINA} ${FROM_RUTINA} WHERE r.id = $1`, [id]);
  if (r.rows.length === 0) throw rutinaNoEncontrada();
  return rutinaDeFila(r.rows[0]);
}

export interface Registro {
  id: number;
  usuario: Persona;
  hecha_en: string;
  nota: string | null;
}

/** Las columnas de un registro, sobre rr (rutina_registros) y ur (usuarios), con el prefijo dado. */
export function columnasRegistro(prefijo: string): string {
  return `rr.id AS ${prefijo}_id, rr.hecha_en AS ${prefijo}_hecha_en, rr.nota AS ${prefijo}_nota,
          to_char(rr.periodo, 'YYYY-MM-DD') AS ${prefijo}_periodo,
          ${columnasPersona('ur', `${prefijo}_usuario`)}`;
}

export function registroDeFila(r: Record<string, any>, prefijo: string): Registro | null {
  const id = r[`${prefijo}_id`];
  if (id === null || id === undefined) return null;
  return {
    id: Number(id),
    usuario: persona(r, `${prefijo}_usuario`) as Persona,
    hecha_en: new Date(r[`${prefijo}_hecha_en`]).toISOString(),
    nota: r[`${prefijo}_nota`] ?? null,
  };
}

/**
 * Los períodos esperados de cada rutina (2.3), con su estado y su registro. Los períodos van de
 * max(desde, vigente_desde) a min(hasta, hoy, baja_en); en las diarias, solo los días en que
 * rutina_corresponde da TRUE; en las semanales, cada semana que toca ese tramo, también la de
 * vigente_desde aunque haya empezado a mitad de semana. `desde` null: desde vigente_desde.
 */
export interface PeriodoEsperado {
  rutina_id: number;
  periodo: string;
  estado: EstadoPeriodo;
  registro: (Registro & { periodo: string }) | null;
}

export async function periodosEsperados(
  db: pg.Pool | pg.PoolClient,
  rutinaIds: number[],
  desde: string | null,
  hasta: string | null
): Promise<PeriodoEsperado[]> {
  if (rutinaIds.length === 0) return [];
  const res = await db.query(
    `WITH z AS (SELECT hoy_instalacion() AS hoy),
     tramo AS (
       SELECT r.id, r.frecuencia, r.incluye_sabado, z.hoy,
              GREATEST(COALESCE($2::date, r.vigente_desde), r.vigente_desde) AS ini,
              LEAST(COALESCE($3::date, z.hoy), z.hoy, COALESCE(r.baja_en, z.hoy)) AS fin
       FROM rutinas r CROSS JOIN z
       WHERE r.id = ANY($1::bigint[])
     ),
     esperados AS (
       SELECT t.id AS rutina_id, t.frecuencia, t.hoy, d::date AS periodo
       FROM tramo t
       CROSS JOIN LATERAL generate_series(
         periodo_rutina(t.frecuencia, t.ini)::timestamp,
         t.fin::timestamp,
         CASE WHEN t.frecuencia = 'SEMANAL' THEN interval '7 days' ELSE interval '1 day' END
       ) AS d
       WHERE t.ini <= t.fin
         AND rutina_corresponde(t.frecuencia, t.incluye_sabado, d::date)
     )
     SELECT e.rutina_id, to_char(e.periodo, 'YYYY-MM-DD') AS periodo,
            CASE
              WHEN rr.id IS NOT NULL THEN 'HECHA'
              WHEN e.periodo = periodo_rutina(e.frecuencia, e.hoy) THEN 'PENDIENTE'
              ELSE 'NO_HECHA'
            END AS estado,
            ${columnasRegistro('reg')}
     FROM esperados e
     LEFT JOIN rutina_registros rr ON rr.rutina_id = e.rutina_id AND rr.periodo = e.periodo
     LEFT JOIN usuarios ur ON ur.id = rr.usuario_id
     ORDER BY e.rutina_id, e.periodo`,
    [rutinaIds, desde, hasta]
  );
  return res.rows.map((x) => {
    const reg = registroDeFila(x, 'reg');
    return {
      rutina_id: Number(x.rutina_id),
      periodo: x.periodo,
      estado: x.estado as EstadoPeriodo,
      registro: reg ? { ...reg, periodo: x.reg_periodo } : null,
    };
  });
}

export interface Resumen {
  esperadas: number;
  hechas: number;
  no_hechas: number;
  pendientes: number;
  porcentaje: number | null;
}

/** round(hechas / (hechas + no_hechas) × 100); los pendientes no cuentan; sin períodos cerrados, null. */
export function resumir(estados: EstadoPeriodo[]): Resumen {
  const hechas = estados.filter((e) => e === 'HECHA').length;
  const noHechas = estados.filter((e) => e === 'NO_HECHA').length;
  const pendientes = estados.filter((e) => e === 'PENDIENTE').length;
  const cerrados = hechas + noHechas;
  return {
    esperadas: estados.length,
    hechas,
    no_hechas: noHechas,
    pendientes,
    porcentaje: cerrados === 0 ? null : Math.round((hechas / cerrados) * 100),
  };
}
