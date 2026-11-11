import type { QueryClient } from '@tanstack/react-query';

/**
 * Lo que cambia al guardar un medidor o una lectura (PV4, 3.2): los medidores de la
 * máquina (y sus lecturas), los planes, los vencimientos y el tablero. Por prefijo.
 */
export const CONSULTAS_MEDIDORES = [['medidores'], ['planes'], ['plan'], ['vencimientos'], ['tablero']];

export async function refrescarMedidores(queryClient: QueryClient): Promise<void> {
  for (const clave of CONSULTAS_MEDIDORES) {
    await queryClient.invalidateQueries({ queryKey: clave });
  }
}
