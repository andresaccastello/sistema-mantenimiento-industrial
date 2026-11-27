import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGAJO_SISTEMA, nombreCompleto, textoAutor } from './personas.js';

test('FE-09: nombreCompleto', () => {
  assert.strictEqual(nombreCompleto({ nombre: 'Juan', apellido: 'Pérez' }), 'Juan Pérez');
  assert.strictEqual(nombreCompleto({ nombre: 'Juan', apellido: null }), 'Juan');
  assert.strictEqual(nombreCompleto({ nombre: 'Juan', apellido: '   ' }), 'Juan');
  assert.strictEqual(nombreCompleto(null), '');
  assert.strictEqual(nombreCompleto(undefined), '');
});

test('FE-124: textoAutor, con el usuario "Sistema" sin legajo (PV5, 5)', () => {
  assert.equal(textoAutor({ nombre: 'Ana', apellido: 'Pérez', legajo: '1234' }), 'Ana Pérez · 1234');
  assert.equal(textoAutor({ nombre: 'Ana', apellido: null, legajo: null }), 'Ana · —');
  assert.equal(textoAutor({ nombre: 'Sistema', apellido: null, legajo: LEGAJO_SISTEMA }), 'Sistema');
  assert.equal(LEGAJO_SISTEMA, 'SISTEMA');
});
