import { Badge, Box, Card, Group, Stack, Text } from '@mantine/core';
import type { IntervencionDetalle } from '../../api/tipos';
import { formatDuracion } from '../../lib/formato';

/** Los tiempos de la intervención: espera, trabajo, total y máquina detenida. */
export function TiemposIntervencion({ reporte }: { reporte: IntervencionDetalle }) {
  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="xs">
        <Text fw={700} size="sm" tt="uppercase" c="#64748b">Tiempos</Text>
        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">Espera hasta empezar</Text>
          <Group gap={6}>
            <Text size="sm" fw={600}>{formatDuracion(reporte.tiempos.espera_minutos)}</Text>
            {reporte.tiempos.espera_en_curso && <Badge color="yellow" variant="light" size="xs">en curso</Badge>}
          </Group>
        </Group>
        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">Duración del trabajo</Text>
          <Group gap={6}>
            <Text size="sm" fw={600}>{formatDuracion(reporte.tiempos.duracion_bruta_minutos)}</Text>
            {reporte.tiempos.trabajo_en_curso && <Badge color="yellow" variant="light" size="xs">en curso</Badge>}
          </Group>
        </Group>
        <Box>
          <Group justify="space-between" align="center">
            <Text size="sm" c="dimmed">Trabajo efectivo</Text>
            <Group gap={6}>
              <Text size="sm" fw={600}>{formatDuracion(reporte.tiempos.duracion_neta_minutos)}</Text>
              {reporte.estado === 'EN_PROCESO' && <Badge color="yellow" variant="light" size="xs">en curso</Badge>}
            </Group>
          </Group>
          <Text size="xs" c="dimmed">sin contar la espera de repuestos</Text>
        </Box>
        <Box>
          <Group justify="space-between" align="center">
            <Text size="sm" c="dimmed">Tiempo total</Text>
            <Text size="sm" fw={600}>{formatDuracion(reporte.tiempos.tiempo_total_minutos)}</Text>
          </Group>
          <Text size="xs" c="dimmed">del reporte al cierre</Text>
        </Box>
        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">Máquina detenida</Text>
          <Group gap={6}>
            <Text size="sm" fw={600}>{formatDuracion(reporte.tiempos.inactividad_minutos)}</Text>
            {reporte.tiempos.inactividad_en_curso && <Badge color="yellow" variant="light" size="xs">en curso</Badge>}
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}
