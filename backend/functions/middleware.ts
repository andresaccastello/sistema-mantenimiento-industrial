import { createMiddleware } from 'hono/factory';
import { jwt } from 'hono/jwt';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_change_in_prod';

// Middleware que verifica que el token es válido
export const authMiddleware = jwt({
  secret: JWT_SECRET
});

// Middleware que exige un permiso específico
export const requirePermission = (requiredPermission: string) => {
  return createMiddleware(async (c, next) => {
    const payload = c.get('jwtPayload'); // extraído por authMiddleware
    
    if (!payload || !payload.permisos) {
      return c.json({ error: 'No autorizado' }, 401);
    }

    if (!payload.permisos.includes(requiredPermission)) {
      return c.json({ error: 'Permisos insuficientes' }, 403);
    }

    await next();
  });
};
