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

const MENSAJES_POR_CODIGO: Record<string, string> = {
  SIN_CONEXION: 'No se pudo conectar con el servidor.',
  PERMISO_INSUFICIENTE: 'No tenés permiso para realizar esta acción.',
  ESTADO_DESACTUALIZADO: 'Otra persona modificó esta intervención. Actualizá la pantalla.',
  EDICION_NO_PERMITIDA: 'Ya no se puede editar: el reporte cambió de estado o ya tiene responsable.',
  SIN_CAMBIOS: 'No hay cambios para guardar.',
  ERROR_INTERNO: 'Ocurrió un error inesperado en el servidor.',
  TRANSICION_NO_PERMITIDA: 'Esta acción ya no está disponible para esta intervención.',
  INTERVENCION_YA_ASIGNADA: 'Otra persona ya tomó esta intervención.',
  RESPONSABLE_SIN_CAMBIOS: 'Esa persona ya es la responsable.',
  RESPONSABLE_NO_HABILITADO: 'Esa persona no puede ser responsable de intervenciones.',
  RESPONSABLE_SIN_VISIBILIDAD: 'Esa persona no tiene acceso al sector de esta máquina.',
  RESPONSABLE_REQUERIDO: 'La intervención no tiene responsable y no podés asignártela.',
  NO_ES_RESPONSABLE: 'Solo el responsable, o quien asigna los trabajos, puede hacer esto.',
  DESASIGNACION_NO_PERMITIDA: 'El responsable solo se puede quitar mientras está pendiente. Después se puede reasignar.',
  MOTIVO_REQUERIDO: 'Indicá el motivo.',
  OBSERVACION_REQUERIDA: 'Completá la observación (al menos 5 caracteres).',
  TRABAJO_REALIZADO_REQUERIDO: 'Describí el trabajo realizado (al menos 5 caracteres).',
  EJECUCION_REQUERIDA: 'Indicá si lo hizo personal propio o un servicio externo.',
  DECISION_RECUPERACION_REQUERIDA: 'Indicá si la máquina volvió a funcionar.',
  DECISION_DETENCION_REQUERIDA: 'Indicá si la máquina volvió a detenerse.',
  CONFIRMACION_NO_PERMITIDA: 'No tenés permiso para confirmar que la máquina volvió a funcionar.',
  FECHA_INCOHERENTE: 'La fecha y hora no encaja con las anteriores de esta intervención, o es posterior a este momento.',
  DETENCION_YA_ABIERTA: 'Esta intervención ya tiene una detención abierta.',
  ELIMINACION_NO_PERMITIDA: 'No se puede eliminar: la intervención ya tiene actividad registrada.',
  PERIODO_INVALIDO: 'Esa detención ya se cerró o no se puede confirmar.',
  INTERVENCION_NO_ENCONTRADA: 'No encontramos esta intervención.',
};

const CODIGOS_RECARGA = new Set([
  'ESTADO_DESACTUALIZADO',
  'TRANSICION_NO_PERMITIDA',
  'INTERVENCION_YA_ASIGNADA',
  'EDICION_NO_PERMITIDA',
  'DESASIGNACION_NO_PERMITIDA',
  'NO_ES_RESPONSABLE',
  'DETENCION_YA_ABIERTA',
  'PERIODO_INVALIDO',
  'ELIMINACION_NO_PERMITIDA',
  'INTERVENCION_NO_ENCONTRADA',
]);

/**
 * Devuelve true si el código de error indica que la intervención cambió concurrentemente
 * y requiere recargar los datos.
 */
export function requiereRecargar(error: unknown): boolean {
  const codigo =
    error instanceof ApiError
      ? error.codigo
      : typeof error === 'object' && error !== null && 'codigo' in error
      ? String((error as { codigo: unknown }).codigo)
      : null;

  return Boolean(codigo && CODIGOS_RECARGA.has(codigo));
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

  if (codigo && MENSAJES_POR_CODIGO[codigo]) {
    return MENSAJES_POR_CODIGO[codigo];
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
