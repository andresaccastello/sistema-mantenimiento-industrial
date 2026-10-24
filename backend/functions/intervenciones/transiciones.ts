export type AccionTransicion =
  | 'INICIAR'
  | 'ESPERAR_REPUESTOS'
  | 'REANUDAR'
  | 'RESOLVER_AHORA'
  | 'FINALIZAR'
  | 'CANCELAR';

export type CodigoTransicion = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8';

export interface TransicionDef {
  accion: AccionTransicion;
  codigo: CodigoTransicion;
  desde: string;
  hacia: string;
  permiso: string;
  requiereActor: boolean;
  validaHabilitacion: boolean;
}

export const TRANSICIONES: TransicionDef[] = [
  {
    accion: 'INICIAR',
    codigo: 'T1',
    desde: 'PENDIENTE',
    hacia: 'EN_PROCESO',
    permiso: 'INTERVENCIONES_CAMBIAR_ESTADO',
    requiereActor: true,
    validaHabilitacion: true,
  },
  {
    accion: 'RESOLVER_AHORA',
    codigo: 'T2',
    desde: 'PENDIENTE',
    hacia: 'FINALIZADA',
    permiso: 'INTERVENCIONES_FINALIZAR',
    requiereActor: true,
    validaHabilitacion: true,
  },
  {
    accion: 'CANCELAR',
    codigo: 'T3',
    desde: 'PENDIENTE',
    hacia: 'CANCELADA',
    permiso: 'INTERVENCIONES_CANCELAR',
    requiereActor: false,
    validaHabilitacion: false,
  },
  {
    accion: 'ESPERAR_REPUESTOS',
    codigo: 'T4',
    desde: 'EN_PROCESO',
    hacia: 'EN_ESPERA_REPUESTOS',
    permiso: 'INTERVENCIONES_CAMBIAR_ESTADO',
    requiereActor: true,
    validaHabilitacion: false,
  },
  {
    accion: 'REANUDAR',
    codigo: 'T5',
    desde: 'EN_ESPERA_REPUESTOS',
    hacia: 'EN_PROCESO',
    permiso: 'INTERVENCIONES_CAMBIAR_ESTADO',
    requiereActor: true,
    validaHabilitacion: false,
  },
  {
    accion: 'FINALIZAR',
    codigo: 'T6',
    desde: 'EN_PROCESO',
    hacia: 'FINALIZADA',
    permiso: 'INTERVENCIONES_FINALIZAR',
    requiereActor: true,
    validaHabilitacion: false,
  },
  {
    accion: 'CANCELAR',
    codigo: 'T7',
    desde: 'EN_PROCESO',
    hacia: 'CANCELADA',
    permiso: 'INTERVENCIONES_CANCELAR',
    requiereActor: false,
    validaHabilitacion: false,
  },
  {
    accion: 'CANCELAR',
    codigo: 'T8',
    desde: 'EN_ESPERA_REPUESTOS',
    hacia: 'CANCELADA',
    permiso: 'INTERVENCIONES_CANCELAR',
    requiereActor: false,
    validaHabilitacion: false,
  },
];

export function transicionesDeAccion(accion: AccionTransicion): TransicionDef[] {
  return TRANSICIONES.filter((t) => t.accion === accion);
}

export function buscarTransicion(accion: AccionTransicion, estadoActual: string): TransicionDef | null {
  return TRANSICIONES.find((t) => t.accion === accion && t.desde === estadoActual) || null;
}
