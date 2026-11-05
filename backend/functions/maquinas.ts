import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission, getUserScope } from './middleware.ts';
import { parseId, parseString, badRequest, leerCuerpoObjeto } from './validations.ts';
import { responderError, ErrorNegocio } from './intervenciones/errores.ts';
import { validarIntervaloReporte } from './intervalos.ts';
import { conTransaccion } from './intervenciones/transaccion.ts';
import { UsuarioVisibilidad } from './intervenciones/visibilidad.ts';
import {
  obtenerDetencionesAbiertasMaquina,
  confirmarRecuperacionMaquina,
  cambiarEstadoManualMaquina,
} from './intervenciones/detenciones.ts';

const maquinasApp = new Hono();
maquinasApp.use('*', jwtVerify, dbVerify);

function getUsuarioContext(c: any): UsuarioVisibilidad {
  return {
    id: (c.get as any)('userId') as number,
    permisos: ((c.get as any)('userPermissionsMap') as Record<string, any>) || {},
    sectores: ((c.get as any)('userSectores') as number[]) || [],
  };
}

/**
 * 3.1 y 3.2 Consulta base única y mapeo para lista, detalle, alta y edición de máquinas.
 */
function mapearFilaMaquina(r: any) {
  return {
    id: Number(r.id),
    codigo: r.codigo ?? null,
    nombre: r.nombre,
    modelo: r.modelo ?? null,
    estado: r.estado,
    estado_desde: r.estado_desde,
    ubicacion: r.ubicacion ?? null,
    observaciones: r.observaciones ?? null,
    activo: Boolean(r.activo),
    creado_en: r.creado_en,
    criticidad: {
      id: Number(r.criticidad_id),
      codigo: r.criticidad_codigo,
      nombre: r.criticidad_nombre,
      orden: Number(r.criticidad_orden),
      prioridad_alta: Boolean(r.criticidad_prioridad_alta),
    },
    tipo_equipo: {
      id: Number(r.tipo_equipo_id),
      codigo: r.tipo_equipo_codigo,
      nombre: r.tipo_equipo_nombre,
    },
    sector: {
      id: Number(r.sector_id),
      nombre: r.sector_nombre,
      planta:
        r.planta_id != null
          ? {
              id: Number(r.planta_id),
              nombre: r.planta_nombre,
            }
          : null,
    },
    intervenciones_abiertas: Number(r.intervenciones_abiertas || 0),
  };
}

async function consultarMaquinas(whereClause: string, params: any[] = []) {
  const query = `
    SELECT
      m.id,
      m.codigo,
      m.nombre,
      m.modelo,
      m.estado,
      COALESCE(
        (
          SELECT hm.cambiado_en
          FROM historial_estados_maquina hm
          WHERE hm.maquina_id = m.id
            AND hm.estado_nuevo = m.estado
            AND hm.estado_anterior IS DISTINCT FROM hm.estado_nuevo
          ORDER BY hm.cambiado_en DESC, hm.id DESC
          LIMIT 1
        ),
        m.creado_en
      ) AS estado_desde,
      m.ubicacion,
      m.observaciones,
      m.activo,
      m.creado_en,
      c.id AS criticidad_id,
      c.codigo AS criticidad_codigo,
      c.nombre AS criticidad_nombre,
      c.orden AS criticidad_orden,
      c.prioridad_alta AS criticidad_prioridad_alta,
      te.id AS tipo_equipo_id,
      te.codigo AS tipo_equipo_codigo,
      te.nombre AS tipo_equipo_nombre,
      s.id AS sector_id,
      s.nombre AS sector_nombre,
      p.id AS planta_id,
      p.nombre AS planta_nombre,
      COALESCE(ia.abiertas, 0)::int AS intervenciones_abiertas
    FROM maquinas m
    JOIN criticidades c ON m.criticidad_id = c.id
    JOIN tipos_equipo te ON m.tipo_equipo_id = te.id
    JOIN sectores s ON m.sector_id = s.id
    LEFT JOIN plantas p ON s.planta_id = p.id
    LEFT JOIN (
      SELECT maquina_id, COUNT(*) AS abiertas
      FROM intervenciones
      WHERE estado IN ('PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS')
        AND eliminado_en IS NULL
      GROUP BY maquina_id
    ) ia ON ia.maquina_id = m.id
    ${whereClause}
    ORDER BY m.nombre
  `;
  const { rows } = await pool.query(query, params);
  return rows.map(mapearFilaMaquina);
}

maquinasApp.get('/', async (c) => {
  try {
    const showAll = c.req.query('all') === 'true';

    if (showAll) {
      const permisos = (c.get as any)('userPermissions') as string[] | undefined;
      if (!permisos || !permisos.includes('MAQUINAS_GESTIONAR')) {
        return c.json({ error: 'No tienes permiso para ver máquinas desactivadas', codigo: 'PERMISO_INSUFICIENTE' }, 403);
      }
    }

    const activeFilter = showAll ? '' : 'WHERE m.activo = TRUE';
    const result = await consultarMaquinas(activeFilter);
    return c.json(result);
  } catch (error) {
    console.error('Error obteniendo máquinas:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

maquinasApp.get('/:id', async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const result = await consultarMaquinas('WHERE m.id = $1', [id]);
    if (result.length === 0) {
      return c.json({ error: 'Máquina no encontrada', codigo: 'MAQUINA_NO_ENCONTRADA' }, 404);
    }
    return c.json(result[0]);
  } catch (error) {
    console.error('Error obteniendo máquina:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

// Helpers para validar referencias activas
async function validateSector(sector_id: number): Promise<boolean> {
  const sRes = await pool.query('SELECT activo FROM sectores WHERE id = $1', [sector_id]);
  return sRes.rows.length > 0 && Boolean(sRes.rows[0].activo);
}

async function validateCriticidad(criticidad_id: number): Promise<boolean> {
  const cRes = await pool.query('SELECT activo FROM criticidades WHERE id = $1', [criticidad_id]);
  return cRes.rows.length > 0 && Boolean(cRes.rows[0].activo);
}

async function validateTipoEquipo(tipo_equipo_id: number): Promise<boolean> {
  const tRes = await pool.query('SELECT activo FROM tipos_equipo WHERE id = $1', [tipo_equipo_id]);
  return tRes.rows.length > 0 && Boolean(tRes.rows[0].activo);
}

/**
 * 3.5 Reglas para desactivar máquina (DELETE y PUT con activo: false)
 */
async function verificarPuedeDesactivarMaquina(maquinaId: number) {
  // 1. Intervenciones abiertas no eliminadas
  const resInt = await pool.query(
    `SELECT 1
     FROM intervenciones
     WHERE maquina_id = $1
       AND estado IN ('PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS')
       AND eliminado_en IS NULL
     LIMIT 1`,
    [maquinaId]
  );
  if (resInt.rows.length > 0) {
    return {
      ok: false,
      status: 409 as const,
      codigo: 'MAQUINA_CON_INTERVENCIONES_ABIERTAS',
      error: 'No se puede desactivar la máquina porque tiene intervenciones abiertas',
    };
  }

  // 2. Períodos de detención abiertos de intervenciones no eliminadas (aunque estén finalizadas)
  const resDet = await pool.query(
    `SELECT 1
     FROM intervencion_periodos_detencion pd
     JOIN intervenciones i ON i.id = pd.intervencion_id
     WHERE pd.maquina_id = $1
       AND pd.hasta IS NULL
       AND i.eliminado_en IS NULL
     LIMIT 1`,
    [maquinaId]
  );
  if (resDet.rows.length > 0) {
    return {
      ok: false,
      status: 409 as const,
      codigo: 'MAQUINA_CON_DETENCIONES_ABIERTAS',
      error: 'No se puede desactivar la máquina porque tiene períodos de detención abiertos',
    };
  }

  return { ok: true as const };
}

maquinasApp.post('/', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const parsedBody = await leerCuerpoObjeto(c);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    if ('tipo' in body) {
      return badRequest(c, 'El campo tipo se reemplazó por modelo (texto) y tipo_equipo_id (catálogo)');
    }

    const estado = parseString(body.estado);
    if (estado && estado !== 'OPERATIVA') {
      return c.json(
        {
          error: 'El estado inicial de una máquina es siempre OPERATIVA. El estado se gestiona desde las intervenciones o el cambio manual de estado.',
          codigo: 'ESTADO_NO_EDITABLE',
        },
        422
      );
    }

    const nombre = parseString(body.nombre);
    const sector_id = parseId(body.sector_id);
    if (!nombre || !sector_id) {
      return badRequest(c, 'El nombre y el sector_id son requeridos y válidos');
    }

    if (!(await validateSector(sector_id))) {
      return badRequest(c, 'El sector especificado no existe o está inactivo');
    }

    let criticidad_id: number | null = null;
    if (body.criticidad_id !== undefined && body.criticidad_id !== null) {
      criticidad_id = parseId(body.criticidad_id);
      if (!criticidad_id || !(await validateCriticidad(criticidad_id))) {
        return badRequest(c, 'La criticidad indicada no existe o está inactiva');
      }
    }

    let tipo_equipo_id: number | null = null;
    if (body.tipo_equipo_id !== undefined && body.tipo_equipo_id !== null) {
      tipo_equipo_id = parseId(body.tipo_equipo_id);
      if (!tipo_equipo_id || !(await validateTipoEquipo(tipo_equipo_id))) {
        return badRequest(c, 'El tipo de equipo indicado no existe o está inactivo');
      }
    }

    const codigo = parseString(body.codigo);
    const modelo = parseString(body.modelo);
    const ubicacion = parseString(body.ubicacion);
    const observaciones = parseString(body.observaciones);

    const cols = ['nombre', 'sector_id', 'estado', 'codigo', 'modelo', 'ubicacion', 'observaciones'];
    const vals: any[] = [nombre, sector_id, 'OPERATIVA', codigo, modelo, ubicacion, observaciones];

    if (criticidad_id !== null) {
      cols.push('criticidad_id');
      vals.push(criticidad_id);
    }
    if (tipo_equipo_id !== null) {
      cols.push('tipo_equipo_id');
      vals.push(tipo_equipo_id);
    }

    const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `INSERT INTO maquinas (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
      vals
    );

    const insertedId = Number(rows[0].id);
    const [creada] = await consultarMaquinas('WHERE m.id = $1', [insertedId]);
    return c.json(creada, 201);
  } catch (error: any) {
    console.error('Error creando máquina:', error);
    if (error.code === '23514') return badRequest(c, 'Estado de máquina inválido');
    if (error.code === '23505') {
      return c.json(
        { error: 'El código de máquina ya se encuentra registrado', codigo: 'CODIGO_MAQUINA_DUPLICADO' },
        409
      );
    }
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

maquinasApp.put('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const parsedBody = await leerCuerpoObjeto(c);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    if ('tipo' in body) {
      return badRequest(c, 'El campo tipo se reemplazó por modelo (texto) y tipo_equipo_id (catálogo)');
    }

    if ('estado' in body) {
      return c.json(
        {
          error: 'El estado no es editable desde el ABM de máquinas. Se gestiona desde las intervenciones o el cambio manual de estado.',
          codigo: 'ESTADO_NO_EDITABLE',
        },
        422
      );
    }

    // Verificar existencia de la máquina primero
    const resActual = await pool.query('SELECT id, sector_id, criticidad_id, tipo_equipo_id, activo FROM maquinas WHERE id = $1', [id]);
    if (resActual.rows.length === 0) {
      return c.json({ error: 'Máquina no encontrada', codigo: 'MAQUINA_NO_ENCONTRADA' }, 404);
    }
    const maqActual = resActual.rows[0];

    const sets: string[] = [];
    const params: any[] = [];

    if ('nombre' in body) {
      const nombre = parseString(body.nombre);
      if (!nombre) return badRequest(c, 'El nombre de la máquina es requerido');
      params.push(nombre);
      sets.push(`nombre = $${params.length}`);
    }

    let sectorEfectivoId = Number(maqActual.sector_id);
    if ('sector_id' in body) {
      const sector_id = parseId(body.sector_id);
      if (!sector_id) return badRequest(c, 'El sector_id provisto es inválido');
      if (!(await validateSector(sector_id))) {
        return badRequest(c, 'El nuevo sector especificado no existe o está inactivo');
      }
      sectorEfectivoId = sector_id;
      params.push(sector_id);
      sets.push(`sector_id = $${params.length}`);
    }

    let criticidadEfectivaId = Number(maqActual.criticidad_id);
    if ('criticidad_id' in body) {
      const criticidad_id = parseId(body.criticidad_id);
      if (!criticidad_id) return badRequest(c, 'La criticidad indicada es inválida');
      if (!(await validateCriticidad(criticidad_id))) {
        return badRequest(c, 'La criticidad indicada no existe o está inactiva');
      }
      criticidadEfectivaId = criticidad_id;
      params.push(criticidad_id);
      sets.push(`criticidad_id = $${params.length}`);
    }

    let tipoEquipoEfectivoId = Number(maqActual.tipo_equipo_id);
    if ('tipo_equipo_id' in body) {
      const tipo_equipo_id = parseId(body.tipo_equipo_id);
      if (!tipo_equipo_id) return badRequest(c, 'El tipo de equipo indicado es inválido');
      if (!(await validateTipoEquipo(tipo_equipo_id))) {
        return badRequest(c, 'El tipo de equipo indicado no existe o está inactivo');
      }
      tipoEquipoEfectivoId = tipo_equipo_id;
      params.push(tipo_equipo_id);
      sets.push(`tipo_equipo_id = $${params.length}`);
    }

    for (const campo of ['codigo', 'modelo', 'ubicacion', 'observaciones'] as const) {
      if (campo in body) {
        const raw = body[campo];
        let val: string | null = null;
        if (raw === null || raw === '') {
          val = null;
        } else if (typeof raw === 'string') {
          const trimmed = raw.trim();
          val = trimmed === '' ? null : trimmed;
        } else {
          return badRequest(c, `El campo ${campo} es inválido`);
        }
        params.push(val);
        sets.push(`${campo} = $${params.length}`);
      }
    }

    if ('activo' in body) {
      if (typeof body.activo !== 'boolean') {
        return badRequest(c, 'El campo activo debe ser booleano');
      }
      if (body.activo === false) {
        const checkDesact = await verificarPuedeDesactivarMaquina(id);
        if (!checkDesact.ok) {
          return c.json({ error: checkDesact.error, codigo: checkDesact.codigo }, checkDesact.status);
        }
      } else if (body.activo === true) {
        if (!('sector_id' in body) && !(await validateSector(sectorEfectivoId))) {
          return badRequest(c, 'El sector de la máquina está inactivo');
        }
        if (!('criticidad_id' in body) && !(await validateCriticidad(criticidadEfectivaId))) {
          return badRequest(c, 'La criticidad de la máquina está inactiva');
        }
        if (!('tipo_equipo_id' in body) && !(await validateTipoEquipo(tipoEquipoEfectivoId))) {
          return badRequest(c, 'El tipo de equipo de la máquina está inactivo');
        }
      }
      params.push(body.activo);
      sets.push(`activo = $${params.length}`);
    }

    sets.push('actualizado_en = NOW()');
    params.push(id);

    await pool.query(
      `UPDATE maquinas SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    );

    const [actualizada] = await consultarMaquinas('WHERE m.id = $1', [id]);
    return c.json(actualizada);
  } catch (error: any) {
    console.error('Error actualizando máquina:', error);
    if (error.code === '23514') return badRequest(c, 'Estado de máquina inválido');
    if (error.code === '23505') {
      return c.json(
        { error: 'El código de máquina ya se encuentra registrado', codigo: 'CODIGO_MAQUINA_DUPLICADO' },
        409
      );
    }
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

maquinasApp.delete('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const resActual = await pool.query('SELECT id FROM maquinas WHERE id = $1', [id]);
    if (resActual.rows.length === 0) {
      return c.json({ error: 'Máquina no encontrada', codigo: 'MAQUINA_NO_ENCONTRADA' }, 404);
    }

    const checkDesact = await verificarPuedeDesactivarMaquina(id);
    if (!checkDesact.ok) {
      return c.json({ error: checkDesact.error, codigo: checkDesact.codigo }, checkDesact.status);
    }

    await pool.query(
      'UPDATE maquinas SET activo = FALSE, actualizado_en = NOW() WHERE id = $1',
      [id]
    );

    return c.json({ message: 'Máquina desactivada correctamente' });
  } catch (error) {
    console.error('Error desactivando máquina:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

/**
 * 7.1 GET /api/maquinas/:id/detenciones-abiertas
 */
maquinasApp.get('/:id/detenciones-abiertas', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return badRequest(c, 'ID inválido');

  const usuario = getUsuarioContext(c);

  try {
    const res = await obtenerDetencionesAbiertasMaquina(pool, id, usuario);
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 7.2 POST /api/maquinas/:id/confirmar-recuperacion
 */
maquinasApp.post('/:id/confirmar-recuperacion', async (c) => {
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
      return confirmarRecuperacionMaquina(client, id, usuario, body);
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 7.3 POST /api/maquinas/:id/estado (cambio manual)
 */
maquinasApp.post('/:id/estado', async (c) => {
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
      return cambiarEstadoManualMaquina(client, id, usuario, body);
    });
    return c.json(res);
  } catch (error) {
    return responderError(c, error);
  }
});

/**
 * 5.1 GET /api/maquinas/:id/inactividad?desde=&hasta=
 * Inactividad real de una máquina en un intervalo de fechas.
 * Permiso: REPORTES_CONSULTAR.
 * Con alcance SECTORES: solo máquinas de sus sectores (404 si es de otro sector).
 */
maquinasApp.get('/:id/inactividad', requirePermission('REPORTES_CONSULTAR'), async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const usuario = getUsuarioContext(c);
    const scope = getUserScope(c, 'REPORTES_CONSULTAR');

    // 1. Obtener la máquina con su sector
    const { rows: maqRows } = await pool.query(
      `SELECT m.id, m.nombre, m.codigo, m.activo,
              s.id AS sector_id, s.nombre AS sector_nombre
       FROM maquinas m
       JOIN sectores s ON m.sector_id = s.id
       WHERE m.id = $1`,
      [id]
    );

    if (maqRows.length === 0) {
      return c.json({ error: 'Máquina no encontrada', codigo: 'MAQUINA_NO_ENCONTRADA' }, 404);
    }

    const m = maqRows[0];

    // Con alcance no TODAS (SECTORES o PROPIAS), si la máquina no pertenece a sus sectores -> 404 (no revelar que existe)
    if (scope !== 'TODAS' && !usuario.sectores.includes(Number(m.sector_id))) {
      return c.json({ error: 'Máquina no encontrada', codigo: 'MAQUINA_NO_ENCONTRADA' }, 404);
    }

    // 2. Validar fechas desde y hasta
    const { desde, hasta } = await validarIntervaloReporte(
      pool,
      c.req.query('desde'),
      c.req.query('hasta')
    );

    // 3. Ejecutar función de inactividad
    const { rows: inacRows } = await pool.query(
      `SELECT total_minutos, correctivo_minutos, preventivo_minutos, fuera_de_servicio_minutos
       FROM fn_inactividad_maquina($1, $2, $3)`,
      [m.id, desde, hasta]
    );

    const inac = inacRows[0] || {
      total_minutos: 0,
      correctivo_minutos: 0,
      preventivo_minutos: 0,
      fuera_de_servicio_minutos: 0,
    };

    // 4. Períodos que se superponen con el intervalo (sin recortar) de intervenciones no eliminadas
    const { rows: perRows } = await pool.query(
      `SELECT p.id, p.intervencion_id, ti.codigo AS tipo, p.desde, p.hasta,
              (p.hasta IS NULL) AS abierto
       FROM intervencion_periodos_detencion p
       JOIN intervenciones i ON i.id = p.intervencion_id
       JOIN tipos_intervencion ti ON ti.id = i.tipo_intervencion_id
       WHERE p.maquina_id = $1
         AND i.eliminado_en IS NULL
         AND tstzrange(p.desde, GREATEST(p.desde, COALESCE(p.hasta, NOW()))) && tstzrange($2::timestamptz, $3::timestamptz)
       ORDER BY p.desde ASC, p.id ASC`,
      [m.id, desde, hasta]
    );

    return c.json({
      maquina: {
        id: Number(m.id),
        nombre: m.nombre,
        codigo: m.codigo,
        sector: {
          id: Number(m.sector_id),
          nombre: m.sector_nombre,
        },
      },
      intervalo: {
        desde,
        hasta,
      },
      inactividad_minutos: Number(inac.total_minutos),
      por_tipo: {
        CORRECTIVO: Number(inac.correctivo_minutos),
        PREVENTIVO: Number(inac.preventivo_minutos),
      },
      fuera_de_servicio_descontado_minutos: Number(inac.fuera_de_servicio_minutos),
      periodos: perRows.map((p) => ({
        id: Number(p.id),
        intervencion_id: Number(p.intervencion_id),
        tipo: p.tipo,
        desde: p.desde,
        hasta: p.hasta,
        abierto: Boolean(p.abierto),
      })),
    });
  } catch (error) {
    return responderError(c, error);
  }
});

export default maquinasApp;
