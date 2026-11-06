/**
 * Lógica pura de repuestos, stock y pedidos
 * Según sección 6 de docs/etapas/etapa-r1-repuestos-stock.md
 */

import { formatCantidad, parsearId } from './formato';
import { normalizarTexto } from './maquinas';

export type ColorEstadoStock = 'verde' | 'naranja' | 'rojo' | 'gris';

export interface InfoEstadoStock {
  etiqueta: string;
  color: ColorEstadoStock;
}

/**
 * Devuelve la etiqueta y el color del estado de stock de un repuesto.
 */
export function infoEstadoStock(estado?: string | null): InfoEstadoStock {
  switch (estado) {
    case 'OK':
      return { etiqueta: 'En stock', color: 'verde' };
    case 'BAJO':
      return { etiqueta: 'Bajo mínimo', color: 'naranja' };
    case 'SIN_STOCK':
      return { etiqueta: 'Sin stock', color: 'rojo' };
    case 'SIN_CONTROL':
      return { etiqueta: 'Sin control de stock', color: 'gris' };
    default:
      return { etiqueta: estado || '—', color: 'gris' };
  }
}

/**
 * Mapeo de color semántico a color de Mantine para badges.
 */
export function badgeColorStock(color: string): string {
  switch (color) {
    case 'verde':
      return 'green';
    case 'naranja':
      return 'orange';
    case 'rojo':
      return 'red';
    case 'amarillo':
      return 'yellow';
    case 'azul':
      return 'blue';
    default:
      return 'gray';
  }
}

export interface ResumenStock {
  total: number;
  bajo: number;
  sinStock: number;
}

/**
 * Cuenta solo los repuestos activos: total, bajo mínimo y sin stock.
 */
export function resumenStock(
  lista: Array<{ activo?: boolean; estado_stock?: string }>
): ResumenStock {
  let total = 0;
  let bajo = 0;
  let sinStock = 0;

  for (const r of lista) {
    if (r.activo === false) continue;
    total++;
    if (r.estado_stock === 'BAJO') bajo++;
    else if (r.estado_stock === 'SIN_STOCK') sinStock++;
  }

  return { total, bajo, sinStock };
}

/**
 * Valida la cantidad ingresada para un movimiento o consumo.
 * Devuelve el mensaje de error o null si es válida.
 */
export function validarCantidad(valor: unknown, maximo?: number | null): string | null {
  if (valor === null || valor === undefined || String(valor).trim() === '') {
    return 'Ingresá una cantidad.';
  }

  const str = String(valor).trim().replace(',', '.');
  const n = Number(str);

  if (isNaN(n) || n <= 0) {
    return 'Tiene que ser mayor que cero.';
  }

  const partes = str.split('.');
  if (partes.length > 1 && partes[1].length > 3) {
    return 'Hasta tres decimales.';
  }

  if (maximo !== undefined && maximo !== null && n > maximo) {
    return `Hay ${formatCantidad(maximo)} en stock.`;
  }

  return null;
}

/**
 * Valida el costo ingresado.
 * Devuelve el mensaje de error o null si es válido (o vacío).
 */
export function validarCosto(valor: unknown): string | null {
  if (valor === null || valor === undefined || String(valor).trim() === '') {
    return null;
  }

  const str = String(valor).trim().replace(',', '.');
  const n = Number(str);

  if (isNaN(n)) {
    return null;
  }

  if (n < 0) {
    return 'No puede ser negativo.';
  }

  const partes = str.split('.');
  if (partes.length > 1 && partes[1].length > 2) {
    return 'Hasta dos decimales.';
  }

  return null;
}

export type VistaRepuestos = 'repuestos' | 'pedidos' | 'proveedores';
export type EstadoStockFiltro = 'todos' | 'OK' | 'BAJO' | 'SIN_STOCK' | 'SIN_CONTROL';

export interface FiltrosRepuestos {
  vista: VistaRepuestos;
  q: string;
  estado: EstadoStockFiltro;
  proveedor: number | null;
  inactivos: boolean;
  cerrados: boolean;
}

export const FILTROS_REPUESTOS_POR_DEFECTO: FiltrosRepuestos = {
  vista: 'repuestos',
  q: '',
  estado: 'todos',
  proveedor: null,
  inactivos: false,
  cerrados: false,
};

/**
 * Lee los filtros de la pantalla de Repuestos desde URLSearchParams o string.
 * Un valor inválido vuelve a su valor por omisión.
 */
export function leerFiltrosRepuestos(input?: URLSearchParams | string | null): FiltrosRepuestos {
  const params =
    typeof input === 'string'
      ? new URLSearchParams(input.startsWith('?') ? input.slice(1) : input)
      : input ?? new URLSearchParams();

  const rawVista = params.get('vista');
  const vista: VistaRepuestos =
    rawVista === 'pedidos' || rawVista === 'proveedores' ? rawVista : 'repuestos';

  const rawQ = params.get('q');
  const q = rawQ ? rawQ.trim() : '';

  const rawEstado = params.get('estado');
  const estado: EstadoStockFiltro =
    rawEstado === 'OK' ||
    rawEstado === 'BAJO' ||
    rawEstado === 'SIN_STOCK' ||
    rawEstado === 'SIN_CONTROL'
      ? rawEstado
      : 'todos';

  const rawProveedor = params.get('proveedor');
  const proveedor = parsearId(rawProveedor);

  const inactivos = params.get('inactivos') === '1';
  const cerrados = params.get('cerrados') === '1';

  return {
    vista,
    q,
    estado,
    proveedor,
    inactivos,
    cerrados,
  };
}

/**
 * Escribe los filtros de Repuestos en URLSearchParams, omitiendo valores por omisión.
 */
export function escribirFiltrosRepuestos(filtros: FiltrosRepuestos): URLSearchParams {
  const params = new URLSearchParams();

  if (filtros.vista && filtros.vista !== 'repuestos') {
    params.set('vista', filtros.vista);
  }

  if (filtros.q && filtros.q.trim()) {
    params.set('q', filtros.q.trim());
  }

  if (filtros.estado && filtros.estado !== 'todos') {
    params.set('estado', filtros.estado);
  }

  if (filtros.proveedor !== null && filtros.proveedor !== undefined && filtros.proveedor > 0) {
    params.set('proveedor', String(filtros.proveedor));
  }

  if (filtros.inactivos) {
    params.set('inactivos', '1');
  }

  if (filtros.cerrados) {
    params.set('cerrados', '1');
  }

  return params;
}

export interface RepuestoFiltrable {
  id: number;
  codigo?: string | null;
  nombre: string;
  ubicacion?: string | null;
  activo?: boolean;
  estado_stock?: string;
  proveedor_id?: number | null;
  proveedor?: { id: number; nombre?: string } | null;
}

/**
 * Filtra la lista de repuestos según los filtros especificados.
 */
export function filtrarRepuestos<T extends RepuestoFiltrable>(
  lista: T[],
  filtros: FiltrosRepuestos
): T[] {
  const normTexto = normalizarTexto(filtros.q);

  return lista.filter((r) => {
    // 1. Inactivos: sin inactivos, solo los activos
    if (!filtros.inactivos && r.activo === false) {
      return false;
    }

    // 2. Texto: busca en código, nombre y ubicación
    if (normTexto.length > 0) {
      const enCodigo = r.codigo ? normalizarTexto(r.codigo).includes(normTexto) : false;
      const enNombre = normalizarTexto(r.nombre).includes(normTexto);
      const enUbicacion = r.ubicacion ? normalizarTexto(r.ubicacion).includes(normTexto) : false;
      if (!enCodigo && !enNombre && !enUbicacion) {
        return false;
      }
    }

    // 3. Estado de stock
    if (filtros.estado !== 'todos' && r.estado_stock !== filtros.estado) {
      return false;
    }

    // 4. Proveedor
    if (filtros.proveedor !== null) {
      const provId = r.proveedor_id ?? r.proveedor?.id ?? null;
      if (provId !== filtros.proveedor) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Devuelve el día local como YYYY-MM-DD.
 */
export function hoyLocal(ahora?: Date | string | number): string {
  const d = ahora
    ? typeof ahora === 'string' || typeof ahora === 'number'
      ? new Date(ahora)
      : ahora
    : new Date();

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export interface InfoPedido {
  etiqueta: string;
  color: string;
  plazo: string | null;
  atrasado: boolean;
}

/**
 * Devuelve información visual y de plazo de un pedido de repuesto.
 */
export function infoPedido(
  pedido: { estado: string; esperado_para?: string | null },
  hoyInput?: Date | string
): InfoPedido {
  let etiqueta: string;
  let color: string;

  switch (pedido.estado) {
    case 'PENDIENTE':
      etiqueta = 'Por pedir';
      color = 'amarillo';
      break;
    case 'PEDIDO':
      etiqueta = 'Pedido';
      color = 'azul';
      break;
    case 'RECIBIDO':
      etiqueta = 'Recibido';
      color = 'verde';
      break;
    case 'CANCELADO':
      etiqueta = 'Cancelado';
      color = 'gris';
      break;
    default:
      etiqueta = pedido.estado;
      color = 'gris';
  }

  // Cerrados: plazo es null y atrasado es false
  if (pedido.estado === 'RECIBIDO' || pedido.estado === 'CANCELADO') {
    return {
      etiqueta,
      color,
      plazo: null,
      atrasado: false,
    };
  }

  // Abiertos
  if (!pedido.esperado_para) {
    return {
      etiqueta,
      color,
      plazo: 'Sin fecha prevista',
      atrasado: false,
    };
  }

  const hoyStr =
    typeof hoyInput === 'string'
      ? hoyInput
      : hoyInput instanceof Date
        ? hoyLocal(hoyInput)
        : hoyLocal();

  const [hy, hm, hd] = hoyStr.split('-').map(Number);
  const [ey, em, ed] = pedido.esperado_para.split('-').map(Number);

  const utcHoy = Date.UTC(hy, hm - 1, hd);
  const utcEsp = Date.UTC(ey, em - 1, ed);

  const diffDias = Math.round((utcHoy - utcEsp) / 86400000);

  if (diffDias > 0) {
    const textoAtraso = diffDias === 1 ? 'Atrasado 1 día' : `Atrasado ${diffDias} días`;
    return {
      etiqueta,
      color,
      plazo: textoAtraso,
      atrasado: true,
    };
  }

  if (diffDias === 0) {
    return {
      etiqueta,
      color,
      plazo: 'Llega hoy',
      atrasado: false,
    };
  }

  const diaPad = String(ed).padStart(2, '0');
  const mesPad = String(em).padStart(2, '0');
  return {
    etiqueta,
    color,
    plazo: `Para el ${diaPad}/${mesPad}/${ey}`,
    atrasado: false,
  };
}

export interface TextoMovimiento {
  etiqueta: string;
  cantidad: string;
}

/**
 * Devuelve la etiqueta y el texto de cantidad (con signo) de un movimiento de stock.
 */
export function textoMovimiento(movimiento: {
  tipo: string;
  delta?: number | null;
  cantidad?: number | null;
}): TextoMovimiento {
  let etiqueta: string;
  switch (movimiento.tipo) {
    case 'INGRESO':
      etiqueta = 'Ingreso';
      break;
    case 'EGRESO':
      etiqueta = 'Egreso';
      break;
    case 'AJUSTE':
      etiqueta = 'Ajuste';
      break;
    case 'DEVOLUCION':
      etiqueta = 'Devolución';
      break;
    default:
      etiqueta = movimiento.tipo;
  }

  let cantidadTexto: string;

  if (movimiento.delta !== undefined && movimiento.delta !== null) {
    const d = Number(movimiento.delta);
    if (d > 0) {
      cantidadTexto = `+${formatCantidad(d)}`;
    } else if (d < 0) {
      cantidadTexto = `\u2212${formatCantidad(Math.abs(d))}`;
    } else {
      cantidadTexto = formatCantidad(0);
    }
  } else {
    // Fila vieja sin delta
    const cant =
      movimiento.cantidad !== undefined && movimiento.cantidad !== null
        ? Number(movimiento.cantidad)
        : null;
    if (movimiento.tipo === 'INGRESO') {
      cantidadTexto = `+${formatCantidad(cant)}`;
    } else if (movimiento.tipo === 'EGRESO') {
      cantidadTexto = `\u2212${formatCantidad(cant)}`;
    } else {
      cantidadTexto = formatCantidad(cant);
    }
  }

  return {
    etiqueta,
    cantidad: cantidadTexto,
  };
}

export type TipoMovimientoManual = 'INGRESO' | 'EGRESO' | 'AJUSTE';

export interface CamposMovimientoManual {
  cantidad?: number;
  cantidad_contada?: number;
  costo_unitario?: number | null;
  proveedor_id?: number | null;
  comprobante?: string | null;
  observacion?: string | null;
  motivo?: string | null;
}

/**
 * Arma el cuerpo del JSON para el registro manual de movimientos de stock
 * según la sección 1.4 de la etapa R1.1.
 */
export function cuerpoMovimiento(
  tipo: TipoMovimientoManual,
  campos: CamposMovimientoManual
): Record<string, any> {
  const obs =
    campos.observacion !== undefined && campos.observacion !== null
      ? campos.observacion
      : campos.motivo !== undefined && campos.motivo !== null
        ? campos.motivo
        : undefined;

  if (tipo === 'INGRESO') {
    const res: Record<string, any> = {
      tipo: 'INGRESO',
      cantidad: campos.cantidad,
    };
    if (campos.costo_unitario !== undefined && campos.costo_unitario !== null) {
      res.costo_unitario = campos.costo_unitario;
    }
    if (campos.proveedor_id !== undefined && campos.proveedor_id !== null) {
      res.proveedor_id = campos.proveedor_id;
    }
    if (campos.comprobante !== undefined && campos.comprobante !== null && campos.comprobante !== '') {
      res.comprobante = campos.comprobante;
    }
    if (obs !== undefined && obs !== null && obs !== '') {
      res.observacion = obs;
    }
    return res;
  }

  if (tipo === 'EGRESO') {
    return {
      tipo: 'EGRESO',
      cantidad: campos.cantidad,
      observacion: obs,
    };
  }

  // AJUSTE
  return {
    tipo: 'AJUSTE',
    cantidad_contada: campos.cantidad_contada !== undefined ? campos.cantidad_contada : campos.cantidad,
    observacion: obs,
  };
}

