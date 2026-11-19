import pg from 'pg';
import { columnasPersona, persona } from '../preventivos/comun.ts';
import { medidorNoEncontrado } from './lecturas.ts';

// -------------------------------------------------------------
// LE1, 3.1: los días sin lectura y el atraso. Un solo lugar para el GET de los medidores, la
// ronda y la revisión diaria. Usan los alias md (medidores), m (maquinas) y ul (la última
// lectura vigente, con registrada_en).
// -------------------------------------------------------------

/** La última lectura vigente: la de mayor valor; a igual valor, la de mayor id. */
export const SQL_ULTIMA_LECTURA = `
  LEFT JOIN LATERAL (
    SELECT l.valor, l.registrada_en
    FROM lecturas_medidor l
    WHERE l.medidor_id = md.id AND l.anulada_en IS NULL
    ORDER BY l.valor DESC, l.id DESC
    LIMIT 1
  ) ul ON TRUE
`;

/** hoy_instalacion() menos el día local de la última lectura; sin lecturas, del alta del medidor. */
export const SQL_DIAS_SIN_LECTURA = `(hoy_instalacion() - (COALESCE(ul.registrada_en, md.creado_en) AT TIME ZONE (
  SELECT COALESCE((SELECT zona_horaria FROM configuracion_sistema WHERE id = 1), 'America/Argentina/Buenos_Aires')
))::date)`;

/**
 * Atrasado: con lectura_cada_dias, con alguna tarea activa de un plan activo, y más días sin
 * lectura que lectura_cada_dias. Con "cada 7" y la última el lunes, el lunes siguiente todavía no.
 * El medidor y su máquina, activos: es la lista de la ronda (3.1).
 */
export const SQL_ATRASADO = `(
  md.lectura_cada_dias IS NOT NULL AND md.activo AND m.activo
  AND EXISTS (
    SELECT 1 FROM plan_tareas t
    JOIN planes_mantenimiento p ON p.id = t.plan_id
    WHERE t.medidor_id = md.id AND t.activo AND p.activo
  )
  AND ${SQL_DIAS_SIN_LECTURA} > md.lectura_cada_dias
)`;

/**
 * HE1, 4: atrasado por uso. El medidor y su máquina, activos, con alguna tarea activa de un plan
 * activo que, según el ritmo, ya estaría para avisar (al día, con la fecha de aviso estimada
 * hasta hoy) o ya habría vencido (próxima, con la fecha estimada hasta hoy). No depende de
 * lectura_cada_dias. Las fechas salen de v_plan_tareas_estimacion.
 */
export const SQL_ATRASO_POR_USO = `(
  md.activo AND m.activo
  AND EXISTS (
    SELECT 1 FROM v_plan_tareas_estimacion e
    JOIN planes_mantenimiento p ON p.id = e.plan_id
    WHERE e.medidor_id = md.id AND e.activo AND p.activo
      AND (
        (e.estado_uso = 'AL_DIA' AND e.fecha_aviso_estimada <= e.hoy)
        OR (e.estado_uso = 'PROXIMA' AND e.fecha_estimada <= e.hoy)
      )
  )
)`;

/** HE1, 2: las columnas del uso declarado y del ritmo; vr es v_medidores_ritmo. */
export const COLUMNAS_RITMO = `md.uso_estimado_valor, md.uso_estimado_periodo,
         vr.ritmo, vr.fuente, vr.ritmo_declarado, vr.lecturas_usadas, vr.lecturas_desde, vr.lecturas_hasta,
         vr.desvio_pct, vr.valor_estimado_hoy`;

export const JOIN_RITMO = 'LEFT JOIN v_medidores_ritmo vr ON vr.medidor_id = md.id';

/** Redondea a n decimales y devuelve un número. */
export function redondeo(v: unknown, decimales: number): number {
  const f = 10 ** decimales;
  return Math.round(Number(v) * f) / f;
}

/** HE1, 2: el uso declarado, el ritmo y el valor estimado de hoy, como van en la respuesta. */
export function ritmoDeMedidor(r: Record<string, any>) {
  return {
    uso_estimado:
      r.uso_estimado_valor === null
        ? null
        : { valor: Number(r.uso_estimado_valor), periodo: r.uso_estimado_periodo as 'DIA' | 'SEMANA' | 'MES' },
    ritmo:
      r.ritmo === null || r.ritmo === undefined
        ? null
        : {
            por_dia: redondeo(r.ritmo, 3),
            fuente: r.fuente as 'DECLARADO' | 'LECTURAS',
            declarado_por_dia: r.ritmo_declarado === null ? null : redondeo(r.ritmo_declarado, 3),
            lecturas:
              r.lecturas_usadas === null
                ? null
                : { usadas: Number(r.lecturas_usadas), desde: r.lecturas_desde, hasta: r.lecturas_hasta },
            desvio_pct: r.desvio_pct === null ? null : Number(r.desvio_pct),
          },
    valor_estimado_hoy:
      r.valor_estimado_hoy === null || r.valor_estimado_hoy === undefined ? null : redondeo(r.valor_estimado_hoy, 2),
  };
}

/** Un medidor con su máquina, su última lectura vigente y cuántas tareas activas lo usan. */
const SQL_MEDIDOR = `
  SELECT md.id, md.nombre, md.unidad, md.activo, md.creado_en, md.actualizado_en, md.lectura_cada_dias,
         ${COLUMNAS_RITMO},
         m.id AS maquina_id, m.codigo AS maquina_codigo, m.nombre AS maquina_nombre, m.activo AS maquina_activo,
         s.id AS sector_id, s.nombre AS sector_nombre,
         ul.id AS lectura_id, ul.valor AS lectura_valor, ul.registrada_en AS lectura_en,
         ul.por_id AS lectura_por_id, ul.por_legajo AS lectura_por_legajo,
         ul.por_nombre AS lectura_por_nombre, ul.por_apellido AS lectura_por_apellido,
         (SELECT count(*)::int FROM plan_tareas t WHERE t.medidor_id = md.id AND t.activo) AS tareas_activas,
         ${SQL_DIAS_SIN_LECTURA} AS dias_sin_lectura,
         ${SQL_ATRASADO} AS atraso_por_dias,
         ${SQL_ATRASO_POR_USO} AS atraso_por_uso
  FROM medidores md
  JOIN maquinas m ON m.id = md.maquina_id
  JOIN sectores s ON s.id = m.sector_id
  ${JOIN_RITMO}
  LEFT JOIN LATERAL (
    SELECT l.id, l.valor, l.registrada_en,
           u.id AS por_id, u.legajo AS por_legajo, u.nombre AS por_nombre, u.apellido AS por_apellido
    FROM lecturas_medidor l
    JOIN usuarios u ON u.id = l.registrada_por_usuario_id
    WHERE l.medidor_id = md.id AND l.anulada_en IS NULL
    ORDER BY l.valor DESC, l.id DESC
    LIMIT 1
  ) ul ON TRUE
`;

function medidor(r: Record<string, any>) {
  return {
    id: Number(r.id),
    nombre: r.nombre,
    unidad: r.unidad,
    activo: Boolean(r.activo),
    maquina: {
      id: Number(r.maquina_id),
      codigo: r.maquina_codigo,
      nombre: r.maquina_nombre,
      activo: Boolean(r.maquina_activo),
      sector: { id: Number(r.sector_id), nombre: r.sector_nombre },
    },
    ultima_lectura:
      r.lectura_id === null
        ? null
        : {
            id: Number(r.lectura_id),
            valor: Number(r.lectura_valor),
            registrada_en: r.lectura_en,
            registrada_por: persona(r, 'lectura_por'),
          },
    tareas_activas: Number(r.tareas_activas),
    // LE1, 3.5
    lectura_cada_dias: r.lectura_cada_dias === null ? null : Number(r.lectura_cada_dias),
    dias_sin_lectura: Number(r.dias_sin_lectura),
    // HE1, 4: atrasado por días o por uso
    atrasado: Boolean(r.atraso_por_dias) || Boolean(r.atraso_por_uso),
    // HE1, 2
    ...ritmoDeMedidor(r),
    atraso_por_dias: Boolean(r.atraso_por_dias),
    atraso_por_uso: Boolean(r.atraso_por_uso),
    creado_en: r.creado_en,
    actualizado_en: r.actualizado_en,
  };
}

/** GET /api/medidores: por código de máquina y nombre. */
export async function listarMedidores(db: pg.Pool, maquinaId: number | null, todos: boolean) {
  const params: unknown[] = [];
  const cond: string[] = [];
  if (maquinaId !== null) {
    params.push(maquinaId);
    cond.push(`md.maquina_id = $${params.length}`);
  }
  if (!todos) cond.push('md.activo');
  const where = cond.length > 0 ? `WHERE ${cond.join(' AND ')}` : '';
  const res = await db.query(
    `${SQL_MEDIDOR} ${where} ORDER BY m.codigo ASC NULLS LAST, md.nombre ASC, md.id ASC`,
    params
  );
  return res.rows.map(medidor);
}

/** El detalle (3.3): el medidor, con las tareas activas que lo usan. */
export async function obtenerDetalleMedidor(db: pg.Pool | pg.PoolClient, medidorId: number) {
  const res = await db.query(`${SQL_MEDIDOR} WHERE md.id = $1`, [medidorId]);
  if (res.rows.length === 0) throw medidorNoEncontrado();

  const resT = await db.query(
    `SELECT t.id, t.accion, p.id AS plan_id, p.nombre AS plan_nombre, p.activo AS plan_activo
     FROM plan_tareas t
     JOIN planes_mantenimiento p ON p.id = t.plan_id
     WHERE t.medidor_id = $1 AND t.activo
     ORDER BY p.nombre ASC, p.id ASC, t.orden ASC, t.id ASC`,
    [medidorId]
  );

  return {
    ...medidor(res.rows[0]),
    tareas: resT.rows.map((t) => ({
      id: Number(t.id),
      accion: t.accion,
      plan: { id: Number(t.plan_id), nombre: t.plan_nombre, activo: Boolean(t.plan_activo) },
    })),
  };
}

/** Una lectura como en las respuestas: con su intervención y los datos de la anulación. */
const SQL_LECTURA = `
  SELECT l.id, l.valor, l.registrada_en, l.origen, l.observacion, l.anulada_en, l.motivo_anulacion,
         it.intervencion_id,
         ${columnasPersona('ur', 'registrada_por')},
         ${columnasPersona('ua', 'anulada_por')}
  FROM lecturas_medidor l
  JOIN usuarios ur ON ur.id = l.registrada_por_usuario_id
  LEFT JOIN usuarios ua ON ua.id = l.anulada_por_usuario_id
  LEFT JOIN intervencion_tareas it ON it.id = l.intervencion_tarea_id
`;

function lectura(r: Record<string, any>) {
  return {
    id: Number(r.id),
    valor: Number(r.valor),
    registrada_en: r.registrada_en,
    registrada_por: persona(r, 'registrada_por'),
    origen: r.origen,
    intervencion_id: r.intervencion_id === null ? null : Number(r.intervencion_id),
    observacion: r.observacion,
    anulada: r.anulada_en !== null,
    anulada_en: r.anulada_en,
    anulada_por: persona(r, 'anulada_por'),
    motivo_anulacion: r.motivo_anulacion,
  };
}

export async function obtenerLectura(db: pg.Pool | pg.PoolClient, lecturaId: number) {
  const r = await db.query(`${SQL_LECTURA} WHERE l.id = $1`, [lecturaId]);
  return lectura(r.rows[0]);
}

/** Las lecturas de un medidor, también las anuladas, de la más nueva a la más vieja. */
export async function listarLecturas(db: pg.Pool, medidorId: number, limit: number, offset: number) {
  const total = await db.query('SELECT count(*)::int AS total FROM lecturas_medidor WHERE medidor_id = $1', [medidorId]);
  const r = await db.query(`${SQL_LECTURA} WHERE l.medidor_id = $1 ORDER BY l.id DESC LIMIT $2 OFFSET $3`, [
    medidorId,
    limit,
    offset,
  ]);
  return { total: Number(total.rows[0].total), lecturas: r.rows.map(lectura) };
}
