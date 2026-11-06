import { Hono } from 'hono';
import pg from 'pg';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission } from './middleware.ts';
import { parseId, parseString, badRequest, leerCuerpoObjeto } from './validations.ts';
import { responderError } from './intervenciones/errores.ts';

interface CatalogoConfig {
  tableName: 'criticidades' | 'tipos_equipo';
  nombreSingular: string;
  nombreEntidad: string;
  notFoundCode: string;
  columnaMaquina: 'criticidad_id' | 'tipo_equipo_id';
  tienePrioridadAlta: boolean;
}

function crearRouterCatalogo(config: CatalogoConfig) {
  const router = new Hono();
  router.use('*', jwtVerify, dbVerify);

  const {
    tableName,
    nombreSingular,
    nombreEntidad,
    notFoundCode,
    columnaMaquina,
    tienePrioridadAlta,
  } = config;

  async function consultarDetalle(clientOrPool: pg.Pool | pg.PoolClient, id: number) {
    const query = `
      SELECT
        t.id,
        t.codigo,
        t.nombre,
        t.orden,
        ${tienePrioridadAlta ? 't.prioridad_alta,' : ''}
        t.por_omision,
        t.activo,
        COUNT(m.id)::integer AS maquinas_activas
      FROM ${tableName} t
      LEFT JOIN maquinas m ON m.${columnaMaquina} = t.id AND m.activo = TRUE
      WHERE t.id = $1
      GROUP BY t.id, t.codigo, t.nombre, t.orden, ${tienePrioridadAlta ? 't.prioridad_alta,' : ''} t.por_omision, t.activo
    `;
    const { rows } = await clientOrPool.query(query, [id]);
    if (rows.length === 0) return null;
    const r = rows[0];
    const res: any = {
      id: Number(r.id),
      codigo: r.codigo,
      nombre: r.nombre,
      orden: Number(r.orden),
      por_omision: Boolean(r.por_omision),
      activo: Boolean(r.activo),
      maquinas_activas: Number(r.maquinas_activas),
    };
    if (tienePrioridadAlta) {
      res.prioridad_alta = Boolean(r.prioridad_alta);
    }
    return res;
  }

  // GET / (con o sin ?all=true)
  router.get('/', async (c) => {
    try {
      const showAll = c.req.query('all') === 'true';

      if (showAll) {
        const permisos = (c.get as any)('userPermissions') as string[] | undefined;
        if (!permisos || !permisos.includes('MAQUINAS_GESTIONAR')) {
          return c.json({ error: `No tienes permiso para ver ${tableName} desactivadas`, codigo: 'PERMISO_INSUFICIENTE' }, 403);
        }

        const query = `
          SELECT
            t.id,
            t.codigo,
            t.nombre,
            t.orden,
            ${tienePrioridadAlta ? 't.prioridad_alta,' : ''}
            t.por_omision,
            t.activo,
            COUNT(m.id)::integer AS maquinas_activas
          FROM ${tableName} t
          LEFT JOIN maquinas m ON m.${columnaMaquina} = t.id AND m.activo = TRUE
          GROUP BY t.id, t.codigo, t.nombre, t.orden, ${tienePrioridadAlta ? 't.prioridad_alta,' : ''} t.por_omision, t.activo
          ORDER BY t.orden ASC
        `;
        const { rows } = await pool.query(query);
        const result = rows.map((r) => {
          const item: any = {
            id: Number(r.id),
            codigo: r.codigo,
            nombre: r.nombre,
            orden: Number(r.orden),
            por_omision: Boolean(r.por_omision),
            activo: Boolean(r.activo),
            maquinas_activas: Number(r.maquinas_activas),
          };
          if (tienePrioridadAlta) {
            item.prioridad_alta = Boolean(r.prioridad_alta);
          }
          return item;
        });
        return c.json(result);
      }

      // Sin ?all=true: respuesta idéntica a la anterior
      const query = `
        SELECT
          id,
          codigo,
          nombre,
          orden,
          ${tienePrioridadAlta ? 'prioridad_alta,' : ''}
          por_omision
        FROM ${tableName}
        WHERE activo = TRUE
        ORDER BY orden ASC
      `;
      const { rows } = await pool.query(query);
      const result = rows.map((r) => {
        const item: any = {
          id: Number(r.id),
          codigo: r.codigo,
          nombre: r.nombre,
          orden: Number(r.orden),
          por_omision: Boolean(r.por_omision),
        };
        if (tienePrioridadAlta) {
          item.prioridad_alta = Boolean(r.prioridad_alta);
        }
        return item;
      });
      return c.json(result);
    } catch (error) {
      return responderError(c, error);
    }
  });

  // POST /
  router.post('/', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
    const parsedBody = await leerCuerpoObjeto(c);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    if ('orden' in body || 'por_omision' in body) {
      return badRequest(c, 'No se permite enviar orden ni por_omision en el alta');
    }

    const codigo = typeof body?.codigo === 'string' ? body.codigo.trim() : '';
    if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(codigo)) {
      return badRequest(c, 'El código es obligatorio y debe tener formato válido');
    }

    const nombre = typeof body?.nombre === 'string' ? body.nombre.trim() : '';
    if (nombre.length < 1 || nombre.length > 60) {
      return badRequest(c, 'El nombre es obligatorio y debe tener entre 1 y 60 caracteres');
    }

    let prioridadAlta = false;
    if (tienePrioridadAlta) {
      if ('prioridad_alta' in body) {
        if (typeof body.prioridad_alta !== 'boolean') {
          return badRequest(c, 'prioridad_alta debe ser booleano');
        }
        prioridadAlta = body.prioridad_alta;
      }
    } else {
      if ('prioridad_alta' in body) {
        return badRequest(c, 'El campo prioridad_alta no aplica a tipos de equipo');
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`LOCK TABLE ${tableName} IN SHARE ROW EXCLUSIVE MODE`);

      const resMax = await client.query(`SELECT COALESCE(MAX(orden), 0)::integer AS max_orden FROM ${tableName}`);
      const nextOrden = Number(resMax.rows[0].max_orden) + 1;

      let resInsert: pg.QueryResult;
      if (tienePrioridadAlta) {
        resInsert = await client.query(
          `INSERT INTO ${tableName} (codigo, nombre, orden, prioridad_alta, por_omision, activo)
           VALUES ($1, $2, $3, $4, FALSE, TRUE) RETURNING id`,
          [codigo, nombre, nextOrden, prioridadAlta]
        );
      } else {
        resInsert = await client.query(
          `INSERT INTO ${tableName} (codigo, nombre, orden, por_omision, activo)
           VALUES ($1, $2, $3, FALSE, TRUE) RETURNING id`,
          [codigo, nombre, nextOrden]
        );
      }

      const insertedId = Number(resInsert.rows[0].id);
      const creado = await consultarDetalle(client, insertedId);
      await client.query('COMMIT');
      return c.json(creado, 201);
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '23505') {
        const msg = (err.constraint || err.message || '').toLowerCase();
        if (msg.includes('codigo')) {
          return c.json({ error: `Ya existe un ${nombreSingular} con ese código`, codigo: 'CODIGO_DUPLICADO' }, 409);
        }
        if (msg.includes('nombre')) {
          return c.json({ error: `Ya existe un ${nombreSingular} con ese nombre`, codigo: 'NOMBRE_DUPLICADO' }, 409);
        }
      }
      console.error(`Error creando elemento en ${tableName}:`, err);
      return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
    } finally {
      client.release();
    }
  });

  // PUT /orden (se registra antes que /:id)
  router.put('/orden', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
    const parsedBody = await leerCuerpoObjeto(c);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    const ids: any[] = body?.ids;
    if (!Array.isArray(ids)) {
      return badRequest(c, 'ids debe ser un arreglo de números');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`LOCK TABLE ${tableName} IN SHARE ROW EXCLUSIVE MODE`);

      const resAll = await client.query(`SELECT id FROM ${tableName}`);
      const allIds = new Set(resAll.rows.map((r) => Number(r.id)));

      const parsedIds: number[] = [];
      for (const rawId of ids) {
        const idNum = typeof rawId === 'number'
          ? (Number.isInteger(rawId) && rawId > 0 ? rawId : null)
          : (typeof rawId === 'string' && /^\d+$/.test(rawId.trim()) ? parseId(rawId) : null);
        if (!idNum) {
          await client.query('ROLLBACK');
          return badRequest(c, 'Cada ID debe ser un entero positivo');
        }
        parsedIds.push(idNum);
      }

      if (parsedIds.length !== allIds.size || new Set(parsedIds).size !== parsedIds.length) {
        await client.query('ROLLBACK');
        return badRequest(c, 'La lista de IDs debe contener todas las filas sin repetir');
      }

      for (const idNum of parsedIds) {
        if (!allIds.has(idNum)) {
          await client.query('ROLLBACK');
          return badRequest(c, 'La lista contiene IDs inválidos o inexistentes');
        }
      }

      // Paso 1: orden = orden + MAX(orden)
      await client.query(`UPDATE ${tableName} SET orden = orden + (SELECT COALESCE(MAX(orden), 0) FROM ${tableName})`);

      // Paso 2: asignar orden definitivo 1, 2, 3...
      for (let i = 0; i < parsedIds.length; i++) {
        await client.query(`UPDATE ${tableName} SET orden = $1 WHERE id = $2`, [i + 1, parsedIds[i]]);
      }

      const queryAll = `
        SELECT
          t.id,
          t.codigo,
          t.nombre,
          t.orden,
          ${tienePrioridadAlta ? 't.prioridad_alta,' : ''}
          t.por_omision,
          t.activo,
          COUNT(m.id)::integer AS maquinas_activas
        FROM ${tableName} t
        LEFT JOIN maquinas m ON m.${columnaMaquina} = t.id AND m.activo = TRUE
        GROUP BY t.id, t.codigo, t.nombre, t.orden, ${tienePrioridadAlta ? 't.prioridad_alta,' : ''} t.por_omision, t.activo
        ORDER BY t.orden ASC
      `;
      const { rows } = await client.query(queryAll);
      const result = rows.map((r) => {
        const item: any = {
          id: Number(r.id),
          codigo: r.codigo,
          nombre: r.nombre,
          orden: Number(r.orden),
          por_omision: Boolean(r.por_omision),
          activo: Boolean(r.activo),
          maquinas_activas: Number(r.maquinas_activas),
        };
        if (tienePrioridadAlta) {
          item.prioridad_alta = Boolean(r.prioridad_alta);
        }
        return item;
      });

      await client.query('COMMIT');
      return c.json(result);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`Error actualizando orden en ${tableName}:`, err);
      return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
    } finally {
      client.release();
    }
  });

  // PUT /:id
  router.put('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const parsedBody = await leerCuerpoObjeto(c);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    if ('codigo' in body || 'orden' in body) {
      return badRequest(c, 'No se permite modificar el código ni el orden por esta ruta');
    }

    if ('por_omision' in body) {
      if (body.por_omision === false) {
        return badRequest(c, 'Para cambiar el valor por omisión, marque otro');
      }
      if (body.por_omision !== true) {
        return badRequest(c, 'por_omision debe ser booleano');
      }
    }

    if ('nombre' in body) {
      const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
      if (nombre.length < 1 || nombre.length > 60) {
        return badRequest(c, 'El nombre debe tener entre 1 y 60 caracteres');
      }
    }

    if ('prioridad_alta' in body) {
      if (!tienePrioridadAlta) {
        return badRequest(c, 'El campo prioridad_alta no aplica a tipos de equipo');
      }
      if (typeof body.prioridad_alta !== 'boolean') {
        return badRequest(c, 'prioridad_alta debe ser booleano');
      }
    }

    if ('activo' in body) {
      if (typeof body.activo !== 'boolean') {
        return badRequest(c, 'activo debe ser booleano');
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`LOCK TABLE ${tableName} IN SHARE ROW EXCLUSIVE MODE`);

      const resCurrent = await client.query(
        `SELECT id, codigo, nombre, orden, por_omision, activo ${tienePrioridadAlta ? ', prioridad_alta' : ''}
         FROM ${tableName} WHERE id = $1`,
        [id]
      );
      if (resCurrent.rows.length === 0) {
        await client.query('ROLLBACK');
        return c.json({ error: `${nombreEntidad} no encontrada`, codigo: notFoundCode }, 404);
      }
      const current = resCurrent.rows[0];

      const targetActivo = ('activo' in body) ? body.activo : Boolean(current.activo);

      if (body.por_omision === true) {
        if (!targetActivo) {
          await client.query('ROLLBACK');
          return badRequest(c, 'No se puede marcar por omisión una fila inactiva');
        }
      }

      if ('activo' in body && body.activo === false) {
        // Regla 1: Valor por omisión no se desactiva -> 409 ES_POR_OMISION (antes que EN_USO)
        if (Boolean(current.por_omision)) {
          await client.query('ROLLBACK');
          return c.json({ error: 'No se puede desactivar el valor por omisión', codigo: 'ES_POR_OMISION' }, 409);
        }

        // Regla 2: Máquinas activas que lo usan -> 409 EN_USO
        const resUso = await client.query(
          `SELECT COUNT(*)::integer AS total FROM maquinas WHERE ${columnaMaquina} = $1 AND activo = TRUE`,
          [id]
        );
        const maquinasActivas = Number(resUso.rows[0].total);
        if (maquinasActivas > 0) {
          await client.query('ROLLBACK');
          return c.json({
            error: `El ${nombreSingular} está asignado a máquinas activas`,
            codigo: 'EN_USO',
            maquinas_activas: maquinasActivas,
          }, 409);
        }
      }

      if (body.por_omision === true) {
        await client.query(`UPDATE ${tableName} SET por_omision = FALSE WHERE por_omision = TRUE AND id != $1`, [id]);
      }

      const sets: string[] = [];
      const params: any[] = [];

      if ('nombre' in body) {
        params.push(body.nombre.trim());
        sets.push(`nombre = $${params.length}`);
      }
      if (tienePrioridadAlta && 'prioridad_alta' in body) {
        params.push(body.prioridad_alta);
        sets.push(`prioridad_alta = $${params.length}`);
      }
      if (body.por_omision === true) {
        sets.push('por_omision = TRUE');
      }
      if ('activo' in body) {
        params.push(body.activo);
        sets.push(`activo = $${params.length}`);
      }

      if (sets.length > 0) {
        params.push(id);
        await client.query(`UPDATE ${tableName} SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      }

      const actualizado = await consultarDetalle(client, id);
      await client.query('COMMIT');
      return c.json(actualizado);
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '23505') {
        const msg = (err.constraint || err.message || '').toLowerCase();
        if (msg.includes('nombre')) {
          return c.json({ error: `Ya existe un ${nombreSingular} con ese nombre`, codigo: 'NOMBRE_DUPLICADO' }, 409);
        }
      }
      console.error(`Error actualizando ${tableName}:`, err);
      return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
    } finally {
      client.release();
    }
  });

  // DELETE /:id
  router.delete('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`LOCK TABLE ${tableName} IN SHARE ROW EXCLUSIVE MODE`);

      const resCurrent = await client.query(
        `SELECT id, por_omision, activo FROM ${tableName} WHERE id = $1`,
        [id]
      );
      if (resCurrent.rows.length === 0) {
        await client.query('ROLLBACK');
        return c.json({ error: `${nombreEntidad} no encontrada`, codigo: notFoundCode }, 404);
      }
      const current = resCurrent.rows[0];

      if (!current.activo) {
        await client.query('COMMIT');
        return c.json({ message: `${nombreEntidad} desactivada correctamente` });
      }

      if (Boolean(current.por_omision)) {
        await client.query('ROLLBACK');
        return c.json({ error: 'No se puede desactivar el valor por omisión', codigo: 'ES_POR_OMISION' }, 409);
      }

      const resUso = await client.query(
        `SELECT COUNT(*)::integer AS total FROM maquinas WHERE ${columnaMaquina} = $1 AND activo = TRUE`,
        [id]
      );
      const maquinasActivas = Number(resUso.rows[0].total);
      if (maquinasActivas > 0) {
        await client.query('ROLLBACK');
        return c.json({
          error: `El ${nombreSingular} está asignado a máquinas activas`,
          codigo: 'EN_USO',
          maquinas_activas: maquinasActivas,
        }, 409);
      }

      await client.query(`UPDATE ${tableName} SET activo = FALSE WHERE id = $1`, [id]);
      await client.query('COMMIT');
      return c.json({ message: `${nombreEntidad} desactivada correctamente` });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`Error desactivando ${tableName}:`, err);
      return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
    } finally {
      client.release();
    }
  });

  return router;
}

export const criticidadesApp = crearRouterCatalogo({
  tableName: 'criticidades',
  nombreSingular: 'criticidad',
  nombreEntidad: 'Criticidad',
  notFoundCode: 'CRITICIDAD_NO_ENCONTRADA',
  columnaMaquina: 'criticidad_id',
  tienePrioridadAlta: true,
});

export const tiposEquipoApp = crearRouterCatalogo({
  tableName: 'tipos_equipo',
  nombreSingular: 'tipo de equipo',
  nombreEntidad: 'Tipo de equipo',
  notFoundCode: 'TIPO_EQUIPO_NO_ENCONTRADO',
  columnaMaquina: 'tipo_equipo_id',
  tienePrioridadAlta: false,
});

/* =====================================================================
 * PLANTAS
 * ===================================================================== */
export const plantasApp = new Hono();
plantasApp.use('*', jwtVerify, dbVerify);

async function consultarPlantaDetalle(id: number) {
  const { rows } = await pool.query(
    `SELECT
       p.id, p.nombre, p.descripcion, p.activo,
       COUNT(s.id)::integer AS sectores_activos
     FROM plantas p
     LEFT JOIN sectores s ON s.planta_id = p.id AND s.activo = TRUE
     WHERE p.id = $1
     GROUP BY p.id, p.nombre, p.descripcion, p.activo`,
    [id]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    nombre: r.nombre,
    descripcion: r.descripcion ?? null,
    activo: Boolean(r.activo),
    sectores_activos: Number(r.sectores_activos),
  };
}

plantasApp.get('/', async (c) => {
  try {
    const showAll = c.req.query('all') === 'true';

    if (showAll) {
      const permisos = (c.get as any)('userPermissions') as string[] | undefined;
      if (!permisos || !permisos.includes('MAQUINAS_GESTIONAR')) {
        return c.json({ error: 'No tienes permiso para ver plantas desactivadas', codigo: 'PERMISO_INSUFICIENTE' }, 403);
      }

      const { rows } = await pool.query(
        `SELECT
           p.id, p.nombre, p.descripcion, p.activo,
           COUNT(s.id)::integer AS sectores_activos
         FROM plantas p
         LEFT JOIN sectores s ON s.planta_id = p.id AND s.activo = TRUE
         GROUP BY p.id, p.nombre, p.descripcion, p.activo
         ORDER BY p.nombre ASC`
      );
      const result = rows.map((r) => ({
        id: Number(r.id),
        nombre: r.nombre,
        descripcion: r.descripcion ?? null,
        activo: Boolean(r.activo),
        sectores_activos: Number(r.sectores_activos),
      }));
      return c.json(result);
    }

    const { rows } = await pool.query(
      `SELECT id, nombre, descripcion
       FROM plantas
       WHERE activo = TRUE
       ORDER BY nombre ASC`
    );
    const result = rows.map((r) => ({
      id: Number(r.id),
      nombre: r.nombre,
      descripcion: r.descripcion ?? null,
    }));
    return c.json(result);
  } catch (error) {
    return responderError(c, error);
  }
});

plantasApp.post('/', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const parsedBody = await leerCuerpoObjeto(c);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    const nombre = parseString(body.nombre);
    if (!nombre || nombre.length > 100) {
      return badRequest(c, 'El nombre de la planta es requerido y debe tener hasta 100 caracteres');
    }

    let descripcion: string | null = null;
    if ('descripcion' in body) {
      const raw = body.descripcion;
      if (raw !== null && raw !== '') {
        if (typeof raw !== 'string') return badRequest(c, 'La descripcion es inválida');
        const trimmed = raw.trim();
        descripcion = trimmed === '' ? null : trimmed;
      }
    }

    const { rows } = await pool.query(
      'INSERT INTO plantas (nombre, descripcion, activo) VALUES ($1, $2, TRUE) RETURNING id',
      [nombre, descripcion]
    );

    const insertedId = Number(rows[0].id);
    const creada = await consultarPlantaDetalle(insertedId);
    return c.json(creada, 201);
  } catch (error: any) {
    console.error('Error creando planta:', error);
    if (error.code === '23505') {
      return c.json({ error: 'Ya existe una planta con ese nombre', codigo: 'NOMBRE_DUPLICADO' }, 409);
    }
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

plantasApp.put('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const parsedBody = await leerCuerpoObjeto(c);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    const resActual = await pool.query('SELECT id, activo FROM plantas WHERE id = $1', [id]);
    if (resActual.rows.length === 0) {
      return c.json({ error: 'Planta no encontrada', codigo: 'PLANTA_NO_ENCONTRADA' }, 404);
    }

    const sets: string[] = [];
    const params: any[] = [];

    if ('nombre' in body) {
      const nombre = parseString(body.nombre);
      if (!nombre || nombre.length > 100) {
        return badRequest(c, 'El nombre debe tener hasta 100 caracteres');
      }
      params.push(nombre);
      sets.push(`nombre = $${params.length}`);
    }

    if ('descripcion' in body) {
      const raw = body.descripcion;
      let descripcion: string | null = null;
      if (raw === null || raw === '') {
        descripcion = null;
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim();
        descripcion = trimmed === '' ? null : trimmed;
      } else {
        return badRequest(c, 'El campo descripcion es inválido');
      }
      params.push(descripcion);
      sets.push(`descripcion = $${params.length}`);
    }

    if ('activo' in body) {
      if (typeof body.activo !== 'boolean') {
        return badRequest(c, 'El campo activo debe ser booleano');
      }

      if (body.activo === false) {
        const resUso = await pool.query(
          'SELECT COUNT(*)::integer AS total FROM sectores WHERE planta_id = $1 AND activo = TRUE',
          [id]
        );
        const sectores_activos = Number(resUso.rows[0].total);
        if (sectores_activos > 0) {
          return c.json({
            error: 'La planta tiene sectores activos asociados',
            codigo: 'EN_USO',
            sectores_activos,
          }, 409);
        }
      }

      params.push(body.activo);
      sets.push(`activo = $${params.length}`);
    }

    if (sets.length > 0) {
      params.push(id);
      await pool.query(`UPDATE plantas SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }

    const actualizado = await consultarPlantaDetalle(id);
    return c.json(actualizado);
  } catch (error: any) {
    console.error('Error actualizando planta:', error);
    if (error.code === '23505') {
      return c.json({ error: 'Ya existe una planta con ese nombre', codigo: 'NOMBRE_DUPLICADO' }, 409);
    }
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

plantasApp.delete('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const resActual = await pool.query('SELECT id, activo FROM plantas WHERE id = $1', [id]);
    if (resActual.rows.length === 0) {
      return c.json({ error: 'Planta no encontrada', codigo: 'PLANTA_NO_ENCONTRADA' }, 404);
    }

    if (!resActual.rows[0].activo) {
      return c.json({ message: 'Planta desactivada correctamente' });
    }

    const resUso = await pool.query(
      'SELECT COUNT(*)::integer AS total FROM sectores WHERE planta_id = $1 AND activo = TRUE',
      [id]
    );
    const sectores_activos = Number(resUso.rows[0].total);
    if (sectores_activos > 0) {
      return c.json({
        error: 'La planta tiene sectores activos asociados',
        codigo: 'EN_USO',
        sectores_activos,
      }, 409);
    }

    await pool.query('UPDATE plantas SET activo = FALSE WHERE id = $1', [id]);
    return c.json({ message: 'Planta desactivada correctamente' });
  } catch (error) {
    console.error('Error desactivando planta:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});
