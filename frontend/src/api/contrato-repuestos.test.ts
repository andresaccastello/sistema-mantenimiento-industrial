import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RespuestaMovimientoManual,
  RepuestoFila,
  RepuestoOpcion,
  RepuestoDetalle,
  MovimientoStockItem,
  UsoRepuestoItem,
  CostoHistorialItem,
  ProveedorFila,
  ProveedorOpcion,
  IntervencionRepuestosRespuesta,
  IntervencionPedidosRespuesta,
  PedidoRepuestoItem,
  ReporteRepuestosRespuesta,
} from './tipos';
import { formatCantidad } from '../lib/formato';
import { textoMovimiento, infoPedido } from '../lib/repuestos';
import { filasReporteRepuestos } from '../lib/reportes';

// -----------------------------------------------------------------------------
// Constantes con las respuestas reales de la API (copiadas tal cual del anexo)
// -----------------------------------------------------------------------------

const postMovimiento: RespuestaMovimientoManual = {
  "movimiento": {
    "id": 82, "tipo": "INGRESO", "cantidad": 1, "delta": 1, "stock_resultante": 10, "costo_unitario": 1300,
    "proveedor": { "id": 13, "nombre": "ZZR1 Ferretería Prueba" },
    "comprobante": "R-0001", "observacion": null, "intervencion_id": null,
    "realizado_por": { "id": 557, "nombre": "Administradora", "apellido": "Segunda" },
    "realizado_en": "2026-11-06T11:36:01.115Z"
  },
  "repuesto": {
    "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad", "lleva_stock": true,
    "cantidad_disponible": 10, "stock_minimo": 3, "estado_stock": "OK", "costo_unitario": 1300,
    "proveedor": { "id": 13, "nombre": "ZZR1 Ferretería Prueba", "activo": true },
    "ubicacion": "Estante A3", "activo": true, "descripcion": null,
    "creado_en": "2026-11-06T11:29:40.114Z", "actualizado_en": "2026-11-06T11:36:01.115Z",
    "pedidos_abiertos": 0, "consumos_vigentes": 1
  }
};

const repuestoFila: RepuestoFila = {
  "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad", "lleva_stock": true,
  "cantidad_disponible": 10, "stock_minimo": 3, "estado_stock": "OK", "costo_unitario": 1300,
  "proveedor": { "id": 13, "nombre": "ZZR1 Ferretería Prueba", "activo": true },
  "ubicacion": "Estante A3", "activo": true
};

const repuestoOpcion: RepuestoOpcion = {
  "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad", "lleva_stock": true,
  "cantidad_disponible": 10, "costo_unitario": 1300
};

const repuestoDetalle: RepuestoDetalle = {
  "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad", "lleva_stock": true,
  "cantidad_disponible": 10, "stock_minimo": 3, "estado_stock": "OK", "costo_unitario": 1300,
  "proveedor": { "id": 13, "nombre": "ZZR1 Ferretería Prueba", "activo": true },
  "ubicacion": "Estante A3", "activo": true, "descripcion": null,
  "creado_en": "2026-11-06T11:29:40.114Z", "actualizado_en": "2026-11-06T11:36:01.115Z",
  "pedidos_abiertos": 0, "consumos_vigentes": 1
};

const movimientoItem: MovimientoStockItem = {
  "id": 81, "tipo": "INGRESO", "cantidad": 3, "delta": 3, "stock_resultante": 9, "costo_unitario": null,
  "proveedor": null, "comprobante": null, "observacion": "Pedido N.º 20 de la intervención N.º 4509",
  "intervencion_id": 4509,
  "realizado_por": { "id": 557, "nombre": "Administradora", "apellido": "Segunda" },
  "realizado_en": "2026-11-06T11:33:10.865Z"
};

const usoItem: UsoRepuestoItem = {
  "consumo_id": 96,
  "intervencion": { "id": 4509, "estado": "EN_PROCESO" },
  "maquina": { "id": 759, "codigo": "MEC-03", "nombre": "Rectificadora plana" },
  "cantidad": 2, "costo_unitario_aplicado": 1234.5, "importe": 2469,
  "registrado_en": "2026-11-06T11:32:58.829Z", "anulado": false
};

const costoItem: CostoHistorialItem = {
  "id": 127, "costo_unitario": 1300, "origen": "INGRESO",
  "registrado_por": { "id": 557, "nombre": "Administradora", "apellido": "Segunda" },
  "registrado_en": "2026-11-06T11:36:01.115Z"
};

const proveedorFila: ProveedorFila = {
  "id": 13, "nombre": "ZZR1 Ferretería Prueba", "contacto": null, "telefono": null,
  "email": "ventas@ejemplo.com", "notas": null, "activo": true, "repuestos_activos": 1
};

const proveedorOpcion: ProveedorOpcion = { "id": 13, "nombre": "ZZR1 Ferretería Prueba" };

const intervencionRepuestos: IntervencionRepuestosRespuesta = {
  "consumos": [
    {
      "id": 95,
      "repuesto": { "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad" },
      "cantidad": 2, "costo_unitario_aplicado": 1234.5, "importe": 2469, "observacion": null,
      "registrado_por": { "id": 552, "nombre": "Responsable", "apellido": "Demo" },
      "registrado_en": "2026-11-06T11:31:40.073Z", "movimiento_id": 78, "movio_stock": true,
      "anulado": true,
      "anulado_por": { "id": 552, "nombre": "Responsable", "apellido": "Demo" },
      "anulado_en": "2026-11-06T11:33:01.694Z", "motivo_anulacion": "No se llegó a usar"
    }
  ],
  "total_repuestos": 2469, "ve_costos": true, "puede_registrar": true, "puede_anular": true
};

const intervencionPedidos: IntervencionPedidosRespuesta = {
  "pedidos": [
    {
      "id": 20, "intervencion_id": 4509,
      "repuesto": { "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad", "lleva_stock": true },
      "descripcion": null, "cantidad": 3, "proveedor": null, "estado": "RECIBIDO",
      "pedido_en": null, "esperado_para": null, "recibido_en": "2026-11-06T11:33:10.869Z",
      "observacion": null, "motivo_cancelacion": null, "ingreso_stock": true,
      "creado_por": { "id": 552, "nombre": "Responsable", "apellido": "Demo" },
      "creado_en": "2026-11-06T11:33:05.012Z", "actualizado_en": "2026-11-06T11:33:10.865Z"
    }
  ],
  "puede_crear": true, "puede_gestionar": true
};

const pedidoRepuestoItem: PedidoRepuestoItem = {
  "id": 20, "intervencion_id": 4509,
  "repuesto": { "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad", "lleva_stock": true },
  "descripcion": null, "cantidad": 3, "proveedor": null, "estado": "RECIBIDO",
  "pedido_en": null, "esperado_para": null, "recibido_en": "2026-11-06T11:33:10.869Z",
  "observacion": null, "motivo_cancelacion": null, "ingreso_stock": true,
  "creado_por": { "id": 552, "nombre": "Responsable", "apellido": "Demo" },
  "creado_en": "2026-11-06T11:33:05.012Z", "actualizado_en": "2026-11-06T11:33:10.865Z",
  "intervencion": { "id": 4509, "estado": "EN_PROCESO", "descripcion": "Vibra la mesa al bajar el cabezal" },
  "maquina": { "id": 759, "codigo": "MEC-03", "nombre": "Rectificadora plana" },
  "sector": { "id": 101, "nombre": "Mecanizado" }
};

const reporteRepuestos: ReporteRepuestosRespuesta = {
  "desde": "2026-10-07T11:36:01.182Z", "hasta": "2026-11-06T11:36:01.182Z", "ve_costos": true,
  "consumos": 1, "intervenciones": 1, "importe_total": 2469,
  "por_repuesto": [
    {
      "repuesto": { "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad" },
      "cantidad": 2, "consumos": 1, "intervenciones": 1, "importe": 2469
    }
  ],
  "por_maquina": [
    {
      "maquina": { "id": 759, "codigo": "MEC-03", "nombre": "Rectificadora plana" },
      "sector": { "id": 101, "nombre": "Mecanizado" },
      "consumos": 1, "importe": 2469
    }
  ]
};

// -----------------------------------------------------------------------------
// FE-55: Contrato en uso
// -----------------------------------------------------------------------------

describe('FE-55: Contrato en uso', () => {
  it('formatCantidad(fila.cantidad_disponible) da "10"', () => {
    assert.equal(formatCantidad(repuestoFila.cantidad_disponible), '10');
  });

  it('textoMovimiento del movimiento del POST da "Ingreso" y "+1"', () => {
    const res = textoMovimiento(postMovimiento.movimiento);
    assert.equal(res.etiqueta, 'Ingreso');
    assert.equal(res.cantidad, '+1');
  });

  it('infoPedido del pedido recibido da "Recibido"', () => {
    const res = infoPedido(intervencionPedidos.pedidos[0]);
    assert.equal(res.etiqueta, 'Recibido');
  });

  it('filasReporteRepuestos del reporte da la fila "ZZR1-001 · ZZR1 Rodamiento de prueba" con importe 2469', () => {
    const res = filasReporteRepuestos(reporteRepuestos);
    assert.ok(res.filas.length > 0);
    const fila = res.filas[0];
    assert.equal(fila[0], 'ZZR1-001 · ZZR1 Rodamiento de prueba');
    assert.equal(fila[5], 2469);
  });

  it('verifica que todas las constantes del contrato estén definidas', () => {
    assert.ok(repuestoOpcion.id);
    assert.ok(repuestoDetalle.id);
    assert.ok(movimientoItem.id);
    assert.ok(usoItem.consumo_id);
    assert.ok(costoItem.id);
    assert.ok(proveedorFila.id);
    assert.ok(proveedorOpcion.id);
    assert.ok(intervencionRepuestos.consumos.length > 0);
    assert.ok(pedidoRepuestoItem.id);
  });
});
