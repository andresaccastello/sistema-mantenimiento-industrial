import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission, getUserScope } from './middleware.ts';
import { parseId, badRequest } from './validations.ts';
import { responderError, ErrorNegocio } from './intervenciones/errores.ts';
import { UsuarioVisibilidad } from './intervenciones/visibilidad.ts';
import { validarIntervaloReporte } from './intervalos.ts';
import { veCostos } from './repuestos/permisos.ts';
import { reportePreventivos } from './reportes/cumplimiento.ts';

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
 * 5.1 GET /api/reportes/indicadores?desde=&hasta=&planta_id=&sector_id=
 * Indicadores clave de mantenimiento (Etapa F5).
 */
reportesApp.get('/indicadores', requirePermission('REPORTES_CONSULTAR'), async (c) => {
  try {
    const usuario = getUsuarioContext(c);
    const scope = getUserScope(c, 'REPORTES_CONSULTAR');

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
        desde,
        hasta,
        maquinas: 0,
        minutos_periodo: 0,
        inactividad_minutos: 0,
        inactividad_correctiva_minutos: 0,
        inactividad_preventiva_minutos: 0,
        disponibilidad: null,
        fallas: 0,
        correctivas_finalizadas: 0,
        preventivas_finalizadas: 0,
        mttr_minutos: null,
        respuesta_promedio_minutos: null,
        mtbf_horas: null,
      });

    if (scope !== 'TODAS') {
      if (usuario.sectores.length === 0) {
        return respuestaVacia();
      }
      if (sectorId !== null && !usuario.sectores.includes(sectorId)) {
        return respuestaVacia();
      }
    }

    const condMaquinas: string[] = ['m.activo = TRUE'];
    const paramsMaquinas: any[] = [];
    let pIdx = 1;

    if (scope !== 'TODAS') {
      condMaquinas.push(`m.sector_id = ANY($${pIdx})`);
      paramsMaquinas.push(usuario.sectores);
      pIdx++;
    }

    if (sectorId !== null) {
      condMaquinas.push(`m.sector_id = $${pIdx}`);
      paramsMaquinas.push(sectorId);
      pIdx++;
    }

    if (plantaId !== null) {
      condMaquinas.push(`s.planta_id = $${pIdx}`);
      paramsMaquinas.push(plantaId);
      pIdx++;
    }

    const qMaquinas = `
      SELECT m.id
      FROM maquinas m
      JOIN sectores s ON s.id = m.sector_id
      WHERE ${condMaquinas.join(' AND ')}
    `;

    const resMaquinas = await pool.query(qMaquinas, paramsMaquinas);
    const maquinaIds = resMaquinas.rows.map((r: any) => Number(r.id));
    const cantMaquinas = maquinaIds.length;

    if (cantMaquinas === 0) {
      return respuestaVacia();
    }

    const resMinutos = await pool.query(
      `SELECT ROUND(EXTRACT(EPOCH FROM ($2::timestamptz - $1::timestamptz)) / 60)::INTEGER AS m`,
      [desde, hasta]
    );
    const minutosUnEquipo = Number(resMinutos.rows[0].m);
    const minutosPeriodo = minutosUnEquipo * cantMaquinas;

    const qInactividad = `
      SELECT
        COALESCE(SUM(f.total_minutos), 0)::INTEGER AS inactividad_minutos,
        COALESCE(SUM(f.correctivo_minutos), 0)::INTEGER AS inactividad_correctiva_minutos,
        COALESCE(SUM(f.preventivo_minutos), 0)::INTEGER AS inactividad_preventiva_minutos
      FROM maquinas m
      CROSS JOIN LATERAL fn_inactividad_maquina(m.id, $2::timestamptz, $3::timestamptz) f
      WHERE m.id = ANY($1::bigint[])
    `;
    const resInactividad = await pool.query(qInactividad, [maquinaIds, desde, hasta]);
    const rowInac = resInactividad.rows[0];
    const inactividadMinutos = Number(rowInac.inactividad_minutos);
    const inactividadCorrectivaMinutos = Number(rowInac.inactividad_correctiva_minutos);
    const inactividadPreventivaMinutos = Number(rowInac.inactividad_preventiva_minutos);

    let disponibilidad: number | null = null;
    if (minutosPeriodo > 0) {
      const dispRaw = 1 - inactividadMinutos / minutosPeriodo;
      const dispClamped = Math.max(0, Math.min(1, dispRaw));
      disponibilidad = Number(dispClamped.toFixed(4));
    }

    const qIntervenciones = `
      SELECT
        COUNT(*) FILTER (
          WHERE ti.codigo = 'CORRECTIVO'
            AND i.estado != 'CANCELADA'
            AND i.fecha_creacion >= $2::timestamptz
            AND i.fecha_creacion <= $3::timestamptz
        )::INTEGER AS fallas,

        COUNT(*) FILTER (
          WHERE ti.codigo = 'CORRECTIVO'
            AND i.estado = 'FINALIZADA'
            AND i.fecha_finalizacion >= $2::timestamptz
            AND i.fecha_finalizacion <= $3::timestamptz
        )::INTEGER AS correctivas_finalizadas,

        ROUND(AVG(vit.duracion_neta_minutos) FILTER (
          WHERE ti.codigo = 'CORRECTIVO'
            AND i.estado = 'FINALIZADA'
            AND i.fecha_finalizacion >= $2::timestamptz
            AND i.fecha_finalizacion <= $3::timestamptz
        ))::INTEGER AS mttr_minutos,

        ROUND(AVG(vit.espera_minutos) FILTER (
          WHERE ti.codigo = 'CORRECTIVO'
            AND i.estado = 'FINALIZADA'
            AND i.fecha_finalizacion >= $2::timestamptz
            AND i.fecha_finalizacion <= $3::timestamptz
        ))::INTEGER AS respuesta_promedio_minutos,

        COUNT(*) FILTER (
          WHERE ti.codigo = 'PREVENTIVO'
            AND i.estado = 'FINALIZADA'
            AND i.fecha_finalizacion >= $2::timestamptz
            AND i.fecha_finalizacion <= $3::timestamptz
        )::INTEGER AS preventivas_finalizadas

      FROM intervenciones i
      JOIN tipos_intervencion ti ON ti.id = i.tipo_intervencion_id
      LEFT JOIN v_intervencion_tiempos vit ON vit.intervencion_id = i.id
      WHERE i.maquina_id = ANY($1::bigint[])
        AND i.eliminado_en IS NULL
        AND (
          (ti.codigo = 'CORRECTIVO' AND i.estado != 'CANCELADA' AND i.fecha_creacion >= $2::timestamptz AND i.fecha_creacion <= $3::timestamptz)
          OR
          (ti.codigo IN ('CORRECTIVO', 'PREVENTIVO') AND i.estado = 'FINALIZADA' AND i.fecha_finalizacion >= $2::timestamptz AND i.fecha_finalizacion <= $3::timestamptz)
        )
    `;

    const resIntervenciones = await pool.query(qIntervenciones, [maquinaIds, desde, hasta]);
    const rowInt = resIntervenciones.rows[0];

    const fallas = Number(rowInt.fallas);
    const correctivasFinalizadas = Number(rowInt.correctivas_finalizadas);
    const preventivasFinalizadas = Number(rowInt.preventivas_finalizadas);
    const mttrMinutos = rowInt.mttr_minutos !== null ? Number(rowInt.mttr_minutos) : null;
    const respuestaPromedioMinutos =
      rowInt.respuesta_promedio_minutos !== null ? Number(rowInt.respuesta_promedio_minutos) : null;

    let mtbfHoras: number | null = null;
    if (fallas > 0) {
      const mtbf = (minutosPeriodo - inactividadCorrectivaMinutos) / fallas / 60;
      mtbfHoras = Number(mtbf.toFixed(1));
    }

    return c.json({
      desde,
      hasta,
      maquinas: cantMaquinas,
      minutos_periodo: minutosPeriodo,
      inactividad_minutos: inactividadMinutos,
      inactividad_correctiva_minutos: inactividadCorrectivaMinutos,
      inactividad_preventiva_minutos: inactividadPreventivaMinutos,
      disponibilidad,
      fallas,
      correctivas_finalizadas: correctivasFinalizadas,
      preventivas_finalizadas: preventivasFinalizadas,
      mttr_minutos: mttrMinutos,
      respuesta_promedio_minutos: respuestaPromedioMinutos,
      mtbf_horas: mtbfHoras,
    });
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 5.2 GET /api/reportes/inactividad?desde=&hasta=&sector_id=&planta_id=
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

    if (scope !== 'TODAS') {
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

      // Con alcance no TODAS (SECTORES o PROPIAS), si pide un sector no asignado -> simplemente no aparece
      if (scope !== 'TODAS' && !usuario.sectores.includes(sectorId)) {
        return c.json([]);
      }

      conditions.push(`m.sector_id = $${paramIndex}`);
      params.push(sectorId);
      paramIndex++;
    }

    const plantaIdQuery = c.req.query('planta_id');
    if (plantaIdQuery !== undefined && plantaIdQuery !== null && plantaIdQuery.trim() !== '') {
      const plantaId = parseId(plantaIdQuery);
      if (!plantaId) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El planta_id debe ser un entero válido');
      }

      conditions.push(`s.planta_id = $${paramIndex}`);
      params.push(plantaId);
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
            AND tstzrange(p.desde, GREATEST(p.desde, COALESCE(p.hasta, NOW()))) && tstzrange($1::timestamptz, $2::timestamptz)
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
    let paramIndex = 3;

    if (scope !== 'TODAS') {
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

      if (scope !== 'TODAS' && !usuario.sectores.includes(sectorId)) {
        return c.json([]);
      }

      conditions.push(`m.sector_id = $${paramIndex}`);
      params.push(sectorId);
      paramIndex++;
    }

    const plantaIdQuery = c.req.query('planta_id');
    if (plantaIdQuery !== undefined && plantaIdQuery !== null && plantaIdQuery.trim() !== '') {
      const plantaId = parseId(plantaIdQuery);
      if (!plantaId) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El planta_id debe ser un entero válido');
      }

      conditions.push(`s.planta_id = $${paramIndex}`);
      params.push(plantaId);
      paramIndex++;
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

/**
 * 5.4 GET /api/reportes/repuestos?desde=&hasta=&planta_id=&sector_id=
 * Reporte de consumos de repuestos.
 */
reportesApp.get('/repuestos', requirePermission('REPORTES_CONSULTAR'), async (c) => {
  try {
    const usuario = getUsuarioContext(c);
    const scope = getUserScope(c, 'REPORTES_CONSULTAR');
    const hasVeCostos = veCostos(c);

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
        desde,
        hasta,
        ve_costos: hasVeCostos,
        consumos: 0,
        intervenciones: 0,
        importe_total: hasVeCostos ? 0 : null,
        por_repuesto: [],
        por_maquina: [],
      });

    if (scope !== 'TODAS') {
      if (usuario.sectores.length === 0) {
        return respuestaVacia();
      }
      if (sectorId !== null && !usuario.sectores.includes(sectorId)) {
        return respuestaVacia();
      }
    }

    const conditions: string[] = [
      'i.eliminado_en IS NULL',
      'ir.anulado_en IS NULL',
      'ir.creado_en >= $1::timestamptz',
      'ir.creado_en <= $2::timestamptz',
    ];
    const params: any[] = [desde, hasta];
    let pIdx = 3;

    if (scope !== 'TODAS') {
      conditions.push(`m.sector_id = ANY($${pIdx})`);
      params.push(usuario.sectores);
      pIdx++;
    }

    if (sectorId !== null) {
      conditions.push(`m.sector_id = $${pIdx}`);
      params.push(sectorId);
      pIdx++;
    }

    if (plantaId !== null) {
      conditions.push(`s.planta_id = $${pIdx}`);
      params.push(plantaId);
      pIdx++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // 1. Totales generales
    const qTotales = `
      SELECT
        COUNT(ir.id)::INTEGER AS total_consumos,
        COUNT(DISTINCT i.id)::INTEGER AS total_intervenciones,
        COALESCE(SUM(ROUND(ir.cantidad * ir.costo_unitario_aplicado, 2)), 0)::NUMERIC AS total_importe
      FROM intervencion_repuestos ir
      JOIN intervenciones i ON i.id = ir.intervencion_id
      JOIN maquinas m ON m.id = i.maquina_id
      JOIN sectores s ON s.id = m.sector_id
      ${whereClause}
    `;

    const resTotales = await pool.query(qTotales, params);
    const rowTotales = resTotales.rows[0];
    const totalConsumos = Number(rowTotales.total_consumos);
    const totalIntervenciones = Number(rowTotales.total_intervenciones);
    const totalImporte = Number(rowTotales.total_importe);

    // 2. Por repuesto
    const orderRepuesto = hasVeCostos
      ? 'ORDER BY importe DESC, r.nombre ASC'
      : 'ORDER BY cantidad DESC, r.nombre ASC';

    const qPorRepuesto = `
      SELECT
        r.id AS repuesto_id,
        r.codigo AS repuesto_codigo,
        r.nombre AS repuesto_nombre,
        r.unidad AS repuesto_unidad,
        COALESCE(SUM(ir.cantidad), 0)::NUMERIC AS cantidad,
        COUNT(ir.id)::INTEGER AS consumos,
        COUNT(DISTINCT ir.intervencion_id)::INTEGER AS intervenciones,
        COALESCE(SUM(ROUND(ir.cantidad * ir.costo_unitario_aplicado, 2)), 0)::NUMERIC AS importe
      FROM intervencion_repuestos ir
      JOIN intervenciones i ON i.id = ir.intervencion_id
      JOIN maquinas m ON m.id = i.maquina_id
      JOIN sectores s ON s.id = m.sector_id
      JOIN repuestos r ON r.id = ir.repuesto_id
      ${whereClause}
      GROUP BY r.id, r.codigo, r.nombre, r.unidad
      ${orderRepuesto}
    `;

    const resPorRepuesto = await pool.query(qPorRepuesto, params);
    const porRepuesto = resPorRepuesto.rows.map((r) => ({
      repuesto: {
        id: Number(r.repuesto_id),
        codigo: r.repuesto_codigo,
        nombre: r.repuesto_nombre,
        unidad: r.repuesto_unidad,
      },
      cantidad: Number(r.cantidad),
      consumos: Number(r.consumos),
      intervenciones: Number(r.intervenciones),
      importe: hasVeCostos ? Number(r.importe) : null,
    }));

    // 3. Por máquina
    const orderMaquina = hasVeCostos
      ? 'ORDER BY importe DESC, m.nombre ASC'
      : 'ORDER BY consumos DESC, m.nombre ASC';

    const qPorMaquina = `
      SELECT
        m.id AS maquina_id,
        m.codigo AS maquina_codigo,
        m.nombre AS maquina_nombre,
        s.id AS sector_id,
        s.nombre AS sector_nombre,
        COUNT(ir.id)::INTEGER AS consumos,
        COALESCE(SUM(ROUND(ir.cantidad * ir.costo_unitario_aplicado, 2)), 0)::NUMERIC AS importe
      FROM intervencion_repuestos ir
      JOIN intervenciones i ON i.id = ir.intervencion_id
      JOIN maquinas m ON m.id = i.maquina_id
      JOIN sectores s ON s.id = m.sector_id
      ${whereClause}
      GROUP BY m.id, m.codigo, m.nombre, s.id, s.nombre
      ${orderMaquina}
    `;

    const resPorMaquina = await pool.query(qPorMaquina, params);
    const porMaquina = resPorMaquina.rows.map((m) => ({
      maquina: {
        id: Number(m.maquina_id),
        codigo: m.maquina_codigo,
        nombre: m.maquina_nombre,
      },
      sector: {
        id: Number(m.sector_id),
        nombre: m.sector_nombre,
      },
      consumos: Number(m.consumos),
      importe: hasVeCostos ? Number(m.importe) : null,
    }));

    return c.json({
      desde,
      hasta,
      ve_costos: hasVeCostos,
      consumos: totalConsumos,
      intervenciones: totalIntervenciones,
      importe_total: hasVeCostos ? totalImporte : null,
      por_repuesto: porRepuesto,
      por_maquina: porMaquina,
    });
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * Etapa C1, sección 5: GET /api/reportes/costos?desde=&hasta=&planta_id=&sector_id=
 * Gasto registrado en el período (D-019, punto 8): consumos no anulados por
 * creado_en y renglones no anulados por registrado_en, de intervenciones no
 * eliminadas y de las máquinas visibles de la selección, activas o no.
 */
reportesApp.get('/costos', requirePermission('REPORTES_CONSULTAR'), async (c) => {
  try {
    const usuario = getUsuarioContext(c);
    if (!('COSTOS_VER' in usuario.permisos)) {
      throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tiene permiso para ver costos');
    }
    const scope = getUserScope(c, 'REPORTES_CONSULTAR');

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
        desde,
        hasta,
        total: 0,
        intervenciones: 0,
        por_tipo: { repuestos: 0, mano_obra: 0, servicio_externo: 0, transporte: 0, otro: 0, ajuste: 0 },
        por_maquina: [],
        horas_por_persona: [],
      });

    if (scope !== 'TODAS') {
      if (usuario.sectores.length === 0) {
        return respuestaVacia();
      }
      if (sectorId !== null && !usuario.sectores.includes(sectorId)) {
        return respuestaVacia();
      }
    }

    // Filtros comunes a consumos y renglones ($1 desde, $2 hasta)
    const filtros: string[] = ['i.eliminado_en IS NULL'];
    const params: any[] = [desde, hasta];
    let pIdx = 3;

    if (scope !== 'TODAS') {
      filtros.push(`m.sector_id = ANY($${pIdx})`);
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
    const filtrosSql = filtros.join(' AND ');

    // Cada gasto del período, en una sola lista
    const sqlGastos = `
      WITH gastos AS (
        SELECT i.id AS intervencion_id, m.id AS maquina_id, 'REPUESTOS'::text AS tipo,
               ROUND(ir.cantidad * ir.costo_unitario_aplicado, 2) AS importe,
               NULL::numeric AS horas, NULL::bigint AS usuario_id, NULL::bigint AS proveedor_id
        FROM intervencion_repuestos ir
        JOIN intervenciones i ON i.id = ir.intervencion_id
        JOIN maquinas m ON m.id = i.maquina_id
        JOIN sectores s ON s.id = m.sector_id
        WHERE ${filtrosSql}
          AND ir.anulado_en IS NULL
          AND ir.creado_en >= $1::timestamptz AND ir.creado_en <= $2::timestamptz
        UNION ALL
        SELECT i.id, m.id, ic.tipo::text, ic.importe, ic.horas, ic.usuario_id, ic.proveedor_id
        FROM intervencion_costos ic
        JOIN intervenciones i ON i.id = ic.intervencion_id
        JOIN maquinas m ON m.id = i.maquina_id
        JOIN sectores s ON s.id = m.sector_id
        WHERE ${filtrosSql}
          AND ic.anulado_en IS NULL
          AND ic.registrado_en >= $1::timestamptz AND ic.registrado_en <= $2::timestamptz
      )
    `;

    // 1. Totales y por tipo
    const resTot = await pool.query(
      `${sqlGastos}
       SELECT
         COALESCE(SUM(importe), 0) AS total,
         COUNT(DISTINCT intervencion_id)::integer AS intervenciones,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'REPUESTOS'), 0) AS repuestos,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'MANO_OBRA'), 0) AS mano_obra,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'SERVICIO_EXTERNO'), 0) AS servicio_externo,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'TRANSPORTE'), 0) AS transporte,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'OTRO'), 0) AS otro,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'AJUSTE'), 0) AS ajuste
       FROM gastos`,
      params
    );
    const t = resTot.rows[0];

    // 2. Por máquina
    const resMaq = await pool.query(
      `${sqlGastos}
       SELECT
         m.id AS maquina_id, m.codigo AS maquina_codigo, m.nombre AS maquina_nombre,
         s.id AS sector_id, s.nombre AS sector_nombre,
         COALESCE(SUM(g.importe) FILTER (WHERE g.tipo = 'REPUESTOS'), 0) AS repuestos,
         COALESCE(SUM(g.importe) FILTER (WHERE g.tipo = 'MANO_OBRA'), 0) AS mano_obra,
         COALESCE(SUM(g.importe) FILTER (WHERE g.tipo NOT IN ('REPUESTOS', 'MANO_OBRA')), 0) AS otros,
         COALESCE(SUM(g.importe), 0) AS total
       FROM gastos g
       JOIN maquinas m ON m.id = g.maquina_id
       JOIN sectores s ON s.id = m.sector_id
       GROUP BY m.id, m.codigo, m.nombre, s.id, s.nombre
       ORDER BY total DESC, m.nombre ASC, m.id ASC`,
      params
    );

    // 3. Horas por persona (interna) o proveedor (externa)
    const resHoras = await pool.query(
      `${sqlGastos}
       SELECT
         u.id AS usuario_id, u.nombre AS usuario_nombre, u.apellido AS usuario_apellido,
         p.id AS proveedor_id, p.nombre AS proveedor_nombre,
         COALESCE(SUM(g.horas), 0) AS horas,
         COALESCE(SUM(g.importe), 0) AS importe
       FROM gastos g
       LEFT JOIN usuarios u ON u.id = g.usuario_id
       LEFT JOIN proveedores p ON p.id = g.proveedor_id
       WHERE g.tipo = 'MANO_OBRA'
       GROUP BY u.id, u.nombre, u.apellido, p.id, p.nombre
       ORDER BY horas DESC, COALESCE(u.apellido, p.nombre) ASC, u.id ASC NULLS LAST, p.id ASC NULLS LAST`,
      params
    );

    return c.json({
      desde,
      hasta,
      total: Number(t.total),
      intervenciones: Number(t.intervenciones),
      por_tipo: {
        repuestos: Number(t.repuestos),
        mano_obra: Number(t.mano_obra),
        servicio_externo: Number(t.servicio_externo),
        transporte: Number(t.transporte),
        otro: Number(t.otro),
        ajuste: Number(t.ajuste),
      },
      por_maquina: resMaq.rows.map((r) => ({
        maquina: { id: Number(r.maquina_id), codigo: r.maquina_codigo, nombre: r.maquina_nombre },
        sector: { id: Number(r.sector_id), nombre: r.sector_nombre },
        repuestos: Number(r.repuestos),
        mano_obra: Number(r.mano_obra),
        otros: Number(r.otros),
        total: Number(r.total),
      })),
      horas_por_persona: resHoras.rows.map((r) => ({
        persona: r.usuario_id
          ? { id: Number(r.usuario_id), nombre: r.usuario_nombre, apellido: r.usuario_apellido }
          : null,
        proveedor: r.proveedor_id ? { id: Number(r.proveedor_id), nombre: r.proveedor_nombre } : null,
        horas: Number(r.horas),
        importe: Number(r.importe),
      })),
    });
  } catch (error) {
    return responderError(c, error);
  }
});

reportesApp.get('/preventivos', requirePermission('REPORTES_CONSULTAR'), reportePreventivos);

export default reportesApp;
