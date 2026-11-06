import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoneda, formatCantidad } from './formato';
import {
  infoEstadoStock,
  resumenStock,
  validarCantidad,
  validarCosto,
  leerFiltrosRepuestos,
  escribirFiltrosRepuestos,
  filtrarRepuestos,
  hoyLocal,
  infoPedido,
  textoMovimiento,
} from './repuestos';

describe('FE-47: formatMoneda y formatCantidad', () => {
  it('formatMoneda formatea valores con dos decimales, separador de miles con punto y espacio común', () => {
    assert.equal(formatMoneda(12345.5), '$ 12.345,50');
    assert.equal(formatMoneda(0), '$ 0,00');
    assert.equal(formatMoneda(null), '—');
    assert.equal(formatMoneda(undefined), '—');
    // Verifica que el espacio sea U+0020 (espacio común)
    assert.equal(formatMoneda(100).charCodeAt(1), 32);
  });

  it('formatCantidad formatea enteros y decimales con coma y punto de miles', () => {
    assert.equal(formatCantidad(2), '2');
    assert.equal(formatCantidad(1.5), '1,5');
    assert.equal(formatCantidad(1234.25), '1.234,25');
    assert.equal(formatCantidad(0.125), '0,125');
    assert.equal(formatCantidad(null), '—');
    assert.equal(formatCantidad(undefined), '—');
  });
});

describe('FE-48: infoEstadoStock y resumenStock', () => {
  it('infoEstadoStock cubre los cuatro estados y sus etiquetas y colores', () => {
    assert.deepEqual(infoEstadoStock('OK'), { etiqueta: 'En stock', color: 'verde' });
    assert.deepEqual(infoEstadoStock('BAJO'), { etiqueta: 'Bajo mínimo', color: 'naranja' });
    assert.deepEqual(infoEstadoStock('SIN_STOCK'), { etiqueta: 'Sin stock', color: 'rojo' });
    assert.deepEqual(infoEstadoStock('SIN_CONTROL'), {
      etiqueta: 'Sin control de stock',
      color: 'gris',
    });
  });

  it('resumenStock cuenta activos e ignora inactivos', () => {
    const lista = [
      { activo: true, estado_stock: 'OK' },
      { activo: true, estado_stock: 'BAJO' },
      { activo: true, estado_stock: 'SIN_STOCK' },
      { activo: true, estado_stock: 'SIN_CONTROL' },
      { activo: false, estado_stock: 'BAJO' },
      { activo: false, estado_stock: 'SIN_STOCK' },
    ];
    const res = resumenStock(lista);
    assert.deepEqual(res, {
      total: 4,
      bajo: 1,
      sinStock: 1,
    });
  });
});

describe('FE-49: validarCantidad y validarCosto', () => {
  it('validarCantidad valida vacíos, ceros, negativos, decimales y máximo', () => {
    assert.equal(validarCantidad(''), 'Ingresá una cantidad.');
    assert.equal(validarCantidad(null), 'Ingresá una cantidad.');
    assert.equal(validarCantidad('0'), 'Tiene que ser mayor que cero.');
    assert.equal(validarCantidad('-5'), 'Tiene que ser mayor que cero.');
    assert.equal(validarCantidad('1.1234'), 'Hasta tres decimales.');
    assert.equal(validarCantidad('5', 3), 'Hay 3 en stock.');
    assert.equal(validarCantidad('5', 2.5), 'Hay 2,5 en stock.');

    // Valores válidos
    assert.equal(validarCantidad('1'), null);
    assert.equal(validarCantidad('0.5'), null);
    assert.equal(validarCantidad('0.125'), null);
    assert.equal(validarCantidad(1), null);
    assert.equal(validarCantidad(0.5), null);
    assert.equal(validarCantidad(0.125), null);
  });

  it('validarCosto valida vacíos, negativos, decimales y válidos', () => {
    assert.equal(validarCosto(''), null);
    assert.equal(validarCosto(null), null);
    assert.equal(validarCosto('-10'), 'No puede ser negativo.');
    assert.equal(validarCosto('10.555'), 'Hasta dos decimales.');
    assert.equal(validarCosto('0'), null);
    assert.equal(validarCosto('100.50'), null);
  });
});

describe('FE-50: Filtros de repuestos', () => {
  it('valores por omisión con dirección vacía y recuperación ante valores inválidos', () => {
    const vacio = leerFiltrosRepuestos('');
    assert.equal(vacio.vista, 'repuestos');
    assert.equal(vacio.q, '');
    assert.equal(vacio.estado, 'todos');
    assert.equal(vacio.proveedor, null);
    assert.equal(vacio.inactivos, false);
    assert.equal(vacio.cerrados, false);

    const invalidos = leerFiltrosRepuestos('?vista=otra&estado=ROTO');
    assert.equal(invalidos.vista, 'repuestos');
    assert.equal(invalidos.estado, 'todos');
  });

  it('ida y vuelta con todos los campos conserva los valores', () => {
    const filtrosCompletos = {
      vista: 'pedidos' as const,
      q: 'correa dentada',
      estado: 'BAJO' as const,
      proveedor: 12,
      inactivos: true,
      cerrados: true,
    };
    const params = escribirFiltrosRepuestos(filtrosCompletos);
    const leidos = leerFiltrosRepuestos(params);
    assert.deepEqual(leidos, filtrosCompletos);
  });

  it('filtrarRepuestos busca sin acentos ni mayúsculas en código, nombre y ubicación, y filtra inactivos', () => {
    const lista = [
      { id: 1, codigo: 'ROD-01', nombre: 'Rodamiento 6204', ubicacion: 'Estante A', activo: true, estado_stock: 'OK' },
      { id: 2, codigo: 'COR-02', nombre: 'Café grano para molino', ubicacion: 'Pañol central', activo: true, estado_stock: 'BAJO' },
      { id: 3, codigo: 'FIL-03', nombre: 'Filtro aceite', ubicacion: 'Depósito café', activo: true, estado_stock: 'OK' },
      { id: 4, codigo: 'INACT', nombre: 'Rodamiento viejo', ubicacion: 'Estante B', activo: false, estado_stock: 'OK' },
    ];

    // Busca "rodamiento" encuentra "Rodamiento 6204" pero no el inactivo sin inactivos=true
    const r1 = filtrarRepuestos(lista, {
      vista: 'repuestos',
      q: 'rodamiento',
      estado: 'todos',
      proveedor: null,
      inactivos: false,
      cerrados: false,
    });
    assert.equal(r1.length, 1);
    assert.equal(r1[0].id, 1);

    // Con inactivos=true encuentra los dos
    const r1Inact = filtrarRepuestos(lista, {
      vista: 'repuestos',
      q: 'rodamiento',
      estado: 'todos',
      proveedor: null,
      inactivos: true,
      cerrados: false,
    });
    assert.equal(r1Inact.length, 2);

    // "cafe" encuentra "Café grano" (por nombre) y "Filtro aceite" (por ubicación "Depósito café")
    const rCafe = filtrarRepuestos(lista, {
      vista: 'repuestos',
      q: 'cafe',
      estado: 'todos',
      proveedor: null,
      inactivos: false,
      cerrados: false,
    });
    assert.equal(rCafe.length, 2);
    assert.deepEqual(rCafe.map((x) => x.id).sort(), [2, 3]);

    // Búsqueda por código
    const rCod = filtrarRepuestos(lista, {
      vista: 'repuestos',
      q: 'rod-01',
      estado: 'todos',
      proveedor: null,
      inactivos: false,
      cerrados: false,
    });
    assert.equal(rCod.length, 1);
    assert.equal(rCod[0].id, 1);
  });
});

describe('FE-51: hoyLocal e infoPedido', () => {
  it('hoyLocal da YYYY-MM-DD en fecha local', () => {
    // Mes 10 es noviembre (0-indexado)
    const fecha = new Date(2026, 10, 6, 22, 30);
    assert.equal(hoyLocal(fecha), '2026-11-06');
  });

  it('infoPedido calcula plazos relativos a hoy 2026-11-06', () => {
    const hoy = '2026-11-06';

    const p4 = infoPedido({ estado: 'PEDIDO', esperado_para: '2026-11-04' }, hoy);
    assert.equal(p4.plazo, 'Atrasado 2 días');
    assert.equal(p4.atrasado, true);

    const p5 = infoPedido({ estado: 'PEDIDO', esperado_para: '2026-11-05' }, hoy);
    assert.equal(p5.plazo, 'Atrasado 1 día');
    assert.equal(p5.atrasado, true);

    const p6 = infoPedido({ estado: 'PEDIDO', esperado_para: '2026-11-06' }, hoy);
    assert.equal(p6.plazo, 'Llega hoy');
    assert.equal(p6.atrasado, false);

    const p10 = infoPedido({ estado: 'PEDIDO', esperado_para: '2026-11-10' }, hoy);
    assert.equal(p10.plazo, 'Para el 10/11/2026');
    assert.equal(p10.atrasado, false);

    const pSinFecha = infoPedido({ estado: 'PENDIENTE', esperado_para: null }, hoy);
    assert.equal(pSinFecha.plazo, 'Sin fecha prevista');
    assert.equal(pSinFecha.atrasado, false);

    const pRecibido = infoPedido({ estado: 'RECIBIDO', esperado_para: '2026-11-04' }, hoy);
    assert.equal(pRecibido.plazo, null);
    assert.equal(pRecibido.atrasado, false);
  });
});

describe('FE-52: textoMovimiento', () => {
  it('formatea etiquetas y cantidades con signo o delta', () => {
    const movIngreso = textoMovimiento({ tipo: 'INGRESO', delta: 5 });
    assert.deepEqual(movIngreso, { etiqueta: 'Ingreso', cantidad: '+5' });

    const movEgreso = textoMovimiento({ tipo: 'EGRESO', delta: -2 });
    assert.deepEqual(movEgreso, { etiqueta: 'Egreso', cantidad: '\u22122' });

    const movAjuste = textoMovimiento({ tipo: 'AJUSTE', delta: -1 });
    assert.deepEqual(movAjuste, { etiqueta: 'Ajuste', cantidad: '\u22121' });

    const movDevolucion = textoMovimiento({ tipo: 'DEVOLUCION', delta: 3 });
    assert.deepEqual(movDevolucion, { etiqueta: 'Devolución', cantidad: '+3' });

    // Fila vieja sin delta
    const movViejoIng = textoMovimiento({ tipo: 'INGRESO', cantidad: 10 });
    assert.deepEqual(movViejoIng, { etiqueta: 'Ingreso', cantidad: '+10' });

    const movViejoEg = textoMovimiento({ tipo: 'EGRESO', cantidad: 4 });
    assert.deepEqual(movViejoEg, { etiqueta: 'Egreso', cantidad: '\u22124' });

    const movViejoAj = textoMovimiento({ tipo: 'AJUSTE', cantidad: 8 });
    assert.deepEqual(movViejoAj, { etiqueta: 'Ajuste', cantidad: '8' });
  });
});
