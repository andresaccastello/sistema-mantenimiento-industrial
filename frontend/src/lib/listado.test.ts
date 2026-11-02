import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  vistasDisponibles,
  leerFiltros,
  escribirFiltros,
  paramsListado,
  hayFiltros,
  FILTROS_POR_DEFECTO,
  FiltrosIntervenciones,
} from './listado';

describe('FE-22: vistasDisponibles, leerFiltros y escribirFiltros', () => {
  const permisosOperario = {
    INTERVENCIONES_CREAR: 'TODAS',
    INTERVENCIONES_VER: 'PROPIAS',
  };

  const permisosResponsable = {
    INTERVENCIONES_VER: 'TODAS',
    INTERVENCIONES_CREAR: 'TODAS',
    INTERVENCIONES_ASIGNARSE: 'TODAS',
    INTERVENCIONES_ASIGNAR: 'TODAS',
    INTERVENCIONES_RECIBIR_ASIGNACION: 'TODAS',
    INTERVENCIONES_CAMBIAR_ESTADO: 'TODAS',
    INTERVENCIONES_EDITAR: 'TODAS',
    INTERVENCIONES_FINALIZAR: 'TODAS',
    INTERVENCIONES_CANCELAR: 'TODAS',
    INTERVENCIONES_ELIMINAR: 'TODAS',
    INTERVENCIONES_REABRIR: 'TODAS',
    INTERVENCIONES_CONFIRMAR_RECUPERACION: 'TODAS',
  };

  const permisosConsulta = {
    INTERVENCIONES_VER: 'TODAS',
    COSTOS_VER: 'TODAS',
    REPORTES_CONSULTAR: 'TODAS',
  };

  it('vistasDisponibles según perfil', () => {
    assert.deepEqual(vistasDisponibles(permisosResponsable), [
      'sin-asignar',
      'mias',
      'abiertas',
      'cerradas',
    ]);
    assert.deepEqual(vistasDisponibles(permisosOperario), ['abiertas', 'cerradas']);
    assert.deepEqual(vistasDisponibles(permisosConsulta), ['abiertas', 'cerradas']);
  });

  it('leerFiltros con dirección vacía devuelve valores por omisión', () => {
    const filtros = leerFiltros(new URLSearchParams(), ['abiertas', 'cerradas']);
    assert.deepEqual(filtros, FILTROS_POR_DEFECTO);
  });

  it('leerFiltros limpia vista no permitida y valores inválidos', () => {
    // vista sin-asignar sin permiso
    const p1 = new URLSearchParams('vista=sin-asignar');
    assert.equal(leerFiltros(p1, ['abiertas', 'cerradas']).vista, 'abiertas');

    // estado FINALIZADA en vista abiertas -> descartado
    const p2 = new URLSearchParams('vista=abiertas&estado=FINALIZADA');
    assert.deepEqual(leerFiltros(p2, ['abiertas', 'cerradas']).estados, []);

    // sector=abc -> null
    const p3 = new URLSearchParams('sector=abc');
    assert.equal(leerFiltros(p3).sectorId, null);

    // desde=2026-02-30 -> null
    const p4 = new URLSearchParams('desde=2026-02-30');
    assert.equal(leerFiltros(p4).desde, null);

    // pagina=0 -> 1
    const p5 = new URLSearchParams('pagina=0');
    assert.equal(leerFiltros(p5).pagina, 1);
  });

  it('ida y vuelta conserva todos los campos completos', () => {
    const completos: FiltrosIntervenciones = {
      vista: 'cerradas',
      estados: ['FINALIZADA'],
      sectorId: 3,
      maquinaId: 12,
      desde: '2026-11-01',
      hasta: '2026-11-05',
      texto: 'motor recalentado',
      pagina: 4,
    };

    const searchParams = escribirFiltros(completos);
    const leidos = leerFiltros(searchParams, ['abiertas', 'cerradas']);
    assert.deepEqual(leidos, completos);
  });

  it('escribirFiltros con valores por omisión devuelve URLSearchParams sin claves', () => {
    const params = escribirFiltros(FILTROS_POR_DEFECTO);
    assert.equal(Array.from(params.keys()).length, 0);
  });
});

describe('FE-23: paramsListado y hayFiltros', () => {
  it('paramsListado genera parámetros correctos por vista', () => {
    // vista sin-asignar -> sin_asignar: true, sin estado
    const pSin = paramsListado({ ...FILTROS_POR_DEFECTO, vista: 'sin-asignar' }, 25);
    assert.equal(pSin.sin_asignar, true);
    assert.equal(pSin.estado, undefined);

    // mias -> mias: true y los 3 estados abiertos
    const pMias = paramsListado({ ...FILTROS_POR_DEFECTO, vista: 'mias' }, 25);
    assert.equal(pMias.mias, true);
    assert.equal(pMias.estado, 'PENDIENTE,EN_PROCESO,EN_ESPERA_REPUESTOS');

    // cerradas con estados: ['CANCELADA'] -> estado: 'CANCELADA'
    const pCer = paramsListado(
      { ...FILTROS_POR_DEFECTO, vista: 'cerradas', estados: ['CANCELADA'] },
      25
    );
    assert.equal(pCer.estado, 'CANCELADA');
  });

  it('paramsListado maneja texto q de al menos 2 caracteres y paginación', () => {
    const pCorto = paramsListado({ ...FILTROS_POR_DEFECTO, texto: ' a ' }, 25);
    assert.equal(pCorto.q, undefined);

    const pTorno = paramsListado({ ...FILTROS_POR_DEFECTO, texto: 'torno' }, 25);
    assert.equal(pTorno.q, 'torno');

    const pPag = paramsListado({ ...FILTROS_POR_DEFECTO, pagina: 3 }, 25);
    assert.equal(pPag.limit, 25);
    assert.equal(pPag.offset, 50);
  });

  it('hayFiltros no cuenta vista ni página, pero sí sector y otros', () => {
    assert.equal(hayFiltros(FILTROS_POR_DEFECTO), false);

    assert.equal(hayFiltros({ ...FILTROS_POR_DEFECTO, vista: 'cerradas' }), false);
    assert.equal(hayFiltros({ ...FILTROS_POR_DEFECTO, pagina: 5 }), false);

    assert.equal(hayFiltros({ ...FILTROS_POR_DEFECTO, sectorId: 2 }), true);
    assert.equal(hayFiltros({ ...FILTROS_POR_DEFECTO, texto: 'bomba' }), true);
  });
});
