import { createMiddleware } from 'hono/factory';
import { jwt } from 'hono/jwt';
import { pool } from './db.ts';
import { JWT_SECRET } from './config.ts';

export const jwtVerify = jwt({
  secret: JWT_SECRET,
  alg: 'HS256'
});

export const dbVerify = createMiddleware(async (c, next) => {
  const payload = c.get('jwtPayload') as { sub?: string }; 
  
  if (!payload || !payload.sub) {
    return c.json({ error: 'No autorizado' }, 401);
  }

  try {
    const { rows } = await pool.query(
      `SELECT u.activo, array_agg(pe.codigo) as permisos_actuales
       FROM usuarios u
       LEFT JOIN perfil_permiso pp ON u.perfil_id = pp.perfil_id
       LEFT JOIN permisos pe ON pp.permiso_id = pe.id
       WHERE u.id = $1
       GROUP BY u.id, u.activo`,
      [payload.sub]
    );

    if (rows.length === 0 || !rows[0].activo) {
      return c.json({ error: 'Usuario inactivo o no existe' }, 401);
    }

    const permisosActuales = rows[0].permisos_actuales || [];
    const permisosFiltrados = permisosActuales.filter((p: string | null) => p !== null);
    
    // Guardamos en c.set ignorando chequeos estrictos
    (c.set as any)('userPermissions', permisosFiltrados);
    
  } catch (dbError) {
    console.error('Error validando usuario en DB:', dbError);
    return c.json({ error: 'Error interno de autorización' }, 500);
  }

  await next();
});

export const requirePermission = (requiredPermission: string) => {
  return createMiddleware(async (c, next) => {
    const permisos = (c.get as any)('userPermissions') as string[] | undefined;
    
    if (!permisos || !permisos.includes(requiredPermission)) {
      return c.json({ error: 'Permisos insuficientes o revocados' }, 403);
    }

    await next();
  });
};
