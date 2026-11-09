import pg from 'pg';
import { ErrorNegocio } from '../intervenciones/errores.ts';
import { validarCantidad, validarIdCuerpo } from '../repuestos/validaciones.ts';
import { Hoy } from './comun.ts';

export const UNIDADES = ['DIAS', 'SEMANAS', 'MESES', 'ANIOS'] as const;
export type Unidad = (typeof UNIDADES)[number];

/** Hasta 10 años, según la unidad (2.3). */
export const MAXIMO_FRECUENCIA: Record<Unidad, number> = {
  DIAS: 3650,
  SEMANAS: 520,
  MESES: 120,
  ANIOS: 10,
};

function invalido(mensaje: string): ErrorNegocio {
  return new ErrorNegocio(422, 'DATOS_INVALIDOS', mensaje);
}

function presente(val: unknown): boolean {
  return val !== undefined && val !== null;
}

/** Texto obligatorio, recortado, de min a max caracteres. */
export function textoObligatorio(val: unknown, campo: string, min: number, max: number): string {
  if (typeof val !== 'string') throw invalido(`El campo ${campo} es obligatorio`);
  const t = val.trim();
  if (t.length < min || t.length > max) {
    throw invalido(`El campo ${campo} debe tener entre ${min} y ${max} caracteres`);
  }
  return t;
}

/** Texto opcional, recortado, hasta max. Vacío o null: null. */
export function textoOpcional(val: unknown, campo: string, max: number): string | null {
  if (!presente(val)) return null;
  if (typeof val !== 'string') throw invalido(`El campo ${campo} debe ser texto`);
  const t = val.trim();
  if (t.length > max) throw invalido(`El campo ${campo} no puede superar los ${max} caracteres`);
  return t.length > 0 ? t : null;
}

export function validarAnticipacion(val: unknown): number {
  if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || val > 90) {
    throw invalido('El campo anticipacion_dias debe ser un entero de 0 a 90');
  }
  return val;
}

/** YYYY-MM-DD, una fecha que existe, entre hoy − 10 años y hoy + 10 años. */
export function validarPrimeraFecha(val: unknown, hoy: Hoy): string {
  if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    throw invalido('El campo primera_fecha es obligatorio, con el formato AAAA-MM-DD');
  }
  const d = new Date(`${val}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== val) {
    throw invalido('El campo primera_fecha no es una fecha que exista');
  }
  if (val < hoy.minimo || val > hoy.maximo) {
    throw invalido('El campo primera_fecha debe estar entre hoy − 10 años y hoy + 10 años');
  }
  return val;
}

export function validarFrecuencia(valor: unknown, unidad: unknown): { valor: number; unidad: Unidad } {
  if (typeof unidad !== 'string' || !(UNIDADES as readonly string[]).includes(unidad)) {
    throw invalido('El campo frecuencia_unidad debe ser DIAS, SEMANAS, MESES o ANIOS');
  }
  const u = unidad as Unidad;
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1 || valor > MAXIMO_FRECUENCIA[u]) {
    throw invalido(`El campo frecuencia_valor debe ser un entero de 1 a ${MAXIMO_FRECUENCIA[u]} para ${u}`);
  }
  return { valor, unidad: u };
}

/** Una tarea validada, lista para guardar. */
export interface TareaValida {
  accion: string;
  detalle: string | null;
  frecuencia_valor: number;
  frecuencia_unidad: Unidad;
  primera_fecha: string;
  repuesto_id: number | null;
  cantidad: number | null;
  proveedor_id: number | null;
}

/** Los campos que se pueden mandar en una tarea (4.4). */
const CAMPOS_TAREA = [
  'accion',
  'detalle',
  'frecuencia_valor',
  'frecuencia_unidad',
  'primera_fecha',
  'repuesto_id',
  'cantidad',
  'proveedor_id',
] as const;

/** Campos de la tarea que no se cambian por el alta ni por el PATCH. */
const CAMPOS_TAREA_PROHIBIDOS = ['id', 'plan_id', 'orden', 'activo'];

/**
 * Valida una tarea sin tocar la base. Con `actual`, es un PATCH: los campos que no
 * vienen quedan como están, y se validan solo los que vienen; las reglas que cruzan
 * campos (frecuencia, repuesto y cantidad) se controlan sobre el resultado.
 */
export function validarTarea(raw: unknown, hoy: Hoy, actual?: TareaValida): TareaValida {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw invalido('Cada tarea debe ser un objeto');
  }
  const b = raw as Record<string, unknown>;
  for (const campo of CAMPOS_TAREA_PROHIBIDOS) {
    if (campo in b) throw invalido(`El campo ${campo} de una tarea no se cambia por acá`);
  }
  const viene = (campo: (typeof CAMPOS_TAREA)[number]) => !actual || campo in b;

  const accion = viene('accion') ? textoObligatorio(b.accion, 'accion', 3, 200) : actual!.accion;
  const detalle = viene('detalle') ? textoOpcional(b.detalle, 'detalle', 2000) : actual!.detalle;

  const frecuencia = validarFrecuencia(
    viene('frecuencia_valor') ? b.frecuencia_valor : actual!.frecuencia_valor,
    viene('frecuencia_unidad') ? b.frecuencia_unidad : actual!.frecuencia_unidad
  );

  const primera_fecha = viene('primera_fecha') ? validarPrimeraFecha(b.primera_fecha, hoy) : actual!.primera_fecha;

  const repuesto_id = viene('repuesto_id')
    ? presente(b.repuesto_id)
      ? validarIdCuerpo(b.repuesto_id, 'REPUESTO_INVALIDO', 'repuesto_id')
      : null
    : actual!.repuesto_id;
  const cantidad = viene('cantidad')
    ? presente(b.cantidad)
      ? validarCantidad(b.cantidad, 'cantidad')
      : null
    : actual!.cantidad;
  if ((repuesto_id === null) !== (cantidad === null)) {
    throw invalido('El repuesto sugerido y su cantidad van juntos');
  }

  const proveedor_id = viene('proveedor_id')
    ? presente(b.proveedor_id)
      ? validarIdCuerpo(b.proveedor_id, 'PROVEEDOR_INVALIDO', 'proveedor_id')
      : null
    : actual!.proveedor_id;

  return {
    accion,
    detalle,
    frecuencia_valor: frecuencia.valor,
    frecuencia_unidad: frecuencia.unidad,
    primera_fecha,
    repuesto_id,
    cantidad,
    proveedor_id,
  };
}

/**
 * El repuesto y el proveedor de una tarea: activos, leídos con FOR SHARE.
 * Con `actual`, solo los que cambian: uno que ya estaba y se desactivó después no frena el cambio.
 */
export async function validarReferenciasTarea(
  client: pg.PoolClient,
  tarea: TareaValida,
  actual?: TareaValida
): Promise<void> {
  if (tarea.repuesto_id !== null && tarea.repuesto_id !== actual?.repuesto_id) {
    const r = await client.query('SELECT activo FROM repuestos WHERE id = $1 FOR SHARE', [tarea.repuesto_id]);
    if (r.rows.length === 0 || !r.rows[0].activo) {
      throw new ErrorNegocio(422, 'REPUESTO_INVALIDO', 'El repuesto no existe o está inactivo');
    }
  }
  if (tarea.proveedor_id !== null && tarea.proveedor_id !== actual?.proveedor_id) {
    const r = await client.query('SELECT activo FROM proveedores WHERE id = $1 FOR SHARE', [tarea.proveedor_id]);
    if (r.rows.length === 0 || !r.rows[0].activo) {
      throw new ErrorNegocio(422, 'PROVEEDOR_INVALIDO', 'El proveedor no existe o está inactivo');
    }
  }
}

/** Le suma `indice` a un error de negocio, como el lote de costos. */
export function conIndice(err: unknown, indice: number): unknown {
  if (err instanceof ErrorNegocio) {
    return new ErrorNegocio(err.status, err.codigo, err.mensaje, { ...(err.detalles || {}), indice });
  }
  return err;
}
