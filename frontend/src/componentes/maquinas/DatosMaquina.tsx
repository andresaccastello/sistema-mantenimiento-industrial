import { Divider, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import type { MaquinaLista } from '../../api/tipos';
import { formatFechaHora } from '../../lib/formato';
import { CriticidadBadge } from '../CriticidadBadge';

/** La ficha de la máquina: el bloque "Datos" del detalle. */
export function DatosMaquina({ maquina }: { maquina: MaquinaLista }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Datos</Title>
        <Divider />

        <SimpleGrid cols={2} spacing="xs">
          <div>
            <Text size="xs" c="dimmed">
              Código
            </Text>
            <Text size="sm" fw={500}>
              {maquina.codigo || '—'}
            </Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Marca y modelo
            </Text>
            <Text size="sm" fw={500}>
              {maquina.modelo || '—'}
            </Text>
          </div>
        </SimpleGrid>

        <SimpleGrid cols={2} spacing="xs">
          <div>
            <Text size="xs" c="dimmed">
              Tipo de equipo
            </Text>
            <Text size="sm" fw={500}>
              {maquina.tipo_equipo?.nombre || '—'}
            </Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Criticidad
            </Text>
            <div style={{ marginTop: 2 }}>
              <CriticidadBadge criticidad={maquina.criticidad} />
            </div>
          </div>
        </SimpleGrid>

        <SimpleGrid cols={2} spacing="xs">
          <div>
            <Text size="xs" c="dimmed">
              Sector
            </Text>
            <Text size="sm" fw={500}>
              {maquina.sector?.nombre || '—'}
            </Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Planta
            </Text>
            <Text size="sm" fw={500}>
              {maquina.sector?.planta?.nombre || '—'}
            </Text>
          </div>
        </SimpleGrid>

        <div>
          <Text size="xs" c="dimmed">
            Ubicación
          </Text>
          <Text size="sm">{maquina.ubicacion || '—'}</Text>
        </div>

        <div>
          <Text size="xs" c="dimmed">
            Notas de mantenimiento
          </Text>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {maquina.observaciones || '—'}
          </Text>
        </div>

        <div>
          <Text size="xs" c="dimmed">
            Alta
          </Text>
          <Text size="sm">{formatFechaHora(maquina.creado_en)}</Text>
        </div>
      </Stack>
    </Paper>
  );
}
