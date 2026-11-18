import { Hono } from 'hono';
import type { Context } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission } from './middleware.ts';

const configuracionApp = new Hono();

/** Tamaño máximo del logo: 300 KB, el mismo que controla la base (migración 012). */
const LOGO_MAXIMO = 300 * 1024;

/** La identidad como la devuelve GET /publica. */
async function identidadPublica() {
  const { rows } = await pool.query(
    'SELECT nombre_sistema, nombre_empresa, (logo IS NOT NULL) AS tiene_logo, actualizado_en FROM configuracion_sistema WHERE id = 1'
  );
  const row = rows[0];
  return {
    nombre_sistema: row.nombre_sistema,
    nombre_empresa: row.nombre_empresa || null,
    tiene_logo: Boolean(row.tiene_logo),
    actualizado_en: row.actualizado_en instanceof Date ? row.actualizado_en.toISOString() : String(row.actualizado_en),
  };
}

/**
 * D1, 3: el tipo del logo, por los primeros bytes del archivo (no por el nombre ni por el tipo
 * que declara). Solo PNG, JPEG o WEBP: sin SVG, a propósito, porque puede traer código.
 */
export function tipoDeImagen(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const empieza = (firma: number[], desde = 0) => firma.every((b, i) => bytes[desde + i] === b);
  if (empieza([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (empieza([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (empieza([0x52, 0x49, 0x46, 0x46]) && empieza([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/**
 * D1, 3: cada cambio de la identidad queda en el log. La configuración de avisos guarda quién la
 * cambió en cada fila (actualizado_por_usuario_id), pero configuracion_sistema no tiene esa
 * columna y la etapa no pide migrarla.
 */
function registrarCambio(c: Context, que: string) {
  const payload = (c.get as any)('jwtPayload') as { legajo?: string } | undefined;
  console.info(`[configuración] ${que}, por el usuario ${(c.get as any)('userId')} (${payload?.legajo ?? '?'})`);
}

const invalido = (c: Context, error: string) => c.json({ error, codigo: 'DATOS_INVALIDOS' }, 422);
const gestiona = [jwtVerify, dbVerify, requirePermission('CONFIGURACION_GESTIONAR')] as const;

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

/**
 * PUT /api/configuracion/identidad (D1, 3)
 * `{ nombre_sistema, nombre_empresa }`: el del sistema, de 3 a 80; el de la empresa, null o de 2 a 120.
 */
configuracionApp.put('/identidad', ...gestiona, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return invalido(c, 'El cuerpo de la solicitud debe ser un objeto JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalido(c, 'El cuerpo de la solicitud debe ser un objeto JSON');
  }
  const b = body as Record<string, unknown>;
  const desconocidos = Object.keys(b).filter((k) => k !== 'nombre_sistema' && k !== 'nombre_empresa');
  if (desconocidos.length > 0) return invalido(c, `Campo desconocido: ${desconocidos.join(', ')}`);

  const sistema = typeof b.nombre_sistema === 'string' ? b.nombre_sistema.trim() : null;
  if (sistema === null || sistema.length < 3 || sistema.length > 80) {
    return invalido(c, 'El nombre del sistema debe tener de 3 a 80 caracteres');
  }
  let empresa: string | null = null;
  if (b.nombre_empresa !== undefined && b.nombre_empresa !== null) {
    if (typeof b.nombre_empresa !== 'string') return invalido(c, 'El nombre de la empresa debe ser un texto o null');
    empresa = b.nombre_empresa.trim();
    if (empresa.length < 2 || empresa.length > 120) {
      return invalido(c, 'El nombre de la empresa debe tener de 2 a 120 caracteres');
    }
  }

  try {
    await pool.query(
      'UPDATE configuracion_sistema SET nombre_sistema = $1, nombre_empresa = $2, actualizado_en = NOW() WHERE id = 1',
      [sistema, empresa]
    );
    registrarCambio(c, `Identidad: nombre del sistema "${sistema}", empresa ${empresa === null ? 'sin nombre' : `"${empresa}"`}`);
    return c.json(await identidadPublica());
  } catch (error) {
    console.error('Error guardando la identidad:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

/**
 * PUT /api/configuracion/logo (D1, 3)
 * `multipart/form-data` con el campo `archivo`: PNG, JPEG o WEBP, hasta 300 KB.
 */
configuracionApp.put('/logo', ...gestiona, async (c) => {
  let archivo: unknown;
  try {
    archivo = (await c.req.parseBody())['archivo'];
  } catch {
    return invalido(c, 'Mandá el logo como multipart/form-data, en el campo archivo');
  }
  if (!(archivo instanceof File)) {
    return invalido(c, 'Mandá el logo como multipart/form-data, en el campo archivo');
  }
  if (archivo.size === 0) return invalido(c, 'El archivo está vacío');
  if (archivo.size > LOGO_MAXIMO) return invalido(c, 'El logo no puede pasar de 300 KB');

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const tipo = tipoDeImagen(bytes);
  if (!tipo) return invalido(c, 'El logo tiene que ser una imagen PNG, JPEG o WEBP');

  try {
    await pool.query(
      'UPDATE configuracion_sistema SET logo = $1, logo_tipo = $2, actualizado_en = NOW() WHERE id = 1',
      [Buffer.from(bytes), tipo]
    );
    registrarCambio(c, `Logo nuevo: ${tipo}, ${bytes.length} bytes`);
    return c.json(await identidadPublica());
  } catch (error) {
    console.error('Error guardando el logo:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

/** DELETE /api/configuracion/logo (D1, 3) */
configuracionApp.delete('/logo', ...gestiona, async (c) => {
  try {
    await pool.query('UPDATE configuracion_sistema SET logo = NULL, logo_tipo = NULL, actualizado_en = NOW() WHERE id = 1');
    registrarCambio(c, 'Logo quitado');
    return c.json(await identidadPublica());
  } catch (error) {
    console.error('Error quitando el logo:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

export default configuracionApp;
