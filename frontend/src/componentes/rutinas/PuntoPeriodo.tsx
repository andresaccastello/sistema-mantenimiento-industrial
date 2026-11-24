import { Box, Tooltip } from '@mantine/core';
import type { EstadoPeriodoRutina } from '../../api/tipos';
import { estadoVisual } from '../../lib/rutinas';

interface Props {
  estado: EstadoPeriodoRutina;
  tooltip: string;
  tamanio?: number;
}

/** RT1, 5: un período como punto: verde hecha, rojo no hecha, gris con borde pendiente. */
export function PuntoPeriodo({ estado, tooltip, tamanio = 12 }: Props) {
  const v = estadoVisual(estado);
  return (
    <Tooltip label={tooltip} withArrow multiline maw={280}>
      <Box
        role="img"
        aria-label={tooltip}
        style={{
          width: tamanio,
          height: tamanio,
          borderRadius: '50%',
          flexShrink: 0,
          backgroundColor: v.fondo,
          border: v.borde ? `2px solid ${v.borde}` : undefined,
        }}
      />
    </Tooltip>
  );
}
