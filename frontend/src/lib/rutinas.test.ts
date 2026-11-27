import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RutinaHoy, RutinaReporte } from '../api/tipos';
import {
  agruparPorMaquina,
  columnasGrilla,
  estadoVisual,
  filasGrilla,
  formatoPorcentaje,
  nombreMaquina,
  textoFrecuencia,
  textoPeriodo,
  textoUltimaVez,
  tooltipPeriodo,
  ultimosPeriodos,
  diaMes,
  diaSemana,
  nombreCorto,
  puedeDeshacer,
  rotuloFrecuencia,
  textoHecha,
  tituloTareasDeHoy,
} from './rutinas';
import { itemsMenu, permitidaEnCelular } from './menu';
import { escribirFiltrosReportes, leerFiltrosReportes, periodoPorDefecto, rangoDePeriodo } from './reportes';

const ana = { id: 7, legajo: '1001', nombre: 'Ana', apellido: 'Pérez' };
const luis = { id: 8, legajo: '1002', nombre: 'Luis', apellido: null };

/** Una hora local, para que la prueba dé lo mismo en cualquier zona. */
const local = (dia: number, h: number, m: number) => new Date(2026, 10, dia, h, m).toISOString();

let siguiente = 1;
function rutina(
  maquina: { id: number; codigo: string | null; nombre: string; sector: string; planta: string | null },
  descripcion: string,
  hecha = false
): RutinaHoy {
  return {
    id: siguiente++,
    descripcion,
    frecuencia: 'DIARIA',
    incluye_sabado: false,
    activa: true,
    vigente_desde: '2026-11-01',
    baja_en: null,
    maquina: {
      id: maquina.id,
      codigo: maquina.codigo,
      nombre: maquina.nombre,
      sector: { id: maquina.id * 10, nombre: maquina.sector },
      planta: maquina.planta === null ? null : { id: 1, nombre: maquina.planta },
    },
    periodo: '2026-11-24',
    registro: hecha ? { id: 1, usuario: ana, hecha_en: local(24, 10, 32), nota: null } : null,
  };
}

describe('FE-168: el encabezado de Tareas de hoy (RT1, 4)', () => {
  it('día de la semana y fecha, sin zona horaria', () => {
    assert.equal(tituloTareasDeHoy('2026-11-24'), 'Tareas de hoy · martes 24/11');
    assert.equal(tituloTareasDeHoy('2026-11-23'), 'Tareas de hoy · lunes 23/11');
    assert.equal(diaSemana('2026-11-29'), 'domingo');
    assert.equal(diaMes('2026-01-05'), '05/01');
  });
});

describe('FE-169: el rótulo de la frecuencia (RT1, 4)', () => {
  it('Diaria y Semanal', () => {
    assert.equal(rotuloFrecuencia('DIARIA'), 'Diaria');
    assert.equal(rotuloFrecuencia('SEMANAL'), 'Semanal');
  });
});

describe('FE-170: "Hecha por … a las …" (RT1, 4)', () => {
  it('nombre corto', () => {
    assert.equal(nombreCorto(ana), 'A. Pérez');
    assert.equal(nombreCorto(luis), 'Luis');
  });
  it('hecha hoy: solo la hora', () => {
    assert.equal(textoHecha({ usuario: ana, hecha_en: local(24, 10, 32) }, '2026-11-24'), 'Hecha por A. Pérez a las 10:32');
    assert.equal(textoHecha({ usuario: luis, hecha_en: local(24, 7, 5) }, '2026-11-24'), 'Hecha por Luis a las 07:05');
  });
  it('una semanal hecha otro día de la semana: con el día', () => {
    assert.equal(
      textoHecha({ usuario: ana, hecha_en: local(23, 16, 0) }, '2026-11-24'),
      'Hecha por A. Pérez el lunes 23/11 a las 16:00'
    );
  });
});

describe('FE-171: quién puede deshacer (RT1, 4)', () => {
  it('solo quien la marcó', () => {
    const registro = { usuario: ana };
    assert.equal(puedeDeshacer(registro, 7), true);
    assert.equal(puedeDeshacer(registro, 8), false);
    assert.equal(puedeDeshacer(null, 7), false);
    assert.equal(puedeDeshacer(registro, null), false);
    assert.equal(puedeDeshacer(registro, undefined), false);
  });
});

describe('FE-172: agrupar por máquina y ordenar (RT1, 4)', () => {
  const torno = { id: 1, codigo: 'TOR-02', nombre: 'Torno', sector: 'Mecanizado', planta: 'Planta 1' };
  const fresa = { id: 2, codigo: 'FRE-01', nombre: 'Fresadora', sector: 'Mecanizado', planta: 'Planta 1' };
  const horno = { id: 3, codigo: 'HOR-01', nombre: 'Horno', sector: 'Hornos', planta: 'Planta 1' };
  const prensa = { id: 4, codigo: null, nombre: 'Prensa', sector: 'Armado', planta: 'Planta 2' };

  it('grupos por planta, sector y código; dentro, primero las que faltan', () => {
    const grupos = agruparPorMaquina([
      rutina(prensa, 'Engrasar'),
      rutina(torno, 'Limpiar viruta', true),
      rutina(torno, 'Revisar nivel'),
      rutina(horno, 'Purgar'),
      rutina(fresa, 'Limpiar'),
      rutina(torno, 'Aceitar guías'),
    ]);
    assert.deepEqual(grupos.map((g) => g.titulo), [
      'HOR-01 · Horno · Hornos',
      'FRE-01 · Fresadora · Mecanizado',
      'TOR-02 · Torno · Mecanizado',
      'Prensa · Armado',
    ]);
    assert.deepEqual(grupos[2].rutinas.map((r) => [r.descripcion, r.registro !== null]), [
      ['Aceitar guías', false],
      ['Revisar nivel', false],
      ['Limpiar viruta', true],
    ]);
  });

  it('sin tareas, sin grupos', () => {
    assert.deepEqual(agruparPorMaquina([]), []);
  });
});

describe('FE-173: "Tareas de hoy" en el menú y en el celular (RT1, 4)', () => {
  const operario = { INTERVENCIONES_CREAR: 'PROPIAS', INTERVENCIONES_VER: 'PROPIAS', RUTINAS_REALIZAR: 'SECTORES' };

  it('en la computadora, después de Lecturas', () => {
    const items = itemsMenu({ ...operario, MAQUINAS_REGISTRAR_LECTURAS: 'TODAS' });
    assert.deepEqual(items.map((i) => i.etiqueta), ['Inicio', 'Reportar falla', 'Intervenciones', 'Lecturas', 'Tareas de hoy', 'Máquinas']);
    assert.deepEqual(
      items.filter((i) => i.ruta === '/rutinas').map((i) => [i.etiqueta, i.ruta, i.icono]),
      [['Tareas de hoy', '/rutinas', 'IconChecklist']]
    );
    assert.ok(!itemsMenu({ PLANES_GESTIONAR: 'TODAS' }).some((i) => i.ruta === '/rutinas'), 'Sin RUTINAS_REALIZAR');
  });

  it('en el celular con modo simple, el mismo ítem', () => {
    assert.deepEqual(
      itemsMenu({ ...operario, MAQUINAS_REGISTRAR_LECTURAS: 'TODAS' }, true).map((i) => [i.etiqueta, i.ruta, i.icono]),
      [
        ['Mis reportes', '/mis-reportes', 'IconTool'],
        ['Lecturas', '/lecturas', 'IconGauge'],
        ['Tareas de hoy', '/rutinas', 'IconChecklist'],
      ]
    );
    assert.equal(permitidaEnCelular('/rutinas', operario), true);
    assert.equal(permitidaEnCelular('/rutinas/', operario), true);
    assert.equal(permitidaEnCelular('/rutinas', { INTERVENCIONES_CREAR: 'PROPIAS' }), false);
  });
});

// =============================================================================
// Sección 5: la ficha de la máquina y el reporte
// =============================================================================

function rutinaReporte(
  id: number,
  frecuencia: 'DIARIA' | 'SEMANAL',
  periodos: Array<[string, 'HECHA' | 'NO_HECHA' | 'PENDIENTE']>,
  porcentaje: number | null = null
): RutinaReporte {
  return {
    id,
    descripcion: `Tarea ${id}`,
    frecuencia,
    incluye_sabado: false,
    activa: true,
    vigente_desde: '2026-11-01',
    baja_en: null,
    maquina: { id: 1, codigo: 'COM-01', nombre: 'Compresor', sector: { id: 2, nombre: 'Pintura' }, planta: null },
    resumen: { esperadas: periodos.length, hechas: 0, no_hechas: 0, pendientes: 0, porcentaje },
    periodos: periodos.map(([periodo, estado]) => ({
      periodo,
      estado,
      usuario: estado === 'HECHA' ? ana : null,
      hecha_en: estado === 'HECHA' ? local(Number(periodo.slice(8)), 9, 15) : null,
      nota: null,
    })),
  };
}

describe('FE-174: el color y el rótulo de cada estado (RT1, 5)', () => {
  it('verde hecha, rojo no hecha, gris con borde pendiente; solo variables --sm-*', () => {
    assert.deepEqual(estadoVisual('HECHA'), { rotulo: 'Hecha', fondo: 'var(--sm-exito)', borde: null });
    assert.deepEqual(estadoVisual('NO_HECHA'), { rotulo: 'No hecha', fondo: 'var(--sm-peligro)', borde: null });
    assert.deepEqual(estadoVisual('PENDIENTE'), { rotulo: 'Pendiente', fondo: 'transparent', borde: 'var(--sm-muy-tenue)' });
  });
});

describe('FE-175: el formato del porcentaje (RT1, 5)', () => {
  it('con "—" si es null', () => {
    assert.equal(formatoPorcentaje(79), '79 %');
    assert.equal(formatoPorcentaje(0), '0 %');
    assert.equal(formatoPorcentaje(null), '—');
  });
});

describe('FE-176: las columnas y las filas de la grilla (RT1, 5.2)', () => {
  const rutinas = [
    rutinaReporte(1, 'DIARIA', [['2026-11-20', 'HECHA'], ['2026-11-23', 'NO_HECHA'], ['2026-11-24', 'PENDIENTE']], 50),
    rutinaReporte(2, 'DIARIA', [['2026-11-21', 'HECHA'], ['2026-11-23', 'HECHA']], 100),
    rutinaReporte(3, 'SEMANAL', [['2026-11-16', 'NO_HECHA'], ['2026-11-23', 'PENDIENTE']], 0),
  ];

  it('una columna por día en las diarias, sin repetir y en orden', () => {
    assert.deepEqual(columnasGrilla(rutinas, 'DIARIA'), [
      { periodo: '2026-11-20', rotulo: 'vi 20/11' },
      { periodo: '2026-11-21', rotulo: 'sá 21/11' },
      { periodo: '2026-11-23', rotulo: 'lu 23/11' },
      { periodo: '2026-11-24', rotulo: 'ma 24/11' },
    ]);
  });

  it('una columna por semana en las semanales', () => {
    assert.deepEqual(columnasGrilla(rutinas, 'SEMANAL'), [
      { periodo: '2026-11-16', rotulo: '16/11' },
      { periodo: '2026-11-23', rotulo: '23/11' },
    ]);
  });

  it('cada fila con su período en cada columna, o null', () => {
    const columnas = columnasGrilla(rutinas, 'DIARIA');
    const filas = filasGrilla(rutinas, 'DIARIA', columnas);
    assert.deepEqual(filas.map((f) => f.rutina.id), [1, 2]);
    assert.deepEqual(filas[1].celdas.map((c) => c?.estado ?? null), [null, 'HECHA', 'HECHA', null]);
    assert.deepEqual(columnasGrilla([], 'DIARIA'), []);
  });

  it('el tooltip: fecha, estado, quién y cuándo, y la nota', () => {
    const p = { periodo: '2026-11-23', estado: 'HECHA' as const, usuario: ana, hecha_en: local(23, 9, 15), nota: 'Agua turbia' };
    assert.equal(
      tooltipPeriodo(p, 'DIARIA', '2026-11-24'),
      '23/11: Hecha · Hecha por A. Pérez el lunes 23/11 a las 09:15 · Nota: Agua turbia'
    );
    assert.equal(
      tooltipPeriodo({ periodo: '2026-11-16', estado: 'NO_HECHA', usuario: null, hecha_en: null, nota: null }, 'SEMANAL', '2026-11-24'),
      'Semana del 16/11: No hecha'
    );
  });

  it('en el celular, los últimos 5 períodos', () => {
    assert.deepEqual(ultimosPeriodos([1, 2, 3, 4, 5, 6, 7]), [3, 4, 5, 6, 7]);
    assert.deepEqual(ultimosPeriodos([1, 2]), [1, 2]);
  });
});

describe('FE-177: la ficha de la máquina (RT1, 5.1)', () => {
  it('la frecuencia, con "incluye sábado"', () => {
    assert.equal(textoFrecuencia({ frecuencia: 'DIARIA', incluye_sabado: true }), 'Diaria · incluye sábado');
    assert.equal(textoFrecuencia({ frecuencia: 'DIARIA', incluye_sabado: false }), 'Diaria');
    assert.equal(textoFrecuencia({ frecuencia: 'SEMANAL', incluye_sabado: false }), 'Semanal');
  });
  it('"Última vez: 21/11, L. Pérez"', () => {
    assert.equal(textoUltimaVez({ hecha_en: local(21, 10, 0), usuario: { nombre: 'Lucía', apellido: 'Pérez' } }), 'Última vez: 21/11, L. Pérez');
    assert.equal(textoUltimaVez(null), 'Última vez: —');
  });
  it('la fecha del punto', () => {
    assert.equal(textoPeriodo('2026-11-24', 'DIARIA'), '24/11');
    assert.equal(textoPeriodo('2026-11-23', 'SEMANAL'), 'Semana del 23/11');
    assert.equal(nombreMaquina({ codigo: null, nombre: 'Prensa' }), 'Prensa');
  });
});

describe('FE-178: el período por omisión de la pestaña Rutinas (RT1, 5.2)', () => {
  it('Rutinas, las últimas 4 semanas; las demás pestañas siguen en 30 días', () => {
    assert.equal(periodoPorDefecto('rutinas'), '4s');
    assert.equal(periodoPorDefecto('preventivos'), '30d');
    assert.equal(leerFiltrosReportes('?vista=rutinas').periodo, '4s');
    assert.equal(leerFiltrosReportes('?vista=preventivos').periodo, '30d');
    assert.equal(leerFiltrosReportes('?vista=rutinas&periodo=30d').periodo, '30d', 'Elegido a mano, se respeta');
  });
  it('la URL no lleva el de omisión de cada pestaña', () => {
    const base = leerFiltrosReportes('');
    assert.equal(escribirFiltrosReportes({ ...base, vista: 'rutinas', periodo: '4s' }).get('periodo'), null);
    assert.equal(escribirFiltrosReportes({ ...base, vista: 'rutinas', periodo: '30d' }).get('periodo'), '30d');
    assert.equal(escribirFiltrosReportes({ ...base, vista: 'tiempos', periodo: '4s' }).get('periodo'), '4s');
  });
  it('4 semanas son 28 días', () => {
    const ahora = new Date('2026-11-24T15:00:00.000Z');
    const r = rangoDePeriodo({ ...leerFiltrosReportes(''), periodo: '4s' }, ahora);
    assert.equal((new Date(r.hasta).getTime() - new Date(r.desde).getTime()) / 86_400_000, 28);
  });
});
