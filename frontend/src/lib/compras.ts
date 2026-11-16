/**
 * Etapa PC1: pedidos que se usan al recibir y reporte de compras (D-029).
 * Lógica pura, sin React ni Mantine. Va aparte de lib/reportes.ts y lib/repuestos.ts.
 */
import type { CompraFila, ReporteComprasRespuesta } from '../api/tipos';
import { formatCantidad, formatMoneda } from './formato';

// ---------------------------------------------------------------------------
// 6.1 Al guardar un pedido
// ---------------------------------------------------------------------------

/** Se pregunta por la espera si la intervención está en proceso y el usuario puede "Esperar repuestos". */
export function preguntarEspera(estadoIntervencion: string, accionesDisponibles: readonly string[]): boolean {
  return estadoIntervencion === 'EN_PROCESO' && accionesDisponibles.includes('ESPERAR_REPUESTOS');
}

interface PedidoParaTexto {
  id: number;
  cantidad: number;
  repuesto: { nombre: string } | null;
  descripcion: string | null;
}

/** "Rulemán 6204", o la descripción de un pedido de texto libre. */
export function nombrePedido(p: Pick<PedidoParaTexto, 'repuesto' | 'descripcion'>): string {
  return p.repuesto?.nombre ?? p.descripcion ?? 'Repuesto';
}

/** La observación precargada: "Esperando: Rulemán 6204 × 4 (pedido N.º 18)". */
export function observacionEspera(p: PedidoParaTexto): string {
  return `Esperando: ${nombrePedido(p)} × ${formatCantidad(p.cantidad)} (pedido N.º ${p.id})`;
}

// ---------------------------------------------------------------------------
// 6.2 Recibir
// ---------------------------------------------------------------------------

/** "Usar en esta intervención" se ofrece con la intervención en proceso o esperando repuestos (D5). */
export function permiteUsarAlRecibir(estadoIntervencion: string | null | undefined): boolean {
  return estadoIntervencion === 'EN_PROCESO' || estadoIntervencion === 'EN_ESPERA_REPUESTOS';
}

export interface RecepcionPlaneada {
  /** Lo recibido: la cantidad del pedido. */
  cantidad: number;
  llevaStock: boolean;
  ingresarStock: boolean;
  usar: boolean;
  cantidadUso: number;
  costoUnitario: number | null;
}

/**
 * La línea que resume lo que va a pasar al recibir, por ejemplo:
 * "Entran 10 al stock y se usan 4 en esta intervención. Quedan 6 en stock."
 * "Se usa en esta intervención: 1 × $ 85.000,00."
 */
export function textoResumenRecepcion(r: RecepcionPlaneada): string {
  const recibido = formatCantidad(r.cantidad);
  if (r.usar && r.llevaStock) {
    const quedan = Math.round((r.cantidad - r.cantidadUso) * 1000) / 1000;
    const resto = quedan > 0 ? `Quedan ${formatCantidad(quedan)} en stock.` : 'No queda nada en stock.';
    return `Entran ${recibido} al stock y se usan ${formatCantidad(r.cantidadUso)} en esta intervención. ${resto}`;
  }
  if (r.usar) {
    return r.costoUnitario !== null
      ? `Se usa en esta intervención: ${recibido} × ${formatMoneda(r.costoUnitario)}.`
      : `Se usa en esta intervención: ${recibido}.`;
  }
  if (r.ingresarStock) {
    return `Entran ${recibido} al stock.`;
  }
  return 'Se recibe sin entrar al stock.';
}

// ---------------------------------------------------------------------------
// 6.3 Después de recibir
// ---------------------------------------------------------------------------

/** Se ofrece reanudar si la intervención espera repuestos y ya no queda ningún pedido abierto. */
export function ofrecerReanudar(
  respuesta: { intervencion_estado: string; pedidos_abiertos: number },
  puedeReanudar: boolean
): boolean {
  return puedeReanudar && respuesta.intervencion_estado === 'EN_ESPERA_REPUESTOS' && respuesta.pedidos_abiertos === 0;
}

// ---------------------------------------------------------------------------
// 6.4 y 6.5 La lista de pedidos y el cierre
// ---------------------------------------------------------------------------

/** "Usado: 4 de 10". */
export function textoUsado(cantidadUsada: number, cantidadPedido: number): string {
  return `Usado: ${formatCantidad(cantidadUsada)} de ${formatCantidad(cantidadPedido)}`;
}

/** Cuántos pedidos quedan pendientes o pedidos. */
export function pedidosSinRecibir(pedidos: ReadonlyArray<{ estado: string }>): number {
  return pedidos.filter((p) => p.estado === 'PENDIENTE' || p.estado === 'PEDIDO').length;
}

/** El aviso de ModalFinalizar; vacío si no queda ninguno. */
export function textoPedidosSinRecibir(n: number): string {
  if (n <= 0) return '';
  if (n === 1) return 'Queda 1 pedido sin recibir. Queda abierto: podés cancelarlo desde Pedidos.';
  return `Quedan ${n} pedidos sin recibir. Quedan abiertos: podés cancelarlos desde Pedidos.`;
}

// ---------------------------------------------------------------------------
// 7. Reporte de compras
// ---------------------------------------------------------------------------

/** D6: reportes con alcance a todas las máquinas, más COSTOS_VER. */
export function veReporteCompras(alcanceReportes: unknown, tieneCostosVer: boolean): boolean {
  const alcance =
    typeof alcanceReportes === 'object' && alcanceReportes !== null && 'alcance' in alcanceReportes
      ? (alcanceReportes as { alcance: unknown }).alcance
      : alcanceReportes;
  return alcance === 'TODAS' && tieneCostosVer;
}

export function nombreProveedor(p: { nombre: string } | null): string {
  return p?.nombre ?? 'Sin proveedor';
}

/** "Stock", o "Intervención N.º 18 · PIN-01". */
export function textoOrigenCompra(f: Pick<CompraFila, 'origen'>): string {
  if (f.origen.tipo === 'STOCK') return 'Stock';
  const i = f.origen.intervencion;
  if (!i) return 'Intervención';
  return i.maquina.codigo ? `Intervención N.º ${i.id} · ${i.maquina.codigo}` : `Intervención N.º ${i.id}`;
}

/** "Rulemán 6204 (RUL-6204)", o la descripción de un pedido de texto libre. */
export function textoArticuloCompra(f: Pick<CompraFila, 'repuesto' | 'descripcion'>): string {
  if (f.repuesto) return f.repuesto.codigo ? `${f.repuesto.codigo} · ${f.repuesto.nombre}` : f.repuesto.nombre;
  return f.descripcion ?? '—';
}

/** "1 compra sin costo: no suma al total"; vacío si no hay. */
export function textoSinCosto(n: number): string {
  if (n <= 0) return '';
  return n === 1 ? '1 compra sin costo: no suma al total' : `${n} compras sin costo: no suman al total`;
}

/** "3 ingresos sin proveedor no se cuentan como compra"; vacío si no hay. */
export function textoIngresosSinProveedor(n: number): string {
  if (n <= 0) return '';
  return n === 1
    ? '1 ingreso sin proveedor no se cuenta como compra'
    : `${n} ingresos sin proveedor no se cuentan como compra`;
}

/** El proveedor con más importe, para la tarjeta de arriba; null sin compras con costo. */
export function proveedorPrincipal(
  datos: Pick<ReporteComprasRespuesta, 'por_proveedor'>
): { nombre: string; importe: number } | null {
  const primero = datos.por_proveedor[0];
  if (!primero || primero.importe <= 0) return null;
  return { nombre: nombreProveedor(primero.proveedor), importe: primero.importe };
}

/** "10/11/2026" desde "2026-11-10", sin pasar por Date. */
export function fechaCompra(fecha: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)}` : fecha;
}

/** Las columnas y filas del CSV de compras, en el orden del detalle. */
export function filasCsvCompras(datos?: Pick<ReporteComprasRespuesta, 'filas'> | null): {
  columnas: string[];
  filas: Array<Array<string | number | null>>;
} {
  const columnas = [
    'Fecha',
    'Proveedor',
    'Comprobante',
    'Repuesto o descripción',
    'Cantidad',
    'Unidad',
    'Costo unitario',
    'Importe',
    'Origen',
  ];
  const filas = (datos?.filas ?? []).map((f) => [
    fechaCompra(f.fecha),
    nombreProveedor(f.proveedor),
    f.comprobante ?? '',
    textoArticuloCompra(f),
    f.cantidad,
    f.unidad,
    f.costo_unitario,
    f.importe,
    textoOrigenCompra(f),
  ]);
  return { columnas, filas };
}
