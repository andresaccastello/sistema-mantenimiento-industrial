import pg from 'pg';
import { AlcancePermiso } from './permisos.ts';

export interface UsuarioConPermiso {
  usuario_id: number;
  alcance: AlcancePermiso;
  sectores: number[];
}

export interface IntervencionDatosNotif {
  id: number;
  creado_por_usuario_id: number;
  responsable_usuario_id: number | null;
  descripcion: string;
  maquina_id: number;
  maquina_nombre: string;
  maquina_codigo: string;
  sector_id: number;
  sector_nombre: string;
  tiene_periodo_abierto: boolean;
}

export interface CandidatoNotificacion {
  usuarioId: number;
  titulo: string;
  mensaje: string;
  prioridad: 'ALTA' | 'NORMAL';
}

/**
 * 4.4 Destinatarios por permiso efectivo, en SQL (D-38)
 * Una sola consulta que devuelve { usuario_id, alcance, sectores[] } de los
 * usuarios activos que tienen el permiso efectivo.
 */
export async function usuariosConPermiso(
  client: pg.PoolClient | pg.Pool,
  codigo: string
): Promise<UsuarioConPermiso[]> {
  const query = `
    SELECT
      u.id AS usuario_id,
      CASE 
        WHEN exc.efecto = 'CONCEDER' THEN COALESCE(exc.alcance, 'TODAS')
        ELSE COALESCE(pp.alcance, 'TODAS')
      END AS alcance,
      COALESCE(
        (SELECT array_agg(us.sector_id) FROM usuario_sector us WHERE us.usuario_id = u.id),
        ARRAY[]::integer[]
      ) AS sectores
    FROM usuarios u
    JOIN permisos perm ON perm.codigo = $1
    LEFT JOIN perfil_permiso pp ON pp.perfil_id = u.perfil_id AND pp.permiso_id = perm.id
    LEFT JOIN usuario_permiso exc ON exc.usuario_id = u.id AND exc.permiso_id = perm.id
    WHERE u.activo = TRUE
      AND (
        exc.efecto = 'CONCEDER'
        OR (pp.perfil_id IS NOT NULL AND (exc.efecto IS NULL OR exc.efecto <> 'DENEGAR'))
      )
  `;

  const res = await client.query(query, [codigo]);
  return res.rows.map((r: any) => ({
    usuario_id: Number(r.usuario_id),
    alcance: r.alcance as AlcancePermiso,
    sectores: (r.sectores || []).map((s: any) => Number(s)),
  }));
}

/**
 * Determina si un usuario puede ver la intervención con su permiso INTERVENCIONES_VER
 * (Section 4.3 regla 3, D-38 c).
 */
function usuarioPuedeVerIntervencion(
  uVer: UsuarioConPermiso,
  intervencion: IntervencionDatosNotif,
  nuevoResponsableId?: number | null,
  responsableAnteriorId?: number | null
): boolean {
  if (uVer.alcance === 'TODAS') {
    return true;
  }
  if (uVer.alcance === 'SECTORES') {
    return uVer.sectores.includes(Number(intervencion.sector_id));
  }
  if (uVer.alcance === 'PROPIAS') {
    return (
      uVer.usuario_id === Number(intervencion.creado_por_usuario_id) ||
      uVer.usuario_id === Number(intervencion.responsable_usuario_id) ||
      (nuevoResponsableId != null && uVer.usuario_id === Number(nuevoResponsableId)) ||
      (responsableAnteriorId != null && uVer.usuario_id === Number(responsableAnteriorId))
    );
  }
  return false;
}

export const REGLAS_EVENTOS_NOTIFICACION = [
  'FALLA_REGISTRADA',
  'INTERVENCION_ASIGNADA',
  'INTERVENCION_REASIGNADA',
  'INTERVENCION_DESASIGNADA',
  'INTERVENCION_FINALIZADA',
  'INTERVENCION_CANCELADA',
  'INTERVENCION_REABIERTA',
  'DETENCION_PENDIENTE_CONFIRMACION',
] as const;

export type TipoEventoNotificable = (typeof REGLAS_EVENTOS_NOTIFICACION)[number];

/**
 * 4.1 y 4.2 Generación de notificaciones y bandeja de salida
 */
export async function registrarNotificaciones(
  client: pg.PoolClient,
  eventos: Array<{ tipo: string; payload: any }>,
  opts?: { actorId?: number | null }
): Promise<void> {
  const actorId = opts?.actorId != null ? Number(opts.actorId) : null;

  // Filtrar solo eventos con reglas declaradas (D-39)
  const eventosNotificables = eventos.filter((ev) =>
    (REGLAS_EVENTOS_NOTIFICACION as readonly string[]).includes(ev.tipo)
  );

  if (eventosNotificables.length === 0) {
    return;
  }

  // Canales activos (para la bandeja de salida D-36)
  const resCanales = await client.query(
    'SELECT canal FROM notificacion_canales WHERE activo = TRUE'
  );
  const canalesActivos: string[] = resCanales.rows.map((r: any) => r.canal);

  // Mapa de usuarios activos con INTERVENCIONES_VER para regla de visibilidad (D-38 c)
  const usuariosVer = await usuariosConPermiso(client, 'INTERVENCIONES_VER');
  const mapaVer = new Map<number, UsuarioConPermiso>(
    usuariosVer.map((u) => [u.usuario_id, u])
  );

  // Cache de intervenciones consultadas
  const cacheIntervenciones = new Map<number, IntervencionDatosNotif>();

  // Colección para inserción en lote (Etapa 7.1)
  const notificacionesAInsertar: Array<{
    usuarioId: number;
    tipoEvento: string;
    prioridad: 'ALTA' | 'NORMAL';
    titulo: string;
    mensaje: string;
    intervencionId: number;
    maquinaId: number;
    actorId: number | null;
  }> = [];

  for (const ev of eventosNotificables) {
    const intervencionId = Number(ev.payload?.intervencionId);
    if (!intervencionId || isNaN(intervencionId)) {
      continue;
    }

    let intervencion = cacheIntervenciones.get(intervencionId);
    if (!intervencion) {
      const resInt = await client.query(
        `SELECT 
           i.id,
           i.creado_por_usuario_id,
           i.responsable_usuario_id,
           i.descripcion,
           m.id AS maquina_id,
           m.nombre AS maquina_nombre,
           m.codigo AS maquina_codigo,
           m.sector_id,
           s.nombre AS sector_nombre,
           EXISTS(
             SELECT 1 FROM intervencion_periodos_detencion ipd
             WHERE ipd.intervencion_id = i.id AND ipd.hasta IS NULL
           ) AS tiene_periodo_abierto
         FROM intervenciones i
         JOIN maquinas m ON m.id = i.maquina_id
         LEFT JOIN sectores s ON s.id = m.sector_id
         WHERE i.id = $1`,
        [intervencionId]
      );

      if (resInt.rows.length === 0) {
        continue;
      }

      const r = resInt.rows[0];
      intervencion = {
        id: Number(r.id),
        creado_por_usuario_id: Number(r.creado_por_usuario_id),
        responsable_usuario_id: r.responsable_usuario_id != null ? Number(r.responsable_usuario_id) : null,
        descripcion: r.descripcion || '',
        maquina_id: Number(r.maquina_id),
        maquina_nombre: r.maquina_nombre || '',
        maquina_codigo: r.maquina_codigo || '',
        sector_id: Number(r.sector_id),
        sector_nombre: r.sector_nombre || `Sector ${r.sector_id}`,
        tiene_periodo_abierto: Boolean(r.tiene_periodo_abierto),
      };
      cacheIntervenciones.set(intervencionId, intervencion);
    }

    const maquinaNombre = intervencion.maquina_nombre || intervencion.maquina_codigo;
    const sectorNombre = intervencion.sector_nombre;
    const descCorta = (intervencion.descripcion || '').trim().slice(0, 120);

    const candidatos: CandidatoNotificacion[] = [];
    let nuevoResponsableId: number | null = null;
    let responsableAnteriorId: number | null = null;

    if (ev.tipo === 'FALLA_REGISTRADA') {
      const prioridad: 'ALTA' | 'NORMAL' = intervencion.tiene_periodo_abierto ? 'ALTA' : 'NORMAL';
      const titulo = intervencion.tiene_periodo_abierto
        ? `Nueva falla en ${maquinaNombre} — máquina detenida`
        : `Nueva falla en ${maquinaNombre}`;
      const mensaje = `Sector: ${sectorNombre}. ${descCorta}`;

      const usuariosFallas = await usuariosConPermiso(client, 'NOTIFICACIONES_FALLAS_RECIBIR');
      for (const u of usuariosFallas) {
        let alcanza = false;
        if (u.alcance === 'TODAS') {
          alcanza = true;
        } else if (u.alcance === 'SECTORES') {
          alcanza = u.sectores.includes(intervencion.sector_id);
        } else if (u.alcance === 'PROPIAS') {
          alcanza =
            u.usuario_id === intervencion.creado_por_usuario_id ||
            u.usuario_id === intervencion.responsable_usuario_id;
        }

        if (alcanza) {
          candidatos.push({
            usuarioId: u.usuario_id,
            titulo,
            mensaje,
            prioridad,
          });
        }
      }
    } else if (ev.tipo === 'INTERVENCION_ASIGNADA') {
      nuevoResponsableId = ev.payload?.responsableId != null
        ? Number(ev.payload.responsableId)
        : intervencion.responsable_usuario_id;

      if (nuevoResponsableId) {
        candidatos.push({
          usuarioId: nuevoResponsableId,
          titulo: `Te asignaron una intervención en ${maquinaNombre}`,
          mensaje: `Sector: ${sectorNombre}. ${descCorta}`,
          prioridad: 'NORMAL',
        });
      }
    } else if (ev.tipo === 'INTERVENCION_REASIGNADA') {
      nuevoResponsableId = ev.payload?.responsableId != null
        ? Number(ev.payload.responsableId)
        : intervencion.responsable_usuario_id;
      responsableAnteriorId = ev.payload?.responsableAnteriorId != null
        ? Number(ev.payload.responsableAnteriorId)
        : null;

      const motivoTexto = ev.payload?.motivo ? ` Motivo: ${ev.payload.motivo}.` : '';

      if (nuevoResponsableId) {
        candidatos.push({
          usuarioId: nuevoResponsableId,
          titulo: `Te asignaron una intervención en ${maquinaNombre}`,
          mensaje: `Sector: ${sectorNombre}.${motivoTexto} ${descCorta}`,
          prioridad: 'NORMAL',
        });
      }

      if (responsableAnteriorId) {
        candidatos.push({
          usuarioId: responsableAnteriorId,
          titulo: `Te quitaron una intervención en ${maquinaNombre}`,
          mensaje: `Sector: ${sectorNombre}.${motivoTexto} ${descCorta}`,
          prioridad: 'NORMAL',
        });
      }
    } else if (ev.tipo === 'INTERVENCION_DESASIGNADA') {
      responsableAnteriorId = ev.payload?.responsableAnteriorId != null
        ? Number(ev.payload.responsableAnteriorId)
        : null;
      const motivoTexto = ev.payload?.motivo ? ` Motivo: ${ev.payload.motivo}.` : '';

      if (responsableAnteriorId) {
        candidatos.push({
          usuarioId: responsableAnteriorId,
          titulo: `Te quitaron una intervención en ${maquinaNombre}`,
          mensaje: `Sector: ${sectorNombre}.${motivoTexto} ${descCorta}`,
          prioridad: 'NORMAL',
        });
      }
    } else if (ev.tipo === 'INTERVENCION_FINALIZADA') {
      const destIds = [
        intervencion.creado_por_usuario_id,
        intervencion.responsable_usuario_id,
      ].filter((id): id is number => id != null);

      for (const uid of destIds) {
        candidatos.push({
          usuarioId: uid,
          titulo: `Se finalizó la intervención en ${maquinaNombre}`,
          mensaje: `Sector: ${sectorNombre}. ${descCorta}`,
          prioridad: 'NORMAL',
        });
      }
    } else if (ev.tipo === 'INTERVENCION_CANCELADA') {
      const destIds = [
        intervencion.creado_por_usuario_id,
        intervencion.responsable_usuario_id,
      ].filter((id): id is number => id != null);

      const motivoTexto = ev.payload?.motivo ? ` Motivo: ${ev.payload.motivo}.` : '';

      for (const uid of destIds) {
        candidatos.push({
          usuarioId: uid,
          titulo: `Se canceló la intervención en ${maquinaNombre}`,
          mensaje: `Sector: ${sectorNombre}.${motivoTexto} ${descCorta}`,
          prioridad: 'NORMAL',
        });
      }
    } else if (ev.tipo === 'INTERVENCION_REABIERTA') {
      const destIds = [
        intervencion.creado_por_usuario_id,
        intervencion.responsable_usuario_id,
      ].filter((id): id is number => id != null);

      const motivoTexto = ev.payload?.motivo ? ` Motivo: ${ev.payload.motivo}.` : '';

      for (const uid of destIds) {
        candidatos.push({
          usuarioId: uid,
          titulo: `Se reabrió la intervención en ${maquinaNombre}`,
          mensaje: `Sector: ${sectorNombre}.${motivoTexto} ${descCorta}`,
          prioridad: 'NORMAL',
        });
      }
    } else if (ev.tipo === 'DETENCION_PENDIENTE_CONFIRMACION') {
      const usuariosConf = await usuariosConPermiso(
        client,
        'INTERVENCIONES_CONFIRMAR_RECUPERACION'
      );
      for (const u of usuariosConf) {
        candidatos.push({
          usuarioId: u.usuario_id,
          titulo: `${maquinaNombre} sigue detenida: falta confirmar que funciona`,
          mensaje: `Sector: ${sectorNombre}. ${descCorta}`,
          prioridad: 'ALTA',
        });
      }
    }

    // Aplicar Reglas Generales de Filtrado (Sección 4.3, D-38)
    const procesadosEnEsteEvento = new Set<number>();

    for (const cand of candidatos) {
      // 1. Quitar al actor (D-38 a)
      if (actorId != null && cand.usuarioId === actorId) {
        continue;
      }

      // 4. Si un mismo usuario resulta destinatario dos veces del mismo evento, una sola notificación (D-38 d)
      if (procesadosEnEsteEvento.has(cand.usuarioId)) {
        continue;
      }

      // 2 y 3. Quitar inactivos y quien no pueda ver la intervención según su propio INTERVENCIONES_VER (D-38 b, c)
      // Visibilidad (D-38 c) se aplica a TODOS los eventos, incluida FALLA_REGISTRADA (Etapa 7.1)
      const uVer = mapaVer.get(cand.usuarioId);
      if (!uVer) {
        continue;
      }

      const puedeVer = usuarioPuedeVerIntervencion(
        uVer,
        intervencion,
        nuevoResponsableId,
        responsableAnteriorId
      );
      if (!puedeVer) {
        continue;
      }

      procesadosEnEsteEvento.add(cand.usuarioId);

      notificacionesAInsertar.push({
        usuarioId: cand.usuarioId,
        tipoEvento: ev.tipo,
        prioridad: cand.prioridad,
        titulo: cand.titulo,
        mensaje: cand.mensaje,
        intervencionId: intervencion.id,
        maquinaId: intervencion.maquina_id,
        actorId,
      });
    }
  }

  if (notificacionesAInsertar.length === 0) {
    return;
  }

  // Inserción en lote de todas las notificaciones con UN solo INSERT y RETURNING id (Etapa 7.1)
  const resIns = await client.query(
    `INSERT INTO notificaciones (
       usuario_id, tipo_evento, prioridad, titulo, mensaje,
       intervencion_id, maquina_id, generada_por_usuario_id, creada_en
     )
     SELECT 
       u_id, t_ev, prio, tit, msg, int_id, maq_id, gen_id, NOW()
     FROM UNNEST(
       $1::bigint[],
       $2::text[],
       $3::text[],
       $4::text[],
       $5::text[],
       $6::bigint[],
       $7::bigint[],
       $8::bigint[]
     ) AS t(u_id, t_ev, prio, tit, msg, int_id, maq_id, gen_id)
     RETURNING id`,
    [
      notificacionesAInsertar.map((n) => n.usuarioId),
      notificacionesAInsertar.map((n) => n.tipoEvento),
      notificacionesAInsertar.map((n) => n.prioridad),
      notificacionesAInsertar.map((n) => n.titulo),
      notificacionesAInsertar.map((n) => n.mensaje),
      notificacionesAInsertar.map((n) => n.intervencionId),
      notificacionesAInsertar.map((n) => n.maquinaId),
      notificacionesAInsertar.map((n) => n.actorId),
    ]
  );

  const insertedIds = resIns.rows.map((r: any) => Number(r.id));

  // Inserción en lote de envíos de canales activos con UN solo INSERT ... SELECT (Etapa 7.1)
  if (canalesActivos.length > 0 && insertedIds.length > 0) {
    await client.query(
      `INSERT INTO notificacion_envios (
         notificacion_id, canal, estado, intentos, creado_en
       )
       SELECT n.id, c.canal, 'PENDIENTE', 0, NOW()
       FROM UNNEST($1::bigint[]) AS n(id)
       CROSS JOIN notificacion_canales c
       WHERE c.activo = TRUE`,
      [insertedIds]
    );
  }
}
