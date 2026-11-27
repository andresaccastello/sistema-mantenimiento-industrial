import pg from 'pg';
import { usuariosConPermiso } from './notificaciones.ts';

export interface PersonaHabilitada {
  id: number;
  legajo: string;
  nombre: string;
  apellido: string | null;
}

/**
 * Los usuarios que pasarían validarResponsableHabilitado para una máquina de ese sector:
 * activos, con INTERVENCIONES_RECIBIR_ASIGNACION y con INTERVENCIONES_VER que alcance
 * el sector (TODAS o PROPIAS, o SECTORES con ese sector).
 *
 * La usan GET /api/intervenciones/:id/responsables-habilitados (ordenados por nombre, como
 * siempre) y GET /api/planes/responsables-habilitados (por apellido y nombre).
 */
export async function responsablesHabilitados(
  db: pg.Pool | pg.PoolClient,
  sectorId: number,
  orden: 'nombre' | 'apellido'
): Promise<PersonaHabilitada[]> {
  const [usuariosRecibir, usuariosVer] = await Promise.all([
    usuariosConPermiso(db, 'INTERVENCIONES_RECIBIR_ASIGNACION'),
    usuariosConPermiso(db, 'INTERVENCIONES_VER'),
  ]);

  const setRecibir = new Set(usuariosRecibir.map((u) => u.usuario_id));
  const ids: number[] = [];
  for (const u of usuariosVer) {
    if (!setRecibir.has(u.usuario_id)) {
      continue;
    }
    if (u.alcance === 'TODAS' || u.alcance === 'PROPIAS') {
      ids.push(u.usuario_id);
    } else if (u.alcance === 'SECTORES' && u.sectores.includes(sectorId)) {
      ids.push(u.usuario_id);
    }
  }

  if (ids.length === 0) {
    return [];
  }

  const ordenSql = orden === 'apellido' ? 'apellido ASC NULLS LAST, nombre ASC, id ASC' : 'nombre ASC';
  const res = await db.query(
    `SELECT id, legajo, nombre, apellido FROM usuarios WHERE id = ANY($1::int[]) AND NOT es_sistema ORDER BY ${ordenSql}`,
    [ids]
  );

  return res.rows.map((u: any) => ({
    id: Number(u.id),
    legajo: u.legajo,
    nombre: u.nombre,
    apellido: u.apellido ?? null,
  }));
}
