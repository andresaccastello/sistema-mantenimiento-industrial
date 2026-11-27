import { clienteApi } from './cliente';
import type { CalendarioPreventivos } from './tipos';

/** Los filtros de máquina del calendario, como en los vencimientos. */
export interface FiltrosCalendarioApi {
  plantaId: number | null;
  sectorId: number | null;
  maquinaId: number | null;
}

/** CAL1: `GET /api/planes/calendario`, de `desde` a `hasta` (como mucho 62 días). */
export function obtenerCalendarioPreventivos(
  rango: { desde: string; hasta: string },
  filtros: FiltrosCalendarioApi
): Promise<CalendarioPreventivos> {
  const params: Record<string, string | number> = { desde: rango.desde, hasta: rango.hasta };
  if (filtros.plantaId) params.planta_id = filtros.plantaId;
  if (filtros.sectorId) params.sector_id = filtros.sectorId;
  if (filtros.maquinaId) params.maquina_id = filtros.maquinaId;
  return clienteApi.get<CalendarioPreventivos>('/api/planes/calendario', { params });
}
