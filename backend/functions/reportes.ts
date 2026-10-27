import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission, getUserScope } from './middleware.ts';
import { parseId, badRequest } from './validations.ts';
import { responderError, ErrorNegocio } from './intervenciones/errores.ts';
import { UsuarioVisibilidad } from './intervenciones/visibilidad.ts';
import { validarIntervaloReporte } from './intervalos.ts';

const reportesApp = new Hono();
reportesApp.use('*', jwtVerify, dbVerify);

function getUsuarioContext(c: any): UsuarioVisibilidad {
  return {
    id: (c.get as any)('userId') as number,
    permisos: ((c.get as any)('userPermissionsMap') as Record<string, any>) || {},
    sectores: ((c.get as any)('userSectores') as number[]) || [],
  };
}

/**
 * 5.2 GET /api/reportes/inactividad?desde=&hasta=&sector_id=
 * Ranking de inactividad por máquina.
 * - Una fila por máquina activa (respetando el alcance).
 * - Orden: mayor inactividad primero, empates por nombre.
 * - Máquinas sin detenciones en el intervalo aparecen con 0.
 */
reportesApp.get('/inactividad', requirePermission('REPORTES_CONSULTAR'), async (c) => {
  try {
    const usuario = getUsuarioContext(c);
    const scope = getUserScope(c, 'REPORTES_CONSULTAR');

    const { desde, hasta } = await validarIntervaloReporte(
      pool,
      c.req.query('desde'),
      c.req.query('hasta')
    );

    // Filtros de sector y alcance
    const conditions: string[] = ['m.activo = TRUE'];
    const params: any[] = [desde, hasta];
    let paramIndex = 3;

    if (scope === 'SECTORES') {
      if (usuario.sectores.length === 0) {
        return c.json([]);
      }
      conditions.push(`m.sector_id = ANY($${paramIndex})`);
      params.push(usuario.sectores);
      paramIndex++;
    }

    const sectorIdQuery = c.req.query('sector_id');
    if (sectorIdQuery !== undefined && sectorIdQuery !== null && sectorIdQuery.trim() !== '') {
      const sectorId = parseId(sectorIdQuery);
      if (!sectorId) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El sector_id debe ser un entero válido');
      }

      // Con alcance SECTORES, si pide un sector no asignado -> simplemente no aparece
      if (scope === 'SECTORES' && !usuario.sectores.includes(sectorId)) {
        return c.json([]);
      }

      conditions.push(`m.sector_id = $${paramIndex}`);
      params.push(sectorId);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT
        m.id AS maquina_id,
        m.nombre AS maquina_nombre,
        m.codigo AS maquina_codigo,
        s.id AS sector_id,
        s.nombre AS sector_nombre,
        f.total_minutos,
        f.correctivo_minutos,
        f.preventivo_minutos,
        f.fuera_de_servicio_minutos,
        (
          SELECT COUNT(DISTINCT p.intervencion_id)
          FROM intervencion_periodos_detencion p
          JOIN intervenciones i ON i.id = p.intervencion_id
          WHERE p.maquina_id = m.id
            AND i.eliminado_en IS NULL
            AND tstzrange(p.desde, COALESCE(p.hasta, NOW())) && tstzrange($1::timestamptz, $2::timestamptz)
        ) AS intervenciones_con_detencion
      FROM maquinas m
      JOIN sectores s ON s.id = m.sector_id
      CROSS JOIN LATERAL fn_inactividad_maquina(m.id, $1::timestamptz, $2::timestamptz) f
      ${whereClause}
      ORDER BY f.total_minutos DESC, m.nombre ASC
    `;

    const { rows } = await pool.query(query, params);

    const resultado = rows.map((r) => ({
      maquina: {
        id: Number(r.maquina_id),
        nombre: r.maquina_nombre,
        codigo: r.maquina_codigo,
        sector: {
          id: Number(r.sector_id),
          nombre: r.sector_nombre,
        },
      },
      inactividad_minutos: Number(r.total_minutos),
      por_tipo: {
        CORRECTIVO: Number(r.correctivo_minutos),
        PREVENTIVO: Number(r.preventivo_minutos),
      },
      intervenciones_con_detencion: Number(r.intervenciones_con_detencion),
    }));

    return c.json(resultado);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 5.3 GET /api/reportes/tiempos?desde=&hasta=&agrupar=ejecucion|tipo|sector
 * Tiempos de intervenciones finalizadas agrupados por ejecución, tipo o sector.
 * - agrupar es obligatorio ('ejecucion' | 'tipo' | 'sector'); otro valor -> 422 DATOS_INVALIDOS.
 */
reportesApp.get('/tiempos', requirePermission('REPORTES_CONSULTAR'), async (c) => {
  try {
    const usuario = getUsuarioContext(c);
    const scope = getUserScope(c, 'REPORTES_CONSULTAR');

    const agruparRaw = c.req.query('agrupar')?.trim();
    if (!agruparRaw || !['ejecucion', 'tipo', 'sector'].includes(agruparRaw)) {
      throw new ErrorNegocio(
        422,
        'DATOS_INVALIDOS',
        'El parámetro agrupar es obligatorio y debe ser: ejecucion, tipo o sector'
      );
    }
    const agrupar = agruparRaw as 'ejecucion' | 'tipo' | 'sector';

    const { desde, hasta } = await validarIntervaloReporte(
      pool,
      c.req.query('desde'),
      c.req.query('hasta')
    );

    const conditions: string[] = [
      "i.estado = 'FINALIZADA'",
      'i.eliminado_en IS NULL',
      'i.fecha_finalizacion >= $1::timestamptz',
      'i.fecha_finalizacion <= $2::timestamptz',
    ];
    const params: any[] = [desde, hasta];

    if (scope === 'SECTORES') {
      if (usuario.sectores.length === 0) {
        return c.json([]);
      }
      conditions.push('m.sector_id = ANY($3)');
      params.push(usuario.sectores);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    let selectGrupo = '';
    let groupBy = '';
    let orderBy = '';

    if (agrupar === 'ejecucion') {
      selectGrupo = `
        COALESCE(i.ejecucion, 'SIN_DEFINIR') AS grupo_clave,
        COALESCE(i.ejecucion, 'SIN_DEFINIR') AS ejecucion_valor
      `;
      groupBy = 'GROUP BY i.ejecucion';
      orderBy = 'ORDER BY i.ejecucion ASC';
    } else if (agrupar === 'tipo') {
      selectGrupo = `
        ti.codigo AS grupo_clave,
        ti.id AS tipo_id,
        ti.codigo AS tipo_codigo,
        ti.nombre AS tipo_nombre
      `;
      groupBy = 'GROUP BY ti.id, ti.codigo, ti.nombre';
      orderBy = 'ORDER BY ti.codigo ASC';
    } else {
      // sector
      selectGrupo = `
        s.nombre AS grupo_clave,
        s.id AS sector_id,
        s.nombre AS sector_nombre
      `;
      groupBy = 'GROUP BY s.id, s.nombre';
      orderBy = 'ORDER BY s.nombre ASC';
    }

    const query = `
      SELECT
        ${selectGrupo},
        COUNT(*)::INTEGER AS cantidad,
        ROUND(AVG(vit.espera_minutos))::INTEGER AS espera_promedio_minutos,
        ROUND(AVG(vit.duracion_bruta_minutos))::INTEGER AS duracion_bruta_promedio_minutos,
        ROUND(AVG(vit.duracion_neta_minutos))::INTEGER AS duracion_neta_promedio_minutos,
        ROUND(SUM(vit.duracion_bruta_minutos))::INTEGER AS duracion_bruta_total_minutos,
        ROUND(SUM(vit.duracion_neta_minutos))::INTEGER AS duracion_neta_total_minutos
      FROM intervenciones i
      JOIN maquinas m ON m.id = i.maquina_id
      JOIN sectores s ON s.id = m.sector_id
      JOIN tipos_intervencion ti ON ti.id = i.tipo_intervencion_id
      JOIN v_intervencion_tiempos vit ON vit.intervencion_id = i.id
      ${whereClause}
      ${groupBy}
      ${orderBy}
    `;

    const { rows } = await pool.query(query, params);

    const resultado = rows.map((r) => {
      const base: any = {
        grupo: r.grupo_clave,
        cantidad: Number(r.cantidad),
        espera_promedio_minutos: r.espera_promedio_minutos !== null ? Number(r.espera_promedio_minutos) : null,
        duracion_bruta_promedio_minutos:
          r.duracion_bruta_promedio_minutos !== null ? Number(r.duracion_bruta_promedio_minutos) : null,
        duracion_neta_promedio_minutos:
          r.duracion_neta_promedio_minutos !== null ? Number(r.duracion_neta_promedio_minutos) : null,
        duracion_bruta_total_minutos: Number(r.duracion_bruta_total_minutos ?? 0),
        duracion_neta_total_minutos: Number(r.duracion_neta_total_minutos ?? 0),
      };

      if (agrupar === 'ejecucion') {
        base.ejecucion = r.ejecucion_valor;
      } else if (agrupar === 'tipo') {
        base.tipo = {
          id: Number(r.tipo_id),
          codigo: r.tipo_codigo,
          nombre: r.tipo_nombre,
        };
      } else if (agrupar === 'sector') {
        base.sector = {
          id: Number(r.sector_id),
          nombre: r.sector_nombre,
        };
      }

      return base;
    });

    return c.json(resultado);
  } catch (error) {
    return responderError(c, error);
  }
});

export default reportesApp;
