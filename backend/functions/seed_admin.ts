import { pool } from './db.ts';
import bcrypt from 'bcryptjs';

async function seedAdmin() {
  try {
    const legajo = 'ADMIN001';
    const password = process.env.ADMIN_INITIAL_PASSWORD; 
    if (!password) {
      throw new Error('ADMIN_INITIAL_PASSWORD no está configurado en .env');
    }

    // Buscar si ya existe
    const exists = await pool.query('SELECT id FROM usuarios WHERE legajo = $1', [legajo]);
    
    if (exists.rows.length > 0) {
      console.log('El usuario administrador ya existe.');
      process.exit(0);
    }

    // Obtener ID del perfil administrador
    const perfilRes = await pool.query("SELECT id FROM perfiles WHERE nombre = 'ADMINISTRADOR'");
    if (perfilRes.rows.length === 0) {
      throw new Error('No se encontró el perfil ADMINISTRADOR');
    }
    const perfilId = perfilRes.rows[0].id;

    // Hashear contraseña
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    // Insertar usuario
    await pool.query(
      `INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id) 
       VALUES ($1, $2, $3, $4, $5)`,
      [legajo, 'Administrador', 'Sistema', hash, perfilId]
    );

    console.log('Usuario administrador procesado con éxito.');

  } catch (err) {
    console.error('Error creando administrador:', err);
  } finally {
    await pool.end();
  }
}

seedAdmin();
