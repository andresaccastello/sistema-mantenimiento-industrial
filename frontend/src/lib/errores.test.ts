import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, mensajeError, reaccionError } from './errores';

describe('FE-06: reaccionError y mensajeError', () => {
  it('NO_AUTENTICADO lleva a cerrar_sesion', () => {
    const error = new ApiError(401, 'NO_AUTENTICADO', 'No autenticado');
    assert.equal(reaccionError(error), 'cerrar_sesion');
  });

  it('SESION_INVALIDADA lleva a cerrar_sesion', () => {
    const error = new ApiError(401, 'SESION_INVALIDADA', 'Sesión terminada');
    assert.equal(reaccionError(error), 'cerrar_sesion');
  });

  it('CAMBIO_PASSWORD_REQUERIDO lleva a cambiar_password', () => {
    const error = new ApiError(403, 'CAMBIO_PASSWORD_REQUERIDO', 'Debe cambiar contraseña');
    assert.equal(reaccionError(error), 'cambiar_password');
  });

  it('CREDENCIALES_INVALIDAS (401) lleva a mostrar sin cerrar sesión', () => {
    const error = new ApiError(401, 'CREDENCIALES_INVALIDAS', 'Legajo o contraseña incorrectos');
    assert.equal(reaccionError(error), 'mostrar');
    assert.equal(mensajeError(error), 'Legajo o contraseña incorrectos');
  });

  it('SIN_CONEXION devuelve su mensaje propio', () => {
    const error = new ApiError(0, 'SIN_CONEXION');
    assert.equal(reaccionError(error), 'mostrar');
    assert.equal(mensajeError(error), 'No se pudo conectar con el servidor.');
  });

  it('mensajes propios para PERMISO_INSUFICIENTE, ESTADO_DESACTUALIZADO y ERROR_INTERNO', () => {
    assert.equal(
      mensajeError(new ApiError(403, 'PERMISO_INSUFICIENTE')),
      'No tenés permiso para realizar esta acción.'
    );
    assert.equal(
      mensajeError(new ApiError(409, 'ESTADO_DESACTUALIZADO')),
      'Otra persona modificó esta intervención. Actualizá la pantalla.'
    );
    assert.equal(
      mensajeError(new ApiError(500, 'ERROR_INTERNO')),
      'Ocurrió un error inesperado en el servidor.'
    );
  });
});
