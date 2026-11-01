import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { vistaDetalle, itemHistorial, hayCambiosReporte } from './intervenciones.js';

describe('FE-11: vistaDetalle', () => {
  // Permisos copiados de migraciones (igual que en FE-04 / menu.test.ts)
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

  const permisosAdmin = {
    ...permisosResponsable,
    PERMISOS_GESTIONAR: 'TODAS',
    USUARIOS_GESTIONAR: 'TODAS',
    MAQUINAS_GESTIONAR: 'TODAS',
  };

  it('determina vista simple para OPERARIO y completa para otros perfiles', () => {
    assert.equal(vistaDetalle(permisosOperario), 'simple');
    assert.equal(vistaDetalle(permisosResponsable), 'completa');
    assert.equal(vistaDetalle(permisosConsulta), 'completa');
    assert.equal(vistaDetalle(permisosAdmin), 'completa');
  });

  it('determina completa si tiene permiso de recibir asignación aunque vea propias', () => {
    assert.equal(
      vistaDetalle({
        INTERVENCIONES_VER: 'PROPIAS',
        INTERVENCIONES_RECIBIR_ASIGNACION: 'TODAS',
      }),
      'completa'
    );
  });

  it('determina simple si solo tiene editar propias y ver propias', () => {
    assert.equal(
      vistaDetalle({
        INTERVENCIONES_VER: 'PROPIAS',
        INTERVENCIONES_EDITAR: 'PROPIAS',
      }),
      'simple'
    );
  });
});

describe('FE-15: itemHistorial', () => {
  it('con estado_anterior null devuelve Reporte registrado', () => {
    const item = itemHistorial({
      estado_anterior: null,
      estado_nuevo: 'PENDIENTE',
      cambiado_en: '2026-10-31T10:00:00Z',
    });
    assert.equal(item.titulo, 'Reporte registrado');
    assert.equal(item.fecha, '2026-10-31T10:00:00Z');
    assert.equal(item.estado, 'PENDIENTE');
  });

  it('con estado nuevo EN_PROCESO devuelve En proceso', () => {
    const item = itemHistorial({
      estado_anterior: 'PENDIENTE',
      estado_nuevo: 'EN_PROCESO',
      cambiado_en: '2026-10-31T11:00:00Z',
    });
    assert.equal(item.titulo, 'En proceso');
    assert.equal(item.fecha, '2026-10-31T11:00:00Z');
    assert.equal(item.estado, 'EN_PROCESO');
  });

  it('con fecha_efectiva devuelve fecha_efectiva; sin ella, cambiado_en', () => {
    const conEfectiva = itemHistorial({
      estado_anterior: 'PENDIENTE',
      estado_nuevo: 'EN_PROCESO',
      cambiado_en: '2026-10-31T11:00:00Z',
      fecha_efectiva: '2026-10-31T10:45:00Z',
    });
    assert.equal(conEfectiva.fecha, '2026-10-31T10:45:00Z');

    const sinEfectiva = itemHistorial({
      estado_anterior: 'PENDIENTE',
      estado_nuevo: 'EN_PROCESO',
      cambiado_en: '2026-10-31T11:00:00Z',
      fecha_efectiva: null,
    });
    assert.equal(sinEfectiva.fecha, '2026-10-31T11:00:00Z');
  });
});

describe('FE-16: hayCambiosReporte', () => {
  it('mismos textos devuelve false', () => {
    assert.equal(
      hayCambiosReporte(
        { descripcion: 'Falla motor', observaciones: 'Revisar cable' },
        { descripcion: 'Falla motor', observaciones: 'Revisar cable' }
      ),
      false
    );
  });

  it('solo cambian los espacios de los extremos devuelve false', () => {
    assert.equal(
      hayCambiosReporte(
        { descripcion: 'Falla motor', observaciones: 'Revisar cable' },
        { descripcion: '  Falla motor  ', observaciones: ' Revisar cable\n' }
      ),
      false
    );
  });

  it('observaciones null contra "" devuelve false', () => {
    assert.equal(
      hayCambiosReporte(
        { descripcion: 'Falla motor', observaciones: null },
        { descripcion: 'Falla motor', observaciones: '' }
      ),
      false
    );
    assert.equal(
      hayCambiosReporte(
        { descripcion: 'Falla motor', observaciones: '' },
        { descripcion: 'Falla motor', observaciones: null }
      ),
      false
    );
  });

  it('descripción distinta devuelve true', () => {
    assert.equal(
      hayCambiosReporte(
        { descripcion: 'Falla motor', observaciones: 'Revisar cable' },
        { descripcion: 'Falla bomba', observaciones: 'Revisar cable' }
      ),
      true
    );
  });

  it('observaciones "algo" contra "" devuelve true', () => {
    assert.equal(
      hayCambiosReporte(
        { descripcion: 'Falla motor', observaciones: 'algo' },
        { descripcion: 'Falla motor', observaciones: '' }
      ),
      true
    );
    assert.equal(
      hayCambiosReporte(
        { descripcion: 'Falla motor', observaciones: '' },
        { descripcion: 'Falla motor', observaciones: 'algo' }
      ),
      true
    );
  });
});
