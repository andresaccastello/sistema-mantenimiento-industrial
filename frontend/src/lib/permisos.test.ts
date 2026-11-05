import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PermisoCatalogo, PerfilDetalle, ExcepcionPermisoDetalle } from '../api/tipos';
import {
  etiquetaAlcance,
  grupoPermiso,
  filasPermisos,
  opcionesExcepcion,
  perfilAsignable,
  matrizPerfiles,
  GRUPOS_PERMISOS,
} from './permisos';

describe('FE-34: etiquetaAlcance, grupoPermiso y filasPermisos', () => {
  it('etiquetaAlcance: las cuatro opciones', () => {
    assert.equal(etiquetaAlcance('PROPIAS', true), 'Propias');
    assert.equal(etiquetaAlcance('SECTORES', true), 'Sus sectores');
    assert.equal(etiquetaAlcance('TODAS', true), 'Todas');
    assert.equal(etiquetaAlcance(null, false), 'Sí');
    assert.equal(etiquetaAlcance('TODAS', false), 'Sí');
  });

  it('grupoPermiso: cada prefijo y desconocido va a Otros', () => {
    assert.equal(grupoPermiso('INTERVENCIONES_VER'), 'Intervenciones');
    assert.equal(grupoPermiso('MAQUINAS_VER'), 'Máquinas');
    assert.equal(grupoPermiso('REPORTES_CONSULTAR'), 'Reportes');
    assert.equal(grupoPermiso('NOTIFICACIONES_FALLAS_RECIBIR'), 'Avisos');
    assert.equal(grupoPermiso('USUARIOS_GESTIONAR'), 'Usuarios y permisos');
    assert.equal(grupoPermiso('PERMISOS_GESTIONAR'), 'Usuarios y permisos');
    assert.equal(grupoPermiso('REPUESTOS_VER'), 'Módulos futuros');
    assert.equal(grupoPermiso('COSTOS_VER'), 'Módulos futuros');
    assert.equal(grupoPermiso('DOCUMENTOS_GESTIONAR'), 'Módulos futuros');
    assert.equal(grupoPermiso('PLANES_GESTIONAR'), 'Módulos futuros');
    assert.equal(grupoPermiso('ALGO_RARO'), 'Otros');
  });

  it('filasPermisos con un operario con excepciones y grupos en orden', () => {
    const catalogo: PermisoCatalogo[] = [
      { id: 1, codigo: 'MAQUINAS_VER', nombre: 'Ver máquinas', descripcion: null, usa_alcance: false },
      { id: 2, codigo: 'INTERVENCIONES_CREAR', nombre: 'Crear intervenciones', descripcion: null, usa_alcance: true },
      { id: 3, codigo: 'INTERVENCIONES_VER', nombre: 'Ver intervenciones', descripcion: null, usa_alcance: true },
    ];

    const permisosPerfilOperario = [
      { codigo: 'INTERVENCIONES_VER', alcance: 'PROPIAS' as const },
      { codigo: 'INTERVENCIONES_CREAR', alcance: 'PROPIAS' as const },
      { codigo: 'MAQUINAS_VER', alcance: null },
    ];

    const excepciones: ExcepcionPermisoDetalle[] = [
      {
        id: 101,
        codigo: 'INTERVENCIONES_VER',
        nombre: 'Ver intervenciones',
        efecto: 'CONCEDER',
        alcance: 'TODAS',
        motivo: 'Supervisión',
        creado_en: '2026-01-01T00:00:00Z',
        usa_alcance: true,
        otorgado_por: null,
      },
      {
        id: 102,
        codigo: 'INTERVENCIONES_CREAR',
        nombre: 'Crear intervenciones',
        efecto: 'DENEGAR',
        alcance: null,
        motivo: 'Sanción temporal',
        creado_en: '2026-01-01T00:00:00Z',
        usa_alcance: true,
        otorgado_por: null,
      },
    ];

    const efectivos = {
      INTERVENCIONES_VER: 'TODAS' as const,
      MAQUINAS_VER: 'TODAS' as const,
      // INTERVENCIONES_CREAR denegado no figura
    };

    const filas = filasPermisos(catalogo, permisosPerfilOperario, excepciones, efectivos);

    // Los grupos en el orden de la tabla: Intervenciones va antes que Máquinas
    assert.equal(filas[0].grupo, 'Intervenciones');
    assert.equal(filas[1].grupo, 'Intervenciones');
    assert.equal(filas[2].grupo, 'Máquinas');

    // Fila INTERVENCIONES_VER
    const filaVer = filas.find((f) => f.permiso.codigo === 'INTERVENCIONES_VER')!;
    assert.ok(filaVer);
    assert.equal(filaVer.porPerfil, 'PROPIAS');
    assert.equal(filaVer.excepcion?.efecto, 'CONCEDER');
    assert.equal(filaVer.excepcion?.alcance, 'TODAS');
    assert.equal(filaVer.resultado, 'TODAS');

    // Fila INTERVENCIONES_CREAR
    const filaCrear = filas.find((f) => f.permiso.codigo === 'INTERVENCIONES_CREAR')!;
    assert.ok(filaCrear);
    assert.equal(filaCrear.porPerfil, 'PROPIAS');
    assert.equal(filaCrear.excepcion?.efecto, 'DENEGAR');
    assert.equal(filaCrear.resultado, null);
  });
});

describe('FE-35: opcionesExcepcion y perfilAsignable', () => {
  it('opcionesExcepcion', () => {
    const permVer: PermisoCatalogo = {
      id: 1,
      codigo: 'INTERVENCIONES_VER',
      nombre: 'Ver intervenciones',
      descripcion: null,
      usa_alcance: true,
    };
    const permSinAlcance: PermisoCatalogo = {
      id: 2,
      codigo: 'MAQUINAS_GESTIONAR',
      nombre: 'Gestionar máquinas',
      descripcion: null,
      usa_alcance: false,
    };

    // Actor con INTERVENCIONES_VER en SECTORES: gestionable, con ['PROPIAS', 'SECTORES']
    const opcSectores = opcionesExcepcion(permVer, { INTERVENCIONES_VER: 'SECTORES' });
    assert.equal(opcSectores.gestionable, true);
    assert.deepEqual(opcSectores.alcances, ['PROPIAS', 'SECTORES']);

    // Permiso que no tiene: no gestionable
    const opcNoTiene = opcionesExcepcion(permVer, {});
    assert.equal(opcNoTiene.gestionable, false);
    assert.deepEqual(opcNoTiene.alcances, []);

    // Permiso sin alcance: alcances vacíos
    const opcSinAlc = opcionesExcepcion(permSinAlcance, { MAQUINAS_GESTIONAR: 'TODAS' });
    assert.equal(opcSinAlc.gestionable, true);
    assert.deepEqual(opcSinAlc.alcances, []);
  });

  it('perfilAsignable', () => {
    const adminPerfilPermisos = [
      { codigo: 'USUARIOS_GESTIONAR', alcance: null },
      { codigo: 'PERMISOS_GESTIONAR', alcance: null },
      { codigo: 'INTERVENCIONES_VER', alcance: 'TODAS' as const },
    ];
    const operarioPerfilPermisos = [
      { codigo: 'INTERVENCIONES_VER', alcance: 'PROPIAS' as const },
    ];
    const perfilConSectores = [
      { codigo: 'INTERVENCIONES_VER', alcance: 'SECTORES' as const },
    ];

    const actorSinPermisosGestionar = {
      USUARIOS_GESTIONAR: 'TODAS',
      INTERVENCIONES_VER: 'TODAS',
    };
    const actorAdmin = {
      USUARIOS_GESTIONAR: 'TODAS',
      PERMISOS_GESTIONAR: 'TODAS',
      INTERVENCIONES_VER: 'TODAS',
    };
    const actorConPropias = {
      INTERVENCIONES_VER: 'PROPIAS',
    };

    // Administrador para actor sin PERMISOS_GESTIONAR: false
    assert.equal(perfilAsignable(adminPerfilPermisos, actorSinPermisosGestionar), false);

    // Operario para el administrador: true
    assert.equal(perfilAsignable(operarioPerfilPermisos, actorAdmin), true);

    // Perfil con SECTORES para actor con PROPIAS: false
    assert.equal(perfilAsignable(perfilConSectores, actorConPropias), false);
  });
});

describe('FE-38: matrizPerfiles', () => {
  it('con dos perfiles y tres permisos muestra celdas y grupos en orden', () => {
    const catalogo: PermisoCatalogo[] = [
      { id: 1, codigo: 'INTERVENCIONES_VER', nombre: 'Ver intervenciones', descripcion: 'Desc', usa_alcance: true },
      { id: 2, codigo: 'MAQUINAS_GESTIONAR', nombre: 'Gestionar máquinas', descripcion: 'Desc', usa_alcance: false },
      { id: 3, codigo: 'REPORTES_CONSULTAR', nombre: 'Consultar reportes', descripcion: 'Desc', usa_alcance: true },
    ];

    const perfiles: PerfilDetalle[] = [
      {
        id: 1,
        nombre: 'ADMINISTRADOR',
        descripcion: null,
        activo: true,
        usuarios_activos: 2,
        permisos: [
          { codigo: 'INTERVENCIONES_VER', nombre: 'Ver intervenciones', alcance: 'TODAS' },
          { codigo: 'MAQUINAS_GESTIONAR', nombre: 'Gestionar máquinas', alcance: null },
        ],
      },
      {
        id: 2,
        nombre: 'OPERARIO',
        descripcion: null,
        activo: true,
        usuarios_activos: 10,
        permisos: [
          { codigo: 'INTERVENCIONES_VER', nombre: 'Ver intervenciones', alcance: 'PROPIAS' },
        ],
      },
    ];

    const matriz = matrizPerfiles(perfiles, catalogo);

    // Verificar orden de grupos: Intervenciones, Máquinas, Reportes
    assert.equal(matriz[0].permiso.codigo, 'INTERVENCIONES_VER');
    assert.equal(matriz[1].permiso.codigo, 'MAQUINAS_GESTIONAR');
    assert.equal(matriz[2].permiso.codigo, 'REPORTES_CONSULTAR');

    // Fila 0: INTERVENCIONES_VER
    // Perfil 1 (Admin) -> "Todas"
    assert.equal(matriz[0].celdas[1], 'Todas');
    // Perfil 2 (Operario) -> "Propias"
    assert.equal(matriz[0].celdas[2], 'Propias');

    // Fila 1: MAQUINAS_GESTIONAR (sin alcance)
    // Perfil 1 (Admin) -> "Sí"
    assert.equal(matriz[1].celdas[1], 'Sí');
    // Perfil 2 (Operario) -> "—"
    assert.equal(matriz[1].celdas[2], '—');

    // Fila 2: REPORTES_CONSULTAR
    // Perfil 1 -> "—"
    assert.equal(matriz[2].celdas[1], '—');
    // Perfil 2 -> "—"
    assert.equal(matriz[2].celdas[2], '—');
  });
});

