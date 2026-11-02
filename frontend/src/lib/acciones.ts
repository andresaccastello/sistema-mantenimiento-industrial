/**
 * Acciones sobre intervenciones (sección 4.1 de docs/etapas/etapa-f2-intervenciones.md)
 */

export type CodigoAccion =
  | 'INICIAR'
  | 'REANUDAR'
  | 'FINALIZAR'
  | 'TOMAR'
  | 'ASIGNAR'
  | 'ESPERAR_REPUESTOS'
  | 'RESOLVER_AHORA'
  | 'REABRIR'
  | 'DESASIGNAR'
  | 'REGISTRAR_DETENCION'
  | 'EDITAR'
  | 'CANCELAR'
  | 'ELIMINAR';

export type LugarAccion = 'principal' | 'visible' | 'menu';

export interface AccionDef {
  codigo: CodigoAccion;
  etiqueta: string;
  lugar: LugarAccion;
  avisoExito: string;
  esPeligrosa?: boolean;
}

export const ACCIONES: AccionDef[] = [
  { codigo: 'INICIAR', etiqueta: 'Iniciar trabajo', lugar: 'principal', avisoExito: 'Trabajo iniciado.' },
  { codigo: 'REANUDAR', etiqueta: 'Reanudar', lugar: 'principal', avisoExito: 'Trabajo reanudado.' },
  { codigo: 'FINALIZAR', etiqueta: 'Finalizar', lugar: 'principal', avisoExito: 'Intervención finalizada.' },
  { codigo: 'TOMAR', etiqueta: 'Tomar', lugar: 'visible', avisoExito: 'Tomaste la intervención.' },
  { codigo: 'ASIGNAR', etiqueta: 'Asignar', lugar: 'visible', avisoExito: 'Responsable asignado.' },
  { codigo: 'ESPERAR_REPUESTOS', etiqueta: 'Esperar repuestos', lugar: 'visible', avisoExito: 'Quedó esperando repuestos.' },
  { codigo: 'RESOLVER_AHORA', etiqueta: 'Registrar como resuelta', lugar: 'visible', avisoExito: 'Intervención registrada como resuelta.' },
  { codigo: 'REABRIR', etiqueta: 'Reabrir', lugar: 'visible', avisoExito: 'Intervención reabierta.' },
  { codigo: 'DESASIGNAR', etiqueta: 'Quitar responsable', lugar: 'menu', avisoExito: 'Se quitó el responsable.' },
  { codigo: 'REGISTRAR_DETENCION', etiqueta: 'Registrar detención', lugar: 'menu', avisoExito: 'Detención registrada.' },
  { codigo: 'EDITAR', etiqueta: 'Editar', lugar: 'menu', avisoExito: 'Cambios guardados.' },
  { codigo: 'CANCELAR', etiqueta: 'Cancelar intervención', lugar: 'menu', avisoExito: 'Intervención cancelada.', esPeligrosa: true },
  { codigo: 'ELIMINAR', etiqueta: 'Eliminar', lugar: 'menu', avisoExito: 'Intervención N.º {id} eliminada.', esPeligrosa: true },
];

/**
 * Ordena y clasifica las acciones disponibles según la tabla de ACCIONES.
 * Los códigos desconocidos se ignoran.
 */
export function ordenarAcciones(disponibles: string[]): {
  principal: string | null;
  visibles: string[];
  menu: string[];
} {
  const setDisp = new Set(disponibles);
  let principal: string | null = null;
  const visibles: string[] = [];
  const menu: string[] = [];

  for (const accion of ACCIONES) {
    if (!setDisp.has(accion.codigo)) continue;

    if (accion.lugar === 'principal') {
      if (principal === null) {
        principal = accion.codigo;
      } else {
        visibles.push(accion.codigo);
      }
    } else if (accion.lugar === 'visible') {
      visibles.push(accion.codigo);
    } else if (accion.lugar === 'menu') {
      menu.push(accion.codigo);
    }
  }

  return { principal, visibles, menu };
}

/**
 * Devuelve el texto del botón de la acción.
 * Para ASIGNAR devuelve "Reasignar" si tieneResponsable es true y "Asignar" si no.
 */
export function etiquetaAccion(codigo: string, tieneResponsable = false): string {
  if (codigo === 'ASIGNAR') {
    return tieneResponsable ? 'Reasignar' : 'Asignar';
  }
  const accion = ACCIONES.find((a) => a.codigo === codigo);
  return accion ? accion.etiqueta : codigo;
}
