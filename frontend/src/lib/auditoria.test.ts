import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PermisoCatalogo } from '../api/tipos';
import { textoAuditoria, AuditoriaReferencias } from './auditoria';

describe('FE-36: textoAuditoria', () => {
  const referencias: AuditoriaReferencias = {
    perfiles: {
      '1': 'ADMINISTRADOR',
      '2': 'OPERARIO',
    },
    sectores: {
      '10': 'Taller',
      '20': 'Montaje',
    },
  };

  const catalogo: PermisoCatalogo[] = [
    { id: 1, codigo: 'INTERVENCIONES_VER', nombre: 'Ver intervenciones', descripcion: null, usa_alcance: true },
    { id: 2, codigo: 'MAQUINAS_GESTIONAR', nombre: 'Gestionar máquinas', descripcion: null, usa_alcance: false },
  ];

  it('las once acciones con sus títulos y detalles', () => {
    // 1. USUARIO_CREADO
    const t1 = textoAuditoria(
      { accion: 'USUARIO_CREADO', detalle: { perfil_id: 1, sectores: [10, 20] } },
      referencias,
      catalogo
    );
    assert.equal(t1.titulo, 'Alta del usuario');
    assert.equal(t1.detalle, 'Perfil Administrador. Sectores: Taller, Montaje.');

    // 2. USUARIO_MODIFICADO
    const t2 = textoAuditoria(
      {
        accion: 'USUARIO_MODIFICADO',
        detalle: { anterior: { nombre: 'Juan', apellido: 'Perez' }, nuevo: { nombre: 'Juan Carlos', apellido: 'Perez' } },
      },
      referencias,
      catalogo
    );
    assert.equal(t2.titulo, 'Datos cambiados');
    assert.equal(t2.detalle, 'Juan Perez → Juan Carlos Perez');

    // 3. PERFIL_CAMBIADO
    const t3 = textoAuditoria(
      { accion: 'PERFIL_CAMBIADO', detalle: { anterior: 2, nuevo: 1 } },
      referencias,
      catalogo
    );
    assert.equal(t3.titulo, 'Perfil cambiado');
    assert.equal(t3.detalle, 'Operario → Administrador');

    // 4. SECTORES_CAMBIADOS
    const t4 = textoAuditoria(
      { accion: 'SECTORES_CAMBIADOS', detalle: { anterior: [], nuevo: [10] } },
      referencias,
      catalogo
    );
    assert.equal(t4.titulo, 'Sectores cambiados');
    assert.equal(t4.detalle, 'ninguno → Taller');

    // 5. USUARIO_DESACTIVADO
    const t5 = textoAuditoria(
      { accion: 'USUARIO_DESACTIVADO', detalle: { motivo: 'Baja de la empresa' } },
      referencias,
      catalogo
    );
    assert.equal(t5.titulo, 'Usuario desactivado');
    assert.equal(t5.detalle, 'Motivo: Baja de la empresa.');

    // 6. USUARIO_REACTIVADO
    const t6 = textoAuditoria(
      { accion: 'USUARIO_REACTIVADO', detalle: { motivo: 'Reincorporación' } },
      referencias,
      catalogo
    );
    assert.equal(t6.titulo, 'Usuario reactivado');
    assert.equal(t6.detalle, 'Motivo: Reincorporación.');

    // 7. PASSWORD_RESTABLECIDA
    const t7 = textoAuditoria({ accion: 'PASSWORD_RESTABLECIDA', detalle: {} }, referencias, catalogo);
    assert.equal(t7.titulo, 'Contraseña restablecida');
    assert.equal(t7.detalle, '');

    // 8. PASSWORD_CAMBIADA
    const t8 = textoAuditoria({ accion: 'PASSWORD_CAMBIADA', detalle: {} }, referencias, catalogo);
    assert.equal(t8.titulo, 'Cambió su contraseña');
    assert.equal(t8.detalle, '');

    // 9. EXCEPCION_CREADA
    const t9 = textoAuditoria(
      {
        accion: 'EXCEPCION_CREADA',
        detalle: { codigo: 'INTERVENCIONES_VER', efecto: 'CONCEDER', alcance: 'TODAS', motivo: 'Guardia' },
      },
      referencias,
      catalogo
    );
    assert.equal(t9.titulo, 'Excepción agregada');
    assert.equal(t9.detalle, 'Ver intervenciones: Concede, Todas. Motivo: Guardia.');

    // 10. EXCEPCION_MODIFICADA
    const t10 = textoAuditoria(
      {
        accion: 'EXCEPCION_MODIFICADA',
        detalle: {
          codigo: 'INTERVENCIONES_VER',
          anterior: { efecto: 'CONCEDER', alcance: 'PROPIAS' },
          efecto: 'DENEGAR',
          motivo: 'Revocación',
        },
      },
      referencias,
      catalogo
    );
    assert.equal(t10.titulo, 'Excepción cambiada');
    assert.equal(t10.detalle, 'Ver intervenciones: Concede, Propias → Deniega. Motivo: Revocación.');

    // 11. EXCEPCION_ELIMINADA
    const t11 = textoAuditoria(
      {
        accion: 'EXCEPCION_ELIMINADA',
        detalle: {
          codigo: 'MAQUINAS_GESTIONAR',
          anterior: { efecto: 'CONCEDER' },
          motivo: 'Fin de suplencia',
        },
      },
      referencias,
      catalogo
    );
    assert.equal(t11.titulo, 'Excepción quitada');
    assert.equal(t11.detalle, 'Gestionar máquinas: era Concede. Motivo: Fin de suplencia.');
  });

  it('casos borde', () => {
    // Un sector que falta en referencias: "Sector 12"
    const tSecFalta = textoAuditoria(
      { accion: 'SECTORES_CAMBIADOS', detalle: { anterior: [10], nuevo: [12] } },
      referencias,
      catalogo
    );
    assert.equal(tSecFalta.detalle, 'Taller → Sector 12');

    // Un detalle que no es objeto: detalle vacío
    const tNull = textoAuditoria({ accion: 'USUARIO_CREADO', detalle: null }, referencias, catalogo);
    assert.equal(tNull.detalle, '');
    const tString = textoAuditoria({ accion: 'USUARIO_CREADO', detalle: 'string' }, referencias, catalogo);
    assert.equal(tString.detalle, '');

    // Una acción desconocida: su código como título
    const tDesconocida = textoAuditoria({ accion: 'OTRA_ACCION', detalle: {} }, referencias, catalogo);
    assert.equal(tDesconocida.titulo, 'OTRA_ACCION');
    assert.equal(tDesconocida.detalle, '');
  });

  it('plurales: desactivado con 1 y con 2 intervenciones abiertas', () => {
    const t1 = textoAuditoria(
      { accion: 'USUARIO_DESACTIVADO', detalle: { motivo: 'Licencia', intervenciones_abiertas_como_responsable: 1 } },
      referencias,
      catalogo
    );
    assert.equal(t1.detalle, 'Motivo: Licencia. Era responsable de 1 intervención abierta.');

    const t2 = textoAuditoria(
      { accion: 'USUARIO_DESACTIVADO', detalle: { motivo: 'Licencia', intervenciones_abiertas_como_responsable: 2 } },
      referencias,
      catalogo
    );
    assert.equal(t2.detalle, 'Motivo: Licencia. Era responsable de 2 intervenciones abiertas.');
  });

  it('no agrega punto si el motivo ya termina en punto, signo de exclamación o interrogación', () => {
    // Termina en punto
    const tPunto = textoAuditoria(
      { accion: 'USUARIO_DESACTIVADO', detalle: { motivo: 'Volvió el responsable.' } },
      referencias,
      catalogo
    );
    assert.equal(tPunto.detalle, 'Motivo: Volvió el responsable.');

    // Termina en signo de exclamación
    const tExclamacion = textoAuditoria(
      { accion: 'USUARIO_REACTIVADO', detalle: { motivo: '¡Reincorporado!' } },
      referencias,
      catalogo
    );
    assert.equal(tExclamacion.detalle, 'Motivo: ¡Reincorporado!');

    // Termina en signo de interrogación
    const tPregunta = textoAuditoria(
      {
        accion: 'EXCEPCION_ELIMINADA',
        detalle: { codigo: 'MAQUINAS_GESTIONAR', anterior: { efecto: 'CONCEDER' }, motivo: '¿Fin de período?' },
      },
      referencias,
      catalogo
    );
    assert.equal(tPregunta.detalle, 'Gestionar máquinas: era Concede. Motivo: ¿Fin de período?');
  });
});

