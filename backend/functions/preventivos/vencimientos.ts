import pg from 'pg';
import { pool } from '../db.ts';
import { ErrorNegocio } from '../intervenciones/errores.ts';
import { conTransaccion } from '../intervenciones/transaccion.ts';
import { encolarEnvios, usuariosConPermiso } from '../intervenciones/notificaciones.ts';
import { UsuarioVisibilidad } from '../intervenciones/visibilidad.ts';
import { bloquearPlan } from './comun.ts';
import { generarDesdePlan } from './generar.ts';
import { SQL_ATRASADO, SQL_DIAS_SIN_LECTURA, SQL_ULTIMA_LECTURA } from '../medidores/consultas.ts';

/**
 * Etapa PV5, sección 3: la revisión diaria de las tareas preventivas (D-025). Genera la
 * intervención de los planes con generación automática y avisa una vez por vencimiento.
 */

export const TIPO_AVISO_VENCIMIENTO = 'PREVENTIVO_VENCIMIENTO';
/** LE1, 3.4 */
export const TIPO_AVISO_LECTURA_ATRASADA = 'LECTURA_ATRASADA';

export interface ResultadoVencimientos {
  revisado: boolean;
  planes?: number;
  generadas?: Array<{ plan_id: number; intervencion_id: number }>;
  avisos?: number;
  errores?: Array<{ plan_id: number; codigo: string }>;
  /** LE1, 3.4: cuántos medidores se avisaron por lecturas atrasadas. */
  lecturas_atrasadas?: number;
}

/** Una tarea vencida o próxima, como se lee de la vista antes de generar. */
interface TareaParaAvisar {
  id: number;
  accion: string;
  estado: 'VENCIDA' | 'PROXIMA';
  ciclo: string;
}

/** Lo que dejó un plan: la intervención generada y los avisos creados. */
export interface ResultadoPlan {
  intervencionId: number | null;
  avisos: number;
}

/** El usuario "Sistema" (2.1), autor de lo automático. */
export async function usuarioSistema(db: pg.Pool | pg.PoolClient): Promise<number> {
  const r = await db.query('SELECT id FROM usuarios WHERE es_sistema');
  if (r.rows.length === 0) {
    throw new Error('Falta el usuario del sistema: aplicar la migración 019');
  }
  return Number(r.rows[0].id);
}

/**
 * El vencimiento de la tarea (2.3): `F:<proxima_fecha>` si vence por fecha, `U:<proximo_uso>`
 * si vence por uso, unidos con `|`. Cuando se hace la tarea, cambia.
 */
export function cicloDeTarea(proximaFecha: string | null, proximoUso: string | null): string {
  const partes: string[] = [];
  if (proximaFecha !== null) partes.push(`F:${proximaFecha}`);
  if (proximoUso !== null) partes.push(`U:${proximoUso}`);
  return partes.join('|');
}

/** "2 tareas vencidas (A, B)", "1 próxima (C)": `primera` lleva la palabra "tarea". */
function textoGrupo(tareas: TareaParaAvisar[], singular: string, plural: string, conTarea: boolean): string {
  const n = tareas.length;
  const palabra = conTarea ? (n === 1 ? 'tarea ' : 'tareas ') : '';
  const estado = n === 1 ? singular : plural;
  return `${n} ${palabra}${estado} (${tareas.map((t) => t.accion).join(', ')})`;
}

/**
 * "PIN-01 · Cámara de pintura: 2 tareas vencidas (Cambiar aceite, Revisar filtro) y 1 próxima
 * (Engrasar)." Con una intervención generada, suma "Se generó la intervención N.º 14338.".
 */
export function mensajeAviso(
  maquina: { codigo: string | null; nombre: string },
  tareas: TareaParaAvisar[],
  intervencionId: number | null
): string {
  const vencidas = tareas.filter((t) => t.estado === 'VENCIDA');
  const proximas = tareas.filter((t) => t.estado === 'PROXIMA');
  const grupos: string[] = [];
  if (vencidas.length > 0) grupos.push(textoGrupo(vencidas, 'vencida', 'vencidas', true));
  if (proximas.length > 0) grupos.push(textoGrupo(proximas, 'próxima', 'próximas', vencidas.length === 0));
  const nombreMaquina = maquina.codigo ? `${maquina.codigo} · ${maquina.nombre}` : maquina.nombre;
  let texto = `${nombreMaquina}: ${grupos.join(' y ')}.`;
  if (intervencionId !== null) texto += ` Se generó la intervención N.º ${intervencionId}.`;
  return texto;
}

/**
 * Los destinatarios (D-025, punto 3): el responsable del plan, si está activo; si no, los
 * usuarios con PLANES_GESTIONAR que alcanzan el sector de la máquina. Nunca el del sistema.
 */
async function destinatarios(
  client: pg.PoolClient,
  responsableId: number | null,
  sectorId: number,
  sistemaId: number
): Promise<number[]> {
  if (responsableId !== null) {
    const r = await client.query('SELECT activo, es_sistema FROM usuarios WHERE id = $1', [responsableId]);
    if (r.rows.length > 0 && r.rows[0].activo && !r.rows[0].es_sistema) {
      return [responsableId];
    }
  }
  const conPermiso = await usuariosConPermiso(client, 'PLANES_GESTIONAR');
  return conPermiso
    .filter((u) => u.usuario_id !== sistemaId)
    .filter((u) => u.alcance === 'TODAS' || u.sectores.includes(sectorId))
    .map((u) => u.usuario_id)
    .sort((a, b) => a - b);
}

/**
 * Un plan, dentro de su propia transacción (3.2). También lo usa el aviso en el momento, al
 * guardar una lectura (LE1, 3.3).
 */
export async function procesarPlan(client: pg.PoolClient, planId: number, sistema: UsuarioVisibilidad): Promise<ResultadoPlan> {
  // Los bloqueos, en el orden de generar: la máquina y el plan
  const resLookup = await client.query('SELECT maquina_id FROM planes_mantenimiento WHERE id = $1', [planId]);
  if (resLookup.rows.length === 0) return { intervencionId: null, avisos: 0 };
  const resM = await client.query(
    `SELECT m.id, m.codigo, m.nombre, m.sector_id, m.activo, COALESCE(c.prioridad_alta, FALSE) AS prioridad_alta
     FROM maquinas m
     LEFT JOIN criticidades c ON c.id = m.criticidad_id
     WHERE m.id = $1
     FOR UPDATE OF m`,
    [resLookup.rows[0].maquina_id]
  );
  const maquina = resM.rows[0];
  const plan = await bloquearPlan(client, planId, null);
  // Pudo cambiar entre la lista y el bloqueo
  if (!plan.activo || !maquina.activo) return { intervencionId: null, avisos: 0 };

  const resAuto = await client.query('SELECT generacion_automatica FROM planes_mantenimiento WHERE id = $1', [planId]);
  const automatica = Boolean(resAuto.rows[0].generacion_automatica);

  // Las tareas vencidas y próximas, antes de generar: el aviso también lleva las que se generan
  const resT = await client.query(
    `SELECT id, accion, estado,
            CASE WHEN primera_fecha IS NULL THEN NULL ELSE to_char(proxima_fecha, 'YYYY-MM-DD') END AS proxima_fecha,
            CASE WHEN medidor_id IS NULL THEN NULL ELSE proximo_uso::text END AS proximo_uso
     FROM v_plan_tareas_estado
     WHERE plan_id = $1 AND estado IN ('VENCIDA', 'PROXIMA')
     ORDER BY orden, id`,
    [planId]
  );
  const tareas: TareaParaAvisar[] = resT.rows.map((r) => ({
    id: Number(r.id),
    accion: r.accion,
    estado: r.estado,
    ciclo: cicloDeTarea(r.proxima_fecha, r.proximo_uso),
  }));
  if (tareas.length === 0) return { intervencionId: null, avisos: 0 };

  // 1. Generación automática, igual que el botón "Generar"
  let intervencionId: number | null = null;
  if (automatica) {
    try {
      const generada = await generarDesdePlan(client, planId, sistema, null, null);
      intervencionId = generada.intervencion.id;
    } catch (err) {
      if (!(err instanceof ErrorNegocio && err.codigo === 'SIN_TAREAS_PARA_GENERAR')) throw err;
    }
  }

  // 2. Avisos: solo las tareas cuyo vencimiento todavía no se avisó
  const nuevas: TareaParaAvisar[] = [];
  for (const t of tareas) {
    const r = await client.query(
      `INSERT INTO avisos_vencimiento (plan_tarea_id, estado, ciclo)
       VALUES ($1, $2, $3)
       ON CONFLICT (plan_tarea_id, estado, ciclo) DO NOTHING
       RETURNING id`,
      [t.id, t.estado, t.ciclo]
    );
    if (r.rows.length > 0) nuevas.push(t);
  }
  if (nuevas.length === 0) return { intervencionId, avisos: 0 };

  const para = await destinatarios(client, plan.responsable_usuario_id, plan.sector_id, sistema.id);
  if (para.length === 0) return { intervencionId, avisos: 0 };

  const prioridad = nuevas.some((t) => t.estado === 'VENCIDA') && Boolean(maquina.prioridad_alta) ? 'ALTA' : 'NORMAL';
  const titulo = `Preventivo: ${plan.nombre}`;
  const mensaje = mensajeAviso({ codigo: maquina.codigo, nombre: maquina.nombre }, nuevas, intervencionId);
  const resN = await client.query(
    `INSERT INTO notificaciones (
       usuario_id, tipo_evento, prioridad, titulo, mensaje, intervencion_id, maquina_id, generada_por_usuario_id, creada_en
     )
     SELECT u_id, $2, $3, $4, $5, NULL, $6, $7, NOW()
     FROM UNNEST($1::bigint[]) AS t(u_id)
     RETURNING id`,
    [para, TIPO_AVISO_VENCIMIENTO, prioridad, titulo, mensaje, plan.maquina_id, sistema.id]
  );
  await encolarEnvios(client, resN.rows.map((r) => Number(r.id)));
  return { intervencionId, avisos: resN.rows.length };
}

/** Un medidor atrasado, ya bloqueado y controlado. */
interface MedidorAtrasado {
  id: number;
  nombre: string;
  maquina_id: number;
  maquina_codigo: string | null;
  maquina_nombre: string;
  dias: number;
  cada: number;
}

/** "COM-01 · Horómetro: 8 días sin lectura (se lee cada 7)". */
export function lineaLecturaAtrasada(m: {
  nombre: string;
  maquina_codigo: string | null;
  maquina_nombre: string;
  dias: number;
  cada: number;
}): string {
  const maquina = m.maquina_codigo ? m.maquina_codigo : m.maquina_nombre;
  const dias = m.dias === 1 ? '1 día' : `${m.dias} días`;
  return `${maquina} · ${m.nombre}: ${dias} sin lectura (se lee cada ${m.cada})`;
}

/** Los medidores atrasados y sin avisar (LE1, 3.4), de entre `ids` si se pasa. */
async function medidoresAtrasadosSinAvisar(client: pg.PoolClient, ids: number[] | null): Promise<MedidorAtrasado[]> {
  const r = await client.query(
    `SELECT md.id, md.nombre, md.lectura_cada_dias, md.maquina_id,
            m.codigo AS maquina_codigo, m.nombre AS maquina_nombre,
            ${SQL_DIAS_SIN_LECTURA} AS dias
     FROM medidores md
     JOIN maquinas m ON m.id = md.maquina_id
     ${SQL_ULTIMA_LECTURA}
     WHERE md.atraso_avisado_en IS NULL
       AND ${SQL_ATRASADO}
       AND ($1::bigint[] IS NULL OR md.id = ANY($1::bigint[]))
     ORDER BY m.codigo ASC NULLS LAST, m.nombre ASC, md.nombre ASC, md.id ASC`,
    [ids]
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    nombre: x.nombre,
    maquina_id: Number(x.maquina_id),
    maquina_codigo: x.maquina_codigo,
    maquina_nombre: x.maquina_nombre,
    dias: Number(x.dias),
    cada: Number(x.lectura_cada_dias),
  }));
}

/**
 * LE1, 3.4: avisa las lecturas atrasadas, una vez por atraso. Va en una transacción, después de
 * los planes. Devuelve cuántos medidores se avisaron.
 */
async function avisarLecturasAtrasadas(client: pg.PoolClient, sistemaId: number): Promise<number> {
  // 1. Los candidatos, sin bloquear
  const candidatos = await medidoresAtrasadosSinAvisar(client, null);
  if (candidatos.length === 0) return 0;

  // Los bloqueos, en el orden de siempre: las máquinas FOR SHARE y después los medidores FOR UPDATE
  const maquinaIds = [...new Set(candidatos.map((m) => m.maquina_id))].sort((a, b) => a - b);
  await client.query('SELECT id FROM maquinas WHERE id = ANY($1) ORDER BY id FOR SHARE', [maquinaIds]);
  const medidorIds = candidatos.map((m) => m.id).sort((a, b) => a - b);
  await client.query('SELECT id FROM medidores WHERE id = ANY($1) ORDER BY id FOR UPDATE', [medidorIds]);

  // 2. Se vuelve a controlar con todo bloqueado: si otra revisión ya los avisó, no queda ninguno
  const atrasados = await medidoresAtrasadosSinAvisar(client, medidorIds);
  if (atrasados.length === 0) return 0;

  // 3. Los destinatarios de cada medidor: los de cada plan activo con tareas activas que lo usan
  const porUsuario = new Map<number, MedidorAtrasado[]>();
  for (const medidor of atrasados) {
    const planes = await client.query(
      `SELECT DISTINCT p.id, p.responsable_usuario_id, m.sector_id
       FROM plan_tareas t
       JOIN planes_mantenimiento p ON p.id = t.plan_id
       JOIN maquinas m ON m.id = p.maquina_id
       WHERE t.medidor_id = $1 AND t.activo AND p.activo
       ORDER BY p.id`,
      [medidor.id]
    );
    const para = new Set<number>();
    for (const p of planes.rows) {
      const responsable = p.responsable_usuario_id === null ? null : Number(p.responsable_usuario_id);
      for (const u of await destinatarios(client, responsable, Number(p.sector_id), sistemaId)) para.add(u);
    }
    for (const u of para) {
      if (!porUsuario.has(u)) porUsuario.set(u, []);
      porUsuario.get(u)!.push(medidor);
    }
  }

  // 4. Un aviso por destinatario, con todos sus medidores atrasados juntos
  const notificacionIds: number[] = [];
  const avisados = new Set<number>();
  for (const [usuarioId, medidores] of [...porUsuario.entries()].sort((a, b) => a[0] - b[0])) {
    const mensaje = medidores.map(lineaLecturaAtrasada).join('\n');
    const maquinaId = medidores.length === 1 ? medidores[0].maquina_id : null;
    const r = await client.query(
      `INSERT INTO notificaciones (
         usuario_id, tipo_evento, prioridad, titulo, mensaje, intervencion_id, maquina_id, generada_por_usuario_id, creada_en
       ) VALUES ($1, $2, 'NORMAL', 'Lecturas atrasadas', $3, NULL, $4, $5, NOW())
       RETURNING id`,
      [usuarioId, TIPO_AVISO_LECTURA_ATRASADA, mensaje, maquinaId, sistemaId]
    );
    notificacionIds.push(Number(r.rows[0].id));
    for (const m of medidores) avisados.add(m.id);
  }
  await encolarEnvios(client, notificacionIds);

  // 5. Marcados: no se vuelven a avisar hasta una lectura nueva o un cambio de lectura_cada_dias
  await client.query('UPDATE medidores SET atraso_avisado_en = NOW() WHERE id = ANY($1)', [atrasados.map((m) => m.id)]);
  return avisados.size;
}

/**
 * 3. Revisa los vencimientos. Sin `forzar`, una vez por día (3.1); con `forzar`, siempre:
 * igual no repite avisos (2.3) ni duplica intervenciones (los bloqueos de generar).
 */
export async function procesarVencimientos(opciones: { forzar?: boolean } = {}): Promise<ResultadoVencimientos> {
  // Sin forzar, una vez por día. Solo se lee: la fecha se marca al terminar (C3, 2). Si dos
  // programados arrancan a la vez, los dos revisan: los avisos no se repiten por el índice
  // único y la intervención no se duplica por los bloqueos de generar (PV5, 3.4).
  if (!opciones.forzar) {
    const r = await pool.query(
      `SELECT vencimientos_revisados_el IS NOT DISTINCT FROM hoy_instalacion() AS hecho
       FROM configuracion_sistema WHERE id = 1`
    );
    if (r.rows.length === 0 || r.rows[0].hecho) return { revisado: false };
  }

  const sistema: UsuarioVisibilidad = { id: await usuarioSistema(pool), permisos: {}, sectores: [] };

  // Los planes activos de máquinas activas con alguna tarea vencida o próxima
  const resP = await pool.query(
    `SELECT p.id
     FROM planes_mantenimiento p
     JOIN maquinas m ON m.id = p.maquina_id
     WHERE p.activo AND m.activo
       AND EXISTS (
         SELECT 1 FROM v_plan_tareas_estado v
         WHERE v.plan_id = p.id AND v.estado IN ('VENCIDA', 'PROXIMA')
       )
     ORDER BY p.id`
  );

  const resultado = {
    revisado: true,
    planes: resP.rows.length,
    generadas: [] as Array<{ plan_id: number; intervencion_id: number }>,
    avisos: 0,
    errores: [] as Array<{ plan_id: number; codigo: string }>,
  };

  // Cada plan en su transacción: uno que falla no frena a los demás (D-025, punto 6)
  for (const fila of resP.rows) {
    const planId = Number(fila.id);
    try {
      const r = await conTransaccion((client) => procesarPlan(client, planId, sistema));
      if (r.intervencionId !== null) resultado.generadas.push({ plan_id: planId, intervencion_id: r.intervencionId });
      resultado.avisos += r.avisos;
    } catch (err) {
      if (!(err instanceof ErrorNegocio)) {
        console.error(`Error al procesar los vencimientos del plan ${planId}:`, err);
      }
      resultado.errores.push({ plan_id: planId, codigo: err instanceof ErrorNegocio ? err.codigo : 'ERROR_INTERNO' });
    }
  }

  // LE1, 3.4: las lecturas atrasadas, en su transacción. Si falla, los planes ya quedaron
  // procesados y el día se marca igual: los medidores siguen sin marcar y la próxima revisión
  // los vuelve a intentar.
  let lecturasAtrasadas = 0;
  try {
    lecturasAtrasadas = await conTransaccion((client) => avisarLecturasAtrasadas(client, sistema.id));
  } catch (err) {
    console.error('Error al avisar las lecturas atrasadas:', err);
  }

  // Recorridos todos los planes, aunque alguno haya dado error, el día queda revisado.
  // Si el proceso se cortó antes, la fecha no se marca y el próximo programado vuelve a revisar.
  if (!opciones.forzar) {
    await pool.query('UPDATE configuracion_sistema SET vencimientos_revisados_el = hoy_instalacion() WHERE id = 1');
  }

  return { ...resultado, lecturas_atrasadas: lecturasAtrasadas };
}
