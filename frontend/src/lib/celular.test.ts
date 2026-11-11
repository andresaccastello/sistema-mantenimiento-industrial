import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { permitidaEnCelular, itemsMenuCelular, destinoInicioCelular } from './celular';
import { itemsMenu } from './menu';
import { destinoInicio } from './inicio';

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
  COSTOS_VER: 'TODAS',
  COSTOS_REGISTRAR: 'TODAS',
  MAQUINAS_CAMBIAR_ESTADO: 'TODAS',
  NOTIFICACIONES_FALLAS_RECIBIR: 'TODAS',
  REPUESTOS_GESTIONAR: 'TODAS',
  PLANES_GESTIONAR: 'TODAS',
  DOCUMENTOS_GESTIONAR: 'TODAS',
  REPORTES_CONSULTAR: 'TODAS',
};

const permisosAdmin = {
  ...permisosResponsable,
  PERMISOS_GESTIONAR: 'TODAS',
  USUARIOS_GESTIONAR: 'TODAS',
  MAQUINAS_GESTIONAR: 'TODAS',
  CONFIGURACION_GESTIONAR: 'TODAS',
};

const permisosConsulta = {
  INTERVENCIONES_VER: 'TODAS',
  COSTOS_VER: 'TODAS',
  REPORTES_CONSULTAR: 'TODAS',
};

describe('FE-129: permitidaEnCelular', () => {
  it('/ingreso, /cambiar-password, /mi-cuenta y /notificaciones están permitidas', () => {
    assert.equal(permitidaEnCelular('/ingreso', permisosOperario), true);
    assert.equal(permitidaEnCelular('/cambiar-password', permisosOperario), true);
    assert.equal(permitidaEnCelular('/mi-cuenta', permisosOperario), true);
    assert.equal(permitidaEnCelular('/notificaciones', permisosResponsable), true);
  });

  it('/reportar y /mis-reportes están permitidas', () => {
    assert.equal(permitidaEnCelular('/reportar', permisosOperario), true);
    assert.equal(permitidaEnCelular('/mis-reportes', permisosOperario), true);
  });

  it('/intervenciones/:id solo está permitida cuando se muestra el reporte del operario', () => {
    assert.equal(permitidaEnCelular('/intervenciones/42', permisosOperario), true);
    assert.equal(permitidaEnCelular('/intervenciones/42', permisosResponsable), false);
    assert.equal(permitidaEnCelular('/intervenciones/42', permisosAdmin), false);
    assert.equal(permitidaEnCelular('/intervenciones/42', permisosConsulta), false);
  });

  it('/tablero y /reportes están permitidas para consultar', () => {
    assert.equal(permitidaEnCelular('/tablero', permisosResponsable), true);
    assert.equal(permitidaEnCelular('/reportes', permisosResponsable), true);
  });

  it('todo lo demás no está permitido en el celular', () => {
    assert.equal(permitidaEnCelular('/intervenciones', permisosResponsable), false);
    assert.equal(permitidaEnCelular('/preventivos', permisosResponsable), false);
    assert.equal(permitidaEnCelular('/preventivos/planes/nuevo', permisosResponsable), false);
    assert.equal(permitidaEnCelular('/maquinas', permisosOperario), false);
    assert.equal(permitidaEnCelular('/repuestos', permisosResponsable), false);
    assert.equal(permitidaEnCelular('/usuarios', permisosAdmin), false);
    assert.equal(permitidaEnCelular('/perfiles', permisosAdmin), false);
    assert.equal(permitidaEnCelular('/sectores', permisosAdmin), false);
    assert.equal(permitidaEnCelular('/configuracion', permisosAdmin), false);
  });

  it('una ruta con id, una con parámetros (/reportes?vista=costos) y una que no existe', () => {
    // Ruta con id fuera de /intervenciones/:id de operario
    assert.equal(permitidaEnCelular('/maquinas/15', permisosResponsable), false);
    assert.equal(permitidaEnCelular('/usuarios/3', permisosAdmin), false);
    assert.equal(permitidaEnCelular('/preventivos/planes/8', permisosResponsable), false);

    // Con parámetros
    assert.equal(permitidaEnCelular('/reportes?vista=costos', permisosResponsable), true);
    assert.equal(permitidaEnCelular('/tablero?planta=2', permisosResponsable), true);
    assert.equal(permitidaEnCelular('/intervenciones?estado=PENDIENTE', permisosResponsable), false);

    // Ruta que no existe
    assert.equal(permitidaEnCelular('/no-existe', permisosAdmin), false);
    assert.equal(permitidaEnCelular('/otra/ruta/inexistente', permisosOperario), false);
  });
});

describe('FE-130: menú del celular para operario, responsable y administrador', () => {
  it('operario ve Reportar falla y Mis reportes', () => {
    const items = itemsMenu(permisosOperario, true);
    assert.deepEqual(
      items.map((i) => [i.etiqueta, i.ruta]),
      [
        ['Reportar falla', '/reportar'],
        ['Mis reportes', '/mis-reportes'],
      ]
    );
    assert.deepEqual(items, itemsMenuCelular(permisosOperario));
  });

  it('responsable ve Reportar falla, Mis reportes, Tablero y Reportes', () => {
    const items = itemsMenu(permisosResponsable, true);
    assert.deepEqual(
      items.map((i) => [i.etiqueta, i.ruta]),
      [
        ['Reportar falla', '/reportar'],
        ['Mis reportes', '/mis-reportes'],
        ['Tablero', '/tablero'],
        ['Reportes', '/reportes'],
      ]
    );
  });

  it('administrador ve en celular solo las secciones permitidas, y en computadora los 10 ítems', () => {
    const enCelular = itemsMenu(permisosAdmin, true);
    assert.deepEqual(
      enCelular.map((i) => [i.etiqueta, i.ruta]),
      [
        ['Reportar falla', '/reportar'],
        ['Mis reportes', '/mis-reportes'],
        ['Tablero', '/tablero'],
        ['Reportes', '/reportes'],
      ]
    );

    const enComputadora = itemsMenu(permisosAdmin, false);
    assert.equal(enComputadora.length, 10);
  });
});

describe('FE-131: destino al entrar en el celular y en la computadora', () => {
  it('en el celular: con INTERVENCIONES_CREAR va a /reportar; si no, a /tablero o a /reportes', () => {
    // Con INTERVENCIONES_CREAR -> /reportar
    assert.equal(destinoInicio(permisosOperario, true), '/reportar');
    assert.equal(destinoInicio(permisosResponsable, true), '/reportar');
    assert.equal(destinoInicio(permisosAdmin, true), '/reportar');
    assert.equal(destinoInicioCelular(permisosOperario), '/reportar');

    // Sin INTERVENCIONES_CREAR y con INTERVENCIONES_VER en TODAS/SECTORES -> /tablero
    assert.equal(destinoInicio(permisosConsulta, true), '/tablero');
    assert.equal(destinoInicio({ INTERVENCIONES_VER: 'SECTORES' }, true), '/tablero');

    // Sin INTERVENCIONES_CREAR ni tablero, pero con REPORTES_CONSULTAR -> /reportes
    assert.equal(destinoInicio({ REPORTES_CONSULTAR: 'TODAS' }, true), '/reportes');
    assert.equal(
      destinoInicio({ INTERVENCIONES_VER: 'PROPIAS', REPORTES_CONSULTAR: 'SECTORES' }, true),
      '/reportes'
    );
  });

  it('en la computadora, destinoInicio no cambia', () => {
    assert.equal(destinoInicio(permisosOperario), '/mis-reportes');
    assert.equal(destinoInicio(permisosOperario, false), '/mis-reportes');
    assert.equal(destinoInicio(permisosResponsable), '/tablero');
    assert.equal(destinoInicio(permisosAdmin), '/tablero');
    assert.equal(destinoInicio(permisosConsulta), '/tablero');
  });
});
