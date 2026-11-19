import pg from 'pg';
import { ErrorNegocio } from './intervenciones/errores.ts';
import { validarFechaISO } from './intervenciones/fechas.ts';

/**
 * Validador de intervalos de fechas para reportes y consultas de inactividad (Etapa 8).
 * - desde y hasta: ISO con zona horaria explícita.
 * - Si se omiten: por defecto los últimos 30 días hasta NOW().
 * - Si desde >= hasta: 422 DATOS_INVALIDOS.
 * - Si el intervalo supera los 366 días: 422 DATOS_INVALIDOS.
 */
export async function validarIntervaloReporte(
  client: pg.PoolClient | pg.Pool,
  desdeQuery?: string | null,
  hastaQuery?: string | null
): Promise<{ desde: string; hasta: string }> {
  let hasta: string;
  let desde: string;

  if (hastaQuery !== undefined && hastaQuery !== null && hastaQuery.trim() !== '') {
    hasta = await validarFechaISO(client, hastaQuery.trim(), 'hasta');
  } else {
    const resNow = await client.query('SELECT NOW() AS ahora');
    hasta = new Date(resNow.rows[0].ahora).toISOString();
  }

  if (desdeQuery !== undefined && desdeQuery !== null && desdeQuery.trim() !== '') {
    desde = await validarFechaISO(client, desdeQuery.trim(), 'desde');
  } else {
    const res30d = await client.query("SELECT ($1::timestamptz - INTERVAL '30 days') AS d", [hasta]);
    desde = new Date(res30d.rows[0].d).toISOString();
  }

  const resComp = await client.query(
    `SELECT
       ($1::timestamptz >= $2::timestamptz) AS es_mayor_o_igual,
       (($2::timestamptz - $1::timestamptz) > INTERVAL '366 days') AS excede_maximo`,
    [desde, hasta]
  );

  if (resComp.rows[0].es_mayor_o_igual) {
    throw new ErrorNegocio(
      422,
      'DATOS_INVALIDOS',
      'La fecha desde debe ser anterior a la fecha hasta'
    );
  }

  if (resComp.rows[0].excede_maximo) {
    throw new ErrorNegocio(
      422,
      'DATOS_INVALIDOS',
      'El intervalo solicitado no puede superar los 366 días'
    );
  }

  return { desde, hasta };
}
