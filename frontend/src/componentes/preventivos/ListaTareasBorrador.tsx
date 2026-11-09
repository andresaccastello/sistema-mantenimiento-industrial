import { Stack, Paper, Group, Text, Button } from '@mantine/core';
import { IconEdit, IconTrash } from '@tabler/icons-react';
import { BorradorTarea, formatFechaDia, textoFrecuencia } from '../../lib/preventivos';

interface Props {
  tareas: BorradorTarea[];
  /** El error de la API para una tarea, por su posición. */
  errores: Record<number, string>;
  onEditar: (indice: number) => void;
  onQuitar: (indice: number) => void;
}

/** P3: las tareas del plan nuevo, antes de guardarlo. */
export function ListaTareasBorrador({ tareas, errores, onEditar, onQuitar }: Props) {
  return (
    <Stack gap="xs">
      {tareas.map((t, i) => {
        const valor = Number(String(t.frecuenciaValor).replace(',', '.'));
        const error = errores[i];
        return (
          <Paper
            key={i}
            withBorder
            p="sm"
            style={error ? { borderColor: 'var(--mantine-color-red-6)' } : undefined}
          >
            <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
              <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" fw={500}>
                  {i + 1}. {t.accion}
                </Text>
                <Text size="xs" c="dimmed">
                  {Number.isInteger(valor) ? textoFrecuencia(valor, t.frecuenciaUnidad) : ''} · Primera vez:{' '}
                  {formatFechaDia(t.primeraFecha)}
                </Text>
                {error && (
                  <Text size="xs" c="red">
                    {error}
                  </Text>
                )}
              </Stack>
              <Group gap={4}>
                <Button size="xs" variant="subtle" leftSection={<IconEdit size={14} />} onClick={() => onEditar(i)}>
                  Editar
                </Button>
                <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={() => onQuitar(i)}>
                  Quitar
                </Button>
              </Group>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}
