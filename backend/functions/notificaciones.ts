import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify } from './middleware.ts';

const notificacionesApp = new Hono();

// Requiere solo autenticación: cada usuario ve únicamente las suyas
notificacionesApp.use('*', jwtVerify, dbVerify);

/**
 * GET /api/notificaciones/contador
 * Devuelve { no_leidas: n, no_leidas_alta: m }
 * Consulta liviana sobre el índice parcial idx_notificaciones_no_leidas.
 */
notificacionesApp.get('/contador', async (c) => {
  const userId = (c.get as any)('userId');

  try {
    const res = await pool.query(
      `SELECT 
         COUNT(*)::integer AS no_leidas,
         COUNT(*) FILTER (WHERE prioridad = 'ALTA')::integer AS no_leidas_alta
       FROM notificaciones
       WHERE usuario_id = $1 AND leida_en IS NULL`,
      [userId]
    );

    const row = res.rows[0];
    return c.json({
      no_leidas: Number(row.no_leidas),
      no_leidas_alta: Number(row.no_leidas_alta),
    });
  } catch (error: any) {
    console.error('Error al consultar contador de notificaciones:', error);
    return c.json(
      { error: 'Error al consultar contador de notificaciones', codigo: 'ERROR_INTERNO' },
      500
    );
  }
});

/**
 * POST /api/notificaciones/leer-todas
 * Marca todas las propias no leídas. Devuelve { marcadas: n }.
 */
notificacionesApp.post('/leer-todas', async (c) => {
  const userId = (c.get as any)('userId');

  try {
    const res = await pool.query(
      `WITH actualizadas AS (
         UPDATE notificaciones
         SET leida_en = NOW()
         WHERE usuario_id = $1 AND leida_en IS NULL
         RETURNING id
       )
       SELECT COUNT(*)::integer AS marcadas FROM actualizadas`,
      [userId]
    );

    return c.json({
      marcadas: Number(res.rows[0].marcadas),
    });
  } catch (error: any) {
    console.error('Error al marcar todas las notificaciones como leídas:', error);
    return c.json(
      { error: 'Error al marcar todas como leídas', codigo: 'ERROR_INTERNO' },
      500
    );
  }
});

/**
 * POST /api/notificaciones/:id/leer
 * Marca una notificación como leída (leida_en = NOW()).
 * Si ya estaba leída, 200 sin cambios.
 * De otro usuario o inexistente -> 404.
 */
notificacionesApp.post('/:id/leer', async (c) => {
  const userId = (c.get as any)('userId');
  const idRaw = c.req.param('id');
  const id = Number(idRaw);

  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      { error: 'Identificador de notificación inválido', codigo: 'DATOS_INVALIDOS' },
      422
    );
  }

  try {
    const res = await pool.query(
      `UPDATE notificaciones
       SET leida_en = COALESCE(leida_en, NOW())
       WHERE id = $1 AND usuario_id = $2
       RETURNING id, leida_en`,
      [id, userId]
    );

    if (res.rows.length === 0) {
      return c.json(
        { error: 'Notificación no encontrada', codigo: 'NOTIFICACION_NO_ENCONTRADA' },
        404
      );
    }

    const row = res.rows[0];
    return c.json({
      ok: true,
      id: Number(row.id),
      leida_en: row.leida_en instanceof Date ? row.leida_en.toISOString() : row.leida_en,
    });
  } catch (error: any) {
    console.error('Error al marcar notificación como leída:', error);
    return c.json(
      { error: 'Error al marcar como leída', codigo: 'ERROR_INTERNO' },
      500
    );
  }
});

/**
 * GET /api/notificaciones?solo_no_leidas=true&limite=50&antes_de=<id>
 * Lista las propias, más nuevas primero (creada_en DESC, id DESC).
 * limite de 1 a 100, por defecto 50.
 * antes_de = paginado: las de id menor.
 */
notificacionesApp.get('/', async (c) => {
  const userId = (c.get as any)('userId');
  const soloNoLeidasRaw = c.req.query('solo_no_leidas');
  const limiteRaw = c.req.query('limite');
  const antesDeRaw = c.req.query('antes_de');

  let soloNoLeidas = false;
  if (soloNoLeidasRaw !== undefined) {
    if (soloNoLeidasRaw === 'true') {
      soloNoLeidas = true;
    } else if (soloNoLeidasRaw === 'false') {
      soloNoLeidas = false;
    } else {
      return c.json(
        { error: 'Parámetro solo_no_leidas inválido', codigo: 'DATOS_INVALIDOS' },
        422
      );
    }
  }

  let limite = 50;
  if (limiteRaw !== undefined) {
    const lim = Number(limiteRaw);
    if (!Number.isInteger(lim) || lim < 1 || lim > 100) {
      return c.json(
        { error: 'Parámetro limite debe ser un entero entre 1 y 100', codigo: 'DATOS_INVALIDOS' },
        422
      );
    }
    limite = lim;
  }

  let antesDe: number | null = null;
  if (antesDeRaw !== undefined) {
    const ad = Number(antesDeRaw);
    if (!Number.isInteger(ad) || ad <= 0) {
      return c.json(
        { error: 'Parámetro antes_de debe ser un entero positivo', codigo: 'DATOS_INVALIDOS' },
        422
      );
    }
    antesDe = ad;
  }

  try {
    const params: any[] = [userId];
    let sql = `
      SELECT 
        id,
        tipo_evento,
        prioridad,
        titulo,
        mensaje,
        intervencion_id,
        maquina_id,
        creada_en,
        (leida_en IS NOT NULL) AS leida,
        leida_en
      FROM notificaciones
      WHERE usuario_id = $1
    `;

    if (soloNoLeidas) {
      sql += ' AND leida_en IS NULL';
    }

    if (antesDe !== null) {
      params.push(antesDe);
      sql += ` AND id < $${params.length}`;
    }

    params.push(limite);
    sql += ` ORDER BY id DESC LIMIT $${params.length}`;

    const res = await pool.query(sql, params);

    const notificaciones = res.rows.map((r: any) => ({
      id: Number(r.id),
      tipo_evento: r.tipo_evento,
      prioridad: r.prioridad,
      titulo: r.titulo,
      mensaje: r.mensaje,
      intervencion_id: r.intervencion_id != null ? Number(r.intervencion_id) : null,
      maquina_id: r.maquina_id != null ? Number(r.maquina_id) : null,
      creada_en: r.creada_en instanceof Date ? r.creada_en.toISOString() : r.creada_en,
      leida: Boolean(r.leida),
      leida_en: r.leida_en != null
        ? (r.leida_en instanceof Date ? r.leida_en.toISOString() : r.leida_en)
        : null,
    }));

    return c.json(notificaciones);
  } catch (error: any) {
    console.error('Error al listar notificaciones:', error);
    return c.json(
      { error: 'Error al listar notificaciones', codigo: 'ERROR_INTERNO' },
      500
    );
  }
});

export default notificacionesApp;
