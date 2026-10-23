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
  const resUser = await db.query('SELECT id, activo, perfil_id FROM usuarios WHERE id = $1', [usuarioId]);
  if (resUser.rows.length === 0) {
    return {
      activo: false,
      perfil_id: null,
      permisos: {},
      sectores: [],
    };
  }

  const resProfilePerms = await db.query(
    `SELECT pe.codigo, pp.alcance
     FROM perfil_permiso pp
     JOIN permisos pe ON pp.permiso_id = pe.id
     JOIN usuarios u ON u.perfil_id = pp.perfil_id
     WHERE u.id = $1`,
    [usuarioId]
  );

  const resUserPerms = await db.query(
    `SELECT pe.codigo, up.efecto, up.alcance
     FROM usuario_permiso up
     JOIN permisos pe ON up.permiso_id = pe.id
     WHERE up.usuario_id = $1`,
    [usuarioId]
  );

  const resSectores = await db.query('SELECT sector_id FROM usuario_sector WHERE usuario_id = $1', [usuarioId]);

  if (resUser.rows.length === 0) {
    return {
      activo: false,
      perfil_id: null,
      permisos: {},
      sectores: [],
    };
  }

  const userRow = resUser.rows[0];
  const permissionsMap = new Map<string, AlcancePermiso>();

  // 1. Permisos base del perfil
  for (const row of resProfilePerms.rows) {
    permissionsMap.set(row.codigo, (row.alcance as AlcancePermiso) || 'TODAS');
  }

  // 2. Excepciones por usuario (DENEGAR prevalece)
  for (const row of resUserPerms.rows) {
    if (row.efecto === 'DENEGAR') {
      permissionsMap.delete(row.codigo);
    } else if (row.efecto === 'CONCEDER') {
      permissionsMap.set(row.codigo, (row.alcance as AlcancePermiso) || 'TODAS');
    }
  }

  const sectores = resSectores.rows.map((r: { sector_id: string | number }) => Number(r.sector_id));
  const permisos = Object.fromEntries(permissionsMap);

  return {
    activo: Boolean(userRow.activo),
    perfil_id: userRow.perfil_id ? Number(userRow.perfil_id) : null,
    permisos,
    sectores,
  };
}
