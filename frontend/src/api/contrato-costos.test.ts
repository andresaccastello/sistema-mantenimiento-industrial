import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AuditoriaItem } from './tipos';
import { costosIntervencionEjemplo, renglonCreadoEjemplo, reporteCostosEjemplo } from './contrato-costos';
import { filasResumenCostos, etiquetaTipoCosto } from '../lib/costos';
import { filasReporteCostos } from '../lib/reportes';
import { eventosHistorial } from '../lib/intervenciones';

// FE-62: Contrato en uso, con los ejemplos de contrato-costos.ts
describe('FE-62: Contrato de costos en uso', () => {
  it('filasResumenCostos da las filas esperadas', () => {
    const resumen = costosIntervencionEjemplo.resumen;
    assert.ok(resumen, 'El ejemplo trae el resumen');
    assert.deepEqual(
      filasResumenCostos(resumen).map((f) => [f.etiqueta, f.importe, f.esTotal]),
      [
        ['Repuestos', 200, false],
        ['Mano de obra', 3000, false],
        ['Servicio externo', 8000, false],
        ['Transporte', 500, false],
        ['Otro', 150, false],
        ['Ajuste', -200, false],
        ['Total', 11650, true],
      ]
    );
  });

  it('filasResumenCostos omite los tipos en 0, salvo Repuestos', () => {
    const resumen = costosIntervencionEjemplo.resumen;
    assert.ok(resumen);
    const soloManoObra = { ...resumen, repuestos: 0, servicio_externo: 0, transporte: 0, otro: 0, ajuste: 0, total: 3000 };
    assert.deepEqual(
      filasResumenCostos(soloManoObra).map((f) => f.etiqueta),
      ['Repuestos', 'Mano de obra', 'Total']
    );
  });

  it('filasReporteCostos da la fila de cada máquina', () => {
    const { columnas, filas } = filasReporteCostos(reporteCostosEjemplo);
    assert.deepEqual(columnas, ['Máquina', 'Sector', 'Repuestos', 'Mano de obra', 'Otros', 'Total']);
    assert.deepEqual(filas, [
      ['M-009 · Compresor 2', 'Sector Ejemplo 2', 0, 20000, 0, 20000],
      ['M-008 · Torno 1', 'Sector Ejemplo 1', 200, 3000, 500, 3700],
    ]);
  });

  it('eventosHistorial con una auditoría de costos da "Corrección de costos"', () => {
    const persona = { id: 12, legajo: 'R-012', nombre: 'Responsable', apellido: 'Ejemplo' };
    const r = renglonCreadoEjemplo;
    const auditoria: AuditoriaItem = {
      id: 70,
      tipo_evento: 'CORRECCION_COSTO',
      campo_modificado: 'costos',
      valor_anterior: null,
      valor_nuevo: `Se agregó: ${etiquetaTipoCosto(r.tipo)} — ${r.descripcion}`,
      motivo: 'Pedido por calidad',
      creado_en: '2026-11-05T10:00:00.000Z',
      realizado_por: persona,
      responsable_anterior: null,
      responsable_nuevo: null,
    };

    const eventos = eventosHistorial({ historial_estados: [], auditoria: [auditoria] });
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].titulo, 'Corrección de costos');
    assert.equal(eventos[0].detalle, 'Se agregó: Servicio externo — Alineación láser. Motivo: Pedido por calidad');
  });
});
