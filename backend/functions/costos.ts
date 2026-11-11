import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission } from './middleware.ts';
import { responderError } from './intervenciones/errores.ts';

/**
 * Etapa C1, sección 4.6: datos auxiliares para cargar costos.
 */
const costosApp = new Hono();

costosApp.use('*', jwtVerify, dbVerify);

// GET /personas: los usuarios activos, para la mano de obra interna
costosApp.get('/personas', requirePermission('COSTOS_REGISTRAR'), async (c) => {
  try {
    const res = await pool.query(
      `SELECT id, nombre, apellido, legajo
       FROM usuarios
       WHERE activo = TRUE
       ORDER BY lower(apellido) ASC NULLS LAST, lower(nombre) ASC, id ASC`
    );
    return c.json(
      res.rows.map((r) => ({
        id: Number(r.id),
        nombre: r.nombre,
        apellido: r.apellido,
        legajo: r.legajo,
      })),
      200
    );
  } catch (err) {
    return responderError(c, err);
  }
});

export default costosApp;
