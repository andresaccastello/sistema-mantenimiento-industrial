import { Hono } from 'hono';
import { pool } from '../db.ts';
import { jwtVerify, dbVerify, requirePermission } from '../middleware.ts';
import { estadoEmail, obtenerTransporteEmail, sanitizarError } from './transporteEmail.ts';
import { procesarEnvios } from './procesarEnvios.ts';
import { procesarVencimientos, ResultadoVencimientos } from '../preventivos/vencimientos.ts';
import { REGLAS_EVENTOS_NOTIFICACION } from '../intervenciones/notificaciones.ts';
import { parseEnteroTexto } from '../validations.ts';

export const avisosTriggerApp = new Hono();
export const configuracionAvisosApp = new Hono();

function escaparHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* =====================================================================
 * 5.1 POST /api/avisos/procesar
 * Disparador programado (Neon / Webhook)
 * ===================================================================== */
avisosTriggerApp.post('/procesar', async (c) => {
  const invocationId = c.req.header('x-neon-trigger-invocation-id');
  if (!invocationId || invocationId.trim().length === 0) {
    return c.json({ error: 'Permiso insuficiente', codigo: 'PERMISO_INSUFICIENTE' }, 403);
  }

  // PV5, 4: primero los vencimientos, una vez por día; si fallan, los envíos se procesan igual
  let vencimientos: ResultadoVencimientos | { error: string };
  try {
    vencimientos = await procesarVencimientos();
  } catch (err) {
    console.error('Error al procesar los vencimientos:', err);
    vencimientos = { error: 'No se pudieron procesar los vencimientos' };
  }

  const envios = await procesarEnvios();
  return c.json({ vencimientos, envios });
});

/* =====================================================================
 * 5.2 /api/configuracion/avisos
 * Todas las rutas requieren CONFIGURACION_GESTIONAR
 * ===================================================================== */
configuracionAvisosApp.use('*', jwtVerify, dbVerify, requirePermission('CONFIGURACION_GESTIONAR'));

/**
 * Arma la estructura completa de configuración de avisos (GET /)
 */
export async function obtenerConfiguracionAvisos(db = pool) {
  const estEmail = estadoEmail();

  // Canales en BD (EMAIL, WHATSAPP)
  const resCanales = await db.query(`
    SELECT 
      nc.canal, 
      nc.activo, 
      nc.actualizado_en,
      u.id AS act_u_id, 
      u.nombre AS act_u_nombre, 
      u.apellido AS act_u_apellido
    FROM notificacion_canales nc
    LEFT JOIN usuarios u ON u.id = nc.actualizado_por_usuario_id
    WHERE nc.canal IN ('EMAIL', 'WHATSAPP')
    ORDER BY CASE nc.canal WHEN 'EMAIL' THEN 1 WHEN 'WHATSAPP' THEN 2 ELSE 3 END
  `);

  const mapaCanales: Record<string, any> = {};
  for (const r of resCanales.rows) {
    mapaCanales[r.canal] = r;
  }

  const canalEmailRow = mapaCanales['EMAIL'] || { activo: false, actualizado_en: new Date().toISOString() };
  const canalWhatsAppRow = mapaCanales['WHATSAPP'] || { activo: false, actualizado_en: new Date().toISOString() };

  const canales = [
    {
      canal: 'EMAIL',
      activo: Boolean(canalEmailRow.activo),
      disponible: true,
      configurado: estEmail.configurado,
      transporte: estEmail.transporte,
      remitente: estEmail.remitente,
      actualizado_en: canalEmailRow.actualizado_en,
      actualizado_por: canalEmailRow.act_u_id
        ? {
            id: Number(canalEmailRow.act_u_id),
            nombre: canalEmailRow.act_u_nombre,
            apellido: canalEmailRow.act_u_apellido,
          }
        : null,
    },
    {
      canal: 'WHATSAPP',
      activo: Boolean(canalWhatsAppRow.activo),
      disponible: false,
      configurado: false,
      transporte: null,
      remitente: null,
      actualizado_en: canalWhatsAppRow.actualizado_en,
      actualizado_por: canalWhatsAppRow.act_u_id
        ? {
            id: Number(canalWhatsAppRow.act_u_id),
            nombre: canalWhatsAppRow.act_u_nombre,
            apellido: canalWhatsAppRow.act_u_apellido,
          }
        : null,
    },
  ];

  // Reglas (8 eventos en orden)
  const resReglas = await db.query('SELECT tipo_evento, canal, modo FROM notificacion_reglas');
  const mapaReglas: Record<string, Record<string, string>> = {};
  for (const r of resReglas.rows) {
    if (!mapaReglas[r.tipo_evento]) {
      mapaReglas[r.tipo_evento] = {};
    }
    mapaReglas[r.tipo_evento][r.canal] = r.modo;
  }

  const reglas = REGLAS_EVENTOS_NOTIFICACION.map((tipo) => ({
    tipo_evento: tipo,
    EMAIL: mapaReglas[tipo]?.['EMAIL'] || 'NUNCA',
    WHATSAPP: mapaReglas[tipo]?.['WHATSAPP'] || 'NUNCA',
  }));

  // Pendientes de EMAIL
  const resPendientes = await db.query(
    "SELECT COUNT(*)::int AS count FROM notificacion_envios WHERE canal = 'EMAIL' AND estado = 'PENDIENTE'"
  );
  const pendientes = Number(resPendientes.rows[0]?.count || 0);

  return {
    canales,
    reglas,
    pendientes,
  };
}

// GET /api/configuracion/avisos
configuracionAvisosApp.get('/', async (c) => {
  try {
    const data = await obtenerConfiguracionAvisos();
    return c.json(data);
  } catch (err) {
    console.error('Error al obtener configuracion de avisos:', err);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

// PUT /api/configuracion/avisos/canales/:canal
configuracionAvisosApp.put('/canales/:canal', async (c) => {
  const actorUserId = (c.get as any)('userId') as number;
  const canalParam = c.req.param('canal')?.toUpperCase();

  if (canalParam !== 'EMAIL' && canalParam !== 'WHATSAPP') {
    return c.json({ error: 'Canal no encontrado', codigo: 'CANAL_NO_ENCONTRADO' }, 404);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Cuerpo de solicitud inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  const { activo } = body || {};
  if (typeof activo !== 'boolean') {
    return c.json({ error: 'El campo activo debe ser booleano', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  if (canalParam === 'WHATSAPP') {
    return c.json({ error: 'WhatsApp todavía no está disponible.', codigo: 'CANAL_NO_DISPONIBLE' }, 409);
  }

  if (canalParam === 'EMAIL') {
    const est = estadoEmail();
    if (activo && !est.configurado) {
      return c.json({ error: 'Falta configurar el servidor de correo.', codigo: 'CANAL_SIN_CONFIGURAR' }, 409);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE notificacion_canales 
         SET activo = $1, actualizado_en = NOW(), actualizado_por_usuario_id = $2 
         WHERE canal = 'EMAIL'`,
        [activo, actorUserId]
      );

      // Si se apaga EMAIL, descartar envíos pendientes
      if (!activo) {
        await client.query(
          `UPDATE notificacion_envios 
           SET estado = 'DESCARTADO', ultimo_error = 'Canal desactivado' 
           WHERE canal = 'EMAIL' AND estado = 'PENDIENTE'`
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Error al actualizar canal EMAIL:', err);
      return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
    } finally {
      client.release();
    }
  }

  const actualizado = await obtenerConfiguracionAvisos();
  return c.json(actualizado, 200);
});

// PUT /api/configuracion/avisos/reglas
configuracionAvisosApp.put('/reglas', async (c) => {
  const actorUserId = (c.get as any)('userId') as number;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Cuerpo de solicitud inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  const { tipo_evento, canal, modo } = body || {};

  if (
    !tipo_evento ||
    !(REGLAS_EVENTOS_NOTIFICACION as readonly string[]).includes(tipo_evento) ||
    !canal ||
    (canal !== 'EMAIL' && canal !== 'WHATSAPP') ||
    !modo ||
    (modo !== 'NUNCA' && modo !== 'SOLO_ALTA' && modo !== 'SIEMPRE')
  ) {
    return c.json({ error: 'Datos de regla inválidos', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  try {
    await pool.query(
      `UPDATE notificacion_reglas 
       SET modo = $1, actualizado_en = NOW(), actualizado_por_usuario_id = $2 
       WHERE tipo_evento = $3 AND canal = $4`,
      [modo, actorUserId, tipo_evento, canal]
    );

    const actualizado = await obtenerConfiguracionAvisos();
    return c.json(actualizado, 200);
  } catch (err) {
    console.error('Error al actualizar regla:', err);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

// POST /api/configuracion/avisos/prueba
configuracionAvisosApp.post('/prueba', async (c) => {
  const actorUserId = (c.get as any)('userId') as number;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Cuerpo de solicitud inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  const { canal } = body || {};
  if (canal !== 'EMAIL') {
    return c.json({ error: 'Canal no disponible para prueba', codigo: 'CANAL_NO_DISPONIBLE' }, 409);
  }

  const resUser = await pool.query('SELECT email FROM usuarios WHERE id = $1', [actorUserId]);
  const userEmail = resUser.rows[0]?.email ? String(resUser.rows[0].email).trim() : '';

  if (!userEmail) {
    return c.json(
      { error: 'Cargá tu email en tu usuario para recibir la prueba.', codigo: 'SIN_EMAIL' },
      409
    );
  }

  const est = estadoEmail();
  if (!est.configurado) {
    return c.json(
      { error: 'Falta configurar el servidor de correo.', codigo: 'CANAL_SIN_CONFIGURAR' },
      409
    );
  }

  const transporte = obtenerTransporteEmail();
  if (!transporte) {
    return c.json(
      { error: 'Falta configurar el servidor de correo.', codigo: 'CANAL_SIN_CONFIGURAR' },
      409
    );
  }

  let nombreSistema = 'Sistema de Mantenimiento Industrial';
  try {
    const resCfg = await pool.query('SELECT nombre_sistema FROM configuracion_sistema WHERE id = 1');
    if (resCfg.rows.length > 0 && resCfg.rows[0].nombre_sistema) {
      nombreSistema = resCfg.rows[0].nombre_sistema;
    }
  } catch (err) {
    console.error('Error al consultar configuracion_sistema:', err);
  }

  const asunto = 'Prueba de avisos';
  const texto = `Si recibiste este email, los avisos por email de ${nombreSistema} funcionan.`;
  const html = `<p>Si recibiste este email, los avisos por email de ${escaparHtml(nombreSistema)} funcionan.</p>`;

  try {
    await transporte.enviar({
      para: userEmail,
      asunto,
      texto,
      html,
    });
    return c.json({ enviado_a: userEmail }, 200);
  } catch (err: any) {
    return c.json(
      {
        error: 'Falla al enviar el email de prueba',
        codigo: 'ENVIO_FALLIDO',
        detalle: sanitizarError(err),
      },
      502
    );
  }
});

// POST /api/configuracion/avisos/procesar
configuracionAvisosApp.post('/procesar', async (c) => {
  const resultado = await procesarEnvios();
  return c.json(resultado, 200);
});

// GET /api/configuracion/avisos/envios
configuracionAvisosApp.get('/envios', async (c) => {
  const limitParam = c.req.query('limit') ?? '20';
  const offsetParam = c.req.query('offset') ?? '0';
  const estadoParam = c.req.query('estado');

  const limitNum = parseEnteroTexto(limitParam, 1);
  const offsetNum = parseEnteroTexto(offsetParam, 0);

  if (limitNum === null || limitNum > 100) {
    return c.json({ error: 'Parámetro limit inválido (1 a 100)', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  if (offsetNum === null) {
    return c.json({ error: 'Parámetro offset inválido (>= 0)', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  const queryParams: any[] = [];
  const whereClauses: string[] = [];

  if (estadoParam !== undefined && estadoParam !== '') {
    if (!['PENDIENTE', 'ENVIADO', 'DESCARTADO', 'ERROR'].includes(estadoParam)) {
      return c.json({ error: 'Parámetro estado inválido', codigo: 'DATOS_INVALIDOS' }, 400);
    }
    queryParams.push(estadoParam);
    whereClauses.push(`e.estado = $${queryParams.length}`);
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  try {
    const resCount = await pool.query(
      `SELECT COUNT(*)::int AS total FROM notificacion_envios e ${whereStr}`,
      queryParams
    );
    const total = Number(resCount.rows[0]?.total || 0);

    queryParams.push(limitNum);
    const limitIdx = queryParams.length;
    queryParams.push(offsetNum);
    const offsetIdx = queryParams.length;

    const resItems = await pool.query(
      `SELECT 
         e.id, 
         e.canal, 
         e.estado, 
         e.intentos, 
         e.ultimo_error,
         e.destino, 
         e.creado_en, 
         e.enviado_en, 
         e.proximo_intento_en,
         n.id AS notif_id, 
         n.tipo_evento, 
         n.prioridad, 
         n.titulo, 
         n.intervencion_id,
         u.id AS usuario_id, 
         u.nombre AS usuario_nombre, 
         u.apellido AS usuario_apellido
       FROM notificacion_envios e
       JOIN notificaciones n ON n.id = e.notificacion_id
       JOIN usuarios u ON u.id = n.usuario_id
       ${whereStr}
       ORDER BY e.creado_en DESC, e.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      queryParams
    );

    const envios = resItems.rows.map((r) => ({
      id: Number(r.id),
      canal: r.canal,
      estado: r.estado,
      intentos: Number(r.intentos),
      ultimo_error: r.ultimo_error,
      destino: r.destino,
      creado_en: r.creado_en,
      enviado_en: r.enviado_en,
      proximo_intento_en: r.proximo_intento_en,
      notificacion: {
        id: Number(r.notif_id),
        tipo_evento: r.tipo_evento,
        prioridad: r.prioridad,
        titulo: r.titulo,
        intervencion_id: r.intervencion_id != null ? Number(r.intervencion_id) : null,
      },
      usuario: {
        id: Number(r.usuario_id),
        nombre: r.usuario_nombre,
        apellido: r.usuario_apellido,
      },
    }));

    return c.json({ total, envios });
  } catch (err) {
    console.error('Error al listar envios de avisos:', err);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

