/**
 * Lógica pura de preventivos (Etapa PV2, sección 2).
 *
 * El front no calcula fechas de vencimiento ni estados: usa `hoy`, `dias`, `estado`
 * y `proxima_fecha` tal como los manda la API (D-021).
 */
import { formatCantidad, parsearId } from './formato';
import { fechaDeMomento, leerValorMedidor, textoValorMedidor } from './medidores';
import { validarCantidad } from './repuestos';
import type {
  EstadoFechaTarea,
  EstadoVencimiento,
  FrecuenciaUnidad,
  RepuestoPrevistoIntervencion,
  TareaPlan,
  UsoTareaIntervencion,
  UsoTareaPlan,
} from '../api/tipos';

export { textoValorMedidor };

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
// Textos del uso (Etapa PV4, 2.1)
// ---------------------------------------------------------------------------

/** Lo que hace falta de una tarea, del plan o de los vencimientos, para sus textos. */
export interface TareaParaTexto {
  frecuencia_valor: number | null;
  frecuencia_unidad: FrecuenciaUnidad | null;
  dias: number | null;
  estado_fecha: EstadoFechaTarea | null;
  uso: UsoTareaPlan | null;
}

/** "Cada 6 meses", "Cada 250 horas" o "Cada 6 meses o 250 horas". */
export function textoFrecuenciaTarea(
  t: Pick<TareaParaTexto, 'frecuencia_valor' | 'frecuencia_unidad'> & {
    uso: { cada: number; medidor: { unidad: string } } | null;
  }
): string {
  const porFecha =
    t.frecuencia_valor !== null && t.frecuencia_unidad !== null ? textoFrecuencia(t.frecuencia_valor, t.frecuencia_unidad) : null;
  const porUso = t.uso ? textoValorMedidor(t.uso.cada, t.uso.medidor.unidad) : null;
  if (porFecha && porUso) return `${porFecha} o ${porUso}`;
  if (porFecha) return porFecha;
  if (porUso) return `Cada ${porUso}`;
  return '—';
}

/** "Sin lecturas del Horómetro", "Faltan 25 horas", "Toca ahora" o "Se pasó por 12,5 horas". */
export function textoUso(uso: UsoTareaPlan): string {
  if (uso.estado === 'SIN_LECTURA' || uso.faltan === null) return `Sin lecturas del ${uso.medidor.nombre}`;
  if (uso.faltan > 0) return `Faltan ${textoValorMedidor(uso.faltan, uso.medidor.unidad)}`;
  if (uso.faltan === 0) return 'Toca ahora';
  return `Se pasó por ${textoValorMedidor(-uso.faltan, uso.medidor.unidad)}`;
}

/** "A las 500 horas". */
export function textoProximoUso(uso: UsoTareaPlan): string {
  return `A las ${textoValorMedidor(uso.proximo, uso.medidor.unidad)}`;
}

/**
 * El texto del criterio que apura: la fecha si está vencida o próxima; si no, el uso si
 * está vencido, próximo o sin lectura; si no, el de la fecha, y sin fecha, el del uso.
 */
export function textoVenceTarea(t: TareaParaTexto): string {
  if ((t.estado_fecha === 'VENCIDA' || t.estado_fecha === 'PROXIMA') && t.dias !== null) return textoVencimiento(t.dias);
  if (t.uso && ['VENCIDA', 'PROXIMA', 'SIN_LECTURA'].includes(t.uso.estado)) return textoUso(t.uso);
  if (t.dias !== null) return textoVencimiento(t.dias);
  if (t.uso) return textoUso(t.uso);
  return '';
}

/**
 * "Programada para el 10/12/2026", "Programada a las 500 horas" o las dos, unidas con "o".
 * Sin fecha ni uso: null.
 */
export function textoProgramada(fecha: string | null, uso: Pick<UsoTareaIntervencion, 'programado' | 'medidor'> | null): string | null {
  const porFecha = fecha ? `para el ${formatFechaDia(fecha)}` : null;
  const porUso = uso ? `a las ${textoValorMedidor(uso.programado, uso.medidor.unidad)}` : null;
  if (porFecha && porUso) return `Programada ${porFecha} o ${porUso}`;
  if (porFecha) return `Programada ${porFecha}`;
  if (porUso) return `Programada ${porUso}`;
  return null;
}

/** "Con el Horómetro en 512,5 horas", o null si no hay valor. */
export function textoValorAlHacer(uso: Pick<UsoTareaIntervencion, 'valor' | 'medidor'> | null): string | null {
  if (!uso || uso.valor === null) return null;
  return `Con el ${uso.medidor.nombre} en ${textoValorMedidor(uso.valor, uso.medidor.unidad)}`;
}

/** La primera vez sugerida: la última lectura más `cada`, o `cada` si no hay lecturas. */
export function primeraUsoSugerida(ultima: number | null, cada: number): number {
  return Math.round(((ultima ?? 0) + cada) * 100) / 100;
}

// ---------------------------------------------------------------------------
// La tarea por uso en el diálogo y en el plan nuevo (PV4, 4.1 y 4.3)
// ---------------------------------------------------------------------------

/**
 * La ayuda de "Primera vez a los": si la tarea ya se hizo con este medidor, desde cuándo
 * se cuenta; si no, la última lectura del medidor elegido.
 */
export function descripcionPrimeraUso(
  ultimaLectura: { valor: number; registrada_en: string } | null,
  ultimoHecho: number | null,
  unidad: string
): string {
  if (ultimoHecho !== null) {
    return `Ya se hizo: la próxima se cuenta desde la última vez (a las ${textoValorMedidor(ultimoHecho, unidad)}).`;
  }
  if (!ultimaLectura) return 'El medidor todavía no tiene lecturas.';
  return `Última lectura: ${textoValorMedidor(ultimaLectura.valor, unidad)} (${fechaDeMomento(ultimaLectura.registrada_en)}).`;
}

/** La ayuda de "Avisar antes", con la unidad del medidor. */
export function descripcionAnticipacionUso(unidad: string): string {
  return `Cuántas ${unidad || 'unidades'} antes pasa a próxima. Vacío: el 10 % de «Cada».`;
}

/** Una tarea por uso, o por las dos, que todavía no tiene medidor. */
export function faltaMedidor(b: BorradorTarea): boolean {
  return conUso(b.criterio) && parsearId(b.medidorId) === null;
}

/** Al cambiar la máquina del plan nuevo, las tareas pierden el medidor (era de la otra). */
export function sinMedidores(tareas: BorradorTarea[]): BorradorTarea[] {
  return tareas.map((t) => (t.medidorId === null ? t : { ...t, medidorId: null }));
}

/** El borrador como una tarea para los textos, con la unidad de su medidor (o vacía). */
function tareaDeBorrador(b: BorradorTarea, unidad: string) {
  const valor = Number(String(b.frecuenciaValor).replace(',', '.'));
  const cada = leerValorMedidor(b.usoCada);
  return {
    frecuencia_valor: conFecha(b.criterio) && Number.isInteger(valor) ? valor : null,
    frecuencia_unidad: conFecha(b.criterio) ? b.frecuenciaUnidad : null,
    uso: conUso(b.criterio) && cada !== null ? { cada, medidor: { unidad } } : null,
  };
}

/** `textoFrecuenciaTarea` de un borrador. */
export function textoFrecuenciaBorrador(b: BorradorTarea, unidad: string): string {
  return textoFrecuenciaTarea(tareaDeBorrador(b, unidad));
}

/** "Primera vez: 01/12/2026", "Primera vez a las 500 horas" o las dos, unidas con "o". */
export function textoPrimeraBorrador(b: BorradorTarea, unidad: string): string {
  const porFecha = conFecha(b.criterio) ? `: ${formatFechaDia(b.primeraFecha)}` : null;
  const primera = leerValorMedidor(b.usoPrimera);
  const porUso = conUso(b.criterio) && primera !== null ? ` a las ${textoValorMedidor(primera, unidad)}` : null;
  if (porFecha && porUso) return `Primera vez${porFecha} o${porUso}`;
  if (porFecha) return `Primera vez${porFecha}`;
  if (porUso) return `Primera vez${porUso}`;
  return '';
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

/** Por qué vence una tarea: "Vence por" en el diálogo. */
export type CriterioTarea = 'FECHA' | 'USO' | 'AMBOS';

export interface BorradorTarea {
  accion: string;
  detalle: string;
  criterio: CriterioTarea;
  frecuenciaValor: number | string;
  frecuenciaUnidad: FrecuenciaUnidad;
  /** YYYY-MM-DD, o null sin elegir. */
  primeraFecha: string | null;
  /** El id del medidor como texto, como el de un Select, o null. */
  medidorId: string | null;
  usoCada: number | string;
  usoPrimera: number | string;
  /** Vacía: la API usa el 10 % de `cada`. */
  usoAnticipacion: number | string;
  repuestos: FilaPrevisto[];
  proveedorId: string | null;
}

export function conFecha(criterio: CriterioTarea): boolean {
  return criterio !== 'USO';
}

export function conUso(criterio: CriterioTarea): boolean {
  return criterio !== 'FECHA';
}

/** Una fila de "Repuestos previstos". El nombre y la unidad son solo para mostrarla. */
export interface FilaPrevisto {
  /** El id como texto, como el de un Select, o null. */
  repuestoId: string | null;
  cantidad: number | string;
  nombre?: string;
  unidad?: string;
}

/** Hasta 10 repuestos previstos por tarea (PV2.2, 3.1). */
export const MAXIMO_PREVISTOS = 10;

export type CampoTarea =
  | 'accion'
  | 'frecuencia'
  | 'primeraFecha'
  | 'medidor'
  | 'usoCada'
  | 'usoPrimera'
  | 'usoAnticipacion'
  | 'repuesto'
  | 'cantidad'
  | 'proveedor';
export interface ErrorFilaPrevisto {
  repuesto?: string;
  cantidad?: string;
}
/** Los errores por campo; `filas`, los de cada repuesto previsto, por su posición. */
export type ErroresTarea = Partial<Record<CampoTarea, string>> & { filas?: Record<number, ErrorFilaPrevisto> };

export function borradorTareaVacio(): BorradorTarea {
  return {
    accion: '',
    detalle: '',
    criterio: 'FECHA',
    frecuenciaValor: 1,
    frecuenciaUnidad: 'MESES',
    primeraFecha: null,
    medidorId: null,
    usoCada: '',
    usoPrimera: '',
    usoAnticipacion: '',
    repuestos: [],
    proveedorId: null,
  };
}

/**
 * El borrador de una tarea del plan, para editarla. El criterio sale de la tarea: con
 * fecha y con uso, 'AMBOS'. Lo que no tiene queda como en una tarea vacía.
 */
export function borradorDeTarea(t: TareaPlan): BorradorTarea {
  const vacia = borradorTareaVacio();
  const tieneFecha = t.frecuencia_valor !== null && t.frecuencia_unidad !== null;
  const criterio: CriterioTarea = tieneFecha && t.uso ? 'AMBOS' : t.uso ? 'USO' : 'FECHA';
  return {
    accion: t.accion,
    detalle: t.detalle ?? '',
    criterio,
    frecuenciaValor: t.frecuencia_valor ?? vacia.frecuenciaValor,
    frecuenciaUnidad: t.frecuencia_unidad ?? vacia.frecuenciaUnidad,
    primeraFecha: t.primera_fecha,
    medidorId: t.uso ? String(t.uso.medidor.id) : null,
    usoCada: t.uso ? t.uso.cada : '',
    usoPrimera: t.uso ? t.uso.primera : '',
    usoAnticipacion: t.uso ? t.uso.anticipacion : '',
    repuestos: t.repuestos.map((r) => ({
      repuestoId: String(r.repuesto.id),
      cantidad: r.cantidad,
      nombre: r.repuesto.nombre,
      unidad: r.repuesto.unidad,
    })),
    proveedorId: t.proveedor ? String(t.proveedor.id) : null,
  };
}

function vacio(valor: unknown): boolean {
  return valor === null || valor === undefined || String(valor).trim() === '';
}

function validarFilasPrevistos(filas: FilaPrevisto[]): Record<number, ErrorFilaPrevisto> {
  const errores: Record<number, ErrorFilaPrevisto> = {};
  const vistos = new Set<string>();
  filas.forEach((f, i) => {
    const conRepuesto = !vacio(f.repuestoId);
    const conCantidad = !vacio(f.cantidad);
    const error: ErrorFilaPrevisto = {};
    if (conRepuesto) {
      if (vistos.has(f.repuestoId as string)) error.repuesto = 'Ese repuesto ya está en la lista.';
      vistos.add(f.repuestoId as string);
    }
    if (conRepuesto && !conCantidad) {
      error.cantidad = 'Ingresá la cantidad.';
    } else if (!conRepuesto && conCantidad) {
      error.repuesto = 'Elegí el repuesto.';
    } else if (conRepuesto && conCantidad) {
      const mensaje = validarCantidad(f.cantidad);
      if (mensaje) error.cantidad = mensaje;
    }
    if (Object.keys(error).length > 0) errores[i] = error;
  });
  return errores;
}

/**
 * Los mismos límites que la API (PV1, 4.4, y PV3, 4.1). Valida solo lo del criterio
 * elegido. Devuelve los errores por campo; vacío si está bien.
 */
export function validarTareaBorrador(b: BorradorTarea): ErroresTarea {
  const errores: ErroresTarea = {};

  const accion = b.accion.trim();
  if (accion.length < 3 || accion.length > 200) {
    errores.accion = 'Escribí qué hay que hacer (de 3 a 200 caracteres).';
  }

  if (conFecha(b.criterio)) {
    const maximo = MAXIMO_FRECUENCIA[b.frecuenciaUnidad];
    const valor = vacio(b.frecuenciaValor) ? NaN : Number(String(b.frecuenciaValor).replace(',', '.'));
    if (!Number.isInteger(valor) || valor < 1 || valor > maximo) {
      errores.frecuencia = `Ingresá un número entero de 1 a ${maximo}.`;
    }

    if (vacio(b.primeraFecha)) {
      errores.primeraFecha = 'Elegí la fecha.';
    }
  }

  if (conUso(b.criterio)) {
    if (parsearId(b.medidorId) === null) errores.medidor = 'Elegí el medidor.';
    const cada = leerValorMedidor(b.usoCada);
    if (cada === null || cada === 0) errores.usoCada = 'Ingresá un número mayor que 0, con hasta 2 decimales.';
    if (leerValorMedidor(b.usoPrimera) === null) errores.usoPrimera = 'Ingresá un número desde 0, con hasta 2 decimales.';
    if (!vacio(b.usoAnticipacion)) {
      const anticipacion = leerValorMedidor(b.usoAnticipacion);
      if (anticipacion === null) {
        errores.usoAnticipacion = 'Ingresá un número desde 0, con hasta 2 decimales.';
      } else if (cada !== null && anticipacion > cada) {
        errores.usoAnticipacion = `No puede ser mayor que «Cada» (${formatCantidad(cada)}).`;
      }
    }
  }

  const filas = validarFilasPrevistos(b.repuestos);
  if (Object.keys(filas).length > 0) errores.filas = filas;

  return errores;
}

export function hayErrores(errores: ErroresTarea): boolean {
  return Object.keys(errores).length > 0;
}

function numero(valor: number | string): number {
  return Number(String(valor).trim().replace(',', '.'));
}

/** `uso` de una tarea, como lo manda la API (PV3, 4.1). Sin anticipación, la API usa el 10 % de `cada`. */
export interface CuerpoUso {
  medidor_id: number;
  cada: number;
  primera: number;
  anticipacion?: number;
}

/** Los campos de una tarea, como los manda la API. En el PATCH, null saca la fecha o el uso. */
export interface CuerpoTarea {
  accion?: string;
  detalle?: string | null;
  frecuencia_valor?: number | null;
  frecuencia_unidad?: FrecuenciaUnidad | null;
  primera_fecha?: string | null;
  uso?: CuerpoUso | null;
  repuestos?: Array<{ repuesto_id: number; cantidad: number }>;
  proveedor_id?: number | null;
}

/** Las filas completas, como las manda la API. Una fila vacía no va. */
function previstosDeFilas(filas: FilaPrevisto[]): Array<{ repuesto_id: number; cantidad: number }> {
  const previstos: Array<{ repuesto_id: number; cantidad: number }> = [];
  for (const f of filas) {
    const repuestoId = parsearId(f.repuestoId);
    if (repuestoId !== null && !vacio(f.cantidad)) previstos.push({ repuesto_id: repuestoId, cantidad: numero(f.cantidad) });
  }
  return previstos;
}

/** El uso del borrador, o null si el criterio no lo lleva o falta el medidor. */
function usoDeBorrador(b: BorradorTarea): CuerpoUso | null {
  const medidorId = parsearId(b.medidorId);
  if (!conUso(b.criterio) || medidorId === null) return null;
  const uso: CuerpoUso = { medidor_id: medidorId, cada: numero(b.usoCada), primera: numero(b.usoPrimera) };
  if (!vacio(b.usoAnticipacion)) uso.anticipacion = numero(b.usoAnticipacion);
  return uso;
}

/** Todo lo del borrador. La fecha y el uso, solo si el criterio los lleva. */
function cuerpoCompleto(b: BorradorTarea): CuerpoTarea {
  const cuerpo: CuerpoTarea = { accion: b.accion.trim() };
  if (conFecha(b.criterio)) {
    cuerpo.frecuencia_valor = numero(b.frecuenciaValor);
    cuerpo.frecuencia_unidad = b.frecuenciaUnidad;
    if (b.primeraFecha) cuerpo.primera_fecha = b.primeraFecha;
  }
  const uso = usoDeBorrador(b);
  if (uso) cuerpo.uso = uso;
  const detalle = b.detalle.trim();
  if (detalle) cuerpo.detalle = detalle;
  const repuestos = previstosDeFilas(b.repuestos);
  if (repuestos.length > 0) cuerpo.repuestos = repuestos;
  const proveedorId = parsearId(b.proveedorId);
  if (proveedorId !== null) cuerpo.proveedor_id = proveedorId;
  return cuerpo;
}

/**
 * El cuerpo de una tarea. Sin `original`, para el alta: los campos vacíos no van; sin
 * fecha no van los tres campos de la fecha, y sin uso no va `uso`.
 * Con `original`, para el PATCH: solo lo que cambió; lo que se vació va en null. La fecha
 * que no va cuenta como null, así que sacarla manda los tres en null.
 * `repuestos` y `uso` van enteros si cambiaron, porque el PATCH los reemplaza: la lista
 * vaciada va [], y el uso que se sacó, null.
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
    'proveedor_id',
  ];
  for (const campo of campos) {
    const valorNuevo = nuevo[campo] ?? null;
    const valorAntes = antes[campo] ?? null;
    if (valorNuevo !== valorAntes) {
      (cambios as Record<string, unknown>)[campo] = valorNuevo;
    }
  }
  if (JSON.stringify(nuevo.repuestos ?? []) !== JSON.stringify(antes.repuestos ?? [])) {
    cambios.repuestos = nuevo.repuestos ?? [];
  }
  if (JSON.stringify(nuevo.uso ?? null) !== JSON.stringify(antes.uso ?? null)) {
    cambios.uso = nuevo.uso ?? null;
  }
  return cambios;
}

/** Lo que hace falta para mostrar un repuesto previsto. */
export interface PrevistoParaTexto {
  repuesto: { nombre: string; unidad: string };
  cantidad: number;
}

/** "Aceite ISO 68 × 2,5 litro". */
export function textoUnPrevisto(repuesto: { nombre: string; unidad: string }, cantidad: number): string {
  return `${repuesto.nombre} × ${formatCantidad(cantidad)} ${repuesto.unidad}`;
}

/**
 * La lista de previstos, con " · ". Con más de dos: "Aceite ISO 68 × 2,5 litro y 2 más",
 * y en `detalle` la lista completa, para el Tooltip.
 */
export function textoPrevistos(repuestos: PrevistoParaTexto[]): { texto: string; detalle: string | null } {
  const partes = repuestos.map((r) => textoUnPrevisto(r.repuesto, r.cantidad));
  if (partes.length <= 2) return { texto: partes.join(' · '), detalle: null };
  return { texto: `${partes[0]} y ${partes.length - 1} más`, detalle: partes.join(' · ') };
}

/** Las filas completas de un borrador, para mostrarlas con `textoPrevistos`. */
export function previstosDeBorrador(filas: FilaPrevisto[]): PrevistoParaTexto[] {
  return filas
    .filter((f) => f.nombre && !vacio(f.cantidad))
    .map((f) => ({ repuesto: { nombre: f.nombre as string, unidad: f.unidad ?? '' }, cantidad: numero(f.cantidad) }));
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

/** Los de la API por omisión (PV3, 4.2): el front manda la lista, y sin SIN_LECTURA esas tareas no aparecen. */
export const ESTADOS_POR_OMISION: EstadoVencimiento[] = ['VENCIDA', 'PROXIMA', 'SIN_LECTURA', 'EN_CURSO'];
const ESTADOS_VALIDOS: EstadoVencimiento[] = ['VENCIDA', 'PROXIMA', 'SIN_LECTURA', 'EN_CURSO', 'AL_DIA'];

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

/** "2 vencidas · 1 próxima · 1 sin lectura", con las que haya; si no hay ninguna, "—". */
export function textoPendientes(plan: { vencidas: number; proximas: number; en_curso?: number; sin_lectura?: number }): string {
  const partes: string[] = [];
  if (plan.vencidas > 0) partes.push(`${plan.vencidas} ${plan.vencidas === 1 ? 'vencida' : 'vencidas'}`);
  if (plan.proximas > 0) partes.push(`${plan.proximas} ${plan.proximas === 1 ? 'próxima' : 'próximas'}`);
  if (plan.sin_lectura && plan.sin_lectura > 0) partes.push(`${plan.sin_lectura} sin lectura`);
  return partes.length > 0 ? partes.join(' · ') : '—';
}

// ---------------------------------------------------------------------------
// Errores de la API en el diálogo de una tarea
// ---------------------------------------------------------------------------

/**
 * El campo y el mensaje de un error de la API sobre una tarea (PV1, 4.4), para ponerlo
 * en su campo, como en el diálogo de costos. Sin campo reconocible: null.
 * Con `indiceRepuesto`, el error es de esa fila de los previstos.
 */
export function errorTareaDeApi(codigo: string, mensaje: string, indiceRepuesto?: number): ErrorTareaApi | null {
  const error = campoDeErrorApi(codigo, mensaje);
  if (indiceRepuesto === undefined) return error;
  if (error?.campo === 'repuesto' || error?.campo === 'cantidad') return { ...error, indiceRepuesto };
  if (mensaje.includes('repetido')) return { campo: 'repuesto', mensaje: 'Ese repuesto ya está en la lista.', indiceRepuesto };
  return error;
}

export interface ErrorTareaApi {
  campo: CampoTarea;
  mensaje: string;
  indiceRepuesto?: number;
}

function campoDeErrorApi(codigo: string, mensaje: string): ErrorTareaApi | null {
  if (codigo === 'REPUESTO_INVALIDO') return { campo: 'repuesto', mensaje: 'El repuesto no existe o está inactivo.' };
  if (codigo === 'PROVEEDOR_INVALIDO') return { campo: 'proveedor', mensaje: 'El proveedor no existe o está inactivo.' };
  if (codigo === 'MEDIDOR_INVALIDO') {
    return { campo: 'medidor', mensaje: 'Elegí un medidor activo de esta máquina.' };
  }
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

/** Un error de la API, como errores del formulario: en su fila si trae `indiceRepuesto`. */
export function erroresDeApi(error: ErrorTareaApi): ErroresTarea {
  if (error.indiceRepuesto !== undefined && (error.campo === 'repuesto' || error.campo === 'cantidad')) {
    return { filas: { [error.indiceRepuesto]: { [error.campo]: error.mensaje } } };
  }
  return { [error.campo]: error.mensaje };
}

/**
 * Saca los errores de una fila que se tocó. Al cambiar el repuesto saca también los
 * "repetido" de las otras filas: se arregla tocando cualquiera de las dos.
 */
export function sinErrorDeFila(errores: ErroresTarea, indice: number, campo: 'repuesto' | 'cantidad'): ErroresTarea {
  const { filas, ...resto } = errores;
  const nuevas: Record<number, ErrorFilaPrevisto> = {};
  for (const [clave, error] of Object.entries(filas ?? {})) {
    const i = Number(clave);
    if (i === indice) continue;
    const copia = { ...error };
    if (campo === 'repuesto') delete copia.repuesto;
    if (Object.keys(copia).length > 0) nuevas[i] = copia;
  }
  return Object.keys(nuevas).length > 0 ? { ...resto, filas: nuevas } : resto;
}

// ---------------------------------------------------------------------------
// Confirmar los repuestos al hacer una tarea (PV2.2, sección 5)
// ---------------------------------------------------------------------------

/** Una fila del diálogo "Marcar como hecha". */
export interface FilaConfirmar {
  previstoId: number;
  nombre: string;
  unidad: string;
  usado: boolean;
  cantidad: number | string;
  /** null si no se puede ver el stock o el repuesto no lo lleva. */
  disponible: number | null;
}

export interface CuerpoConfirmar {
  hecha: true;
  repuestos: Array<{ id: number; cantidad: number }>;
  observacion: string | null;
  motivo?: string;
}

/** Una fila por previsto: tildada, con la cantidad prevista. */
export function filasConfirmar(previstos: RepuestoPrevistoIntervencion[]): FilaConfirmar[] {
  return previstos.map((p) => ({
    previstoId: p.id,
    nombre: p.repuesto.nombre,
    unidad: p.repuesto.unidad,
    usado: true,
    cantidad: p.cantidad_prevista,
    disponible: p.repuesto.lleva_stock ? p.repuesto.cantidad_disponible : null,
  }));
}

/** "Hay 12 litro", o "No alcanza: hay 1,5 litro." si se pide más. null sin dato o sin tildar. */
export function avisoDisponible(f: FilaConfirmar): { texto: string; alcanza: boolean } | null {
  if (!f.usado || f.disponible === null) return null;
  const hay = `${formatCantidad(f.disponible)} ${f.unidad}`;
  return numero(f.cantidad) > f.disponible
    ? { texto: `No alcanza: hay ${hay}.`, alcanza: false }
    : { texto: `Hay ${hay}`, alcanza: true };
}

/** Los errores por `previstoId`, solo de las filas tildadas; vacío si está bien. */
export function validarConfirmar(filas: FilaConfirmar[]): Record<number, string> {
  const errores: Record<number, string> = {};
  for (const f of filas) {
    if (!f.usado) continue;
    const error = validarCantidad(f.cantidad);
    const aviso = avisoDisponible(f);
    if (error) errores[f.previstoId] = error;
    else if (aviso && !aviso.alcanza) errores[f.previstoId] = aviso.texto;
  }
  return errores;
}

/** El cuerpo del PATCH: las filas tildadas, con su cantidad. Las otras quedan NO_USADO. */
export function cuerpoConfirmar(filas: FilaConfirmar[], observacion: string, motivo: string): CuerpoConfirmar {
  const cuerpo: CuerpoConfirmar = {
    hecha: true,
    repuestos: filas.filter((f) => f.usado).map((f) => ({ id: f.previstoId, cantidad: numero(f.cantidad) })),
    observacion: observacion.trim() || null,
  };
  if (motivo.trim()) cuerpo.motivo = motivo.trim();
  return cuerpo;
}

export function textoBotonConfirmar(n: number): string {
  if (n === 0) return 'Marcar como hecha';
  return `Marcar como hecha y registrar ${n} ${n === 1 ? 'repuesto' : 'repuestos'}`;
}

/** "Usado: 2 litro", "No usado" o "Previsto". */
export function textoEstadoPrevisto(previsto: RepuestoPrevistoIntervencion): string {
  if (previsto.estado === 'NO_USADO') return 'No usado';
  if (previsto.estado === 'PREVISTO') return 'Previsto';
  return `Usado: ${formatCantidad(previsto.consumo?.cantidad)} ${previsto.repuesto.unidad}`;
}

/** La nota del bloque "Repuestos usados", o null si no hay previstos sin confirmar. */
export function textoPrevistosSinConfirmar(n: number): string | null {
  if (n <= 0) return null;
  if (n === 1) return 'Hay 1 repuesto previsto en las tareas: se registra al marcarla como hecha.';
  return `Hay ${n} repuestos previstos en las tareas: se registran al marcarlas como hechas.`;
}
