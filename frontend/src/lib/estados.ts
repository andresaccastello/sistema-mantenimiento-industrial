/**
 * Tabla única de estados (sección 6 de docs/etapas/etapa-f0-base-frontend.md)
 * Lógica pura sin dependencias de React ni Mantine ni Tabler.
 */

export type EntidadEstado = 'intervencion' | 'maquina' | 'tarea_preventiva';

export interface InfoEstado {
  entidad: EntidadEstado;
  estado: string;
  texto: string;
  color: string;
  icono: string;
}

export const ESTADOS: readonly InfoEstado[] = [
  { entidad: 'intervencion', estado: 'PENDIENTE', texto: 'Pendiente', color: 'yellow', icono: 'IconClock' },
  { entidad: 'intervencion', estado: 'EN_PROCESO', texto: 'En proceso', color: 'blue', icono: 'IconTool' },
  { entidad: 'intervencion', estado: 'EN_ESPERA_REPUESTOS', texto: 'Esperando repuestos', color: 'violet', icono: 'IconPackage' },
  { entidad: 'intervencion', estado: 'FINALIZADA', texto: 'Finalizada', color: 'green', icono: 'IconCircleCheck' },
  { entidad: 'intervencion', estado: 'CANCELADA', texto: 'Cancelada', color: 'gray', icono: 'IconCircleX' },
  { entidad: 'maquina', estado: 'OPERATIVA', texto: 'Operativa', color: 'green', icono: 'IconCircleCheck' },
  { entidad: 'maquina', estado: 'DETENIDA', texto: 'Detenida', color: 'red', icono: 'IconAlertTriangle' },
  { entidad: 'maquina', estado: 'EN_MANTENIMIENTO', texto: 'En mantenimiento', color: 'blue', icono: 'IconTool' },
  { entidad: 'maquina', estado: 'FUERA_DE_SERVICIO', texto: 'Fuera de servicio', color: 'dark', icono: 'IconBan' },
] as const;

/**
 * Estados de una tarea preventiva (Etapa PV2, sección 2). Van aparte de ESTADOS, que
 * tiene solo los de intervención y máquina (FE-03); obtenerInfoEstado busca en las dos.
 */
export const ESTADOS_TAREA_PREVENTIVA: readonly InfoEstado[] = [
  { entidad: 'tarea_preventiva', estado: 'VENCIDA', texto: 'Vencida', color: 'red', icono: 'IconAlertTriangle' },
  { entidad: 'tarea_preventiva', estado: 'PROXIMA', texto: 'Próxima', color: 'orange', icono: 'IconClock' },
  { entidad: 'tarea_preventiva', estado: 'SIN_LECTURA', texto: 'Sin lectura', color: 'gray', icono: 'IconGaugeOff' },
  { entidad: 'tarea_preventiva', estado: 'EN_CURSO', texto: 'En curso', color: 'blue', icono: 'IconTool' },
  { entidad: 'tarea_preventiva', estado: 'AL_DIA', texto: 'Al día', color: 'green', icono: 'IconCircleCheck' },
  { entidad: 'tarea_preventiva', estado: 'INACTIVA', texto: 'Inactiva', color: 'gray', icono: 'IconBan' },
] as const;

/**
 * Obtiene la información visual de un estado para una entidad.
 * Si el estado no se encuentra, devuelve una configuración por defecto
 * con el código en gris, sin romper la pantalla.
 */
export function obtenerInfoEstado(entidad: EntidadEstado, estado: string): InfoEstado {
  const encontrado = [...ESTADOS, ...ESTADOS_TAREA_PREVENTIVA].find(
    (item) => item.entidad === entidad && item.estado === estado
  );

  if (encontrado) {
    return encontrado;
  }

  return {
    entidad,
    estado,
    texto: estado,
    color: 'gray',
    icono: 'IconQuestionMark',
  };
}
