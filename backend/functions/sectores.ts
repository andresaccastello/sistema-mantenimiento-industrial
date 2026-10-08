import { Hono } from 'hono';
import { pool } from './db.ts';
import { authMiddleware, requirePermission } from './middleware.ts';

const sectoresApp = new Hono();

// Todos los endpoints de sectores requieren estar autenticados
sectoresApp.use('*', authMiddleware);

// Obtener todos los sectores activos
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

// Obtener un sector por ID
sectoresApp.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
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

// Crear un nuevo sector (Requiere permiso MAQUINAS_GESTIONAR)
sectoresApp.post('/', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const { nombre, descripcion } = await c.req.json();
    if (!nombre) {
      return c.json({ error: 'El nombre del sector es requerido' }, 400);
    }

    const { rows } = await pool.query(
      'INSERT INTO sectores (nombre, descripcion) VALUES ($1, $2) RETURNING id, nombre, descripcion, activo',
      [nombre, descripcion]
    );
    
    return c.json(rows[0], 201);
  } catch (error: any) {
    console.error('Error creando sector:', error);
    if (error.code === '23505') { // unique_violation
      return c.json({ error: 'Ya existe un sector con ese nombre' }, 400);
    }
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

// Actualizar un sector (Requiere permiso MAQUINAS_GESTIONAR)
sectoresApp.put('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = c.req.param('id');
    const { nombre, descripcion, activo } = await c.req.json();
    
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
      return c.json({ error: 'Ya existe otro sector con ese nombre' }, 400);
    }
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

// Desactivar un sector (Borrado lógico - Requiere permiso MAQUINAS_GESTIONAR)
sectoresApp.delete('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = c.req.param('id');
    
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
