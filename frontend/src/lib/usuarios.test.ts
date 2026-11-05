import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UsuarioListaItem } from '../api/tipos';
import {
  leerFiltrosUsuarios,
  escribirFiltrosUsuarios,
  filtrarUsuarios,
  hayFiltrosUsuarios,
  validarPasswordTemporal,
  validarMotivo,
  FILTROS_USUARIOS_POR_DEFECTO,
  FiltrosUsuarios,
} from './usuarios';

describe('FE-32: Filtros de usuarios y validaciones', () => {
  it('dirección vacía devuelve valores por omisión con estado en activos', () => {
    const f = leerFiltrosUsuarios(new URLSearchParams());
    assert.deepEqual(f, FILTROS_USUARIOS_POR_DEFECTO);
    assert.equal(f.estado, 'activos');
  });

  it('estado inválido da activos y perfil inválido da null', () => {
    const p = new URLSearchParams('estado=ROTO&perfil=abc');
    const f = leerFiltrosUsuarios(p);
    assert.equal(f.estado, 'activos');
    assert.equal(f.perfilId, null);
  });

  it('ida y vuelta con todos los campos da lo mismo y valores por omisión no se escriben', () => {
    const completos: FiltrosUsuarios = {
      texto: 'carlos',
      estado: 'inactivos',
      perfilId: 2,
      sectorId: 5,
    };
    const params = escribirFiltrosUsuarios(completos);
    const leidos = leerFiltrosUsuarios(params);
    assert.deepEqual(leidos, completos);

    const vacios = escribirFiltrosUsuarios(FILTROS_USUARIOS_POR_DEFECTO);
    assert.equal(Array.from(vacios.keys()).length, 0);
  });

  it('filtrarUsuarios con cinco usuarios de prueba', () => {
    const usuariosPrueba: UsuarioListaItem[] = [
      {
        id: 1,
        legajo: 'U001',
        nombre: 'Martín',
        apellido: 'Gomez',
        activo: true,
        ultimo_acceso_en: null,
        debe_cambiar_password: false,
        perfil: { id: 1, nombre: 'ADMINISTRADOR' },
        sectores: [{ id: 10, nombre: 'Taller' }],
      },
      {
        id: 2,
        legajo: 'U002',
        nombre: 'Ana',
        apellido: 'López',
        email: 'ana.lopez@empresa.com',
        activo: false,
        ultimo_acceso_en: null,
        debe_cambiar_password: false,
        perfil: { id: 2, nombre: 'OPERARIO' },
        sectores: [{ id: 20, nombre: 'Montaje' }],
      },
      {
        id: 3,
        legajo: 'LEG-123',
        nombre: 'Carlos',
        apellido: 'Perez',
        activo: true,
        ultimo_acceso_en: null,
        debe_cambiar_password: false,
        perfil: { id: 2, nombre: 'OPERARIO' },
        sectores: [{ id: 10, nombre: 'Taller' }],
      },
      {
        id: 4,
        legajo: 'U004',
        nombre: 'Lucía',
        apellido: 'Fernández',
        activo: true,
        ultimo_acceso_en: null,
        debe_cambiar_password: false,
        perfil: { id: 3, nombre: 'CONSULTA' },
        sectores: [],
      },
      {
        id: 5,
        legajo: 'U005',
        nombre: 'Roberto',
        apellido: 'Gómez',
        activo: false,
        ultimo_acceso_en: null,
        debe_cambiar_password: false,
        perfil: { id: 2, nombre: 'OPERARIO' },
        sectores: [{ id: 10, nombre: 'Taller' }],
      },
    ];

    // "gómez" encuentra "Gomez" (sin tildes, insensible a mayúsculas/minúsculas)
    const resGomez = filtrarUsuarios(usuariosPrueba, {
      ...FILTROS_USUARIOS_POR_DEFECTO,
      estado: 'todos',
      texto: 'gómez',
    });
    assert.equal(resGomez.length, 2);
    assert.deepEqual(resGomez.map((u) => u.id), [1, 5]);

    // El legajo también se busca
    const resLegajo = filtrarUsuarios(usuariosPrueba, {
      ...FILTROS_USUARIOS_POR_DEFECTO,
      estado: 'todos',
      texto: 'leg-123',
    });
    assert.equal(resLegajo.length, 1);
    assert.equal(resLegajo[0].id, 3);

    // El email también se busca (FE-32 ampliado)
    const resEmail = filtrarUsuarios(usuariosPrueba, {
      ...FILTROS_USUARIOS_POR_DEFECTO,
      estado: 'todos',
      texto: 'ana.lopez@empresa.com',
    });
    assert.equal(resEmail.length, 1);
    assert.equal(resEmail[0].id, 2);

    // Filtro por sector
    const resSector = filtrarUsuarios(usuariosPrueba, {
      ...FILTROS_USUARIOS_POR_DEFECTO,
      estado: 'todos',
      sectorId: 10,
    });
    assert.equal(resSector.length, 3);
    assert.deepEqual(resSector.map((u) => u.id), [1, 3, 5]);

    // inactivos deja solo los inactivos
    const resInactivos = filtrarUsuarios(usuariosPrueba, {
      ...FILTROS_USUARIOS_POR_DEFECTO,
      estado: 'inactivos',
    });
    assert.equal(resInactivos.length, 2);
    assert.deepEqual(resInactivos.map((u) => u.id), [2, 5]);

    // Se conserva el orden de entrada
    const resTodos = filtrarUsuarios(usuariosPrueba, {
      ...FILTROS_USUARIOS_POR_DEFECTO,
      estado: 'todos',
    });
    assert.deepEqual(resTodos.map((u) => u.id), [1, 2, 3, 4, 5]);
  });

  it('hayFiltrosUsuarios es false con valores por omisión y true si cambia alguno', () => {
    assert.equal(hayFiltrosUsuarios(FILTROS_USUARIOS_POR_DEFECTO), false);
    assert.equal(hayFiltrosUsuarios({ ...FILTROS_USUARIOS_POR_DEFECTO, texto: 'a' }), true);
    assert.equal(hayFiltrosUsuarios({ ...FILTROS_USUARIOS_POR_DEFECTO, estado: 'inactivos' }), true);
    assert.equal(hayFiltrosUsuarios({ ...FILTROS_USUARIOS_POR_DEFECTO, perfilId: 1 }), true);
    assert.equal(hayFiltrosUsuarios({ ...FILTROS_USUARIOS_POR_DEFECTO, sectorId: 2 }), true);
  });
});

describe('FE-33: validarPasswordTemporal y validarMotivo', () => {
  it('validarPasswordTemporal', () => {
    // 7 caracteres: error
    assert.ok(validarPasswordTemporal('1234567', 'legajo123') !== null);

    // Igual al legajo con otras mayúsculas o espacios: error
    assert.ok(validarPasswordTemporal('LEGAJO123', 'legajo123') !== null);
    assert.ok(validarPasswordTemporal('  legajo123  ', 'legajo123') !== null);
    assert.ok(validarPasswordTemporal('LEGAJO123', '  legajo123  ') !== null);

    // Válida: null
    assert.equal(validarPasswordTemporal('temporal123', 'legajo123'), null);
  });

  it('validarMotivo', () => {
    // "  abcd  ": error (menos de 5 caracteres sin contar espacios)
    assert.ok(validarMotivo('  abcd  ') !== null);

    // "abcde": null (5 caracteres)
    assert.equal(validarMotivo('abcde'), null);
  });
});

