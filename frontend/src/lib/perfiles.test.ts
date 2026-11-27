import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nombrePerfil } from './perfiles';

describe('FE-07: nombrePerfil', () => {
  it('formatea los 6 perfiles canónicos según la tabla', () => {
    assert.equal(nombrePerfil('ADMINISTRADOR'), 'Administrador');
    assert.equal(nombrePerfil('RESPONSABLE_MANTENIMIENTO'), 'Responsable de mantenimiento');
    assert.equal(nombrePerfil('OPERARIO'), 'Operario');
    assert.equal(nombrePerfil('CONSULTA'), 'Consulta');
    assert.equal(nombrePerfil('DIRECCION'), 'Dirección');
    assert.equal(nombrePerfil('I_D'), 'I+D');
  });

  it('formatea códigos desconocidos reemplazando guiones bajos y con inicial mayúscula', () => {
    assert.equal(nombrePerfil('JEFE_DE_PLANTA'), 'Jefe de planta');
    assert.equal(nombrePerfil('SUPERVISOR_TURNO_NOCHE'), 'Supervisor turno noche');
    assert.equal(nombrePerfil('AUDITOR'), 'Auditor');
  });

  it('devuelve cadena vacía si es null, undefined o texto vacío', () => {
    assert.equal(nombrePerfil(null), '');
    assert.equal(nombrePerfil(undefined), '');
    assert.equal(nombrePerfil(''), '');
    assert.equal(nombrePerfil('   '), '');
  });
});
