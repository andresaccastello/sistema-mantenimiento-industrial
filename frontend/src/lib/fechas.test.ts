import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fechaLocalTexto,
  fechaLocalAIso,
  validarMomento,
  momentoAIso,
  rangoDiasAIso,
  minutosEntre,
} from './fechas';

describe('FE-21: fechas.ts', () => {
  it('fechaLocalTexto formatea YYYY-MM-DD HH:mm:ss con ceros a la izquierda', () => {
    assert.equal(fechaLocalTexto(new Date(2026, 0, 2, 3, 4, 5)), '2026-01-02 03:04:05');
  });

  it('fechaLocalAIso convierte hora local a ISO con offset y valida coherencia', () => {
    const iso1 = fechaLocalAIso('2026-11-02 14:05:00');
    assert.ok(iso1);
    assert.match(iso1, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    assert.equal(new Date(iso1).getTime(), new Date(2026, 10, 2, 14, 5, 0).getTime());

    const iso2 = fechaLocalAIso('2026-11-02 14:05');
    assert.ok(iso2);
    assert.equal(new Date(iso2).getTime(), new Date(2026, 10, 2, 14, 5, 0).getTime());

    assert.equal(fechaLocalAIso('2026-02-30 10:00'), null);
    assert.equal(fechaLocalAIso('abc'), null);
    assert.equal(fechaLocalAIso(''), null);
  });

  it('validarMomento valida modo ahora, campo requerido, límites mínimo y ahora', () => {
    const ahora = new Date(2026, 10, 2, 15, 0, 0);
    const minimo = new Date(2026, 10, 2, 12, 30, 0);

    // con 'ahora' -> null
    assert.equal(validarMomento({ modo: 'ahora', fecha: null }, minimo, ahora), null);

    // 'otra' sin fecha -> 'Indicá la fecha y la hora.'
    assert.equal(validarMomento({ modo: 'otra', fecha: null }, minimo, ahora), 'Indicá la fecha y la hora.');
    assert.equal(validarMomento({ modo: 'otra', fecha: '   ' }, minimo, ahora), 'Indicá la fecha y la hora.');

    // anterior al mínimo -> el texto con la fecha mínima
    const errorAnterior = validarMomento(
      { modo: 'otra', fecha: '2026-11-02 12:20' },
      minimo,
      ahora
    );
    assert.ok(errorAnterior?.includes('No puede ser anterior al'));

    // el mismo minuto que el mínimo -> null
    assert.equal(
      validarMomento({ modo: 'otra', fecha: '2026-11-02 12:30' }, minimo, ahora),
      null
    );

    // posterior a ahora -> 'No puede ser posterior a este momento.'
    assert.equal(
      validarMomento({ modo: 'otra', fecha: '2026-11-02 15:05' }, minimo, ahora),
      'No puede ser posterior a este momento.'
    );
  });

  it('momentoAIso devuelve undefined con ahora y maneja segundos del mínimo', () => {
    const minimo = new Date(2026, 10, 2, 12, 30, 45);

    // con 'ahora' -> undefined
    assert.equal(momentoAIso({ modo: 'ahora', fecha: null }, minimo), undefined);

    // con el mismo minuto que el mínimo pero antes en segundos -> el instante del mínimo
    const isoMinuto = momentoAIso({ modo: 'otra', fecha: '2026-11-02 12:30:00' }, minimo);
    assert.ok(isoMinuto);
    assert.equal(new Date(isoMinuto).getTime(), minimo.getTime());
  });

  it('rangoDiasAIso convierte rango de días a instantes inicio y fin', () => {
    const rango = rangoDiasAIso('2026-11-01', '2026-11-03');
    assert.ok(rango.desde);
    assert.ok(rango.hasta);
    assert.equal(new Date(rango.desde).getTime(), new Date(2026, 10, 1, 0, 0, 0).getTime());
    assert.equal(new Date(rango.hasta).getTime(), new Date(2026, 10, 3, 23, 59, 59).getTime());

    const soloDesde = rangoDiasAIso('2026-11-01', null);
    assert.ok(soloDesde.desde);
    assert.equal(soloDesde.hasta, undefined);
  });

  it('minutosEntre calcula minutos enteros o usa ahora y evita negativos', () => {
    const d1 = new Date(2026, 10, 2, 10, 0, 0);
    const d2 = new Date(2026, 10, 2, 11, 30, 0);
    assert.equal(minutosEntre(d1, d2), 90);

    const ahora = new Date(2026, 10, 2, 10, 45, 0);
    assert.equal(minutosEntre(d1, null, ahora), 45);

    // hasta anterior a desde -> 0
    assert.equal(minutosEntre(d2, d1), 0);
  });
});
