import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RitmoMedidor } from '../api/tipos';
import {
  COLOR_ESTIMADA,
  ETIQUETA_ESTIMADA,
  LEYENDA_ESTIMADA,
  formatoEstimada,
  mostrarDesvio,
  periodoAPorDia,
  porDiaAPeriodo,
  propuestaDeclarado,
  cambioUso,
  usoDelFormulario,
  textoEstimacionLista,
  textoPanelEstimada,
  textoRitmo,
  textoValorEstimado,
  tooltipEstimada,
} from './estimacion';
import { colorEvento, textoEvento } from './calendario';
import { ESTADOS_TAREA_PREVENTIVA } from './estados';

const declarado: RitmoMedidor = {
  por_dia: 5.714,
  fuente: 'DECLARADO',
  declarado_por_dia: 5.714,
  lecturas: null,
  desvio_pct: null,
};

// Al mediodía de Buenos Aires: el mismo día en cualquier zona de América
const lecturas: RitmoMedidor = {
  por_dia: 6.9,
  fuente: 'LECTURAS',
  declarado_por_dia: 5.714,
  lecturas: { usadas: 3, desde: '2026-11-13T15:00:00.000Z', hasta: '2026-11-20T15:00:00.000Z' },
  desvio_pct: 21,
};

describe('FE-161: el texto del ritmo (HE1, 6)', () => {
  it('declarado', () => {
    assert.equal(textoRitmo(declarado, { valor: 40, periodo: 'SEMANA' }, 'h'), 'Ritmo: 5,7 h/día (declarado: 40 h por semana)');
  });
  it('según lecturas, con el declarado y el desvío', () => {
    assert.equal(textoRitmo(lecturas, { valor: 40, periodo: 'SEMANA' }, 'h'), 'Ritmo: 6,9 h/día según lecturas (13 al 20/11) · declarado 5,7 h/día, +21 %');
    assert.equal(
      textoRitmo({ ...lecturas, por_dia: 2.857, desvio_pct: -50 }, { valor: 40, periodo: 'SEMANA' }, 'h'),
      'Ritmo: 2,9 h/día según lecturas (13 al 20/11) · declarado 5,7 h/día, -50 %'
    );
  });
  it('según lecturas, sin declarado y con otro mes', () => {
    const sinDeclarado: RitmoMedidor = {
      ...lecturas,
      declarado_por_dia: null,
      desvio_pct: null,
      lecturas: { usadas: 4, desde: '2026-10-28T15:00:00.000Z', hasta: '2026-11-20T15:00:00.000Z' },
    };
    assert.equal(textoRitmo(sinDeclarado, null, 'km'), 'Ritmo: 6,9 km/día según lecturas (28/10 al 20/11)');
  });
  it('sin ritmo', () => {
    assert.equal(textoRitmo(null, null, 'h'), 'Sin ritmo: cargá el uso estimado o al menos 3 lecturas en 7 días');
  });
  it('el valor estimado de hoy', () => {
    assert.equal(textoValorEstimado(117.14, 'h'), '≈ 117 h hoy (estimado)');
    assert.equal(textoValorEstimado(1249.6, 'horas'), '≈ 1.250 horas hoy (estimado)');
  });
});

describe('FE-162: pasar un ritmo por día a un período y al revés', () => {
  it('la semana de 7 días y el mes de 30', () => {
    assert.equal(porDiaAPeriodo(5, 'DIA'), 5);
    assert.equal(porDiaAPeriodo(5, 'SEMANA'), 35);
    assert.equal(porDiaAPeriodo(5, 'MES'), 150);
    assert.equal(periodoAPorDia(40, 'DIA'), 40);
    assert.equal(periodoAPorDia(70, 'SEMANA'), 10);
    assert.equal(periodoAPorDia(300, 'MES'), 10);
  });
  it('ida y vuelta', () => {
    assert.ok(Math.abs(porDiaAPeriodo(periodoAPorDia(40, 'SEMANA'), 'SEMANA') - 40) < 1e-9);
  });
});

describe('FE-163: cuándo se muestra el desvío', () => {
  it('solo con |desvio_pct| > 25', () => {
    assert.equal(mostrarDesvio(null), false);
    assert.equal(mostrarDesvio(undefined), false);
    assert.equal(mostrarDesvio(0), false);
    assert.equal(mostrarDesvio(25), false);
    assert.equal(mostrarDesvio(-25), false);
    assert.equal(mostrarDesvio(26), true);
    assert.equal(mostrarDesvio(-26), true);
    assert.equal(mostrarDesvio(-100), true);
  });
});

describe('FE-164: el formato "≈ dd/mm"', () => {
  it('la fecha estimada', () => {
    assert.equal(formatoEstimada('2026-12-06'), '≈ 06/12');
    assert.equal(formatoEstimada('2027-01-31'), '≈ 31/01');
  });
  it('en la lista por uso, la fecha o "sin estimación"', () => {
    const e = { fecha: '2026-12-06', fecha_aviso: '2026-12-01', pasada: false, ritmo_por_dia: 5.714, fuente: 'DECLARADO' as const };
    assert.equal(textoEstimacionLista(e), '≈ 06/12 (estimada)');
    assert.equal(textoEstimacionLista(null), 'sin estimación');
  });
  it('el tooltip y el panel del día', () => {
    const e = { fecha: '2026-12-06', fecha_aviso: null, pasada: false, ritmo_por_dia: 5.714, fuente: 'DECLARADO' as const };
    assert.equal(tooltipEstimada(e, 'h'), 'Estimada con 5,7 h/día (declarado)');
    assert.equal(tooltipEstimada({ ...e, fuente: 'LECTURAS' }, 'h'), 'Estimada con 5,7 h/día (según lecturas)');
    assert.equal(textoPanelEstimada(200, 'h', e), 'Vence al llegar a 200 h · estimada con 5,7 h/día (declarado)');
  });
});

describe('FE-165: el color y la etiqueta del evento ESTIMADA', () => {
  it('la etiqueta y el color', () => {
    assert.equal(textoEvento({ tipo: 'ESTIMADA', estado: 'AL_DIA' }), 'Estimada por uso');
    assert.equal(colorEvento({ tipo: 'ESTIMADA', estado: 'AL_DIA' }), COLOR_ESTIMADA);
    assert.equal(ETIQUETA_ESTIMADA, 'Estimada por uso');
    assert.deepEqual(LEYENDA_ESTIMADA, { texto: 'Estimada por uso', color: COLOR_ESTIMADA, estimada: true });
  });
  it('un color que no usa ningún otro tipo', () => {
    const otros = new Set([
      ...ESTADOS_TAREA_PREVENTIVA.map((e) => e.color),
      colorEvento({ tipo: 'HECHA', estado: null }),
      colorEvento({ tipo: 'PREVISTA', estado: null }),
    ]);
    assert.equal(otros.has(COLOR_ESTIMADA), false);
  });
});

describe('FE-166: el valor que propone "Actualizar declarado"', () => {
  it('el ritmo real, en el período elegido, con un decimal', () => {
    assert.deepEqual(propuestaDeclarado(6.9, 'SEMANA'), { valor: 48.3, periodo: 'SEMANA' });
    assert.deepEqual(propuestaDeclarado(6.857, 'SEMANA'), { valor: 48, periodo: 'SEMANA' });
    assert.deepEqual(propuestaDeclarado(6.9, 'MES'), { valor: 207, periodo: 'MES' });
    assert.deepEqual(propuestaDeclarado(6.94, 'DIA'), { valor: 6.9, periodo: 'DIA' });
  });
  it('sin período elegido, por semana', () => {
    assert.deepEqual(propuestaDeclarado(10, null), { valor: 70, periodo: 'SEMANA' });
  });
});

describe('FE-167: el uso estimado del formulario del medidor', () => {
  it('vacío es null', () => {
    assert.deepEqual(usoDelFormulario('', 'SEMANA'), { uso: null, error: null });
    assert.deepEqual(usoDelFormulario(undefined, 'SEMANA'), { uso: null, error: null });
  });
  it('un número mayor que 0, con hasta 2 decimales', () => {
    assert.deepEqual(usoDelFormulario(40, 'SEMANA'), { uso: { valor: 40, periodo: 'SEMANA' }, error: null });
    assert.deepEqual(usoDelFormulario('5,5', 'DIA'), { uso: { valor: 5.5, periodo: 'DIA' }, error: null });
    assert.equal(usoDelFormulario(0, 'DIA').error, 'Ingresá un número mayor que 0, o dejalo vacío.');
    assert.equal(usoDelFormulario(-3, 'DIA').error, 'Ingresá un número mayor que 0, o dejalo vacío.');
    assert.equal(usoDelFormulario(1.234, 'DIA').error, 'Como mucho, 2 decimales.');
  });
  it('si cambió, para el PATCH', () => {
    assert.equal(cambioUso(null, null), false);
    assert.equal(cambioUso(null, { valor: 40, periodo: 'SEMANA' }), true);
    assert.equal(cambioUso({ valor: 40, periodo: 'SEMANA' }, null), true);
    assert.equal(cambioUso({ valor: 40, periodo: 'SEMANA' }, { valor: 40, periodo: 'SEMANA' }), false);
    assert.equal(cambioUso({ valor: 40, periodo: 'SEMANA' }, { valor: 40, periodo: 'MES' }), true);
  });
});
