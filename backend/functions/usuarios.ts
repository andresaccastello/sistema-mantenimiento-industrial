import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission } from './middleware.ts';
import { parseId, parseEnteroTexto } from './validations.ts';
import { resolverPermisosEfectivos, AlcancePermiso } from './intervenciones/permisos.ts';

const SCOPE_HIERARCHY: Record<AlcancePermiso, number> = {
  PROPIAS: 1,
  SECTORES: 2,
  TODAS: 3,
};

export const usuariosApp = new Hono();
export const perfilesApp = new Hono();
export const permisosApp = new Hono();

// Todos los endpoints de usuarios, perfiles y permisos requieren USUARIOS_GESTIONAR
usuariosApp.use('*', jwtVerify, dbVerify, requirePermission('USUARIOS_GESTIONAR'));
perfilesApp.use('*', jwtVerify, dbVerify, requirePermission('USUARIOS_GESTIONAR'));
permisosApp.use('*', jwtVerify, dbVerify, requirePermission('USUARIOS_GESTIONAR'));

/**
 * Valida que el actor posea todos los permisos del perfil a asignar
 * con alcance igual o superior (D-42, RN-57, Regla 2 sección 5.3)
 */
async function validarAsignacionPerfil(
  client: pg.PoolClient,
  actorUserId: number,
  targetPerfilId: number
): Promise<{ ok: boolean; error?: string; codigo?: string }> {
  const actorInfo = await resolverPermisosEfectivos(client, actorUserId);
  const actorPermMap = actorInfo.permisos;

  const resTargetPerms = await client.query(`
    SELECT pe.codigo, pp.alcance
    FROM perfil_permiso pp
    JOIN permisos pe ON pp.permiso_id = pe.id
    WHERE pp.perfil_id = $1
  `, [targetPerfilId]);

  for (const row of resTargetPerms.rows) {
    const permCode: string = row.codigo;
    const targetScope: AlcancePermiso = row.alcance || 'TODAS';

    if (!(permCode in actorPermMap)) {
      return {
        ok: false,
        error: `No posee el permiso ${permCode} requerido por el perfil a asignar`,
        codigo: 'PERFIL_NO_ASIGNABLE',
      };
    }

    const actorScope = actorPermMap[permCode];
    const actorLevel = SCOPE_HIERARCHY[actorScope] || 0;
    const targetLevel = SCOPE_HIERARCHY[targetScope] || 0;

    if (actorLevel < targetLevel) {
      return {
        ok: false,
        error: `Alcance insuficiente para el permiso ${permCode}`,
        codigo: 'PERFIL_NO_ASIGNABLE',
      };
    }
  }

  return { ok: true };
}

/**
 * Bloquea primero a TODOS los administradores activos y al usuario afectado
 * en una sola consulta ordenada por id (ORDER BY u.id ASC FOR UPDATE OF u).
 * Esto previene deadlocks entre transacciones concurrentes (D-42, U.1).
 */
interface TargetYAdminsBloqueados {
  target: {
    id: number;
    legajo: string;
    nombre: string;
    apellido: string | null;
    email: string | null;
    telefono_whatsapp: string | null;
    perfil_id: number;
    activo: boolean;
    perfil_nombre: string;
  } | null;
  activeAdminIds: number[];
  esUltimoAdmin: boolean;
}

async function bloquearUsuarioYAdministradores(
  client: pg.PoolClient,
  targetUserId: number
): Promise<TargetYAdminsBloqueados> {
  const res = await client.query(`
    SELECT 
      u.id, 
      u.legajo, 
      u.nombre, 
      u.apellido, 
      u.email,
      u.telefono_whatsapp,
      u.perfil_id, 
      u.activo,
      p.nombre AS perfil_nombre
    FROM usuarios u
    LEFT JOIN perfiles p ON u.perfil_id = p.id
    WHERE u.id = $1 
       OR (p.nombre = 'ADMINISTRADOR' AND u.activo = TRUE)
    ORDER BY u.id ASC
    FOR UPDATE OF u
  `, [targetUserId]);

  const targetRow = res.rows.find((r) => Number(r.id) === targetUserId) || null;
  const activeAdminIds = res.rows
    .filter((r) => r.perfil_nombre === 'ADMINISTRADOR' && r.activo)
    .map((r) => Number(r.id));

  const isTargetAdmin = targetRow
    ? (targetRow.perfil_nombre === 'ADMINISTRADOR' && Boolean(targetRow.activo))
    : false;

  const esUltimoAdmin = isTargetAdmin && activeAdminIds.length <= 1;

  return {
    target: targetRow
      ? {
          id: Number(targetRow.id),
          legajo: targetRow.legajo,
          nombre: targetRow.nombre,
          apellido: targetRow.apellido,
          email: targetRow.email,
          telefono_whatsapp: targetRow.telefono_whatsapp,
          perfil_id: Number(targetRow.perfil_id),
          activo: Boolean(targetRow.activo),
          perfil_nombre: targetRow.perfil_nombre,
        }
      : null,
    activeAdminIds,
    esUltimoAdmin,
  };
}

/* =====================================================================
 * GET /api/perfiles
 * ===================================================================== */
perfilesApp.get('/', async (c) => {
  try {
    const res = await pool.query(`
      SELECT 
        p.id,
        p.nombre,
        p.descripcion,
        p.activo,
        (
          SELECT COUNT(*)::integer
          FROM usuarios u
          WHERE u.perfil_id = p.id AND u.activo = TRUE
        ) AS usuarios_activos,
        (
          SELECT COALESCE(json_agg(
            json_build_object('codigo', pe.codigo, 'nombre', pe.nombre, 'alcance', pp.alcance)
            ORDER BY pe.codigo ASC
          ), '[]'::json)
          FROM perfil_permiso pp
          JOIN permisos pe ON pp.permiso_id = pe.id
          WHERE pp.perfil_id = p.id
        ) AS permisos
      FROM perfiles p
      WHERE p.activo = TRUE
      ORDER BY p.nombre ASC
    `);

    return c.json(
      res.rows.map((r) => ({
        id: Number(r.id),
        nombre: r.nombre,
        descripcion: r.descripcion,
        activo: Boolean(r.activo),
        usuarios_activos: Number(r.usuarios_activos),
        permisos: r.permisos,
      }))
    );
  } catch (error) {
    console.error('Error al listar perfiles:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

/* =====================================================================
 * GET /api/permisos
 * ===================================================================== */
permisosApp.get('/', async (c) => {
  try {
    const res = await pool.query(`
      SELECT id, codigo, nombre, descripcion, usa_alcance
      FROM permisos
      ORDER BY codigo ASC
    `);

    return c.json(
      res.rows.map((r) => ({
        id: Number(r.id),
        codigo: r.codigo,
        nombre: r.nombre,
        descripcion: r.descripcion,
        usa_alcance: Boolean(r.usa_alcance),
      }))
    );
  } catch (error) {
    console.error('Error al listar catálogo de permisos:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

/* =====================================================================
 * GET /api/usuarios
 * ===================================================================== */
usuariosApp.get('/', async (c) => {
  try {
    const activoParam = c.req.query('activo');
    const perfilIdParam = c.req.query('perfil_id');
    const textoParam = c.req.query('texto');

    const conditions: string[] = [];
    const values: any[] = [];

    if (activoParam !== undefined && activoParam !== '') {
      if (activoParam === 'true') {
        conditions.push('u.activo = TRUE');
      } else if (activoParam === 'false') {
        conditions.push('u.activo = FALSE');
      }
    }

    if (perfilIdParam !== undefined && perfilIdParam !== '') {
      const perfilIdNum = parseId(perfilIdParam);
      if (perfilIdNum) {
        values.push(perfilIdNum);
        conditions.push(`u.perfil_id = $${values.length}`);
      }
    }

    if (textoParam && textoParam.trim().length > 0) {
      values.push(`%${textoParam.trim()}%`);
      const idx = values.length;
      conditions.push(`(u.legajo ILIKE $${idx} OR u.nombre ILIKE $${idx} OR COALESCE(u.apellido, '') ILIKE $${idx})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        u.id, 
        u.legajo, 
        u.nombre, 
        u.apellido, 
        u.email,
        u.telefono_whatsapp,
        u.activo,
        u.ultimo_acceso_en,
        u.debe_cambiar_password,
        json_build_object('id', p.id, 'nombre', p.nombre) AS perfil,
        (
          SELECT COALESCE(json_agg(json_build_object('id', s.id, 'nombre', s.nombre) ORDER BY s.nombre ASC), '[]'::json)
          FROM usuario_sector us
          JOIN sectores s ON us.sector_id = s.id
          WHERE us.usuario_id = u.id
        ) AS sectores
      FROM usuarios u
      JOIN perfiles p ON u.perfil_id = p.id
      ${whereClause}
      ORDER BY u.apellido ASC NULLS LAST, u.nombre ASC, u.legajo ASC
    `;

    const res = await pool.query(query, values);

    return c.json(
      res.rows.map((r) => ({
        id: Number(r.id),
        legajo: r.legajo,
        nombre: r.nombre,
        apellido: r.apellido,
        email: r.email,
        telefono_whatsapp: r.telefono_whatsapp,
        perfil: r.perfil,
        sectores: r.sectores,
        activo: Boolean(r.activo),
        ultimo_acceso_en: r.ultimo_acceso_en,
        debe_cambiar_password: Boolean(r.debe_cambiar_password),
      }))
    );
  } catch (error) {
    console.error('Error al listar usuarios:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

/* =====================================================================
 * Función compartida: obtenerDetalleUsuario
 * (Usada por GET /:id, PUT /:id/excepciones/:codigo y DELETE /:id/excepciones/:codigo)
 * ===================================================================== */
export async function obtenerDetalleUsuario(
  db: pg.Pool | pg.PoolClient,
  userId: number
) {
  const resUser = await db.query(`
    SELECT 
      u.id, 
      u.legajo, 
      u.nombre, 
      u.apellido, 
      u.email,
      u.telefono_whatsapp,
      u.activo,
      u.ultimo_acceso_en,
      u.debe_cambiar_password,
      u.creado_en,
      u.actualizado_en,
      json_build_object('id', p.id, 'nombre', p.nombre) AS perfil,
      (
        SELECT COALESCE(json_agg(json_build_object('id', s.id, 'nombre', s.nombre) ORDER BY s.nombre ASC), '[]'::json)
        FROM usuario_sector us
        JOIN sectores s ON us.sector_id = s.id
        WHERE us.usuario_id = u.id
      ) AS sectores
    FROM usuarios u
    JOIN perfiles p ON u.perfil_id = p.id
    WHERE u.id = $1
  `, [userId]);

  if (resUser.rows.length === 0) {
    return null;
  }

  const row = resUser.rows[0];

  // Permisos efectivos
  const effectiveInfo = await resolverPermisosEfectivos(db, userId);

  // Excepciones individuales registradas en usuario_permiso
  const resEx = await db.query(`
    SELECT 
      up.id, 
      pe.codigo, 
      pe.nombre, 
      pe.usa_alcance,
      up.efecto, 
      up.alcance, 
      up.motivo, 
      up.creado_en,
      u_otorg.id AS otorgado_por_id,
      u_otorg.nombre AS otorgado_por_nombre,
      u_otorg.apellido AS otorgado_por_apellido
    FROM usuario_permiso up
    JOIN permisos pe ON up.permiso_id = pe.id
    LEFT JOIN usuarios u_otorg ON up.otorgado_por_usuario_id = u_otorg.id
    WHERE up.usuario_id = $1
    ORDER BY pe.codigo ASC
  `, [userId]);

  // Cantidad de intervenciones abiertas de las que es responsable
  const resAbiertas = await db.query(`
    SELECT COUNT(*)::integer AS abiertas
    FROM intervenciones
    WHERE responsable_usuario_id = $1
      AND estado NOT IN ('FINALIZADA', 'CANCELADA')
      AND eliminado_en IS NULL
  `, [userId]);

  return {
    id: Number(row.id),
    legajo: row.legajo,
    nombre: row.nombre,
    apellido: row.apellido,
    email: row.email,
    telefono_whatsapp: row.telefono_whatsapp,
    perfil: row.perfil,
    sectores: row.sectores,
    activo: Boolean(row.activo),
    ultimo_acceso_en: row.ultimo_acceso_en,
    debe_cambiar_password: Boolean(row.debe_cambiar_password),
    creado_en: row.creado_en,
    actualizado_en: row.actualizado_en,
    permisos: effectiveInfo.permisos,
    excepciones: resEx.rows.map((r) => ({
      id: Number(r.id),
      codigo: r.codigo,
      nombre: r.nombre,
      efecto: r.efecto,
      alcance: r.alcance,
      motivo: r.motivo,
      creado_en: r.creado_en,
      usa_alcance: Boolean(r.usa_alcance),
      otorgado_por: r.otorgado_por_id
        ? {
            id: Number(r.otorgado_por_id),
            nombre: r.otorgado_por_nombre,
            apellido: r.otorgado_por_apellido,
          }
        : null,
    })),
    intervenciones_abiertas_como_responsable: Number(resAbiertas.rows[0].abiertas),
  };
}

/* =====================================================================
 * GET /api/usuarios/:id
 * ===================================================================== */
usuariosApp.get('/:id', async (c) => {
  const idStr = c.req.param('id');
  const userId = parseId(idStr);

  if (!userId) {
    return c.json({ error: 'Identificador de usuario inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  try {
    const detalle = await obtenerDetalleUsuario(pool, userId);
    if (!detalle) {
      return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
    }

    return c.json(detalle);
  } catch (error) {
    console.error('Error al obtener usuario por id:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

/* =====================================================================
 * GET /api/usuarios/:id/auditoria (Historial de usuario - sección 5.3)
 * ===================================================================== */
usuariosApp.get('/:id/auditoria', async (c) => {
  const idStr = c.req.param('id');
  const userId = parseId(idStr);

  if (!userId) {
    return c.json({ error: 'Identificador de usuario inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  const limitParam = c.req.query('limit');
  let limit = 50;
  if (limitParam !== undefined) {
    const parsedLimit = parseEnteroTexto(limitParam, 0);
    if (parsedLimit === null) {
      return c.json({ error: 'Parámetro limit inválido', codigo: 'DATOS_INVALIDOS' }, 400);
    }
    limit = parsedLimit;
    if (limit < 1 || limit > 200) {
      return c.json({ error: 'limit debe estar entre 1 y 200', codigo: 'DATOS_INVALIDOS' }, 400);
    }
  }

  const offsetParam = c.req.query('offset');
  let offset = 0;
  if (offsetParam !== undefined) {
    const parsedOffset = parseEnteroTexto(offsetParam, 0);
    if (parsedOffset === null) {
      return c.json({ error: 'Parámetro offset inválido', codigo: 'DATOS_INVALIDOS' }, 400);
    }
    offset = parsedOffset;
  }

  try {
    const resExiste = await pool.query('SELECT id FROM usuarios WHERE id = $1', [userId]);
    if (resExiste.rows.length === 0) {
      return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
    }

    const resCount = await pool.query(`
      SELECT COUNT(*)::integer AS total
      FROM auditoria_permisos
      WHERE sobre_usuario_id = $1
    `, [userId]);
    const total = Number(resCount.rows[0].total);

    const resRows = await pool.query(`
      SELECT 
        a.id,
        a.accion,
        a.creado_en,
        a.realizado_por_usuario_id,
        u.nombre AS realizado_por_nombre,
        u.apellido AS realizado_por_apellido,
        a.detalle
      FROM auditoria_permisos a
      LEFT JOIN usuarios u ON u.id = a.realizado_por_usuario_id
      WHERE a.sobre_usuario_id = $1
      ORDER BY a.creado_en DESC, a.id DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);

    const perfilIdsSet = new Set<number>();
    const sectorIdsSet = new Set<number>();

    const registros = resRows.rows.map((r) => {
      let detalleParsed: any = null;
      if (r.detalle !== null && r.detalle !== undefined) {
        try {
          detalleParsed = JSON.parse(r.detalle);
        } catch {
          detalleParsed = r.detalle;
        }
      }

      // Recolectar referencias de perfiles y sectores
      if (detalleParsed && typeof detalleParsed === 'object') {
        if (r.accion === 'PERFIL_CAMBIADO') {
          if (detalleParsed.anterior) perfilIdsSet.add(Number(detalleParsed.anterior));
          if (detalleParsed.nuevo) perfilIdsSet.add(Number(detalleParsed.nuevo));
        } else if (r.accion === 'SECTORES_CAMBIADOS') {
          if (Array.isArray(detalleParsed.anterior)) {
            detalleParsed.anterior.forEach((s: any) => sectorIdsSet.add(Number(s)));
          }
          if (Array.isArray(detalleParsed.nuevo)) {
            detalleParsed.nuevo.forEach((s: any) => sectorIdsSet.add(Number(s)));
          }
        } else if (r.accion === 'USUARIO_CREADO') {
          if (detalleParsed.perfil_id) perfilIdsSet.add(Number(detalleParsed.perfil_id));
          if (Array.isArray(detalleParsed.sectores)) {
            detalleParsed.sectores.forEach((s: any) => sectorIdsSet.add(Number(s)));
          }
        }
      }

      let realizado_por: { id: number; nombre: string; apellido: string | null } | null = null;
      if (r.realizado_por_usuario_id && r.realizado_por_nombre) {
        realizado_por = {
          id: Number(r.realizado_por_usuario_id),
          nombre: r.realizado_por_nombre,
          apellido: r.realizado_por_apellido,
        };
      }

      return {
        id: Number(r.id),
        accion: r.accion,
        creado_en: r.creado_en instanceof Date ? r.creado_en.toISOString() : r.creado_en,
        realizado_por,
        detalle: detalleParsed,
      };
    });

    const referencias: {
      perfiles: Record<string, string>;
      sectores: Record<string, string>;
    } = {
      perfiles: {},
      sectores: {},
    };

    const perfilIds = Array.from(perfilIdsSet).filter((n) => Number.isInteger(n) && n > 0);
    if (perfilIds.length > 0) {
      const resPerfiles = await pool.query(`
        SELECT id, nombre FROM perfiles WHERE id = ANY($1::bigint[])
      `, [perfilIds]);
      for (const p of resPerfiles.rows) {
        referencias.perfiles[String(p.id)] = p.nombre;
      }
    }

    const sectorIds = Array.from(sectorIdsSet).filter((n) => Number.isInteger(n) && n > 0);
    if (sectorIds.length > 0) {
      const resSectores = await pool.query(`
        SELECT id, nombre FROM sectores WHERE id = ANY($1::bigint[])
      `, [sectorIds]);
      for (const s of resSectores.rows) {
        referencias.sectores[String(s.id)] = s.nombre;
      }
    }

    return c.json({
      total,
      registros,
      referencias,
    });
  } catch (error) {
    console.error('Error al consultar auditoría de usuario:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  }
});

/* =====================================================================
 * POST /api/usuarios
 * ===================================================================== */
usuariosApp.post('/', async (c) => {
  const actorUserId = (c.get as any)('userId') as number;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Cuerpo de solicitud inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  const { legajo, nombre, apellido, email, telefono_whatsapp, perfil_id, sectores, password_temporal } = body || {};

  // Validar legajo
  if (typeof legajo !== 'string' || legajo.length === 0 || legajo.length > 40 || legajo.trim() !== legajo) {
    return c.json({ error: 'El legajo es obligatorio (1 a 40 caracteres, sin espacios al inicio ni al final)', codigo: 'DATOS_INVALIDOS' }, 422);
  }

  // Validar nombre y apellido
  if (typeof nombre !== 'string' || nombre.trim().length === 0 || nombre.trim().length > 100) {
    return c.json({ error: 'El nombre es obligatorio (1 a 100 caracteres)', codigo: 'DATOS_INVALIDOS' }, 422);
  }

  if (apellido !== undefined && apellido !== null) {
    if (typeof apellido !== 'string' || apellido.trim().length > 100) {
      return c.json({ error: 'El apellido no puede superar los 100 caracteres', codigo: 'DATOS_INVALIDOS' }, 422);
    }
  }

  // Validar email
  let emailNormalizado: string | null = null;
  if (email !== undefined && email !== null) {
    if (typeof email !== 'string') {
      return c.json({ error: 'El email no tiene un formato válido.', codigo: 'EMAIL_INVALIDO' }, 422);
    }
    const trimmed = email.trim();
    if (trimmed.length > 0) {
      if (trimmed.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
        return c.json({ error: 'El email no tiene un formato válido.', codigo: 'EMAIL_INVALIDO' }, 422);
      }
      emailNormalizado = trimmed.toLowerCase();
    }
  }

  // Validar telefono_whatsapp
  let telefonoNormalizado: string | null = null;
  if (telefono_whatsapp !== undefined && telefono_whatsapp !== null) {
    if (typeof telefono_whatsapp !== 'string') {
      return c.json({ error: 'El número tiene que estar en formato internacional, por ejemplo +5491112345678.', codigo: 'TELEFONO_INVALIDO' }, 422);
    }
    const trimmed = telefono_whatsapp.trim();
    if (trimmed.length > 0) {
      if (!/^\+[1-9][0-9]{7,14}$/.test(trimmed)) {
        return c.json({ error: 'El número tiene que estar en formato internacional, por ejemplo +5491112345678.', codigo: 'TELEFONO_INVALIDO' }, 422);
      }
      telefonoNormalizado = trimmed;
    }
  }

  // Validar perfil_id
  const perfilIdNum = parseId(perfil_id);
  if (!perfilIdNum) {
    return c.json({ error: 'El perfil_id es obligatorio y debe ser válido', codigo: 'DATOS_INVALIDOS' }, 422);
  }

  // Validar sectores
  const sectoresIds: number[] = [];
  if (sectores !== undefined && sectores !== null) {
    if (!Array.isArray(sectores)) {
      return c.json({ error: 'Sectores debe ser un array de ids', codigo: 'DATOS_INVALIDOS' }, 422);
    }
    for (const sec of sectores) {
      const secNum = parseId(sec);
      if (!secNum) {
        return c.json({ error: 'Uno o más identificadores de sector son inválidos', codigo: 'DATOS_INVALIDOS' }, 422);
      }
      sectoresIds.push(secNum);
    }
    // Verificar repetidos
    if (new Set(sectoresIds).size !== sectoresIds.length) {
      return c.json({ error: 'No se permiten sectores repetidos', codigo: 'DATOS_INVALIDOS' }, 422);
    }
  }

  // Validar password_temporal (política 4.3 / 5.2)
  if (typeof password_temporal !== 'string' || password_temporal.length < 8) {
    return c.json({ error: 'La contraseña temporal debe tener al menos 8 caracteres', codigo: 'PASSWORD_INVALIDA' }, 422);
  }
  if (password_temporal.trim().toLowerCase() === legajo.trim().toLowerCase()) {
    return c.json({ error: 'La contraseña temporal no puede ser igual al legajo', codigo: 'PASSWORD_INVALIDA' }, 422);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verificar si el legajo ya existe
    const resDup = await client.query('SELECT id FROM usuarios WHERE legajo = $1', [legajo]);
    if (resDup.rows.length > 0) {
      await client.query('ROLLBACK');
      return c.json({ error: 'El legajo ya se encuentra registrado', codigo: 'LEGAJO_DUPLICADO' }, 409);
    }

    // Verificar que el perfil exista y esté activo
    const resPerfil = await client.query('SELECT id, nombre, activo FROM perfiles WHERE id = $1', [perfilIdNum]);
    if (resPerfil.rows.length === 0 || !resPerfil.rows[0].activo) {
      await client.query('ROLLBACK');
      return c.json({ error: 'El perfil no existe o está inactivo', codigo: 'DATOS_INVALIDOS' }, 422);
    }

    // Verificar que cada sector exista y esté activo
    if (sectoresIds.length > 0) {
      const resSectores = await client.query(`
        SELECT id FROM sectores WHERE id = ANY($1::bigint[]) AND activo = TRUE
      `, [sectoresIds]);
      if (resSectores.rows.length !== sectoresIds.length) {
        await client.query('ROLLBACK');
        return c.json({ error: 'Uno o más sectores no existen o están inactivos', codigo: 'DATOS_INVALIDOS' }, 422);
      }
    }

    // Protección 2: Nadie asigna un perfil con permisos que no tiene
    const validPerfil = await validarAsignacionPerfil(client, actorUserId, perfilIdNum);
    if (!validPerfil.ok) {
      await client.query('ROLLBACK');
      return c.json({ error: validPerfil.error, codigo: validPerfil.codigo }, 403);
    }

    // Hash de la contraseña temporal
    const hash = await bcrypt.hash(password_temporal, 10);

    // Insertar usuario
    const resUser = await client.query(`
      INSERT INTO usuarios (
        legajo, nombre, apellido, password_hash, perfil_id, activo, debe_cambiar_password, password_actualizado_en, email, telefono_whatsapp
      )
      VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, NULL, $6, $7)
      RETURNING id, legajo, nombre, apellido, email, telefono_whatsapp, activo, debe_cambiar_password, creado_en
    `, [legajo, nombre.trim(), apellido ? apellido.trim() : null, hash, perfilIdNum, emailNormalizado, telefonoNormalizado]);

    const newUserId = Number(resUser.rows[0].id);

    // Asignar sectores
    for (const secId of sectoresIds) {
      await client.query(`
        INSERT INTO usuario_sector (usuario_id, sector_id)
        VALUES ($1, $2)
      `, [newUserId, secId]);
    }

    // Auditoría de creación (sin la contraseña)
    await client.query(`
      INSERT INTO auditoria_permisos (
        realizado_por_usuario_id, sobre_usuario_id, accion, detalle
      )
      VALUES ($1, $2, 'USUARIO_CREADO', $3)
    `, [
      actorUserId,
      newUserId,
      JSON.stringify({
        legajo,
        nombre: nombre.trim(),
        apellido: apellido ? apellido.trim() : null,
        email: emailNormalizado,
        telefono_whatsapp: telefonoNormalizado,
        perfil_id: perfilIdNum,
        sectores: sectoresIds,
      }),
    ]);

    await client.query('COMMIT');

    return c.json({
      id: newUserId,
      legajo: resUser.rows[0].legajo,
      nombre: resUser.rows[0].nombre,
      apellido: resUser.rows[0].apellido,
      email: resUser.rows[0].email,
      telefono_whatsapp: resUser.rows[0].telefono_whatsapp,
      perfil: { id: perfilIdNum, nombre: resPerfil.rows[0].nombre },
      sectores: sectoresIds,
      activo: true,
      debe_cambiar_password: true,
    }, 201);

  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error al crear usuario:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  } finally {
    client.release();
  }
});

/* =====================================================================
 * PATCH /api/usuarios/:id
 * ===================================================================== */
usuariosApp.patch('/:id', async (c) => {
  const actorUserId = (c.get as any)('userId') as number;
  const idStr = c.req.param('id');
  const targetUserId = parseId(idStr);

  if (!targetUserId) {
    return c.json({ error: 'Identificador de usuario inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Cuerpo de solicitud inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  // Protección 1: Nadie se modifica a sí mismo
  if (targetUserId === actorUserId) {
    return c.json({ error: 'No puede modificar sus propios datos con este endpoint', codigo: 'AUTOGESTION_NO_PERMITIDA' }, 403);
  }

  // El legajo no se modifica (sección 5.1 / U-06)
  if ('legajo' in body) {
    return c.json({ error: 'No se permite modificar el legajo', codigo: 'DATOS_INVALIDOS' }, 422);
  }

  const { nombre, apellido, perfil_id, sectores, email, telefono_whatsapp } = body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bloquear primero a TODOS los administradores activos y al usuario afectado en una sola consulta ordenada por id
    const { target: current, esUltimoAdmin } = await bloquearUsuarioYAdministradores(client, targetUserId);

    if (!current) {
      await client.query('ROLLBACK');
      return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
    }

    // Obtener sectores actuales del usuario
    const resCurrentSectores = await client.query(`
      SELECT sector_id FROM usuario_sector WHERE usuario_id = $1 ORDER BY sector_id ASC
    `, [targetUserId]);
    const currentSectorIds = resCurrentSectores.rows.map((r) => Number(r.sector_id));

    let hayCambiosReales = false;
    let nuevoNombre = current.nombre;
    let nuevoApellido = current.apellido;
    let nuevoEmail = current.email;
    let nuevoTelefono = current.telefono_whatsapp;
    let nuevoPerfilId = Number(current.perfil_id);
    let nuevosSectoresIds = currentSectorIds;

    let cambioDatosUsuario = false;
    let cambioPerfil = false;
    let cambioSectores = false;

    // 1. Validar y procesar nombre y apellido
    if (nombre !== undefined) {
      if (typeof nombre !== 'string' || nombre.trim().length === 0 || nombre.trim().length > 100) {
        await client.query('ROLLBACK');
        return c.json({ error: 'El nombre debe tener entre 1 y 100 caracteres', codigo: 'DATOS_INVALIDOS' }, 422);
      }
      if (nombre.trim() !== current.nombre) {
        nuevoNombre = nombre.trim();
        cambioDatosUsuario = true;
        hayCambiosReales = true;
      }
    }

    if (apellido !== undefined) {
      if (apellido !== null && (typeof apellido !== 'string' || apellido.trim().length > 100)) {
        await client.query('ROLLBACK');
        return c.json({ error: 'El apellido no puede superar los 100 caracteres', codigo: 'DATOS_INVALIDOS' }, 422);
      }
      const apellNorm = apellido ? apellido.trim() : null;
      if (apellNorm !== current.apellido) {
        nuevoApellido = apellNorm;
        cambioDatosUsuario = true;
        hayCambiosReales = true;
      }
    }

    // 1b. Validar y procesar email
    if (email !== undefined) {
      let emailNorm: string | null = null;
      if (email !== null) {
        if (typeof email !== 'string') {
          await client.query('ROLLBACK');
          return c.json({ error: 'El email no tiene un formato válido.', codigo: 'EMAIL_INVALIDO' }, 422);
        }
        const trimmed = email.trim();
        if (trimmed.length > 0) {
          if (trimmed.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
            await client.query('ROLLBACK');
            return c.json({ error: 'El email no tiene un formato válido.', codigo: 'EMAIL_INVALIDO' }, 422);
          }
          emailNorm = trimmed.toLowerCase();
        }
      }
      if (emailNorm !== current.email) {
        nuevoEmail = emailNorm;
        cambioDatosUsuario = true;
        hayCambiosReales = true;
      }
    }

    // 1c. Validar y procesar telefono_whatsapp
    if (telefono_whatsapp !== undefined) {
      let telNorm: string | null = null;
      if (telefono_whatsapp !== null) {
        if (typeof telefono_whatsapp !== 'string') {
          await client.query('ROLLBACK');
          return c.json({ error: 'El número tiene que estar en formato internacional, por ejemplo +5491112345678.', codigo: 'TELEFONO_INVALIDO' }, 422);
        }
        const trimmed = telefono_whatsapp.trim();
        if (trimmed.length > 0) {
          if (!/^\+[1-9][0-9]{7,14}$/.test(trimmed)) {
            await client.query('ROLLBACK');
            return c.json({ error: 'El número tiene que estar en formato internacional, por ejemplo +5491112345678.', codigo: 'TELEFONO_INVALIDO' }, 422);
          }
          telNorm = trimmed;
        }
      }
      if (telNorm !== current.telefono_whatsapp) {
        nuevoTelefono = telNorm;
        cambioDatosUsuario = true;
        hayCambiosReales = true;
      }
    }

    // 2. Validar y procesar perfil_id
    if (perfil_id !== undefined) {
      const pidNum = parseId(perfil_id);
      if (!pidNum) {
        await client.query('ROLLBACK');
        return c.json({ error: 'perfil_id inválido', codigo: 'DATOS_INVALIDOS' }, 422);
      }

      if (pidNum !== Number(current.perfil_id)) {
        // Verificar que el perfil exista y esté activo
        const resP = await client.query('SELECT id, nombre, activo FROM perfiles WHERE id = $1', [pidNum]);
        if (resP.rows.length === 0 || !resP.rows[0].activo) {
          await client.query('ROLLBACK');
          return c.json({ error: 'El perfil no existe o está inactivo', codigo: 'DATOS_INVALIDOS' }, 422);
        }

        // Protección 2: Nadie asigna un perfil con permisos que no posee
        const validP = await validarAsignacionPerfil(client, actorUserId, pidNum);
        if (!validP.ok) {
          await client.query('ROLLBACK');
          return c.json({ error: validP.error, codigo: validP.codigo }, 403);
        }

        // Protección 3: Siempre queda un administrador activo
        if (current.perfil_nombre === 'ADMINISTRADOR' && current.activo && esUltimoAdmin) {
          await client.query('ROLLBACK');
          return c.json({ error: 'No se puede modificar el perfil del único administrador activo', codigo: 'ULTIMO_ADMINISTRADOR' }, 409);
        }

        nuevoPerfilId = pidNum;
        cambioPerfil = true;
        hayCambiosReales = true;
      }
    }

    // 3. Validar y procesar sectores
    if (sectores !== undefined) {
      if (!Array.isArray(sectores)) {
        await client.query('ROLLBACK');
        return c.json({ error: 'Sectores debe ser un array de ids', codigo: 'DATOS_INVALIDOS' }, 422);
      }

      const parsedSecs: number[] = [];
      for (const s of sectores) {
        const sNum = parseId(s);
        if (!sNum) {
          await client.query('ROLLBACK');
          return c.json({ error: 'Identificador de sector inválido', codigo: 'DATOS_INVALIDOS' }, 422);
        }
        parsedSecs.push(sNum);
      }

      if (new Set(parsedSecs).size !== parsedSecs.length) {
        await client.query('ROLLBACK');
        return c.json({ error: 'No se permiten sectores repetidos', codigo: 'DATOS_INVALIDOS' }, 422);
      }

      if (parsedSecs.length > 0) {
        // Todos los sectores deben existir
        const resExistentes = await client.query(`
          SELECT id FROM sectores WHERE id = ANY($1::bigint[])
        `, [parsedSecs]);
        if (resExistentes.rows.length !== parsedSecs.length) {
          await client.query('ROLLBACK');
          return c.json({ error: 'Uno o más sectores no existen', codigo: 'DATOS_INVALIDOS' }, 422);
        }

        // Un sector nuevo tiene que estar activo; los que ya tenía asignados se conservan aunque estén inactivos (sección 5.2)
        const sectoresNuevos = parsedSecs.filter((sId) => !currentSectorIds.includes(sId));
        if (sectoresNuevos.length > 0) {
          const resActivos = await client.query(`
            SELECT id FROM sectores WHERE id = ANY($1::bigint[]) AND activo = TRUE
          `, [sectoresNuevos]);
          if (resActivos.rows.length !== sectoresNuevos.length) {
            await client.query('ROLLBACK');
            return c.json({ error: 'Uno o más sectores nuevos están inactivos', codigo: 'DATOS_INVALIDOS' }, 422);
          }
        }
      }

      const sortedNew = [...parsedSecs].sort((a, b) => a - b);
      const sortedCurr = [...currentSectorIds].sort((a, b) => a - b);
      if (JSON.stringify(sortedNew) !== JSON.stringify(sortedCurr)) {
        nuevosSectoresIds = sortedNew;
        cambioSectores = true;
        hayCambiosReales = true;
      }
    }

    if (!hayCambiosReales) {
      await client.query('ROLLBACK');
      return c.json({ error: 'No se detectaron cambios en los datos del usuario', codigo: 'SIN_CAMBIOS' }, 422);
    }

    // Aplicar cambios en usuarios
    if (cambioDatosUsuario || cambioPerfil) {
      await client.query(`
        UPDATE usuarios
        SET nombre = $1, apellido = $2, email = $3, telefono_whatsapp = $4, perfil_id = $5, actualizado_en = NOW()
        WHERE id = $6
      `, [nuevoNombre, nuevoApellido, nuevoEmail, nuevoTelefono, nuevoPerfilId, targetUserId]);
    }

    // Aplicar cambios en sectores (reemplazo completo)
    if (cambioSectores) {
      await client.query(`DELETE FROM usuario_sector WHERE usuario_id = $1`, [targetUserId]);
      for (const secId of nuevosSectoresIds) {
        await client.query(`
          INSERT INTO usuario_sector (usuario_id, sector_id)
          VALUES ($1, $2)
        `, [targetUserId, secId]);
      }
    }

    // Auditoría: fila por cada acción modificada
    if (cambioDatosUsuario) {
      await client.query(`
        INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
        VALUES ($1, $2, 'USUARIO_MODIFICADO', $3)
      `, [
        actorUserId,
        targetUserId,
        JSON.stringify({
          anterior: {
            nombre: current.nombre,
            apellido: current.apellido,
            email: current.email,
            telefono_whatsapp: current.telefono_whatsapp,
          },
          nuevo: {
            nombre: nuevoNombre,
            apellido: nuevoApellido,
            email: nuevoEmail,
            telefono_whatsapp: nuevoTelefono,
          },
        }),
      ]);
    }

    if (cambioPerfil) {
      await client.query(`
        INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
        VALUES ($1, $2, 'PERFIL_CAMBIADO', $3)
      `, [
        actorUserId,
        targetUserId,
        JSON.stringify({
          anterior: Number(current.perfil_id),
          nuevo: nuevoPerfilId,
        }),
      ]);
    }

    if (cambioSectores) {
      await client.query(`
        INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
        VALUES ($1, $2, 'SECTORES_CAMBIADOS', $3)
      `, [
        actorUserId,
        targetUserId,
        JSON.stringify({
          anterior: currentSectorIds,
          nuevo: nuevosSectoresIds,
        }),
      ]);
    }

    await client.query('COMMIT');

    return c.json({
      id: targetUserId,
      legajo: current.legajo,
      nombre: nuevoNombre,
      apellido: nuevoApellido,
      email: nuevoEmail,
      telefono_whatsapp: nuevoTelefono,
      perfil_id: nuevoPerfilId,
      sectores: nuevosSectoresIds,
      mensaje: 'Usuario actualizado exitosamente',
    });

  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '40P01') {
      return c.json({ error: 'Recurso ocupado por otra operación concurrente', codigo: 'RECURSO_OCUPADO' }, 409);
    }
    console.error('Error al modificar usuario:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  } finally {
    client.release();
  }
});

/* =====================================================================
 * POST /api/usuarios/:id/desactivar
 * ===================================================================== */
usuariosApp.post('/:id/desactivar', async (c) => {
  const actorUserId = (c.get as any)('userId') as number;
  const idStr = c.req.param('id');
  const targetUserId = parseId(idStr);

  if (!targetUserId) {
    return c.json({ error: 'Identificador de usuario inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  // Protección 1: Nadie se desactiva a sí mismo
  if (targetUserId === actorUserId) {
    return c.json({ error: 'No puede desactivar su propio usuario', codigo: 'AUTOGESTION_NO_PERMITIDA' }, 403);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const { motivo } = body || {};
  if (typeof motivo !== 'string' || motivo.trim().length < 5) {
    return c.json({ error: 'El motivo es obligatorio y debe tener al menos 5 caracteres', codigo: 'MOTIVO_REQUERIDO' }, 422);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bloquear primero a TODOS los administradores activos y al usuario afectado en una sola consulta ordenada por id
    const { target: current, esUltimoAdmin } = await bloquearUsuarioYAdministradores(client, targetUserId);

    if (!current) {
      await client.query('ROLLBACK');
      return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
    }

    if (!current.activo) {
      await client.query('ROLLBACK');
      return c.json({ error: 'El usuario ya se encuentra inactivo', codigo: 'SIN_CAMBIOS' }, 422);
    }

    // Protección 3: Siempre queda un administrador activo
    if (esUltimoAdmin) {
      await client.query('ROLLBACK');
      return c.json({ error: 'No se puede desactivar al único administrador activo', codigo: 'ULTIMO_ADMINISTRADOR' }, 409);
    }

    // Regla 4: Consultar intervenciones abiertas de las que es responsable
    const resAbiertas = await client.query(`
      SELECT COUNT(*)::integer AS abiertas
      FROM intervenciones
      WHERE responsable_usuario_id = $1
        AND estado NOT IN ('FINALIZADA', 'CANCELADA')
        AND eliminado_en IS NULL
    `, [targetUserId]);
    const abiertas = Number(resAbiertas.rows[0].abiertas);

    // Actualizar usuario a inactivo e incrementar sesion_version
    await client.query(`
      UPDATE usuarios
      SET activo = FALSE,
          sesion_version = sesion_version + 1,
          actualizado_en = NOW()
      WHERE id = $1
    `, [targetUserId]);

    // Registrar auditoría
    await client.query(`
      INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
      VALUES ($1, $2, 'USUARIO_DESACTIVADO', $3)
    `, [
      actorUserId,
      targetUserId,
      JSON.stringify({ motivo: motivo.trim(), intervenciones_abiertas_como_responsable: abiertas }),
    ]);

    await client.query('COMMIT');

    return c.json({
      mensaje: 'Usuario desactivado exitosamente',
      intervenciones_abiertas_como_responsable: abiertas,
    });

  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '40P01') {
      return c.json({ error: 'Recurso ocupado por otra operación concurrente', codigo: 'RECURSO_OCUPADO' }, 409);
    }
    console.error('Error al desactivar usuario:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  } finally {
    client.release();
  }
});

/* =====================================================================
 * POST /api/usuarios/:id/reactivar
 * ===================================================================== */
usuariosApp.post('/:id/reactivar', async (c) => {
  const actorUserId = (c.get as any)('userId') as number;
  const idStr = c.req.param('id');
  const targetUserId = parseId(idStr);

  if (!targetUserId) {
    return c.json({ error: 'Identificador de usuario inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  // Protección 1: Nadie se reactiva a sí mismo
  if (targetUserId === actorUserId) {
    return c.json({ error: 'No puede reactivar su propio usuario', codigo: 'AUTOGESTION_NO_PERMITIDA' }, 403);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const { motivo } = body || {};
  if (typeof motivo !== 'string' || motivo.trim().length < 5) {
    return c.json({ error: 'El motivo es obligatorio y debe tener al menos 5 caracteres', codigo: 'MOTIVO_REQUERIDO' }, 422);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const resTarget = await client.query(`
      SELECT id, activo FROM usuarios WHERE id = $1 FOR UPDATE
    `, [targetUserId]);

    if (resTarget.rows.length === 0) {
      await client.query('ROLLBACK');
      return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
    }

    const current = resTarget.rows[0];
    if (current.activo) {
      await client.query('ROLLBACK');
      return c.json({ error: 'El usuario ya se encuentra activo', codigo: 'SIN_CAMBIOS' }, 422);
    }

    await client.query(`
      UPDATE usuarios
      SET activo = TRUE, actualizado_en = NOW()
      WHERE id = $1
    `, [targetUserId]);

    await client.query(`
      INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
      VALUES ($1, $2, 'USUARIO_REACTIVADO', $3)
    `, [
      actorUserId,
      targetUserId,
      JSON.stringify({ motivo: motivo.trim() }),
    ]);

    await client.query('COMMIT');

    return c.json({
      mensaje: 'Usuario reactivado exitosamente',
    });

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error al reactivar usuario:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  } finally {
    client.release();
  }
});

/* =====================================================================
 * POST /api/usuarios/:id/restablecer-password
 * ===================================================================== */
usuariosApp.post('/:id/restablecer-password', async (c) => {
  const actorUserId = (c.get as any)('userId') as number;
  const idStr = c.req.param('id');
  const targetUserId = parseId(idStr);

  if (!targetUserId) {
    return c.json({ error: 'Identificador de usuario inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  // Protección 1: Nadie restablece su propia contraseña con este endpoint (usa cambiar-password)
  if (targetUserId === actorUserId) {
    return c.json({ error: 'No puede restablecer su propia contraseña con este endpoint', codigo: 'AUTOGESTION_NO_PERMITIDA' }, 403);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const { password_temporal } = body || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const resTarget = await client.query(`
      SELECT id, legajo, password_actualizado_en FROM usuarios WHERE id = $1 FOR UPDATE
    `, [targetUserId]);

    if (resTarget.rows.length === 0) {
      await client.query('ROLLBACK');
      return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
    }

    const targetUser = resTarget.rows[0];

    // Validar password_temporal
    if (typeof password_temporal !== 'string' || password_temporal.length < 8) {
      await client.query('ROLLBACK');
      return c.json({ error: 'La contraseña temporal debe tener al menos 8 caracteres', codigo: 'PASSWORD_INVALIDA' }, 422);
    }

    if (password_temporal.trim().toLowerCase() === targetUser.legajo.trim().toLowerCase()) {
      await client.query('ROLLBACK');
      return c.json({ error: 'La contraseña temporal no puede ser igual al legajo', codigo: 'PASSWORD_INVALIDA' }, 422);
    }

    const hash = await bcrypt.hash(password_temporal, 10);

    // Actualizar usuario: debe_cambiar_password = TRUE, sesion_version incrementada para invalidar sesiones
    await client.query(`
      UPDATE usuarios
      SET password_hash = $1,
          debe_cambiar_password = TRUE,
          password_actualizado_en = NOW(),
          sesion_version = sesion_version + 1,
          actualizado_en = NOW()
      WHERE id = $2
    `, [hash, targetUserId]);

    await client.query(`
      INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
      VALUES ($1, $2, 'PASSWORD_RESTABLECIDA', $3)
    `, [
      actorUserId,
      targetUserId,
      JSON.stringify({ restablecido_por_usuario_id: actorUserId }),
    ]);

    await client.query('COMMIT');

    return c.json({
      mensaje: 'Contraseña restablecida exitosamente',
    });

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error al restablecer contraseña:', error);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  } finally {
    client.release();
  }
});

/* =====================================================================
 * PUT /api/usuarios/:id/excepciones/:codigo
 * ===================================================================== */
usuariosApp.put('/:id/excepciones/:codigo', async (c) => {
  // 1. Quien hace el cambio necesita PERMISOS_GESTIONAR, además de USUARIOS_GESTIONAR
  const actorPermissions = (c.get as any)('userPermissionsMap') as Record<string, AlcancePermiso> | undefined;
  if (!actorPermissions || !('PERMISOS_GESTIONAR' in actorPermissions)) {
    return c.json({ error: 'Permisos insuficientes o revocados', codigo: 'PERMISO_INSUFICIENTE' }, 403);
  }

  // 2. :id inválido
  const idStr = c.req.param('id');
  const targetUserId = parseId(idStr);
  if (!targetUserId) {
    return c.json({ error: 'Identificador de usuario inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  // 3. El usuario no existe
  const resTargetUser = await pool.query('SELECT id FROM usuarios WHERE id = $1', [targetUserId]);
  if (resTargetUser.rows.length === 0) {
    return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
  }

  // 4. Es el propio usuario: nadie cambia sus propias excepciones (8.5)
  const actorUserId = (c.get as any)('userId') as number;
  if (actorUserId === targetUserId) {
    return c.json({ error: 'No está permitido modificar las propias excepciones de permisos', codigo: 'AUTOGESTION_NO_PERMITIDA' }, 403);
  }

  // 5. El permiso no existe
  const codigoPermiso = c.req.param('codigo');
  const resPermiso = await pool.query('SELECT id, codigo, usa_alcance FROM permisos WHERE codigo = $1', [codigoPermiso]);
  if (resPermiso.rows.length === 0) {
    return c.json({ error: 'Permiso no encontrado', codigo: 'PERMISO_NO_ENCONTRADO' }, 404);
  }
  const permisoRow = resPermiso.rows[0];
  const permisoId = Number(permisoRow.id);
  const usaAlcance = Boolean(permisoRow.usa_alcance);

  // 6. motivo falta o tiene menos de 5 caracteres, sin contar los espacios de los extremos
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    // cuerpo no parseable o inexistente
  }
  const motivo = typeof body?.motivo === 'string' ? body.motivo.trim() : '';
  if (motivo.length < 5) {
    return c.json({ error: 'El motivo es requerido y debe tener al menos 5 caracteres', codigo: 'MOTIVO_REQUERIDO' }, 422);
  }

  // 7. Solo en el PUT: efecto no es CONCEDER ni DENEGAR
  if (body?.efecto !== 'CONCEDER' && body?.efecto !== 'DENEGAR') {
    return c.json({ error: 'El efecto debe ser CONCEDER o DENEGAR', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  // 8. Solo en el PUT, el alcance:
  // • CONCEDER de un permiso con usa_alcance: alcance es obligatorio y tiene que ser PROPIAS, SECTORES o TODAS;
  // • CONCEDER de un permiso sin alcance: alcance puede no venir, o venir TODAS; se guarda TODAS;
  // • DENEGAR: alcance no puede venir.
  let alcanceParaGuardar: AlcancePermiso;
  if (body.efecto === 'CONCEDER') {
    if (usaAlcance) {
      if (!body.alcance || !['PROPIAS', 'SECTORES', 'TODAS'].includes(body.alcance)) {
        return c.json({ error: 'El alcance es obligatorio para este permiso y debe ser PROPIAS, SECTORES o TODAS', codigo: 'DATOS_INVALIDOS' }, 400);
      }
      alcanceParaGuardar = body.alcance as AlcancePermiso;
    } else {
      if (body.alcance !== undefined && body.alcance !== null && body.alcance !== 'TODAS') {
        return c.json({ error: 'Este permiso no admite alcance sectorial', codigo: 'DATOS_INVALIDOS' }, 400);
      }
      alcanceParaGuardar = 'TODAS';
    }
  } else {
    // DENEGAR: alcance no puede venir
    if (body.alcance !== undefined && body.alcance !== null) {
      return c.json({ error: 'No se puede especificar un alcance al denegar un permiso', codigo: 'DATOS_INVALIDOS' }, 400);
    }
    alcanceParaGuardar = 'TODAS';
  }

  // 9. Nadie toca un permiso que no tiene (8.5):
  // • quien hace el cambio tiene que tener ese permiso entre sus permisos efectivos;
  // • para CONCEDER, con un alcance igual o mayor que el que concede (PROPIAS < SECTORES < TODAS).
  if (!(codigoPermiso in actorPermissions)) {
    return c.json({ error: 'No puede gestionar un permiso que no posee entre sus permisos efectivos', codigo: 'PERMISO_NO_OTORGABLE' }, 403);
  }

  if (body.efecto === 'CONCEDER') {
    const actorScope = actorPermissions[codigoPermiso];
    const actorLevel = SCOPE_HIERARCHY[actorScope] || 0;
    const targetLevel = SCOPE_HIERARCHY[alcanceParaGuardar] || 0;
    if (actorLevel < targetLevel) {
      return c.json({ error: 'No puede otorgar un alcance superior al que posee', codigo: 'PERMISO_NO_OTORGABLE' }, 403);
    }
  }

  // Último administrador: No hace falta controlarlo aquí porque quien hace el cambio tiene USUARIOS_GESTIONAR y PERMISOS_GESTIONAR,
  // y no puede cambiarse a sí mismo (regla 4: AUTOGESTION_NO_PERMITIDA), por lo que siempre queda al menos un usuario activo con ambos permisos.

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bloqueo del usuario para serializar cambios concurrentes sobre sus excepciones.
    // Se bloquea el usuario y no la excepción porque si es una creación todavía no existe la fila a bloquear.
    await client.query('SELECT id FROM usuarios WHERE id = $1 FOR UPDATE', [targetUserId]);

    // 10. PUT con el mismo efecto y alcance que la excepción que ya tiene
    const resEx = await client.query(`
      SELECT id, efecto, alcance, motivo
      FROM usuario_permiso
      WHERE usuario_id = $1 AND permiso_id = $2
    `, [targetUserId, permisoId]);

    const yaExistia = resEx.rows.length > 0;
    const existing = yaExistia ? resEx.rows[0] : null;

    if (yaExistia && existing.efecto === body.efecto && existing.alcance === alcanceParaGuardar) {
      await client.query('ROLLBACK');
      return c.json({ error: 'La excepción ya posee el mismo efecto y alcance', codigo: 'SIN_CAMBIOS' }, 422);
    }

    const accion = yaExistia ? 'EXCEPCION_MODIFICADA' : 'EXCEPCION_CREADA';

    await client.query(`
      INSERT INTO usuario_permiso (usuario_id, permiso_id, efecto, alcance, motivo, otorgado_por_usuario_id, creado_en)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (usuario_id, permiso_id) DO UPDATE
      SET efecto = EXCLUDED.efecto,
          alcance = EXCLUDED.alcance,
          motivo = EXCLUDED.motivo,
          otorgado_por_usuario_id = EXCLUDED.otorgado_por_usuario_id,
          creado_en = NOW()
    `, [targetUserId, permisoId, body.efecto, alcanceParaGuardar, motivo, actorUserId]);

    const detalle: any = {
      codigo: codigoPermiso,
      efecto: body.efecto,
      alcance: alcanceParaGuardar,
      motivo,
    };
    if (yaExistia && existing) {
      detalle.anterior = {
        efecto: existing.efecto,
        alcance: existing.alcance,
        motivo: existing.motivo,
      };
    }

    await client.query(`
      INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
      VALUES ($1, $2, $3, $4)
    `, [actorUserId, targetUserId, accion, JSON.stringify(detalle)]);

    const updatedDetail = await obtenerDetalleUsuario(client, targetUserId);

    await client.query('COMMIT');
    return c.json(updatedDetail);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error al guardar excepción de permiso:', err);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  } finally {
    client.release();
  }
});

/* =====================================================================
 * DELETE /api/usuarios/:id/excepciones/:codigo
 * ===================================================================== */
usuariosApp.delete('/:id/excepciones/:codigo', async (c) => {
  // 1. Quien hace el cambio necesita PERMISOS_GESTIONAR, además de USUARIOS_GESTIONAR
  const actorPermissions = (c.get as any)('userPermissionsMap') as Record<string, AlcancePermiso> | undefined;
  if (!actorPermissions || !('PERMISOS_GESTIONAR' in actorPermissions)) {
    return c.json({ error: 'Permisos insuficientes o revocados', codigo: 'PERMISO_INSUFICIENTE' }, 403);
  }

  // 2. :id inválido
  const idStr = c.req.param('id');
  const targetUserId = parseId(idStr);
  if (!targetUserId) {
    return c.json({ error: 'Identificador de usuario inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  // 3. El usuario no existe
  const resTargetUser = await pool.query('SELECT id FROM usuarios WHERE id = $1', [targetUserId]);
  if (resTargetUser.rows.length === 0) {
    return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
  }

  // 4. Es el propio usuario: nadie cambia sus propias excepciones (8.5)
  const actorUserId = (c.get as any)('userId') as number;
  if (actorUserId === targetUserId) {
    return c.json({ error: 'No está permitido modificar las propias excepciones de permisos', codigo: 'AUTOGESTION_NO_PERMITIDA' }, 403);
  }

  // 5. El permiso no existe
  const codigoPermiso = c.req.param('codigo');
  const resPermiso = await pool.query('SELECT id, codigo, usa_alcance FROM permisos WHERE codigo = $1', [codigoPermiso]);
  if (resPermiso.rows.length === 0) {
    return c.json({ error: 'Permiso no encontrado', codigo: 'PERMISO_NO_ENCONTRADO' }, 404);
  }
  const permisoRow = resPermiso.rows[0];
  const permisoId = Number(permisoRow.id);

  // 6. motivo falta o tiene menos de 5 caracteres, sin contar los espacios de los extremos
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    // cuerpo no parseable o inexistente
  }
  const motivo = typeof body?.motivo === 'string' ? body.motivo.trim() : '';
  if (motivo.length < 5) {
    return c.json({ error: 'El motivo es requerido y debe tener al menos 5 caracteres', codigo: 'MOTIVO_REQUERIDO' }, 422);
  }

  // 9. Nadie toca un permiso que no tiene (8.5): quien hace el cambio tiene que tener ese permiso entre sus permisos efectivos
  if (!(codigoPermiso in actorPermissions)) {
    return c.json({ error: 'No puede gestionar un permiso que no posee entre sus permisos efectivos', codigo: 'PERMISO_NO_OTORGABLE' }, 403);
  }

  // Último administrador: No hace falta controlarlo aquí porque quien hace el cambio tiene USUARIOS_GESTIONAR y PERMISOS_GESTIONAR,
  // y no puede cambiarse a sí mismo (regla 4: AUTOGESTION_NO_PERMITIDA), por lo que siempre queda al menos un usuario activo con ambos permisos.

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bloqueo del usuario para serializar cambios concurrentes sobre sus excepciones.
    await client.query('SELECT id FROM usuarios WHERE id = $1 FOR UPDATE', [targetUserId]);

    // 11. DELETE de una excepción que no existe
    const resEx = await client.query(`
      SELECT id, efecto, alcance, motivo
      FROM usuario_permiso
      WHERE usuario_id = $1 AND permiso_id = $2
    `, [targetUserId, permisoId]);

    if (resEx.rows.length === 0) {
      await client.query('ROLLBACK');
      return c.json({ error: 'Excepción no encontrada para este usuario y permiso', codigo: 'EXCEPCION_NO_ENCONTRADA' }, 404);
    }
    const existing = resEx.rows[0];

    await client.query(`
      DELETE FROM usuario_permiso
      WHERE usuario_id = $1 AND permiso_id = $2
    `, [targetUserId, permisoId]);

    const detalle = {
      codigo: codigoPermiso,
      efecto: existing.efecto,
      alcance: existing.alcance,
      motivo,
      anterior: {
        efecto: existing.efecto,
        alcance: existing.alcance,
        motivo: existing.motivo,
      },
    };

    await client.query(`
      INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
      VALUES ($1, $2, 'EXCEPCION_ELIMINADA', $3)
    `, [actorUserId, targetUserId, JSON.stringify(detalle)]);

    const updatedDetail = await obtenerDetalleUsuario(client, targetUserId);

    await client.query('COMMIT');
    return c.json(updatedDetail);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error al eliminar excepción de permiso:', err);
    return c.json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' }, 500);
  } finally {
    client.release();
  }
});
