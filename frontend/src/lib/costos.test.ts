import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  etiquetaTipoCosto,
  formatHoras,
  importeManoObra,
  validarHoras,
  validarImporteCosto,
  cuerpoCosto,
  textoTotalNegativo,
} from './costos';

describe('FE-58: etiquetaTipoCosto y formatHoras', () => {
  it('los cinco tipos y uno desconocido', () => {
    assert.equal(etiquetaTipoCosto('MANO_OBRA'), 'Mano de obra');
    assert.equal(etiquetaTipoCosto('SERVICIO_EXTERNO'), 'Servicio externo');
    assert.equal(etiquetaTipoCosto('TRANSPORTE'), 'Transporte');
    assert.equal(etiquetaTipoCosto('OTRO'), 'Otro');
    assert.equal(etiquetaTipoCosto('AJUSTE'), 'Ajuste');
    assert.equal(etiquetaTipoCosto('DESCONOCIDO'), 'DESCONOCIDO');
  });

  it('formatHoras con los ejemplos de 8.2', () => {
    assert.equal(formatHoras(2.5), '2,5 h');
    assert.equal(formatHoras(1), '1 h');
    assert.equal(formatHoras(null), '—');
  });

  it('textoTotalNegativo, para el 409 TOTAL_NEGATIVO', () => {
    assert.equal(textoTotalNegativo(-500), 'El total de la intervención quedaría en $ −500,00.');
    assert.equal(textoTotalNegativo(-1234.5), 'El total de la intervención quedaría en $ −1.234,50.');
    assert.equal(textoTotalNegativo(undefined), 'El total de la intervención quedaría negativo.');
  });
});

describe('FE-59: importeManoObra', () => {
  it('los tres ejemplos de 8.2, redondeados como ROUND de SQL', () => {
    assert.equal(importeManoObra(2.5, 1200), 3000);
    assert.equal(importeManoObra(0.5, 2.01), 1.01);
    assert.equal(importeManoObra(1.5, 0.03), 0.05);
  });

  it('1000 × 9.999.999,99, sin errores de coma flotante', () => {
    assert.equal(importeManoObra(1000, 9999999.99), 9999999990);
  });
});

describe('FE-60: validarHoras y validarImporteCosto', () => {
  it('validarHoras: cada mensaje', () => {
    assert.equal(validarHoras(''), 'Ingresá las horas.');
    assert.equal(validarHoras(null), 'Ingresá las horas.');
    assert.equal(validarHoras(0), 'Tienen que ser más que cero.');
    assert.equal(validarHoras(-2), 'Tienen que ser más que cero.');
    assert.equal(validarHoras('1,255'), 'Hasta dos decimales.');
    assert.equal(validarHoras(1000.5), 'Hasta 1.000 horas.');
  });

  it('validarHoras: null con valores válidos', () => {
    assert.equal(validarHoras(2.5), null);
    assert.equal(validarHoras('0,25'), null);
    assert.equal(validarHoras(1000), null);
  });

  it('validarImporteCosto: cada mensaje', () => {
    assert.equal(validarImporteCosto('OTRO', ''), 'Ingresá un importe.');
    assert.equal(validarImporteCosto('TRANSPORTE', -1), 'No puede ser negativo.');
    assert.equal(validarImporteCosto('MANO_OBRA', -0.5), 'No puede ser negativo.');
    assert.equal(validarImporteCosto('AJUSTE', 0), 'El ajuste no puede ser cero.');
    assert.equal(validarImporteCosto('SERVICIO_EXTERNO', '10,555'), 'Hasta dos decimales.');
  });

  it('validarImporteCosto: null con valores válidos, incluido un ajuste negativo', () => {
    assert.equal(validarImporteCosto('OTRO', 0), null);
    assert.equal(validarImporteCosto('SERVICIO_EXTERNO', 1500.5), null);
    assert.equal(validarImporteCosto('AJUSTE', -1000), null);
    assert.equal(validarImporteCosto('AJUSTE', '250,75'), null);
  });
});

describe('FE-61: cuerpoCosto', () => {
  it('mano de obra interna con valor hora: manda valor_hora, no importe', () => {
    assert.deepEqual(
      cuerpoCosto({
        tipo: 'MANO_OBRA',
        externa: false,
        usuarioId: 41,
        proveedorId: 7,
        horas: 2.5,
        valorHora: 1200,
        importe: 3000,
        descripcion: '  Cambio de rodamientos ',
      }),
      { tipo: 'MANO_OBRA', horas: 2.5, usuario_id: 41, valor_hora: 1200, descripcion: 'Cambio de rodamientos' }
    );
  });

  it('mano de obra interna sin valor hora: manda importe', () => {
    assert.deepEqual(
      cuerpoCosto({ tipo: 'MANO_OBRA', externa: false, usuarioId: 41, horas: 3, valorHora: null, importe: 4500, descripcion: '' }),
      { tipo: 'MANO_OBRA', horas: 3, usuario_id: 41, importe: 4500 }
    );
  });

  it('mano de obra externa con valor hora: manda proveedor_id y valor_hora', () => {
    assert.deepEqual(
      cuerpoCosto({ tipo: 'MANO_OBRA', externa: true, usuarioId: 41, proveedorId: 7, horas: 4, valorHora: 5000 }),
      { tipo: 'MANO_OBRA', horas: 4, proveedor_id: 7, valor_hora: 5000 }
    );
  });

  it('mano de obra externa sin valor hora, con motivo', () => {
    assert.deepEqual(
      cuerpoCosto({ tipo: 'MANO_OBRA', externa: true, proveedorId: 7, horas: 4, importe: 20000, motivo: 'Faltó cargar la factura' }),
      { tipo: 'MANO_OBRA', horas: 4, proveedor_id: 7, importe: 20000, motivo: 'Faltó cargar la factura' }
    );
  });

  it('servicio externo, transporte y otro: sin horas, persona ni valor hora', () => {
    assert.deepEqual(
      cuerpoCosto({ tipo: 'SERVICIO_EXTERNO', descripcion: 'Rebobinado', proveedorId: 7, importe: 8000, horas: 2, usuarioId: 41, valorHora: 10 }),
      { tipo: 'SERVICIO_EXTERNO', descripcion: 'Rebobinado', importe: 8000, proveedor_id: 7 }
    );
    assert.deepEqual(
      cuerpoCosto({ tipo: 'TRANSPORTE', descripcion: 'Flete', proveedorId: null, importe: 500 }),
      { tipo: 'TRANSPORTE', descripcion: 'Flete', importe: 500 }
    );
    assert.deepEqual(
      cuerpoCosto({ tipo: 'OTRO', descripcion: 'Insumos', importe: 150, motivo: 'Corrección de cierre' }),
      { tipo: 'OTRO', descripcion: 'Insumos', importe: 150, motivo: 'Corrección de cierre' }
    );
  });

  it('ajuste: descripción, importe negativo y motivo, sin proveedor', () => {
    assert.deepEqual(
      cuerpoCosto({ tipo: 'AJUSTE', descripcion: 'Bonificación', importe: -200, motivo: 'Bonificación acordada', proveedorId: 7 }),
      { tipo: 'AJUSTE', descripcion: 'Bonificación', importe: -200, motivo: 'Bonificación acordada' }
    );
  });
});
