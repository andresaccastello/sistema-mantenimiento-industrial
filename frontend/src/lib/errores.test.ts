import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, mensajeError, reaccionError, requiereRecargar } from './errores';

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

describe('FE-17: mensajeError', () => {
  it('EDICION_NO_PERMITIDA devuelve texto propio aunque el error traiga otro mensaje del backend', () => {
    const errorConMensaje = new ApiError(
      403,
      'EDICION_NO_PERMITIDA',
      'Con alcance PROPIAS solo puedes editar intervenciones creadas por ti...'
    );
    assert.equal(
      mensajeError(errorConMensaje),
      'Ya no se puede editar: el reporte cambió de estado o ya tiene responsable.'
    );

    const errorSinMensaje = new ApiError(403, 'EDICION_NO_PERMITIDA');
    assert.equal(
      mensajeError(errorSinMensaje),
      'Ya no se puede editar: el reporte cambió de estado o ya tiene responsable.'
    );
  });

  it('SIN_CAMBIOS devuelve texto propio aunque el error traiga otro mensaje del backend', () => {
    const errorConMensaje = new ApiError(
      400,
      'SIN_CAMBIOS',
      'Los valores enviados no presentan cambios respecto de los actuales'
    );
    assert.equal(
      mensajeError(errorConMensaje),
      'No hay cambios para guardar.'
    );

    const errorSinMensaje = new ApiError(400, 'SIN_CAMBIOS');
    assert.equal(
      mensajeError(errorSinMensaje),
      'No hay cambios para guardar.'
    );
  });
});

describe('FE-20: requiereRecargar y mensajeError', () => {
  it('requiereRecargar devuelve true para errores de intervención cambiada concurrentemente', () => {
    assert.equal(requiereRecargar(new ApiError(409, 'ESTADO_DESACTUALIZADO')), true);
    assert.equal(requiereRecargar(new ApiError(409, 'INTERVENCION_YA_ASIGNADA')), true);
    assert.equal(requiereRecargar(new ApiError(409, 'PERIODO_INVALIDO')), true);
  });

  it('requiereRecargar devuelve false para errores de validación o red', () => {
    assert.equal(requiereRecargar(new ApiError(422, 'MOTIVO_REQUERIDO')), false);
    assert.equal(requiereRecargar(new ApiError(422, 'FECHA_INCOHERENTE')), false);
    assert.equal(requiereRecargar(new ApiError(0, 'SIN_CONEXION')), false);
  });

  it('mensajeError devuelve texto oficial de la sección 3.4 aunque el error traiga otro mensaje', () => {
    const errAsignada = new ApiError(409, 'INTERVENCION_YA_ASIGNADA', 'Detalle técnico de Postgres');
    assert.equal(mensajeError(errAsignada), 'Otra persona ya tomó esta intervención.');

    const errEjecucion = new ApiError(422, 'EJECUCION_REQUERIDA', 'Backend raw execution message');
    assert.equal(mensajeError(errEjecucion), 'Indicá si lo hizo personal propio o un servicio externo.');

    const errRecuperacion = new ApiError(422, 'DECISION_RECUPERACION_REQUERIDA', 'Another message');
    assert.equal(mensajeError(errRecuperacion), 'Indicá si la máquina volvió a funcionar.');
  });
});
