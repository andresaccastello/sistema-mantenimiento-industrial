import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RutinaHoy } from '../api/tipos';
import {
  agruparPorMaquina,
  diaMes,
  diaSemana,
  nombreCorto,
  puedeDeshacer,
  rotuloFrecuencia,
  textoHecha,
  tituloTareasDeHoy,
} from './rutinas';
import { itemsMenu, permitidaEnCelular } from './menu';

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
