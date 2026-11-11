import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  codigoDesdeNombre,
  codigoValido,
  moverEnOrden,
  motivoNoDesactivableSector,
  motivoNoDesactivablePlanta,
  motivoNoDesactivableCatalogo,
} from './catalogos';

describe('FE-37: catalogos.ts', () => {
  it('codigoDesdeNombre', () => {
    assert.equal(codigoDesdeNombre('Herramienta menor'), 'HERRAMIENTA_MENOR');
    assert.equal(codigoDesdeNombre('Señal / Pañol'), 'SENAL_PANOL');
    assert.equal(codigoDesdeNombre('1ra línea'), 'N_1RA_LINEA');
    assert.equal(codigoDesdeNombre('A'.repeat(40)), 'A'.repeat(30));
    assert.equal(codigoDesdeNombre(''), '');
  });

  it('codigoValido', () => {
    assert.equal(codigoValido('ALTA'), true);
    assert.equal(codigoValido('alta'), false);
    assert.equal(codigoValido('1A'), false);
  });

  it('moverEnOrden: subir el segundo, bajar el primero, y extremos sin cambio', () => {
    const ids = [10, 20, 30];

    // Subir el segundo
    assert.deepEqual(moverEnOrden(ids, 20, -1), [20, 10, 30]);

    // Bajar el primero
    assert.deepEqual(moverEnOrden(ids, 10, 1), [20, 10, 30]);

    // Extremos sin cambio
    assert.deepEqual(moverEnOrden(ids, 10, -1), [10, 20, 30]);
    assert.deepEqual(moverEnOrden(ids, 30, 1), [10, 20, 30]);
  });

  it('motivoNoDesactivable…', () => {
    // Sector con 2 máquinas y 1 usuario
    const sec2m1u = motivoNoDesactivableSector({ maquinas_activas: 2, usuarios_activos: 1 });
    assert.equal(
      sec2m1u,
      'Tiene 2 máquinas activas y 1 usuario activo. Pasá las máquinas a otro sector o desactivalas, y quitales el sector a los usuarios, antes de desactivarlo.'
    );

    // Sector solo con 1 usuario
    const sec1u = motivoNoDesactivableSector({ maquinas_activas: 0, usuarios_activos: 1 });
    assert.equal(sec1u, 'Tiene 1 usuario activo. Quitales el sector a los usuarios antes de desactivarlo.');

    // Planta con 1 sector
    const pla1s = motivoNoDesactivablePlanta({ sectores_activos: 1 });
    assert.equal(pla1s, 'Tiene 1 sector activo. Pasalos a otra planta o desactivalos antes de desactivarla.');

    // Por omisión en uso: gana el texto de por omisión
    const catOmiEnUso = motivoNoDesactivableCatalogo(
      { por_omision: true, maquinas_activas: 3 },
      'criticidad'
    );
    assert.equal(catOmiEnUso, 'Es el valor por omisión. Marcá otro antes de desactivarlo.');

    // Sin nada: null
    assert.equal(motivoNoDesactivableSector({ maquinas_activas: 0, usuarios_activos: 0 }), null);
    assert.equal(motivoNoDesactivablePlanta({ sectores_activos: 0 }), null);
    assert.equal(motivoNoDesactivableCatalogo({ por_omision: false, maquinas_activas: 0 }, 'criticidad'), null);
  });
});

