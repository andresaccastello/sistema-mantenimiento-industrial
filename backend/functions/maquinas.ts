import { Hono } from 'hono';
import { pool } from './db.ts';
import { authMiddleware, requirePermission } from './middleware.ts';

const maquinasApp = new Hono();

// Todos los endpoints de máquinas requieren estar autenticados
maquinasApp.use('*', authMiddleware);

// Obtener todas las máquinas (con información de su sector)
maquinasApp.get('/', async (c) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.nombre, m.tipo, m.estado, m.ubicacion, m.observaciones, m.activo, m.creado_en,
              s.id as sector_id, s.nombre as sector_nombre
       FROM maquinas m
       JOIN sectores s ON m.sector_id = s.id
       ORDER BY m.nombre`
    );
    
    // Formatear la salida para anidar el sector
    const result = rows.map(r => ({
      id: r.id,
      nombre: r.nombre,
      tipo: r.tipo,
      estado: r.estado,
      ubicacion: r.ubicacion,
      observaciones: r.observaciones,
      activo: r.activo,
      creado_en: r.creado_en,
      sector: {
        id: r.sector_id,
        nombre: r.sector_nombre
      }
    }));

    return c.json(result);
  } catch (error) {
    console.error('Error obteniendo máquinas:', error);
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

// Obtener una máquina por ID
maquinasApp.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const { rows } = await pool.query(
      `SELECT m.id, m.nombre, m.tipo, m.estado, m.ubicacion, m.observaciones, m.activo, m.creado_en,
              s.id as sector_id, s.nombre as sector_nombre
       FROM maquinas m
       JOIN sectores s ON m.sector_id = s.id
       WHERE m.id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return c.json({ error: 'Máquina no encontrada' }, 404);
    }
    
    const r = rows[0];
    return c.json({
      id: r.id,
      nombre: r.nombre,
      tipo: r.tipo,
      estado: r.estado,
      ubicacion: r.ubicacion,
      observaciones: r.observaciones,
      activo: r.activo,
      creado_en: r.creado_en,
      sector: {
        id: r.sector_id,
        nombre: r.sector_nombre
      }
    });
  } catch (error) {
    console.error('Error obteniendo máquina:', error);
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

// Crear una nueva máquina (Requiere permiso MAQUINAS_GESTIONAR)
maquinasApp.post('/', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const { nombre, sector_id, tipo, estado, ubicacion, observaciones } = await c.req.json();
    
    if (!nombre || !sector_id) {
      return c.json({ error: 'El nombre y el sector_id son requeridos' }, 400);
    }

    const { rows } = await pool.query(
      `INSERT INTO maquinas (nombre, sector_id, tipo, estado, ubicacion, observaciones) 
       VALUES ($1, $2, $3, COALESCE($4, 'OPERATIVA'), $5, $6) 
       RETURNING id, nombre, tipo, estado, ubicacion, observaciones, activo`,
      [nombre, sector_id, tipo, estado, ubicacion, observaciones]
    );
    
    return c.json(rows[0], 201);
  } catch (error: any) {
    console.error('Error creando máquina:', error);
    if (error.code === '23503') { // foreign_key_violation
      return c.json({ error: 'El sector especificado no existe' }, 400);
    }
    if (error.code === '23514') { // check_violation (ej. para estado inválido)
      return c.json({ error: 'Estado de máquina inválido' }, 400);
    }
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

// Actualizar una máquina (Requiere permiso MAQUINAS_GESTIONAR)
maquinasApp.put('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = c.req.param('id');
    const { nombre, sector_id, tipo, estado, ubicacion, observaciones, activo } = await c.req.json();
    
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

    if (rows.length === 0) {
      return c.json({ error: 'Máquina no encontrada' }, 404);
    }
    
    return c.json(rows[0]);
  } catch (error: any) {
    console.error('Error actualizando máquina:', error);
    if (error.code === '23503') { 
      return c.json({ error: 'El sector especificado no existe' }, 400);
    }
    if (error.code === '23514') {
      return c.json({ error: 'Estado de máquina inválido' }, 400);
    }
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

// Desactivar una máquina (Borrado lógico - Requiere permiso MAQUINAS_GESTIONAR)
maquinasApp.delete('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = c.req.param('id');
    
    const { rows } = await pool.query(
      'UPDATE maquinas SET activo = FALSE, actualizado_en = NOW() WHERE id = $1 RETURNING id',
      [id]
    );

    if (rows.length === 0) {
      return c.json({ error: 'Máquina no encontrada' }, 404);
    }
    
    return c.json({ message: 'Máquina desactivada correctamente' });
  } catch (error) {
    console.error('Error desactivando máquina:', error);
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

export default maquinasApp;
