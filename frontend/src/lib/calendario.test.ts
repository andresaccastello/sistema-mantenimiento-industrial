import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  rangoCalendario,
  moverPeriodo,
  semanasDelMes,
  diasDeLaSemana,
  eventosPorDia,
  visiblesEnCelda,
  textoTituloPeriodo,
  textoDia,
  leerParamsCalendario,
  escribirParamsCalendario,
  sumarDias,
  diaSemana,
  esFechaValida,
  hoyLocal,
  colorEvento,
  textoEvento,
  LEYENDA_CALENDARIO,
} from './calendario';

describe('FE-135: rangoCalendario', () => {
  it('noviembre 2026 empieza domingo: del 26/10 al 06/12', () => {
    assert.deepEqual(rangoCalendario('mes', '2026-11-11'), { desde: '2026-10-26', hasta: '2026-12-06' });
  });
  it('febrero 2027 empieza lunes y termina domingo: el mes justo', () => {
    assert.deepEqual(rangoCalendario('mes', '2027-02-15'), { desde: '2027-02-01', hasta: '2027-02-28' });
  });
  it('diciembre 2026: del lunes 30/11 al domingo 03/01', () => {
    assert.deepEqual(rangoCalendario('mes', '2026-12-31'), { desde: '2026-11-30', hasta: '2027-01-03' });
  });
  it('la semana de un domingo: del lunes anterior a ese domingo', () => {
    assert.deepEqual(rangoCalendario('semana', '2026-11-15'), { desde: '2026-11-09', hasta: '2026-11-15' });
    assert.deepEqual(rangoCalendario('semana', '2026-11-09'), { desde: '2026-11-09', hasta: '2026-11-15' });
  });
  it('nunca pasa de 42 días', () => {
    for (let m = 1; m <= 12; m++) {
      const { desde, hasta } = rangoCalendario('mes', `2026-${String(m).padStart(2, '0')}-01`);
      const dias = semanasDelMes(`2026-${String(m).padStart(2, '0')}-01`).length * 7;
      assert.ok(dias <= 42);
      assert.equal(sumarDias(desde, dias - 1), hasta);
    }
  });
});

describe('FE-136: moverPeriodo', () => {
  it('del 31/01 al mes siguiente queda en febrero, no en marzo', () => {
    assert.equal(moverPeriodo('mes', '2027-01-31', 1), '2027-02-28');
    assert.equal(moverPeriodo('mes', '2028-01-31', 1), '2028-02-29');
  });
  it('el mes anterior cruza el año', () => {
    assert.equal(moverPeriodo('mes', '2027-01-15', -1), '2026-12-15');
    assert.equal(moverPeriodo('mes', '2026-12-15', 1), '2027-01-15');
  });
  it('la semana cruza el año', () => {
    assert.equal(moverPeriodo('semana', '2026-12-30', 1), '2027-01-06');
    assert.equal(moverPeriodo('semana', '2027-01-02', -1), '2026-12-26');
  });
});

describe('FE-137: semanasDelMes', () => {
  it('4 filas: febrero 2027, que empieza lunes', () => {
    const filas = semanasDelMes('2027-02-10');
    assert.equal(filas.length, 4);
    assert.equal(filas[0][0].fecha, '2027-02-01');
    assert.ok(filas.flat().every((d) => d.delMes));
  });
  it('5 filas: diciembre 2026', () => {
    const filas = semanasDelMes('2026-12-01');
    assert.equal(filas.length, 5);
    assert.deepEqual(filas[0][0], { fecha: '2026-11-30', delMes: false });
    assert.deepEqual(filas[0][1], { fecha: '2026-12-01', delMes: true });
    assert.deepEqual(filas[4][6], { fecha: '2027-01-03', delMes: false });
  });
  it('6 filas: noviembre 2026', () => {
    const filas = semanasDelMes('2026-11-11');
    assert.equal(filas.length, 6);
    assert.ok(filas.every((f) => f.length === 7));
    assert.equal(filas[0][0].fecha, '2026-10-26');
    assert.equal(filas[5][6].fecha, '2026-12-06');
    assert.equal(filas.flat().filter((d) => d.delMes).length, 30);
  });
  it('los siete días de la semana, de lunes a domingo', () => {
    assert.deepEqual(diasDeLaSemana('2026-11-12'), [
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15',
    ]);
  });
});

describe('FE-138: eventosPorDia', () => {
  it('vacío', () => {
    assert.equal(eventosPorDia([]).size, 0);
  });
  it('varios el mismo día, en el orden en que vinieron', () => {
    const eventos = [
      { fecha: '2026-11-12', id: 1 },
      { fecha: '2026-11-13', id: 2 },
      { fecha: '2026-11-12', id: 3 },
    ];
    const mapa = eventosPorDia(eventos);
    assert.deepEqual(mapa.get('2026-11-12')?.map((e) => e.id), [1, 3]);
    assert.deepEqual(mapa.get('2026-11-13')?.map((e) => e.id), [2]);
    assert.equal(mapa.get('2026-11-14'), undefined);
  });
});

describe('FE-139: visiblesEnCelda', () => {
  it('0, 3 y 5 eventos', () => {
    assert.deepEqual(visiblesEnCelda([], 3), { visibles: [], mas: 0 });
    assert.deepEqual(visiblesEnCelda([1, 2, 3], 3), { visibles: [1, 2, 3], mas: 0 });
    assert.deepEqual(visiblesEnCelda([1, 2, 3, 4, 5], 3), { visibles: [1, 2, 3], mas: 2 });
  });
});

describe('FE-140: textoTituloPeriodo y textoDia', () => {
  it('el mes', () => {
    assert.equal(textoTituloPeriodo('mes', '2026-11-11'), 'Noviembre 2026');
  });
  it('una semana dentro del mes', () => {
    assert.equal(textoTituloPeriodo('semana', '2026-11-11'), '9 al 15 de noviembre de 2026');
  });
  it('una semana entre dos meses', () => {
    assert.equal(textoTituloPeriodo('semana', '2026-12-02'), '30 de noviembre al 6 de diciembre de 2026');
  });
  it('una semana entre dos años, con los dos años', () => {
    assert.equal(textoTituloPeriodo('semana', '2027-01-01'), '28 de diciembre de 2026 al 3 de enero de 2027');
  });
  it('el título del panel del día', () => {
    assert.equal(textoDia('2026-11-12'), 'Jueves 12 de noviembre');
    assert.equal(textoDia('2026-11-15'), 'Domingo 15 de noviembre');
  });
});

describe('FE-141: leerParamsCalendario y escribirParamsCalendario', () => {
  const hoy = '2026-11-11';
  it('sin parámetros: mes y hoy', () => {
    assert.deepEqual(leerParamsCalendario(new URLSearchParams(''), hoy), { vista: 'mes', fecha: hoy });
  });
  it('fecha inválida: hoy', () => {
    assert.equal(leerParamsCalendario(new URLSearchParams('fecha=2026-02-30'), hoy).fecha, hoy);
    assert.equal(leerParamsCalendario(new URLSearchParams('fecha=mañana'), hoy).fecha, hoy);
  });
  it('cal inválido: mes', () => {
    assert.equal(leerParamsCalendario(new URLSearchParams('cal=anio'), hoy).vista, 'mes');
  });
  it('ida y vuelta, sin tocar los demás parámetros', () => {
    const base = new URLSearchParams('vista=calendario&planta=3');
    const escrito = escribirParamsCalendario(base, { vista: 'semana', fecha: '2027-02-28' });
    assert.equal(escrito.toString(), 'vista=calendario&planta=3&cal=semana&fecha=2027-02-28');
    assert.deepEqual(leerParamsCalendario(escrito, hoy), { vista: 'semana', fecha: '2027-02-28' });
    assert.equal(base.toString(), 'vista=calendario&planta=3', 'No cambia el original');
  });
});

describe('FE-142: fechas sin zona horaria', () => {
  it('sumarDias cruza meses, años y el 29 de febrero', () => {
    assert.equal(sumarDias('2028-02-28', 1), '2028-02-29');
    assert.equal(sumarDias('2027-02-28', 1), '2027-03-01');
    assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
    assert.equal(sumarDias('2027-01-01', -1), '2026-12-31');
  });
  it('diaSemana: 0 es lunes y 6 es domingo', () => {
    assert.equal(diaSemana('2026-11-09'), 0);
    assert.equal(diaSemana('2026-11-01'), 6);
    assert.equal(diaSemana('1969-12-29'), 0);
  });
  it('esFechaValida', () => {
    assert.equal(esFechaValida('2028-02-29'), true);
    assert.equal(esFechaValida('2027-02-29'), false);
    assert.equal(esFechaValida('2026-13-01'), false);
    assert.equal(esFechaValida('2026-1-1'), false);
    assert.equal(esFechaValida(null), false);
  });
  it('hoyLocal toma el día de la computadora, no el de UTC', () => {
    assert.equal(hoyLocal(new Date(2026, 10, 11, 23, 30)), '2026-11-11');
    assert.equal(hoyLocal(new Date(2026, 10, 12, 0, 5)), '2026-11-12');
  });
});

describe('FE-143: color y texto de un evento', () => {
  it('pendiente: el del estado; hecha: teal; prevista: gris', () => {
    assert.equal(colorEvento({ tipo: 'PENDIENTE', estado: 'VENCIDA' }), 'red');
    assert.equal(colorEvento({ tipo: 'PENDIENTE', estado: 'AL_DIA' }), 'green');
    assert.equal(colorEvento({ tipo: 'HECHA', estado: null }), 'teal');
    assert.equal(colorEvento({ tipo: 'PREVISTA', estado: null }), 'gray');
  });
  it('los textos', () => {
    assert.equal(textoEvento({ tipo: 'PENDIENTE', estado: 'PROXIMA' }), 'Próxima');
    assert.equal(textoEvento({ tipo: 'HECHA', estado: null }), 'Hecha');
    assert.equal(textoEvento({ tipo: 'PREVISTA', estado: null }), 'Prevista');
  });
  it('la leyenda', () => {
    assert.deepEqual(LEYENDA_CALENDARIO.map((l) => l.texto), ['Vencida', 'Próxima', 'Al día', 'En curso', 'Hecha', 'Prevista']);
  });
});
