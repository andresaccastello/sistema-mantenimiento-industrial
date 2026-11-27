import pg from 'pg';
import { parseId } from '../validations.ts';
import { ErrorNegocio } from '../intervenciones/errores.ts';

/**
 * GR1, 1: las cuentas de /indicadores y /costos, sacadas a funciones que reciben desde y hasta.
 * Las llaman los dos reportes de siempre y /reportes/evolucion, así los criterios son uno solo.
 *
 * `hastaIncluido`: los reportes cuentan hasta `hasta` inclusive. La evolución parte el intervalo en
 * períodos semiabiertos [inicio, fin) y deja cerrado solo el último, así cada hecho cae en un único
 * período y la suma de los períodos es exactamente el total.
 */

type Db = pg.Pool | pg.PoolClient;

export interface AlcanceReporte {
  /** El alcance de REPORTES_CONSULTAR: TODAS, SECTORES o PROPIAS (null se trata como no TODAS). */
  scope: string | null;
  sectores: number[];
}

/** sector_id y planta_id opcionales, con los mismos mensajes que ya tenían los reportes. */
export function leerSectorYPlanta(c: any): { sectorId: number | null; plantaId: number | null } {
  let sectorId: number | null = null;
  const sectorIdQuery = c.req.query('sector_id');
  if (sectorIdQuery !== undefined && sectorIdQuery !== null && sectorIdQuery.trim() !== '') {
    sectorId = parseId(sectorIdQuery);
    if (!sectorId) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El sector_id debe ser un entero válido');
    }
  }

  let plantaId: number | null = null;
  const plantaIdQuery = c.req.query('planta_id');
  if (plantaIdQuery !== undefined && plantaIdQuery !== null && plantaIdQuery.trim() !== '') {
    plantaId = parseId(plantaIdQuery);
    if (!plantaId) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El planta_id debe ser un entero válido');
    }
  }
  return { sectorId, plantaId };
}

/** Sin sectores, o con un sector pedido fuera del alcance: la respuesta va vacía. */
export function fueraDeAlcance(alcance: AlcanceReporte, sectorId: number | null): boolean {
  if (alcance.scope === 'TODAS') return false;
  if (alcance.sectores.length === 0) return true;
  return sectorId !== null && !alcance.sectores.includes(sectorId);
}

/** Los filtros de alcance, sector y planta sobre `m` y `s`, con los parámetros desde `primerIndice`. */
function filtrosMaquina(
  alcance: AlcanceReporte,
  sectorId: number | null,
  plantaId: number | null,
  primerIndice: number
): { condiciones: string[]; params: unknown[] } {
  const condiciones: string[] = [];
  const params: unknown[] = [];
  let pIdx = primerIndice;
  if (alcance.scope !== 'TODAS') {
    condiciones.push(`m.sector_id = ANY($${pIdx})`);
    params.push(alcance.sectores);
    pIdx++;
  }
  if (sectorId !== null) {
    condiciones.push(`m.sector_id = $${pIdx}`);
    params.push(sectorId);
    pIdx++;
  }
  if (plantaId !== null) {
    condiciones.push(`s.planta_id = $${pIdx}`);
    params.push(plantaId);
    pIdx++;
  }
  return { condiciones, params };
}

// -------------------------------------------------------------
// Indicadores
// -------------------------------------------------------------

/** Las máquinas activas de la selección, que son las que cuentan en /indicadores. */
export async function maquinasDeIndicadores(
  db: Db,
  alcance: AlcanceReporte,
  sectorId: number | null,
  plantaId: number | null
): Promise<number[]> {
  const { condiciones, params } = filtrosMaquina(alcance, sectorId, plantaId, 1);
  const res = await db.query(
    `SELECT m.id
     FROM maquinas m
     JOIN sectores s ON s.id = m.sector_id
     WHERE ${['m.activo = TRUE', ...condiciones].join(' AND ')}`,
    params
  );
  return res.rows.map((r: any) => Number(r.id));
}

/** Los minutos entre dos instantes, redondeados como en /indicadores. */
export async function minutosEntre(db: Db, desde: string, hasta: string): Promise<number> {
  const res = await db.query(
    `SELECT ROUND(EXTRACT(EPOCH FROM ($2::timestamptz - $1::timestamptz)) / 60)::INTEGER AS m`,
    [desde, hasta]
  );
  return Number(res.rows[0].m);
}

/** La disponibilidad: 1 menos la inactividad sobre el tiempo del período, entre 0 y 1, con 4 decimales. */
export function disponibilidadDe(inactividadMinutos: number, minutosPeriodo: number): number | null {
  if (minutosPeriodo <= 0) return null;
  const dispRaw = 1 - inactividadMinutos / minutosPeriodo;
  const dispClamped = Math.max(0, Math.min(1, dispRaw));
  return Number(dispClamped.toFixed(4));
}

const SQL_INACTIVIDAD = `
  SELECT
    COALESCE(SUM(f.total_minutos), 0)::INTEGER AS inactividad_minutos,
    COALESCE(SUM(f.correctivo_minutos), 0)::INTEGER AS inactividad_correctiva_minutos,
    COALESCE(SUM(f.preventivo_minutos), 0)::INTEGER AS inactividad_preventiva_minutos
  FROM maquinas m
  CROSS JOIN LATERAL fn_inactividad_maquina(m.id, $2::timestamptz, $3::timestamptz) f
  WHERE m.id = ANY($1::bigint[])
`;

/** La inactividad de las máquinas entre desde y hasta: la unión de intervalos de fn_inactividad_maquina. */
export async function inactividadDeMaquinas(
  db: Db,
  maquinaIds: number[],
  desde: string,
  hasta: string
): Promise<{ total: number; correctiva: number; preventiva: number }> {
  const r = (await db.query(SQL_INACTIVIDAD, [maquinaIds, desde, hasta])).rows[0];
  return {
    total: Number(r.inactividad_minutos),
    correctiva: Number(r.inactividad_correctiva_minutos),
    preventiva: Number(r.inactividad_preventiva_minutos),
  };
}

/**
 * La inactividad acumulada desde `desde` hasta cada uno de los `fines`, con la misma consulta que
 * /indicadores. La de cada período es la diferencia entre dos acumuladas seguidas: como
 * fn_inactividad_maquina redondea a minutos en cada llamada, así la suma de los períodos da
 * exactamente el total, que es la última acumulada.
 */
export async function inactividadAcumulada(
  db: Db,
  maquinaIds: number[],
  desde: string,
  fines: string[]
): Promise<number[]> {
  return Promise.all(fines.map(async (fin) => (await inactividadDeMaquinas(db, maquinaIds, desde, fin)).total));
}

export interface CuentasIntervenciones {
  fallas: number;
  correctivas_finalizadas: number;
  preventivas_finalizadas: number;
  mttr_minutos: number | null;
  respuesta_promedio_minutos: number | null;
}

/** Fallas, finalizadas, MTTR y respuesta de /indicadores entre desde y hasta. */
export async function cuentasIntervenciones(
  db: Db,
  maquinaIds: number[],
  desde: string,
  hasta: string,
  hastaIncluido = true
): Promise<CuentasIntervenciones> {
  const hastaOp = hastaIncluido ? '<=' : '<';
  const enCreacion = `i.fecha_creacion >= $2::timestamptz AND i.fecha_creacion ${hastaOp} $3::timestamptz`;
  const enFinalizacion = `i.fecha_finalizacion >= $2::timestamptz AND i.fecha_finalizacion ${hastaOp} $3::timestamptz`;

  const qIntervenciones = `
    SELECT
      COUNT(*) FILTER (
        WHERE ti.codigo = 'CORRECTIVO'
          AND i.estado != 'CANCELADA'
          AND ${enCreacion}
      )::INTEGER AS fallas,

      COUNT(*) FILTER (
        WHERE ti.codigo = 'CORRECTIVO'
          AND i.estado = 'FINALIZADA'
          AND ${enFinalizacion}
      )::INTEGER AS correctivas_finalizadas,

      ROUND(AVG(vit.duracion_neta_minutos) FILTER (
        WHERE ti.codigo = 'CORRECTIVO'
          AND i.estado = 'FINALIZADA'
          AND ${enFinalizacion}
      ))::INTEGER AS mttr_minutos,

      ROUND(AVG(vit.espera_minutos) FILTER (
        WHERE ti.codigo = 'CORRECTIVO'
          AND i.estado = 'FINALIZADA'
          AND ${enFinalizacion}
      ))::INTEGER AS respuesta_promedio_minutos,

      COUNT(*) FILTER (
        WHERE ti.codigo = 'PREVENTIVO'
          AND i.estado = 'FINALIZADA'
          AND ${enFinalizacion}
      )::INTEGER AS preventivas_finalizadas

    FROM intervenciones i
    JOIN tipos_intervencion ti ON ti.id = i.tipo_intervencion_id
    LEFT JOIN v_intervencion_tiempos vit ON vit.intervencion_id = i.id
    WHERE i.maquina_id = ANY($1::bigint[])
      AND i.eliminado_en IS NULL
      AND (
        (ti.codigo = 'CORRECTIVO' AND i.estado != 'CANCELADA' AND ${enCreacion})
        OR
        (ti.codigo IN ('CORRECTIVO', 'PREVENTIVO') AND i.estado = 'FINALIZADA' AND ${enFinalizacion})
      )
  `;

  const r = (await db.query(qIntervenciones, [maquinaIds, desde, hasta])).rows[0];
  return {
    fallas: Number(r.fallas),
    correctivas_finalizadas: Number(r.correctivas_finalizadas),
    preventivas_finalizadas: Number(r.preventivas_finalizadas),
    mttr_minutos: r.mttr_minutos !== null ? Number(r.mttr_minutos) : null,
    respuesta_promedio_minutos: r.respuesta_promedio_minutos !== null ? Number(r.respuesta_promedio_minutos) : null,
  };
}

// -------------------------------------------------------------
// Costos
// -------------------------------------------------------------

export interface CostoPorTipo {
  repuestos: number;
  mano_obra: number;
  servicio_externo: number;
  transporte: number;
  otro: number;
  ajuste: number;
}

/**
 * Cada gasto de /costos, en una sola lista (D-019, punto 8): consumos no anulados por creado_en y
 * renglones no anulados por registrado_en, de intervenciones no eliminadas y de las máquinas
 * visibles de la selección, activas o no. $1 es desde y $2 hasta; los filtros siguen desde $3.
 */
export function consultaGastos(
  alcance: AlcanceReporte,
  sectorId: number | null,
  plantaId: number | null,
  desde: string,
  hasta: string,
  hastaIncluido = true
): { sqlGastos: string; params: unknown[] } {
  const { condiciones, params } = filtrosMaquina(alcance, sectorId, plantaId, 3);
  const filtrosSql = ['i.eliminado_en IS NULL', ...condiciones].join(' AND ');
  const hastaOp = hastaIncluido ? '<=' : '<';

  const sqlGastos = `
      WITH gastos AS (
        SELECT i.id AS intervencion_id, m.id AS maquina_id, 'REPUESTOS'::text AS tipo,
               ROUND(ir.cantidad * ir.costo_unitario_aplicado, 2) AS importe,
               NULL::numeric AS horas, NULL::bigint AS usuario_id, NULL::bigint AS proveedor_id
        FROM intervencion_repuestos ir
        JOIN intervenciones i ON i.id = ir.intervencion_id
        JOIN maquinas m ON m.id = i.maquina_id
        JOIN sectores s ON s.id = m.sector_id
        WHERE ${filtrosSql}
          AND ir.anulado_en IS NULL
          AND ir.creado_en >= $1::timestamptz AND ir.creado_en ${hastaOp} $2::timestamptz
        UNION ALL
        SELECT i.id, m.id, ic.tipo::text, ic.importe, ic.horas, ic.usuario_id, ic.proveedor_id
        FROM intervencion_costos ic
        JOIN intervenciones i ON i.id = ic.intervencion_id
        JOIN maquinas m ON m.id = i.maquina_id
        JOIN sectores s ON s.id = m.sector_id
        WHERE ${filtrosSql}
          AND ic.anulado_en IS NULL
          AND ic.registrado_en >= $1::timestamptz AND ic.registrado_en ${hastaOp} $2::timestamptz
      )
    `;
  return { sqlGastos, params: [desde, hasta, ...params] };
}

/** El total, las intervenciones y el importe por tipo de /costos. */
export async function totalesCostos(
  db: Db,
  alcance: AlcanceReporte,
  sectorId: number | null,
  plantaId: number | null,
  desde: string,
  hasta: string,
  hastaIncluido = true
): Promise<{ total: number; intervenciones: number; por_tipo: CostoPorTipo }> {
  const { sqlGastos, params } = consultaGastos(alcance, sectorId, plantaId, desde, hasta, hastaIncluido);
  const t = (
    await db.query(
      `${sqlGastos}
       SELECT
         COALESCE(SUM(importe), 0) AS total,
         COUNT(DISTINCT intervencion_id)::integer AS intervenciones,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'REPUESTOS'), 0) AS repuestos,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'MANO_OBRA'), 0) AS mano_obra,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'SERVICIO_EXTERNO'), 0) AS servicio_externo,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'TRANSPORTE'), 0) AS transporte,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'OTRO'), 0) AS otro,
         COALESCE(SUM(importe) FILTER (WHERE tipo = 'AJUSTE'), 0) AS ajuste
       FROM gastos`,
      params
    )
  ).rows[0];
  return {
    total: Number(t.total),
    intervenciones: Number(t.intervenciones),
    por_tipo: {
      repuestos: Number(t.repuestos),
      mano_obra: Number(t.mano_obra),
      servicio_externo: Number(t.servicio_externo),
      transporte: Number(t.transporte),
      otro: Number(t.otro),
      ajuste: Number(t.ajuste),
    },
  };
}
