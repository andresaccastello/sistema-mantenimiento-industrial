import pg from 'pg';
import { SQL_HOY, columnasPersona, persona, planNoEncontrado } from './comun.ts';
import { TareaValida, Unidad } from './validaciones.ts';

/** Una tarea del plan con su estado, como sale de v_plan_tareas_estado (4.3). */
const SQL_TAREAS_PLAN = `
  SELECT v.id, v.orden, v.accion, v.detalle, v.frecuencia_valor, v.frecuencia_unidad,
         to_char(v.primera_fecha, 'YYYY-MM-DD') AS primera_fecha,
         r.id AS rep_id, r.codigo AS rep_codigo, r.nombre AS rep_nombre, r.unidad AS rep_unidad,
         v.cantidad, pr.id AS prov_id, pr.nombre AS prov_nombre, v.activo,
         to_char(v.ultima_ejecucion, 'YYYY-MM-DD') AS ultima_ejecucion,
         to_char(v.proxima_fecha, 'YYYY-MM-DD') AS proxima_fecha,
         v.dias, v.estado, v.intervencion_en_curso_id, v.intervencion_en_curso_estado
  FROM v_plan_tareas_estado v
  LEFT JOIN repuestos r ON r.id = v.repuesto_id
  LEFT JOIN proveedores pr ON pr.id = v.proveedor_id
`;

export function repuestoSugerido(r: Record<string, any>) {
  return r.rep_id === null
    ? null
    : { id: Number(r.rep_id), codigo: r.rep_codigo, nombre: r.rep_nombre, unidad: r.rep_unidad };
}

export function proveedorSugerido(r: Record<string, any>) {
  return r.prov_id === null ? null : { id: Number(r.prov_id), nombre: r.prov_nombre };
}

function enCurso(r: Record<string, any>) {
  return r.intervencion_en_curso_id === null
    ? null
    : { id: Number(r.intervencion_en_curso_id), estado: r.intervencion_en_curso_estado };
}

function tareaPlan(r: Record<string, any>) {
  return {
    id: Number(r.id),
    orden: Number(r.orden),
    accion: r.accion,
    detalle: r.detalle,
    frecuencia_valor: Number(r.frecuencia_valor),
    frecuencia_unidad: r.frecuencia_unidad,
    primera_fecha: r.primera_fecha,
    repuesto: repuestoSugerido(r),
    cantidad: r.cantidad === null ? null : Number(r.cantidad),
    proveedor: proveedorSugerido(r),
    activo: Boolean(r.activo),
    ultima_ejecucion: r.ultima_ejecucion,
    proxima_fecha: r.proxima_fecha,
    dias: Number(r.dias),
    estado: r.estado,
    intervencion_en_curso: enCurso(r),
  };
}

/** El detalle de un plan (4.3). Lanza PLAN_NO_ENCONTRADO si no existe. */
export async function obtenerDetallePlan(db: pg.Pool | pg.PoolClient, planId: number) {
  const resP = await db.query(
    `SELECT p.id, p.nombre, p.descripcion, p.activo, p.anticipacion_dias, p.creado_en, p.actualizado_en,
            to_char(${SQL_HOY}, 'YYYY-MM-DD') AS hoy,
            m.id AS maquina_id, m.codigo AS maquina_codigo, m.nombre AS maquina_nombre, m.activo AS maquina_activo,
            s.id AS sector_id, s.nombre AS sector_nombre,
            ${columnasPersona('ur', 'resp')},
            ${columnasPersona('uc', 'creador')}
     FROM planes_mantenimiento p
     JOIN maquinas m ON m.id = p.maquina_id
     JOIN sectores s ON s.id = m.sector_id
     LEFT JOIN usuarios ur ON ur.id = p.responsable_usuario_id
     JOIN usuarios uc ON uc.id = p.creado_por_usuario_id
     WHERE p.id = $1`,
    [planId]
  );
  if (resP.rows.length === 0) throw planNoEncontrado();
  const p = resP.rows[0];

  const resT = await db.query(`${SQL_TAREAS_PLAN} WHERE v.plan_id = $1 ORDER BY v.orden, v.id`, [planId]);

  const resI = await db.query(
    `SELECT i.id, i.estado, i.fecha_creacion, i.fecha_finalizacion, ${columnasPersona('ur', 'resp')}
     FROM intervenciones i
     LEFT JOIN usuarios ur ON ur.id = i.responsable_usuario_id
     WHERE i.plan_mantenimiento_id = $1 AND i.eliminado_en IS NULL
     ORDER BY i.fecha_creacion DESC, i.id DESC
     LIMIT 20`,
    [planId]
  );

  return {
    id: Number(p.id),
    nombre: p.nombre,
    descripcion: p.descripcion,
    activo: Boolean(p.activo),
    anticipacion_dias: Number(p.anticipacion_dias),
    hoy: p.hoy,
    maquina: {
      id: Number(p.maquina_id),
      codigo: p.maquina_codigo,
      nombre: p.maquina_nombre,
      activo: Boolean(p.maquina_activo),
      sector: { id: Number(p.sector_id), nombre: p.sector_nombre },
    },
    responsable: persona(p, 'resp'),
    creado_por: persona(p, 'creador'),
    creado_en: p.creado_en,
    actualizado_en: p.actualizado_en,
    tareas: resT.rows.map(tareaPlan),
    intervenciones: resI.rows.map((i) => ({
      id: Number(i.id),
      estado: i.estado,
      fecha_creacion: i.fecha_creacion,
      fecha_finalizacion: i.fecha_finalizacion,
      responsable: persona(i, 'resp'),
    })),
  };
}

/** Filtros de máquina, sector y planta, y el alcance (4.1). Agrega condiciones sobre m y s. */
export interface FiltrosMaquina {
  maquinaId: number | null;
  sectorId: number | null;
  plantaId: number | null;
  sectores: number[] | null;
}

function condicionesMaquina(f: FiltrosMaquina, params: unknown[]): string[] {
  const cond: string[] = [];
  if (f.sectores !== null) {
    params.push(f.sectores);
    cond.push(`m.sector_id = ANY($${params.length}::bigint[])`);
  }
  if (f.maquinaId !== null) {
    params.push(f.maquinaId);
    cond.push(`m.id = $${params.length}`);
  }
  if (f.sectorId !== null) {
    params.push(f.sectorId);
    cond.push(`m.sector_id = $${params.length}`);
  }
  if (f.plantaId !== null) {
    params.push(f.plantaId);
    cond.push(`s.planta_id = $${params.length}`);
  }
  return cond;
}

/** GET /api/planes (4.3): los planes con sus cuentas. */
export async function listarPlanes(db: pg.Pool, filtros: FiltrosMaquina, todos: boolean) {
  const params: unknown[] = [];
  const cond = condicionesMaquina(filtros, params);
  if (!todos) cond.push('p.activo');
  const where = cond.length > 0 ? `WHERE ${cond.join(' AND ')}` : '';

  const res = await db.query(
    `SELECT x.*, to_char(x.proxima, 'YYYY-MM-DD') AS proxima_texto FROM (
       SELECT p.id, p.nombre, p.activo, p.anticipacion_dias,
              m.id AS maquina_id, m.codigo AS maquina_codigo, m.nombre AS maquina_nombre, m.activo AS maquina_activo,
              s.id AS sector_id, s.nombre AS sector_nombre,
              ${columnasPersona('ur', 'resp')},
              count(v.id) FILTER (WHERE v.activo)::int AS tareas_activas,
              count(v.id) FILTER (WHERE v.estado = 'VENCIDA')::int AS vencidas,
              count(v.id) FILTER (WHERE v.estado = 'PROXIMA')::int AS proximas,
              count(v.id) FILTER (WHERE v.estado = 'EN_CURSO')::int AS en_curso,
              min(v.proxima_fecha) FILTER (WHERE v.activo AND v.intervencion_en_curso_id IS NULL) AS proxima
       FROM planes_mantenimiento p
       JOIN maquinas m ON m.id = p.maquina_id
       JOIN sectores s ON s.id = m.sector_id
       LEFT JOIN usuarios ur ON ur.id = p.responsable_usuario_id
       LEFT JOIN v_plan_tareas_estado v ON v.plan_id = p.id
       ${where}
       GROUP BY p.id, m.id, s.id, ur.id
     ) x
     ORDER BY x.proxima ASC NULLS LAST, x.maquina_codigo ASC NULLS LAST, x.nombre ASC, x.id ASC`,
    params
  );

  return res.rows.map((r) => ({
    id: Number(r.id),
    nombre: r.nombre,
    activo: Boolean(r.activo),
    anticipacion_dias: Number(r.anticipacion_dias),
    maquina: {
      id: Number(r.maquina_id),
      codigo: r.maquina_codigo,
      nombre: r.maquina_nombre,
      activo: Boolean(r.maquina_activo),
      sector: { id: Number(r.sector_id), nombre: r.sector_nombre },
    },
    responsable: persona(r, 'resp'),
    tareas_activas: Number(r.tareas_activas),
    vencidas: Number(r.vencidas),
    proximas: Number(r.proximas),
    en_curso: Number(r.en_curso),
    proxima_fecha: r.proxima_texto,
  }));
}

export const ESTADOS_VENCIMIENTO = ['VENCIDA', 'PROXIMA', 'EN_CURSO', 'AL_DIA'] as const;

/** GET /api/planes/vencimientos (sección 5). */
export async function listarVencimientos(
  db: pg.Pool,
  filtros: FiltrosMaquina,
  estados: string[],
  limit: number,
  offset: number
) {
  const params: unknown[] = [];
  // Solo tareas activas, de planes activos y de máquinas activas
  const cond = ['v.activo', 'p.activo', 'm.activo', ...condicionesMaquina(filtros, params)];
  const base = `
    FROM v_plan_tareas_estado v
    JOIN planes_mantenimiento p ON p.id = v.plan_id
    JOIN maquinas m ON m.id = p.maquina_id
    JOIN sectores s ON s.id = m.sector_id
    JOIN criticidades c ON c.id = m.criticidad_id
    LEFT JOIN usuarios ur ON ur.id = p.responsable_usuario_id
    WHERE ${cond.join(' AND ')}`;

  // El resumen, con los mismos filtros salvo el estado
  const resResumen = await db.query(
    `SELECT count(*) FILTER (WHERE v.estado = 'VENCIDA')::int AS vencidas,
            count(*) FILTER (WHERE v.estado = 'PROXIMA')::int AS proximas,
            count(*) FILTER (WHERE v.estado = 'EN_CURSO')::int AS en_curso,
            count(*) FILTER (WHERE v.estado = 'AL_DIA')::int AS al_dia
     ${base}`,
    params
  );

  const paramsEstado = [...params, estados];
  const conEstado = `${base} AND v.estado = ANY($${paramsEstado.length}::text[])`;

  const resTotal = await db.query(`SELECT count(*)::int AS total ${conEstado}`, paramsEstado);

  const paramsPagina = [...paramsEstado, limit, offset];
  const res = await db.query(
    `SELECT v.id, v.accion, v.frecuencia_valor, v.frecuencia_unidad,
            to_char(v.ultima_ejecucion, 'YYYY-MM-DD') AS ultima_ejecucion,
            to_char(v.proxima_fecha, 'YYYY-MM-DD') AS proxima_fecha,
            v.dias, v.estado, v.intervencion_en_curso_id, v.intervencion_en_curso_estado,
            p.id AS plan_id, p.nombre AS plan_nombre,
            m.id AS maquina_id, m.codigo AS maquina_codigo, m.nombre AS maquina_nombre,
            c.nombre AS criticidad_nombre, c.prioridad_alta,
            s.id AS sector_id, s.nombre AS sector_nombre,
            ${columnasPersona('ur', 'resp')}
     ${conEstado}
     ORDER BY v.proxima_fecha ASC, c.prioridad_alta DESC, m.codigo ASC NULLS LAST, p.nombre ASC, p.id ASC, v.orden ASC, v.id ASC
     LIMIT $${paramsPagina.length - 1} OFFSET $${paramsPagina.length}`,
    paramsPagina
  );

  const hoy = (await db.query(`SELECT to_char(${SQL_HOY}, 'YYYY-MM-DD') AS hoy`)).rows[0].hoy;
  const r0 = resResumen.rows[0];

  return {
    total: Number(resTotal.rows[0].total),
    cuerpo: {
      hoy,
      resumen: {
        vencidas: Number(r0.vencidas),
        proximas: Number(r0.proximas),
        en_curso: Number(r0.en_curso),
        al_dia: Number(r0.al_dia),
      },
      tareas: res.rows.map((r) => ({
        tarea_id: Number(r.id),
        accion: r.accion,
        frecuencia_valor: Number(r.frecuencia_valor),
        frecuencia_unidad: r.frecuencia_unidad,
        ultima_ejecucion: r.ultima_ejecucion,
        proxima_fecha: r.proxima_fecha,
        dias: Number(r.dias),
        estado: r.estado,
        intervencion_en_curso: enCurso(r),
        plan: { id: Number(r.plan_id), nombre: r.plan_nombre },
        maquina: {
          id: Number(r.maquina_id),
          codigo: r.maquina_codigo,
          nombre: r.maquina_nombre,
          criticidad: { nombre: r.criticidad_nombre, prioridad_alta: Boolean(r.prioridad_alta) },
        },
        sector: { id: Number(r.sector_id), nombre: r.sector_nombre },
        responsable: persona(r, 'resp'),
      })),
    },
  };
}

/** Una tarea del plan como TareaValida, para un PATCH. Bloquea la fila con FOR UPDATE. */
export async function leerTareaParaCambiar(
  client: pg.PoolClient,
  planId: number,
  tareaId: number
): Promise<{ tarea: TareaValida; activo: boolean } | null> {
  const r = await client.query(
    `SELECT accion, detalle, frecuencia_valor, frecuencia_unidad,
            to_char(primera_fecha, 'YYYY-MM-DD') AS primera_fecha,
            repuesto_id, cantidad, proveedor_id, activo
     FROM plan_tareas WHERE id = $1 AND plan_id = $2
     FOR UPDATE`,
    [tareaId, planId]
  );
  if (r.rows.length === 0) return null;
  const x = r.rows[0];
  return {
    activo: Boolean(x.activo),
    tarea: {
      accion: x.accion,
      detalle: x.detalle,
      frecuencia_valor: Number(x.frecuencia_valor),
      frecuencia_unidad: x.frecuencia_unidad as Unidad,
      primera_fecha: x.primera_fecha,
      repuesto_id: x.repuesto_id === null ? null : Number(x.repuesto_id),
      cantidad: x.cantidad === null ? null : Number(x.cantidad),
      proveedor_id: x.proveedor_id === null ? null : Number(x.proveedor_id),
    },
  };
}
