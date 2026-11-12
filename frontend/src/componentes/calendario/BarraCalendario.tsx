import { ActionIcon, Box, Button, Group, SegmentedControl, Text, Title } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import {
  LEYENDA_CALENDARIO,
  ParamsCalendario,
  VistaCalendario,
  moverPeriodo,
  textoTituloPeriodo,
} from '../../lib/calendario';

interface Props {
  actual: ParamsCalendario;
  hoy: string;
  onIr: (c: ParamsCalendario) => void;
}

/** CAL1, 3.1 y 3.6: ‹ ›, "Hoy", el título del período, Mes / Semana y la leyenda. */
export function BarraCalendario({ actual, hoy, onIr }: Props) {
  const { vista, fecha } = actual;
  return (
    <Box>
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap="xs" wrap="nowrap">
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Período anterior"
            onClick={() => onIr({ vista, fecha: moverPeriodo(vista, fecha, -1) })}
          >
            <IconChevronLeft size={18} />
          </ActionIcon>
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Período siguiente"
            onClick={() => onIr({ vista, fecha: moverPeriodo(vista, fecha, 1) })}
          >
            <IconChevronRight size={18} />
          </ActionIcon>
          <Button variant="default" onClick={() => onIr({ vista, fecha: hoy })}>
            Hoy
          </Button>
          <Title order={4} c="#0f172a" ml="xs">
            {textoTituloPeriodo(vista, fecha)}
          </Title>
        </Group>
        <SegmentedControl
          value={vista}
          onChange={(v) => onIr({ vista: v as VistaCalendario, fecha })}
          data={[
            { value: 'mes', label: 'Mes' },
            { value: 'semana', label: 'Semana' },
          ]}
        />
      </Group>

      <Group gap="md" mt="xs" wrap="wrap">
        {LEYENDA_CALENDARIO.map((l) => (
          <Group key={l.texto} gap={6} wrap="nowrap">
            <Box
              w={12}
              h={12}
              style={{
                borderRadius: 3,
                background: l.prevista ? 'transparent' : `var(--mantine-color-${l.color}-6)`,
                border: l.prevista ? '1px dashed var(--mantine-color-gray-6)' : undefined,
              }}
            />
            <Text size="xs" c="dimmed">
              {l.texto}
            </Text>
          </Group>
        ))}
      </Group>
    </Box>
  );
}
