import pg from 'pg';

export type AlcancePermiso = 'PROPIAS' | 'SECTORES' | 'TODAS';

export interface PermisosEfectivosUsuario {
  activo: boolean;
  perfil_id: number | null;
  permisos: Record<string, AlcancePermiso>;
  sectores: number[];
}

/**
 * Resuelve los permisos efectivos de un usuario combinando:
 * 1. Permisos base de su perfil.
 * 2. Excepciones individuales (CONCEDER / DENEGAR, con estricta prevalencia de DENEGAR).
 * 3. Sectores asignados al usuario.
 */
export async function resolverPermisosEfectivos(
  db: pg.Pool | pg.PoolClient,
  usuarioId: number
): Promise<PermisosEfectivosUsuario> {
  const res = await db.query(
    `SELECT 
       u.id, 
       u.activo, 
       u.perfil_id,
       (
         SELECT COALESCE(json_agg(json_build_object('codigo', pe.codigo, 'alcance', pp.alcance)), '[]'::json)
         FROM perfil_permiso pp
         JOIN permisos pe ON pp.permiso_id = pe.id
         WHERE pp.perfil_id = u.perfil_id
       ) AS perfil_permisos,
       (
         SELECT COALESCE(json_agg(json_build_object('codigo', pe.codigo, 'efecto', up.efecto, 'alcance', up.alcance)), '[]'::json)
         FROM usuario_permiso up
         JOIN permisos pe ON up.permiso_id = pe.id
         WHERE up.usuario_id = u.id
       ) AS usuario_permisos,
       (
         SELECT COALESCE(json_agg(us.sector_id), '[]'::json)
         FROM usuario_sector us
         WHERE us.usuario_id = u.id
       ) AS sectores
     FROM usuarios u
     WHERE u.id = $1`,
    [usuarioId]
  );

  if (res.rows.length === 0) {
    return {
      activo: false,
      perfil_id: null,
      permisos: {},
      sectores: [],
    };
  }

  const row = res.rows[0];
  const permissionsMap = new Map<string, AlcancePermiso>();

  const perfilPerms: Array<{ codigo: string; alcance: string | null }> = row.perfil_permisos || [];
  for (const p of perfilPerms) {
    permissionsMap.set(p.codigo, (p.alcance as AlcancePermiso) || 'TODAS');
  }

  const usuarioPerms: Array<{ codigo: string; efecto: string; alcance: string | null }> = row.usuario_permisos || [];
  for (const p of usuarioPerms) {
    if (p.efecto === 'DENEGAR') {
      permissionsMap.delete(p.codigo);
    } else if (p.efecto === 'CONCEDER') {
      permissionsMap.set(p.codigo, (p.alcance as AlcancePermiso) || 'TODAS');
    }
  }

  const sectores: number[] = (row.sectores || []).map((s: string | number) => Number(s));
  const permisos = Object.fromEntries(permissionsMap);

  return {
    activo: Boolean(row.activo),
    perfil_id: row.perfil_id ? Number(row.perfil_id) : null,
    permisos,
    sectores,
  };
}
