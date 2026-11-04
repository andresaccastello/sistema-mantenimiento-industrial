import { Hono } from 'hono';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission } from './middleware.ts';
import { parseId, parseString, badRequest } from './validations.ts';

const sectoresApp = new Hono();

sectoresApp.use('*', jwtVerify, dbVerify);

function mapearFilaSector(r: any) {
  return {
    id: Number(r.id),
    nombre: r.nombre,
    descripcion: r.descripcion ?? null,
    activo: Boolean(r.activo),
    creado_en: r.creado_en,
    planta:
      r.planta_id != null
        ? {
            id: Number(r.planta_id),
            nombre: r.planta_nombre,
          }
        : null,
  };
}

async function consultarSectores(whereClause: string, params: any[] = []) {
  const { rows } = await pool.query(
    `SELECT
       s.id,
       s.nombre,
       s.descripcion,
       s.activo,
       s.creado_en,
       p.id AS planta_id,
       p.nombre AS planta_nombre
     FROM sectores s
     LEFT JOIN plantas p ON s.planta_id = p.id
     ${whereClause}
     ORDER BY s.nombre`,
    params
  );
  return rows.map(mapearFilaSector);
}

async function validatePlanta(planta_id: number): Promise<boolean> {
  const pRes = await pool.query('SELECT activo FROM plantas WHERE id = $1', [planta_id]);
  return pRes.rows.length > 0 && Boolean(pRes.rows[0].activo);
}

async function consultarSectorDetalle(id: number) {
  const { rows } = await pool.query(
    `SELECT
       s.id,
       s.nombre,
       s.descripcion,
       s.activo,
       s.creado_en,
       p.id AS planta_id,
       p.nombre AS planta_nombre,
       (SELECT COUNT(*)::integer FROM maquinas m WHERE m.sector_id = s.id AND m.activo = TRUE) AS maquinas_activas,
       (SELECT COUNT(*)::integer FROM usuario_sector us JOIN usuarios u ON us.usuario_id = u.id WHERE us.sector_id = s.id AND u.activo = TRUE) AS usuarios_activos
     FROM sectores s
     LEFT JOIN plantas p ON s.planta_id = p.id
     WHERE s.id = $1`,
    [id]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    nombre: r.nombre,
    descripcion: r.descripcion ?? null,
    activo: Boolean(r.activo),
    creado_en: r.creado_en,
    planta:
      r.planta_id != null
        ? {
            id: Number(r.planta_id),
            nombre: r.planta_nombre,
          }
        : null,
    maquinas_activas: Number(r.maquinas_activas),
    usuarios_activos: Number(r.usuarios_activos),
  };
}

sectoresApp.get('/', async (c) => {
  try {
    const showAll = c.req.query('all') === 'true';

    if (showAll) {
      const permisos = (c.get as any)('userPermissions') as string[] | undefined;
      if (!permisos || !permisos.includes('MAQUINAS_GESTIONAR')) {
        return c.json({ error: 'No tienes permiso para ver sectores desactivados', codigo: 'PERMISO_INSUFICIENTE' }, 403);
      }

      const { rows } = await pool.query(`
        SELECT
          s.id,
          s.nombre,
          s.descripcion,
          s.activo,
          s.creado_en,
          p.id AS planta_id,
          p.nombre AS planta_nombre,
          (SELECT COUNT(*)::integer FROM maquinas m WHERE m.sector_id = s.id AND m.activo = TRUE) AS maquinas_activas,
          (SELECT COUNT(*)::integer FROM usuario_sector us JOIN usuarios u ON us.usuario_id = u.id WHERE us.sector_id = s.id AND u.activo = TRUE) AS usuarios_activos
        FROM sectores s
        LEFT JOIN plantas p ON s.planta_id = p.id
        ORDER BY s.nombre ASC
      `);

      return c.json(
        rows.map((r) => ({
          id: Number(r.id),
          nombre: r.nombre,
          descripcion: r.descripcion ?? null,
          activo: Boolean(r.activo),
          creado_en: r.creado_en,
          planta:
            r.planta_id != null
              ? {
                  id: Number(r.planta_id),
                  nombre: r.planta_nombre,
                }
              : null,
          maquinas_activas: Number(r.maquinas_activas),
          usuarios_activos: Number(r.usuarios_activos),
        }))
      );
    }

    const result = await consultarSectores('WHERE s.activo = TRUE');
    return c.json(result);
  } catch (error) {
    console.error('Error obteniendo sectores:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

sectoresApp.get('/:id', async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const result = await consultarSectores('WHERE s.id = $1', [id]);
    if (result.length === 0) {
      return c.json({ error: 'Sector no encontrado', codigo: 'SECTOR_NO_ENCONTRADO' }, 404);
    }
    return c.json(result[0]);
  } catch (error) {
    console.error('Error obteniendo sector:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

sectoresApp.post('/', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const body = await c.req.json();
    const nombre = parseString(body.nombre);

    if (!nombre) return badRequest(c, 'El nombre del sector es requerido y no puede estar vacío');
    const descripcion = parseString(body.descripcion);

    let planta_id: number | null = null;
    if (body.planta_id !== undefined && body.planta_id !== null && body.planta_id !== '') {
      planta_id = parseId(body.planta_id);
      if (!planta_id || !(await validatePlanta(planta_id))) {
        return badRequest(c, 'La planta indicada no existe o está inactiva');
      }
    }

    const { rows } = await pool.query(
      'INSERT INTO sectores (nombre, descripcion, planta_id) VALUES ($1, $2, $3) RETURNING id',
      [nombre, descripcion, planta_id]
    );

    const insertedId = Number(rows[0].id);
    const creado = await consultarSectorDetalle(insertedId);
    return c.json(creado, 201);
  } catch (error: any) {
    console.error('Error creando sector:', error);
    if (error.code === '23505') {
      return c.json({ error: 'Ya existe un sector con ese nombre', codigo: 'NOMBRE_DUPLICADO' }, 409);
    }
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

sectoresApp.put('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const body = await c.req.json();

    const resActual = await pool.query('SELECT id, activo, planta_id FROM sectores WHERE id = $1', [id]);
    if (resActual.rows.length === 0) {
      return c.json({ error: 'Sector no encontrado', codigo: 'SECTOR_NO_ENCONTRADO' }, 404);
    }

    const sets: string[] = [];
    const params: any[] = [];

    if ('nombre' in body) {
      const nombre = parseString(body.nombre);
      if (!nombre) return badRequest(c, 'El nombre del sector es requerido y no puede estar vacío');
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

    if ('planta_id' in body) {
      const raw = body.planta_id;
      let planta_id: number | null = null;
      if (raw === null || raw === '') {
        planta_id = null;
      } else {
        planta_id = parseId(raw);
        if (!planta_id || !(await validatePlanta(planta_id))) {
          return badRequest(c, 'La planta indicada no existe o está inactiva');
        }
      }
      params.push(planta_id);
      sets.push(`planta_id = $${params.length}`);
    }

    if ('activo' in body) {
      if (typeof body.activo !== 'boolean') {
        return badRequest(c, 'El campo activo debe ser booleano');
      }

      if (body.activo === false) {
        const resUso = await pool.query(
          `SELECT
             (SELECT COUNT(*)::integer FROM maquinas WHERE sector_id = $1 AND activo = TRUE) AS maquinas_activas,
             (SELECT COUNT(*)::integer FROM usuario_sector us JOIN usuarios u ON us.usuario_id = u.id WHERE us.sector_id = $1 AND u.activo = TRUE) AS usuarios_activos`,
          [id]
        );
        const maquinas_activas = Number(resUso.rows[0].maquinas_activas);
        const usuarios_activos = Number(resUso.rows[0].usuarios_activos);
        if (maquinas_activas > 0 || usuarios_activos > 0) {
          return c.json({
            error: 'El sector tiene máquinas o usuarios activos asignados',
            codigo: 'EN_USO',
            maquinas_activas,
            usuarios_activos,
          }, 409);
        }
      } else if (body.activo === true) {
        let plantaEfectivaId: number | null = null;
        if ('planta_id' in body) {
          plantaEfectivaId = (body.planta_id === null || body.planta_id === '') ? null : parseId(body.planta_id);
        } else if (resActual.rows[0].planta_id != null) {
          plantaEfectivaId = Number(resActual.rows[0].planta_id);
        }
        if (plantaEfectivaId && !(await validatePlanta(plantaEfectivaId))) {
          return badRequest(c, 'La planta del sector está inactiva');
        }
      }

      params.push(body.activo);
      sets.push(`activo = $${params.length}`);
    }

    if (sets.length > 0) {
      params.push(id);
      await pool.query(
        `UPDATE sectores SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params
      );
    }

    const actualizado = await consultarSectorDetalle(id);
    return c.json(actualizado);
  } catch (error: any) {
    console.error('Error actualizando sector:', error);
    if (error.code === '23505') {
      return c.json({ error: 'Ya existe otro sector con ese nombre', codigo: 'NOMBRE_DUPLICADO' }, 409);
    }
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

sectoresApp.delete('/:id', requirePermission('MAQUINAS_GESTIONAR'), async (c) => {
  try {
    const id = parseId(c.req.param('id'));
    if (!id) return badRequest(c, 'ID inválido');

    const resActual = await pool.query('SELECT id, activo FROM sectores WHERE id = $1', [id]);
    if (resActual.rows.length === 0) {
      return c.json({ error: 'Sector no encontrado', codigo: 'SECTOR_NO_ENCONTRADO' }, 404);
    }

    if (!resActual.rows[0].activo) {
      return c.json({ message: 'Sector desactivado correctamente' });
    }

    const resUso = await pool.query(
      `SELECT
         (SELECT COUNT(*)::integer FROM maquinas WHERE sector_id = $1 AND activo = TRUE) AS maquinas_activas,
         (SELECT COUNT(*)::integer FROM usuario_sector us JOIN usuarios u ON us.usuario_id = u.id WHERE us.sector_id = $1 AND u.activo = TRUE) AS usuarios_activos`,
      [id]
    );
    const maquinas_activas = Number(resUso.rows[0].maquinas_activas);
    const usuarios_activos = Number(resUso.rows[0].usuarios_activos);
    if (maquinas_activas > 0 || usuarios_activos > 0) {
      return c.json({
        error: 'El sector tiene máquinas o usuarios activos asignados',
        codigo: 'EN_USO',
        maquinas_activas,
        usuarios_activos,
      }, 409);
    }

    await pool.query('UPDATE sectores SET activo = FALSE WHERE id = $1', [id]);
    return c.json({ message: 'Sector desactivado correctamente' });
  } catch (error) {
    console.error('Error desactivando sector:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

export default sectoresApp;
