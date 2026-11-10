import pg from 'pg';
import { ErrorNegocio } from '../intervenciones/errores.ts';

/** El mayor valor de una lectura: numeric(14,2). */
export const MAXIMO_VALOR = 999999999999.99;

/** Un número de 0 al máximo, con hasta 2 decimales; `"100"` no es un número (3.4). */
export function validarValorMedidor(val: unknown, campo: string, minimoExcluido = false): number {
  const piso = minimoExcluido ? 'mayor que 0' : 'de 0';
  if (
    typeof val !== 'number' ||
    !Number.isFinite(val) ||
    val < 0 ||
    (minimoExcluido && val === 0) ||
    val > MAXIMO_VALOR
  ) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El campo ${campo} debe ser un número ${piso} hasta 999.999.999.999,99`);
  }
  const fijo = Number(val.toFixed(2));
  if (Math.abs(val - fijo) > 1e-9) {
    throw new ErrorNegocio(422, 'DATOS_INVALIDOS', `El campo ${campo} no puede tener más de 2 decimales`);
  }
  return fijo;
}

export interface MedidorBloqueado {
  id: number;
  maquina_id: number;
  sector_id: number;
  nombre: string;
  unidad: string;
  activo: boolean;
  maquina_activa: boolean;
}

export function medidorNoEncontrado(): ErrorNegocio {
  return new ErrorNegocio(404, 'MEDIDOR_NO_ENCONTRADO', 'Medidor no encontrado');
}

/**
 * Bloquea el medidor con FOR UPDATE (3.5). Antes toma la máquina con FOR SHARE: generar
 * una intervención bloquea la máquina y después toma el medidor, y cargar una lectura
 * va en el mismo orden para no trabarse con ella.
 */
export async function bloquearMedidor(client: pg.PoolClient, medidorId: number | null): Promise<MedidorBloqueado> {
  if (medidorId === null) throw medidorNoEncontrado();
  const previo = await client.query('SELECT maquina_id FROM medidores WHERE id = $1', [medidorId]);
  if (previo.rows.length === 0) throw medidorNoEncontrado();

  const m = await client.query('SELECT sector_id, activo FROM maquinas WHERE id = $1 FOR SHARE', [previo.rows[0].maquina_id]);
  const r = await client.query(
    'SELECT id, maquina_id, nombre, unidad, activo FROM medidores WHERE id = $1 FOR UPDATE',
    [medidorId]
  );
  const x = r.rows[0];
  return {
    id: Number(x.id),
    maquina_id: Number(x.maquina_id),
    sector_id: Number(m.rows[0].sector_id),
    nombre: x.nombre,
    unidad: x.unidad,
    activo: Boolean(x.activo),
    maquina_activa: Boolean(m.rows[0].activo),
  };
}

export interface UltimaLectura {
  valor: number;
  registrada_en: unknown;
}

/** La última lectura vigente: la de mayor valor; a igual valor, la de mayor id. */
export async function ultimaLectura(client: pg.PoolClient, medidorId: number): Promise<UltimaLectura | null> {
  const r = await client.query(
    `SELECT valor, registrada_en FROM lecturas_medidor
     WHERE medidor_id = $1 AND anulada_en IS NULL
     ORDER BY valor DESC, id DESC
     LIMIT 1`,
    [medidorId]
  );
  return r.rows.length === 0 ? null : { valor: Number(r.rows[0].valor), registrada_en: r.rows[0].registrada_en };
}

export function errorLecturaMenor(ultima: UltimaLectura): ErrorNegocio {
  return new ErrorNegocio(422, 'LECTURA_MENOR', 'La lectura es menor que la última registrada', { ultima });
}

export interface RegistrarLecturaParams {
  /** Ya bloqueado con bloquearMedidor, en la transacción del llamador. */
  medidor: MedidorBloqueado;
  /** Ya validado con validarValorMedidor. */
  valor: number;
  usuarioId: number;
  origen: 'MANUAL' | 'TAREA';
  intervencionTareaId?: number | null;
  observacion?: string | null;
}

/**
 * Registra una lectura (regla 5): la usan POST /api/medidores/:id/lecturas, el alta con
 * lectura_inicial y el marcado de una tarea. La comparación corre con el medidor bloqueado.
 */
export async function registrarLectura(client: pg.PoolClient, p: RegistrarLecturaParams): Promise<number> {
  if (!p.medidor.activo) {
    throw new ErrorNegocio(409, 'MEDIDOR_INACTIVO', 'El medidor está inactivo');
  }
  if (!p.medidor.maquina_activa) {
    throw new ErrorNegocio(422, 'MAQUINA_INACTIVA', 'La máquina está inactiva');
  }
  const ultima = await ultimaLectura(client, p.medidor.id);
  if (ultima !== null && p.valor < ultima.valor) throw errorLecturaMenor(ultima);

  const r = await client.query(
    `INSERT INTO lecturas_medidor (medidor_id, valor, registrada_por_usuario_id, origen, intervencion_tarea_id, observacion)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [p.medidor.id, p.valor, p.usuarioId, p.origen, p.intervencionTareaId ?? null, p.observacion ?? null]
  );
  return Number(r.rows[0].id);
}
