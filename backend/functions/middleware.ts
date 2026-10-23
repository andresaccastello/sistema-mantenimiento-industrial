import { createMiddleware } from 'hono/factory';
import { jwt } from 'hono/jwt';
import { pool } from './db.ts';
import { JWT_SECRET } from './config.ts';

export type AlcancePermiso = 'PROPIAS' | 'SECTORES' | 'TODAS';

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
  const payload = c.get('jwtPayload') as { sub?: string };

  if (!payload || !payload.sub) {
    return c.json({ error: 'No autorizado' }, 401);
  }

  const userId = Number(payload.sub);
  if (isNaN(userId)) {
    return c.json({ error: 'Identificador de usuario inválido' }, 401);
  }

  try {
    const [resUser, resProfilePerms, resUserPerms, resSectores] = await Promise.all([
      pool.query('SELECT id, activo, perfil_id FROM usuarios WHERE id = $1', [userId]),
      pool.query(
        `SELECT pe.codigo, pp.alcance
         FROM perfil_permiso pp
         JOIN permisos pe ON pp.permiso_id = pe.id
         JOIN usuarios u ON u.perfil_id = pp.perfil_id
         WHERE u.id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT pe.codigo, up.efecto, up.alcance
         FROM usuario_permiso up
         JOIN permisos pe ON up.permiso_id = pe.id
         WHERE up.usuario_id = $1`,
        [userId]
      ),
      pool.query('SELECT sector_id FROM usuario_sector WHERE usuario_id = $1', [userId]),
    ]);

    if (resUser.rows.length === 0 || !resUser.rows[0].activo) {
      return c.json({ error: 'Usuario inactivo o no existe' }, 401);
    }

    // 1. Permisos base por perfil
    const permissionsMap = new Map<string, AlcancePermiso>();
    for (const row of resProfilePerms.rows) {
      permissionsMap.set(row.codigo, (row.alcance as AlcancePermiso) || 'TODAS');
    }

    // 2. Excepciones por usuario (DENEGAR prevalece sobre cualquier concesión previa)
    for (const row of resUserPerms.rows) {
      if (row.efecto === 'DENEGAR') {
        permissionsMap.delete(row.codigo);
      } else if (row.efecto === 'CONCEDER') {
        permissionsMap.set(row.codigo, (row.alcance as AlcancePermiso) || 'TODAS');
      }
    }

    const userSectores = resSectores.rows.map((r: { sector_id: string | number }) => Number(r.sector_id));
    const permissionsObj = Object.fromEntries(permissionsMap);
    const permissionsList = Array.from(permissionsMap.keys());

    (c.set as any)('userId', userId);
    (c.set as any)('userPermissions', permissionsList);
    (c.set as any)('userPermissionsMap', permissionsObj);
    (c.set as any)('userSectores', userSectores);

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
