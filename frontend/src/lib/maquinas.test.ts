import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarTexto,
  etiquetaMaquina,
  coincideMaquina,
  agruparMaquinas,
  textoFallasAbiertas,
  accionesMaquina,
  motivoNoDesactivable,
  rangoUltimosDias,
} from './maquinas.js';

describe('FE-12: normalizarTexto, etiquetaMaquina y coincideMaquina', () => {
  it('normalizarTexto quita tildes, minúsculas y recorta espacios', () => {
    assert.equal(normalizarTexto('Cámara'), 'camara');
  });

  it('etiquetaMaquina formatea con y sin código', () => {
    assert.equal(etiquetaMaquina({ codigo: 'M-012', nombre: 'Torno CNC' }), 'M-012 · Torno CNC');
    assert.equal(etiquetaMaquina({ codigo: null, nombre: 'Torno CNC' }), 'Torno CNC');
  });

  it('coincideMaquina busca por nombre y código sin importar tildes ni mayúsculas', () => {
    const torno = { codigo: 'M-012', nombre: 'Torno CNC' };
    const camara = { codigo: null, nombre: 'Cámara de pintura' };

    assert.equal(coincideMaquina(torno, 'torno'), true);
    assert.equal(coincideMaquina(torno, 'TÓRNO'), true);
    assert.equal(coincideMaquina(torno, '012'), true);
    assert.equal(coincideMaquina(camara, 'camara'), true);
    assert.equal(coincideMaquina(torno, 'fresa'), false);
    assert.equal(coincideMaquina(torno, ''), true);
    assert.equal(coincideMaquina(camara, ''), true);
  });
});

describe('FE-13: agruparMaquinas', () => {
  it('agrupa por sector del usuario y ordena por nombre', () => {
    const maquinas = [
      { id: 1, nombre: 'Z-Torno', sector: { id: 1 } },
      { id: 2, nombre: 'A-Fresadora', sector: { id: 2 } },
      { id: 3, nombre: 'A-Prensa', sector: { id: 1 } },
      { id: 4, nombre: 'B-Cortadora', sector: { id: 3 } },
    ];

    const res = agruparMaquinas(maquinas, [1]);
    assert.equal(res.propias.length, 2);
    assert.equal(res.otras.length, 2);
    assert.deepEqual(
      res.propias.map((m) => m.nombre),
      ['A-Prensa', 'Z-Torno']
    );
    assert.deepEqual(
      res.otras.map((m) => m.nombre),
      ['A-Fresadora', 'B-Cortadora']
    );

    const sinSectores = agruparMaquinas(maquinas, []);
    assert.equal(sinSectores.propias.length, 0);
    assert.equal(sinSectores.otras.length, 4);
  });
});

describe('FE-14: textoFallasAbiertas', () => {
  it('devuelve null si es 0 o negativo, y el texto correspondiente para 1 o más', () => {
    assert.equal(textoFallasAbiertas(0), null);
    assert.equal(textoFallasAbiertas(-1), null);
    assert.equal(textoFallasAbiertas(1), 'Esta máquina ya tiene 1 falla abierta.');
    assert.equal(textoFallasAbiertas(3), 'Esta máquina ya tiene 3 fallas abiertas.');
  });
});

describe('FE-30: accionesMaquina y motivoNoDesactivable', () => {
  const permisosResponsable = {
    INTERVENCIONES_VER: 'TODAS',
    INTERVENCIONES_CREAR: 'TODAS',
    INTERVENCIONES_CONFIRMAR_RECUPERACION: 'TODAS',
    MAQUINAS_CAMBIAR_ESTADO: 'TODAS',
  };

  const permisosAdmin = {
    INTERVENCIONES_VER: 'TODAS',
    INTERVENCIONES_CREAR: 'TODAS',
    INTERVENCIONES_CONFIRMAR_RECUPERACION: 'TODAS',
    MAQUINAS_CAMBIAR_ESTADO: 'TODAS',
    MAQUINAS_GESTIONAR: 'TODAS',
  };

  const permisosOperario = {
    INTERVENCIONES_VER: 'PROPIAS',
    INTERVENCIONES_CREAR: 'TODAS',
  };

  it('RESPONSABLE con máquina activa detenida y 1 detención', () => {
    const res = accionesMaquina(
      { activo: true, estado: 'DETENIDA' },
      permisosResponsable,
      1
    );
    assert.deepEqual(res.todas, [
      'CONFIRMAR_RECUPERACION',
      'REPORTAR_FALLA',
      'FUERA_DE_SERVICIO',
    ]);
    assert.equal(res.principal, 'CONFIRMAR_RECUPERACION');
    assert.deepEqual(res.botones, ['REPORTAR_FALLA', 'FUERA_DE_SERVICIO']);
    assert.deepEqual(res.menu, []);
  });

  it('ADMINISTRADOR con máquina activa fuera de servicio sin detenciones', () => {
    const res = accionesMaquina(
      { activo: true, estado: 'FUERA_DE_SERVICIO' },
      permisosAdmin,
      0
    );
    assert.deepEqual(res.todas, [
      'REPORTAR_FALLA',
      'VOLVER_A_SERVICIO',
      'EDITAR',
      'DESACTIVAR',
    ]);
    assert.equal(res.principal, 'REPORTAR_FALLA');
    assert.deepEqual(res.botones, ['VOLVER_A_SERVICIO', 'EDITAR']);
    assert.deepEqual(res.menu, ['DESACTIVAR']);
  });

  it('máquina desactivada muestra REACTIVAR y no REPORTAR_FALLA', () => {
    const res = accionesMaquina(
      { activo: false, estado: 'OPERATIVA' },
      permisosAdmin,
      0
    );
    assert.ok(res.todas.includes('REACTIVAR'));
    assert.ok(!res.todas.includes('REPORTAR_FALLA'));
    assert.ok(!res.todas.includes('DESACTIVAR'));
    assert.equal(res.principal, null);
  });

  it('OPERARIO con máquina activa solo ve REPORTAR_FALLA', () => {
    const res = accionesMaquina(
      { activo: true, estado: 'OPERATIVA' },
      permisosOperario,
      0
    );
    assert.deepEqual(res.todas, ['REPORTAR_FALLA']);
    assert.equal(res.principal, 'REPORTAR_FALLA');
  });

  it('motivoNoDesactivable según intervenciones abiertas y detenciones', () => {
    assert.equal(
      motivoNoDesactivable({ intervenciones_abiertas: 2 }, 0),
      'Tiene 2 intervenciones abiertas. Cerralas o cancelalas antes de desactivarla.'
    );
    assert.equal(
      motivoNoDesactivable({ intervenciones_abiertas: 1 }, 0),
      'Tiene 1 intervención abierta. Cerralas o cancelalas antes de desactivarla.'
    );
    assert.equal(
      motivoNoDesactivable({ intervenciones_abiertas: 0 }, 1),
      'Tiene detenciones sin confirmar. Confirmá que volvió a funcionar antes de desactivarla.'
    );
    assert.equal(motivoNoDesactivable({ intervenciones_abiertas: 0 }, 0), null);
  });
});

describe('FE-31: rangoUltimosDias', () => {
  it('calcula 30 días contando hoy y cruza bien el cambio de mes', () => {
    const r = rangoUltimosDias(30, new Date(2026, 10, 3, 15, 0));
    assert.deepEqual(r, {
      desde: '2026-10-05',
      hasta: '2026-11-03',
    });
  });
});
