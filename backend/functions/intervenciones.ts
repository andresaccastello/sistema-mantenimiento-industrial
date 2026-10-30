import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission, getUserScope } from './middleware.ts';
import { parseId, parseString, badRequest } from './validations.ts';
import { ErrorNegocio, responderError } from './intervenciones/errores.ts';
import { conTransaccion } from './intervenciones/transaccion.ts';
import { puedeVerIntervencion, UsuarioVisibilidad } from './intervenciones/visibilidad.ts';
import { recalcularEstadoMaquina } from './intervenciones/recalculoMaquina.ts';
import { registrarAuditoria, registrarNotificaciones } from './intervenciones/auditoria.ts';
import {
  tomarIntervencionServicio,
  asignarResponsableServicio,
  desasignarResponsableServicio,
  ejecutarTransicionServicio,
  validarResponsableHabilitado,
  finalizarIntervencionServicio,
  resolverAhoraIntervencionServicio,
  cancelarIntervencionServicio,
  reabrirIntervencionServicio,
  eliminarIntervencionServicio,
  editarIntervencionServicio,
  obtenerAccionesDisponibles,
} from './intervenciones/motor.ts';
import { registrarDetencionIntervencion } from './intervenciones/detenciones.ts';
import { usuariosConPermiso } from './intervenciones/notificaciones.ts';
import { validarFechaISO } from './intervenciones/fechas.ts';

const intervencionesApp = new Hono();

// Todos los endpoints de intervenciones requieren autenticación y usuario activo
intervencionesApp.use('*', jwtVerify, dbVerify);

/**
 * Helper para armar el objeto UsuarioVisibilidad desde el contexto de Hono
 */
function getUsuarioContext(c: any): UsuarioVisibilidad {
  return {
    id: (c.get as any)('userId') as number,
    permisos: ((c.get as any)('userPermissionsMap') as Record<string, any>) || {},
    sectores: ((c.get as any)('userSectores') as number[]) || [],
  };
}

/**
 * 7.1 POST /api/intervenciones (Alta de falla / Intervención)
 * Refactorizado: usa conTransaccion, bloqueo FOR UPDATE sobre la máquina,
 * y recálculo determinista de estado (eliminando el UPDATE directo).
 */
intervencionesApp.post('/', requirePermission('INTERVENCIONES_CREAR'), async (c) => {
  const usuario = getUsuarioContext(c);
  const userScope = getUserScope(c, 'INTERVENCIONES_CREAR') || 'TODAS';

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return badRequest(c, 'El cuerpo de la solicitud debe ser un JSON válido');
  }

  const maquinaId = parseId(body.maquina_id);
  if (!maquinaId) {
    return badRequest(c, 'El ID de la máquina es obligatorio y debe ser un número entero positivo');
  }

  const descripcion = parseString(body.descripcion);
  if (!descripcion || descripcion.length < 5) {
    return badRequest(c, 'La descripción de la falla es obligatoria y debe tener al menos 5 caracteres');
  }
  if (descripcion.length > 2000) {
    return badRequest(c, 'La descripción no puede superar los 2000 caracteres');
  }

  const detieneMaquina = Boolean(body.detiene_maquina);
  const observaciones = parseString(body.observaciones) || null;
  if (observaciones && observaciones.length > 2000) {
    return badRequest(c, 'Las observaciones no pueden superar los 2000 caracteres');
  }

  try {
    const resultado = await conTransaccion(async (client) => {
      // 1. Bloquear y validar la máquina con FOR UPDATE
      const resM = await client.query(
        `SELECT m.id, m.nombre, m.estado, m.activo, m.sector_id, s.nombre AS sector_nombre
         FROM maquinas m
         JOIN sectores s ON m.sector_id = s.id
         WHERE m.id = $1
         FOR UPDATE OF m`,
        [maquinaId]
      );

      if (resM.rows.length === 0) {
        throw new ErrorNegocio(404, 'MAQUINA_NO_ENCONTRADA', 'La máquina especificada no existe');
      }

      const maquina = resM.rows[0];
      if (!maquina.activo) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'No se pueden registrar fallas sobre máquinas inactivas');
      }

      // Validación de alcance sobre el sector de la máquina al crear
      if (userScope === 'SECTORES' && !usuario.sectores.includes(Number(maquina.sector_id))) {
        throw new ErrorNegocio(
          403,
          'PERMISO_INSUFICIENTE',
          'No tienes autorización para registrar intervenciones en el sector de esta máquina'
        );
      }

      // 2. Obtener tipo CORRECTIVO
      const resTipo = await client.query(
        "SELECT id FROM tipos_intervencion WHERE codigo = 'CORRECTIVO' LIMIT 1"
      );
      if (resTipo.rows.length === 0) {
        throw new Error('Tipo CORRECTIVO no configurado');
      }
      const tipoCorrectivoId = resTipo.rows[0].id;

      // 3. Insertar intervención en estado PENDIENTE
      const resIntervencion = await client.query(
        `INSERT INTO intervenciones (
           maquina_id, tipo_intervencion_id, creado_por_usuario_id,
           descripcion, estado, observaciones, fecha_creacion, actualizado_en
         )
         VALUES ($1, $2, $3, $4, 'PENDIENTE', $5, NOW(), NOW())
         RETURNING id, maquina_id, estado, fecha_creacion, descripcion, observaciones`,
        [maquinaId, tipoCorrectivoId, usuario.id, descripcion, observaciones]
      );
      const intervencion = resIntervencion.rows[0];

      // 4. Registrar estado inicial en historial_estados_intervencion (NULL -> PENDIENTE)
      await client.query(
        `INSERT INTO historial_estados_intervencion (
           intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, observacion, cambiado_en
         )
         VALUES ($1, NULL, 'PENDIENTE', $2, 'Registro inicial de falla', NOW())`,
        [intervencion.id, usuario.id]
      );

      let periodoDetencionId: number | null = null;
      let estadoMaquinaFinal = maquina.estado;

      // 5. Si la falla detuvo la máquina, abrir período y recalcular estado
      if (detieneMaquina) {
        const resPeriodo = await client.query(
          `INSERT INTO intervencion_periodos_detencion (
             intervencion_id, maquina_id, desde, abierto_por_usuario_id, observacion
           )
           VALUES ($1, $2, NOW(), $3, 'Detención reportada al registrar la falla')
           RETURNING id`,
          [intervencion.id, maquinaId, usuario.id]
        );
        periodoDetencionId = Number(resPeriodo.rows[0].id);

        const recalculo = await recalcularEstadoMaquina(client, maquinaId, {
          usuarioId: usuario.id,
          intervencionId: Number(intervencion.id),
          motivo: 'Máquina detenida por reporte de falla',
        });

        estadoMaquinaFinal = recalculo.estadoNuevo;
      }

      // 6. Emitir eventos
      const eventos: Array<{ tipo: string; payload: any }> = [
        { tipo: 'FALLA_REGISTRADA', payload: { intervencionId: Number(intervencion.id) } },
      ];
      if (estadoMaquinaFinal !== maquina.estado) {
        eventos.push({
          tipo: 'MAQUINA_CAMBIO_ESTADO',
          payload: { maquinaId, estadoAnterior: maquina.estado, estadoNuevo: estadoMaquinaFinal },
        });
      }
      await registrarNotificaciones(client, eventos, { actorId: usuario.id });

      return {
        id: Number(intervencion.id),
        estado: intervencion.estado,
        descripcion: intervencion.descripcion,
        observaciones: intervencion.observaciones,
        fecha_creacion: intervencion.fecha_creacion,
        detiene_maquina: detieneMaquina,
        periodo_detencion_id: periodoDetencionId,
        maquina: {
          id: Number(maquina.id),
          nombre: maquina.nombre,
          estado_actual: estadoMaquinaFinal,
          sector: {
            id: Number(maquina.sector_id),
            nombre: maquina.sector_nombre,
          },
        },
      };
    });

    return c.json(resultado, 201);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * GET /api/intervenciones
 * Listado de intervenciones según alcance.
 */
intervencionesApp.get('/', requirePermission('INTERVENCIONES_VER'), async (c) => {
  const usuario = getUsuarioContext(c);
  const userScope = getUserScope(c, 'INTERVENCIONES_VER') || 'TODAS';
  const sinAsignar = c.req.query('sin_asignar') === 'true';
  const incluirEliminadas = c.req.query('incluir_eliminadas') === 'true';

  if (incluirEliminadas) {
    if (!('INTERVENCIONES_ELIMINAR' in usuario.permisos)) {
      return responderError(
        c,
        new ErrorNegocio(
          403,
          'PERMISO_INSUFICIENTE',
          'No posees permiso para consultar intervenciones eliminadas'
        )
      );
    }
  }

  try {
    // 1. Validación de parámetros de filtro y paginación
    const estadoParam = c.req.query('estado');
    let estadosFiltro: string[] | null = null;
    if (estadoParam !== undefined && estadoParam !== null && estadoParam.trim() !== '') {
      const tokens = estadoParam.split(',').map((s) => s.trim());
      const estadosValidos = ['PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS', 'FINALIZADA', 'CANCELADA'];
      for (const tok of tokens) {
        if (!estadosValidos.includes(tok)) {
          throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `Estado de intervención inválido: ${tok}`);
        }
      }
      estadosFiltro = tokens;
    }

    const maquinaIdParam = c.req.query('maquina_id');
    let maquinaIdFiltro: number | null = null;
    if (maquinaIdParam !== undefined && maquinaIdParam !== null && maquinaIdParam.trim() !== '') {
      const parsed = parseId(maquinaIdParam);
      if (!parsed) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El parámetro maquina_id debe ser un número entero positivo');
      }
      maquinaIdFiltro = parsed;
    }

    const sectorIdParam = c.req.query('sector_id');
    let sectorIdFiltro: number | null = null;
    if (sectorIdParam !== undefined && sectorIdParam !== null && sectorIdParam.trim() !== '') {
      const parsed = parseId(sectorIdParam);
      if (!parsed) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El parámetro sector_id debe ser un número entero positivo');
      }
      sectorIdFiltro = parsed;
    }

    const tipoParam = c.req.query('tipo');
    let tipoFiltro: string | null = null;
    if (tipoParam !== undefined && tipoParam !== null && tipoParam.trim() !== '') {
      const tTrim = tipoParam.trim().toUpperCase();
      if (tTrim !== 'CORRECTIVO' && tTrim !== 'PREVENTIVO') {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `Tipo de intervención inválido: ${tipoParam}`);
      }
      tipoFiltro = tTrim;
    }

    const responsableIdParam = c.req.query('responsable_id');
    let responsableIdFiltro: number | null = null;
    if (responsableIdParam !== undefined && responsableIdParam !== null && responsableIdParam.trim() !== '') {
      const parsed = parseId(responsableIdParam);
      if (!parsed) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El parámetro responsable_id debe ser un número entero positivo');
      }
      responsableIdFiltro = parsed;
    }

    const miasParam = c.req.query('mias');
    const filtrarMias = miasParam === 'true';

    const desdeParam = c.req.query('desde');
    let desdeFiltro: string | null = null;
    if (desdeParam !== undefined && desdeParam !== null && desdeParam.trim() !== '') {
      desdeFiltro = await validarFechaISO(pool, desdeParam.trim(), 'desde');
    }

    const hastaParam = c.req.query('hasta');
    let hastaFiltro: string | null = null;
    if (hastaParam !== undefined && hastaParam !== null && hastaParam.trim() !== '') {
      hastaFiltro = await validarFechaISO(pool, hastaParam.trim(), 'hasta');
    }

    const qParam = c.req.query('q');
    let qFiltro: string | null = null;
    if (qParam !== undefined && qParam !== null) {
      const qTrim = qParam.trim();
      if (qTrim.length < 2 || qTrim.length > 100) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El parámetro de búsqueda q debe tener entre 2 y 100 caracteres');
      }
      qFiltro = qTrim;
    }

    const limitParam = c.req.query('limit');
    let limitVal: number | null = null;
    if (limitParam !== undefined && limitParam !== null && limitParam.trim() !== '') {
      const parsedLimit = Number(limitParam);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El parámetro limit debe ser un entero entre 1 y 200');
      }
      limitVal = parsedLimit;
    }

    const offsetParam = c.req.query('offset');
    let offsetVal = 0;
    if (offsetParam !== undefined && offsetParam !== null && offsetParam.trim() !== '') {
      const parsedOffset = Number(offsetParam);
      if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El parámetro offset debe ser un entero mayor o igual a 0');
      }
      offsetVal = parsedOffset;
    }

    // 2. Construcción de condiciones WHERE
    const conditions: string[] = [];
    const params: any[] = [];

    if (!incluirEliminadas) {
      conditions.push('i.eliminado_en IS NULL');
    }

    if (userScope === 'PROPIAS') {
      params.push(usuario.id);
      conditions.push(`(i.creado_por_usuario_id = $${params.length} OR i.responsable_usuario_id = $${params.length})`);
    } else if (userScope === 'SECTORES') {
      if (usuario.sectores.length === 0) {
        c.header('X-Total-Count', '0');
        return c.json([]);
      }
      params.push(usuario.sectores);
      conditions.push(`m.sector_id = ANY($${params.length})`);
    }

    if (sinAsignar) {
      conditions.push("i.responsable_usuario_id IS NULL AND i.estado = 'PENDIENTE'");
    }

    if (estadosFiltro) {
      params.push(estadosFiltro);
      conditions.push(`i.estado = ANY($${params.length})`);
    }

    if (maquinaIdFiltro !== null) {
      params.push(maquinaIdFiltro);
      conditions.push(`i.maquina_id = $${params.length}`);
    }

    if (sectorIdFiltro !== null) {
      params.push(sectorIdFiltro);
      conditions.push(`m.sector_id = $${params.length}`);
    }

    if (tipoFiltro !== null) {
      params.push(tipoFiltro);
      conditions.push(`ti.codigo = $${params.length}`);
    }

    if (responsableIdFiltro !== null) {
      params.push(responsableIdFiltro);
      conditions.push(`i.responsable_usuario_id = $${params.length}`);
    }

    if (filtrarMias) {
      params.push(usuario.id);
      conditions.push(`i.responsable_usuario_id = $${params.length}`);
    }

    if (desdeFiltro !== null) {
      params.push(desdeFiltro);
      conditions.push(`i.fecha_creacion >= $${params.length}::timestamptz`);
    }

    if (hastaFiltro !== null) {
      params.push(hastaFiltro);
      conditions.push(`i.fecha_creacion <= $${params.length}::timestamptz`);
    }

    if (qFiltro !== null) {
      params.push(`%${qFiltro}%`);
      conditions.push(`(i.descripcion ILIKE $${params.length} OR m.nombre ILIKE $${params.length} OR m.codigo ILIKE $${params.length})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 3. Consulta de conteo total para X-Total-Count
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM intervenciones i
      JOIN maquinas m ON i.maquina_id = m.id
      JOIN sectores s ON m.sector_id = s.id
      JOIN tipos_intervencion ti ON i.tipo_intervencion_id = ti.id
      ${whereClause}
    `;
    const resCount = await pool.query(countQuery, params);
    const totalCount = parseInt(resCount.rows[0].total, 10);
    c.header('X-Total-Count', String(totalCount));

    // 4. Cláusula de paginación
    let paginationClause = '';
    const dataParams = [...params];
    if (limitVal !== null) {
      dataParams.push(limitVal);
      const limitIdx = dataParams.length;
      dataParams.push(offsetVal);
      const offsetIdx = dataParams.length;
      paginationClause = `LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    }

    const query = `
      SELECT 
        i.id,
        i.descripcion,
        i.estado,
        i.ejecucion,
        i.fecha_creacion,
        i.fecha_inicio,
        i.fecha_finalizacion,
        i.tiempo_inactividad_minutos,
        i.eliminado_en,
        i.motivo_eliminacion,
        uel.id AS eliminador_id,
        uel.legajo AS eliminador_legajo,
        uel.nombre AS eliminador_nombre,
        m.id AS maquina_id,
        m.nombre AS maquina_nombre,
        m.codigo AS maquina_codigo,
        m.estado AS maquina_estado,
        s.id AS sector_id,
        s.nombre AS sector_nombre,
        uc.id AS creador_id,
        uc.legajo AS creador_legajo,
        uc.nombre AS creador_nombre,
        ur.id AS responsable_id,
        ur.legajo AS responsable_legajo,
        ur.nombre AS responsable_nombre,
        (pd.id IS NOT NULL) AS detiene_maquina_actualmente,
        vit.espera_minutos,
        vit.espera_en_curso,
        vit.duracion_bruta_minutos,
        vit.duracion_neta_minutos,
        vit.tiempo_total_minutos,
        vit.trabajo_en_curso,
        vit.inactividad_minutos AS vit_inactividad_minutos,
        vit.inactividad_en_curso
      FROM intervenciones i
      JOIN maquinas m ON i.maquina_id = m.id
      JOIN sectores s ON m.sector_id = s.id
      JOIN tipos_intervencion ti ON i.tipo_intervencion_id = ti.id
      JOIN usuarios uc ON i.creado_por_usuario_id = uc.id
      LEFT JOIN usuarios ur ON i.responsable_usuario_id = ur.id
      LEFT JOIN usuarios uel ON i.eliminado_por_usuario_id = uel.id
      LEFT JOIN intervencion_periodos_detencion pd 
        ON pd.intervencion_id = i.id AND pd.hasta IS NULL
      LEFT JOIN v_intervencion_tiempos vit
        ON vit.intervencion_id = i.id
      ${whereClause}
      ORDER BY 
        (pd.id IS NOT NULL) DESC,
        i.fecha_creacion DESC,
        i.id DESC
      ${paginationClause}
    `;

    const { rows } = await pool.query(query, dataParams);

    const result = rows.map((r) => ({
      id: Number(r.id),
      descripcion: r.descripcion,
      estado: r.estado,
      ejecucion: r.ejecucion,
      fecha_creacion: r.fecha_creacion,
      fecha_inicio: r.fecha_inicio,
      fecha_finalizacion: r.fecha_finalizacion,
      tiempo_inactividad_minutos: r.tiempo_inactividad_minutos,
      detiene_maquina_actualmente: Boolean(r.detiene_maquina_actualmente),
      eliminada: Boolean(r.eliminado_en),
      eliminado_en: r.eliminado_en,
      eliminado_por: r.eliminador_id
        ? {
            id: Number(r.eliminador_id),
            legajo: r.eliminador_legajo,
            nombre: r.eliminador_nombre,
          }
        : null,
      motivo_eliminacion: r.motivo_eliminacion,
      maquina: {
        id: Number(r.maquina_id),
        nombre: r.maquina_nombre,
        codigo: r.maquina_codigo,
        estado: r.maquina_estado,
        sector: {
          id: Number(r.sector_id),
          nombre: r.sector_nombre,
        },
      },
      creado_por: {
        id: Number(r.creador_id),
        legajo: r.creador_legajo,
        nombre: r.creador_nombre,
      },
      responsable: r.responsable_id
        ? {
            id: Number(r.responsable_id),
            legajo: r.responsable_legajo,
            nombre: r.responsable_nombre,
          }
        : null,
      tiempos: {
        espera_minutos: r.espera_minutos !== null ? Number(r.espera_minutos) : null,
        espera_en_curso: Boolean(r.espera_en_curso),
        duracion_bruta_minutos: r.duracion_bruta_minutos !== null ? Number(r.duracion_bruta_minutos) : null,
        duracion_neta_minutos: r.duracion_neta_minutos !== null ? Number(r.duracion_neta_minutos) : null,
        tiempo_total_minutos: r.tiempo_total_minutos !== null ? Number(r.tiempo_total_minutos) : null,
        trabajo_en_curso: Boolean(r.trabajo_en_curso),
        inactividad_minutos: Number(r.vit_inactividad_minutos ?? 0),
        inactividad_en_curso: Boolean(r.inactividad_en_curso),
      },
    }));

    return c.json(result);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 7.3 GET /api/intervenciones/:id
 * Consulta de detalle: fuera de alcance devuelve 404 INTERVENCION_NO_ENCONTRADA.
 * Historial ordenado por cambiado_en ASC, id ASC.
 * Incluye lista de intervencion_auditoria y acciones_disponibles (API-01).
 */
intervencionesApp.get('/:id', requirePermission('INTERVENCIONES_VER'), async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID de intervención inválido');

  const usuario = getUsuarioContext(c);

  try {
    const resI = await pool.query(
      `SELECT 
         i.id, i.descripcion, i.estado, i.ejecucion, i.observaciones, i.trabajo_realizado,
         i.fecha_creacion, i.fecha_inicio, i.fecha_finalizacion,
         i.tiempo_inactividad_minutos, i.costo_mano_obra, i.costo_repuestos, i.costo_total_estimado,
         i.eliminado_en, i.creado_por_usuario_id, i.responsable_usuario_id,
         m.id AS maquina_id, m.nombre AS maquina_nombre, m.codigo AS maquina_codigo, m.estado AS maquina_estado,
         m.sector_id, s.nombre AS sector_nombre,
         uc.legajo AS creador_legajo, uc.nombre AS creador_nombre,
         ur.legajo AS responsable_legajo, ur.nombre AS responsable_nombre,
         vit.espera_minutos, vit.espera_en_curso, vit.duracion_bruta_minutos,
         vit.duracion_neta_minutos, vit.tiempo_total_minutos, vit.trabajo_en_curso,
         vit.inactividad_minutos AS vit_inactividad_minutos, vit.inactividad_en_curso
       FROM intervenciones i
       JOIN maquinas m ON i.maquina_id = m.id
       JOIN sectores s ON m.sector_id = s.id
       JOIN usuarios uc ON i.creado_por_usuario_id = uc.id
       LEFT JOIN usuarios ur ON i.responsable_usuario_id = ur.id
       LEFT JOIN v_intervencion_tiempos vit ON vit.intervencion_id = i.id
       WHERE i.id = $1`,
      [id]
    );

    const incluirEliminada = c.req.query('incluir_eliminada') === 'true' || c.req.query('incluir_eliminadas') === 'true';

    if (resI.rows.length === 0 || (resI.rows[0].eliminado_en !== null && !incluirEliminada)) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }

    const r = resI.rows[0];

    // Verificación de alcance: si no puede verla, devolver 404 (no revelar que existe)
    const visible = puedeVerIntervencion(usuario, {
      creado_por_usuario_id: Number(r.creado_por_usuario_id),
      responsable_usuario_id: r.responsable_usuario_id ? Number(r.responsable_usuario_id) : null,
      sector_id: Number(r.sector_id),
    });

    if (!visible) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }

    // Historial de cambios de estado ordenado por cambiado_en ASC, id ASC
    const resHistorial = await pool.query(
      `SELECT h.id, h.estado_anterior, h.estado_nuevo, h.observacion, h.cambiado_en, h.fecha_efectiva,
              u.id AS usuario_id, u.legajo AS usuario_legajo, u.nombre AS usuario_nombre
       FROM historial_estados_intervencion h
       JOIN usuarios u ON h.cambiado_por_usuario_id = u.id
       WHERE h.intervencion_id = $1
       ORDER BY h.cambiado_en ASC, h.id ASC`,
      [id]
    );

    // Períodos de detención
    const resPeriodos = await pool.query(
      `SELECT pd.id, pd.desde, pd.hasta, pd.observacion, pd.observacion_confirmacion,
              ua.id AS abierto_id, ua.nombre AS abierto_nombre,
              uc.id AS confirmado_id, uc.nombre AS confirmado_nombre
       FROM intervencion_periodos_detencion pd
       JOIN usuarios ua ON pd.abierto_por_usuario_id = ua.id
       LEFT JOIN usuarios uc ON pd.confirmado_por_usuario_id = uc.id
       WHERE pd.intervencion_id = $1
       ORDER BY pd.desde ASC, pd.id ASC`,
      [id]
    );

    // Auditoría de intervenciones
    const resAuditoria = await pool.query(
      `SELECT a.id, a.tipo_evento, a.campo_modificado, a.valor_anterior, a.valor_nuevo, a.motivo, a.creado_en,
              u.id AS usuario_id, u.legajo AS usuario_legajo, u.nombre AS usuario_nombre
       FROM intervencion_auditoria a
       JOIN usuarios u ON a.realizado_por_usuario_id = u.id
       WHERE a.intervencion_id = $1
       ORDER BY a.creado_en ASC, a.id ASC`,
      [id]
    );

    // Cálculo de acciones disponibles (API-01)
    const tieneDetencionAbierta = resPeriodos.rows.some((p: any) => p.hasta === null);
    const accionesDisponibles = await obtenerAccionesDisponibles(
      pool,
      {
        id: Number(r.id),
        estado: r.estado,
        creado_por_usuario_id: Number(r.creado_por_usuario_id),
        responsable_usuario_id: r.responsable_usuario_id ? Number(r.responsable_usuario_id) : null,
        fecha_inicio: r.fecha_inicio,
        eliminado_en: r.eliminado_en,
      },
      {
        id: Number(r.maquina_id),
        sector_id: Number(r.sector_id),
      },
      usuario,
      tieneDetencionAbierta
    );

    return c.json({
      id: Number(r.id),
      descripcion: r.descripcion,
      estado: r.estado,
      ejecucion: r.ejecucion,
      observaciones: r.observaciones,
      trabajo_realizado: r.trabajo_realizado,
      fecha_creacion: r.fecha_creacion,
      fecha_inicio: r.fecha_inicio,
      fecha_finalizacion: r.fecha_finalizacion,
      tiempo_inactividad_minutos: r.tiempo_inactividad_minutos,
      acciones_disponibles: accionesDisponibles,
      tiempos: {
        espera_minutos: r.espera_minutos !== null ? Number(r.espera_minutos) : null,
        espera_en_curso: Boolean(r.espera_en_curso),
        duracion_bruta_minutos: r.duracion_bruta_minutos !== null ? Number(r.duracion_bruta_minutos) : null,
        duracion_neta_minutos: r.duracion_neta_minutos !== null ? Number(r.duracion_neta_minutos) : null,
        tiempo_total_minutos: r.tiempo_total_minutos !== null ? Number(r.tiempo_total_minutos) : null,
        trabajo_en_curso: Boolean(r.trabajo_en_curso),
        inactividad_minutos: Number(r.vit_inactividad_minutos ?? 0),
        inactividad_en_curso: Boolean(r.inactividad_en_curso),
      },
      maquina: {
        id: Number(r.maquina_id),
        nombre: r.maquina_nombre,
        codigo: r.maquina_codigo,
        estado: r.maquina_estado,
        sector: {
          id: Number(r.sector_id),
          nombre: r.sector_nombre,
        },
      },
      creado_por: {
        id: Number(r.creado_por_usuario_id),
        legajo: r.creador_legajo,
        nombre: r.creador_nombre,
      },
      responsable: r.responsable_usuario_id
        ? {
            id: Number(r.responsable_usuario_id),
            legajo: r.responsable_legajo,
            nombre: r.responsable_nombre,
          }
        : null,
      historial_estados: resHistorial.rows.map((h) => ({
        id: Number(h.id),
        estado_anterior: h.estado_anterior,
        estado_nuevo: h.estado_nuevo,
        observacion: h.observacion,
        cambiado_en: h.cambiado_en,
        fecha_efectiva: h.fecha_efectiva ? (typeof h.fecha_efectiva === 'string' ? h.fecha_efectiva : new Date(h.fecha_efectiva).toISOString()) : null,
        cambiado_por: {
          id: Number(h.usuario_id),
          legajo: h.usuario_legajo,
          nombre: h.usuario_nombre,
        },
      })),
      periodos_detencion: resPeriodos.rows.map((p) => ({
        id: Number(p.id),
        desde: p.desde,
        hasta: p.hasta,
        esta_abierto: p.hasta === null,
        observacion: p.observacion,
        observacion_confirmacion: p.observacion_confirmacion,
        abierto_por: { id: Number(p.abierto_id), nombre: p.abierto_nombre },
        confirmado_por: p.confirmado_id ? { id: Number(p.confirmado_id), nombre: p.confirmado_nombre } : null,
      })),
      auditoria: resAuditoria.rows.map((a) => ({
        id: Number(a.id),
        tipo_evento: a.tipo_evento,
        campo_modificado: a.campo_modificado,
        valor_anterior: a.valor_anterior,
        valor_nuevo: a.valor_nuevo,
        motivo: a.motivo,
        creado_en: a.creado_en,
        realizado_por: {
          id: Number(a.usuario_id),
          legajo: a.usuario_legajo,
          nombre: a.usuario_nombre,
        },
      })),
    });
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 8. GET /api/intervenciones/:id/responsables-habilitados
 * Lista usuarios activos con INTERVENCIONES_RECIBIR_ASIGNACION y visibilidad sobre la intervención
 */
intervencionesApp.get('/:id/responsables-habilitados', requirePermission('INTERVENCIONES_ASIGNAR'), async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  try {
    // 1. Obtener la intervención y validar visibilidad del usuario actual
    const resI = await pool.query(
      `SELECT i.id, i.creado_por_usuario_id, i.responsable_usuario_id, i.eliminado_en, m.sector_id
       FROM intervenciones i
       JOIN maquinas m ON i.maquina_id = m.id
       WHERE i.id = $1`,
      [id]
    );

    if (resI.rows.length === 0 || resI.rows[0].eliminado_en !== null) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }

    const rowI = resI.rows[0];
    if (
      !puedeVerIntervencion(usuario, {
        creado_por_usuario_id: Number(rowI.creado_por_usuario_id),
        responsable_usuario_id: rowI.responsable_usuario_id ? Number(rowI.responsable_usuario_id) : null,
        sector_id: Number(rowI.sector_id),
      })
    ) {
      throw new ErrorNegocio(404, 'INTERVENCION_NO_ENCONTRADA', 'Intervención no encontrada');
    }

    // 2. Obtener usuarios activos con INTERVENCIONES_RECIBIR_ASIGNACION e INTERVENCIONES_VER
    const [usuariosRecibir, usuariosVer] = await Promise.all([
      usuariosConPermiso(pool, 'INTERVENCIONES_RECIBIR_ASIGNACION'),
      usuariosConPermiso(pool, 'INTERVENCIONES_VER'),
    ]);

    const setRecibir = new Set(usuariosRecibir.map((u) => u.usuario_id));
    const sectorId = Number(rowI.sector_id);

    const idsHabilitados: number[] = [];
    for (const u of usuariosVer) {
      if (!setRecibir.has(u.usuario_id)) {
        continue;
      }
      if (u.alcance === 'TODAS' || u.alcance === 'PROPIAS') {
        idsHabilitados.push(u.usuario_id);
      } else if (u.alcance === 'SECTORES' && u.sectores.includes(sectorId)) {
        idsHabilitados.push(u.usuario_id);
      }
    }

    if (idsHabilitados.length === 0) {
      return c.json([]);
    }

    const resUsers = await pool.query(
      'SELECT id, legajo, nombre FROM usuarios WHERE id = ANY($1::int[]) ORDER BY nombre ASC',
      [idsHabilitados]
    );

    const habilitados = resUsers.rows.map((u: any) => ({
      id: Number(u.id),
      legajo: u.legajo,
      nombre: u.nombre,
    }));

    return c.json(habilitados);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 5.1 POST /api/intervenciones/:id/tomar
 */
intervencionesApp.post('/:id/tomar', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    // body no json o vacío
  }

  try {
    const estadoEsperado = parseString(body?.estado_esperado);
    if (!estadoEsperado) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo estado_esperado es obligatorio');
    }

    const res = await conTransaccion(async (client) => {
      return tomarIntervencionServicio(client, id, usuario, estadoEsperado);
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 5.2 PUT /api/intervenciones/:id/responsable
 */
intervencionesApp.put('/:id/responsable', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return badRequest(c, 'El cuerpo debe ser un JSON válido');
  }

  const destinatarioId = parseId(body.usuario_id);
  if (!destinatarioId) {
    return badRequest(c, 'El usuario_id a asignar es requerido y debe ser un número entero');
  }

  const motivo = parseString(body.motivo);

  try {
    const estadoEsperado = parseString(body.estado_esperado);
    if (!estadoEsperado) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo estado_esperado es obligatorio');
    }

    const res = await conTransaccion(async (client) => {
      return asignarResponsableServicio(client, id, usuario, destinatarioId, motivo, estadoEsperado);
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 5.3 DELETE /api/intervenciones/:id/responsable
 */
intervencionesApp.delete('/:id/responsable', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return badRequest(c, 'El cuerpo debe ser un JSON válido');
  }

  const motivo = parseString(body.motivo);

  try {
    const estadoEsperado = parseString(body.estado_esperado);
    if (!estadoEsperado) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo estado_esperado es obligatorio');
    }

    const res = await conTransaccion(async (client) => {
      return desasignarResponsableServicio(client, id, usuario, motivo, estadoEsperado);
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 6.1 POST /api/intervenciones/:id/iniciar (T1)
 */
intervencionesApp.post('/:id/iniciar', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return badRequest(c, 'El cuerpo debe ser un JSON válido');
  }

  const fechaInicio = parseString(body.fecha_inicio);
  const observacion = parseString(body.observacion);

  try {
    const estadoEsperado = parseString(body.estado_esperado);
    if (!estadoEsperado) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo estado_esperado es obligatorio');
    }

    const res = await conTransaccion(async (client) => {
      return ejecutarTransicionServicio(client, id, usuario, 'INICIAR', {
        estadoEsperado,
        observacion,
        fechaInicio,
      });
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 6.2 POST /api/intervenciones/:id/espera-repuestos (T4)
 */
intervencionesApp.post('/:id/espera-repuestos', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return badRequest(c, 'El cuerpo debe ser un JSON válido');
  }

  const observacion = parseString(body.observacion) || parseString(body.motivo);

  try {
    const estadoEsperado = parseString(body.estado_esperado);
    if (!estadoEsperado) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo estado_esperado es obligatorio');
    }

    const res = await conTransaccion(async (client) => {
      return ejecutarTransicionServicio(client, id, usuario, 'ESPERAR_REPUESTOS', {
        estadoEsperado,
        observacion,
      });
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 6.3 POST /api/intervenciones/:id/reanudar (T5)
 */
intervencionesApp.post('/:id/reanudar', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return badRequest(c, 'El cuerpo debe ser un JSON válido');
  }

  const observacion = parseString(body.observacion);

  try {
    const estadoEsperado = parseString(body.estado_esperado);
    if (!estadoEsperado) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo estado_esperado es obligatorio');
    }

    const res = await conTransaccion(async (client) => {
      return ejecutarTransicionServicio(client, id, usuario, 'REANUDAR', {
        estadoEsperado,
        observacion,
      });
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 6.1 POST /api/intervenciones/:id/finalizar (T6)
 */
intervencionesApp.post('/:id/finalizar', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return badRequest(c, 'El cuerpo debe ser un JSON válido');
  }

  try {
    const estadoEsperado = parseString(body.estado_esperado);
    if (!estadoEsperado) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo estado_esperado es obligatorio');
    }

    const res = await conTransaccion(async (client) => {
      return finalizarIntervencionServicio(client, id, usuario, {
        estado_esperado: estadoEsperado,
        fecha_finalizacion: body.fecha_finalizacion,
        trabajo_realizado: body.trabajo_realizado,
        ejecucion: body.ejecucion,
        observacion: body.observacion,
        maquina_recuperada: body.maquina_recuperada,
        fecha_recuperacion: body.fecha_recuperacion,
        observacion_recuperacion: body.observacion_recuperacion,
      });
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 6.2 POST /api/intervenciones/:id/resolver-ahora (T2)
 */
const resolverAhoraHandler = async (c: any) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return badRequest(c, 'El cuerpo debe ser un JSON válido');
  }

  try {
    const estadoEsperado = parseString(body.estado_esperado);
    if (!estadoEsperado) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo estado_esperado es obligatorio');
    }

    const res = await conTransaccion(async (client) => {
      return resolverAhoraIntervencionServicio(client, id, usuario, {
        estado_esperado: estadoEsperado,
        fecha_inicio: body.fecha_inicio,
        fecha_finalizacion: body.fecha_finalizacion,
        trabajo_realizado: body.trabajo_realizado,
        ejecucion: body.ejecucion,
        observacion: body.observacion,
        maquina_recuperada: body.maquina_recuperada,
        fecha_recuperacion: body.fecha_recuperacion,
        observacion_recuperacion: body.observacion_recuperacion,
      });
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
};

intervencionesApp.post('/:id/resolver-ahora', resolverAhoraHandler);

/**
 * 6.3 POST /api/intervenciones/:id/cancelar (T3, T7, T8)
 */
intervencionesApp.post('/:id/cancelar', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return badRequest(c, 'El cuerpo debe ser un JSON válido');
  }

  try {
    const estadoEsperado = parseString(body.estado_esperado);
    if (!estadoEsperado) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo estado_esperado es obligatorio');
    }

    const res = await conTransaccion(async (client) => {
      return cancelarIntervencionServicio(client, id, usuario, {
        estado_esperado: estadoEsperado,
        motivo: body.motivo,
        maquina_recuperada: body.maquina_recuperada,
        fecha_recuperacion: body.fecha_recuperacion,
        observacion_recuperacion: body.observacion_recuperacion,
      });
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 6.4 POST /api/intervenciones/:id/registrar-detencion (D-27, RN-18)
 */
intervencionesApp.post('/:id/registrar-detencion', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return badRequest(c, 'El cuerpo debe ser un JSON válido');
  }

  try {
    const res = await conTransaccion(async (client) => {
      return registrarDetencionIntervencion(client, id, usuario, body);
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 5. POST /api/intervenciones/:id/reabrir (T9)
 */
intervencionesApp.post('/:id/reabrir', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return badRequest(c, 'El cuerpo debe ser un JSON válido');
  }

  try {
    const estadoEsperado = parseString(body.estado_esperado);
    if (!estadoEsperado) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El campo estado_esperado es obligatorio');
    }

    const res = await conTransaccion(async (client) => {
      return reabrirIntervencionServicio(client, id, usuario, {
        estado_esperado: estadoEsperado,
        motivo: body.motivo,
        maquina_detenida: body.maquina_detenida,
        desde: body.desde,
        observacion_detencion: body.observacion_detencion,
      });
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 6. POST /api/intervenciones/:id/eliminar (Eliminación lógica)
 */
intervencionesApp.post('/:id/eliminar', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return badRequest(c, 'El cuerpo debe ser un JSON válido');
  }

  try {
    const res = await conTransaccion(async (client) => {
      return eliminarIntervencionServicio(client, id, usuario, body);
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 7. PATCH /api/intervenciones/:id (Edición)
 */
intervencionesApp.patch('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return badRequest(c, 'El cuerpo debe ser un JSON válido');
  }

  try {
    const res = await conTransaccion(async (client) => {
      return editarIntervencionServicio(client, id, usuario, body);
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

export default intervencionesApp;
