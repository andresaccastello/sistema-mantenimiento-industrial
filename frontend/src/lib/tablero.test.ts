import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enlacesTablero, contadoresIntervencion } from './tablero';

describe('FE-29: enlacesTablero y contadoresIntervencion', () => {
  it('enlacesTablero sin planta devuelve los destinos de la tabla 3.2', () => {
    const sinPlanta = enlacesTablero(null);
    assert.deepEqual(sinPlanta, {
      OPERATIVA: '/maquinas?estado=OPERATIVA',
      DETENIDA: '/maquinas?estado=DETENIDA',
      EN_MANTENIMIENTO: '/maquinas?estado=EN_MANTENIMIENTO',
      FUERA_DE_SERVICIO: '/maquinas?estado=FUERA_DE_SERVICIO',
      sin_asignar: '/intervenciones?vista=sin-asignar',
      en_proceso: '/intervenciones?estado=EN_PROCESO',
      en_espera_repuestos: '/intervenciones?estado=EN_ESPERA_REPUESTOS',
      mias_abiertas: '/intervenciones?vista=mias',
    });
  });

  it('enlacesTablero con planta 7 agrega planta=7 a todos los destinos', () => {
    const conPlanta = enlacesTablero(7);
    assert.deepEqual(conPlanta, {
      OPERATIVA: '/maquinas?estado=OPERATIVA&planta=7',
      DETENIDA: '/maquinas?estado=DETENIDA&planta=7',
      EN_MANTENIMIENTO: '/maquinas?estado=EN_MANTENIMIENTO&planta=7',
      FUERA_DE_SERVICIO: '/maquinas?estado=FUERA_DE_SERVICIO&planta=7',
      sin_asignar: '/intervenciones?vista=sin-asignar&planta=7',
      en_proceso: '/intervenciones?estado=EN_PROCESO&planta=7',
      en_espera_repuestos: '/intervenciones?estado=EN_ESPERA_REPUESTOS&planta=7',
      mias_abiertas: '/intervenciones?vista=mias&planta=7',
    });
  });

  it('contadoresIntervencion devuelve los cuatro para RESPONSABLE y solo dos para CONSULTA', () => {
    const permisosResponsable = {
      INTERVENCIONES_VER: 'TODAS',
      INTERVENCIONES_ASIGNAR: 'TODAS',
      INTERVENCIONES_ASIGNARSE: 'TODAS',
      INTERVENCIONES_RECIBIR_ASIGNACION: 'TODAS',
    };
    const permisosConsulta = {
      INTERVENCIONES_VER: 'TODAS',
      COSTOS_VER: 'TODAS',
      REPORTES_CONSULTAR: 'TODAS',
    };

    assert.deepEqual(contadoresIntervencion(permisosResponsable), [
      'sin_asignar',
      'en_proceso',
      'en_espera_repuestos',
      'mias_abiertas',
    ]);
    assert.deepEqual(contadoresIntervencion(permisosConsulta), [
      'en_proceso',
      'en_espera_repuestos',
    ]);
  });
});

