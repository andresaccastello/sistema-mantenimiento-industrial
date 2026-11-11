import { Context } from 'hono';
import { pool } from '../db.ts';
import { getUserScope } from '../middleware.ts';
import { parseId } from '../validations.ts';
import { responderError, ErrorNegocio } from '../intervenciones/errores.ts';
import { UsuarioVisibilidad } from '../intervenciones/visibilidad.ts';
import { validarIntervaloReporte } from '../intervalos.ts';

export type AgruparPreventivos = 'sector' | 'maquina' | 'plan';

function getUsuarioContext(c: Context): UsuarioVisibilidad {
  return {
    id: (c.get as any)('userId') as number,
    permisos: ((c.get as any)('userPermissionsMap') as Record<string, any>) || {},
    sectores: ((c.get as any)('userSectores') as number[]) || [],
  };
}

function numeroONull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/**
 * Etapa R1, sección 2: GET /api/reportes/preventivos?desde=&hasta=&planta_id=&sector_id=&agrupar=sector|maquina|plan
 * Cumplimiento de las tareas preventivas en el período (D-026).
 */
export async function reportePreventivos(c: Context) {
  try {
    const usuario = getUsuarioContext(c);
    const scope = getUserScope(c, 'REPORTES_CONSULTAR');

    const agruparRaw = c.req.query('agrupar')?.trim();
    if (!agruparRaw || !['sector', 'maquina', 'plan'].includes(agruparRaw)) {
      throw new ErrorNegocio(
        422,
        'DATOS_INVALIDOS',
        'El parámetro agrupar es obligatorio y debe ser: sector, maquina o plan'
      );
    }
    const agrupar = agruparRaw as AgruparPreventivos;

    const { desde, hasta } = await validarIntervaloReporte(
      pool,
      c.req.query('desde'),
      c.req.query('hasta')
    );

    let sectorId: number | null = null;
    const sectorIdQuery = c.req.query('sector_id');
    if (sectorIdQuery !== undefined && sectorIdQuery !== null && sectorIdQuery.trim() !== '') {
      sectorId = parseId(sectorIdQuery);
      if (!sectorId) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El sector_id debe ser un entero válido');
      }
    }

    let plantaId: number | null = null;
    const plantaIdQuery = c.req.query('planta_id');
    if (plantaIdQuery !== undefined && plantaIdQuery !== null && plantaIdQuery.trim() !== '') {
      plantaId = parseId(plantaIdQuery);
      if (!plantaId) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El planta_id debe ser un entero válido');
      }
    }

    const respuestaVacia = () =>
      c.json({
        resumen: {
          hechas: 0,
          a_tiempo: 0,
          tarde: 0,
          vencidas_sin_hacer: 0,
          cumplimiento: null,
          atraso_promedio_dias: null,
        },
        grupos: [],
      });

    if (scope !== 'TODAS') {
      if (usuario.sectores.length === 0) {
        return respuestaVacia();
      }
      if (sectorId !== null && !usuario.sectores.includes(sectorId)) {
        return respuestaVacia();
      }
    }

    const filtros: string[] = [];
    const params: unknown[] = [desde, hasta];
    let pIdx = 3;

    if (scope !== 'TODAS') {
      filtros.push(`m.sector_id = ANY($${pIdx}::bigint[])`);
      params.push(usuario.sectores);
      pIdx++;
    }
    if (sectorId !== null) {
      filtros.push(`m.sector_id = $${pIdx}`);
      params.push(sectorId);
      pIdx++;
    }
    if (plantaId !== null) {
      filtros.push(`s.planta_id = $${pIdx}`);
      params.push(plantaId);
      pIdx++;
    }

    const filtroSql = filtros.length > 0 ? `AND ${filtros.join(' AND ')}` : '';

    let colId = '';
    let selectGrupo = '';
    let groupByCols = '';
    let orderByCols = '';

    if (agrupar === 'sector') {
      colId = 'sector_id';
      selectGrupo = 'sector_id, sector_nombre';
      groupByCols = 'sector_id, sector_nombre';
      orderByCols = 'sector_nombre ASC, sector_id ASC';
    } else if (agrupar === 'maquina') {
      colId = 'maquina_id';
      selectGrupo = 'maquina_id, maquina_codigo, maquina_nombre';
      groupByCols = 'maquina_id, maquina_codigo, maquina_nombre';
      orderByCols = 'COALESCE(maquina_codigo, maquina_nombre) ASC, maquina_nombre ASC, maquina_id ASC';
    } else {
      colId = 'plan_id';
      selectGrupo = 'plan_id, plan_nombre, maquina_id, maquina_codigo, maquina_nombre';
      groupByCols = 'plan_id, plan_nombre, maquina_id, maquina_codigo, maquina_nombre';
      orderByCols = 'plan_nombre ASC, COALESCE(maquina_codigo, maquina_nombre) ASC, plan_id ASC';
    }

    const sql = `
      WITH zona AS (
        SELECT COALESCE(
          (SELECT zona_horaria FROM configuracion_sistema WHERE id = 1),
          'America/Argentina/Buenos_Aires'
        ) AS tz
      ),
      hechas AS (
        SELECT
          s.id AS sector_id,
          s.nombre AS sector_nombre,
          m.id AS maquina_id,
          m.codigo AS maquina_codigo,
          m.nombre AS maquina_nombre,
          p.id AS plan_id,
          p.nombre AS plan_nombre,
          (
            (it.fecha_programada IS NULL OR (i.fecha_finalizacion AT TIME ZONE z.tz)::date <= it.fecha_programada)
            AND (it.uso_programado IS NULL OR (it.valor_medidor IS NOT NULL AND it.valor_medidor <= it.uso_programado))
          ) AS a_tiempo,
          CASE
            WHEN it.fecha_programada IS NOT NULL
             AND (i.fecha_finalizacion AT TIME ZONE z.tz)::date > it.fecha_programada
            THEN ((i.fecha_finalizacion AT TIME ZONE z.tz)::date - it.fecha_programada)
            ELSE NULL
          END AS atraso_dias
        FROM intervencion_tareas it
        JOIN intervenciones i ON i.id = it.intervencion_id
        JOIN plan_tareas t ON t.id = it.plan_tarea_id
        JOIN planes_mantenimiento p ON p.id = t.plan_id
        JOIN maquinas m ON m.id = p.maquina_id
        JOIN sectores s ON s.id = m.sector_id
        CROSS JOIN zona z
        WHERE it.hecha = TRUE
          AND i.estado = 'FINALIZADA'
          AND i.eliminado_en IS NULL
          AND i.fecha_finalizacion >= $1::timestamptz
          AND i.fecha_finalizacion <= $2::timestamptz
          ${filtroSql}
      ),
      vencidas AS (
        SELECT
          s.id AS sector_id,
          s.nombre AS sector_nombre,
          m.id AS maquina_id,
          m.codigo AS maquina_codigo,
          m.nombre AS maquina_nombre,
          p.id AS plan_id,
          p.nombre AS plan_nombre
        FROM v_plan_tareas_estado v
        JOIN planes_mantenimiento p ON p.id = v.plan_id
        JOIN maquinas m ON m.id = p.maquina_id
        JOIN sectores s ON s.id = m.sector_id
        CROSS JOIN zona z
        WHERE v.estado = 'VENCIDA'
          AND v.proxima_fecha >= ($1::timestamptz AT TIME ZONE z.tz)::date
          AND v.proxima_fecha <= ($2::timestamptz AT TIME ZONE z.tz)::date
          ${filtroSql}
      ),
      tareas AS (
        SELECT
          sector_id, sector_nombre,
          maquina_id, maquina_codigo, maquina_nombre,
          plan_id, plan_nombre,
          1 AS hecha,
          CASE WHEN a_tiempo THEN 1 ELSE 0 END AS a_tiempo,
          CASE WHEN NOT a_tiempo THEN 1 ELSE 0 END AS tarde,
          0 AS vencida_sin_hacer,
          atraso_dias
        FROM hechas
        UNION ALL
        SELECT
          sector_id, sector_nombre,
          maquina_id, maquina_codigo, maquina_nombre,
          plan_id, plan_nombre,
          0 AS hecha,
          0 AS a_tiempo,
          0 AS tarde,
          1 AS vencida_sin_hacer,
          NULL::integer AS atraso_dias
        FROM vencidas
      )
      SELECT
        GROUPING(${colId}) = 1 AS es_resumen,
        ${selectGrupo},
        COALESCE(SUM(hecha), 0)::integer AS hechas,
        COALESCE(SUM(a_tiempo), 0)::integer AS a_tiempo,
        COALESCE(SUM(tarde), 0)::integer AS tarde,
        COALESCE(SUM(vencida_sin_hacer), 0)::integer AS vencidas_sin_hacer,
        ROUND(SUM(a_tiempo) * 100.0 / NULLIF(SUM(hecha) + SUM(vencida_sin_hacer), 0), 1) AS cumplimiento,
        ROUND(AVG(atraso_dias), 1) AS atraso_promedio_dias
      FROM tareas
      GROUP BY GROUPING SETS ((${groupByCols}), ())
      ORDER BY es_resumen DESC, cumplimiento ASC NULLS LAST, ${orderByCols}
    `;

    const { rows } = await pool.query(sql, params);
    const filaResumen = rows.find((r) => r.es_resumen);
    const filasGrupos = rows.filter((r) => !r.es_resumen);

    if (!filaResumen || filasGrupos.length === 0) {
      return respuestaVacia();
    }

    const resumen = {
      hechas: Number(filaResumen.hechas),
      a_tiempo: Number(filaResumen.a_tiempo),
      tarde: Number(filaResumen.tarde),
      vencidas_sin_hacer: Number(filaResumen.vencidas_sin_hacer),
      cumplimiento: numeroONull(filaResumen.cumplimiento),
      atraso_promedio_dias: numeroONull(filaResumen.atraso_promedio_dias),
    };

    const grupos = filasGrupos.map((r) => {
      const metricas = {
        hechas: Number(r.hechas),
        a_tiempo: Number(r.a_tiempo),
        tarde: Number(r.tarde),
        vencidas_sin_hacer: Number(r.vencidas_sin_hacer),
        cumplimiento: numeroONull(r.cumplimiento),
        atraso_promedio_dias: numeroONull(r.atraso_promedio_dias),
      };

      if (agrupar === 'sector') {
        return {
          sector: { id: Number(r.sector_id), nombre: r.sector_nombre },
          ...metricas,
        };
      }
      if (agrupar === 'maquina') {
        return {
          maquina: {
            id: Number(r.maquina_id),
            codigo: r.maquina_codigo,
            nombre: r.maquina_nombre,
          },
          ...metricas,
        };
      }
      return {
        plan: { id: Number(r.plan_id), nombre: r.plan_nombre },
        maquina: {
          id: Number(r.maquina_id),
          codigo: r.maquina_codigo,
          nombre: r.maquina_nombre,
        },
        ...metricas,
      };
    });

    return c.json({ resumen, grupos });
  } catch (error) {
    return responderError(c, error);
  }
}

