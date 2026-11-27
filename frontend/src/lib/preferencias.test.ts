import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AYUDA_MODO_SIMPLE, OPCIONES_TEMA, esquemaDeTema } from './preferencias';

describe('FE-159: el tema y las opciones de Preferencias (D1, 4 y 5)', () => {
  it('cada tema con su esquema de Mantine; sin tema, claro', () => {
    assert.equal(esquemaDeTema('CLARO'), 'light');
    assert.equal(esquemaDeTema('OSCURO'), 'dark');
    assert.equal(esquemaDeTema('SISTEMA'), 'auto');
    assert.equal(esquemaDeTema(null), 'light');
    assert.equal(esquemaDeTema(undefined), 'light');
  });

  it('las opciones del tema, en orden, y la ayuda del modo simple', () => {
    assert.deepEqual(OPCIONES_TEMA, [
      { value: 'CLARO', label: 'Claro' },
      { value: 'OSCURO', label: 'Oscuro' },
      { value: 'SISTEMA', label: 'Como el dispositivo' },
    ]);
    assert.equal(
      AYUDA_MODO_SIMPLE,
      'En el celular muestra solo lo esencial: reportar fallas, tus reportes, la ronda de lecturas y un resumen de reportes. Apagado, en el celular ves lo mismo que en la computadora, según tu perfil.'
    );
  });
});
