import { Stack, Text, Divider } from '@mantine/core';
import type { UsoTareaPlan } from '../../api/tipos';
import { formatFechaDia, textoProximoUso, textoUso, textoVencimiento } from '../../lib/preventivos';

interface Props {
  proxima_fecha: string | null;
  dias: number | null;
  uso: UsoTareaPlan | null;
}

/**
 * "Próxima" de una tarea (PV4, 4.2), y "Vence" en los vencimientos: la fecha con
 * textoVencimiento si tiene fecha, y textoProximoUso con textoUso si tiene uso. Con las
 * dos, una debajo de la otra.
 */
export function CeldaProxima({ proxima_fecha, dias, uso }: Props) {
  const fecha =
    proxima_fecha !== null && dias !== null ? (
      <div>
        <Text size="sm">{formatFechaDia(proxima_fecha)}</Text>
        <Text size="xs" c="dimmed">
          {textoVencimiento(dias)}
        </Text>
      </div>
    ) : null;
  const porUso = uso ? (
    <div>
      <Text size="sm">{textoProximoUso(uso)}</Text>
      <Text size="xs" c="dimmed">
        {textoUso(uso)}
      </Text>
    </div>
  ) : null;

  if (!fecha && !porUso) return <Text size="sm">—</Text>;
  return (
    <Stack gap={4}>
      {fecha}
      {fecha && porUso && <Divider variant="dashed" />}
      {porUso}
    </Stack>
  );
}
