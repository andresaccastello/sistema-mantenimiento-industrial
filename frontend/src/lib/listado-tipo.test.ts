import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { leerFiltros, escribirFiltros, paramsListado, hayFiltros } from './listado';

describe('FE-78: filtro Tipo de la lista de intervenciones (PV2, 5.2)', () => {
  it('se lee y se escribe en la dirección; sin él, todas', () => {
    const prev = leerFiltros(new URLSearchParams('tipo=PREVENTIVO'));
    assert.equal(prev.tipo, 'PREVENTIVO');
    assert.equal(escribirFiltros(prev).toString(), 'tipo=PREVENTIVO');
    assert.equal(leerFiltros(new URLSearchParams('tipo=CORRECTIVO')).tipo, 'CORRECTIVO');

    const todas = leerFiltros(new URLSearchParams(''));
    assert.ok(!('tipo' in todas), 'Sin tipo en la dirección, la clave no está');
    assert.ok(!('tipo' in leerFiltros(new URLSearchParams('tipo=OTRO'))), 'Un tipo raro se ignora');
  });

  it('va a la API y cuenta como filtro', () => {
    const prev = leerFiltros(new URLSearchParams('tipo=PREVENTIVO'));
    assert.equal(paramsListado(prev, 25).tipo, 'PREVENTIVO');
    assert.ok(hayFiltros(prev));

    const todas = leerFiltros(new URLSearchParams(''));
    assert.ok(!('tipo' in paramsListado(todas, 25)));
    assert.equal(hayFiltros(todas), false);
  });
});
