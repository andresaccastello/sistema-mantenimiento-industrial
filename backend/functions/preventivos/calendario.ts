import pg from 'pg';
import { SQL_HOY, columnasPersona, persona } from './comun.ts';
import { COLUMNAS_USO, FiltrosMaquina, condicionesMaquina, usoDeTarea } from './consultas.ts';

/**
 * Etapa CAL1: el calendario de preventivos (D-028). Es una consulta: no guarda nada.
 * - HECHA: una tarea hecha en una intervención FINALIZADA y no eliminada, en la fecha
 *   local de finalización (la misma que usa la vista para ultima_ejecucion).
 * - PENDIENTE: la próxima de cada tarea, en proxima_fecha, con el estado de la vista.
 *   Si venció por uso antes de su fecha, va en hoy, con vencida_por_uso.
 * - PREVISTA: las siguientes, desde la pendiente (o desde hoy, si ya pasó), sumando la
 *   frecuencia de a una vez con la suma de fechas de Postgres.
 */

/** El orden de los estados, el mismo que /vencimientos. */
const ORDEN_ESTADO = `CASE e.estado WHEN 'VENCIDA' THEN 1 WHEN 'PROXIMA' THEN 2 WHEN 'SIN_LECTURA' THEN 3 WHEN 'EN_CURSO' THEN 4 ELSE 5 END`;

/** La frecuencia de la tarea v como intervalo, como en la vista. */
const SQL_PASO = `CASE v.frecuencia_unidad
      WHEN 'DIAS' THEN make_interval(days => v.frecuencia_valor)
      WHEN 'SEMANAS' THEN make_interval(weeks => v.frecuencia_valor)
      WHEN 'MESES' THEN make_interval(months => v.frecuencia_valor)
      WHEN 'ANIOS' THEN make_interval(years => v.frecuencia_valor)
    END`;

const SQL_ZONA = `COALESCE(
      (SELECT zona_horaria FROM configuracion_sistema WHERE id = 1),
      'America/Argentina/Buenos_Aires'
    )`;

export async function calendarioPreventivos(db: pg.Pool, filtros: FiltrosMaquina, desde: string, hasta: string) {
  const params: unknown[] = [desde, hasta];
  const filtrosSql = condicionesMaquina(filtros, params).map((c) => `AND ${c}`).join(' ');

  // Las tareas con fecha que cuentan hoy: activas, de planes y máquinas activos (como /vencimientos)
  const res = await db.query(
    `WITH RECURSIVE
     z AS (SELECT ${SQL_HOY} AS hoy, ${SQL_ZONA} AS zona),
     tareas AS (
       SELECT v.id, v.estado, v.medidor_id, v.intervencion_en_curso_id, v.intervencion_en_curso_estado,
              v.frecuencia_unidad,
              CASE WHEN v.frecuencia_unidad = 'DIAS' THEN v.frecuencia_valor
                   WHEN v.frecuencia_unidad = 'SEMANAS' THEN v.frecuencia_valor * 7 END AS dias_paso,
              ${SQL_PASO} AS paso,
              (v.estado = 'VENCIDA' AND v.proxima_fecha >= z.hoy) AS vencida_por_uso,
              CASE WHEN v.estado = 'VENCIDA' AND v.proxima_fecha >= z.hoy THEN z.hoy ELSE v.proxima_fecha END AS fecha,
              z.hoy
       FROM v_plan_tareas_estado v
       JOIN planes_mantenimiento p ON p.id = v.plan_id
       JOIN maquinas m ON m.id = p.maquina_id
       JOIN sectores s ON s.id = m.sector_id
       CROSS JOIN z
       WHERE v.activo AND p.activo AND m.activo AND v.estado <> 'INACTIVA'
         AND v.primera_fecha IS NOT NULL
         ${filtrosSql}
     ),
     -- La base de la proyección: la pendiente, o hoy si ya pasó
     bases AS (
       SELECT t.id, t.paso, t.dias_paso, GREATEST(t.fecha, t.hoy) AS base FROM tareas t
     ),
     -- La primera prevista es la base más la frecuencia. En días y semanas la suma es exacta,
     -- así que se salta directo a la primera que llega a "desde"; en meses y años se suma de a una
     previstas(id, fecha) AS (
       SELECT b.id,
              CASE WHEN b.dias_paso IS NOT NULL
                   THEN b.base + b.dias_paso * GREATEST(1, ceil(($1::date - b.base)::numeric / b.dias_paso))::int
                   ELSE (b.base + b.paso)::date END
       FROM bases b
       WHERE CASE WHEN b.dias_paso IS NOT NULL
                  THEN b.base + b.dias_paso * GREATEST(1, ceil(($1::date - b.base)::numeric / b.dias_paso))::int
                  ELSE (b.base + b.paso)::date END <= $2::date
       UNION ALL
       SELECT x.id, (x.fecha + b.paso)::date
       FROM previstas x
       JOIN bases b ON b.id = x.id
       WHERE (x.fecha + b.paso)::date <= $2::date
     ),
     hechas AS (
       SELECT it.plan_tarea_id AS tarea_id, (i.fecha_finalizacion AT TIME ZONE z.zona)::date AS fecha,
              i.id AS intervencion_id, i.estado AS intervencion_estado
       FROM intervencion_tareas it
       JOIN intervenciones i ON i.id = it.intervencion_id
       JOIN plan_tareas t ON t.id = it.plan_tarea_id
       JOIN planes_mantenimiento p ON p.id = t.plan_id
       JOIN maquinas m ON m.id = p.maquina_id
       JOIN sectores s ON s.id = m.sector_id
       CROSS JOIN z
       WHERE it.hecha AND i.estado = 'FINALIZADA' AND i.eliminado_en IS NULL
         AND (i.fecha_finalizacion AT TIME ZONE z.zona)::date BETWEEN $1::date AND $2::date
         ${filtrosSql}
     ),
     eventos AS (
       SELECT h.tarea_id, h.fecha, 1 AS tipo_orden, 'HECHA' AS tipo, NULL::text AS estado,
              FALSE AS vencida_por_uso, FALSE AS tambien_por_uso, h.intervencion_id, h.intervencion_estado
       FROM hechas h
       UNION ALL
       SELECT t.id, t.fecha, 2, 'PENDIENTE', t.estado, t.vencida_por_uso, t.medidor_id IS NOT NULL,
              CASE WHEN t.estado = 'EN_CURSO' THEN t.intervencion_en_curso_id END,
              CASE WHEN t.estado = 'EN_CURSO' THEN t.intervencion_en_curso_estado END
       FROM tareas t
       WHERE t.fecha BETWEEN $1::date AND $2::date
       UNION ALL
       SELECT x.id, x.fecha, 3, 'PREVISTA', NULL, FALSE, t.medidor_id IS NOT NULL, NULL, NULL
       FROM previstas x
       JOIN tareas t ON t.id = x.id
       WHERE x.fecha >= $1::date
     )
     SELECT to_char(e.fecha, 'YYYY-MM-DD') AS fecha, e.tipo, e.estado, e.vencida_por_uso, e.tambien_por_uso,
            e.intervencion_id, e.intervencion_estado,
            t.id AS tarea_id, t.accion,
            p.id AS plan_id, p.nombre AS plan_nombre,
            m.id AS maquina_id, m.codigo AS maquina_codigo, m.nombre AS maquina_nombre,
            c.nombre AS criticidad_nombre, c.prioridad_alta,
            s.id AS sector_id, s.nombre AS sector_nombre,
            ${columnasPersona('ur', 'resp')}
     FROM eventos e
     JOIN plan_tareas t ON t.id = e.tarea_id
     JOIN planes_mantenimiento p ON p.id = t.plan_id
     JOIN maquinas m ON m.id = p.maquina_id
     JOIN sectores s ON s.id = m.sector_id
     JOIN criticidades c ON c.id = m.criticidad_id
     LEFT JOIN usuarios ur ON ur.id = p.responsable_usuario_id
     ORDER BY e.fecha, e.tipo_orden, ${ORDEN_ESTADO}, c.prioridad_alta DESC, m.codigo ASC NULLS LAST,
              p.nombre ASC, p.id ASC, t.orden ASC, t.id ASC, e.intervencion_id ASC NULLS LAST`,
    params
  );

  // Lo que no mira el rango: las vencidas y las que vencen solo por uso
  const paramsSinRango: unknown[] = [];
  const condSinRango = ['v.activo', 'p.activo', 'm.activo', ...condicionesMaquina(filtros, paramsSinRango)];
  const baseSinRango = `
    FROM v_plan_tareas_estado v
    JOIN planes_mantenimiento p ON p.id = v.plan_id
    JOIN maquinas m ON m.id = p.maquina_id
    JOIN sectores s ON s.id = m.sector_id
    WHERE ${condSinRango.join(' AND ')}`;

  const resVencidas = await db.query(
    `SELECT to_char(${SQL_HOY}, 'YYYY-MM-DD') AS hoy,
            (SELECT count(*)::int ${baseSinRango} AND v.estado = 'VENCIDA') AS vencidas`,
    paramsSinRango
  );

  const resUso = await db.query(
    `SELECT v.id, v.accion, v.estado, v.intervencion_en_curso_id, v.intervencion_en_curso_estado,
            ${COLUMNAS_USO},
            p.id AS plan_id, p.nombre AS plan_nombre,
            m.id AS maquina_id, m.codigo AS maquina_codigo, m.nombre AS maquina_nombre,
            c.nombre AS criticidad_nombre, c.prioridad_alta
     ${baseSinRango.replace('WHERE', `JOIN criticidades c ON c.id = m.criticidad_id
    LEFT JOIN medidores md ON md.id = v.medidor_id
    WHERE`)}
       AND v.primera_fecha IS NULL AND v.medidor_id IS NOT NULL AND v.estado <> 'INACTIVA'
     ORDER BY CASE v.estado WHEN 'VENCIDA' THEN 1 WHEN 'PROXIMA' THEN 2 WHEN 'SIN_LECTURA' THEN 3 WHEN 'EN_CURSO' THEN 4 ELSE 5 END,
              v.faltan_uso ASC NULLS LAST, m.codigo ASC NULLS LAST, p.nombre ASC, p.id ASC, v.orden ASC, v.id ASC`,
    paramsSinRango
  );

  const maquina = (r: Record<string, any>) => ({
    id: Number(r.maquina_id),
    codigo: r.maquina_codigo,
    nombre: r.maquina_nombre,
    criticidad: { nombre: r.criticidad_nombre, prioridad_alta: Boolean(r.prioridad_alta) },
  });

  return {
    hoy: resVencidas.rows[0].hoy as string,
    desde,
    hasta,
    vencidas: Number(resVencidas.rows[0].vencidas),
    eventos: res.rows.map((r) => ({
      fecha: r.fecha as string,
      tipo: r.tipo as 'HECHA' | 'PENDIENTE' | 'PREVISTA',
      estado: r.estado as string | null,
      vencida_por_uso: Boolean(r.vencida_por_uso),
      tambien_por_uso: Boolean(r.tambien_por_uso),
      tarea_id: Number(r.tarea_id),
      accion: r.accion as string,
      plan: { id: Number(r.plan_id), nombre: r.plan_nombre as string },
      maquina: maquina(r),
      sector: { id: Number(r.sector_id), nombre: r.sector_nombre as string },
      responsable: persona(r, 'resp'),
      intervencion:
        r.intervencion_id === null ? null : { id: Number(r.intervencion_id), estado: r.intervencion_estado as string },
    })),
    por_uso: resUso.rows.map((r) => ({
      tarea_id: Number(r.id),
      accion: r.accion as string,
      estado: r.estado as string,
      uso: usoDeTarea(r),
      plan: { id: Number(r.plan_id), nombre: r.plan_nombre as string },
      maquina: maquina(r),
      intervencion:
        r.intervencion_en_curso_id === null
          ? null
          : { id: Number(r.intervencion_en_curso_id), estado: r.intervencion_en_curso_estado as string },
    })),
  };
}
