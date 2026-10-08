import { test } from 'node:test';
import assert from 'node:assert';

// URL del entorno de desarrollo local (Asegurarse de levantar npm run dev:backend)
import { pool } from '../functions/db.ts';

const API_URL = 'http://localhost:3000/api';

// Función para confirmar criptográficamente/lógicamente que estamos en una DB de pruebas
async function ensureSafeDatabaseForWrites() {
  const { rows } = await pool.query('SELECT current_database() as db_name');
  const dbName = rows[0].db_name;
  if (!dbName.endsWith('_test') && !dbName.includes('dev')) {
    throw new Error(`BLOQUEO DE SEGURIDAD: La base de datos '${dbName}' no es de pruebas. Las operaciones de escritura en E2E requieren que la base termine en '_test' o contenga 'dev' para evitar mutar producción.`);
  }
}

test('Security & Auth Tests', async (t) => {

  let validToken = '';

  await t.test('1. Solicitud sin token debe fallar (401)', async () => {
    const res = await fetch(`${API_URL}/sectores`);
    assert.strictEqual(res.status, 401);
  });

  await t.test('2. Solicitud con token inválido debe fallar (401/403)', async () => {
    const res = await fetch(`${API_URL}/sectores`, {
      headers: { 'Authorization': 'Bearer tokenfalso' }
    });
    assert.strictEqual(res.status, 401);
  });

  await t.test('3. Login incorrecto (401)', async () => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: 'ADMIN001', password: 'mal' })
    });
    assert.strictEqual(res.status, 401);
  });

  await t.test('4. Login correcto', async () => {
    // Nota: Requiere ADMIN_INITIAL_PASSWORD en .env para haber creado el usuario
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legajo: 'ADMIN001', password: process.env.ADMIN_INITIAL_PASSWORD })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.token);
    validToken = data.token;
  });

  // Tests dependientes de validToken...
  await t.test('5. Bloqueo de mutación (Validar Entorno Seguro)', async () => {
    await ensureSafeDatabaseForWrites();
  });

  await t.test('6. Creación inválida de sector (Nombre vacío)', async () => {
    const res = await fetch(`${API_URL}/sectores`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify({ nombre: '   ', descripcion: 'test' })
    });
    assert.strictEqual(res.status, 400);
  });

  await t.test('6. Asignar máquina a sector inactivo/inexistente', async () => {
    const res = await fetch(`${API_URL}/maquinas`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify({ nombre: 'Máquina X', sector_id: 999999 })
    });
    assert.strictEqual(res.status, 400);
  });

  /*
   Para ejecutar las pruebas completas de Creación, Actualización y Borrado lógico de Sectores y Máquinas,
   recomendamos apuntar la variable DATABASE_URL a una base de datos "Branch" de desarrollo en Neon,
   para evitar modificar los datos de Producción, o usar una transacción controlada.
  */
});
