import { Hono } from 'hono';
import { pool } from './db.ts';

const configuracionApp = new Hono();

/**
 * GET /api/configuracion/publica
 * Retorna datos públicos de la marca para pantallas previas al login o cabeceras
 */
configuracionApp.get('/publica', async (c) => {
  try {
    const { rows } = await pool.query(
      'SELECT nombre_sistema, nombre_empresa, (logo IS NOT NULL) AS tiene_logo, actualizado_en FROM configuracion_sistema WHERE id = 1'
    );

    if (rows.length === 0) {
      return c.json({
        nombre_sistema: 'Sistema de Mantenimiento Industrial',
        nombre_empresa: null,
        tiene_logo: false,
        actualizado_en: new Date().toISOString(),
      });
    }

    const row = rows[0];
    return c.json({
      nombre_sistema: row.nombre_sistema,
      nombre_empresa: row.nombre_empresa || null,
      tiene_logo: Boolean(row.tiene_logo),
      actualizado_en: row.actualizado_en instanceof Date ? row.actualizado_en.toISOString() : String(row.actualizado_en),
    });
  } catch (error) {
    console.error('Error obteniendo configuración pública:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

/**
 * GET /api/configuracion/logo
 * Retorna los bytes del logo con sus headers correspondientes
 */
configuracionApp.get('/logo', async (c) => {
  try {
    const { rows } = await pool.query(
      'SELECT logo, logo_tipo FROM configuracion_sistema WHERE id = 1'
    );

    if (rows.length === 0 || !rows[0].logo || !rows[0].logo_tipo) {
      return c.json({ error: 'Logo no configurado', codigo: 'LOGO_NO_CONFIGURADO' }, 404);
    }

    const { logo, logo_tipo } = rows[0];

    c.header('Content-Type', logo_tipo);
    c.header('Cache-Control', 'public, max-age=3600');
    c.header('X-Content-Type-Options', 'nosniff');

    return c.body(logo);
  } catch (error) {
    console.error('Error obteniendo logo:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

export default configuracionApp;
