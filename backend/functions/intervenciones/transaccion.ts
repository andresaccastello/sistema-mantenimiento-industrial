import pg from 'pg';
import { pool } from '../db.ts';
import { ErrorNegocio } from './errores.ts';

/**
 * Ejecuta una operación dentro de una transacción interactiva con timeout de bloqueo estricto.
 */
export async function conTransaccion<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  const lockTimeout = process.env.LOCK_TIMEOUT || '5s';

  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '${lockTimeout}'`);

    const result = await fn(client);

    await client.query('COMMIT');
    return result;
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error durante rollback:', rollbackError);
    }

    // 55P03: lock_not_available
    if (error && error.code === '55P03') {
      throw new ErrorNegocio(
        409,
        'RECURSO_OCUPADO',
        'El recurso se encuentra bloqueado por otra operación en curso'
      );
    }

    throw error;
  } finally {
    client.release();
  }
}
