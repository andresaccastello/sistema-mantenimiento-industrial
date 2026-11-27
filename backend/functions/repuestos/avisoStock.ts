import { PoolClient } from 'pg';
import { encolarEnvios, usuarioSistemaId, usuariosConPermiso } from '../intervenciones/notificaciones.ts';
import { formatearCantidad } from './validaciones.ts';

/**
 * AV1, 3: el aviso de stock bajo (D-034). Se llama con la fila del repuesto ya bloqueada, dentro
 * de la transacción del movimiento (moverStock) o de la edición del mínimo.
 *
 * - Con mínimo, stock <= mínimo y sin marca: avisa a quienes tienen NOTIFICACIONES_STOCK_RECIBIR
 *   y pone la marca (una sola vez hasta que se repone).
 * - Con stock > mínimo: limpia la marca.
 * - Sin mínimo o sin control de stock: no hace nada.
 *
 * El aviso va en un SAVEPOINT: si falla, se deshace solo el aviso (la marca queda sin poner, así
 * que el próximo movimiento lo vuelve a intentar), se registra en el log y el movimiento sigue.
 */
export async function revisarStockBajo(client: PoolClient, repuestoId: number): Promise<void> {
  const res = await client.query(
    `SELECT r.id, r.nombre, r.unidad, r.lleva_stock, r.cantidad_disponible, r.stock_minimo, r.stock_bajo_avisado_en,
            COALESCE(p.nombre, r.proveedor) AS proveedor_nombre
     FROM repuestos r
     LEFT JOIN proveedores p ON p.id = r.proveedor_id
     WHERE r.id = $1`,
    [repuestoId]
  );
  if (res.rows.length === 0) return;
  const r = res.rows[0];
  if (!r.lleva_stock || r.stock_minimo === null) return;

  const cantidad = Number(r.cantidad_disponible);
  const minimo = Number(r.stock_minimo);

  if (cantidad > minimo) {
    if (r.stock_bajo_avisado_en !== null) {
      await client.query('UPDATE repuestos SET stock_bajo_avisado_en = NULL WHERE id = $1', [repuestoId]);
    }
    return;
  }
  if (r.stock_bajo_avisado_en !== null) return;

  await client.query('SAVEPOINT aviso_stock_bajo');
  try {
    const sistemaId = await usuarioSistemaId(client);
    const destinatarios = await usuariosConPermiso(client, 'NOTIFICACIONES_STOCK_RECIBIR');
    const titulo = `Stock bajo: ${r.nombre}`;
    let mensaje = `Quedan ${formatearCantidad(cantidad)} ${r.unidad} (mínimo: ${formatearCantidad(minimo)}).`;
    if (r.proveedor_nombre) mensaje += ` Proveedor habitual: ${r.proveedor_nombre}`;

    if (destinatarios.length > 0) {
      const ins = await client.query(
        `INSERT INTO notificaciones (
           usuario_id, tipo_evento, prioridad, titulo, mensaje, repuesto_id, generada_por_usuario_id, creada_en
         )
         SELECT u_id, 'STOCK_BAJO', 'NORMAL', $2, $3, $4, $5, NOW()
         FROM UNNEST($1::bigint[]) AS t(u_id)
         RETURNING id`,
        [destinatarios.map((d) => d.usuario_id), titulo, mensaje, repuestoId, sistemaId]
      );
      await encolarEnvios(client, ins.rows.map((x: any) => Number(x.id)));
    }
    await client.query('UPDATE repuestos SET stock_bajo_avisado_en = NOW() WHERE id = $1', [repuestoId]);
    await client.query('RELEASE SAVEPOINT aviso_stock_bajo');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT aviso_stock_bajo');
    console.error(`No se pudo generar el aviso de stock bajo del repuesto ${repuestoId}:`, err);
  }
}
