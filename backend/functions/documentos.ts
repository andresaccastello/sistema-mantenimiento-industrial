import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission } from './middleware.ts';
import { ErrorNegocio, responderError } from './intervenciones/errores.ts';
import { conTransaccion } from './intervenciones/transaccion.ts';
import { leerCuerpoObjeto } from './validations.ts';
import { parseIdRuta } from './repuestos/validaciones.ts';
import { textoObligatorio, textoOpcional } from './preventivos/validaciones.ts';

/**
 * Etapa MQ1, sección 1: los documentos de la máquina, como enlaces (D-035).
 * - /api/maquinas/:id/documentos: la lista y el alta.
 * - /api/documentos/:id: la edición y el borrado.
 */

export const TIPOS_DOCUMENTO = ['MANUAL', 'FOTO', 'VIDEO', 'INSTRUCTIVO', 'PLANO', 'OTRO'] as const;

const GESTIONAR = 'DOCUMENTOS_GESTIONAR';

function invalido(mensaje: string): ErrorNegocio {
  return new ErrorNegocio(422, 'DATOS_INVALIDOS', mensaje);
}

function maquinaNoEncontrada(): ErrorNegocio {
  return new ErrorNegocio(404, 'MAQUINA_NO_ENCONTRADA', 'La máquina no existe');
}

function documentoNoEncontrado(): ErrorNegocio {
  return new ErrorNegocio(404, 'DOCUMENTO_NO_ENCONTRADO', 'El documento no existe');
}

function validarTitulo(val: unknown): string {
  return textoObligatorio(val, 'titulo', 1, 150);
}

function validarTipo(val: unknown): string {
  if (typeof val !== 'string' || !(TIPOS_DOCUMENTO as readonly string[]).includes(val)) {
    throw invalido(`El campo tipo debe ser ${TIPOS_DOCUMENTO.join(', ')}`);
  }
  return val;
}

/** Solo http o https: así no pasan javascript: ni data:. */
function validarUrl(val: unknown): string {
  const url = textoObligatorio(val, 'url', 1, 1000);
  if (!/^https?:\/\//i.test(url)) {
    throw invalido('El enlace tiene que empezar con http:// o https://');
  }
  return url;
}

function validarNotas(val: unknown): string | null {
  return textoOpcional(val, 'notas', 500);
}

const COLUMNAS = `
  d.id, d.maquina_id, d.titulo, d.tipo, d.url, d.notas, d.creado_en, d.actualizado_en,
  u.id AS creador_id, u.nombre AS creador_nombre, u.apellido AS creador_apellido`;

function documentoDeFila(r: any) {
  return {
    id: Number(r.id),
    maquina_id: Number(r.maquina_id),
    titulo: r.titulo,
    tipo: r.tipo,
    url: r.url,
    notas: r.notas ?? null,
    creado_por: { id: Number(r.creador_id), nombre: r.creador_nombre, apellido: r.creador_apellido ?? null },
    creado_en: r.creado_en,
    actualizado_en: r.actualizado_en,
  };
}

async function obtenerDocumento(id: number) {
  const res = await pool.query(
    `SELECT ${COLUMNAS} FROM maquina_documentos d JOIN usuarios u ON u.id = d.creado_por_usuario_id WHERE d.id = $1`,
    [id]
  );
  if (res.rows.length === 0) throw documentoNoEncontrado();
  return documentoDeFila(res.rows[0]);
}

// -------------------------------------------------------------
// /api/maquinas/:id/documentos
// -------------------------------------------------------------

export const maquinaDocumentosApp = new Hono();

maquinaDocumentosApp.use('/:id/documentos', jwtVerify, dbVerify);

/** La ve quien puede ver la máquina: el detalle de la máquina no tiene alcance. Por tipo y título. */
maquinaDocumentosApp.get('/:id/documentos', async (c) => {
  try {
    const maquinaId = parseIdRuta(c.req.param('id'));
    if (maquinaId === null) throw maquinaNoEncontrada();
    const resM = await pool.query('SELECT 1 FROM maquinas WHERE id = $1', [maquinaId]);
    if (resM.rows.length === 0) throw maquinaNoEncontrada();

    const res = await pool.query(
      `SELECT ${COLUMNAS}
       FROM maquina_documentos d
       JOIN usuarios u ON u.id = d.creado_por_usuario_id
       WHERE d.maquina_id = $1
       ORDER BY array_position($2::text[], d.tipo::text), lower(d.titulo), d.id`,
      [maquinaId, TIPOS_DOCUMENTO]
    );
    return c.json(res.rows.map(documentoDeFila));
  } catch (error) {
    return responderError(c, error);
  }
});

maquinaDocumentosApp.post('/:id/documentos', requirePermission(GESTIONAR), async (c) => {
  try {
    const maquinaId = parseIdRuta(c.req.param('id'));
    if (maquinaId === null) throw maquinaNoEncontrada();
    const leido = await leerCuerpoObjeto(c);
    if (!leido.ok) return leido.response;
    const b = leido.body;

    const titulo = validarTitulo(b.titulo);
    const tipo = validarTipo(b.tipo);
    const url = validarUrl(b.url);
    const notas = validarNotas(b.notas);
    const usuarioId = Number((c.get as any)('userId'));

    const id = await conTransaccion(async (client) => {
      const resM = await client.query('SELECT activo FROM maquinas WHERE id = $1 FOR SHARE', [maquinaId]);
      if (resM.rows.length === 0) throw maquinaNoEncontrada();
      if (!resM.rows[0].activo) {
        throw new ErrorNegocio(422, 'MAQUINA_INACTIVA', 'La máquina está inactiva: no se le agregan documentos');
      }
      const res = await client.query(
        `INSERT INTO maquina_documentos (maquina_id, titulo, tipo, url, notas, creado_por_usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [maquinaId, titulo, tipo, url, notas, usuarioId]
      );
      return Number(res.rows[0].id);
    });

    return c.json(await obtenerDocumento(id), 201);
  } catch (error) {
    return responderError(c, error);
  }
});

// -------------------------------------------------------------
// /api/documentos/:id
// -------------------------------------------------------------

export const documentosApp = new Hono();

documentosApp.use('*', jwtVerify, dbVerify);

documentosApp.patch('/:id', requirePermission(GESTIONAR), async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (id === null) throw documentoNoEncontrado();
    const leido = await leerCuerpoObjeto(c);
    if (!leido.ok) return leido.response;
    const b = leido.body;

    const sets: string[] = [];
    const params: unknown[] = [id];
    const agregar = (columna: string, valor: unknown) => {
      params.push(valor);
      sets.push(`${columna} = $${params.length}`);
    };
    if ('titulo' in b) agregar('titulo', validarTitulo(b.titulo));
    if ('tipo' in b) agregar('tipo', validarTipo(b.tipo));
    if ('url' in b) agregar('url', validarUrl(b.url));
    if ('notas' in b) agregar('notas', validarNotas(b.notas));
    if (sets.length === 0) throw invalido('Indicá titulo, tipo, url o notas');

    await conTransaccion(async (client) => {
      const res = await client.query('SELECT id FROM maquina_documentos WHERE id = $1 FOR UPDATE', [id]);
      if (res.rows.length === 0) throw documentoNoEncontrado();
      await client.query(
        `UPDATE maquina_documentos SET ${sets.join(', ')}, actualizado_en = NOW() WHERE id = $1`,
        params
      );
    });

    return c.json(await obtenerDocumento(id));
  } catch (error) {
    return responderError(c, error);
  }
});

/** Borra de verdad: es solo un enlace. */
documentosApp.delete('/:id', requirePermission(GESTIONAR), async (c) => {
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (id === null) throw documentoNoEncontrado();
    const res = await pool.query('DELETE FROM maquina_documentos WHERE id = $1 RETURNING id', [id]);
    if (res.rows.length === 0) throw documentoNoEncontrado();
    return c.json({ ok: true });
  } catch (error) {
    return responderError(c, error);
  }
});
