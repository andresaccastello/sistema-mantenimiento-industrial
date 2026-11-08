import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TipoCosto } from '../api/tipos';
import {
  BorradorCosto,
  borradorVacio,
  borradorEmpezado,
  validarBorrador,
  validarValorHora,
  validarImporteCosto,
  validarMotivoCosto,
  cuerposLote,
  cuerpoCosto,
  textoBotonAgregar,
  textoCostosAgregados,
} from './costos';

/** Un borrador vacío con los campos indicados. */
function con(campos: Partial<BorradorCosto>): BorradorCosto {
  return { ...borradorVacio(), ...campos };
}

function todosVacios(): Record<TipoCosto, BorradorCosto> {
  return {
    MANO_OBRA: borradorVacio(),
    SERVICIO_EXTERNO: borradorVacio(),
    TRANSPORTE: borradorVacio(),
    OTRO: borradorVacio(),
    AJUSTE: borradorVacio(),
  };
}

describe('FE-63: borradorVacio y borradorEmpezado', () => {
  it('el vacío, solo Externa y solo espacios no cuentan', () => {
    assert.deepEqual(borradorVacio(), {
      externa: false,
      usuarioId: null,
      proveedorId: null,
      horas: '',
      valorHora: '',
      importe: '',
      descripcion: '',
      motivo: '',
    });
    assert.equal(borradorEmpezado(borradorVacio()), false);
    assert.equal(borradorEmpezado(con({ externa: true })), false);
    assert.equal(borradorEmpezado(con({ descripcion: '   ', motivo: '  ', horas: ' ' })), false);
  });

  it('cualquier otro campo, sí', () => {
    assert.equal(borradorEmpezado(con({ usuarioId: '41' })), true);
    assert.equal(borradorEmpezado(con({ proveedorId: '7' })), true);
    assert.equal(borradorEmpezado(con({ horas: 2 })), true);
    assert.equal(borradorEmpezado(con({ valorHora: 1200 })), true);
    assert.equal(borradorEmpezado(con({ importe: 0 })), true);
    assert.equal(borradorEmpezado(con({ descripcion: 'Flete' })), true);
    assert.equal(borradorEmpezado(con({ motivo: 'Descuento' })), true);
  });
});

describe('FE-64: validarBorrador, validarValorHora y el máximo de validarImporteCosto', () => {
  const sinFinalizar = { finalizada: false };

  it('mano de obra: los mensajes de hoy', () => {
    assert.deepEqual(validarBorrador('MANO_OBRA', borradorVacio(), sinFinalizar), {
      persona: 'Elegí la persona.',
      horas: 'Ingresá las horas.',
      importe: 'Ingresá un importe.',
    });
    assert.deepEqual(validarBorrador('MANO_OBRA', con({ externa: true, horas: 2, importe: 100, descripcion: 'ab' }), sinFinalizar), {
      proveedor: 'Elegí el proveedor.',
      descripcion: 'Entre 3 y 200 caracteres.',
    });
    assert.deepEqual(validarBorrador('MANO_OBRA', con({ usuarioId: '41', horas: 2.5, valorHora: 1200 }), sinFinalizar), {});
  });

  it('servicio externo, transporte y otro: descripción e importe', () => {
    for (const tipo of ['SERVICIO_EXTERNO', 'TRANSPORTE', 'OTRO'] as TipoCosto[]) {
      assert.deepEqual(validarBorrador(tipo, borradorVacio(), sinFinalizar), {
        descripcion: 'Ingresá una descripción de 3 a 200 caracteres.',
        importe: 'Ingresá un importe.',
      });
      assert.deepEqual(validarBorrador(tipo, con({ descripcion: 'Flete', importe: -1 }), sinFinalizar), {
        importe: 'No puede ser negativo.',
      });
      assert.deepEqual(validarBorrador(tipo, con({ descripcion: 'Flete', importe: 500 }), sinFinalizar), {});
    }
  });

  it('ajuste: el motivo solo sin finalizar', () => {
    const ajuste = con({ descripcion: 'Descuento', importe: -100 });
    assert.deepEqual(validarBorrador('AJUSTE', ajuste, sinFinalizar), {
      motivo: 'Ingresá un motivo de al menos 5 caracteres.',
    });
    assert.deepEqual(validarBorrador('AJUSTE', ajuste, { finalizada: true }), {});
    assert.deepEqual(validarBorrador('AJUSTE', con({ descripcion: 'Descuento', importe: 0, motivo: 'Acordado' }), sinFinalizar), {
      importe: 'El ajuste no puede ser cero.',
    });
    // Los otros tipos no piden motivo, finalizada o no
    assert.deepEqual(validarBorrador('OTRO', con({ descripcion: 'Insumos', importe: 1 }), { finalizada: true }), {});
    assert.equal(validarMotivoCosto('Hola'), 'Ingresá un motivo de al menos 5 caracteres.');
    assert.equal(validarMotivoCosto('  Hola  '), 'Ingresá un motivo de al menos 5 caracteres.');
    assert.equal(validarMotivoCosto('Acordado'), null);
  });

  it('importe: hasta 1.000.000.000, en el ajuste en valor absoluto', () => {
    const otro = (importe: number) => con({ descripcion: 'Insumos', importe });
    assert.deepEqual(validarBorrador('OTRO', otro(1000000000), sinFinalizar), {});
    assert.deepEqual(validarBorrador('OTRO', otro(1000000000.01), sinFinalizar), { importe: 'Hasta $ 1.000.000.000.' });
    const ajuste = (importe: number) => con({ descripcion: 'Descuento', importe, motivo: 'Acordado' });
    assert.deepEqual(validarBorrador('AJUSTE', ajuste(-1000000000), sinFinalizar), {});
    assert.deepEqual(validarBorrador('AJUSTE', ajuste(-1000000000.01), sinFinalizar), { importe: 'Hasta $ 1.000.000.000.' });

    assert.equal(validarImporteCosto('TRANSPORTE', 1000000000), null);
    assert.equal(validarImporteCosto('TRANSPORTE', 1000000000.01), 'Hasta $ 1.000.000.000.');
    assert.equal(validarImporteCosto('AJUSTE', '-1000000000,01'), 'Hasta $ 1.000.000.000.');
  });

  it('valor hora: hasta 10.000.000', () => {
    const mo = (valorHora: number) => con({ usuarioId: '41', horas: 1, valorHora });
    assert.deepEqual(validarBorrador('MANO_OBRA', mo(10000000), sinFinalizar), {});
    assert.deepEqual(validarBorrador('MANO_OBRA', mo(10000000.01), sinFinalizar), { valorHora: 'Hasta $ 10.000.000.' });

    assert.equal(validarValorHora(''), null);
    assert.equal(validarValorHora(null), null);
    assert.equal(validarValorHora(0), null);
    assert.equal(validarValorHora('1200,5'), null);
    assert.equal(validarValorHora(-1), 'No puede ser negativo.');
    assert.equal(validarValorHora('10,555'), 'Hasta dos decimales.');
    assert.equal(validarValorHora(10000000), null);
    assert.equal(validarValorHora(10000000.01), 'Hasta $ 10.000.000.');
  });

  it('importe calculado: hasta 1.000.000.000, debajo de Valor hora', () => {
    // 100 h × 10.000.000 = 1.000.000.000 justo; 100 h × 10.000.000,01 = 1.000.000.001
    const borde = con({ usuarioId: '41', horas: 100, valorHora: 10000000 });
    assert.deepEqual(validarBorrador('MANO_OBRA', borde, sinFinalizar), {});
    // 1000 h × 1.000.000,01 = 1.000.000.010: un centavo arriba en el valor hora
    const arriba = con({ usuarioId: '41', horas: 1000, valorHora: 1000000.01 });
    assert.deepEqual(validarBorrador('MANO_OBRA', arriba, sinFinalizar), {
      valorHora: 'El importe calculado pasa de $ 1.000.000.000.',
    });
    const centesimo = con({ usuarioId: '41', horas: 100.01, valorHora: 10000000 });
    assert.deepEqual(validarBorrador('MANO_OBRA', centesimo, sinFinalizar), {
      valorHora: 'El importe calculado pasa de $ 1.000.000.000.',
    });
  });
});

describe('FE-65: cuerposLote', () => {
  it('solo las empezadas, en el orden de las pestañas; sin finalizar, el motivo solo en el ajuste', () => {
    const b = todosVacios();
    b.AJUSTE = con({ descripcion: 'Descuento', importe: -100, motivo: 'Descuento acordado' });
    b.TRANSPORTE = con({ descripcion: 'Flete', importe: 500, proveedorId: '7' });
    b.MANO_OBRA = con({ usuarioId: '41', proveedorId: '9', horas: 2.5, valorHora: 1200, importe: 999 });

    const cuerpos = cuerposLote(b, { finalizada: false, motivoCorreccion: 'No se usa' });
    assert.deepEqual(cuerpos, [
      { tipo: 'MANO_OBRA', horas: 2.5, usuario_id: 41, valor_hora: 1200 },
      { tipo: 'TRANSPORTE', descripcion: 'Flete', importe: 500, proveedor_id: 7 },
      { tipo: 'AJUSTE', descripcion: 'Descuento', importe: -100, motivo: 'Descuento acordado' },
    ]);
    // Cada uno, igual al de cuerpoCosto con el mismo borrador
    assert.deepEqual(cuerpos, [
      cuerpoCosto({ tipo: 'MANO_OBRA', externa: false, usuarioId: 41, horas: 2.5, valorHora: 1200, importe: null, descripcion: '' }),
      cuerpoCosto({ tipo: 'TRANSPORTE', descripcion: 'Flete', importe: 500, proveedorId: 7 }),
      cuerpoCosto({ tipo: 'AJUSTE', descripcion: 'Descuento', importe: -100, motivo: 'Descuento acordado' }),
    ]);
  });

  it('con la finalizada, el motivo de la corrección en todos', () => {
    const b = todosVacios();
    b.OTRO = con({ descripcion: 'Insumos', importe: 150 });
    b.MANO_OBRA = con({ externa: true, proveedorId: '7', horas: 4, importe: 20000, descripcion: 'Rebobinado' });
    b.AJUSTE = con({ descripcion: 'Descuento', importe: -50 });

    const cuerpos = cuerposLote(b, { finalizada: true, motivoCorreccion: ' Faltó cargarlos ' });
    assert.deepEqual(cuerpos, [
      cuerpoCosto({
        tipo: 'MANO_OBRA',
        externa: true,
        proveedorId: 7,
        horas: 4,
        importe: 20000,
        descripcion: 'Rebobinado',
        motivo: 'Faltó cargarlos',
      }),
      cuerpoCosto({ tipo: 'OTRO', descripcion: 'Insumos', importe: 150, motivo: 'Faltó cargarlos' }),
      cuerpoCosto({ tipo: 'AJUSTE', descripcion: 'Descuento', importe: -50, motivo: 'Faltó cargarlos' }),
    ]);
    assert.deepEqual(cuerpos[0], {
      tipo: 'MANO_OBRA',
      horas: 4,
      proveedor_id: 7,
      importe: 20000,
      descripcion: 'Rebobinado',
      motivo: 'Faltó cargarlos',
    });
  });

  it('con valor hora no va el importe; sin valor hora, sí', () => {
    const b = todosVacios();
    b.MANO_OBRA = con({ usuarioId: '41', horas: 3, valorHora: '', importe: 4500 });
    assert.deepEqual(cuerposLote(b, { finalizada: false, motivoCorreccion: '' }), [
      { tipo: 'MANO_OBRA', horas: 3, usuario_id: 41, importe: 4500 },
    ]);
    b.MANO_OBRA = con({ usuarioId: '41', horas: 3, valorHora: 1500, importe: 4500 });
    const [cuerpo] = cuerposLote(b, { finalizada: false, motivoCorreccion: '' });
    assert.equal('importe' in cuerpo, false);
    assert.equal(cuerpo.tipo === 'MANO_OBRA' && cuerpo.valor_hora, 1500);
  });

  it('sin pestañas empezadas, ningún cuerpo', () => {
    const b = todosVacios();
    b.MANO_OBRA = con({ externa: true, descripcion: '  ' });
    assert.deepEqual(cuerposLote(b, { finalizada: false, motivoCorreccion: '' }), []);
  });
});

describe('FE-66: textoBotonAgregar y textoCostosAgregados', () => {
  it('con 0, 1, 2 y 5', () => {
    assert.equal(textoBotonAgregar(0), 'Agregar costo');
    assert.equal(textoBotonAgregar(1), 'Agregar costo');
    assert.equal(textoBotonAgregar(2), 'Agregar 2 costos');
    assert.equal(textoBotonAgregar(5), 'Agregar 5 costos');
    assert.equal(textoCostosAgregados(0), 'Costo agregado.');
    assert.equal(textoCostosAgregados(1), 'Costo agregado.');
    assert.equal(textoCostosAgregados(2), 'Se agregaron 2 costos.');
    assert.equal(textoCostosAgregados(5), 'Se agregaron 5 costos.');
  });
});
