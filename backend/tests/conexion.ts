import pg from 'pg';
import { pool } from '../functions/db.ts';

const INTENTOS = 3;
const ESPERA_MS = 2000;

/**
 * Devuelve un cliente que anda. Si el que recibe responde a SELECT 1, es ese. Si no, lo
 * destruye y pide otro al pool, con hasta 3 intentos y 2 segundos entre uno y otro.
 */
export async function clienteSano(cliente: pg.PoolClient): Promise<pg.PoolClient> {
  try {
    await cliente.query('SELECT 1');
    return cliente;
  } catch {
    cliente.release(true);
  }

  console.error('[pruebas] Se cortó la conexión de la prueba: sigo con una nueva.');
  for (let intento = 1; ; intento++) {
    try {
      return await pool.connect();
    } catch (err) {
      if (intento >= INTENTOS) throw err;
      await new Promise((resolve) => setTimeout(resolve, ESPERA_MS));
    }
  }
}
