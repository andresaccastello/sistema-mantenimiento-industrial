import { Hono } from 'hono';
import { pool } from '../db.ts';
import { jwtVerify, dbVerify, requireAlgunPermiso, requirePermission, getUserScope } from '../middleware.ts';
import { ErrorNegocio, responderError } from '../intervenciones/errores.ts';
import { conTransaccion } from '../intervenciones/transaccion.ts';
import { leerCuerpoObjeto, parseId } from '../validations.ts';
import { parseIdRuta, validarBooleano } from '../repuestos/validaciones.ts';
import { getUsuarioContext, sectoresDelAlcance, columnasPersona, persona } from '../preventivos/comun.ts';
import { textoObligatorio, textoOpcional } from '../preventivos/validaciones.ts';
import {
  COLUMNAS_RUTINA,
  FRECUENCIAS,
  FROM_RUTINA,
  Frecuencia,
  ORDEN_MAQUINA,
  alcanza,
  columnasRegistro,
  invalido,
  obtenerRutina,
  periodosEsperados,
  registroDeFila,
  rutinaDeFila,
  rutinaNoEncontrada,
  sectoresDePermiso,
  sinAlcance,
  traducirUnico,
} from './comun.ts';

/**
 * Etapa RT1, sección 2: la gestión de las rutinas de una máquina (2.1) y lo del operario (2.2).
 * El reporte (2.3) está en reporte.ts.
 */

// -------------------------------------------------------------
// 2.1 /api/maquinas/:id/rutinas
// -------------------------------------------------------------

export const maquinaRutinasApp = new Hono();

maquinaRutinasApp.use('/:id/rutinas', jwtVerify, dbVerify);

const CANTIDAD_RECIENTES = 7;

/** Con PLANES_GESTIONAR o con REPORTES_CONSULTAR, cada uno con su alcance. */
maquinaRutinasApp.get(
  '/:id/rutinas',
  requireAlgunPermiso(['PLANES_GESTIONAR', 'REPORTES_CONSULTAR']),
  async (c) => {
    try {
      const maquinaId = parseIdRuta(c.req.param('id'));
      if (maquinaId === null) throw new ErrorNegocio(404, 'MAQUINA_NO_ENCONTRADA', 'La máquina no existe');
      const incluirInactivas = c.req.query('incluir_inactivas') === 'true';

      const resM = await pool.query('SELECT sector_id FROM maquinas WHERE id = $1', [maquinaId]);
      if (resM.rows.length === 0) throw new ErrorNegocio(404, 'MAQUINA_NO_ENCONTRADA', 'La máquina no existe');
      const sectorId = Number(resM.rows[0].sector_id);
      const habilitado =
        (getUserScope(c, 'PLANES_GESTIONAR') !== null && alcanza(sectoresDePermiso(c, 'PLANES_GESTIONAR'), sectorId)) ||
        (getUserScope(c, 'REPORTES_CONSULTAR') !== null && alcanza(sectoresDePermiso(c, 'REPORTES_CONSULTAR'), sectorId));
      if (!habilitado) throw sinAlcance();

      const res = await pool.query(
        `SELECT ${COLUMNAS_RUTINA},
                ${columnasRegistro('ult')}
         ${FROM_RUTINA}
         LEFT JOIN LATERAL (
           SELECT * FROM rutina_registros x WHERE x.rutina_id = r.id ORDER BY x.periodo DESC, x.id DESC LIMIT 1
         ) rr ON TRUE
         LEFT JOIN usuarios ur ON ur.id = rr.usuario_id
         WHERE r.maquina_id = $1 ${incluirInactivas ? '' : 'AND r.activa'}
         ORDER BY r.activa DESC, r.descripcion, r.id`,
        [maquinaId]
      );

      const ids = res.rows.map((x) => Number(x.id));
      const desdeRecientes = (await pool.query(
        `SELECT to_char(hoy_instalacion() - 63, 'YYYY-MM-DD') AS d`
      )).rows[0].d as string;
      const periodos = await periodosEsperados(pool, ids, desdeRecientes, null);

      return c.json(
        res.rows.map((x) => {
          const ult = registroDeFila(x, 'ult');
          const propios = periodos.filter((p) => p.rutina_id === Number(x.id));
          return {
            ...rutinaDeFila(x),
            ultima: ult ? { periodo: x.ult_periodo, hecha_en: ult.hecha_en, usuario: ult.usuario } : null,
            recientes: propios.slice(-CANTIDAD_RECIENTES).map((p) => ({ periodo: p.periodo, estado: p.estado })),
          };
        })
      );
    } catch (error) {
      return responderError(c, error);
    }
  }
);

function validarFrecuencia(val: unknown): Frecuencia {
  if (typeof val !== 'string' || !(FRECUENCIAS as readonly string[]).includes(val)) {
    throw invalido('El campo frecuencia debe ser DIARIA o SEMANAL');
  }
  return val as Frecuencia;
}

maquinaRutinasApp.post('/:id/rutinas', requirePermission('PLANES_GESTIONAR'), async (c) => {
  try {
    const maquinaId = parseIdRuta(c.req.param('id'));
    if (maquinaId === null) throw new ErrorNegocio(404, 'MAQUINA_NO_ENCONTRADA', 'La máquina no existe');
    const leido = await leerCuerpoObjeto(c);
    if (!leido.ok) return leido.response;
    const b = leido.body;

    const descripcion = textoObligatorio(b.descripcion, 'descripcion', 1, 200);
    const frecuencia = validarFrecuencia(b.frecuencia);
    const incluyeSabado = b.incluye_sabado === undefined ? false : validarBooleano(b.incluye_sabado, 'incluye_sabado');
    if (frecuencia === 'SEMANAL' && incluyeSabado) {
      throw invalido('Una tarea semanal no lleva incluye_sabado');
    }
    const sectores = sectoresDelAlcance(c);
    const usuario = getUsuarioContext(c);

    const id = await conTransaccion(async (client) => {
      const resM = await client.query('SELECT sector_id, activo FROM maquinas WHERE id = $1 FOR SHARE', [maquinaId]);
      if (resM.rows.length === 0) throw new ErrorNegocio(404, 'MAQUINA_NO_ENCONTRADA', 'La máquina no existe');
      if (!alcanza(sectores, Number(resM.rows[0].sector_id))) throw sinAlcance();
      if (!resM.rows[0].activo) throw new ErrorNegocio(422, 'MAQUINA_INACTIVA', 'La máquina está inactiva');

      const res = await client.query(
        `INSERT INTO rutinas (maquina_id, descripcion, frecuencia, incluye_sabado, vigente_desde, creado_por_usuario_id)
         VALUES ($1, $2, $3, $4, hoy_instalacion(), $5) RETURNING id`,
        [maquinaId, descripcion, frecuencia, incluyeSabado, usuario.id]
      );
      return Number(res.rows[0].id);
    });

    return c.json(await obtenerRutina(pool, id), 201);
  } catch (error) {
    return responderError(c, traducirUnico(error));
  }
});

// -------------------------------------------------------------
// /api/rutinas
// -------------------------------------------------------------

export const rutinasApp = new Hono();

rutinasApp.use('*', jwtVerify, dbVerify);

const realiza = requirePermission('RUTINAS_REALIZAR');

/** 2.1 PATCH: descripción, sábado y baja o reactivación. La frecuencia no se cambia. */
rutinasApp.patch('/:id', requirePermission('PLANES_GESTIONAR'), async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (id === null) throw rutinaNoEncontrada();
    const leido = await leerCuerpoObjeto(c);
    if (!leido.ok) return leido.response;
    const b = leido.body;

    if ('frecuencia' in b) {
      throw invalido('La frecuencia no se cambia: dá de baja la tarea y creá otra');
    }
    const descripcion = 'descripcion' in b ? textoObligatorio(b.descripcion, 'descripcion', 1, 200) : undefined;
    const incluyeSabado = 'incluye_sabado' in b ? validarBooleano(b.incluye_sabado, 'incluye_sabado') : undefined;
    const activa = 'activa' in b ? validarBooleano(b.activa, 'activa') : undefined;
    if (descripcion === undefined && incluyeSabado === undefined && activa === undefined) {
      throw invalido('Indicá descripcion, incluye_sabado o activa');
    }
    const sectores = sectoresDelAlcance(c);

    await conTransaccion(async (client) => {
      const res = await client.query(
        `SELECT r.frecuencia, r.activa, m.sector_id
         FROM rutinas r JOIN maquinas m ON m.id = r.maquina_id
         WHERE r.id = $1
         FOR UPDATE OF r`,
        [id]
      );
      if (res.rows.length === 0) throw rutinaNoEncontrada();
      const actual = res.rows[0];
      if (!alcanza(sectores, Number(actual.sector_id))) throw rutinaNoEncontrada();
      if (actual.frecuencia === 'SEMANAL' && incluyeSabado === true) {
        throw invalido('Una tarea semanal no lleva incluye_sabado');
      }

      const sets: string[] = ['actualizado_en = NOW()'];
      const params: unknown[] = [id];
      if (descripcion !== undefined) {
        params.push(descripcion);
        sets.push(`descripcion = $${params.length}`);
      }
      if (incluyeSabado !== undefined) {
        params.push(incluyeSabado);
        sets.push(`incluye_sabado = $${params.length}`);
      }
      if (activa === false && actual.activa) {
        sets.push('activa = FALSE', 'baja_en = hoy_instalacion()');
      }
      if (activa === true && !actual.activa) {
        sets.push('activa = TRUE', 'baja_en = NULL', 'vigente_desde = hoy_instalacion()');
      }
      await client.query(`UPDATE rutinas SET ${sets.join(', ')} WHERE id = $1`, params);
    });

    return c.json(await obtenerRutina(pool, id));
  } catch (error) {
    return responderError(c, traducirUnico(error));
  }
});

/** 2.2 Las tareas de hoy, dentro del alcance de RUTINAS_REALIZAR. */
rutinasApp.get('/hoy', realiza, async (c) => {
  try {
    const rawMaquina = c.req.query('maquina_id');
    let maquinaId: number | null = null;
    if (rawMaquina !== undefined && rawMaquina.trim() !== '') {
      maquinaId = parseId(rawMaquina);
      if (maquinaId === null) throw invalido('El parámetro maquina_id debe ser un entero positivo');
    }
    const sectores = sectoresDePermiso(c, 'RUTINAS_REALIZAR');
    const sinSectores = sectores !== null && sectores.length === 0;
    const hoy = (await pool.query(`SELECT to_char(hoy_instalacion(), 'YYYY-MM-DD') AS hoy`)).rows[0].hoy as string;

    if (sinSectores) return c.json({ hoy, sin_sectores: true, rutinas: [] });

    const params: unknown[] = [];
    const cond = ['r.activa', 'm.activo', 'rutina_corresponde(r.frecuencia, r.incluye_sabado, hoy_instalacion())'];
    if (sectores !== null) {
      params.push(sectores);
      cond.push(`m.sector_id = ANY($${params.length}::bigint[])`);
    }
    if (maquinaId !== null) {
      params.push(maquinaId);
      cond.push(`m.id = $${params.length}`);
    }

    const res = await pool.query(
      `SELECT ${COLUMNAS_RUTINA},
              to_char(periodo_rutina(r.frecuencia, hoy_instalacion()), 'YYYY-MM-DD') AS periodo,
              ${columnasRegistro('reg')}
       ${FROM_RUTINA}
       LEFT JOIN rutina_registros rr
         ON rr.rutina_id = r.id AND rr.periodo = periodo_rutina(r.frecuencia, hoy_instalacion())
       LEFT JOIN usuarios ur ON ur.id = rr.usuario_id
       WHERE ${cond.join(' AND ')}
       ORDER BY (rr.id IS NOT NULL), ${ORDEN_MAQUINA}, r.descripcion, r.id`,
      params
    );

    return c.json({
      hoy,
      sin_sectores: false,
      rutinas: res.rows.map((x) => ({ ...rutinaDeFila(x), periodo: x.periodo, registro: registroDeFila(x, 'reg') })),
    });
  } catch (error) {
    return responderError(c, error);
  }
});

/** 2.2 Marcar hecha en el período actual. */
rutinasApp.post('/:id/hecha', realiza, async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (id === null) throw rutinaNoEncontrada();
    const leido = await leerCuerpoObjeto(c);
    if (!leido.ok) return leido.response;
    const nota = textoOpcional(leido.body.nota, 'nota', 500);
    const sectores = sectoresDePermiso(c, 'RUTINAS_REALIZAR');
    const usuario = getUsuarioContext(c);

    const registroId = await conTransaccion(async (client) => {
      const res = await client.query(
        `SELECT r.activa, m.activo AS maquina_activa, m.sector_id,
                rutina_corresponde(r.frecuencia, r.incluye_sabado, hoy_instalacion()) AS corresponde,
                periodo_rutina(r.frecuencia, hoy_instalacion()) AS periodo
         FROM rutinas r JOIN maquinas m ON m.id = r.maquina_id
         WHERE r.id = $1
         FOR SHARE OF r, m`,
        [id]
      );
      if (res.rows.length === 0) throw rutinaNoEncontrada();
      const x = res.rows[0];
      if (!alcanza(sectores, Number(x.sector_id))) throw rutinaNoEncontrada();
      if (!x.activa || !x.maquina_activa || !x.corresponde) {
        throw new ErrorNegocio(422, 'RUTINA_NO_CORRESPONDE', 'Esta tarea no corresponde hoy');
      }
      const ins = await client.query(
        `INSERT INTO rutina_registros (rutina_id, periodo, usuario_id, nota)
         VALUES ($1, periodo_rutina((SELECT frecuencia FROM rutinas WHERE id = $1), hoy_instalacion()), $2, $3)
         RETURNING id`,
        [id, usuario.id, nota]
      );
      return Number(ins.rows[0].id);
    });

    return c.json(await obtenerRegistro(registroId), 201);
  } catch (error) {
    return responderError(c, traducirUnico(error));
  }
});

/** 2.2 Deshacer la marca del período actual: solo quien la marcó. */
rutinasApp.delete('/:id/hecha', realiza, async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (id === null) throw rutinaNoEncontrada();
    const sectores = sectoresDePermiso(c, 'RUTINAS_REALIZAR');
    const usuario = getUsuarioContext(c);

    const borrado = await conTransaccion(async (client) => {
      const res = await client.query(
        `SELECT m.sector_id, periodo_rutina(r.frecuencia, hoy_instalacion()) AS periodo
         FROM rutinas r JOIN maquinas m ON m.id = r.maquina_id
         WHERE r.id = $1
         FOR SHARE OF r`,
        [id]
      );
      if (res.rows.length === 0) throw rutinaNoEncontrada();
      if (!alcanza(sectores, Number(res.rows[0].sector_id))) throw rutinaNoEncontrada();

      const reg = await client.query(
        `SELECT id, usuario_id FROM rutina_registros
         WHERE rutina_id = $1 AND periodo = $2
         FOR UPDATE`,
        [id, res.rows[0].periodo]
      );
      if (reg.rows.length === 0) throw rutinaNoEncontrada();
      if (Number(reg.rows[0].usuario_id) !== Number(usuario.id)) {
        throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'Solo puede deshacerla quien la marcó');
      }
      await client.query('DELETE FROM rutina_registros WHERE id = $1', [reg.rows[0].id]);
      return Number(reg.rows[0].id);
    });

    return c.json({ id: borrado, eliminado: true });
  } catch (error) {
    return responderError(c, error);
  }
});

async function obtenerRegistro(id: number) {
  const r = await pool.query(
    `SELECT rr.id, rr.rutina_id, to_char(rr.periodo, 'YYYY-MM-DD') AS periodo, rr.hecha_en, rr.nota,
            ${columnasPersona('ur', 'usuario')}
     FROM rutina_registros rr JOIN usuarios ur ON ur.id = rr.usuario_id
     WHERE rr.id = $1`,
    [id]
  );
  const x = r.rows[0];
  return {
    id: Number(x.id),
    rutina_id: Number(x.rutina_id),
    periodo: x.periodo,
    usuario: persona(x, 'usuario'),
    hecha_en: new Date(x.hecha_en).toISOString(),
    nota: x.nota ?? null,
  };
}
