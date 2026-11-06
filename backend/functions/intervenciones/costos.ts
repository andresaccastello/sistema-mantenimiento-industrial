import { PoolClient } from 'pg';
import { ErrorNegocio } from './errores.ts';

/**
 * Recalcula los costos de una intervención (D-018 y D-019):
 * - costo_repuestos: los consumos no anulados;
 * - costo_mano_obra: los renglones MANO_OBRA no anulados;
 * - costo_total_estimado: costo_repuestos más todos los renglones no anulados.
 *
 * Todo se suma en SQL, con numeric. Si el total daría negativo, lanza 409
 * TOTAL_NEGATIVO con total_resultante antes de escribir nada: quien llama
 * revierte la transacción entera.
 */
export async function recalcularCostosIntervencion(
  client: PoolClient,
  intervencionId: number
): Promise<{ costoRepuestos: number; costoManoObra: number; costoTotal: number }> {
  await client.query('SELECT id FROM intervenciones WHERE id = $1 FOR UPDATE', [intervencionId]);

  const res = await client.query(
    `SELECT
       r.repuestos,
       c.mano_obra,
       (r.repuestos + c.renglones)::numeric(14,2) AS total
     FROM
       (SELECT COALESCE(SUM(ROUND(cantidad * costo_unitario_aplicado, 2)), 0)::numeric(14,2) AS repuestos
          FROM intervencion_repuestos
         WHERE intervencion_id = $1 AND anulado_en IS NULL) r,
       (SELECT COALESCE(SUM(importe) FILTER (WHERE tipo = 'MANO_OBRA'), 0)::numeric(14,2) AS mano_obra,
               COALESCE(SUM(importe), 0)::numeric(14,2) AS renglones
          FROM intervencion_costos
         WHERE intervencion_id = $1 AND anulado_en IS NULL) c`,
    [intervencionId]
  );

  const costoRepuestos = Number(res.rows[0].repuestos);
  const costoManoObra = Number(res.rows[0].mano_obra);
  const costoTotal = Number(res.rows[0].total);

  if (costoTotal < 0) {
    throw new ErrorNegocio(
      409,
      'TOTAL_NEGATIVO',
      'El total de la intervención no puede quedar negativo',
      { total_resultante: costoTotal }
    );
  }

  await client.query(
    `UPDATE intervenciones
     SET costo_repuestos = $1::numeric, costo_mano_obra = $2::numeric,
         costo_total_estimado = $3::numeric, actualizado_en = NOW()
     WHERE id = $4`,
    [res.rows[0].repuestos, res.rows[0].mano_obra, res.rows[0].total, intervencionId]
  );

  return { costoRepuestos, costoManoObra, costoTotal };
}
