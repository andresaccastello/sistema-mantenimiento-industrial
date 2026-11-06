import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarEmail,
  validarEmail,
  normalizarTelefono,
  validarTelefono,
} from './contacto';

describe('FE-40: lib/contacto.ts', () => {
  it('normalizarEmail: recorta espacios, minúsculas y vacío a null', () => {
    assert.equal(normalizarEmail('  Ana@Empresa.COM '), 'ana@empresa.com');
    assert.equal(normalizarEmail(''), null);
    assert.equal(normalizarEmail('   '), null);
    assert.equal(normalizarEmail(null), null);
    assert.equal(normalizarEmail(undefined), null);
  });

  it('validarEmail: formato inválido da error; null y vacío son válidos', () => {
    assert.notEqual(validarEmail('ana@empresa'), null);
    assert.notEqual(validarEmail('a b@c.com'), null);
    assert.equal(validarEmail(null), null);
    assert.equal(validarEmail(''), null);
    assert.equal(validarEmail('ana@empresa.com'), null);
    const email255 = 'a'.repeat(243) + '@empresa.com';
    assert.equal(email255.length, 255);
    assert.notEqual(validarEmail(email255), null);
  });

  it('normalizarTelefono: saca caracteres y 00 pasa a +; vacío a null', () => {
    assert.equal(normalizarTelefono('+54 9 (11) 1234-5678'), '+5491112345678');
    assert.equal(normalizarTelefono('0054 11 1234 5678'), '+541112345678');
    assert.equal(normalizarTelefono(''), null);
    assert.equal(normalizarTelefono('   '), null);
    assert.equal(normalizarTelefono(null), null);
    assert.equal(normalizarTelefono(undefined), null);
  });

  it('validarTelefono: sin +, muy corto o con letras da error; internacional válido es null', () => {
    assert.notEqual(validarTelefono('5491112345678'), null);
    assert.notEqual(validarTelefono('+12'), null);
    assert.equal(validarTelefono(null), null);
    assert.equal(validarTelefono(''), null);
    assert.equal(validarTelefono('+5491112345678'), null);
  });
});
