import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  leerFiltrosReportes,
  escribirFiltrosReportes,
  rangoDePeriodo,
  formatPorcentaje,
  formatHoras,
  barrasInactividad,
  aCsv,
  nombreArchivoReporte,
  filaTiempos,
  filasReporteRepuestos,
  vistaReporteVisible,
  textoCumplimiento,
  colorCumplimiento,
  textoAtrasoPromedio,
  nombreGrupoPreventivos,
  filasReportePreventivos,
  agruparDePreventivos,
  FILTROS_REPORTES_POR_DEFECTO,
  FiltrosReportes,
} from './reportes';

describe('FE-41: leerFiltrosReportes y escribirFiltrosReportes', () => {
  it('valores de omisión con la dirección vacía', () => {
    const f = leerFiltrosReportes(new URLSearchParams());
    assert.deepEqual(f, FILTROS_REPORTES_POR_DEFECTO);
    assert.equal(f.periodo, '30d');
    assert.equal(f.vista, 'indicadores');
    assert.equal(f.agrupar, 'ejecucion');
    assert.equal(f.desde, null);
    assert.equal(f.hasta, null);
    assert.equal(f.planta, null);
    assert.equal(f.sector, null);
  });

  it('valores inválidos: periodo=ROTO y vista=otra vuelven a omisión', () => {
    const p = new URLSearchParams('periodo=ROTO&vista=otra&agrupar=invalido');
    const f = leerFiltrosReportes(p);
    assert.equal(f.periodo, '30d');
    assert.equal(f.vista, 'indicadores');
    assert.equal(f.agrupar, 'ejecucion');
  });

  it('personalizado con desde posterior a hasta vuelve a 30d', () => {
    const p = new URLSearchParams('periodo=personalizado&desde=2026-03-20&hasta=2026-03-10');
    const f = leerFiltrosReportes(p);
    assert.equal(f.periodo, '30d');
    assert.equal(f.desde, null);
    assert.equal(f.hasta, null);
  });

  it('personalizado al que le falta desde vuelve a 30d', () => {
    const p = new URLSearchParams('periodo=personalizado&hasta=2026-03-10');
    const f = leerFiltrosReportes(p);
    assert.equal(f.periodo, '30d');
    assert.equal(f.desde, null);
    assert.equal(f.hasta, null);
  });

  it('ida y vuelta con todos los campos da lo mismo', () => {
    const completos: FiltrosReportes = {
      periodo: 'personalizado',
      desde: '2026-03-01',
      hasta: '2026-03-10',
      planta: 2,
      sector: 4,
      vista: 'tiempos',
      agrupar: 'sector',
    };
    const params = escribirFiltrosReportes(completos);
    const leidos = leerFiltrosReportes(params);
    assert.deepEqual(leidos, completos);
  });

  it('vista=repuestos es válida y se conserva', () => {
    const p = new URLSearchParams('vista=repuestos');
    const f = leerFiltrosReportes(p);
    assert.equal(f.vista, 'repuestos');

    const params = escribirFiltrosReportes(f);
    assert.equal(params.get('vista'), 'repuestos');
  });

  it('vista=costos es válida y se conserva; sin COSTOS_VER se muestra Indicadores', () => {
    const p = new URLSearchParams('vista=costos');
    const f = leerFiltrosReportes(p);
    assert.equal(f.vista, 'costos');

    const params = escribirFiltrosReportes(f);
    assert.equal(params.get('vista'), 'costos');

    assert.equal(vistaReporteVisible('costos', true), 'costos');
    assert.equal(vistaReporteVisible('costos', false), 'indicadores');
    assert.equal(vistaReporteVisible('repuestos', false), 'repuestos');
  });
});

describe('FE-42: rangoDePeriodo', () => {
  // Ahora fijo: 15 de marzo de 2026, 10:30
  const ahora = new Date(2026, 2, 15, 10, 30, 0, 0);

  it('7d: desde ahora menos 7 días hasta ahora', () => {
    const rango = rangoDePeriodo({ ...FILTROS_REPORTES_POR_DEFECTO, periodo: '7d' }, ahora);
    const esperadoDesde = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(rango.desde, esperadoDesde);
    assert.equal(rango.hasta, ahora.toISOString());
  });

  it('mes: desde 1 de marzo 00:00 hasta ahora', () => {
    const rango = rangoDePeriodo({ ...FILTROS_REPORTES_POR_DEFECTO, periodo: 'mes' }, ahora);
    const esperadoDesde = new Date(2026, 2, 1, 0, 0, 0, 0).toISOString();
    assert.equal(rango.desde, esperadoDesde);
    assert.equal(rango.hasta, ahora.toISOString());
  });

  it('mes-anterior: todo febrero, también en año bisiesto', () => {
    // 2026: no bisiesto (28 días)
    const rango2026 = rangoDePeriodo({ ...FILTROS_REPORTES_POR_DEFECTO, periodo: 'mes-anterior' }, ahora);
    assert.equal(rango2026.desde, new Date(2026, 1, 1, 0, 0, 0, 0).toISOString());
    assert.equal(rango2026.hasta, new Date(2026, 2, 1, 0, 0, 0, 0).toISOString());

    // 2024: bisiesto (29 días en febrero)
    const ahora2024 = new Date(2024, 2, 15, 10, 30, 0, 0);
    const rango2024 = rangoDePeriodo({ ...FILTROS_REPORTES_POR_DEFECTO, periodo: 'mes-anterior' }, ahora2024);
    assert.equal(rango2024.desde, new Date(2024, 1, 1, 0, 0, 0, 0).toISOString());
    assert.equal(rango2024.hasta, new Date(2024, 2, 1, 0, 0, 0, 0).toISOString());
  });

  it('personalizado: del 1 al 10 de marzo: hasta el 11, 00:00', () => {
    const rango = rangoDePeriodo(
      {
        ...FILTROS_REPORTES_POR_DEFECTO,
        periodo: 'personalizado',
        desde: '2026-03-01',
        hasta: '2026-03-10',
      },
      ahora
    );
    assert.equal(rango.desde, new Date(2026, 2, 1, 0, 0, 0, 0).toISOString());
    assert.equal(rango.hasta, new Date(2026, 2, 11, 0, 0, 0, 0).toISOString());
  });
});

describe('FE-43: formatPorcentaje y formatHoras', () => {
  it('formatPorcentaje formatea según la sección 3', () => {
    assert.equal(formatPorcentaje(0.99374), '99,4 %');
    assert.equal(formatPorcentaje(1), '100 %');
    assert.equal(formatPorcentaje(null), '—');
    assert.equal(formatPorcentaje(undefined), '—');
  });

  it('formatHoras formatea según la sección 3', () => {
    assert.equal(formatHoras(239), '239 h');
    assert.equal(formatHoras(12.5), '12,5 h');
    assert.equal(formatHoras(null), '—');
    assert.equal(formatHoras(undefined), '—');
  });
});

describe('FE-44: aCsv y nombreArchivoReporte', () => {
  it('aCsv cumple las reglas para Excel en castellano', () => {
    const columnas = ['Nombre', 'Detalle', 'Horas', 'Notas'];
    const filas = [
      ['Torno', 'Reparación; urgente', 12.5, 'Dijo "listo"'],
      ['Prensa', 'Línea 1\nLínea 2', 40, 'OK'],
    ];

    const csv = aCsv(columnas, filas);

    // Empieza con el BOM
    assert.equal(csv.startsWith('\uFEFF'), true);

    // Termina con \r\n
    assert.equal(csv.endsWith('\r\n'), true);

    // Separador ';'
    assert.equal(csv.includes('Nombre;Detalle;Horas;Notas\r\n'), true);

    // Texto con ';' va entre comillas
    assert.equal(csv.includes('"Reparación; urgente"'), true);

    // Texto con comillas las duplica
    assert.equal(csv.includes('"Dijo ""listo"""'), true);

    // Texto con salto de línea va entre comillas
    assert.equal(csv.includes('"Línea 1\nLínea 2"'), true);

    // Decimal con coma
    assert.equal(csv.includes(';12,5;'), true);
  });

  it('nombreArchivoReporte incluye la vista y el rango de fechas', () => {
    const rango = rangoDePeriodo({
      ...FILTROS_REPORTES_POR_DEFECTO,
      periodo: 'personalizado',
      desde: '2026-10-06',
      hasta: '2026-11-05',
    });
    const nombre = nombreArchivoReporte('inactividad', rango.desde, rango.hasta);
    assert.equal(nombre, 'reporte-inactividad-2026-10-06-a-2026-11-05.csv');
  });

  it('nombreArchivoReporte con Mes anterior descuenta el fin de período y usa fecha local a la noche', () => {
    const ahora = new Date(2026, 10, 5, 22, 30, 0); // 5 de noviembre a las 22:30 (noche)
    const rangoMesAnt = rangoDePeriodo({ ...FILTROS_REPORTES_POR_DEFECTO, periodo: 'mes-anterior' }, ahora);
    const nombre = nombreArchivoReporte('tiempos', rangoMesAnt.desde, rangoMesAnt.hasta);
    assert.equal(nombre, 'reporte-tiempos-2026-10-01-a-2026-10-31.csv');

    // A una hora de la noche (22:30), no se corre de día
    const rango30d = rangoDePeriodo({ ...FILTROS_REPORTES_POR_DEFECTO, periodo: '30d' }, ahora);
    const nombre30d = nombreArchivoReporte('tiempos', rango30d.desde, rango30d.hasta);
    assert.equal(nombre30d, 'reporte-tiempos-2026-10-06-a-2026-11-05.csv');
  });
});

describe('FE-46: filaTiempos', () => {
  it('transforma filas de la API correctamente para cada agrupación', () => {
    // Ejecución interna
    const filaEjecucion = {
      ejecucion: 'INTERNA',
      cantidad: 5,
      espera_promedio_minutos: 15.5,
      duracion_neta_promedio_minutos: 45,
      duracion_bruta_promedio_minutos: 60,
      duracion_neta_total_minutos: 225,
    };
    const resEjec = filaTiempos(filaEjecucion, 'ejecucion');
    assert.equal(resEjec.grupo, 'Interna');
    assert.equal(resEjec.cantidad, 5);
    assert.equal(resEjec.espera_promedio_minutos, 15.5);
    assert.equal(resEjec.duracion_neta_promedio_minutos, 45);

    // Tipo
    const filaTipo = {
      tipo: { id: 1, codigo: 'CORRECTIVO', nombre: 'Mantenimiento correctivo' },
      cantidad: 3,
      espera_promedio_minutos: 20,
      duracion_neta_promedio_minutos: 30,
      duracion_bruta_promedio_minutos: 40,
      duracion_neta_total_minutos: 90,
    };
    const resTipo = filaTiempos(filaTipo, 'tipo');
    assert.equal(resTipo.grupo, 'Mantenimiento correctivo');
    assert.equal(resTipo.cantidad, 3);
    assert.equal(resTipo.espera_promedio_minutos, 20);

    // Sector
    const filaSector = {
      sector: { id: 2, nombre: 'Mecanizado' },
      cantidad: 8,
      espera_promedio_minutos: 10,
      duracion_neta_promedio_minutos: 50,
      duracion_bruta_promedio_minutos: 70,
      duracion_neta_total_minutos: 400,
    };
    const resSector = filaTiempos(filaSector, 'sector');
    assert.equal(resSector.grupo, 'Mecanizado');
    assert.equal(resSector.cantidad, 8);
    assert.equal(resSector.espera_promedio_minutos, 10);

    // ejecucion: null da "Sin definir"
    const filaNula = {
      ejecucion: null,
      cantidad: 1,
      espera_promedio_minutos: null,
      duracion_neta_promedio_minutos: null,
      duracion_bruta_promedio_minutos: null,
      duracion_neta_total_minutos: null,
    };
    const resNula = filaTiempos(filaNula, 'ejecucion');
    assert.equal(resNula.grupo, 'Sin definir');
    assert.equal(resNula.cantidad, 1);
    assert.equal(resNula.espera_promedio_minutos, null);
  });
});

describe('FE-45: barrasInactividad', () => {
  it('la máxima suma 100, la mitad suma 50 y todas en 0 da 0', () => {
    const filas = [
      { correctivo_minutos: 60, preventivo_minutos: 40 }, // total 100 -> max -> 60% y 40% (suma 100)
      { correctivo_minutos: 30, preventivo_minutos: 20 }, // total 50 -> mitad -> 30% y 20% (suma 50)
    ];

    const barras = barrasInactividad(filas);
    assert.equal(barras.length, 2);

    assert.equal(barras[0].correctivo, 60);
    assert.equal(barras[0].preventivo, 40);
    assert.equal(barras[0].correctivo + barras[0].preventivo, 100);

    assert.equal(barras[1].correctivo, 30);
    assert.equal(barras[1].preventivo, 20);
    assert.equal(barras[1].correctivo + barras[1].preventivo, 50);

    // Todas en 0
    const filasCero = [
      { correctivo_minutos: 0, preventivo_minutos: 0 },
      { correctivo_minutos: 0, preventivo_minutos: 0 },
    ];
    const barrasCero = barrasInactividad(filasCero);
    assert.deepEqual(barrasCero, [
      { correctivo: 0, preventivo: 0 },
      { correctivo: 0, preventivo: 0 },
    ]);
  });
});

describe('FE-53: filasReporteRepuestos', () => {
  it('con costos incluye columna Importe y formatea repuesto código · nombre', () => {
    const respuestaApi = {
      desde: '2026-10-01T00:00:00.000Z',
      hasta: '2026-10-31T23:59:59.999Z',
      ve_costos: true,
      consumos: 5,
      intervenciones: 3,
      importe_total: 1250,
      por_repuesto: [
        {
          repuesto: { id: 1, codigo: 'ROD-6204', nombre: 'Rodamiento 6204', unidad: 'unidad' },
          cantidad: 4,
          consumos: 3,
          intervenciones: 2,
          importe: 1000,
        },
      ],
      por_maquina: [],
    };

    const res = filasReporteRepuestos(respuestaApi);
    assert.deepEqual(res.columnas, [
      'Repuesto',
      'Cantidad',
      'Unidad',
      'Consumos',
      'Intervenciones',
      'Importe',
    ]);
    assert.equal(res.filas.length, 1);
    assert.deepEqual(res.filas[0], ['ROD-6204 · Rodamiento 6204', 4, 'unidad', 3, 2, 1000]);
  });

  it('sin costos no incluye columna Importe', () => {
    const respuestaApiSinCostos = {
      desde: '2026-10-01T00:00:00.000Z',
      hasta: '2026-10-31T23:59:59.999Z',
      ve_costos: false,
      consumos: 2,
      intervenciones: 1,
      importe_total: null,
      por_repuesto: [
        {
          repuesto: { id: 2, codigo: 'COR-01', nombre: 'Correa', unidad: 'metro' },
          cantidad: 1.5,
          consumos: 1,
          intervenciones: 1,
          importe: null,
        },
      ],
      por_maquina: [],
    };

    const res = filasReporteRepuestos(respuestaApiSinCostos);
    assert.deepEqual(res.columnas, [
      'Repuesto',
      'Cantidad',
      'Unidad',
      'Consumos',
      'Intervenciones',
    ]);
    assert.equal(res.filas.length, 1);
    assert.deepEqual(res.filas[0], ['COR-01 · Correa', 1.5, 'metro', 1, 1]);
  });

  it('sin código sale solo el nombre del repuesto', () => {
    const respuestaApiSinCodigo = {
      ve_costos: true,
      por_repuesto: [
        {
          repuesto: { id: 3, codigo: null, nombre: 'Grasa lubricante', unidad: 'kg' },
          cantidad: 2,
          consumos: 1,
          intervenciones: 1,
          importe: 250,
        },
      ],
    };

    const res = filasReporteRepuestos(respuestaApiSinCodigo);
    assert.equal(res.filas[0][0], 'Grasa lubricante');
  });
});

describe('FE-126: textoCumplimiento, colorCumplimiento y textoAtrasoPromedio', () => {
  it('textoCumplimiento formatea con coma y un decimal, o guión largo para null', () => {
    assert.equal(textoCumplimiento(81), '81,0 %');
    assert.equal(textoCumplimiento(81.0), '81,0 %');
    assert.equal(textoCumplimiento(95.46), '95,5 %');
    assert.equal(textoCumplimiento(0), '0,0 %');
    assert.equal(textoCumplimiento(100), '100,0 %');
    assert.equal(textoCumplimiento(null), '—');
    assert.equal(textoCumplimiento(undefined), '—');
  });

  it('colorCumplimiento devuelve green >= 90, yellow >= 70, red < 70 y gray para null', () => {
    assert.equal(colorCumplimiento(100), 'green');
    assert.equal(colorCumplimiento(90), 'green');
    assert.equal(colorCumplimiento(89.9), 'yellow');
    assert.equal(colorCumplimiento(70), 'yellow');
    assert.equal(colorCumplimiento(69.9), 'red');
    assert.equal(colorCumplimiento(0), 'red');
    assert.equal(colorCumplimiento(null), 'gray');
    assert.equal(colorCumplimiento(undefined), 'gray');
  });

  it('textoAtrasoPromedio formatea días con coma o guión largo', () => {
    assert.equal(textoAtrasoPromedio(3.5), '3,5 días');
    assert.equal(textoAtrasoPromedio(1), '1 día');
    assert.equal(textoAtrasoPromedio(2), '2 días');
    assert.equal(textoAtrasoPromedio(null), '—');
  });
});

describe('FE-127: nombreGrupoPreventivos', () => {
  it('formatea el grupo para sector, maquina y plan según la sección 3', () => {
    assert.equal(
      nombreGrupoPreventivos({ sector: { id: 3, nombre: 'Pintura' } }, 'sector'),
      'Pintura'
    );

    assert.equal(
      nombreGrupoPreventivos(
        { maquina: { id: 12, codigo: 'PIN-01', nombre: 'Cámara de pintura' } },
        'maquina'
      ),
      'PIN-01 · Cámara de pintura'
    );

    assert.equal(
      nombreGrupoPreventivos(
        { maquina: { id: 13, codigo: null, nombre: 'Compresor auxiliar' } },
        'maquina'
      ),
      'Compresor auxiliar'
    );

    assert.equal(
      nombreGrupoPreventivos(
        {
          plan: { id: 8, nombre: 'Plan mensual' },
          maquina: { id: 12, codigo: 'PIN-01', nombre: 'Cámara de pintura' },
        },
        'plan'
      ),
      'Plan mensual (PIN-01)'
    );

    assert.equal(
      nombreGrupoPreventivos(
        {
          plan: { id: 9, nombre: 'Plan trimestral' },
          maquina: { id: 13, codigo: null, nombre: 'Compresor auxiliar' },
        },
        'plan'
      ),
      'Plan trimestral (Compresor auxiliar)'
    );
  });
});

describe('FE-128: filasReportePreventivos y filtros de preventivos en URL', () => {
  it('genera columnas y filas para el CSV de preventivos y las exporta con aCsv', () => {
    const grupos = [
      {
        maquina: { id: 12, codigo: 'PIN-01', nombre: 'Cámara de pintura' },
        hechas: 10,
        a_tiempo: 7,
        tarde: 3,
        vencidas_sin_hacer: 2,
        cumplimiento: 58.3,
        atraso_promedio_dias: 4.0,
      },
      {
        maquina: { id: 15, codigo: 'TOR-02', nombre: 'Torno CNC' },
        hechas: 5,
        a_tiempo: 5,
        tarde: 0,
        vencidas_sin_hacer: 0,
        cumplimiento: 100.0,
        atraso_promedio_dias: null,
      },
    ];

    const { columnas, filas } = filasReportePreventivos(grupos, 'maquina');
    assert.deepEqual(columnas, [
      'Grupo',
      'Hechas',
      'A tiempo',
      'Tarde',
      'Vencidas sin hacer',
      'Cumplimiento',
      'Atraso',
    ]);
    assert.deepEqual(filas, [
      ['PIN-01 · Cámara de pintura', 10, 7, 3, 2, 58.3, 4],
      ['TOR-02 · Torno CNC', 5, 5, 0, 0, 100, null],
    ]);

    const csv = aCsv(columnas, filas);
    assert.equal(csv.includes('PIN-01 · Cámara de pintura;10;7;3;2;58,3;4\r\n'), true);
    assert.equal(csv.includes('TOR-02 · Torno CNC;5;5;0;0;100;\r\n'), true);
  });

  it('recuerda vista=preventivos y agrupar=maquina|plan en la dirección', () => {
    const leido = leerFiltrosReportes('?vista=preventivos&agrupar=plan');
    assert.equal(leido.vista, 'preventivos');
    assert.equal(leido.agrupar, 'plan');
    assert.equal(agruparDePreventivos(leido.agrupar), 'plan');
    assert.equal(agruparDePreventivos('ejecucion'), 'sector');

    const params = escribirFiltrosReportes(leido);
    assert.equal(params.get('vista'), 'preventivos');
    assert.equal(params.get('agrupar'), 'plan');
  });
});



