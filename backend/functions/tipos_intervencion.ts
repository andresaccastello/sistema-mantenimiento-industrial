import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify } from './middleware.ts';
import { responderError } from './intervenciones/errores.ts';

const tiposIntervencionApp = new Hono();
tiposIntervencionApp.use('*', jwtVerify, dbVerify);

/**
 * GET /api/tipos-intervencion
 * Retorna el catálogo de tipos de intervención ordenados por código (API-04).
 */
tiposIntervencionApp.get('/', async (c) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, codigo, nombre FROM tipos_intervencion ORDER BY codigo ASC'
    );
    const result = rows.map((r) => ({
      id: Number(r.id),
      codigo: r.codigo,
      nombre: r.nombre,
    }));
    return c.json(result);
  } catch (error) {
    return responderError(c, error);
  }
});

export default tiposIntervencionApp;
