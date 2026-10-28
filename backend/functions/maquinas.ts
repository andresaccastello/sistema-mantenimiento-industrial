import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission, getUserScope } from './middleware.ts';
import { parseId, parseString, badRequest } from './validations.ts';
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

    const query = `
      SELECT m.id, m.nombre, m.tipo, m.estado, m.ubicacion, m.observaciones, m.activo, m.creado_en,
             s.id as sector_id, s.nombre as sector_nombre
      FROM maquinas m
      JOIN sectores s ON m.sector_id = s.id
      ${activeFilter}
      ORDER BY m.nombre
    `;
    const { rows } = await pool.query(query);
    
    const result = rows.map(r => ({
      id: r.id,
      nombre: r.nombre,
      tipo: r.tipo,
      estado: r.estado,
      ubicacion: r.ubicacion,
      observaciones: r.observaciones,
      activo: r.activo,
      creado_en: r.creado_en,
      sector: { id: r.sector_id, nombre: r.sector_nombre }
    }));
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

    const { rows } = await pool.query(
      `SELECT m.id, m.nombre, m.tipo, m.estado, m.ubicacion, m.observaciones, m.activo, m.creado_en,
              s.id as sector_id, s.nombre as sector_nombre
       FROM maquinas m
       JOIN sectores s ON m.sector_id = s.id
       WHERE m.id = $1`,
      [id]
    );

    if (rows.length === 0) return c.json({ error: 'Máquina no encontrada', codigo: 'MAQUINA_NO_ENCONTRADA' }, 404);
    const r = rows[0];
    return c.json({
      id: r.id, nombre: r.nombre, tipo: r.tipo, estado: r.estado, 
      ubicacion: r.ubicacion, observaciones: r.observaciones, activo: r.activo, creado_en: r.creado_en,
      sector: { id: r.sector_id, nombre: r.sector_nombre }
    });
  } catch (error) {
    console.error('Error obteniendo máquina:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

// Helper para chequear si el sector es válido y activo
async function validateSector(sector_id: number): Promise<boolean> {
  const sRes = await pool.query('SELECT activo FROM sectores WHERE id = $1', [sector_id]);
  if (sRes.rows.length === 0 || !sRes.rows[0].activo) return false;
  return true;
}

maquinasApp.post('/', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const body = await c.req.json();
    const nombre = parseString(body.nombre);
    const sector_id = parseId(body.sector_id);
    const tipo = parseString(body.tipo);
    const estado = parseString(body.estado);
    const ubicacion = parseString(body.ubicacion);
    const observaciones = parseString(body.observaciones);
    const codigo = parseString(body.codigo);
    
    if (estado && estado !== 'OPERATIVA') {
      return c.json(
        {
          error: 'El estado inicial de una máquina es siempre OPERATIVA. El estado se gestiona desde las intervenciones o el cambio manual de estado.',
          codigo: 'ESTADO_NO_EDITABLE',
        },
        422
      );
    }
    
    if (!nombre || !sector_id) return badRequest(c, 'El nombre y el sector_id son requeridos y válidos');
    
    if (!(await validateSector(sector_id))) {
      return badRequest(c, 'El sector especificado no existe o está inactivo');
    }

    const { rows } = await pool.query(
      `INSERT INTO maquinas (nombre, sector_id, tipo, estado, ubicacion, observaciones, codigo) 
       VALUES ($1, $2, $3, 'OPERATIVA', $4, $5, $6) 
       RETURNING id, nombre, tipo, estado, ubicacion, observaciones, codigo, activo`,
      [nombre, sector_id, tipo, ubicacion, observaciones, codigo]
    );
    
    return c.json(rows[0], 201);
  } catch (error: any) {
    console.error('Error creando máquina:', error);
    if (error.code === '23514') return badRequest(c, 'Estado de máquina inválido');
    if (error.code === '23505') return badRequest(c, 'El código de máquina ya se encuentra registrado');
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

maquinasApp.put('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const body = await c.req.json();
    
    if (body.estado !== undefined) {
      return c.json(
        {
          error: 'El estado no es editable desde el ABM de máquinas. Se gestiona desde las intervenciones o el cambio manual de estado.',
          codigo: 'ESTADO_NO_EDITABLE',
        },
        422
      );
    }

    const nombre = parseString(body.nombre);
    const sector_id = body.sector_id ? parseId(body.sector_id) : null;
    const tipo = parseString(body.tipo);
    const ubicacion = parseString(body.ubicacion);
    const observaciones = parseString(body.observaciones);
    const codigo = body.codigo !== undefined ? parseString(body.codigo) : undefined;
    const activo = typeof body.activo === 'boolean' ? body.activo : null;
    
    if (body.sector_id && !sector_id) return badRequest(c, 'El sector_id provisto es inválido');
    
    if (sector_id && !(await validateSector(sector_id))) {
      return badRequest(c, 'El nuevo sector especificado no existe o está inactivo');
    }

    const { rows } = await pool.query(
      `UPDATE maquinas 
       SET nombre = COALESCE($1, nombre), 
           sector_id = COALESCE($2, sector_id), 
           tipo = COALESCE($3, tipo), 
           ubicacion = COALESCE($4, ubicacion), 
           observaciones = COALESCE($5, observaciones), 
           codigo = COALESCE($6, codigo),
           activo = COALESCE($7, activo),
           actualizado_en = NOW()
       WHERE id = $8 
       RETURNING id, nombre, tipo, estado, codigo, activo`,
      [nombre, sector_id, tipo, ubicacion, observaciones, codigo, activo, id]
    );

    if (rows.length === 0) return c.json({ error: 'Máquina no encontrada', codigo: 'MAQUINA_NO_ENCONTRADA' }, 404);
    return c.json(rows[0]);
  } catch (error: any) {
    console.error('Error actualizando máquina:', error);
    if (error.code === '23514') return badRequest(c, 'Estado de máquina inválido');
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

maquinasApp.delete('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');
    
    const { rows } = await pool.query(
      'UPDATE maquinas SET activo = FALSE, actualizado_en = NOW() WHERE id = $1 RETURNING id',
      [id]
    );

    if (rows.length === 0) return c.json({ error: 'Máquina no encontrada', codigo: 'MAQUINA_NO_ENCONTRADA' }, 404);
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
