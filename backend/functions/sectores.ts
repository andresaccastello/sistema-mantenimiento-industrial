import { Hono } from 'hono';
import { pool } from './db.ts';
import { authMiddleware, requirePermission } from './middleware.ts';
import { parseId, parseString, badRequest } from './validations.ts';

const sectoresApp = new Hono();

sectoresApp.use('*', authMiddleware);

sectoresApp.get('/', async (c) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, descripcion, activo, creado_en FROM sectores WHERE activo = TRUE ORDER BY nombre'
    );
    return c.json(rows);
  } catch (error) {
    console.error('Error obteniendo sectores:', error);
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

sectoresApp.get('/:id', async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const { rows } = await pool.query(
      'SELECT id, nombre, descripcion, activo, creado_en FROM sectores WHERE id = $1',
      [id]
    );
    if (rows.length === 0) {
      return c.json({ error: 'Sector no encontrado' }, 404);
    }
    return c.json(rows[0]);
  } catch (error) {
    console.error('Error obteniendo sector:', error);
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

sectoresApp.post('/', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const body = await c.req.json();
    const nombre = parseString(body.nombre);
    
    if (!nombre) return badRequest(c, 'El nombre del sector es requerido y no puede estar vacío');
    const descripcion = parseString(body.descripcion); // opcional

    const { rows } = await pool.query(
      'INSERT INTO sectores (nombre, descripcion) VALUES ($1, $2) RETURNING id, nombre, descripcion, activo',
      [nombre, descripcion]
    );
    
    return c.json(rows[0], 201);
  } catch (error: any) {
    console.error('Error creando sector:', error);
    if (error.code === '23505') {
      return badRequest(c, 'Ya existe un sector con ese nombre');
    }
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

sectoresApp.put('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const body = await c.req.json();
    const nombre = parseString(body.nombre);
    const descripcion = parseString(body.descripcion);
    const activo = typeof body.activo === 'boolean' ? body.activo : null;
    
    const { rows } = await pool.query(
      'UPDATE sectores SET nombre = COALESCE($1, nombre), descripcion = COALESCE($2, descripcion), activo = COALESCE($3, activo) WHERE id = $4 RETURNING id, nombre, descripcion, activo',
      [nombre, descripcion, activo, id]
    );

    if (rows.length === 0) {
      return c.json({ error: 'Sector no encontrado' }, 404);
    }
    
    return c.json(rows[0]);
  } catch (error: any) {
    console.error('Error actualizando sector:', error);
    if (error.code === '23505') {
      return badRequest(c, 'Ya existe otro sector con ese nombre');
    }
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

sectoresApp.delete('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');
    
    const { rows } = await pool.query(
      'UPDATE sectores SET activo = FALSE WHERE id = $1 RETURNING id',
      [id]
    );

    if (rows.length === 0) {
      return c.json({ error: 'Sector no encontrado' }, 404);
    }
    
    return c.json({ message: 'Sector desactivado correctamente' });
  } catch (error) {
    console.error('Error desactivando sector:', error);
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

export default sectoresApp;
