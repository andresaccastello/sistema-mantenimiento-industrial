import { createMiddleware } from 'hono/factory';
import { jwt } from 'hono/jwt';
import { pool } from './db.ts';

const JWT_SECRET = process.env.JWT_SECRET as string; // Ya validado en api.ts

export const authMiddleware = jwt({
  secret: JWT_SECRET,
  alg: 'HS256'
});

export const requirePermission = (requiredPermission: string) => {
  return createMiddleware(async (c, next) => {
    const payload = c.get('jwtPayload') as { sub?: string, permisos?: string[] }; 
    
    if (!payload || !payload.sub || !payload.permisos) {
      return c.json({ error: 'No autorizado' }, 401);
    }

    // 5. Evitar tokens de usuarios desactivados o permisos revocados
    // Consultamos la BD en vivo para asegurar que el usuario sigue activo 
    // y tiene el permiso, en lugar de confiar ciegamente en el token emitido.
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
      if (!permisosActuales.includes(requiredPermission)) {
        return c.json({ error: 'Permisos insuficientes o revocados' }, 403);
      }
    } catch (dbError) {
      console.error('Error validando permisos en DB:', dbError);
      return c.json({ error: 'Error interno de autorización' }, 500);
    }

    await next();
  });
};


