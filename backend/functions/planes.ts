import { Hono } from 'hono';
import pg from 'pg';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission } from './middleware.ts';
import { ErrorNegocio, responderError } from './intervenciones/errores.ts';
import { conTransaccion } from './intervenciones/transaccion.ts';
import { validarResponsableHabilitado } from './intervenciones/motor.ts';
import { parseId, parseEnteroTexto, leerCuerpoObjeto } from './validations.ts';
import { parseIdRuta, validarIdCuerpo } from './repuestos/validaciones.ts';
import {
  bloquearPlan,
  getUsuarioContext,
  obtenerHoy,
  planNoEncontrado,
  sectoresDelAlcance,
  traducirDuplicado,
} from './preventivos/comun.ts';
import {
  conIndice,
  textoObligatorio,
  textoOpcional,
  validarAnticipacion,
  controlarRepuestosTarea,
  leerRepuestosActivos,
  validarProveedorTarea,
  validarTarea,
  leerMedidores,
  controlarMedidorTarea,
  TareaValida,
} from './preventivos/validaciones.ts';
import {
  ESTADOS_VENCIMIENTO,
  FiltrosMaquina,
  leerTareaParaCambiar,
  listarPlanes,
  listarVencimientos,
  obtenerDetallePlan,
} from './preventivos/consultas.ts';
import { generarDesdePlan, validarTareaIds } from './preventivos/generar.ts';
import { responsablesHabilitados } from './intervenciones/responsables.ts';

/**
 * Etapa PV1, secciones 4, 5 y 6.1: planes preventivos, sus tareas, los vencimientos
 * y la generación de intervenciones preventivas (D-021).
 * Todas las rutas piden PLANES_GESTIONAR; con un alcance que no es TODAS, solo las
 * máquinas de los sectores del usuario.
 */
const planesApp = new Hono();

planesApp.use('*', jwtVerify, dbVerify, requirePermission('PLANES_GESTIONAR'));

function invalido(mensaje: string): ErrorNegocio {
  return new ErrorNegocio(422, 'DATOS_INVALIDOS', mensaje);
}

function presente(val: unknown): boolean {
  return val !== undefined && val !== null;
}

/** Un filtro de id en la consulta, como en la lista de intervenciones: vacío es sin filtro. */
function filtroId(c: any, nombre: string): number | null {
  const raw = c.req.query(nombre);
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  const id = parseId(raw);
  if (id === null) throw invalido(`El parámetro ${nombre} debe ser un número entero positivo`);
  return id;
}

function filtrosMaquina(c: any): FiltrosMaquina {
  return {
    maquinaId: filtroId(c, 'maquina_id'),
    sectorId: filtroId(c, 'sector_id'),
    plantaId: filtroId(c, 'planta_id'),
    sectores: sectoresDelAlcance(c),
  };
}

function tareaNoEncontrada(): ErrorNegocio {
  return new ErrorNegocio(404, 'TAREA_NO_ENCONTRADA', 'Tarea no encontrada');
}

/** Si otro plan de la máquina ya usa el nombre, sin importar mayúsculas: 409. */
async function controlarNombre(client: pg.PoolClient, maquinaId: number, nombre: string, salvoPlanId?: number) {
  const r = await client.query(
    `SELECT 1 FROM planes_mantenimiento
     WHERE maquina_id = $1 AND lower(nombre) = lower($2) AND id <> $3`,
    [maquinaId, nombre, salvoPlanId ?? 0]
  );
  if (r.rows.length > 0) {
    throw new ErrorNegocio(409, 'PLAN_DUPLICADO', 'Ya existe un plan con ese nombre en la máquina');
  }
}

async function insertarTarea(client: pg.PoolClient, planId: number, orden: number, t: TareaValida) {
  const res = await client.query(
    `INSERT INTO plan_tareas (
       plan_id, orden, accion, detalle, frecuencia_valor, frecuencia_unidad, primera_fecha, proveedor_id,
       medidor_id, uso_cada, uso_primera, uso_anticipacion
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      planId, orden, t.accion, t.detalle, t.frecuencia_valor, t.frecuencia_unidad, t.primera_fecha, t.proveedor_id,
      t.uso?.medidor_id ?? null, t.uso?.cada ?? null, t.uso?.primera ?? null, t.uso?.anticipacion ?? null,
    ]
  );
  await guardarPrevistos(client, Number(res.rows[0].id), t);
}

/** Reemplaza la lista de repuestos previstos de la tarea (D-022). */
async function guardarPrevistos(client: pg.PoolClient, tareaId: number, t: TareaValida) {
  await client.query('DELETE FROM plan_tarea_repuestos WHERE plan_tarea_id = $1', [tareaId]);
  for (let i = 0; i < t.repuestos.length; i++) {
    await client.query(
      'INSERT INTO plan_tarea_repuestos (plan_tarea_id, repuesto_id, cantidad, orden) VALUES ($1, $2, $3, $4)',
      [tareaId, t.repuestos[i].repuesto_id, t.repuestos[i].cantidad, i + 1]
    );
  }
}

async function tocarPlan(client: pg.PoolClient, planId: number) {
  await client.query('UPDATE planes_mantenimiento SET actualizado_en = NOW() WHERE id = $1', [planId]);
}

// -------------------------------------------------------------
// 5. Vencimientos (antes de /:id)
// -------------------------------------------------------------

planesApp.get('/vencimientos', async (c) => {
  try {
    const filtros = filtrosMaquina(c);

    let estados: string[] = ['VENCIDA', 'PROXIMA', 'SIN_LECTURA', 'EN_CURSO'];
    const estadoParam = c.req.query('estado');
    if (estadoParam !== undefined && estadoParam.trim() !== '') {
      const tokens = estadoParam.split(',').map((s) => s.trim());
      for (const tok of tokens) {
        if (!(ESTADOS_VENCIMIENTO as readonly string[]).includes(tok)) {
          throw invalido(`Estado de vencimiento inválido: ${tok}`);
        }
      }
      estados = [...new Set(tokens)];
    }

    let limit = 100;
    const limitParam = c.req.query('limit');
    if (limitParam !== undefined) {
      const l = parseEnteroTexto(limitParam, 1);
      if (l === null || l > 500) throw invalido('El parámetro limit debe ser un entero entre 1 y 500');
      limit = l;
    }
    let offset = 0;
    const offsetParam = c.req.query('offset');
    if (offsetParam !== undefined) {
      const o = parseEnteroTexto(offsetParam, 0);
      if (o === null) throw invalido('El parámetro offset debe ser un entero mayor o igual a 0');
      offset = o;
    }

    const { total, cuerpo } = await listarVencimientos(pool, filtros, estados, limit, offset);
    c.header('X-Total-Count', String(total));
    return c.json(cuerpo);
  } catch (error) {
    return responderError(c, error);
  }
});

// -------------------------------------------------------------
// PV2, 1.1 Responsables para un plan (antes de /:id)
// -------------------------------------------------------------

planesApp.get('/responsables-habilitados', async (c) => {
  try {
    const raw = c.req.query('maquina_id');
    const maquinaId = raw === undefined ? null : parseId(raw);
    if (maquinaId === null) throw invalido('El parámetro maquina_id es obligatorio y debe ser un número entero positivo');

    const resM = await pool.query('SELECT sector_id FROM maquinas WHERE id = $1', [maquinaId]);
    if (resM.rows.length === 0) {
      throw new ErrorNegocio(404, 'MAQUINA_NO_ENCONTRADA', 'La máquina no existe');
    }
    const sectorId = Number(resM.rows[0].sector_id);
    const sectores = sectoresDelAlcance(c);
    if (sectores !== null && !sectores.includes(sectorId)) {
      throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tenés alcance sobre el sector de esta máquina');
    }

    return c.json(await responsablesHabilitados(pool, sectorId, 'apellido'));
  } catch (error) {
    return responderError(c, error);
  }
});

// -------------------------------------------------------------
// 4.2 Planes
// -------------------------------------------------------------

planesApp.get('/', async (c) => {
  try {
    const filtros = filtrosMaquina(c);
    const todos = c.req.query('all') === 'true';
    return c.json(await listarPlanes(pool, filtros, todos));
  } catch (error) {
    return responderError(c, error);
  }
});

planesApp.get('/:id', async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (id === null) throw planNoEncontrado();
    const detalle = await obtenerDetallePlan(pool, id);
    const sectores = sectoresDelAlcance(c);
    if (sectores !== null && !sectores.includes(detalle.maquina.sector.id)) throw planNoEncontrado();
    return c.json(detalle);
  } catch (error) {
    return responderError(c, error);
  }
});

planesApp.post('/', async (c) => {
  try {
    const leido = await leerCuerpoObjeto(c);
    if (!leido.ok) return leido.response;
    const b = leido.body;

    const maquinaId = validarIdCuerpo(b.maquina_id, 'DATOS_INVALIDOS', 'maquina_id');
    const nombre = textoObligatorio(b.nombre, 'nombre', 3, 150);
    const descripcion = textoOpcional(b.descripcion, 'descripcion', 2000);
    const anticipacion = b.anticipacion_dias === undefined ? 7 : validarAnticipacion(b.anticipacion_dias);
    const responsableId = presente(b.responsable_usuario_id)
      ? validarIdCuerpo(b.responsable_usuario_id, 'DATOS_INVALIDOS', 'responsable_usuario_id')
      : null;
    if (!Array.isArray(b.tareas) || b.tareas.length < 1 || b.tareas.length > 50) {
      throw invalido('El plan lleva de 1 a 50 tareas');
    }
    const tareasRaw: unknown[] = b.tareas;

    const sectores = sectoresDelAlcance(c);
    const usuario = getUsuarioContext(c);

    const planId = await conTransaccion(async (client) => {
      const hoy = await obtenerHoy(client);
      const tareas = tareasRaw.map((t, indice) => {
        try {
          return validarTarea(t, hoy);
        } catch (err) {
          throw conIndice(err, indice);
        }
      });

      // La máquina, leída con FOR SHARE (4.4)
      const resM = await client.query('SELECT id, sector_id, activo FROM maquinas WHERE id = $1 FOR SHARE', [maquinaId]);
      if (resM.rows.length === 0) {
        throw new ErrorNegocio(404, 'MAQUINA_NO_ENCONTRADA', 'La máquina no existe');
      }
      const sectorId = Number(resM.rows[0].sector_id);
      if (sectores !== null && !sectores.includes(sectorId)) {
        throw new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tenés alcance sobre el sector de esta máquina');
      }
      if (!resM.rows[0].activo) {
        throw new ErrorNegocio(422, 'MAQUINA_INACTIVA', 'La máquina está inactiva');
      }

      if (responsableId !== null) {
        await validarResponsableHabilitado(client, responsableId, sectorId);
      }
      await controlarNombre(client, maquinaId, nombre);

      const activos = await leerRepuestosActivos(client, tareas.flatMap((t) => t.repuestos.map((r) => r.repuesto_id)));
      const medidores = await leerMedidores(client, tareas.flatMap((t) => (t.uso ? [t.uso.medidor_id] : [])));
      for (let indice = 0; indice < tareas.length; indice++) {
        try {
          controlarRepuestosTarea(tareas[indice], activos);
          controlarMedidorTarea(tareas[indice], medidores, maquinaId);
          await validarProveedorTarea(client, tareas[indice]);
        } catch (err) {
          throw conIndice(err, indice);
        }
      }

      const resP = await client.query(
        `INSERT INTO planes_mantenimiento (
           maquina_id, responsable_usuario_id, nombre, descripcion, anticipacion_dias, creado_por_usuario_id
         ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [maquinaId, responsableId, nombre, descripcion, anticipacion, usuario.id]
      );
      const id = Number(resP.rows[0].id);
      for (let i = 0; i < tareas.length; i++) {
        await insertarTarea(client, id, i + 1, tareas[i]);
      }
      return id;
    });

    return c.json(await obtenerDetallePlan(pool, planId), 201);
  } catch (error) {
    return responderError(c, traducirDuplicado(error));
  }
});

planesApp.patch('/:id', async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    const leido = await leerCuerpoObjeto(c);
    if (!leido.ok) return leido.response;
    const b = leido.body;

    if ('maquina_id' in b) throw invalido('La máquina de un plan no se cambia');
    for (const campo of ['tareas', 'activo']) {
      if (campo in b) throw invalido(`El campo ${campo} no se cambia por acá`);
    }

    const nombre = 'nombre' in b ? textoObligatorio(b.nombre, 'nombre', 3, 150) : undefined;
    const descripcion = 'descripcion' in b ? textoOpcional(b.descripcion, 'descripcion', 2000) : undefined;
    const anticipacion = 'anticipacion_dias' in b ? validarAnticipacion(b.anticipacion_dias) : undefined;
    const responsableId =
      'responsable_usuario_id' in b
        ? b.responsable_usuario_id === null
          ? null
          : validarIdCuerpo(b.responsable_usuario_id, 'DATOS_INVALIDOS', 'responsable_usuario_id')
        : undefined;

    const sectores = sectoresDelAlcance(c);

    await conTransaccion(async (client) => {
      const plan = await bloquearPlan(client, id, sectores);

      const sets: string[] = [];
      const params: unknown[] = [];
      const poner = (columna: string, valor: unknown) => {
        params.push(valor);
        sets.push(`${columna} = $${params.length}`);
      };

      if (nombre !== undefined) {
        await controlarNombre(client, plan.maquina_id, nombre, plan.id);
        poner('nombre', nombre);
      }
      if (descripcion !== undefined) poner('descripcion', descripcion);
      if (anticipacion !== undefined) poner('anticipacion_dias', anticipacion);
      if (responsableId !== undefined) {
        if (responsableId !== null && responsableId !== plan.responsable_usuario_id) {
          await validarResponsableHabilitado(client, responsableId, plan.sector_id);
        }
        poner('responsable_usuario_id', responsableId);
      }

      if (sets.length > 0) {
        params.push(plan.id);
        await client.query(
          `UPDATE planes_mantenimiento SET ${sets.join(', ')}, actualizado_en = NOW() WHERE id = $${params.length}`,
          params
        );
      }
    });

    return c.json(await obtenerDetallePlan(pool, id as number));
  } catch (error) {
    return responderError(c, traducirDuplicado(error));
  }
});

/** La baja y el alta de un plan. */
function cambiarActivoPlan(activo: boolean) {
  return async (c: any) => {
    try {
      const id = parseIdRuta(c.req.param('id'));
      const sectores = sectoresDelAlcance(c);
      await conTransaccion(async (client) => {
        const plan = await bloquearPlan(client, id, sectores);
        if (plan.activo === activo) {
          throw activo
            ? new ErrorNegocio(409, 'PLAN_YA_ACTIVO', 'El plan ya está activo')
            : new ErrorNegocio(409, 'PLAN_YA_INACTIVO', 'El plan ya está inactivo');
        }
        await client.query(
          'UPDATE planes_mantenimiento SET activo = $1, actualizado_en = NOW() WHERE id = $2',
          [activo, plan.id]
        );
      });
      return c.json(await obtenerDetallePlan(pool, id as number));
    } catch (error) {
      return responderError(c, error);
    }
  };
}

planesApp.post('/:id/desactivar', cambiarActivoPlan(false));
planesApp.post('/:id/reactivar', cambiarActivoPlan(true));

// -------------------------------------------------------------
// 4.2 Tareas del plan
// -------------------------------------------------------------

planesApp.post('/:id/tareas', async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    const leido = await leerCuerpoObjeto(c);
    if (!leido.ok) return leido.response;
    const sectores = sectoresDelAlcance(c);

    await conTransaccion(async (client) => {
      const plan = await bloquearPlan(client, id, sectores);
      const hoy = await obtenerHoy(client);
      const tarea = validarTarea(leido.body, hoy);
      controlarRepuestosTarea(tarea, await leerRepuestosActivos(client, tarea.repuestos.map((r) => r.repuesto_id)));
      controlarMedidorTarea(tarea, await leerMedidores(client, tarea.uso ? [tarea.uso.medidor_id] : []), plan.maquina_id);
      await validarProveedorTarea(client, tarea);

      // Al final del orden, con el plan bloqueado
      const resOrden = await client.query(
        'SELECT COALESCE(MAX(orden), 0) + 1 AS orden FROM plan_tareas WHERE plan_id = $1',
        [plan.id]
      );
      await insertarTarea(client, plan.id, Number(resOrden.rows[0].orden), tarea);
      await tocarPlan(client, plan.id);
    });

    return c.json(await obtenerDetallePlan(pool, id as number), 201);
  } catch (error) {
    return responderError(c, error);
  }
});

planesApp.patch('/:id/tareas/:tareaId', async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    const tareaId = parseIdRuta(c.req.param('tareaId'));
    const leido = await leerCuerpoObjeto(c);
    if (!leido.ok) return leido.response;
    const sectores = sectoresDelAlcance(c);

    await conTransaccion(async (client) => {
      const plan = await bloquearPlan(client, id, sectores);
      if (tareaId === null) throw tareaNoEncontrada();
      const actual = await leerTareaParaCambiar(client, plan.id, tareaId);
      if (actual === null) throw tareaNoEncontrada();

      const hoy = await obtenerHoy(client);
      const t = validarTarea(leido.body, hoy, actual.tarea);
      controlarRepuestosTarea(t, await leerRepuestosActivos(client, t.repuestos.map((r) => r.repuesto_id)), actual.tarea);
      await validarProveedorTarea(client, t, actual.tarea);
      if ('uso' in leido.body) {
        controlarMedidorTarea(t, await leerMedidores(client, t.uso ? [t.uso.medidor_id] : []), plan.maquina_id);
      }

      await client.query(
        `UPDATE plan_tareas SET
           accion = $1, detalle = $2, frecuencia_valor = $3, frecuencia_unidad = $4, primera_fecha = $5::date,
           proveedor_id = $6, medidor_id = $7, uso_cada = $8, uso_primera = $9, uso_anticipacion = $10,
           actualizado_en = NOW()
         WHERE id = $11`,
        [
          t.accion, t.detalle, t.frecuencia_valor, t.frecuencia_unidad, t.primera_fecha, t.proveedor_id,
          t.uso?.medidor_id ?? null, t.uso?.cada ?? null, t.uso?.primera ?? null, t.uso?.anticipacion ?? null,
          tareaId,
        ]
      );
      if ('repuestos' in leido.body) await guardarPrevistos(client, tareaId, t);
      await tocarPlan(client, plan.id);
    });

    return c.json(await obtenerDetallePlan(pool, id as number));
  } catch (error) {
    return responderError(c, error);
  }
});

/** La baja y el alta de una tarea. */
function cambiarActivoTarea(activo: boolean) {
  return async (c: any) => {
    try {
      const id = parseIdRuta(c.req.param('id'));
      const tareaId = parseIdRuta(c.req.param('tareaId'));
      const sectores = sectoresDelAlcance(c);

      await conTransaccion(async (client) => {
        const plan = await bloquearPlan(client, id, sectores);
        if (tareaId === null) throw tareaNoEncontrada();
        const actual = await leerTareaParaCambiar(client, plan.id, tareaId);
        if (actual === null) throw tareaNoEncontrada();
        if (actual.activo === activo) {
          throw activo
            ? new ErrorNegocio(409, 'TAREA_YA_ACTIVA', 'La tarea ya está activa')
            : new ErrorNegocio(409, 'TAREA_YA_INACTIVA', 'La tarea ya está inactiva');
        }
        // El medidor, con FOR SHARE: desactivarlo a la vez espera esta transacción (4.5)
        if (activo && actual.tarea.uso) {
          const medidores = await leerMedidores(client, [actual.tarea.uso.medidor_id]);
          if (!medidores.get(actual.tarea.uso.medidor_id)?.activo) {
            throw new ErrorNegocio(409, 'MEDIDOR_INACTIVO', 'El medidor de la tarea está inactivo');
          }
        }
        await client.query('UPDATE plan_tareas SET activo = $1, actualizado_en = NOW() WHERE id = $2', [activo, tareaId]);
        await tocarPlan(client, plan.id);
      });

      return c.json(await obtenerDetallePlan(pool, id as number));
    } catch (error) {
      return responderError(c, error);
    }
  };
}

planesApp.post('/:id/tareas/:tareaId/desactivar', cambiarActivoTarea(false));
planesApp.post('/:id/tareas/:tareaId/reactivar', cambiarActivoTarea(true));

// -------------------------------------------------------------
// 6.1 Generar una intervención preventiva desde el plan
// -------------------------------------------------------------

planesApp.post('/:id/generar', async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));

    // El cuerpo es opcional: sin cuerpo, las tareas vencidas y próximas
    const texto = await c.req.text();
    let body: Record<string, unknown> = {};
    if (texto.trim() !== '') {
      let raw: unknown;
      try {
        raw = JSON.parse(texto);
      } catch {
        throw new ErrorNegocio(400, 'DATOS_INVALIDOS', 'El cuerpo de la solicitud debe ser un objeto JSON');
      }
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ErrorNegocio(400, 'DATOS_INVALIDOS', 'El cuerpo de la solicitud debe ser un objeto JSON');
      }
      body = raw as Record<string, unknown>;
    }
    const tareaIds = validarTareaIds(body.tarea_ids);

    const usuario = getUsuarioContext(c);
    const sectores = sectoresDelAlcance(c);
    const generada = await conTransaccion((client) => generarDesdePlan(client, id, usuario, sectores, tareaIds));
    return c.json(generada, 201);
  } catch (error) {
    return responderError(c, error);
  }
});

export default planesApp;
