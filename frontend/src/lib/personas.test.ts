import test from 'node:test';
import assert from 'node:assert/strict';
import { nombreCompleto } from './personas.js';

test('FE-09: nombreCompleto', () => {
  assert.strictEqual(nombreCompleto({ nombre: 'Juan', apellido: 'Pérez' }), 'Juan Pérez');
  assert.strictEqual(nombreCompleto({ nombre: 'Juan', apellido: null }), 'Juan');
  assert.strictEqual(nombreCompleto({ nombre: 'Juan', apellido: '   ' }), 'Juan');
  assert.strictEqual(nombreCompleto(null), '');
  assert.strictEqual(nombreCompleto(undefined), '');
});
