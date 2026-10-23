import pg from 'pg';
import { ErrorNegocio } from './errores.js';

const ISO_TZ_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Validador de fechas ISO 8601 con zona horaria explícita.
 * Verifica formato por regex y validez real del calendario mediante PostgreSQL ($1::timestamptz).
 * Transforma códigos de error de fecha inválida (22007, 22008) en 422 DATOS_INVALIDOS.
 */
export async function validarFechaISO(
  client: pg.PoolClient | pg.Pool,
  valor: unknown,
  campo: string
): Promise<string> {
  if (typeof valor !== 'string' || !ISO_TZ_REGEX.test(valor)) {
    throw new ErrorNegocio(
      422,
      'DATOS_INVALIDOS',
      `El campo ${campo} debe tener formato ISO 8601 con zona horaria explícita (Z o ±hh:mm)`
    );
  }

  try {
    const res = await client.query('SELECT $1::timestamptz AS f', [valor]);
    const d = new Date(res.rows[0].f);
    if (isNaN(d.getTime())) {
      throw new ErrorNegocio(
        422,
        'DATOS_INVALIDOS',
        `El campo ${campo} contiene una fecha inválida`
      );
    }
    return valor;
  } catch (err: any) {
    if (err instanceof ErrorNegocio) throw err;
    if (
      err?.code === '22007' ||
      err?.code === '22008' ||
      err?.message?.includes('date/time field value out of range') ||
      err?.message?.includes('invalid input syntax for type timestamp')
    ) {
      throw new ErrorNegocio(
        422,
        'DATOS_INVALIDOS',
        `El campo ${campo} contiene una fecha u hora inválida`
      );
    }
    throw err;
  }
}
