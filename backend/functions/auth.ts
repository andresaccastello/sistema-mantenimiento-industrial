import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import { pool } from './db.ts';
import { JWT_SECRET } from './config.ts';
import { jwtVerify, dbVerify } from './middleware.ts';
import { resolverPermisosEfectivos } from './intervenciones/permisos.ts';

const authApp = new Hono();

/**
 * POST /api/auth/login
 * Autenticación de usuario por legajo y contraseña.
 */
authApp.post('/login', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { legajo, password } = body;

    if (!legajo || !password) {
      return c.json({ error: 'Faltan credenciales', codigo: 'DATOS_INVALIDOS' }, 400);
    }

    // Buscar usuario por legajo y verificar estado propio y de su perfil
    const { rows } = await pool.query(
      `SELECT u.id, u.legajo, u.password_hash, u.nombre, u.apellido, u.activo AS usuario_activo,
              u.debe_cambiar_password, u.password_actualizado_en,
              p.id AS perfil_id, p.nombre AS perfil_nombre, p.activo AS perfil_activo
       FROM usuarios u
       JOIN perfiles p ON u.perfil_id = p.id
       WHERE u.legajo = $1`,
      [legajo]
    );

    const user = rows[0];
    if (!user || !user.password_hash || !user.usuario_activo || !user.perfil_activo) {
      return c.json({ error: 'Credenciales inválidas', codigo: 'CREDENCIALES_INVALIDAS' }, 401);
    }

    // Verificar contraseña con bcrypt
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return c.json({ error: 'Credenciales inválidas', codigo: 'CREDENCIALES_INVALIDAS' }, 401);
    }

    // Resolver permisos efectivos (perfil + excepciones individuales)
    const info = await resolverPermisosEfectivos(pool, user.id);

    // Generar JWT Token llevando solo sub, legajo, iat y exp (24h)
    const nowSec = Math.floor(Date.now() / 1000);
    const tokenIat = user.password_actualizado_en
      ? Math.max(nowSec, Math.floor(new Date(user.password_actualizado_en).getTime() / 1000))
      : nowSec;

    const payload = {
      sub: user.id.toString(),
      legajo: user.legajo,
      iat: tokenIat,
      exp: tokenIat + 60 * 60 * 24, // 24 horas
    };

    const token = await sign(payload, JWT_SECRET, 'HS256');

    // Actualizar ultimo_acceso_en
    await pool.query('UPDATE usuarios SET ultimo_acceso_en = NOW() WHERE id = $1', [user.id]);

    return c.json({
      token,
      user: {
        id: Number(user.id),
        legajo: user.legajo,
        nombre: user.nombre,
        apellido: user.apellido,
        perfil: user.perfil_nombre,
        permisos: info.permisos,
        sectores: info.sectores,
        debe_cambiar_password: info.debe_cambiar_password,
      },
      debe_cambiar_password: info.debe_cambiar_password,
    });

  } catch (error) {
    console.error('Error en login:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

/**
 * GET /api/auth/me
 * Retorna la información y permisos efectivos del usuario autenticado.
 */
authApp.get('/me', jwtVerify, dbVerify, async (c) => {
  const userId = (c.get as any)('userId');

  try {
    const res = await pool.query(
      `SELECT 
         u.id, 
         u.legajo, 
         u.nombre, 
         u.apellido, 
         u.debe_cambiar_password,
         json_build_object('id', p.id, 'nombre', p.nombre) AS perfil,
         (
           SELECT COALESCE(json_agg(json_build_object('id', s.id, 'nombre', s.nombre) ORDER BY s.nombre ASC), '[]'::json)
           FROM usuario_sector us
           JOIN sectores s ON us.sector_id = s.id
           WHERE us.usuario_id = u.id
         ) AS sectores
       FROM usuarios u
       JOIN perfiles p ON u.perfil_id = p.id
       WHERE u.id = $1`,
      [userId]
    );

    if (res.rows.length === 0) {
      return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
    }

    const row = res.rows[0];
    const info = await resolverPermisosEfectivos(pool, userId);

    return c.json({
      id: Number(row.id),
      legajo: row.legajo,
      nombre: row.nombre,
      apellido: row.apellido,
      perfil: row.perfil,
      sectores: row.sectores,
      permisos: info.permisos,
      debe_cambiar_password: info.debe_cambiar_password,
    });
  } catch (error) {
    console.error('Error en GET /auth/me:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

/**
 * POST /api/auth/cambiar-password
 * Permite al usuario autenticado cambiar su contraseña.
 * Body: { password_actual, password_nueva }
 */
authApp.post('/cambiar-password', jwtVerify, dbVerify, async (c) => {
  const userId = (c.get as any)('userId');
  const tokenPayload = (c.get as any)('jwtPayload') as { sub?: string; legajo?: string; iat?: number } | undefined;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Cuerpo de solicitud inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  const { password_actual, password_nueva } = body || {};

  if (!password_actual || !password_nueva) {
    return c.json({ error: 'Faltan credenciales para el cambio de contraseña', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  const client = await pool.connect();
  try {
    const resUser = await client.query(
      `SELECT id, legajo, password_hash, password_actualizado_en FROM usuarios WHERE id = $1`,
      [userId]
    );

    if (resUser.rows.length === 0) {
      return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
    }

    const user = resUser.rows[0];

    // 1. Validar password actual
    const validCurrent = await bcrypt.compare(password_actual, user.password_hash);
    if (!validCurrent) {
      return c.json({ error: 'La contraseña actual es incorrecta', codigo: 'CREDENCIALES_INVALIDAS' }, 401);
    }

    // 2. Política mínima de password nueva:
    // al menos 8 caracteres, distinta del legajo y distinta de la actual
    if (typeof password_nueva !== 'string' || password_nueva.length < 8) {
      return c.json({ error: 'La nueva contraseña debe tener al menos 8 caracteres', codigo: 'PASSWORD_INVALIDA' }, 422);
    }

    if (password_nueva.trim().toLowerCase() === user.legajo.trim().toLowerCase()) {
      return c.json({ error: 'La nueva contraseña no puede ser igual al legajo', codigo: 'PASSWORD_INVALIDA' }, 422);
    }

    const sameAsCurrent = await bcrypt.compare(password_nueva, user.password_hash);
    if (sameAsCurrent) {
      return c.json({ error: 'La nueva contraseña debe ser distinta de la actual', codigo: 'PASSWORD_INVALIDA' }, 422);
    }

    // 3. Generar nuevo hash
    const newHash = await bcrypt.hash(password_nueva, 10);

    // Iniciar transacción para actualizar contraseña y registrar auditoría
    await client.query('BEGIN');

    const oldTokenIat = tokenPayload?.iat ?? Math.floor(Date.now() / 1000);

    const updateRes = await client.query(
      `UPDATE usuarios
       SET password_hash = $1,
           debe_cambiar_password = FALSE,
           password_actualizado_en = GREATEST(NOW(), TO_TIMESTAMP($3 + 1)),
           actualizado_en = NOW()
       WHERE id = $2
       RETURNING password_actualizado_en`,
      [newHash, userId, oldTokenIat]
    );

    const updatedRow = updateRes.rows[0];

    await client.query(
      `INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
       VALUES ($1, $1, 'PASSWORD_CAMBIADA', $2)`,
      [userId, JSON.stringify({ motivo: 'Cambio de contraseña por el usuario' })]
    );

    await client.query('COMMIT');

    // 4. Responder con token nuevo
    const newIat = Math.floor(new Date(updatedRow.password_actualizado_en).getTime() / 1000);
    const newTokenPayload = {
      sub: user.id.toString(),
      legajo: user.legajo,
      iat: newIat,
      exp: newIat + 60 * 60 * 24, // 24h
    };

    const newToken = await sign(newTokenPayload, JWT_SECRET, 'HS256');

    return c.json({
      token: newToken,
      mensaje: 'Contraseña actualizada exitosamente',
      debe_cambiar_password: false,
    });

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error en POST /auth/cambiar-password:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  } finally {
    client.release();
  }
});

export default authApp;
