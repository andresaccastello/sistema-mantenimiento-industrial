import type { Pool, PoolClient } from 'pg';

/**
 * MQ1, 2.1: quién participó en una intervención. Sin montos ni horas, así que se ve sin COSTOS_VER.
 * - internos: el responsable y los usuarios de los renglones de mano de obra vigentes;
 * - externos: los proveedores de los renglones de mano de obra vigentes.
 * Sin repetidos: los internos por apellido y nombre; los externos por nombre.
 */
export interface ParticipanteInterno {
  id: number;
  legajo: string;
  nombre: string;
  apellido: string | null;
}

export interface ParticipanteExterno {
  id: number;
  nombre: string;
}

export interface Participantes {
  internos: ParticipanteInterno[];
  externos: ParticipanteExterno[];
}

/** Los participantes de varias intervenciones a la vez: dos consultas, sin importar cuántas sean. */
export async function obtenerParticipantes(
  db: Pool | PoolClient,
  intervencionIds: number[]
): Promise<Map<number, Participantes>> {
  const mapa = new Map<number, Participantes>();
  for (const id of intervencionIds) mapa.set(id, { internos: [], externos: [] });
  if (intervencionIds.length === 0) return mapa;

  const resInternos = await db.query(
    // El UNION ya saca los repetidos (el responsable que también cargó horas, o varias horas de uno)
    `SELECT x.intervencion_id, u.id, u.legajo, u.nombre, u.apellido
     FROM (
       SELECT i.id AS intervencion_id, i.responsable_usuario_id AS usuario_id
       FROM intervenciones i
       WHERE i.id = ANY($1::bigint[]) AND i.responsable_usuario_id IS NOT NULL
       UNION
       SELECT c.intervencion_id, c.usuario_id
       FROM intervencion_costos c
       WHERE c.intervencion_id = ANY($1::bigint[])
         AND c.tipo = 'MANO_OBRA' AND c.anulado_en IS NULL AND c.usuario_id IS NOT NULL
     ) x
     JOIN usuarios u ON u.id = x.usuario_id
     ORDER BY x.intervencion_id, lower(COALESCE(u.apellido, '')), lower(u.nombre), u.id`,
    [intervencionIds]
  );
  for (const r of resInternos.rows) {
    mapa.get(Number(r.intervencion_id))!.internos.push({
      id: Number(r.id),
      legajo: r.legajo,
      nombre: r.nombre,
      apellido: r.apellido ?? null,
    });
  }

  const resExternos = await db.query(
    `SELECT DISTINCT c.intervencion_id, p.id, p.nombre, lower(p.nombre) AS orden
     FROM intervencion_costos c
     JOIN proveedores p ON p.id = c.proveedor_id
     WHERE c.intervencion_id = ANY($1::bigint[])
       AND c.tipo = 'MANO_OBRA' AND c.anulado_en IS NULL
     ORDER BY c.intervencion_id, orden, p.id`,
    [intervencionIds]
  );
  for (const r of resExternos.rows) {
    mapa.get(Number(r.intervencion_id))!.externos.push({ id: Number(r.id), nombre: r.nombre });
  }

  return mapa;
}
