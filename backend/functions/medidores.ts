import { Hono } from 'hono';
import pg from 'pg';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requireAlgunPermiso, requirePermission } from './middleware.ts';
import { ErrorNegocio, responderError } from './intervenciones/errores.ts';
import { conTransaccion } from './intervenciones/transaccion.ts';
import { parseEnteroTexto, parseId, leerCuerpoObjeto, validarMotivo } from './validations.ts';
import { parseIdRuta, validarIdCuerpo } from './repuestos/validaciones.ts';
import { getUsuarioContext, sectoresDelAlcance } from './preventivos/comun.ts';
import { textoObligatorio, textoOpcional } from './preventivos/validaciones.ts';
import {
  MedidorBloqueado,
  bloquearMedidor,
  medidorNoEncontrado,
  registrarLectura,
  validarValorMedidor,
} from './medidores/lecturas.ts';
import { listarLecturas, listarMedidores, obtenerDetalleMedidor, obtenerLectura } from './medidores/consultas.ts';

/**
 * Etapa PV3, sección 3: los medidores de las máquinas y sus lecturas (D-023).
 * Ver y cargar lecturas son de todas las máquinas; gestionar, del alcance de PLANES_GESTIONAR.
 */
const medidoresApp = new Hono();

medidoresApp.use('*', jwtVerify, dbVerify, requireAlgunPermiso(['PLANES_GESTIONAR', 'MAQUINAS_REGISTRAR_LECTURAS']));

const gestiona = requirePermission('PLANES_GESTIONAR');
const cargaLecturas = requirePermission('MAQUINAS_REGISTRAR_LECTURAS');

function invalido(mensaje: string): ErrorNegocio {
  return new ErrorNegocio(422, 'DATOS_INVALIDOS', mensaje);
}

function sinAlcance(): ErrorNegocio {
  return new ErrorNegocio(403, 'PERMISO_INSUFICIENTE', 'No tenés alcance sobre el sector de esta máquina');
}

function controlarAlcance(sectores: number[] | null, sectorId: number) {
  if (sectores !== null && !sectores.includes(sectorId)) throw sinAlcance();
}

/** Un único repetido: el nombre del medidor en la máquina (3.5), nunca 500. */
function traducirDuplicado(err: any): unknown {
  if (err && err.code === '23505' && err.constraint === 'uq_medidores_maquina_nombre') {
    return new ErrorNegocio(409, 'MEDIDOR_DUPLICADO', 'Ya existe un medidor con ese nombre en la máquina');
  }
  return err;
}

async function controlarNombre(client: pg.PoolClient, maquinaId: number, nombre: string, salvoId = 0) {
  const r = await client.query(
    'SELECT 1 FROM medidores WHERE maquina_id = $1 AND lower(nombre) = lower($2) AND id <> $3',
    [maquinaId, nombre, salvoId]
  );
  if (r.rows.length > 0) {
    throw new ErrorNegocio(409, 'MEDIDOR_DUPLICADO', 'Ya existe un medidor con ese nombre en la máquina');
  }
}

/** Los ids activos de las tareas que usan el medidor, de cualquier plan. */
async function tareasActivas(client: pg.PoolClient, medidorId: number): Promise<number[]> {
  const r = await client.query('SELECT id FROM plan_tareas WHERE medidor_id = $1 AND activo ORDER BY id', [medidorId]);
  return r.rows.map((x) => Number(x.id));
}

function parametroPaginacion(c: any, nombre: string, minimo: number, omision: number, maximo?: number): number {
  const raw = c.req.query(nombre);
  if (raw === undefined) return omision;
  const n = parseEnteroTexto(raw, minimo);
  if (n === null || (maximo !== undefined && n > maximo)) {
    throw invalido(
      maximo !== undefined
        ? `El parámetro ${nombre} debe ser un entero entre ${minimo} y ${maximo}`
        : `El parámetro ${nombre} debe ser un entero mayor o igual a ${minimo}`
    );
  }
  return n;
}

// -------------------------------------------------------------
// 3.2 Medidores
// -------------------------------------------------------------

medidoresApp.get('/', async (c) => {
  try {
    const raw = c.req.query('maquina_id');
    let maquinaId: number | null = null;
    if (raw !== undefined) {
      maquinaId = parseId(raw);
      if (maquinaId === null) throw invalido('El parámetro maquina_id debe ser un número entero positivo');
    }
    return c.json(await listarMedidores(pool, maquinaId, c.req.query('all') === 'true'));
  } catch (error) {
    return responderError(c, error);
  }
});

medidoresApp.get('/:id', async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (id === null) throw medidorNoEncontrado();
    return c.json(await obtenerDetalleMedidor(pool, id));
  } catch (error) {
    return responderError(c, error);
  }
});

medidoresApp.post('/', gestiona, async (c) => {
  try {
    const leido = await leerCuerpoObjeto(c);
    if (!leido.ok) return leido.response;
    const b = leido.body;

    const maquinaId = validarIdCuerpo(b.maquina_id, 'DATOS_INVALIDOS', 'maquina_id');
    const nombre = textoObligatorio(b.nombre, 'nombre', 3, 60);
    const unidad = textoObligatorio(b.unidad, 'unidad', 1, 20);
    const inicial =
      b.lectura_inicial === undefined || b.lectura_inicial === null
        ? null
        : validarValorMedidor(b.lectura_inicial, 'lectura_inicial');

    const sectores = sectoresDelAlcance(c);
    const usuario = getUsuarioContext(c);

    const id = await conTransaccion(async (client) => {
      const resM = await client.query('SELECT sector_id, activo FROM maquinas WHERE id = $1 FOR SHARE', [maquinaId]);
      if (resM.rows.length === 0) {
        throw new ErrorNegocio(404, 'MAQUINA_NO_ENCONTRADA', 'La máquina no existe');
      }
      controlarAlcance(sectores, Number(resM.rows[0].sector_id));
      if (!resM.rows[0].activo) {
        throw new ErrorNegocio(422, 'MAQUINA_INACTIVA', 'La máquina está inactiva');
      }
      await controlarNombre(client, maquinaId, nombre);

      const res = await client.query(
        'INSERT INTO medidores (maquina_id, nombre, unidad, creado_por_usuario_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [maquinaId, nombre, unidad, usuario.id]
      );
      const nuevoId = Number(res.rows[0].id);
      if (inicial !== null) {
        await registrarLectura(client, {
          medidor: await bloquearMedidor(client, nuevoId),
          valor: inicial,
          usuarioId: usuario.id,
          origen: 'MANUAL',
        });
      }
      return nuevoId;
    });

    return c.json(await obtenerDetalleMedidor(pool, id), 201);
  } catch (error) {
    return responderError(c, traducirDuplicado(error));
  }
});

medidoresApp.patch('/:id', gestiona, async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    const leido = await leerCuerpoObjeto(c);
    if (!leido.ok) return leido.response;
    const b = leido.body;

    for (const campo of ['maquina_id', 'lectura_inicial']) {
      if (campo in b) throw invalido(`El campo ${campo} solo va en el alta`);
    }
    const nombre = 'nombre' in b ? textoObligatorio(b.nombre, 'nombre', 3, 60) : undefined;
    const unidad = 'unidad' in b ? textoObligatorio(b.unidad, 'unidad', 1, 20) : undefined;
    const sectores = sectoresDelAlcance(c);

    await conTransaccion(async (client) => {
      const medidor = await bloquearMedidor(client, id);
      controlarAlcance(sectores, medidor.sector_id);
      if (nombre !== undefined) await controlarNombre(client, medidor.maquina_id, nombre, medidor.id);
      await client.query(
        `UPDATE medidores
         SET nombre = COALESCE($1, nombre), unidad = COALESCE($2, unidad), actualizado_en = NOW()
         WHERE id = $3`,
        [nombre ?? null, unidad ?? null, medidor.id]
      );
    });

    return c.json(await obtenerDetalleMedidor(pool, id as number));
  } catch (error) {
    return responderError(c, traducirDuplicado(error));
  }
});

/** La baja y el alta de un medidor. */
function cambiarActivo(activo: boolean) {
  return async (c: any) => {
    try {
      const id = parseIdRuta(c.req.param('id'));
      const sectores = sectoresDelAlcance(c);
      await conTransaccion(async (client) => {
        const medidor: MedidorBloqueado = await bloquearMedidor(client, id);
        controlarAlcance(sectores, medidor.sector_id);
        if (medidor.activo === activo) {
          throw activo
            ? new ErrorNegocio(409, 'MEDIDOR_YA_ACTIVO', 'El medidor ya está activo')
            : new ErrorNegocio(409, 'MEDIDOR_YA_INACTIVO', 'El medidor ya está inactivo');
        }
        if (!activo) {
          const tareaIds = await tareasActivas(client, medidor.id);
          if (tareaIds.length > 0) {
            throw new ErrorNegocio(409, 'MEDIDOR_EN_USO', 'Hay tareas activas que usan este medidor', { tarea_ids: tareaIds });
          }
        }
        await client.query('UPDATE medidores SET activo = $1, actualizado_en = NOW() WHERE id = $2', [activo, medidor.id]);
      });
      return c.json(await obtenerDetalleMedidor(pool, id as number));
    } catch (error) {
      return responderError(c, error);
    }
  };
}

medidoresApp.post('/:id/desactivar', gestiona, cambiarActivo(false));
medidoresApp.post('/:id/reactivar', gestiona, cambiarActivo(true));

// -------------------------------------------------------------
// 3.2 Lecturas
// -------------------------------------------------------------

medidoresApp.get('/:id/lecturas', async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (id === null) throw medidorNoEncontrado();
    const limit = parametroPaginacion(c, 'limit', 1, 50, 500);
    const offset = parametroPaginacion(c, 'offset', 0, 0);

    const existe = await pool.query('SELECT 1 FROM medidores WHERE id = $1', [id]);
    if (existe.rows.length === 0) throw medidorNoEncontrado();

    const { total, lecturas } = await listarLecturas(pool, id, limit, offset);
    c.header('X-Total-Count', String(total));
    return c.json(lecturas);
  } catch (error) {
    return responderError(c, error);
  }
});

medidoresApp.post('/:id/lecturas', cargaLecturas, async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    const leido = await leerCuerpoObjeto(c);
    if (!leido.ok) return leido.response;
    const valor = validarValorMedidor(leido.body.valor, 'valor');
    const observacion = textoOpcional(leido.body.observacion, 'observacion', 200);
    const usuario = getUsuarioContext(c);

    const lecturaId = await conTransaccion(async (client) =>
      registrarLectura(client, {
        medidor: await bloquearMedidor(client, id),
        valor,
        usuarioId: usuario.id,
        origen: 'MANUAL',
        observacion,
      })
    );

    return c.json(await obtenerLectura(pool, lecturaId), 201);
  } catch (error) {
    return responderError(c, error);
  }
});

medidoresApp.post('/:id/lecturas/:lecturaId/anular', gestiona, async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    const lecturaId = parseIdRuta(c.req.param('lecturaId'));
    const leido = await leerCuerpoObjeto(c);
    if (!leido.ok) return leido.response;
    const motivo = validarMotivo(leido.body.motivo, 'Indicá un motivo de al menos 5 caracteres');
    const sectores = sectoresDelAlcance(c);
    const usuario = getUsuarioContext(c);

    await conTransaccion(async (client) => {
      const medidor = await bloquearMedidor(client, id);
      controlarAlcance(sectores, medidor.sector_id);

      const noEncontrada = () => new ErrorNegocio(404, 'LECTURA_NO_ENCONTRADA', 'Lectura no encontrada');
      if (lecturaId === null) throw noEncontrada();
      const r = await client.query(
        'SELECT anulada_en FROM lecturas_medidor WHERE id = $1 AND medidor_id = $2 FOR UPDATE',
        [lecturaId, medidor.id]
      );
      if (r.rows.length === 0) throw noEncontrada();
      if (r.rows[0].anulada_en !== null) {
        throw new ErrorNegocio(409, 'LECTURA_YA_ANULADA', 'La lectura ya fue anulada');
      }
      await client.query(
        'UPDATE lecturas_medidor SET anulada_en = NOW(), anulada_por_usuario_id = $1, motivo_anulacion = $2 WHERE id = $3',
        [usuario.id, motivo, lecturaId]
      );
    });

    return c.json(await obtenerLectura(pool, lecturaId as number));
  } catch (error) {
    return responderError(c, error);
  }
});

export default medidoresApp;
