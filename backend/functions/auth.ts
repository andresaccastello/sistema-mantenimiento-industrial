import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import { pool } from './db.ts';

const authApp = new Hono();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_change_in_prod';

authApp.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const { legajo, password } = body;

    if (!legajo || !password) {
      return c.json({ error: 'Faltan credenciales' }, 400);
    }

    // Buscar usuario por legajo
    const { rows } = await pool.query(
      `SELECT u.id, u.legajo, u.password_hash, u.nombre, u.apellido, p.nombre as perfil
       FROM usuarios u
       JOIN perfiles p ON u.perfil_id = p.id
       WHERE u.legajo = $1 AND u.activo = TRUE`,
      [legajo]
    );

    const user = rows[0];
    if (!user || !user.password_hash) {
      return c.json({ error: 'Credenciales inválidas' }, 401);
    }

    // Verificar contraseña
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return c.json({ error: 'Credenciales inválidas' }, 401);
    }

    // Obtener los permisos del usuario
    const permisosRes = await pool.query(
      `SELECT pe.codigo
       FROM perfil_permiso pp
       JOIN permisos pe ON pp.permiso_id = pe.id
       WHERE pp.perfil_id = (SELECT perfil_id FROM usuarios WHERE id = $1)`,
      [user.id]
    );
    
    const permisos = permisosRes.rows.map(r => r.codigo);

    // Generar JWT Token
    const payload = {
      sub: user.id.toString(),
      legajo: user.legajo,
      perfil: user.perfil,
      permisos,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 // 24 horas
    };

    const token = await sign(payload, JWT_SECRET);

    // Actualizar ultimo_acceso_en
    await pool.query('UPDATE usuarios SET ultimo_acceso_en = NOW() WHERE id = $1', [user.id]);

    return c.json({
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        perfil: user.perfil,
        permisos
      }
    });

  } catch (error) {
    console.error('Error en login:', error);
    return c.json({ error: 'Error interno del servidor' }, 500);
  }
});

export default authApp;
