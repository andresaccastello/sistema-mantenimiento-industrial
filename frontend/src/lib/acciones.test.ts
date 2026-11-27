import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ordenarAcciones, etiquetaAccion } from './acciones';

describe('FE-19: ordenarAcciones y etiquetaAccion', () => {
  it('clasifica y ordena acciones en pendiente con principal, visibles y menú', () => {
    const res = ordenarAcciones([
      'TOMAR',
      'ASIGNAR',
      'INICIAR',
      'RESOLVER_AHORA',
      'CANCELAR',
      'REGISTRAR_DETENCION',
      'EDITAR',
      'ELIMINAR',
    ]);
    assert.equal(res.principal, 'INICIAR');
    assert.deepEqual(res.visibles, ['TOMAR', 'ASIGNAR', 'RESOLVER_AHORA']);
    assert.deepEqual(res.menu, ['REGISTRAR_DETENCION', 'EDITAR', 'CANCELAR', 'ELIMINAR']);
  });

  it('clasifica y ordena acciones en proceso con FINALIZAR como principal', () => {
    const res = ordenarAcciones([
      'ASIGNAR',
      'ESPERAR_REPUESTOS',
      'FINALIZAR',
      'CANCELAR',
      'REGISTRAR_DETENCION',
      'EDITAR',
    ]);
    assert.equal(res.principal, 'FINALIZAR');
    assert.deepEqual(res.visibles, ['ASIGNAR', 'ESPERAR_REPUESTOS']);
    assert.deepEqual(res.menu, ['REGISTRAR_DETENCION', 'EDITAR', 'CANCELAR']);
  });

  it('sin principal cuando solo hay visible como REABRIR', () => {
    const res = ordenarAcciones(['REABRIR']);
    assert.equal(res.principal, null);
    assert.deepEqual(res.visibles, ['REABRIR']);
    assert.deepEqual(res.menu, []);
  });

  it('lista vacía o con códigos desconocidos devuelve todo vacío', () => {
    const vacio = ordenarAcciones([]);
    assert.equal(vacio.principal, null);
    assert.deepEqual(vacio.visibles, []);
    assert.deepEqual(vacio.menu, []);

    const desconocido = ordenarAcciones(['ALGO_NUEVO']);
    assert.equal(desconocido.principal, null);
    assert.deepEqual(desconocido.visibles, []);
    assert.deepEqual(desconocido.menu, []);
  });

  it('etiquetaAccion para ASIGNAR según tenga responsable o no', () => {
    assert.equal(etiquetaAccion('ASIGNAR', true), 'Reasignar');
    assert.equal(etiquetaAccion('ASIGNAR', false), 'Asignar');
  });
});
