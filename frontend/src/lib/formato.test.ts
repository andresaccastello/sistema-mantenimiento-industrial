import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuracion, formatHace, formatFechaHora } from './formato';

describe('FE-01: formatDuracion', () => {
  it('formatea null como raya em', () => {
    assert.equal(formatDuracion(null), '—');
  });

  it('formatea 0 como 0 min', () => {
    assert.equal(formatDuracion(0), '0 min');
  });

  it('formatea menos de 60 minutos', () => {
    assert.equal(formatDuracion(45), '45 min');
  });

  it('formatea 60 minutos como 1 h exacta', () => {
    assert.equal(formatDuracion(60), '1 h');
  });

  it('formatea horas y minutos intermedios', () => {
    assert.equal(formatDuracion(135), '2 h 15 min');
  });

  it('formatea 1440 minutos como 1 d exacto', () => {
    assert.equal(formatDuracion(1440), '1 d');
  });

  it('formatea 1500 minutos como 1 d 1 h', () => {
    assert.equal(formatDuracion(1500), '1 d 1 h');
  });

  it('formatea 2880 minutos como 2 d exactos', () => {
    assert.equal(formatDuracion(2880), '2 d');
  });
});

describe('FE-02: formatHace', () => {
  it('devuelve recién cuando pasaron 30 segundos', () => {
    const ahora = new Date('2026-10-31T12:00:00Z');
    const hace30s = new Date('2026-10-31T11:59:30Z');
    assert.equal(formatHace(hace30s, ahora), 'recién');
  });

  it('devuelve recién cuando la fecha está en el futuro', () => {
    const ahora = new Date('2026-10-31T12:00:00Z');
    const enElFuturo = new Date('2026-10-31T12:05:00Z');
    assert.equal(formatHace(enElFuturo, ahora), 'recién');
  });

  it('devuelve hace 1 h 20 min cuando pasaron 80 minutos', () => {
    const ahora = new Date('2026-10-31T12:00:00Z');
    const hace80m = new Date('2026-10-31T10:40:00Z');
    assert.equal(formatHace(hace80m, ahora), 'hace 1 h 20 min');
  });
});

describe('FE-10: formatFechaHora', () => {
  it('formatea fechas con ceros a la izquierda y maneja valores inválidos o nulos', () => {
    assert.equal(formatFechaHora(new Date(2026, 9, 31, 8, 5)), '31/10/2026 08:05');
    assert.equal(formatFechaHora(new Date(2026, 0, 2, 23, 59)), '02/01/2026 23:59');
    assert.equal(formatFechaHora(null), '—');
    assert.equal(formatFechaHora('no-es-fecha'), '—');
  });
});
