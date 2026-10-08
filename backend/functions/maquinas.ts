import { Hono } from 'hono';
import { pool } from './db.ts';
import { authMiddleware, requirePermission } from './middleware.ts';
import { parseId, parseString, badRequest } from './validations.ts';

const maquinasApp = new Hono();
maquinasApp.use('*', authMiddleware);

maquinasApp.get('/', async (c) => {
  try {
    // Solo devolvemos máquinas activas por defecto, salvo que se especifique un query param ?all=true
    const showAll = c.req.query('all') === 'true';
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
    return c.json({ error: 'Error interno del servidor' }, 500);
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

    if (rows.length === 0) return c.json({ error: 'Máquina no encontrada' }, 404);
    const r = rows[0];
    return c.json({
      id: r.id, nombre: r.nombre, tipo: r.tipo, estado: r.estado, 
      ubicacion: r.ubicacion, observaciones: r.observaciones, activo: r.activo, creado_en: r.creado_en,
      sector: { id: r.sector_id, nombre: r.sector_nombre }
    });
  } catch (error) {
    console.error('Error obteniendo máquina:', error);
    return c.json({ error: 'Error interno del servidor' }, 500);
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
    const estado = parseString(body.estado) || 'OPERATIVA';
    const ubicacion = parseString(body.ubicacion);
    const observaciones = parseString(body.observaciones);
    
    if (!nombre || !sector_id) return badRequest(c, 'El nombre y el sector_id son requeridos y válidos');
    
    if (!(await validateSector(sector_id))) {
      return badRequest(c, 'El sector especificado no existe o está inactivo');
    }

    const { rows } = await pool.query(
      `INSERT INTO maquinas (nombre, sector_id, tipo, estado, ubicacion, observaciones) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, nombre, tipo, estado, ubicacion, observaciones, activo`,
      [nombre, sector_id, tipo, estado, ubicacion, observaciones]
    );
    
    return c.json(rows[0], 201);
  } catch (error: any) {
    console.error('Error creando máquina:', error);
    if (error.code === '23514') return badRequest(c, 'Estado de máquina inválido');
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

maquinasApp.put('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const body = await c.req.json();
    const nombre = parseString(body.nombre);
    const sector_id = body.sector_id ? parseId(body.sector_id) : null;
    const tipo = parseString(body.tipo);
    const estado = parseString(body.estado);
    const ubicacion = parseString(body.ubicacion);
    const observaciones = parseString(body.observaciones);
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
           estado = COALESCE($4, estado), 
           ubicacion = COALESCE($5, ubicacion), 
           observaciones = COALESCE($6, observaciones), 
           activo = COALESCE($7, activo),
           actualizado_en = NOW()
       WHERE id = $8 
       RETURNING id, nombre, tipo, estado`,
      [nombre, sector_id, tipo, estado, ubicacion, observaciones, activo, id]
    );

    if (rows.length === 0) return c.json({ error: 'Máquina no encontrada' }, 404);
    return c.json(rows[0]);
  } catch (error: any) {
    console.error('Error actualizando máquina:', error);
    if (error.code === '23514') return badRequest(c, 'Estado de máquina inválido');
    return c.json({ error: 'Error interno del servidor' }, 500);
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

    if (rows.length === 0) return c.json({ error: 'Máquina no encontrada' }, 404);
    return c.json({ message: 'Máquina desactivada correctamente' });
  } catch (error) {
    console.error('Error desactivando máquina:', error);
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

export default maquinasApp;
