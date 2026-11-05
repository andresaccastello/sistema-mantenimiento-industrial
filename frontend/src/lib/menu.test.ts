import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { itemsMenu } from './menu';

describe('FE-04: itemsMenu con los permisos de cada perfil', () => {
  // Permisos copiados de las migraciones (004_permisos_granulares.sql, 009_usuarios.sql)

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

  const permisosID = { ...permisosResponsable };

  const permisosConsulta = {
    INTERVENCIONES_VER: 'TODAS',
    COSTOS_VER: 'TODAS',
    REPORTES_CONSULTAR: 'TODAS',
  };

  const permisosDireccion = {
    ...permisosConsulta,
    NOTIFICACIONES_FALLAS_RECIBIR: 'TODAS',
  };

  const permisosAdmin = {
    ...permisosResponsable,
    PERMISOS_GESTIONAR: 'TODAS',
    USUARIOS_GESTIONAR: 'TODAS',
    MAQUINAS_GESTIONAR: 'TODAS',
    CONFIGURACION_GESTIONAR: 'TODAS',
  };

  it('OPERARIO: Inicio, Reportar falla, Intervenciones, Máquinas', () => {
    const items = itemsMenu(permisosOperario).map((i) => i.etiqueta);
    assert.deepEqual(items, ['Inicio', 'Reportar falla', 'Intervenciones', 'Máquinas']);
  });

  it('RESPONSABLE_MANTENIMIENTO: Inicio, Reportar falla, Intervenciones, Máquinas, Reportes', () => {
    const items = itemsMenu(permisosResponsable).map((i) => i.etiqueta);
    assert.deepEqual(items, [
      'Inicio',
      'Reportar falla',
      'Intervenciones',
      'Máquinas',
      'Reportes',
    ]);
  });

  it('I_D: Inicio, Reportar falla, Intervenciones, Máquinas, Reportes', () => {
    const items = itemsMenu(permisosID).map((i) => i.etiqueta);
    assert.deepEqual(items, [
      'Inicio',
      'Reportar falla',
      'Intervenciones',
      'Máquinas',
      'Reportes',
    ]);
  });

  it('CONSULTA: Inicio, Intervenciones, Máquinas, Reportes', () => {
    const items = itemsMenu(permisosConsulta).map((i) => i.etiqueta);
    assert.deepEqual(items, ['Inicio', 'Intervenciones', 'Máquinas', 'Reportes']);
  });

  it('DIRECCION: Inicio, Intervenciones, Máquinas, Reportes', () => {
    const items = itemsMenu(permisosDireccion).map((i) => i.etiqueta);
    assert.deepEqual(items, ['Inicio', 'Intervenciones', 'Máquinas', 'Reportes']);
  });

  it('ADMINISTRADOR: los 8 ítems, incluyendo Configuración al final', () => {
    const items = itemsMenu(permisosAdmin).map((i) => i.etiqueta);
    assert.deepEqual(items, [
      'Inicio',
      'Reportar falla',
      'Intervenciones',
      'Máquinas',
      'Reportes',
      'Usuarios',
      'Sectores y catálogos',
      'Configuración',
    ]);
  });

  it('Configuración aparece con CONFIGURACION_GESTIONAR y no aparece sin ese permiso', () => {
    const conPermiso = itemsMenu({ CONFIGURACION_GESTIONAR: 'TODAS' });
    assert.ok(conPermiso.some((i) => i.etiqueta === 'Configuración' && i.ruta === '/configuracion'));

    const sinPermiso = itemsMenu({ USUARIOS_GESTIONAR: 'TODAS' });
    assert.ok(!sinPermiso.some((i) => i.etiqueta === 'Configuración'));
  });
});
