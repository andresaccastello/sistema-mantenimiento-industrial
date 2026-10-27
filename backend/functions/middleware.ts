import { createMiddleware } from 'hono/factory';
import { jwt } from 'hono/jwt';
import { pool } from './db.ts';
import { JWT_SECRET } from './config.ts';
import { resolverPermisosEfectivos, AlcancePermiso } from './intervenciones/permisos.ts';

export type { AlcancePermiso };

const SCOPE_HIERARCHY: Record<AlcancePermiso, number> = {
  PROPIAS: 1,
  SECTORES: 2,
  TODAS: 3,
};

export const jwtVerify = jwt({
  secret: JWT_SECRET,
  alg: 'HS256',
});

export const dbVerify = createMiddleware(async (c, next) => {
  const payload = c.get('jwtPayload') as { sub?: string; legajo?: string; iat?: number; exp?: number } | undefined;

  if (!payload || !payload.sub) {
    return c.json({ error: 'No autorizado' }, 401);
  }

  const userId = Number(payload.sub);
  if (isNaN(userId)) {
    return c.json({ error: 'Identificador de usuario inválido' }, 401);
  }

  try {
    const info = await resolverPermisosEfectivos(pool, userId);

    if (!info.activo) {
      return c.json({ error: 'Usuario inactivo o no existe' }, 401);
    }

    // 1. Sesión invalidada: si el token tiene iat anterior a password_actualizado_en -> 401 SESION_INVALIDADA
    if (info.password_actualizado_en) {
      const tokenIatSec = typeof payload.iat === 'number' ? Math.floor(payload.iat) : 0;
      const pwdActualizadoSec = Math.floor(info.password_actualizado_en.getTime() / 1000);
      if (tokenIatSec < pwdActualizadoSec) {
        return c.json({ error: 'Sesión invalidada por cambio de contraseña', codigo: 'SESION_INVALIDADA' }, 401);
      }
    }

    // 2. Contraseña temporal: si debe_cambiar_password es TRUE, solo se permiten GET /api/auth/me y POST /api/auth/cambiar-password
    if (info.debe_cambiar_password) {
      const path = c.req.path.replace(/\/+$/, '');
      const method = c.req.method.toUpperCase();
      const isAllowed = (method === 'GET' && path === '/api/auth/me') ||
                        (method === 'POST' && path === '/api/auth/cambiar-password');

      if (!isAllowed) {
        return c.json({ error: 'Debe cambiar su contraseña antes de continuar', codigo: 'CAMBIO_PASSWORD_REQUERIDO' }, 403);
      }
    }

    const permissionsList = Object.keys(info.permisos);

    (c.set as any)('userId', userId);
    (c.set as any)('userPermissions', permissionsList);
    (c.set as any)('userPermissionsMap', info.permisos);
    (c.set as any)('userSectores', info.sectores);

  } catch (dbError) {
    console.error('Error validando usuario y permisos en DB:', dbError);
    return c.json({ error: 'Error interno de autorización' }, 500);
  }

  await next();
});

export const requirePermission = (
  requiredPermission: string,
  minScope?: AlcancePermiso
) => {
  return createMiddleware(async (c, next) => {
    const permissionsMap = (c.get as any)('userPermissionsMap') as Record<string, AlcancePermiso> | undefined;

    if (!permissionsMap || !(requiredPermission in permissionsMap)) {
      return c.json({ error: 'Permisos insuficientes o revocados' }, 403);
    }

    if (minScope) {
      const userScope = permissionsMap[requiredPermission];
      const userLevel = SCOPE_HIERARCHY[userScope] || 0;
      const requiredLevel = SCOPE_HIERARCHY[minScope] || 0;

      if (userLevel < requiredLevel) {
        return c.json({ error: 'Alcance de permisos insuficiente' }, 403);
      }
    }

    await next();
  });
};

export const getUserScope = (c: any, permissionCode: string): AlcancePermiso | null => {
  const permissionsMap = (c.get as any)('userPermissionsMap') as Record<string, AlcancePermiso> | undefined;
  return permissionsMap ? permissionsMap[permissionCode] || null : null;
};
