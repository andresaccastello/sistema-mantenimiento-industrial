import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ESTADOS, obtenerInfoEstado } from './estados';

describe('FE-03: Tabla de estados', () => {
  it('contiene exactamente los 9 estados de la sección 6 sin duplicados', () => {
    assert.equal(ESTADOS.length, 9);

    const claves = ESTADOS.map((e) => `${e.entidad}:${e.estado}`);
    const clavesUnicas = new Set(claves);
    assert.equal(clavesUnicas.size, 9);
  });

  it('cada estado tiene entidad, estado, texto, color e ícono válidos', () => {
    for (const est of ESTADOS) {
      assert.ok(est.entidad === 'intervencion' || est.entidad === 'maquina');
      assert.ok(typeof est.estado === 'string' && est.estado.length > 0);
      assert.ok(typeof est.texto === 'string' && est.texto.length > 0);
      assert.ok(typeof est.color === 'string' && est.color.length > 0);
      assert.ok(typeof est.icono === 'string' && est.icono.startsWith('Icon'));
    }
  });

  it('verifica los estados de intervencion especificados', () => {
    const p = obtenerInfoEstado('intervencion', 'PENDIENTE');
    assert.deepEqual(p, {
      entidad: 'intervencion',
      estado: 'PENDIENTE',
      texto: 'Pendiente',
      color: 'yellow',
      icono: 'IconClock',
    });

    const ep = obtenerInfoEstado('intervencion', 'EN_PROCESO');
    assert.deepEqual(ep, {
      entidad: 'intervencion',
      estado: 'EN_PROCESO',
      texto: 'En proceso',
      color: 'blue',
      icono: 'IconTool',
    });

    const er = obtenerInfoEstado('intervencion', 'EN_ESPERA_REPUESTOS');
    assert.deepEqual(er, {
      entidad: 'intervencion',
      estado: 'EN_ESPERA_REPUESTOS',
      texto: 'Esperando repuestos',
      color: 'violet',
      icono: 'IconPackage',
    });

    const fin = obtenerInfoEstado('intervencion', 'FINALIZADA');
    assert.deepEqual(fin, {
      entidad: 'intervencion',
      estado: 'FINALIZADA',
      texto: 'Finalizada',
      color: 'green',
      icono: 'IconCircleCheck',
    });

    const can = obtenerInfoEstado('intervencion', 'CANCELADA');
    assert.deepEqual(can, {
      entidad: 'intervencion',
      estado: 'CANCELADA',
      texto: 'Cancelada',
      color: 'gray',
      icono: 'IconCircleX',
    });
  });

  it('verifica los estados de maquina especificados', () => {
    const op = obtenerInfoEstado('maquina', 'OPERATIVA');
    assert.deepEqual(op, {
      entidad: 'maquina',
      estado: 'OPERATIVA',
      texto: 'Operativa',
      color: 'green',
      icono: 'IconCircleCheck',
    });

    const det = obtenerInfoEstado('maquina', 'DETENIDA');
    assert.deepEqual(det, {
      entidad: 'maquina',
      estado: 'DETENIDA',
      texto: 'Detenida',
      color: 'red',
      icono: 'IconAlertTriangle',
    });

    const man = obtenerInfoEstado('maquina', 'EN_MANTENIMIENTO');
    assert.deepEqual(man, {
      entidad: 'maquina',
      estado: 'EN_MANTENIMIENTO',
      texto: 'En mantenimiento',
      color: 'blue',
      icono: 'IconTool',
    });

    const fs = obtenerInfoEstado('maquina', 'FUERA_DE_SERVICIO');
    assert.deepEqual(fs, {
      entidad: 'maquina',
      estado: 'FUERA_DE_SERVICIO',
      texto: 'Fuera de servicio',
      color: 'dark',
      icono: 'IconBan',
    });
  });

  it('estado desconocido devuelve el código en gris sin fallar', () => {
    const desc = obtenerInfoEstado('intervencion', 'DESCONOCIDO');
    assert.equal(desc.estado, 'DESCONOCIDO');
    assert.equal(desc.texto, 'DESCONOCIDO');
    assert.equal(desc.color, 'gray');
  });
});
