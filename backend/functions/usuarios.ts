import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { pool } from './db.ts';
import { jwtVerify, dbVerify, requirePermission } from './middleware.ts';
import { parseId } from './validations.ts';
import { resolverPermisosEfectivos, AlcancePermiso } from './intervenciones/permisos.ts';

const SCOPE_HIERARCHY: Record<AlcancePermiso, number> = {
  PROPIAS: 1,
  SECTORES: 2,
  TODAS: 3,
};

export const usuariosApp = new Hono();
export const perfilesApp = new Hono();

// Todos los endpoints de usuarios y perfiles requieren USUARIOS_GESTIONAR
usuariosApp.use('*', jwtVerify, dbVerify, requirePermission('USUARIOS_GESTIONAR'));
perfilesApp.use('*', jwtVerify, dbVerify, requirePermission('USUARIOS_GESTIONAR'));

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
 * Bloquea los administradores activos y verifica que no sea el último activo (Regla 3 sección 5.3)
 */
async function verificarUltimoAdministrador(
  client: pg.PoolClient,
  targetUserId: number
): Promise<{ esUltimo: boolean }> {
  const resAdmins = await client.query(`
    SELECT u.id
    FROM usuarios u
    JOIN perfiles p ON u.perfil_id = p.id
    WHERE p.nombre = 'ADMINISTRADOR' AND u.activo = TRUE
    ORDER BY u.id ASC
    FOR UPDATE
  `);

  const activeAdminIds = resAdmins.rows.map((r) => Number(r.id));
  const isTargetAdmin = activeAdminIds.includes(targetUserId);

  if (isTargetAdmin && activeAdminIds.length <= 1) {
    return { esUltimo: true };
  }

  return { esUltimo: false };
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
        permisos: r.permisos,
      }))
    );
  } catch (error) {
    console.error('Error al listar perfiles:', error);
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
 * GET /api/usuarios/:id
 * ===================================================================== */
usuariosApp.get('/:id', async (c) => {
  const idStr = c.req.param('id');
  const userId = parseId(idStr);

  if (!userId) {
    return c.json({ error: 'Identificador de usuario inválido', codigo: 'DATOS_INVALIDOS' }, 400);
  }

  try {
    const resUser = await pool.query(`
      SELECT 
        u.id, 
        u.legajo, 
        u.nombre, 
        u.apellido, 
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
      return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
    }

    const row = resUser.rows[0];

    // Permisos efectivos
    const effectiveInfo = await resolverPermisosEfectivos(pool, userId);

    // Excepciones individuales registradas en usuario_permiso
    const resEx = await pool.query(`
      SELECT up.id, pe.codigo, pe.nombre, up.efecto, up.alcance, up.motivo, up.creado_en
      FROM usuario_permiso up
      JOIN permisos pe ON up.permiso_id = pe.id
      WHERE up.usuario_id = $1
      ORDER BY pe.codigo ASC
    `, [userId]);

    // Cantidad de intervenciones abiertas de las que es responsable
    const resAbiertas = await pool.query(`
      SELECT COUNT(*)::integer AS abiertas
      FROM intervenciones
      WHERE responsable_usuario_id = $1
        AND estado NOT IN ('FINALIZADA', 'CANCELADA')
        AND eliminado_en IS NULL
    `, [userId]);

    return c.json({
      id: Number(row.id),
      legajo: row.legajo,
      nombre: row.nombre,
      apellido: row.apellido,
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
      })),
      intervenciones_abiertas_como_responsable: Number(resAbiertas.rows[0].abiertas),
    });
  } catch (error) {
    console.error('Error al obtener usuario por id:', error);
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

  const { legajo, nombre, apellido, perfil_id, sectores, password_temporal } = body || {};

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

  // Validar perfil_id
  const perfilIdNum = parseId(String(perfil_id));
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
      const secNum = parseId(String(sec));
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
        legajo, nombre, apellido, password_hash, perfil_id, activo, debe_cambiar_password, password_actualizado_en
      )
      VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, NULL)
      RETURNING id, legajo, nombre, apellido, activo, debe_cambiar_password, creado_en
    `, [legajo, nombre.trim(), apellido ? apellido.trim() : null, hash, perfilIdNum]);

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

  const { nombre, apellido, perfil_id, sectores } = body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bloquear fila del usuario afectado
    const resTarget = await client.query(`
      SELECT u.id, u.legajo, u.nombre, u.apellido, u.perfil_id, u.activo
      FROM usuarios u
      WHERE u.id = $1
      FOR UPDATE
    `, [targetUserId]);

    if (resTarget.rows.length === 0) {
      await client.query('ROLLBACK');
      return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
    }

    const current = resTarget.rows[0];

    // Obtener sectores actuales del usuario
    const resCurrentSectores = await client.query(`
      SELECT sector_id FROM usuario_sector WHERE usuario_id = $1 ORDER BY sector_id ASC
    `, [targetUserId]);
    const currentSectorIds = resCurrentSectores.rows.map((r) => Number(r.sector_id));

    let hayCambiosReales = false;
    let nuevoNombre = current.nombre;
    let nuevoApellido = current.apellido;
    let nuevoPerfilId = Number(current.perfil_id);
    let nuevosSectoresIds = currentSectorIds;

    let cambioNombreOApellido = false;
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
        cambioNombreOApellido = true;
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
        cambioNombreOApellido = true;
        hayCambiosReales = true;
      }
    }

    // 2. Validar y procesar perfil_id
    if (perfil_id !== undefined) {
      const pidNum = parseId(String(perfil_id));
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
        const checkUltimo = await verificarUltimoAdministrador(client, targetUserId);
        if (checkUltimo.esUltimo) {
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
        const sNum = parseId(String(s));
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
        const resValidSecs = await client.query(`
          SELECT id FROM sectores WHERE id = ANY($1::bigint[]) AND activo = TRUE
        `, [parsedSecs]);
        if (resValidSecs.rows.length !== parsedSecs.length) {
          await client.query('ROLLBACK');
          return c.json({ error: 'Uno o más sectores no existen o están inactivos', codigo: 'DATOS_INVALIDOS' }, 422);
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
    if (cambioNombreOApellido || cambioPerfil) {
      await client.query(`
        UPDATE usuarios
        SET nombre = $1, apellido = $2, perfil_id = $3, actualizado_en = NOW()
        WHERE id = $4
      `, [nuevoNombre, nuevoApellido, nuevoPerfilId, targetUserId]);
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
    if (cambioNombreOApellido) {
      await client.query(`
        INSERT INTO auditoria_permisos (realizado_por_usuario_id, sobre_usuario_id, accion, detalle)
        VALUES ($1, $2, 'USUARIO_MODIFICADO', $3)
      `, [
        actorUserId,
        targetUserId,
        JSON.stringify({
          anterior: { nombre: current.nombre, apellido: current.apellido },
          nuevo: { nombre: nuevoNombre, apellido: nuevoApellido },
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
      perfil_id: nuevoPerfilId,
      sectores: nuevosSectoresIds,
      mensaje: 'Usuario actualizado exitosamente',
    });

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
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

    // Bloquear fila del usuario a desactivar
    const resTarget = await client.query(`
      SELECT id, activo, perfil_id FROM usuarios WHERE id = $1 FOR UPDATE
    `, [targetUserId]);

    if (resTarget.rows.length === 0) {
      await client.query('ROLLBACK');
      return c.json({ error: 'Usuario no encontrado', codigo: 'USUARIO_NO_ENCONTRADO' }, 404);
    }

    const current = resTarget.rows[0];
    if (!current.activo) {
      await client.query('ROLLBACK');
      return c.json({ error: 'El usuario ya se encuentra inactivo', codigo: 'SIN_CAMBIOS' }, 422);
    }

    // Protección 3: Siempre queda un administrador activo
    const checkUltimo = await verificarUltimoAdministrador(client, targetUserId);
    if (checkUltimo.esUltimo) {
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

    // Actualizar usuario a inactivo
    await client.query(`
      UPDATE usuarios
      SET activo = FALSE, actualizado_en = NOW()
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

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
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

    // Actualizar usuario: debe_cambiar_password = TRUE, password_actualizado_en avanza para invalidar sesiones
    await client.query(`
      UPDATE usuarios
      SET password_hash = $1,
          debe_cambiar_password = TRUE,
          password_actualizado_en = GREATEST(NOW(), COALESCE(password_actualizado_en, NOW()) + INTERVAL '1 second'),
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
