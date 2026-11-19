import { Stack, Text, Tooltip } from '@mantine/core';
import type { UsoTareaPlan } from '../../api/tipos';
import { TEXTO_ESTIMADA_PASADA, formatoEstimada, tooltipEstimada } from '../../lib/estimacion';

/**
 * HE1, 6: debajo de lo que ya se ve por uso, la fecha estimada: "≈ 06/12 (estimada)", con la
 * fuente y el ritmo en el tooltip. Si ya debería haber llegado, el aviso en naranja.
 */
export function TextoEstimada({ uso }: { uso: UsoTareaPlan | null }) {
  const e = uso?.estimacion;
  if (!uso || !e) return null;
  return (
    <Stack gap={0}>
      <Tooltip label={tooltipEstimada(e, uso.medidor.unidad)} withArrow>
        <Text size="xs" c="dimmed" style={{ cursor: 'help', alignSelf: 'flex-start' }}>
          {formatoEstimada(e.fecha)} (estimada)
        </Text>
      </Tooltip>
      {e.pasada && (
        <Text size="xs" fw={500} c="var(--sm-aviso-texto)">
          {TEXTO_ESTIMADA_PASADA}
        </Text>
      )}
    </Stack>
  );
}
