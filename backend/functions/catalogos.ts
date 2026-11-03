import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify } from './middleware.ts';
import { responderError } from './intervenciones/errores.ts';

export const criticidadesApp = new Hono();
criticidadesApp.use('*', jwtVerify, dbVerify);

/**
 * GET /api/criticidades
 * Retorna las criticidades activas ordenadas por orden ASC.
 */
criticidadesApp.get('/', async (c) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, codigo, nombre, orden, prioridad_alta, por_omision
       FROM criticidades
       WHERE activo = TRUE
       ORDER BY orden ASC`
    );
    const result = rows.map((r) => ({
      id: Number(r.id),
      codigo: r.codigo,
      nombre: r.nombre,
      orden: Number(r.orden),
      prioridad_alta: Boolean(r.prioridad_alta),
      por_omision: Boolean(r.por_omision),
    }));
    return c.json(result);
  } catch (error) {
    return responderError(c, error);
  }
});

export const tiposEquipoApp = new Hono();
tiposEquipoApp.use('*', jwtVerify, dbVerify);

/**
 * GET /api/tipos-equipo
 * Retorna los tipos de equipo activos ordenados por orden ASC.
 */
tiposEquipoApp.get('/', async (c) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, codigo, nombre, orden, por_omision
       FROM tipos_equipo
       WHERE activo = TRUE
       ORDER BY orden ASC`
    );
    const result = rows.map((r) => ({
      id: Number(r.id),
      codigo: r.codigo,
      nombre: r.nombre,
      orden: Number(r.orden),
      por_omision: Boolean(r.por_omision),
    }));
    return c.json(result);
  } catch (error) {
    return responderError(c, error);
  }
});

export const plantasApp = new Hono();
plantasApp.use('*', jwtVerify, dbVerify);

/**
 * GET /api/plantas
 * Retorna las plantas activas ordenadas por nombre ASC.
 */
plantasApp.get('/', async (c) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, descripcion
       FROM plantas
       WHERE activo = TRUE
       ORDER BY nombre ASC`
    );
    const result = rows.map((r) => ({
      id: Number(r.id),
      nombre: r.nombre,
      descripcion: r.descripcion ?? null,
    }));
    return c.json(result);
  } catch (error) {
    return responderError(c, error);
  }
});

