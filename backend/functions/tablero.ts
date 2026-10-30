import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission, getUserScope } from './middleware.ts';
import { responderError } from './intervenciones/errores.ts';

const tableroApp = new Hono();
tableroApp.use('*', jwtVerify, dbVerify);

/**
 * GET /api/tablero
 * Resumen consolidado para el tablero del responsable de mantenimiento (API-03).
 */
tableroApp.get('/', requirePermission('INTERVENCIONES_VER'), async (c) => {
  const userId = (c.get as any)('userId') as number;
  const userScope = getUserScope(c, 'INTERVENCIONES_VER') || 'TODAS';
  const userSectores = ((c.get as any)('userSectores') as number[]) || [];

  try {
    // 1. Conteo de máquinas activas por estado
    // Con alcance TODAS: todas las activas.
    // Con alcance SECTORES o PROPIAS: las de sus sectores (criterio D-47).
    let maquinasWhere = 'WHERE m.activo = TRUE';
    const maquinasParams: any[] = [];
    if (userScope !== 'TODAS') {
      if (userSectores.length === 0) {
        maquinasWhere += ' AND FALSE';
      } else {
        maquinasParams.push(userSectores);
        maquinasWhere += ` AND m.sector_id = ANY($${maquinasParams.length})`;
      }
    }

    const resMaquinas = await pool.query(
      `SELECT m.estado, COUNT(*)::int AS cantidad
       FROM maquinas m
       ${maquinasWhere}
       GROUP BY m.estado`,
      maquinasParams
    );

    const maquinasMap: Record<string, number> = {
      OPERATIVA: 0,
      DETENIDA: 0,
      EN_MANTENIMIENTO: 0,
      FUERA_DE_SERVICIO: 0,
    };
    for (const r of resMaquinas.rows) {
      if (r.estado in maquinasMap) {
        maquinasMap[r.estado] = Number(r.cantidad);
      }
    }

    // 2. Conteo de intervenciones
    // Se cuentan las mismas que vería el usuario en el listado (alcance actual, sin eliminadas).
    let intWhere = 'WHERE i.eliminado_en IS NULL';
    const intParams: any[] = [];

    if (userScope === 'PROPIAS') {
      intParams.push(userId);
      intWhere += ` AND (i.creado_por_usuario_id = $${intParams.length} OR i.responsable_usuario_id = $${intParams.length})`;
    } else if (userScope === 'SECTORES') {
      if (userSectores.length === 0) {
        intWhere += ' AND FALSE';
      } else {
        intParams.push(userSectores);
        intWhere += ` AND m.sector_id = ANY($${intParams.length})`;
      }
    }

    intParams.push(userId);
    const userIdParamIdx = intParams.length;

    const resInt = await pool.query(
      `SELECT 
         COUNT(*) FILTER (WHERE i.estado = 'PENDIENTE')::int AS pendiente,
         COUNT(*) FILTER (WHERE i.estado = 'EN_PROCESO')::int AS en_proceso,
         COUNT(*) FILTER (WHERE i.estado = 'EN_ESPERA_REPUESTOS')::int AS en_espera_repuestos,
         COUNT(*) FILTER (WHERE i.estado = 'PENDIENTE' AND i.responsable_usuario_id IS NULL)::int AS sin_asignar,
         COUNT(*) FILTER (WHERE i.estado IN ('PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS') AND i.responsable_usuario_id = $${userIdParamIdx})::int AS mias_abiertas
       FROM intervenciones i
       JOIN maquinas m ON i.maquina_id = m.id
       ${intWhere}`,
      intParams
    );

    const intRow = resInt.rows[0] || {};
    const intervencionesResumen = {
      PENDIENTE: Number(intRow.pendiente || 0),
      EN_PROCESO: Number(intRow.en_proceso || 0),
      EN_ESPERA_REPUESTOS: Number(intRow.en_espera_repuestos || 0),
      sin_asignar: Number(intRow.sin_asignar || 0),
      mias_abiertas: Number(intRow.mias_abiertas || 0),
    };

    // 3. Detenidas ahora
    // Máquinas con algún período de detención abierto (de intervenciones no eliminadas), respetando el alcance de máquinas.
    let detenidasWhere = 'WHERE pd.hasta IS NULL AND i.eliminado_en IS NULL AND m.activo = TRUE';
    const detenidasParams: any[] = [];
    if (userScope !== 'TODAS') {
      if (userSectores.length === 0) {
        detenidasWhere += ' AND FALSE';
      } else {
        detenidasParams.push(userSectores);
        detenidasWhere += ` AND m.sector_id = ANY($${detenidasParams.length})`;
      }
    }

    const resDetenidas = await pool.query(
      `SELECT 
         m.id AS maquina_id,
         m.nombre AS maquina_nombre,
         m.codigo AS maquina_codigo,
         m.estado AS maquina_estado,
         s.id AS sector_id,
         s.nombre AS sector_nombre,
         MIN(pd.desde) AS detenida_desde,
         ROUND(EXTRACT(EPOCH FROM (NOW() - MIN(pd.desde))) / 60)::int AS inactividad_en_curso_minutos,
         COUNT(DISTINCT CASE 
           WHEN i2.estado IN ('PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS') 
            AND i2.eliminado_en IS NULL 
           THEN i2.id 
         END)::int AS intervenciones_abiertas
       FROM intervencion_periodos_detencion pd
       JOIN intervenciones i ON pd.intervencion_id = i.id
       JOIN maquinas m ON pd.maquina_id = m.id
       JOIN sectores s ON m.sector_id = s.id
       LEFT JOIN intervenciones i2 ON i2.maquina_id = m.id
       ${detenidasWhere}
       GROUP BY m.id, m.nombre, m.codigo, m.estado, s.id, s.nombre
       ORDER BY inactividad_en_curso_minutos DESC, m.id ASC`,
      detenidasParams
    );

    const detenidasAhora = resDetenidas.rows.map((r) => ({
      maquina: {
        id: Number(r.maquina_id),
        nombre: r.maquina_nombre,
        codigo: r.maquina_codigo,
        sector: {
          id: Number(r.sector_id),
          nombre: r.sector_nombre,
        },
      },
      estado: r.maquina_estado,
      detenida_desde: r.detenida_desde instanceof Date ? r.detenida_desde.toISOString() : String(r.detenida_desde),
      inactividad_en_curso_minutos: Number(r.inactividad_en_curso_minutos),
      intervenciones_abiertas: Number(r.intervenciones_abiertas),
    }));

    return c.json({
      maquinas: maquinasMap,
      intervenciones: intervencionesResumen,
      detenidas_ahora: detenidasAhora,
    });
  } catch (error) {
    return responderError(c, error);
  }
});

export default tableroApp;
