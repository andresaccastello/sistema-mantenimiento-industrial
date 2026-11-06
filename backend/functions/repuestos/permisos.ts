import { Context } from 'hono';

export function veCostos(c: Context): boolean {
  const permissionsMap = (c.get as any)('userPermissionsMap') as Record<string, any> | undefined;
  return !!(permissionsMap && ('COSTOS_VER' in permissionsMap || 'REPUESTOS_GESTIONAR' in permissionsMap));
}

export function puedeCargarCostos(c: Context): boolean {
  const permissionsMap = (c.get as any)('userPermissionsMap') as Record<string, any> | undefined;
  return !!(permissionsMap && ('REPUESTOS_GESTIONAR' in permissionsMap || 'COSTOS_REGISTRAR' in permissionsMap));
}
