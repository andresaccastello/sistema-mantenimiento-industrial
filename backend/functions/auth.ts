import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import { pool } from './db.ts';
import { JWT_SECRET } from './config.ts';
import { jwtVerify, dbVerify } from './middleware.ts';
import { resolverPermisosEfectivos } from './intervenciones/permisos.ts';
import { ErrorNegocio, responderError } from './intervenciones/errores.ts';

const authApp = new Hono();

/** PUB1, 1 (D-037): 5 fallos seguidos de un legajo en 15 minutos bloquean el ingreso. */
export const MAXIMO_FALLOS_INGRESO = 5;
export const VENTANA_FALLOS_MINUTOS = 15;
/** En cada ingreso exitoso se borran los intentos más viejos que esto, de todos los legajos. */
export const DIAS_INTENTOS_GUARDADOS = 7;

interface UsuarioIngreso {
  id: string | number;
  legajo: string;
  nombre: string;
  apellido: string | null;
  sesion_version: string | number | null;
  perfil_nombre: string;
}

/**
 * PUB1, 1: cuenta los fallos recientes del legajo, compara la contraseña y registra el intento,
 * todo en una transacción y con el legajo bloqueado (advisory lock), así cinco pedidos a la vez
 * no se saltean el límite. Devuelve el usuario si entró, o null si las credenciales no sirven.
 * Con 5 o más fallos, 429 sin mirar la contraseña; exista o no el legajo, la respuesta es la misma.
 */
async function verificarIngreso(legajo: unknown, password: unknown): Promise<UsuarioIngreso | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // upper(trim()) y a lo sumo 50 caracteres, como la columna
    const { rows: norm } = await client.query<{ legajo: string }>(
      'SELECT trim(left(upper(trim($1::text)), 50)) AS legajo',
      [legajo]
    );
    const legajoIntento = norm[0].legajo;
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('ingreso:' || $1))`, [legajoIntento]);

    // Los fallos de los últimos 15 minutos que vinieron después del último ingreso exitoso
    const { rows: cuenta } = await client.query<{ fallos: number }>(
      `SELECT count(*)::int AS fallos
       FROM intentos_ingreso
       WHERE legajo = $1
         AND NOT exitoso
         AND creado_en > NOW() - make_interval(mins => $2)
         AND id > COALESCE((SELECT max(id) FROM intentos_ingreso WHERE legajo = $1 AND exitoso), 0)`,
      [legajoIntento, VENTANA_FALLOS_MINUTOS]
    );
    if (cuenta[0].fallos >= MAXIMO_FALLOS_INGRESO) {
      throw new ErrorNegocio(429, 'DEMASIADOS_INTENTOS', 'Demasiados intentos. Probá de nuevo en unos minutos');
    }

    // Buscar usuario por legajo y verificar estado propio y de su perfil
    const { rows } = await client.query(
      `SELECT u.id, u.legajo, u.password_hash, u.nombre, u.apellido, u.activo AS usuario_activo, u.es_sistema,
              u.debe_cambiar_password, u.password_actualizado_en, u.sesion_version,
              p.id AS perfil_id, p.nombre AS perfil_nombre, p.activo AS perfil_activo
       FROM usuarios u
       JOIN perfiles p ON u.perfil_id = p.id
       WHERE u.legajo = $1`,
      [legajo]
    );

    const user = rows[0];
    // PV5, 2.1: el usuario del sistema no inicia sesión, aunque esté activo o tenga contraseña
    const habilitado = user && user.password_hash && user.usuario_activo && user.perfil_activo && !user.es_sistema;
    // Verificar contraseña con bcrypt
    const exitoso = habilitado ? await bcrypt.compare(password as string, user.password_hash) : false;

    await client.query('INSERT INTO intentos_ingreso (legajo, exitoso) VALUES ($1, $2)', [legajoIntento, exitoso]);
    if (exitoso) {
      await client.query('DELETE FROM intentos_ingreso WHERE creado_en < NOW() - make_interval(days => $1)', [
        DIAS_INTENTOS_GUARDADOS,
      ]);
    }
    await client.query('COMMIT');
    return exitoso ? user : null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

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

    const user = await verificarIngreso(legajo, password);
    if (!user) {
      return c.json({ error: 'Credenciales inválidas', codigo: 'CREDENCIALES_INVALIDAS' }, 401);
    }

    // Resolver permisos efectivos (perfil + excepciones individuales)
    const info = await resolverPermisosEfectivos(pool, Number(user.id));

    // Generar JWT Token llevando solo sub, legajo, sv, iat y exp (24h)
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      sub: user.id.toString(),
      legajo: user.legajo,
      sv: Number(user.sesion_version ?? 1),
      iat: nowSec,
      exp: nowSec + 60 * 60 * 24, // 24 horas
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
    if (error instanceof ErrorNegocio) return responderError(c, error);
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
         u.email,
         u.telefono_whatsapp,
         u.debe_cambiar_password,
         u.modo_simple_celular,
         u.tema,
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
      email: row.email,
      telefono_whatsapp: row.telefono_whatsapp,
      perfil: row.perfil,
      sectores: row.sectores,
      permisos: info.permisos,
      debe_cambiar_password: info.debe_cambiar_password,
      // D1, 2.2
      preferencias: { modo_simple_celular: row.modo_simple_celular, tema: row.tema },
    });
  } catch (error) {
    console.error('Error en GET /auth/me:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

const TEMAS = ['CLARO', 'OSCURO', 'SISTEMA'] as const;

/**
 * PATCH /api/auth/preferencias (D1, 2.2)
 * Cada usuario cambia solo las suyas: `modo_simple_celular` y/o `tema`. Sin auditoría: es una
 * preferencia de pantalla, no un dato del negocio.
 */
authApp.patch('/preferencias', jwtVerify, dbVerify, async (c) => {
  const userId = (c.get as any)('userId');
  const invalido = (error: string) => c.json({ error, codigo: 'DATOS_INVALIDOS' }, 422);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return invalido('El cuerpo de la solicitud debe ser un objeto JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalido('El cuerpo de la solicitud debe ser un objeto JSON');
  }
  const b = body as Record<string, unknown>;
  const desconocidos = Object.keys(b).filter((k) => k !== 'modo_simple_celular' && k !== 'tema');
  if (desconocidos.length > 0) return invalido(`Campo desconocido: ${desconocidos.join(', ')}`);
  if (!('modo_simple_celular' in b) && !('tema' in b)) {
    return invalido('Indicá modo_simple_celular o tema');
  }
  if ('modo_simple_celular' in b && typeof b.modo_simple_celular !== 'boolean') {
    return invalido('El campo modo_simple_celular debe ser true o false');
  }
  if ('tema' in b && !(TEMAS as readonly unknown[]).includes(b.tema)) {
    return invalido('El campo tema debe ser CLARO, OSCURO o SISTEMA');
  }

  try {
    const res = await pool.query(
      `UPDATE usuarios
       SET modo_simple_celular = COALESCE($2, modo_simple_celular),
           tema = COALESCE($3, tema)
       WHERE id = $1
       RETURNING modo_simple_celular, tema`,
      [userId, 'modo_simple_celular' in b ? b.modo_simple_celular : null, 'tema' in b ? b.tema : null]
    );
    if (res.rows.length === 0) {
      return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
    }
    return c.json({ modo_simple_celular: res.rows[0].modo_simple_celular, tema: res.rows[0].tema });
  } catch (error) {
    console.error('Error en PATCH /auth/preferencias:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

/**
 * PATCH /api/auth/email
 * Cada usuario carga su propio email: `{ "email": string | null }`. Misma validación y
 * normalización que el alta y la edición de usuarios (recorta, pasa a minúsculas, vacío = null) y
 * la misma auditoría (USUARIO_MODIFICADO). No toca ningún otro dato del usuario.
 */
authApp.patch('/email', jwtVerify, dbVerify, async (c) => {
  const userId = Number((c.get as any)('userId'));
  const invalido = (error: string) => c.json({ error, codigo: 'DATOS_INVALIDOS' }, 422);
  const emailInvalido = () => c.json({ error: 'El email no tiene un formato válido.', codigo: 'EMAIL_INVALIDO' }, 422);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return invalido('El cuerpo de la solicitud debe ser un objeto JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalido('El cuerpo de la solicitud debe ser un objeto JSON');
  }
  const b = body as Record<string, unknown>;
  const desconocidos = Object.keys(b).filter((k) => k !== 'email');
  if (desconocidos.length > 0) return invalido(`Campo desconocido: ${desconocidos.join(', ')}`);
  if (!('email' in b)) return invalido('Indicá el email');

  let emailNorm: string | null = null;
  if (b.email !== null) {
    if (typeof b.email !== 'string') return emailInvalido();
    const trimmed = b.email.trim();
    if (trimmed.length > 0) {
      if (trimmed.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return emailInvalido();
      emailNorm = trimmed.toLowerCase();
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      'SELECT nombre, apellido, email, telefono_whatsapp FROM usuarios WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (res.rows.length === 0) {
      await client.query('ROLLBACK');
      return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
    }
    const actual = res.rows[0];
    if (emailNorm === actual.email) {
      await client.query('ROLLBACK');
      return c.json({ error: 'No se detectaron cambios en los datos del usuario', codigo: 'SIN_CAMBIOS' }, 422);
    }

    await client.query('UPDATE usuarios SET email = $1, actualizado_en = NOW() WHERE id = $2', [emailNorm, userId]);
    await client.query(
      `INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
       VALUES ($1, $1, 'USUARIO_MODIFICADO', $2)`,
      [
        userId,
        JSON.stringify({
          anterior: {
            nombre: actual.nombre,
            apellido: actual.apellido,
            email: actual.email,
            telefono_whatsapp: actual.telefono_whatsapp,
          },
          nuevo: {
            nombre: actual.nombre,
            apellido: actual.apellido,
            email: emailNorm,
            telefono_whatsapp: actual.telefono_whatsapp,
          },
        }),
      ]
    );
    await client.query('COMMIT');
    return c.json({ email: emailNorm });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '40P01') {
      return c.json({ error: 'Recurso ocupado por otra operación concurrente', codigo: 'RECURSO_OCUPADO' }, 409);
    }
    console.error('Error en PATCH /auth/email:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  } finally {
    client.release();
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

    const updateRes = await client.query(
      `UPDATE usuarios
       SET password_hash = $1,
           debe_cambiar_password = FALSE,
           password_actualizado_en = NOW(),
           sesion_version = sesion_version + 1,
           actualizado_en = NOW()
       WHERE id = $2
       RETURNING sesion_version`,
      [newHash, userId]
    );

    const updatedRow = updateRes.rows[0];

    await client.query(
      `INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
       VALUES ($1, $1, 'PASSWORD_CAMBIADA', $2)`,
      [userId, JSON.stringify({ motivo: 'Cambio de contraseña por el usuario' })]
    );

    await client.query('COMMIT');

    // 4. Responder con token nuevo
    const nowSec = Math.floor(Date.now() / 1000);
    const newTokenPayload = {
      sub: user.id.toString(),
      legajo: user.legajo,
      sv: Number(updatedRow.sesion_version),
      iat: nowSec,
      exp: nowSec + 60 * 60 * 24, // 24h
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
