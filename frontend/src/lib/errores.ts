/**
 * Errores de API, mensajes y reacciones (sección 4.1 y 7.4 de docs/etapas/etapa-f0-base-frontend.md)
 */

export interface MotivoError {
  campo?: string;
  mensaje?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly motivos?: MotivoError[];

  constructor(status: number, codigo: string, mensaje?: string, motivos?: MotivoError[]) {
    super(mensaje || codigo);
    this.name = 'ApiError';
    this.status = status;
    this.codigo = codigo;
    this.motivos = motivos;
  }
}

export type ReaccionError = 'cerrar_sesion' | 'cambiar_password' | 'mostrar';

/**
 * Devuelve qué acción debe tomar el frontend ante un error:
 * - NO_AUTENTICADO, SESION_INVALIDADA -> 'cerrar_sesion'
 * - CAMBIO_PASSWORD_REQUERIDO -> 'cambiar_password'
 * - cualquier otro (ej: CREDENCIALES_INVALIDAS) -> 'mostrar'
 */
export function reaccionError(error: unknown): ReaccionError {
  const codigo =
    error instanceof ApiError
      ? error.codigo
      : typeof error === 'object' && error !== null && 'codigo' in error
      ? String((error as { codigo: unknown }).codigo)
      : null;

  if (codigo === 'NO_AUTENTICADO' || codigo === 'SESION_INVALIDADA') {
    return 'cerrar_sesion';
  }

  if (codigo === 'CAMBIO_PASSWORD_REQUERIDO') {
    return 'cambiar_password';
  }

  return 'mostrar';
}

/**
 * Devuelve un mensaje claro y comprensible para el usuario.
 */
export function mensajeError(error: unknown): string {
  const codigo =
    error instanceof ApiError
      ? error.codigo
      : typeof error === 'object' && error !== null && 'codigo' in error
      ? String((error as { codigo: unknown }).codigo)
      : null;

  if (codigo === 'SIN_CONEXION') {
    return 'No se pudo conectar con el servidor.';
  }

  if (codigo === 'PERMISO_INSUFICIENTE') {
    return 'No tenés permiso para realizar esta acción.';
  }

  if (codigo === 'ESTADO_DESACTUALIZADO') {
    return 'Otra persona modificó esta intervención. Actualizá la pantalla.';
  }

  if (codigo === 'EDICION_NO_PERMITIDA') {
    return 'Ya no se puede editar: el reporte cambió de estado o ya tiene responsable.';
  }

  if (codigo === 'SIN_CAMBIOS') {
    return 'No hay cambios para guardar.';
  }

  if (codigo === 'ERROR_INTERNO') {
    return 'Ocurrió un error inesperado en el servidor.';
  }

  if (error instanceof ApiError && error.message && error.message !== error.codigo) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, unknown>;
    if (typeof errObj.error === 'string' && errObj.error.trim()) {
      return errObj.error;
    }
    if (typeof errObj.message === 'string' && errObj.message.trim()) {
      return errObj.message;
    }
  }

  return 'Ocurrió un error al procesar la solicitud.';
}
