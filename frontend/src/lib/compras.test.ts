import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CompraFila } from '../api/tipos';
import {
  preguntarEspera,
  observacionEspera,
  ofrecerReanudar,
  textoResumenRecepcion,
  filasCsvCompras,
  permiteUsarAlRecibir,
  textoUsado,
  pedidosSinRecibir,
  textoPedidosSinRecibir,
  veReporteCompras,
  textoOrigenCompra,
  textoSinCosto,
  textoIngresosSinProveedor,
  proveedorPrincipal,
} from './compras';

const filaStock: CompraFila = {
  fecha: '2026-11-10',
  proveedor: { id: 4, nombre: 'Rodamientos del Sur' },
  comprobante: 'A-0001-00001234',
  repuesto: { id: 12, codigo: 'RUL-6204', nombre: 'Rulemán 6204' },
  descripcion: null,
  cantidad: 100,
  unidad: 'unidad',
  costo_unitario: 5000,
  importe: 500000,
  origen: { tipo: 'STOCK', intervencion: null },
};

const filaIntervencion: CompraFila = {
  fecha: '2026-11-09',
  proveedor: null,
  comprobante: null,
  repuesto: null,
  descripcion: 'Correa trapezoidal A-42',
  cantidad: 1.5,
  unidad: 'unidad',
  costo_unitario: null,
  importe: null,
  origen: { tipo: 'INTERVENCION', intervencion: { id: 18, maquina: { id: 3, codigo: 'PIN-01' } } },
};

describe('FE-144: cuándo preguntar por la espera (6.1)', () => {
  it('en proceso y con "Esperar repuestos": sí', () => {
    assert.equal(preguntarEspera('EN_PROCESO', ['FINALIZAR', 'ESPERAR_REPUESTOS']), true);
  });
  it('sin la acción, o en otro estado: no', () => {
    assert.equal(preguntarEspera('EN_PROCESO', ['FINALIZAR']), false);
    assert.equal(preguntarEspera('EN_ESPERA_REPUESTOS', ['ESPERAR_REPUESTOS', 'REANUDAR']), false);
    assert.equal(preguntarEspera('PENDIENTE', ['ESPERAR_REPUESTOS']), false);
  });
  it('la observación precargada', () => {
    assert.equal(
      observacionEspera({ id: 18, cantidad: 4, repuesto: { nombre: 'Rulemán 6204' }, descripcion: null }),
      'Esperando: Rulemán 6204 × 4 (pedido N.º 18)'
    );
    assert.equal(
      observacionEspera({ id: 7, cantidad: 2.5, repuesto: null, descripcion: 'Correa A-42' }),
      'Esperando: Correa A-42 × 2,5 (pedido N.º 7)'
    );
  });
});

describe('FE-145: cuándo ofrecer reanudar (6.3)', () => {
  it('esperando repuestos y sin pedidos abiertos: sí', () => {
    assert.equal(ofrecerReanudar({ intervencion_estado: 'EN_ESPERA_REPUESTOS', pedidos_abiertos: 0 }, true), true);
  });
  it('con pedidos abiertos, en otro estado o sin poder reanudar: no', () => {
    assert.equal(ofrecerReanudar({ intervencion_estado: 'EN_ESPERA_REPUESTOS', pedidos_abiertos: 1 }, true), false);
    assert.equal(ofrecerReanudar({ intervencion_estado: 'EN_PROCESO', pedidos_abiertos: 0 }, true), false);
    assert.equal(ofrecerReanudar({ intervencion_estado: 'EN_ESPERA_REPUESTOS', pedidos_abiertos: 0 }, false), false);
  });
});

describe('FE-146: el texto que resume la recepción (6.2)', () => {
  const base = { cantidad: 10, llevaStock: true, ingresarStock: true, usar: true, cantidadUso: 4, costoUnitario: 150, stockAntes: 0 };
  it('con stock: entran, se usan y quedan', () => {
    assert.equal(
      textoResumenRecepcion(base),
      'Entran 10 al stock y se usan 4 en esta intervención. Quedan 6 más en stock (total: 6).'
    );
    assert.equal(
      textoResumenRecepcion({ ...base, cantidadUso: 10 }),
      'Entran 10 al stock y se usan 10 en esta intervención. No queda nada más en stock (total: 0).'
    );
    // LE1, 7.2: con stock de antes, el total suma lo que había
    assert.equal(
      textoResumenRecepcion({ ...base, cantidad: 5, cantidadUso: 2, stockAntes: 2 }),
      'Entran 5 al stock y se usan 2 en esta intervención. Quedan 3 más en stock (total: 5).'
    );
    assert.equal(
      textoResumenRecepcion({ ...base, cantidad: 5, usar: false, stockAntes: 2 }),
      'Entran 5 al stock (total: 7).'
    );
    // Sin conocer el stock de antes, sin total
    assert.equal(
      textoResumenRecepcion({ ...base, stockAntes: null }),
      'Entran 10 al stock y se usan 4 en esta intervención. Quedan 6 más en stock.'
    );
  });
  it('sin stock: se usa todo, con o sin costo', () => {
    const sinStock = { cantidad: 1, llevaStock: false, ingresarStock: false, usar: true, cantidadUso: 1, costoUnitario: 85000, stockAntes: null };
    assert.equal(textoResumenRecepcion(sinStock), 'Se usa en esta intervención: 1 × $ 85.000,00.');
    assert.equal(textoResumenRecepcion({ ...sinStock, costoUnitario: null }), 'Se usa en esta intervención: 1.');
  });
  it('sin usar', () => {
    assert.equal(textoResumenRecepcion({ ...base, usar: false }), 'Entran 10 al stock (total: 10).');
    assert.equal(
      textoResumenRecepcion({ ...base, usar: false, ingresarStock: false, llevaStock: false }),
      'Se recibe sin entrar al stock.'
    );
  });
  it('"Usar" se ofrece solo en proceso o esperando repuestos (D5)', () => {
    assert.equal(permiteUsarAlRecibir('EN_PROCESO'), true);
    assert.equal(permiteUsarAlRecibir('EN_ESPERA_REPUESTOS'), true);
    for (const e of ['PENDIENTE', 'FINALIZADA', 'CANCELADA', null, undefined]) {
      assert.equal(permiteUsarAlRecibir(e), false, String(e));
    }
  });
});

describe('FE-147: las filas del CSV de compras', () => {
  it('columnas y filas, con el origen y sin costo vacío', () => {
    const { columnas, filas } = filasCsvCompras({ filas: [filaStock, filaIntervencion] });
    assert.deepEqual(columnas, [
      'Fecha', 'Proveedor', 'Comprobante', 'Repuesto o descripción', 'Cantidad', 'Unidad', 'Costo unitario', 'Importe', 'Origen',
    ]);
    assert.deepEqual(filas, [
      ['10/11/2026', 'Rodamientos del Sur', 'A-0001-00001234', 'RUL-6204 · Rulemán 6204', 100, 'unidad', 5000, 500000, 'Stock'],
      ['09/11/2026', 'Sin proveedor', '', 'Correa trapezoidal A-42', 1.5, 'unidad', null, null, 'Intervención N.º 18 · PIN-01'],
    ]);
  });
  it('sin datos', () => {
    assert.deepEqual(filasCsvCompras(null).filas, []);
  });
});

describe('FE-148: textos de pedidos y compras', () => {
  it('usado y pedidos sin recibir', () => {
    assert.equal(textoUsado(4, 10), 'Usado: 4 de 10');
    assert.equal(pedidosSinRecibir([{ estado: 'PENDIENTE' }, { estado: 'PEDIDO' }, { estado: 'RECIBIDO' }, { estado: 'CANCELADO' }]), 2);
    assert.equal(textoPedidosSinRecibir(0), '');
    assert.equal(textoPedidosSinRecibir(1), 'Queda 1 pedido sin recibir. Queda abierto: podés cancelarlo desde Pedidos.');
    assert.equal(textoPedidosSinRecibir(2), 'Quedan 2 pedidos sin recibir. Quedan abiertos: podés cancelarlos desde Pedidos.');
  });
  it('quién ve el reporte (D6)', () => {
    assert.equal(veReporteCompras('TODAS', true), true);
    assert.equal(veReporteCompras({ alcance: 'TODAS' }, true), true);
    assert.equal(veReporteCompras('SECTORES', true), false);
    assert.equal(veReporteCompras('TODAS', false), false);
    assert.equal(veReporteCompras(null, true), false);
  });
  it('origen, avisos y proveedor principal', () => {
    assert.equal(textoOrigenCompra(filaStock), 'Stock');
    assert.equal(textoOrigenCompra(filaIntervencion), 'Intervención N.º 18 · PIN-01');
    assert.equal(textoSinCosto(0), '');
    assert.equal(textoSinCosto(1), '1 compra sin costo: no suma al total');
    assert.equal(textoSinCosto(2), '2 compras sin costo: no suman al total');
    assert.equal(textoIngresosSinProveedor(3), '3 ingresos sin proveedor no se cuentan como compra');
    assert.equal(textoIngresosSinProveedor(1), '1 ingreso sin proveedor no se cuenta como compra');
    assert.deepEqual(
      proveedorPrincipal({ por_proveedor: [{ proveedor: { id: 4, nombre: 'Rodamientos del Sur' }, compras: 3, importe: 500000 }] }),
      { nombre: 'Rodamientos del Sur', importe: 500000 }
    );
    assert.equal(proveedorPrincipal({ por_proveedor: [{ proveedor: null, compras: 1, importe: 0 }] }), null);
    assert.equal(proveedorPrincipal({ por_proveedor: [] }), null);
  });
});
