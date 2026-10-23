export type AccionTransicion = 'INICIAR' | 'ESPERAR_REPUESTOS' | 'REANUDAR';

export interface TransicionDef {
  accion: AccionTransicion;
  codigo: 'T1' | 'T4' | 'T5';
  desde: string;
  hacia: string;
  permiso: string;
}

export const TRANSICIONES: TransicionDef[] = [
  {
    accion: 'INICIAR',
    codigo: 'T1',
    desde: 'PENDIENTE',
    hacia: 'EN_PROCESO',
    permiso: 'INTERVENCIONES_CAMBIAR_ESTADO',
  },
  {
    accion: 'ESPERAR_REPUESTOS',
    codigo: 'T4',
    desde: 'EN_PROCESO',
    hacia: 'EN_ESPERA_REPUESTOS',
    permiso: 'INTERVENCIONES_CAMBIAR_ESTADO',
  },
  {
    accion: 'REANUDAR',
    codigo: 'T5',
    desde: 'EN_ESPERA_REPUESTOS',
    hacia: 'EN_PROCESO',
    permiso: 'INTERVENCIONES_CAMBIAR_ESTADO',
  },
];

export function buscarTransicion(accion: AccionTransicion, estadoActual: string): TransicionDef | null {
  return TRANSICIONES.find((t) => t.accion === accion && t.desde === estadoActual) || null;
}

export function buscarTransicionPorAccion(accion: AccionTransicion): TransicionDef | null {
  return TRANSICIONES.find((t) => t.accion === accion) || null;
}

