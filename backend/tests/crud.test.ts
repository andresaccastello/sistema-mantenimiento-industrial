import { test } from 'node:test';
import assert from 'node:assert';
import { pool } from '../functions/db.ts';

const API_URL = 'http://localhost:3000/api';

// Identificación estricta de la rama de Neon
// 1. NEON_TEST_BRANCH_ID debe existir en el entorno.
// 2. DATABASE_URL debe coincidir con este ID.
// 3. Opcionalmente: No debe ser la rama de producción conocida ('ep-broad-fog-b5p3znyl').
const dbUrl = process.env.DATABASE_URL || '';
const testBranchId = process.env.NEON_TEST_BRANCH_ID;

if (!testBranchId || !dbUrl.includes(testBranchId) || dbUrl.includes('ep-broad-fog-b5p3znyl')) {
  console.error('===============================================================');
  console.error(' BLOQUEO DE SEGURIDAD (E2E TESTS)');
  console.error('===============================================================');
  console.error(' Las pruebas de E2E mutan la base de datos.');
  console.error(' Para ejecutar la suite, debes configurar un entorno aislado:');
  console.error(' 1. Define NEON_TEST_BRANCH_ID en tu .env con el ID de la rama.');
  console.error(' 2. Define DATABASE_URL apuntando a esa rama específica.');
  console.error(' No se iniciará ninguna prueba contra producción.');
  console.error('===============================================================');
  process.exit(1);
}

test('Security, Auth & CRUD Tests', async (t) => {
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

  await t.test('5. Creación inválida de sector (Nombre vacío)', async () => {
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

});
