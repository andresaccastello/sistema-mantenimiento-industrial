import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cuerpoIdentidad, errorArchivoLogo, erroresIdentidad, tituloPestana, urlLogo } from './identidad';

describe('FE-160: la identidad del sistema (D1, 6)', () => {
  it('el logo se pide con ?v=<actualizado_en>', () => {
    assert.equal(
      urlLogo('http://api', '2026-11-18T12:00:00.000Z'),
      'http://api/api/configuracion/logo?v=2026-11-18T12%3A00%3A00.000Z'
    );
    assert.equal(urlLogo('http://api', undefined), 'http://api/api/configuracion/logo');
  });

  it('el archivo del logo: PNG, JPEG o WEBP, hasta 300 KB', () => {
    assert.equal(errorArchivoLogo({ type: 'image/png', size: 1000 }), null);
    assert.equal(errorArchivoLogo({ type: 'image/webp', size: 300 * 1024 }), null);
    assert.equal(errorArchivoLogo({ type: 'image/svg+xml', size: 1000 }), 'El logo tiene que ser una imagen PNG, JPEG o WEBP.');
    assert.equal(errorArchivoLogo({ type: 'image/jpeg', size: 300 * 1024 + 1 }), 'El logo no puede pasar de 300 KB.');
    assert.equal(errorArchivoLogo({ type: 'image/png', size: 0 }), 'El archivo está vacío.');
  });

  it('los nombres: el del sistema de 3 a 80; el de la empresa, vacío o de 2 a 120', () => {
    assert.deepEqual(erroresIdentidad('  Sistema  ', ''), { sistema: null, empresa: null });
    assert.deepEqual(erroresIdentidad('ab', 'x'), { sistema: 'De 3 a 80 caracteres.', empresa: 'De 2 a 120 caracteres, o vacío.' });
    assert.equal(erroresIdentidad('x'.repeat(81), '').sistema, 'De 3 a 80 caracteres.');
    assert.equal(erroresIdentidad('Sistema', 'y'.repeat(121)).empresa, 'De 2 a 120 caracteres, o vacío.');
  });

  it('el cuerpo, recortado y con la empresa vacía en null; el título de la pestaña', () => {
    assert.deepEqual(cuerpoIdentidad('  Planta Norte  ', '   '), { nombre_sistema: 'Planta Norte', nombre_empresa: null });
    assert.deepEqual(cuerpoIdentidad('Sistema', ' Empresa '), { nombre_sistema: 'Sistema', nombre_empresa: 'Empresa' });
    assert.equal(tituloPestana('Mantenimiento Norte'), 'Mantenimiento Norte');
    assert.equal(tituloPestana(''), 'Sistema de Mantenimiento Industrial');
    assert.equal(tituloPestana(undefined), 'Sistema de Mantenimiento Industrial');
  });
});
