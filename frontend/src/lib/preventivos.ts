/**
 * Lógica pura de preventivos (Etapa PV2, sección 2).
 *
 * El front no calcula fechas de vencimiento ni estados: usa `hoy`, `dias`, `estado`
 * y `proxima_fecha` tal como los manda la API (D-021).
 */
import { parsearId } from './formato';
import { validarCantidad } from './repuestos';
import type { EstadoVencimiento, FrecuenciaUnidad, TareaPlan } from '../api/tipos';

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

const NOMBRES_UNIDAD: Record<FrecuenciaUnidad, [string, string]> = {
  DIAS: ['día', 'días'],
  SEMANAS: ['semana', 'semanas'],
  MESES: ['mes', 'meses'],
  ANIOS: ['año', 'años'],
};

/** "Cada día", "Cada 3 días", "Cada mes", "Cada 6 meses"… */
export function textoFrecuencia(valor: number, unidad: FrecuenciaUnidad): string {
  const [singular, plural] = NOMBRES_UNIDAD[unidad] ?? [unidad, unidad];
  return valor === 1 ? `Cada ${singular}` : `Cada ${valor} ${plural}`;
}

/** Con el `dias` de la API: "Venció hace 3 días", "Venció ayer", "Vence hoy", "Vence mañana", "Vence en 5 días". */
export function textoVencimiento(dias: number): string {
  if (dias < -1) return `Venció hace ${-dias} días`;
  if (dias === -1) return 'Venció ayer';
  if (dias === 0) return 'Vence hoy';
  if (dias === 1) return 'Vence mañana';
  return `Vence en ${dias} días`;
}

/**
 * '2026-11-09' → '09/11/2026'. Sin pasar por Date: con new Date, el 9 se vería como
 * el 8 en Argentina. null, vacío o un texto que no es una fecha: "—".
 */
export function formatFechaDia(fecha: string | null | undefined): string {
  if (!fecha) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.slice(0, 10));
  if (!m) return '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// ---------------------------------------------------------------------------
// Borrador de una tarea y del plan
// ---------------------------------------------------------------------------

export const UNIDADES_FRECUENCIA: Array<{ value: FrecuenciaUnidad; label: string }> = [
  { value: 'DIAS', label: 'Días' },
  { value: 'SEMANAS', label: 'Semanas' },
  { value: 'MESES', label: 'Meses' },
  { value: 'ANIOS', label: 'Años' },
];

/** Hasta 10 años, según la unidad (PV1, 2.3). */
export const MAXIMO_FRECUENCIA: Record<FrecuenciaUnidad, number> = {
  DIAS: 3650,
  SEMANAS: 520,
  MESES: 120,
  ANIOS: 10,
};

export interface BorradorTarea {
  accion: string;
  detalle: string;
  frecuenciaValor: number | string;
  frecuenciaUnidad: FrecuenciaUnidad;
  /** YYYY-MM-DD, o null sin elegir. */
  primeraFecha: string | null;
  /** El id como texto, como el de un Select, o null. */
  repuestoId: string | null;
  cantidad: number | string;
  proveedorId: string | null;
}

export type CampoTarea = 'accion' | 'frecuencia' | 'primeraFecha' | 'repuesto' | 'cantidad' | 'proveedor';
export type ErroresTarea = Partial<Record<CampoTarea, string>>;

export function borradorTareaVacio(): BorradorTarea {
  return {
    accion: '',
    detalle: '',
    frecuenciaValor: 1,
    frecuenciaUnidad: 'MESES',
    primeraFecha: null,
    repuestoId: null,
    cantidad: '',
    proveedorId: null,
  };
}

/** El borrador de una tarea del plan, para editarla. */
export function borradorDeTarea(t: TareaPlan): BorradorTarea {
  return {
    accion: t.accion,
    detalle: t.detalle ?? '',
    frecuenciaValor: t.frecuencia_valor,
    frecuenciaUnidad: t.frecuencia_unidad,
    primeraFecha: t.primera_fecha,
    repuestoId: t.repuestos[0] ? String(t.repuestos[0].repuesto.id) : null,
    cantidad: t.repuestos[0]?.cantidad ?? '',
    proveedorId: t.proveedor ? String(t.proveedor.id) : null,
  };
}

function vacio(valor: unknown): boolean {
  return valor === null || valor === undefined || String(valor).trim() === '';
}

/** Los mismos límites que la API (PV1, 4.4). Devuelve los errores por campo; vacío si está bien. */
export function validarTareaBorrador(b: BorradorTarea): ErroresTarea {
  const errores: ErroresTarea = {};

  const accion = b.accion.trim();
  if (accion.length < 3 || accion.length > 200) {
    errores.accion = 'Escribí qué hay que hacer (de 3 a 200 caracteres).';
  }

  const maximo = MAXIMO_FRECUENCIA[b.frecuenciaUnidad];
  const valor = vacio(b.frecuenciaValor) ? NaN : Number(String(b.frecuenciaValor).replace(',', '.'));
  if (!Number.isInteger(valor) || valor < 1 || valor > maximo) {
    errores.frecuencia = `Ingresá un número entero de 1 a ${maximo}.`;
  }

  if (vacio(b.primeraFecha)) {
    errores.primeraFecha = 'Elegí la fecha.';
  }

  const conRepuesto = !vacio(b.repuestoId);
  const conCantidad = !vacio(b.cantidad);
  if (conRepuesto && !conCantidad) {
    errores.cantidad = 'Ingresá la cantidad.';
  } else if (!conRepuesto && conCantidad) {
    errores.repuesto = 'Elegí el repuesto.';
  } else if (conRepuesto && conCantidad) {
    const error = validarCantidad(b.cantidad);
    if (error) errores.cantidad = error;
  }

  return errores;
}

export function hayErrores(errores: ErroresTarea): boolean {
  return Object.keys(errores).length > 0;
}

function numero(valor: number | string): number {
  return Number(String(valor).trim().replace(',', '.'));
}

/** Los campos de una tarea, como los manda la API. */
export interface CuerpoTarea {
  accion?: string;
  detalle?: string | null;
  frecuencia_valor?: number;
  frecuencia_unidad?: FrecuenciaUnidad;
  primera_fecha?: string;
  repuesto_id?: number | null;
  cantidad?: number | null;
  proveedor_id?: number | null;
}

function cuerpoCompleto(b: BorradorTarea): CuerpoTarea {
  const cuerpo: CuerpoTarea = {
    accion: b.accion.trim(),
    frecuencia_valor: numero(b.frecuenciaValor),
    frecuencia_unidad: b.frecuenciaUnidad,
  };
  if (b.primeraFecha) cuerpo.primera_fecha = b.primeraFecha;
  const detalle = b.detalle.trim();
  if (detalle) cuerpo.detalle = detalle;
  const repuestoId = parsearId(b.repuestoId);
  if (repuestoId !== null && !vacio(b.cantidad)) {
    cuerpo.repuesto_id = repuestoId;
    cuerpo.cantidad = numero(b.cantidad);
  }
  const proveedorId = parsearId(b.proveedorId);
  if (proveedorId !== null) cuerpo.proveedor_id = proveedorId;
  return cuerpo;
}

/**
 * El cuerpo de una tarea. Sin `original`, para el alta: los campos vacíos no van.
 * Con `original`, para el PATCH: solo lo que cambió; lo que se vació va en null.
 */
export function cuerpoTarea(b: BorradorTarea, original?: BorradorTarea): CuerpoTarea {
  const nuevo = cuerpoCompleto(b);
  if (!original) return nuevo;

  const antes = cuerpoCompleto(original);
  const cambios: CuerpoTarea = {};
  const campos: Array<keyof CuerpoTarea> = [
    'accion',
    'detalle',
    'frecuencia_valor',
    'frecuencia_unidad',
    'primera_fecha',
    'repuesto_id',
    'cantidad',
    'proveedor_id',
  ];
  for (const campo of campos) {
    const valorNuevo = nuevo[campo] ?? null;
    const valorAntes = antes[campo] ?? null;
    if (valorNuevo !== valorAntes) {
      (cambios as Record<string, unknown>)[campo] = valorNuevo;
    }
  }
  // El repuesto y la cantidad van juntos
  if ('repuesto_id' in cambios || 'cantidad' in cambios) {
    cambios.repuesto_id = nuevo.repuesto_id ?? null;
    cambios.cantidad = nuevo.cantidad ?? null;
  }
  return cambios;
}

export interface BorradorPlan {
  maquinaId: string | null;
  nombre: string;
  descripcion: string;
  responsableId: string | null;
  anticipacionDias: number | string;
  tareas: BorradorTarea[];
}

export interface CuerpoPlan {
  maquina_id: number | null;
  nombre: string;
  descripcion?: string;
  responsable_usuario_id?: number;
  anticipacion_dias?: number;
  tareas: CuerpoTarea[];
}

/** El cuerpo del alta del plan: los campos vacíos no van, y los números van como números. */
export function cuerpoPlan(b: BorradorPlan): CuerpoPlan {
  const cuerpo: CuerpoPlan = {
    maquina_id: parsearId(b.maquinaId),
    nombre: b.nombre.trim(),
    tareas: b.tareas.map((t) => cuerpoTarea(t)),
  };
  const descripcion = b.descripcion.trim();
  if (descripcion) cuerpo.descripcion = descripcion;
  const responsableId = parsearId(b.responsableId);
  if (responsableId !== null) cuerpo.responsable_usuario_id = responsableId;
  if (!vacio(b.anticipacionDias)) cuerpo.anticipacion_dias = numero(b.anticipacionDias);
  return cuerpo;
}

// ---------------------------------------------------------------------------
// Generar y finalizar
// ---------------------------------------------------------------------------

export interface TareaParaGenerar {
  tarea: TareaPlan;
  tildada: boolean;
  habilitada: boolean;
  /** Por qué no se puede elegir, o null. */
  motivo: string | null;
}

/**
 * Para el diálogo de generar (3.4): tildadas las vencidas y próximas, destildadas las
 * al día, y deshabilitadas las en curso y las inactivas, con el motivo.
 */
export function tareasParaGenerar(tareas: TareaPlan[]): TareaParaGenerar[] {
  return tareas.map((tarea) => {
    switch (tarea.estado) {
      case 'VENCIDA':
      case 'PROXIMA':
        return { tarea, tildada: true, habilitada: true, motivo: null };
      case 'EN_CURSO':
        return {
          tarea,
          tildada: false,
          habilitada: false,
          motivo: tarea.intervencion_en_curso
            ? `Ya está en la intervención N.º ${tarea.intervencion_en_curso.id}`
            : 'Ya está en una intervención',
        };
      case 'INACTIVA':
        return { tarea, tildada: false, habilitada: false, motivo: 'Inactiva' };
      default:
        return { tarea, tildada: false, habilitada: true, motivo: null };
    }
  });
}

/** El aviso de Finalizar y Resolver ahora con tareas sin marcar, o null si están todas. */
export function avisoTareasSinMarcar(resumen: { total: number; hechas: number }): string | null {
  const sinMarcar = resumen.total - resumen.hechas;
  if (sinMarcar <= 0) return null;
  if (sinMarcar === 1) {
    return 'Queda 1 tarea sin marcar. Si finalizás así, vuelve a quedar pendiente en el plan.';
  }
  return `Quedan ${sinMarcar} tareas sin marcar. Si finalizás así, vuelven a quedar pendientes en el plan.`;
}

// ---------------------------------------------------------------------------
// Filtros de P1 en la dirección
// ---------------------------------------------------------------------------

export type VistaPreventivos = 'vencimientos' | 'planes';

export const ESTADOS_POR_OMISION: EstadoVencimiento[] = ['VENCIDA', 'PROXIMA', 'EN_CURSO'];
const ESTADOS_VALIDOS: EstadoVencimiento[] = ['VENCIDA', 'PROXIMA', 'EN_CURSO', 'AL_DIA'];

export const TAMANIO_PAGINA_VENCIMIENTOS = 100;

export interface FiltrosPreventivos {
  vista: VistaPreventivos;
  /** Un estado solo, elegido con una tarjeta; null es el filtro por omisión. */
  estado: EstadoVencimiento | null;
  plantaId: number | null;
  sectorId: number | null;
  maquinaId: number | null;
  /** Planes: "Ver inactivos". */
  inactivos: boolean;
  pagina: number;
}

export function leerFiltrosPreventivos(params: URLSearchParams): FiltrosPreventivos {
  const rawEstado = params.get('estado');
  const pagina = Number(params.get('pagina'));
  return {
    vista: params.get('vista') === 'planes' ? 'planes' : 'vencimientos',
    estado: ESTADOS_VALIDOS.includes(rawEstado as EstadoVencimiento) ? (rawEstado as EstadoVencimiento) : null,
    plantaId: parsearId(params.get('planta')),
    sectorId: parsearId(params.get('sector')),
    maquinaId: parsearId(params.get('maquina')),
    inactivos: params.get('inactivos') === '1',
    pagina: Number.isInteger(pagina) && pagina > 1 ? pagina : 1,
  };
}

export function escribirFiltrosPreventivos(f: FiltrosPreventivos): URLSearchParams {
  const params = new URLSearchParams();
  if (f.vista === 'planes') params.set('vista', 'planes');
  if (f.estado) params.set('estado', f.estado);
  if (f.plantaId) params.set('planta', String(f.plantaId));
  if (f.sectorId) params.set('sector', String(f.sectorId));
  if (f.maquinaId) params.set('maquina', String(f.maquinaId));
  if (f.inactivos) params.set('inactivos', '1');
  if (f.pagina > 1) params.set('pagina', String(f.pagina));
  return params;
}

/** Los parámetros de GET /api/planes/vencimientos. */
export function paramsVencimientos(f: FiltrosPreventivos): Record<string, string | number> {
  const params: Record<string, string | number> = {
    estado: (f.estado ? [f.estado] : ESTADOS_POR_OMISION).join(','),
    limit: TAMANIO_PAGINA_VENCIMIENTOS,
    offset: (f.pagina - 1) * TAMANIO_PAGINA_VENCIMIENTOS,
  };
  if (f.plantaId) params.planta_id = f.plantaId;
  if (f.sectorId) params.sector_id = f.sectorId;
  if (f.maquinaId) params.maquina_id = f.maquinaId;
  return params;
}

/** Los parámetros de GET /api/planes. */
export function paramsPlanes(f: FiltrosPreventivos): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (f.inactivos) params.all = 'true';
  if (f.plantaId) params.planta_id = f.plantaId;
  if (f.sectorId) params.sector_id = f.sectorId;
  if (f.maquinaId) params.maquina_id = f.maquinaId;
  return params;
}

/** Tocar una tarjeta: deja ese estado solo; tocarla otra vez vuelve al filtro por omisión. */
export function alternarEstado(actual: EstadoVencimiento | null, tocado: EstadoVencimiento): EstadoVencimiento | null {
  return actual === tocado ? null : tocado;
}

/** "2 vencidas · 1 próxima", con las que haya; si no hay ninguna, "—". */
export function textoPendientes(plan: { vencidas: number; proximas: number; en_curso?: number }): string {
  const partes: string[] = [];
  if (plan.vencidas > 0) partes.push(`${plan.vencidas} ${plan.vencidas === 1 ? 'vencida' : 'vencidas'}`);
  if (plan.proximas > 0) partes.push(`${plan.proximas} ${plan.proximas === 1 ? 'próxima' : 'próximas'}`);
  return partes.length > 0 ? partes.join(' · ') : '—';
}

// ---------------------------------------------------------------------------
// Errores de la API en el diálogo de una tarea
// ---------------------------------------------------------------------------

/**
 * El campo y el mensaje de un error de la API sobre una tarea (PV1, 4.4), para ponerlo
 * en su campo, como en el diálogo de costos. Sin campo reconocible: null.
 */
export function errorTareaDeApi(codigo: string, mensaje: string): { campo: CampoTarea; mensaje: string } | null {
  if (codigo === 'REPUESTO_INVALIDO') return { campo: 'repuesto', mensaje: 'El repuesto no existe o está inactivo.' };
  if (codigo === 'PROVEEDOR_INVALIDO') return { campo: 'proveedor', mensaje: 'El proveedor no existe o está inactivo.' };
  if (codigo !== 'DATOS_INVALIDOS') return null;

  if (mensaje.includes('accion')) {
    return { campo: 'accion', mensaje: 'Escribí qué hay que hacer (de 3 a 200 caracteres).' };
  }
  if (mensaje.includes('frecuencia')) {
    const max = /de 1 a (\d+)/.exec(mensaje);
    return { campo: 'frecuencia', mensaje: max ? `Ingresá un número entero de 1 a ${max[1]}.` : 'Revisá la frecuencia.' };
  }
  if (mensaje.includes('primera_fecha')) {
    return { campo: 'primeraFecha', mensaje: 'Elegí una fecha entre hace 10 años y dentro de 10 años.' };
  }
  if (mensaje.includes('cantidad')) return { campo: 'cantidad', mensaje: 'Revisá la cantidad.' };
  return null;
}
