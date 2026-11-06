import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission, requireAlgunPermiso } from './middleware.ts';
import { ErrorNegocio, responderError } from './intervenciones/errores.ts';
import { validarEmail, parseIdRuta, validarBooleano } from './repuestos/validaciones.ts';

const proveedoresApp = new Hono();

proveedoresApp.use('*', jwtVerify, dbVerify);

// GET /opciones (declarado antes de /:id)
proveedoresApp.get(
  '/opciones',
  requireAlgunPermiso(['REPUESTOS_GESTIONAR', 'INTERVENCIONES_CAMBIAR_ESTADO', 'COSTOS_REGISTRAR']),
  async (c) => {
    try {
      const res = await pool.query(
        'SELECT id, nombre FROM proveedores WHERE activo = TRUE ORDER BY lower(trim(nombre)) ASC'
      );
      const opciones = res.rows.map((r) => ({
        id: Number(r.id),
        nombre: r.nombre,
      }));
      return c.json(opciones, 200);
    } catch (err) {
      return responderError(c, err);
    }
  }
);

// GET /
proveedoresApp.get('/', requirePermission('REPUESTOS_GESTIONAR'), async (c) => {
  try {
    const all = c.req.query('all') === 'true';
    const whereClause = all ? '' : 'WHERE p.activo = TRUE';

    const sql = `
      SELECT
        p.id,
        p.nombre,
        p.contacto,
        p.telefono,
        p.email,
        p.notas,
        p.activo,
        p.creado_en,
        p.actualizado_en,
        COALESCE(r.repuestos_activos, 0)::int AS repuestos_activos
      FROM proveedores p
      LEFT JOIN (
        SELECT proveedor_id, COUNT(*)::int AS repuestos_activos
        FROM repuestos
        WHERE activo = TRUE AND proveedor_id IS NOT NULL
        GROUP BY proveedor_id
      ) r ON r.proveedor_id = p.id
      ${whereClause}
      ORDER BY lower(trim(p.nombre)) ASC
    `;

    const res = await pool.query(sql);
    const proveedores = res.rows.map((p) => ({
      id: Number(p.id),
      nombre: p.nombre,
      contacto: p.contacto || null,
      telefono: p.telefono || null,
      email: p.email || null,
      notas: p.notas || null,
      activo: Boolean(p.activo),
      repuestos_activos: Number(p.repuestos_activos || 0),
    }));

    return c.json(proveedores, 200);
  } catch (err) {
    return responderError(c, err);
  }
});

// POST /
proveedoresApp.post('/', requirePermission('REPUESTOS_GESTIONAR'), async (c) => {
  try {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Cuerpo JSON inválido');
    }

    const nombreRaw = typeof body.nombre === 'string' ? body.nombre.trim() : '';
    if (nombreRaw.length < 2 || nombreRaw.length > 150) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El nombre debe tener entre 2 y 150 caracteres');
    }

    const email = validarEmail(body.email);
    const contacto = typeof body.contacto === 'string' && body.contacto.trim() ? body.contacto.trim() : null;
    if (contacto && contacto.length > 150) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El contacto no puede superar los 150 caracteres');
    }

    const telefono = typeof body.telefono === 'string' && body.telefono.trim() ? body.telefono.trim() : null;
    if (telefono && telefono.length > 40) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El teléfono no puede superar los 40 caracteres');
    }

    const notas = typeof body.notas === 'string' && body.notas.trim() ? body.notas.trim() : null;
    if (notas && notas.length > 1000) {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Las notas no pueden superar los 1000 caracteres');
    }

    // Verificar nombre duplicado
    const dup = await pool.query(
      'SELECT id FROM proveedores WHERE lower(trim(nombre)) = lower(trim($1))',
      [nombreRaw]
    );
    if (dup.rows.length > 0) {
      throw new ErrorNegocio(409, 'NOMBRE_DUPLICADO', 'Ya existe un proveedor con ese nombre');
    }

    let nuevo: any;
    try {
      const ins = await pool.query(
        `INSERT INTO proveedores (nombre, contacto, telefono, email, notas, activo, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
         RETURNING id, nombre, contacto, telefono, email, notas, activo, creado_en, actualizado_en`,
        [nombreRaw, contacto, telefono, email, notas]
      );
      nuevo = ins.rows[0];
    } catch (dbErr: any) {
      if (dbErr.code === '23505' || dbErr.constraint === 'uq_proveedores_nombre') {
        throw new ErrorNegocio(409, 'NOMBRE_DUPLICADO', 'Ya existe un proveedor con ese nombre');
      }
      throw dbErr;
    }

    return c.json(
      {
        id: Number(nuevo.id),
        nombre: nuevo.nombre,
        contacto: nuevo.contacto || null,
        telefono: nuevo.telefono || null,
        email: nuevo.email || null,
        notas: nuevo.notas || null,
        activo: Boolean(nuevo.activo),
        repuestos_activos: 0,
      },
      201
    );
  } catch (err) {
    return responderError(c, err);
  }
});

// PUT /:id
proveedoresApp.put('/:id', requirePermission('REPUESTOS_GESTIONAR'), async (c) => {
  const client = await pool.connect();
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'PROVEEDOR_NO_ENCONTRADO', 'Proveedor no encontrado');
    }

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Cuerpo JSON inválido');
    }

    await client.query('BEGIN');

    const existingRes = await client.query('SELECT * FROM proveedores WHERE id = $1 FOR UPDATE', [id]);
    if (existingRes.rows.length === 0) {
      throw new ErrorNegocio(404, 'PROVEEDOR_NO_ENCONTRADO', 'Proveedor no encontrado');
    }
    const actual = existingRes.rows[0];

    let nombre = actual.nombre;
    if (body.nombre !== undefined) {
      const nombreRaw = typeof body.nombre === 'string' ? body.nombre.trim() : '';
      if (nombreRaw.length < 2 || nombreRaw.length > 150) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El nombre debe tener entre 2 y 150 caracteres');
      }
      const dup = await client.query(
        'SELECT id FROM proveedores WHERE lower(trim(nombre)) = lower(trim($1)) AND id <> $2',
        [nombreRaw, id]
      );
      if (dup.rows.length > 0) {
        throw new ErrorNegocio(409, 'NOMBRE_DUPLICADO', 'Ya existe un proveedor con ese nombre');
      }
      nombre = nombreRaw;
    }

    let email = actual.email;
    if (body.email !== undefined) {
      email = validarEmail(body.email);
    }

    let contacto = actual.contacto;
    if (body.contacto !== undefined) {
      contacto = typeof body.contacto === 'string' && body.contacto.trim() ? body.contacto.trim() : null;
      if (contacto && contacto.length > 150) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El contacto no puede superar los 150 caracteres');
      }
    }

    let telefono = actual.telefono;
    if (body.telefono !== undefined) {
      telefono = typeof body.telefono === 'string' && body.telefono.trim() ? body.telefono.trim() : null;
      if (telefono && telefono.length > 40) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'El teléfono no puede superar los 40 caracteres');
      }
    }

    let notas = actual.notas;
    if (body.notas !== undefined) {
      notas = typeof body.notas === 'string' && body.notas.trim() ? body.notas.trim() : null;
      if (notas && notas.length > 1000) {
        throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Las notas no pueden superar los 1000 caracteres');
      }
    }

    let activo = actual.activo;
    if (body.activo !== undefined) {
      validarBooleano(body.activo, 'activo');
      activo = body.activo;
    }

    let mod: any;
    try {
      const upd = await client.query(
        `UPDATE proveedores
         SET nombre = $1, contacto = $2, telefono = $3, email = $4, notas = $5, activo = $6, actualizado_en = NOW()
         WHERE id = $7
         RETURNING id, nombre, contacto, telefono, email, notas, activo, creado_en, actualizado_en`,
        [nombre, contacto, telefono, email, notas, activo, id]
      );
      mod = upd.rows[0];
    } catch (dbErr: any) {
      if (dbErr.code === '23505' || dbErr.constraint === 'uq_proveedores_nombre') {
        throw new ErrorNegocio(409, 'NOMBRE_DUPLICADO', 'Ya existe un proveedor con ese nombre');
      }
      throw dbErr;
    }

    await client.query('COMMIT');

    const repCount = await pool.query(
      'SELECT COUNT(*)::int AS count FROM repuestos WHERE proveedor_id = $1 AND activo = TRUE',
      [id]
    );

    return c.json(
      {
        id: Number(mod.id),
        nombre: mod.nombre,
        contacto: mod.contacto || null,
        telefono: mod.telefono || null,
        email: mod.email || null,
        notas: mod.notas || null,
        activo: Boolean(mod.activo),
        repuestos_activos: Number(repCount.rows[0]?.count || 0),
      },
      200
    );
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

// DELETE /:id
proveedoresApp.delete('/:id', requirePermission('REPUESTOS_GESTIONAR'), async (c) => {
  const client = await pool.connect();
  try {
    const id = parseIdRuta(c.req.param('id'));
    if (!id) {
      throw new ErrorNegocio(404, 'PROVEEDOR_NO_ENCONTRADO', 'Proveedor no encontrado');
    }

    await client.query('BEGIN');

    const provRes = await client.query('SELECT id, activo FROM proveedores WHERE id = $1 FOR UPDATE', [id]);
    if (provRes.rows.length === 0) {
      throw new ErrorNegocio(404, 'PROVEEDOR_NO_ENCONTRADO', 'Proveedor no encontrado');
    }
    const prov = provRes.rows[0];

    if (!prov.activo) {
      await client.query('COMMIT');
      return c.json({ ok: true, mensaje: 'Proveedor ya inactivo' }, 200);
    }

    // Verificar si está en uso
    const repRes = await client.query(
      'SELECT COUNT(*)::int AS count FROM repuestos WHERE proveedor_id = $1 AND activo = TRUE',
      [id]
    );
    const repActivos = Number(repRes.rows[0]?.count || 0);

    const pedRes = await client.query(
      "SELECT COUNT(*)::int AS count FROM pedidos_repuesto WHERE proveedor_id = $1 AND estado IN ('PENDIENTE', 'PEDIDO')",
      [id]
    );
    const pedAbiertos = Number(pedRes.rows[0]?.count || 0);

    if (repActivos > 0 || pedAbiertos > 0) {
      throw new ErrorNegocio(409, 'EN_USO', 'El proveedor está en uso', {
        repuestos_activos: repActivos,
        pedidos_abiertos: pedAbiertos,
      });
    }

    await client.query('UPDATE proveedores SET activo = FALSE, actualizado_en = NOW() WHERE id = $1', [id]);
    await client.query('COMMIT');
    return c.json({ ok: true, mensaje: 'Proveedor desactivado' }, 200);
  } catch (err) {
    await client.query('ROLLBACK');
    return responderError(c, err);
  } finally {
    client.release();
  }
});

export default proveedoresApp;
