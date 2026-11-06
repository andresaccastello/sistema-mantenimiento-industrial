import { PoolClient } from 'pg';

export async function recalcularCostosIntervencion(
  client: PoolClient,
  intervencionId: number
): Promise<{ costoRepuestos: number; costoTotal: number }> {
  const res = await client.query(
    `SELECT COALESCE(SUM(ROUND(cantidad * costo_unitario_aplicado, 2)), 0)::numeric(14,2) AS total_repuestos
     FROM intervencion_repuestos
     WHERE intervencion_id = $1 AND anulado_en IS NULL`,
    [intervencionId]
  );
  const costoRepuestos = Number(res.rows[0].total_repuestos);

  const intRes = await client.query(
    'SELECT costo_mano_obra FROM intervenciones WHERE id = $1 FOR UPDATE',
    [intervencionId]
  );
  const costoManoObra = Number(intRes.rows[0]?.costo_mano_obra || 0);
  const costoTotal = Number((costoManoObra + costoRepuestos).toFixed(2));

  await client.query(
    `UPDATE intervenciones
     SET costo_repuestos = $1, costo_total_estimado = $2, actualizado_en = NOW()
     WHERE id = $3`,
    [costoRepuestos, costoTotal, intervencionId]
  );

  return { costoRepuestos, costoTotal };
}
