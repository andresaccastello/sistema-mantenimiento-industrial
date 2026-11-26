import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  UMBRAL_CONCENTRA,
  UMBRAL_ESTABLE,
  UMBRAL_PREDOMINA,
  acortar,
  conclusionEvolucion,
  conclusionProporcion,
  conclusionRanking,
  etiquetaPeriodo,
  formatEntero,
  formatHorasEje,
  formatPesos,
  formatPesosEje,
  formatPorcentajeFraccion,
  formatTiempo,
  hayValores,
  periodoCompleto,
  topConOtras,
} from './graficos';
import {
  TEXTO_EVOLUCION_7_DIAS,
  cantidadRanking,
  etiquetaMaquina,
  filasCostoPeriodo,
  filasEvolucion,
  filasTiemposGrafico,
  notaOtrosRecortado,
  rankingCumplimiento,
  rankingInactividad,
  rankingRepuestos,
  tituloCostoPeriodo,
  tituloEvolucion,
} from './graficosReportes';
import type {
  EvolucionReporte,
  GrupoCumplimientoPreventivos,
  InactividadMaquinaFila,
  PeriodoEvolucion,
  ReporteRepuestosRespuesta,
  TiemposAgrupadosFila,
} from '../api/tipos';

const item = (etiqueta: string, valor: number) => ({ clave: etiqueta, etiqueta, valor });

describe('FE-186: el top N con "Otras" (GR1, 3)', () => {
  it('las primeras N de mayor a menor y la suma del resto en "Otras"', () => {
    const r = topConOtras([item('A', 5), item('B', 50), item('C', 20), item('D', 3), item('E', 2)], 3);
    assert.deepEqual(
      r.map((i) => [i.etiqueta, i.valor]),
      [
        ['B', 50],
        ['C', 20],
        ['A', 5],
        ['Otras', 5],
      ]
    );
  });

  it('"Otras" no aparece si el resto es 0, ni si hay N o menos', () => {
    assert.deepEqual(
      topConOtras([item('A', 5), item('B', 4), item('C', 0)], 2).map((i) => i.etiqueta),
      ['A', 'B']
    );
    assert.deepEqual(topConOtras([item('A', 1)], 5).map((i) => i.etiqueta), ['A']);
    assert.deepEqual(topConOtras([], 5), []);
    assert.equal(topConOtras([item('A', 3), item('B', 2), item('C', 1)], 1, 'Otros').at(-1)?.etiqueta, 'Otros');
  });

  it('10 en la computadora y 5 en el celular', () => {
    assert.equal(cantidadRanking(false), 10);
    assert.equal(cantidadRanking(true), 5);
  });
});

describe('FE-187: la etiqueta de cada período (GR1, 3)', () => {
  it('por mes, "sep 26"', () => {
    assert.equal(etiquetaPeriodo('2026-09-01', 'mes'), 'sep 26');
    assert.equal(etiquetaPeriodo('2026-01-15', 'mes'), 'ene 26', 'Un mes recortado lleva igual el nombre del mes');
    assert.equal(etiquetaPeriodo('2025-12-01', 'mes'), 'dic 25');
  });

  it('por semana, "23/11", con el lunes aunque el período empiece otro día', () => {
    assert.equal(etiquetaPeriodo('2026-11-23', 'semana'), '23/11');
    assert.equal(etiquetaPeriodo('2026-11-25', 'semana'), '23/11', 'Miércoles: el lunes de esa semana');
    assert.equal(etiquetaPeriodo('2026-11-29', 'semana'), '23/11', 'Domingo: el lunes anterior');
    assert.equal(etiquetaPeriodo('2026-01-01', 'semana'), '29/12', 'Una semana que cruza el año');
  });

  it('el período completo: semana de lunes a domingo, mes del 1 al último día', () => {
    assert.equal(periodoCompleto({ inicio: '2026-11-23', fin: '2026-11-29' }, 'semana'), true);
    assert.equal(periodoCompleto({ inicio: '2026-11-25', fin: '2026-11-29' }, 'semana'), false);
    assert.equal(periodoCompleto({ inicio: '2026-11-23', fin: '2026-11-26' }, 'semana'), false);
    assert.equal(periodoCompleto({ inicio: '2026-02-01', fin: '2026-02-28' }, 'mes'), true);
    assert.equal(periodoCompleto({ inicio: '2028-02-01', fin: '2028-02-28' }, 'mes'), false, '2028 es bisiesto');
    assert.equal(periodoCompleto({ inicio: '2026-11-01', fin: '2026-11-26' }, 'mes'), false);
  });
});

describe('FE-188: la conclusión de la evolución (GR1, 3)', () => {
  const meses = [
    { inicio: '2026-08-15', fin: '2026-08-31' },
    { inicio: '2026-09-01', fin: '2026-09-30' },
    { inicio: '2026-10-01', fin: '2026-10-31' },
    { inicio: '2026-11-01', fin: '2026-11-30' },
    { inicio: '2026-12-01', fin: '2026-12-10' },
  ];
  const fallas = { texto: 'Las fallas', plural: true };

  it('compara el primer período completo con el último completo, sin los recortados', () => {
    assert.equal(conclusionEvolucion(meses, [20, 7, 5, 3, 0], 'mes', fallas), 'Las fallas bajaron de 7 a 3 por mes');
    assert.equal(conclusionEvolucion(meses, [0, 3, 5, 7, 40], 'mes', fallas), 'Las fallas subieron de 3 a 7 por mes');
  });

  it('estable: menos del 10 % de diferencia', () => {
    assert.equal(UMBRAL_ESTABLE, 0.1);
    assert.equal(
      conclusionEvolucion(meses, [0, 100, 0, 109, 0], 'mes', fallas, formatEntero),
      'Las fallas se mantuvieron estables, en 109 por mes'
    );
    assert.equal(conclusionEvolucion(meses, [0, 100, 0, 110, 0], 'mes', fallas), 'Las fallas subieron de 100 a 110 por mes', 'El 10 % justo ya no es estable');
    assert.equal(conclusionEvolucion(meses, [0, 0, 1, 0, 0], 'mes', fallas), 'Las fallas se mantuvieron estables, en 0 por mes');
    assert.equal(conclusionEvolucion(meses, [0, 0, 0, 2, 0], 'mes', fallas), 'Las fallas subieron de 0 a 2 por mes');
  });

  it('en singular y con plata', () => {
    const costo = { texto: 'El costo', plural: false };
    assert.equal(conclusionEvolucion(meses, [0, 210000, 0, 95000, 0], 'mes', costo, formatPesosEje), 'El costo bajó de $ 210 mil a $ 95 mil por mes');
    assert.equal(conclusionEvolucion(meses, [0, 1000, 0, 1050, 0], 'mes', costo, formatPesosEje), 'El costo se mantuvo estable, en $ 1,1 mil por mes');
  });

  it('por semana, y sin dos períodos completos no hay conclusión', () => {
    const semanas = [
      { inicio: '2026-11-02', fin: '2026-11-08' },
      { inicio: '2026-11-09', fin: '2026-11-15' },
    ];
    assert.equal(conclusionEvolucion(semanas, [4, 2], 'semana', fallas), 'Las fallas bajaron de 4 a 2 por semana');
    assert.equal(conclusionEvolucion([meses[0], meses[1], meses[4]], [1, 2, 3], 'mes', fallas), null);
  });
});

describe('FE-189: las conclusiones del ranking y de la proporción (GR1, 3)', () => {
  it('el ranking: el porcentaje que concentra el primero, desde el 25 %', () => {
    assert.equal(UMBRAL_CONCENTRA, 0.25);
    assert.equal(
      conclusionRanking([item('B', 30), item('COM-01', 40), item('C', 30)], 'de las horas paradas', 'Ninguna máquina'),
      'COM-01 concentra el 40 % de las horas paradas'
    );
    assert.equal(
      conclusionRanking([item('A', 25), item('B', 25), item('C', 25), item('D', 25)], 'de las horas paradas', 'Ninguna máquina'),
      'A concentra el 25 % de las horas paradas',
      'El 25 % justo ya concentra'
    );
  });

  it('el ranking repartido: ninguno llega al 25 %', () => {
    assert.equal(
      conclusionRanking([item('A', 20), item('B', 20), item('C', 20), item('D', 20), item('E', 20)], 'de las horas paradas', 'Ninguna máquina'),
      'Ninguna máquina pasa del 25 % de las horas paradas'
    );
    assert.equal(conclusionRanking([], 'de las horas paradas', 'Ninguna máquina'), null);
    assert.equal(conclusionRanking([item('A', 0)], 'de las horas paradas', 'Ninguna máquina'), null);
  });

  it('la proporción: una parte predomina desde el 60 %; si no, se reparte', () => {
    assert.equal(UMBRAL_PREDOMINA, 0.6);
    const partes = (c: number, p: number) => [
      { etiqueta: 'Correctiva', valor: c },
      { etiqueta: 'Preventiva', valor: p },
    ];
    assert.equal(conclusionProporcion(partes(70, 30), 'la inactividad'), 'El 70 % de la inactividad fue correctiva');
    assert.equal(conclusionProporcion(partes(40, 60), 'la inactividad'), 'El 60 % de la inactividad fue preventiva');
    assert.equal(conclusionProporcion(partes(55, 45), 'la inactividad'), 'La inactividad se repartió entre correctiva y preventiva');
    assert.equal(conclusionProporcion(partes(0, 0), 'la inactividad'), null);
  });
});

describe('FE-190: el formato de ejes y tooltips (GR1, 3)', () => {
  it('cantidades, plata, tiempos y porcentajes en castellano', () => {
    assert.equal(formatEntero(1234), '1.234');
    assert.equal(formatEntero(7.4), '7');
    assert.equal(formatPesos(12345.5), '$ 12.345,50');
    assert.equal(formatPesosEje(950), '$ 950');
    assert.equal(formatPesosEje(1500), '$ 1,5 mil');
    assert.equal(formatPesosEje(120000), '$ 120 mil');
    assert.equal(formatPesosEje(1234567), '$ 1,2 M');
    assert.equal(formatPesosEje(-500), '-$ 500');
    assert.equal(formatHorasEje(90), '1,5 h');
    assert.equal(formatHorasEje(0), '0 h');
    assert.equal(formatTiempo(150), '2 h 30 min');
    assert.equal(formatTiempo(45.4), '45 min');
    assert.equal(formatPorcentajeFraccion(0.974), '97,4 %');
    assert.equal(formatPorcentajeFraccion(1), '100 %');
  });

  it('sin datos y etiquetas largas', () => {
    assert.equal(hayValores([0, 0, 0]), false);
    assert.equal(hayValores([]), false);
    assert.equal(hayValores([0, -500]), true);
    assert.equal(acortar('Compresor de tornillo principal', 12), 'Compresor d…');
    assert.equal(acortar('COM-01', 12), 'COM-01');
  });
});

describe('FE-191: los datos de los gráficos de cada pestaña (GR1, 4)', () => {
  const periodo = (inicio: string, fin: string, cambios: Partial<PeriodoEvolucion> = {}): PeriodoEvolucion => ({
    inicio,
    fin,
    fallas: 0,
    correctivas_finalizadas: 0,
    preventivas_finalizadas: 0,
    inactividad_minutos: 0,
    disponibilidad: 1,
    costo: { repuestos: 0, mano_obra: 0, servicio_externo: 0, transporte: 0, otro: 0, ajuste: 0, total: 0 },
    ...cambios,
  });
  const evolucion: EvolucionReporte = {
    desde: '2026-09-01T03:00:00.000Z',
    hasta: '2026-12-01T03:00:00.000Z',
    agrupar: 'mes',
    periodos: [
      periodo('2026-09-01', '2026-09-30', { fallas: 7, preventivas_finalizadas: 4, disponibilidad: 0.974 }),
      periodo('2026-10-01', '2026-10-31', {
        fallas: 3,
        costo: { repuestos: 1000, mano_obra: 500, servicio_externo: 200, transporte: 100, otro: 0, ajuste: -300, total: 1500 },
      }),
    ],
  };

  it('la evolución: etiqueta, rango del tooltip y título', () => {
    assert.deepEqual(filasEvolucion(evolucion)[0], {
      etiqueta: 'sep 26',
      titulo: '01/09 al 30/09',
      fallas: 7,
      preventivas: 4,
      disponibilidad: 0.974,
    });
    assert.equal(tituloEvolucion(evolucion), 'Las fallas bajaron de 7 a 3 por mes');
  });

  it('costos: un ajuste negativo va a "otros"; si queda negativo, se dibuja 0 y el tooltip lo aclara', () => {
    const [sep, oct] = filasCostoPeriodo(evolucion);
    assert.equal(sep.otros, 0);
    assert.equal(sep.otros_recortado, false);
    assert.equal(oct.otros, 0);
    assert.equal(oct.otros_real, -200);
    assert.equal(oct.otros_recortado, true);
    assert.equal(notaOtrosRecortado(oct), 'Otros dio -$ 200,00 por un ajuste negativo: se muestra en 0.');
    assert.equal(notaOtrosRecortado(sep), null);
    assert.equal(oct.repuestos, 1000);
    assert.equal(oct.servicio_externo, 200);
    assert.equal(tituloCostoPeriodo(evolucion), 'El costo subió de $ 0 a $ 1,5 mil por mes');
  });

  it('inactividad: las máquinas por código, sin las de 0, con "Otras"', () => {
    const fila = (id: number, codigo: string, minutos: number): InactividadMaquinaFila => ({
      maquina: { id, nombre: `Máquina ${id}`, codigo, sector: { id: 1, nombre: 'S' } },
      inactividad_minutos: minutos,
      por_tipo: { CORRECTIVO: minutos, PREVENTIVO: 0 },
      intervenciones_con_detencion: 1,
    });
    const r = rankingInactividad([fila(1, 'COM-01', 400), fila(2, 'TOR-02', 300), fila(3, 'FRE-03', 300), fila(4, 'PRE-04', 0)], 2);
    assert.deepEqual(
      r.items.map((i) => [i.etiqueta, i.valor]),
      [
        ['COM-01', 400],
        ['TOR-02', 300],
        ['Otras', 300],
      ]
    );
    assert.equal(r.titulo, 'COM-01 concentra el 40 % de las horas paradas');
    assert.equal(etiquetaMaquina({ codigo: null, nombre: 'Torno' }), 'Torno');
  });

  it('tiempos: espera, trabajo (neta) y total (espera más bruta)', () => {
    const t: TiemposAgrupadosFila = {
      grupo: 'INTERNA',
      ejecucion: 'INTERNA',
      cantidad: 3,
      espera_promedio_minutos: 30,
      duracion_neta_promedio_minutos: 90,
      duracion_bruta_promedio_minutos: 120,
      duracion_neta_total_minutos: 270,
    };
    assert.deepEqual(filasTiemposGrafico([t], 'ejecucion'), [{ etiqueta: 'Interna', espera: 30, trabajo: 90, total: 150 }]);
  });

  it('repuestos: por importe con costos y por consumos sin costos', () => {
    const datos = (veCostos: boolean): ReporteRepuestosRespuesta => ({
      desde: '',
      hasta: '',
      ve_costos: veCostos,
      consumos: 3,
      intervenciones: 2,
      importe_total: veCostos ? 3000 : null,
      por_repuesto: [
        { repuesto: { id: 1, codigo: 'ROD-1', nombre: 'Rodamiento', unidad: 'u' }, cantidad: 1, consumos: 1, intervenciones: 1, importe: veCostos ? 2500 : null },
        { repuesto: { id: 2, codigo: null, nombre: 'Correa', unidad: 'u' }, cantidad: 4, consumos: 2, intervenciones: 1, importe: veCostos ? 500 : null },
      ],
      por_maquina: [],
    });
    const con = rankingRepuestos(datos(true), 10);
    assert.equal(con.porImporte, true);
    assert.deepEqual(con.items.map((i) => [i.etiqueta, i.valor]), [['ROD-1', 2500], ['Correa', 500]]);
    const sin = rankingRepuestos(datos(false), 10);
    assert.equal(sin.porImporte, false);
    assert.deepEqual(sin.items.map((i) => [i.etiqueta, i.valor]), [['Correa', 2], ['ROD-1', 1]]);
    assert.equal(sin.titulo, 'Correa concentra el 67 % de los consumos');
  });

  it('preventivos: de menor a mayor cumplimiento, sin los que no tienen nada para medir', () => {
    const g = (nombre: string, cumplimiento: number | null) =>
      ({ sector: { id: 1, nombre }, hechas: 1, a_tiempo: 1, tarde: 0, vencidas_sin_hacer: 0, cumplimiento, atraso_promedio_dias: null }) as GrupoCumplimientoPreventivos;
    const r = rankingCumplimiento([g('Mecanizado', 90), g('Prensas', 40), g('Pintura', null), g('Soldadura', 75)], 'sector', 2);
    assert.deepEqual(r.items.map((i) => [i.etiqueta, i.valor]), [['Prensas', 40], ['Soldadura', 75]]);
    assert.equal(r.titulo, 'Cumplimiento por sector: los 2 más bajos');
    assert.equal(rankingCumplimiento([g('Mecanizado', 90)], 'sector', 10).titulo, 'Cumplimiento por sector');
  });

  it('el resumen del celular con 7 días', () => {
    assert.equal(TEXTO_EVOLUCION_7_DIAS, 'Elegí 30 días para ver la evolución');
  });
});
