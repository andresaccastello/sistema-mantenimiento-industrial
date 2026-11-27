import pg from 'pg';
import { pool } from '../db.ts';
import { ErrorNegocio } from '../intervenciones/errores.ts';
import { conTransaccion } from '../intervenciones/transaccion.ts';
import { UsuarioVisibilidad } from '../intervenciones/visibilidad.ts';
import { procesarPlan, usuarioSistema } from '../preventivos/vencimientos.ts';
import { textoOpcional } from '../preventivos/validaciones.ts';
import { validarIdCuerpo } from '../repuestos/validaciones.ts';
import {
  COLUMNAS_RITMO,
  JOIN_RITMO,
  SQL_ATRASADO,
  SQL_ATRASO_POR_USO,
  SQL_DIAS_SIN_LECTURA,
  SQL_ULTIMA_LECTURA,
  ritmoDeMedidor,
} from './consultas.ts';
import { bloquearMedidor, registrarLectura, validarValorMedidor } from './lecturas.ts';

/**
 * Etapa LE1, sección 3: la ronda de lecturas (D-030). Una lista con todos los medidores para
 * cargarlos de una vez, y el aviso en el momento cuando una lectura deja una tarea próxima o vencida.
 */

/** Como mucho, 200 lecturas por ronda (3.2). */
export const MAXIMO_LECTURAS_RONDA = 200;

export interface TareaDeMedidor {
  tarea_id: number;
  accion: string;
  plan: { id: number; nombre: string };
  estado: string;
  proximo_uso: number | null;
  faltan_uso: number | null;
}

export interface FiltrosRonda {
  plantaId: number | null;
  sectorId: number | null;
  maquinaId: number | null;
  soloAtrasados: boolean;
}

function invalido(mensaje: string, detalles?: Record<string, unknown>): ErrorNegocio {
  return new ErrorNegocio(422, 'DATOS_INVALIDOS', mensaje, detalles);
}

const numeroONulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Las tareas que usan cada medidor (3.1): las activas, con el estado y el uso de
 * v_plan_tareas_estado, sin las INACTIVA. Por plan y por orden de la tarea.
 */
export async function tareasDeMedidores(
  db: pg.Pool | pg.PoolClient,
  medidorIds: number[]
): Promise<Map<number, TareaDeMedidor[]>> {
  const porMedidor = new Map<number, TareaDeMedidor[]>();
  if (medidorIds.length === 0) return porMedidor;
  const r = await db.query(
    `SELECT v.id, v.medidor_id, v.accion, v.estado, v.proximo_uso, v.faltan_uso,
            p.id AS plan_id, p.nombre AS plan_nombre
     FROM v_plan_tareas_estado v
     JOIN planes_mantenimiento p ON p.id = v.plan_id
     WHERE v.medidor_id = ANY($1) AND v.activo AND v.estado <> 'INACTIVA'
     ORDER BY p.nombre ASC, p.id ASC, v.orden ASC, v.id ASC`,
    [medidorIds]
  );
  for (const x of r.rows) {
    const medidorId = Number(x.medidor_id);
    if (!porMedidor.has(medidorId)) porMedidor.set(medidorId, []);
    porMedidor.get(medidorId)!.push({
      tarea_id: Number(x.id),
      accion: x.accion,
      plan: { id: Number(x.plan_id), nombre: x.plan_nombre },
      estado: x.estado,
      proximo_uso: numeroONulo(x.proximo_uso),
      faltan_uso: numeroONulo(x.faltan_uso),
    });
  }
  return porMedidor;
}

/**
 * 3.1 GET /api/medidores/ronda: los medidores activos de máquinas activas, en el orden de una
 * recorrida (sector, máquina y medidor).
 */
export async function listarRonda(db: pg.Pool, f: FiltrosRonda) {
  const params: unknown[] = [];
  const cond: string[] = ['md.activo', 'm.activo'];
  if (f.plantaId !== null) {
    params.push(f.plantaId);
    cond.push(`s.planta_id = $${params.length}`);
  }
  if (f.sectorId !== null) {
    params.push(f.sectorId);
    cond.push(`m.sector_id = $${params.length}`);
  }
  if (f.maquinaId !== null) {
    params.push(f.maquinaId);
    cond.push(`m.id = $${params.length}`);
  }
  const res = await db.query(
    `SELECT * FROM (
       SELECT md.id, md.nombre, md.unidad, md.lectura_cada_dias,
              m.id AS maquina_id, m.codigo AS maquina_codigo, m.nombre AS maquina_nombre,
              s.id AS sector_id, s.nombre AS sector_nombre,
              ul.valor AS ultima_valor, ul.registrada_en AS ultima_en,
              ${SQL_DIAS_SIN_LECTURA} AS dias_sin_lectura,
              ${COLUMNAS_RITMO},
              ${SQL_ATRASADO} AS atraso_por_dias,
              ${SQL_ATRASO_POR_USO} AS atraso_por_uso
       FROM medidores md
       JOIN maquinas m ON m.id = md.maquina_id
       JOIN sectores s ON s.id = m.sector_id
       ${SQL_ULTIMA_LECTURA}
       ${JOIN_RITMO}
       WHERE ${cond.join(' AND ')}
     ) x
     ${f.soloAtrasados ? 'WHERE x.atraso_por_dias OR x.atraso_por_uso' : ''}
     ORDER BY x.sector_nombre ASC, x.sector_id ASC, x.maquina_codigo ASC NULLS LAST, x.maquina_id ASC, x.nombre ASC, x.id ASC`,
    params
  );

  const tareas = await tareasDeMedidores(db, res.rows.map((r) => Number(r.id)));
  return res.rows.map((r) => ({
    id: Number(r.id),
    nombre: r.nombre,
    unidad: r.unidad,
    lectura_cada_dias: numeroONulo(r.lectura_cada_dias),
    maquina: { id: Number(r.maquina_id), codigo: r.maquina_codigo, nombre: r.maquina_nombre },
    sector: { id: Number(r.sector_id), nombre: r.sector_nombre },
    ultima: r.ultima_en === null ? null : { valor: Number(r.ultima_valor), registrada_en: r.ultima_en },
    dias_sin_lectura: Number(r.dias_sin_lectura),
    // HE1, 4: atrasado por días o por uso
    atrasado: Boolean(r.atraso_por_dias) || Boolean(r.atraso_por_uso),
    // HE1, 2
    ...ritmoDeMedidor(r),
    atraso_por_dias: Boolean(r.atraso_por_dias),
    atraso_por_uso: Boolean(r.atraso_por_uso),
    tareas: tareas.get(Number(r.id)) ?? [],
  }));
}

/** Lo que dejó el aviso en el momento. */
export interface ResultadoAviso {
  generadas: Array<{ plan_id: number; intervencion_id: number }>;
  avisos: number;
}

/**
 * 3.3 El aviso en el momento, después de guardar y fuera de las transacciones de las lecturas:
 * los planes afectados, igual que en la revisión diaria. Cada uno en su transacción, con el
 * usuario del sistema. Si un plan falla, la lectura ya quedó guardada: el error va al log y la
 * revisión diaria lo retoma. Nunca tira un error.
 */
export async function avisarAlLeer(medidorIds: number[]): Promise<ResultadoAviso> {
  const resultado: ResultadoAviso = { generadas: [], avisos: 0 };
  if (medidorIds.length === 0) return resultado;

  let planIds: number[];
  let sistema: UsuarioVisibilidad;
  try {
    // Los planes activos, de máquinas activas, con alguna tarea activa que use un medidor que
    // se leyó bien, y con alguna tarea vencida o próxima
    const r = await pool.query(
      `SELECT p.id
       FROM planes_mantenimiento p
       JOIN maquinas m ON m.id = p.maquina_id
       WHERE p.activo AND m.activo
         AND EXISTS (
           SELECT 1 FROM plan_tareas t
           WHERE t.plan_id = p.id AND t.activo AND t.medidor_id = ANY($1)
         )
         AND EXISTS (
           SELECT 1 FROM v_plan_tareas_estado v
           WHERE v.plan_id = p.id AND v.estado IN ('VENCIDA', 'PROXIMA')
         )
       ORDER BY p.id`,
      [medidorIds]
    );
    planIds = r.rows.map((x) => Number(x.id));
    if (planIds.length === 0) return resultado;
    sistema = { id: await usuarioSistema(pool), permisos: {}, sectores: [] };
  } catch (err) {
    console.error('Error al buscar los planes para avisar al guardar lecturas:', err);
    return resultado;
  }

  for (const planId of planIds) {
    try {
      const r = await conTransaccion((client) => procesarPlan(client, planId, sistema));
      if (r.intervencionId !== null) resultado.generadas.push({ plan_id: planId, intervencion_id: r.intervencionId });
      resultado.avisos += r.avisos;
    } catch (err) {
      console.error(`Error al avisar el plan ${planId} al guardar lecturas:`, err);
    }
  }
  return resultado;
}

/** Una lectura de la ronda, ya validada. */
interface LecturaRonda {
  medidor_id: number;
  valor: number;
  observacion: string | null;
}

/**
 * 3.2 El cuerpo de POST /api/medidores/ronda. Si algo está mal, 422 y no se guarda nada: también
 * un elemento que no es un objeto o un medidor_id que no es un id.
 */
export function validarCuerpoRonda(body: Record<string, unknown>): LecturaRonda[] {
  const lista = body.lecturas;
  if (!Array.isArray(lista)) throw invalido('El campo lecturas debe ser una lista');
  if (lista.length === 0 || lista.length > MAXIMO_LECTURAS_RONDA) {
    throw invalido(`El campo lecturas debe tener de 1 a ${MAXIMO_LECTURAS_RONDA} lecturas`);
  }

  const vistos = new Set<number>();
  return lista.map((item, indice) => {
    try {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw invalido('Cada lectura debe ser un objeto');
      }
      const x = item as Record<string, unknown>;
      const medidorId = validarIdCuerpo(x.medidor_id, 'DATOS_INVALIDOS', 'medidor_id');
      if (vistos.has(medidorId)) throw invalido('El mismo medidor aparece dos veces');
      vistos.add(medidorId);
      return {
        medidor_id: medidorId,
        valor: validarValorMedidor(x.valor, 'valor'),
        observacion: textoOpcional(x.observacion, 'observacion', 200),
      };
    } catch (err) {
      if (err instanceof ErrorNegocio) {
        throw invalido(`Lectura ${indice + 1}: ${err.mensaje}`, { indice });
      }
      throw err;
    }
  });
}

export type ResultadoLectura =
  | { medidor_id: number; ok: true; lectura_id: number; tareas: TareaDeMedidor[] }
  | { medidor_id: number; ok: false; codigo: string; error: string };

/**
 * 3.2 Guarda la ronda: cada lectura en su propia transacción, como POST /:id/lecturas. Una que
 * falla no frena a las demás. Después, el aviso en el momento, y recién ahí se leen las tareas.
 */
export async function guardarRonda(lecturas: LecturaRonda[], usuarioId: number) {
  const guardadas = new Map<number, number>();
  const errores = new Map<number, { codigo: string; error: string }>();

  for (const l of lecturas) {
    try {
      const lecturaId = await conTransaccion(async (client) =>
        registrarLectura(client, {
          medidor: await bloquearMedidor(client, l.medidor_id),
          valor: l.valor,
          usuarioId,
          origen: 'MANUAL',
          observacion: l.observacion,
        })
      );
      guardadas.set(l.medidor_id, lecturaId);
    } catch (err) {
      if (err instanceof ErrorNegocio) {
        errores.set(l.medidor_id, { codigo: err.codigo, error: err.mensaje });
      } else {
        console.error(`Error al guardar la lectura del medidor ${l.medidor_id} en la ronda:`, err);
        errores.set(l.medidor_id, { codigo: 'ERROR_INTERNO', error: 'No se pudo guardar la lectura' });
      }
    }
  }

  const medidoresLeidos = [...guardadas.keys()];
  const aviso = await avisarAlLeer(medidoresLeidos);
  const tareas = await tareasDeMedidores(pool, medidoresLeidos);

  const resultados: ResultadoLectura[] = lecturas.map((l) => {
    const lecturaId = guardadas.get(l.medidor_id);
    if (lecturaId !== undefined) {
      return { medidor_id: l.medidor_id, ok: true, lectura_id: lecturaId, tareas: tareas.get(l.medidor_id) ?? [] };
    }
    const e = errores.get(l.medidor_id)!;
    return { medidor_id: l.medidor_id, ok: false, codigo: e.codigo, error: e.error };
  });

  return { resultados, generadas: aviso.generadas, avisos: aviso.avisos };
}
