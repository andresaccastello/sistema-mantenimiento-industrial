import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  avisoSalto,
  borradorMedidorVacio,
  cuerpoMedidor,
  fechaDeMomento,
  leerValorMedidor,
  textoOrigenLectura,
  textoUltimaLectura,
  ultimaDeError,
  validarLectura,
  validarMedidor,
} from './medidores';

describe('FE-109: validarMedidor', () => {
  const b = { nombre: 'Horómetro', unidad: 'horas', lecturaInicial: '' };

  it('un medidor completo no tiene errores; la lectura inicial es opcional', () => {
    assert.deepEqual(validarMedidor(b), {});
    assert.deepEqual(validarMedidor({ ...b, lecturaInicial: 0 }), {});
    assert.deepEqual(validarMedidor({ ...b, lecturaInicial: '1240,5' }), {});
  });

  it('nombre de 3 a 60 y unidad de 1 a 20, recortados', () => {
    assert.equal(validarMedidor({ ...b, nombre: '  ab ' }).nombre, 'Escribí el nombre (de 3 a 60 caracteres).');
    assert.equal(validarMedidor({ ...b, nombre: 'x'.repeat(61) }).nombre, 'Escribí el nombre (de 3 a 60 caracteres).');
    assert.equal(validarMedidor({ ...b, nombre: 'x'.repeat(60) }).nombre, undefined);
    assert.equal(validarMedidor({ ...b, unidad: '   ' }).unidad, 'Escribí la unidad (de 1 a 20 caracteres).');
    assert.equal(validarMedidor({ ...b, unidad: 'x'.repeat(21) }).unidad, 'Escribí la unidad (de 1 a 20 caracteres).');
    assert.equal(validarMedidor({ ...b, unidad: 'h' }).unidad, undefined);
  });

  it('una lectura inicial inválida', () => {
    const msg = 'Ingresá un número desde 0, con hasta 2 decimales.';
    assert.equal(validarMedidor({ ...b, lecturaInicial: -1 }).lecturaInicial, msg);
    assert.equal(validarMedidor({ ...b, lecturaInicial: 1.234 }).lecturaInicial, msg);
    assert.equal(validarMedidor({ ...b, lecturaInicial: 'abc' }).lecturaInicial, msg);
  });
});

describe('FE-110: cuerpoMedidor', () => {
  it('el alta: recortado, y la lectura inicial solo si se escribió', () => {
    assert.deepEqual(cuerpoMedidor({ nombre: ' Horómetro ', unidad: ' horas ', lecturaInicial: '' }), {
      nombre: 'Horómetro',
      unidad: 'horas',
    });
    assert.deepEqual(cuerpoMedidor({ nombre: 'Horómetro', unidad: 'horas', lecturaInicial: '512,5' }), {
      nombre: 'Horómetro',
      unidad: 'horas',
      lectura_inicial: 512.5,
    });
    assert.deepEqual(cuerpoMedidor({ nombre: 'Horómetro', unidad: 'horas', lecturaInicial: 0 }).lectura_inicial, 0);
  });

  it('la edición: solo lo que cambió, nunca la lectura inicial', () => {
    const original = { ...borradorMedidorVacio(), nombre: 'Horómetro', unidad: 'horas' };
    assert.deepEqual(cuerpoMedidor(original, original), {});
    assert.deepEqual(cuerpoMedidor({ ...original, nombre: 'Horómetro ' }, original), {});
    assert.deepEqual(cuerpoMedidor({ ...original, nombre: 'Horómetro 2' }, original), { nombre: 'Horómetro 2' });
    assert.deepEqual(cuerpoMedidor({ ...original, unidad: 'km', lecturaInicial: 5 }, original), { unidad: 'km' });
  });
});

describe('FE-111: leerValorMedidor y validarLectura', () => {
  it('leerValorMedidor: de 0 al máximo, con hasta 2 decimales', () => {
    assert.equal(leerValorMedidor(0), 0);
    assert.equal(leerValorMedidor('512,5'), 512.5);
    assert.equal(leerValorMedidor(12.34), 12.34);
    assert.equal(leerValorMedidor(12.345), null);
    assert.equal(leerValorMedidor(999999999999.99), 999999999999.99);
    assert.equal(leerValorMedidor(1000000000000), null);
    assert.equal(leerValorMedidor(-0.01), null);
    assert.equal(leerValorMedidor(''), null);
  });

  it('vacío y número inválido', () => {
    assert.equal(validarLectura('', null, 'NUEVA', 'horas'), 'Ingresá la lectura.');
    assert.equal(validarLectura(null, 512.5, 'PASADA', 'horas'), 'Ingresá la lectura.');
    assert.equal(validarLectura(1.234, null, 'NUEVA', 'horas'), 'Ingresá un número desde 0, con hasta 2 decimales.');
    assert.equal(validarLectura(-1, null, 'NUEVA', 'horas'), 'Ingresá un número desde 0, con hasta 2 decimales.');
    assert.equal(validarLectura(1000000000000, null, 'NUEVA', 'horas'), 'Ingresá un número desde 0, con hasta 2 decimales.');
    assert.equal(validarLectura(0, null, 'NUEVA', 'horas'), null);
    assert.equal(validarLectura(999999999999.99, null, 'NUEVA', 'horas'), null);
  });

  it("'NUEVA' no baja de la última; igual se acepta", () => {
    assert.equal(validarLectura(512.49, 512.5, 'NUEVA', 'horas'), 'No puede ser menor que la última (512,5 horas).');
    assert.equal(validarLectura('512,5', 512.5, 'NUEVA', 'horas'), null);
    assert.equal(validarLectura(600, 512.5, 'NUEVA', 'horas'), null);
  });

  it("'PASADA' no pasa la última; sin lecturas, cualquiera", () => {
    assert.equal(validarLectura(512.51, 512.5, 'PASADA', 'horas'), 'No puede ser mayor que la última (512,5 horas).');
    assert.equal(validarLectura(480, 512.5, 'PASADA', 'horas'), null);
    assert.equal(validarLectura(512.5, 512.5, 'PASADA', 'horas'), null);
    assert.equal(validarLectura(480, null, 'PASADA', 'horas'), null);
  });
});

describe('FE-112: avisoSalto', () => {
  it('si pasa del doble de la última', () => {
    assert.equal(avisoSalto(12400, 1240, 'horas'), 'Sube de 1.240 a 12.400 horas. Revisá que esté bien.');
    assert.equal(avisoSalto('2480,01', 1240, 'horas'), 'Sube de 1.240 a 2.480,01 horas. Revisá que esté bien.');
  });

  it('el doble justo, la última en 0 o sin lecturas: null', () => {
    assert.equal(avisoSalto(2480, 1240, 'horas'), null);
    assert.equal(avisoSalto(500, 0, 'horas'), null);
    assert.equal(avisoSalto(500, null, 'horas'), null);
    assert.equal(avisoSalto('', 1240, 'horas'), null);
  });
});

describe('FE-113: textoOrigenLectura', () => {
  it('manual o al hacer una tarea', () => {
    assert.equal(textoOrigenLectura({ origen: 'MANUAL' }), 'Manual');
    assert.equal(textoOrigenLectura({ origen: 'TAREA' }), 'Al hacer una tarea');
  });
});

describe('FE-114: textoUltimaLectura, fechaDeMomento y ultimaDeError', () => {
  it('la última, con el valor y la fecha', () => {
    assert.equal(
      textoUltimaLectura({ valor: 512.5, registrada_en: '2026-11-10T15:00:00.000Z' }, 'horas'),
      'Última: 512,5 horas, el 10/11/2026'
    );
    assert.equal(textoUltimaLectura(null, 'horas'), null);
    assert.equal(fechaDeMomento('2026-11-02T15:00:00.000Z'), '02/11/2026');
    assert.equal(fechaDeMomento(null), '—');
  });

  it('el valor de `ultima` de los detalles de un error', () => {
    assert.equal(ultimaDeError({ ultima: { valor: 512.5, registrada_en: '2026-11-10T15:00:00.000Z' } }), 512.5);
    assert.equal(ultimaDeError({ ultima: null }), null);
    assert.equal(ultimaDeError({ ultima: { valor: '512.5' } }), null);
    assert.equal(ultimaDeError(undefined), null);
  });
});
