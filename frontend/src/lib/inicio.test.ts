import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { destinoInicio, esRutaInicio } from './inicio';

describe('FE-05: destinoInicio', () => {
  it('VER con alcance PROPIAS lleva a /mis-reportes', () => {
    assert.equal(
      destinoInicio({ INTERVENCIONES_VER: 'PROPIAS' }),
      '/mis-reportes'
    );
  });

  it('VER con alcance SECTORES lleva a /tablero', () => {
    assert.equal(
      destinoInicio({ INTERVENCIONES_VER: 'SECTORES' }),
      '/tablero'
    );
  });

  it('VER con alcance TODAS lleva a /tablero', () => {
    assert.equal(
      destinoInicio({ INTERVENCIONES_VER: 'TODAS' }),
      '/tablero'
    );
  });

  it('sin permiso VER lleva a /mis-reportes', () => {
    assert.equal(destinoInicio({}), '/mis-reportes');
    assert.equal(destinoInicio(null), '/mis-reportes');
    assert.equal(destinoInicio({ OTRA_COSA: 'TODAS' }), '/mis-reportes');
  });

  it('soporta formato de array con objetos', () => {
    assert.equal(
      destinoInicio([{ codigo: 'INTERVENCIONES_VER', alcance: 'PROPIAS' }]),
      '/mis-reportes'
    );
    assert.equal(
      destinoInicio([{ codigo: 'INTERVENCIONES_VER', alcance: 'TODAS' }]),
      '/tablero'
    );
    assert.equal(
      destinoInicio([{ codigo: 'INTERVENCIONES_VER', alcance: 'SECTORES' }]),
      '/tablero'
    );
  });
});

describe('FE-08: esRutaInicio', () => {
  const permisosOperario = { INTERVENCIONES_VER: 'PROPIAS' };
  const permisosResponsable = { INTERVENCIONES_VER: 'TODAS' };

  it('Operario: / y /mis-reportes -> true; /tablero -> false', () => {
    assert.equal(esRutaInicio('/', permisosOperario), true);
    assert.equal(esRutaInicio('/mis-reportes', permisosOperario), true);
    assert.equal(esRutaInicio('/tablero', permisosOperario), false);
  });

  it('Responsable: / y /tablero -> true; /mis-reportes -> false', () => {
    assert.equal(esRutaInicio('/', permisosResponsable), true);
    assert.equal(esRutaInicio('/tablero', permisosResponsable), true);
    assert.equal(esRutaInicio('/mis-reportes', permisosResponsable), false);
  });

  it('/notificaciones -> false para los dos', () => {
    assert.equal(esRutaInicio('/notificaciones', permisosOperario), false);
    assert.equal(esRutaInicio('/notificaciones', permisosResponsable), false);
  });
});
