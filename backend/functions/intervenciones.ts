import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission, getUserScope } from './middleware.ts';
import { parseId, parseString, badRequest } from './validations.ts';

const intervencionesApp = new Hono();

// Todos los endpoints de intervenciones requieren autenticación y verificación de usuario activo
intervencionesApp.use('*', jwtVerify, dbVerify);

/**
 * POST /api/intervenciones
 * Registra una nueva falla / intervención de tipo CORRECTIVO.
 * Unifica el aviso de falla y la intervención en un solo registro atómico.
 */
intervencionesApp.post('/', requirePermission('INTERVENCIONES_CREAR'), async (c) => {
  const userId = (c.get as any)('userId') as number;
  const userScope = getUserScope(c, 'INTERVENCIONES_CREAR') || 'TODAS';
  const userSectores = ((c.get as any)('userSectores') as number[]) || [];

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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Validar existencia, estado y sector de la máquina
    const resM = await client.query(
      `SELECT m.id, m.nombre, m.estado, m.activo, m.sector_id, s.nombre as sector_nombre
       FROM maquinas m
       JOIN sectores s ON m.sector_id = s.id
       WHERE m.id = $1`,
      [maquinaId]
    );

    if (resM.rows.length === 0) {
      await client.query('ROLLBACK');
      return c.json({ error: 'La máquina especificada no existe' }, 404);
    }

    const maquina = resM.rows[0];
    if (!maquina.activo) {
      await client.query('ROLLBACK');
      return badRequest(c, 'No se pueden registrar fallas sobre máquinas inactivas');
    }

    // Validación de alcance si el usuario tiene restricción de sectores para crear
    if (userScope === 'SECTORES' && !userSectores.includes(Number(maquina.sector_id))) {
      await client.query('ROLLBACK');
      return c.json(
        { error: 'No tienes autorización para registrar intervenciones en el sector de esta máquina' },
        403
      );
    }

    // 2. Obtener el ID del tipo de intervención CORRECTIVO
    const resTipo = await client.query(
      "SELECT id FROM tipos_intervencion WHERE codigo = 'CORRECTIVO' LIMIT 1"
    );
    if (resTipo.rows.length === 0) {
      await client.query('ROLLBACK');
      console.error('Error de configuración: no existe el tipo CORRECTIVO en tipos_intervencion');
      return c.json({ error: 'Error de configuración del sistema' }, 500);
    }
    const tipoCorrectivoId = resTipo.rows[0].id;

    // 3. Crear la intervención en estado PENDIENTE
    const resIntervencion = await client.query(
      `INSERT INTO intervenciones (
         maquina_id, tipo_intervencion_id, creado_por_usuario_id,
         descripcion, estado, observaciones, fecha_creacion, actualizado_en
       )
       VALUES ($1, $2, $3, $4, 'PENDIENTE', $5, NOW(), NOW())
       RETURNING id, maquina_id, estado, fecha_creacion, descripcion, observaciones`,
      [maquinaId, tipoCorrectivoId, userId, descripcion, observaciones]
    );
    const intervencion = resIntervencion.rows[0];

    // 4. Registrar en historial_estados_intervencion el estado inicial (NULL -> PENDIENTE)
    await client.query(
      `INSERT INTO historial_estados_intervencion (
         intervencion_id, estado_anterior, estado_nuevo, cambiado_por_usuario_id, observacion, cambiado_en
       )
       VALUES ($1, NULL, 'PENDIENTE', $2, 'Registro inicial de falla', NOW())`,
      [intervencion.id, userId]
    );

    let periodoDetencionId: number | null = null;

    // 5. Si la falla detuvo la máquina, actualizar estado y abrir período de inactividad
    if (detieneMaquina) {
      // 5.1 Abrir período en intervencion_periodos_detencion
      const resPeriodo = await client.query(
        `INSERT INTO intervencion_periodos_detencion (
           intervencion_id, maquina_id, desde, abierto_por_usuario_id, observacion
         )
         VALUES ($1, $2, NOW(), $3, 'Detención reportada al registrar la falla')
         RETURNING id`,
        [intervencion.id, maquinaId, userId]
      );
      periodoDetencionId = resPeriodo.rows[0].id;

      // 5.2 Si la máquina no estaba ya detenida o fuera de servicio, actualizarla a DETENIDA
      const estadoAnterior = maquina.estado;
      if (estadoAnterior !== 'DETENIDA' && estadoAnterior !== 'FUERA_DE_SERVICIO') {
        await client.query(
          'UPDATE maquinas SET estado = $1, actualizado_en = NOW() WHERE id = $2',
          ['DETENIDA', maquinaId]
        );

        // 5.3 Registrar trazabilidad en historial_estados_maquina
        await client.query(
          `INSERT INTO historial_estados_maquina (
             maquina_id, estado_anterior, estado_nuevo, intervencion_id, motivo, cambiado_por_usuario_id, cambiado_en
           )
           VALUES ($1, $2, 'DETENIDA', $3, 'Máquina detenida por reporte de falla', $4, NOW())`,
          [maquinaId, estadoAnterior, intervencion.id, userId]
        );
      }
    }

    await client.query('COMMIT');

    return c.json(
      {
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
          estado_actual: detieneMaquina ? 'DETENIDA' : maquina.estado,
          sector: {
            id: Number(maquina.sector_id),
            nombre: maquina.sector_nombre,
          },
        },
      },
      201
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al registrar intervención:', error);
    return c.json({ error: 'Error interno al registrar la intervención' }, 500);
  } finally {
    client.release();
  }
});

/**
 * GET /api/intervenciones
 * Lista intervenciones filtrando automáticamente según el alcance de visibilidad del usuario.
 * Soporta ?sin_asignar=true para la vista priorizada de fallas pendientes.
 */
intervencionesApp.get('/', requirePermission('INTERVENCIONES_VER'), async (c) => {
  const userId = (c.get as any)('userId') as number;
  const userScope = getUserScope(c, 'INTERVENCIONES_VER') || 'TODAS';
  const userSectores = ((c.get as any)('userSectores') as number[]) || [];
  const sinAsignar = c.req.query('sin_asignar') === 'true';

  try {
    const conditions: string[] = ['i.eliminado_en IS NULL'];
    const params: any[] = [];

    // 1. Aplicación estricta de alcance
    if (userScope === 'PROPIAS') {
      params.push(userId);
      conditions.push(`(i.creado_por_usuario_id = $${params.length} OR i.responsable_usuario_id = $${params.length})`);
    } else if (userScope === 'SECTORES') {
      if (userSectores.length === 0) {
        // Usuario sin sectores asignados no ve nada
        return c.json([]);
      }
      params.push(userSectores);
      conditions.push(`m.sector_id = ANY($${params.length})`);
    }
    // Si userScope === 'TODAS', no se agregan restricciones de alcance

    // 2. Filtro opcional: Vista "Sin asignar"
    if (sinAsignar) {
      conditions.push("i.responsable_usuario_id IS NULL AND i.estado = 'PENDIENTE'");
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

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
        (pd.id IS NOT NULL) AS detiene_maquina_actualmente
      FROM intervenciones i
      JOIN maquinas m ON i.maquina_id = m.id
      JOIN sectores s ON m.sector_id = s.id
      JOIN usuarios uc ON i.creado_por_usuario_id = uc.id
      LEFT JOIN usuarios ur ON i.responsable_usuario_id = ur.id
      LEFT JOIN intervencion_periodos_detencion pd 
        ON pd.intervencion_id = i.id AND pd.hasta IS NULL
      ${whereClause}
      ORDER BY 
        (pd.id IS NOT NULL) DESC,
        i.fecha_creacion DESC
    `;

    const { rows } = await pool.query(query, params);

    const result = rows.map((r) => ({
      id: Number(r.id),
      descripcion: r.descripcion,
      estado: r.estado,
      ejecucion: r.ejecucion,
      fecha_creacion: r.fecha_creacion,
      fecha_inicio: r.fecha_inicio,
      fecha_finalizacion: r.fecha_finalizacion,
      tiempo_inactividad_minutos: r.tiempo_inactividad_minutos,
      detiene_maquina_actualmente: r.detiene_maquina_actualmente,
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
    }));

    return c.json(result);
  } catch (error) {
    console.error('Error listando intervenciones:', error);
    return c.json({ error: 'Error interno del servidor al consultar intervenciones' }, 500);
  }
});

/**
 * GET /api/intervenciones/:id
 * Consulta el detalle completo de una intervención con verificación de alcance y auditoría de estados.
 */
intervencionesApp.get('/:id', requirePermission('INTERVENCIONES_VER'), async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID de intervención inválido');

  const userId = (c.get as any)('userId') as number;
  const userScope = getUserScope(c, 'INTERVENCIONES_VER') || 'TODAS';
  const userSectores = ((c.get as any)('userSectores') as number[]) || [];

  try {
    const resI = await pool.query(
      `SELECT 
         i.id, i.descripcion, i.estado, i.ejecucion, i.observaciones,
         i.fecha_creacion, i.fecha_inicio, i.fecha_finalizacion,
         i.tiempo_inactividad_minutos, i.costo_mano_obra, i.costo_repuestos, i.costo_total_estimado,
         i.eliminado_en,
         m.id AS maquina_id, m.nombre AS maquina_nombre, m.codigo AS maquina_codigo, m.estado AS maquina_estado,
         s.id AS sector_id, s.nombre AS sector_nombre,
         uc.id AS creador_id, uc.legajo AS creador_legajo, uc.nombre AS creador_nombre,
         ur.id AS responsable_id, ur.legajo AS responsable_legajo, ur.nombre AS responsable_nombre
       FROM intervenciones i
       JOIN maquinas m ON i.maquina_id = m.id
       JOIN sectores s ON m.sector_id = s.id
       JOIN usuarios uc ON i.creado_por_usuario_id = uc.id
       LEFT JOIN usuarios ur ON i.responsable_usuario_id = ur.id
       WHERE i.id = $1`,
      [id]
    );

    if (resI.rows.length === 0 || resI.rows[0].eliminado_en !== null) {
      return c.json({ error: 'Intervención no encontrada' }, 404);
    }

    const r = resI.rows[0];
    const creadorId = Number(r.creador_id);
    const responsableId = r.responsable_id ? Number(r.responsable_id) : null;

    // Verificación de alcance
    if (userScope === 'PROPIAS' && creadorId !== userId && responsableId !== userId) {
      return c.json({ error: 'No tienes permiso para consultar esta intervención' }, 403);
    }
    if (userScope === 'SECTORES' && !userSectores.includes(Number(r.sector_id))) {
      return c.json({ error: 'No tienes permiso para consultar intervenciones de este sector' }, 403);
    }

    // Historial de cambios de estado
    const resHistorial = await pool.query(
      `SELECT h.id, h.estado_anterior, h.estado_nuevo, h.observacion, h.cambiado_en,
              u.id AS usuario_id, u.legajo AS usuario_legajo, u.nombre AS usuario_nombre
       FROM historial_estados_intervencion h
       JOIN usuarios u ON h.cambiado_por_usuario_id = u.id
       WHERE h.intervencion_id = $1
       ORDER BY h.cambiado_en ASC`,
      [id]
    );

    // Períodos de detención asociados
    const resPeriodos = await pool.query(
      `SELECT pd.id, pd.desde, pd.hasta, pd.observacion,
              ua.id AS abierto_id, ua.nombre AS abierto_nombre,
              uc.id AS confirmado_id, uc.nombre AS confirmado_nombre
       FROM intervencion_periodos_detencion pd
       JOIN usuarios ua ON pd.abierto_por_usuario_id = ua.id
       LEFT JOIN usuarios uc ON pd.confirmado_por_usuario_id = uc.id
       WHERE pd.intervencion_id = $1
       ORDER BY pd.desde ASC`,
      [id]
    );

    return c.json({
      id: Number(r.id),
      descripcion: r.descripcion,
      estado: r.estado,
      ejecucion: r.ejecucion,
      observaciones: r.observaciones,
      fecha_creacion: r.fecha_creacion,
      fecha_inicio: r.fecha_inicio,
      fecha_finalizacion: r.fecha_finalizacion,
      tiempo_inactividad_minutos: r.tiempo_inactividad_minutos,
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
      historial_estados: resHistorial.rows.map((h) => ({
        id: Number(h.id),
        estado_anterior: h.estado_anterior,
        estado_nuevo: h.estado_nuevo,
        observacion: h.observacion,
        cambiado_en: h.cambiado_en,
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
        abierto_por: { id: Number(p.abierto_id), nombre: p.abierto_nombre },
        confirmado_por: p.confirmado_id ? { id: Number(p.confirmado_id), nombre: p.confirmado_nombre } : null,
      })),
    });
  } catch (error) {
    console.error('Error obteniendo detalle de intervención:', error);
    return c.json({ error: 'Error interno del servidor al consultar detalle' }, 500);
  }
});

export default intervencionesApp;
