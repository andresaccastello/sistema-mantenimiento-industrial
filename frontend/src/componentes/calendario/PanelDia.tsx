import { Link } from 'react-router';
import { Button, Drawer, Group, Paper, Stack, Text } from '@mantine/core';
import type { EventoCalendario } from '../../api/tipos';
import { textoDia } from '../../lib/calendario';
import { etiquetaMaquina } from '../../lib/maquinas';
import { nombreCompleto } from '../../lib/personas';
import { CriticidadBadge } from '../CriticidadBadge';
import { PantallaVacia } from '../PantallaVacia';
import { BadgeEvento } from './PiezasEvento';

interface Props {
  fecha: string | null;
  eventos: EventoCalendario[];
  onCerrar: () => void;
}

/** CAL1, 3.4: todos los eventos del día, en el orden de la API. */
export function PanelDia({ fecha, eventos, onCerrar }: Props) {
  return (
    <Drawer
      opened={fecha !== null}
      onClose={onCerrar}
      position="right"
      size="md"
      title={<Text fw={700}>{fecha ? textoDia(fecha) : ''}</Text>}
    >
      {eventos.length === 0 ? (
        <PantallaVacia titulo="No hay preventivos este día." />
      ) : (
        <Stack gap="sm">
          {eventos.map((e, i) => (
            <Paper key={`${e.tipo}-${e.tarea_id}-${e.intervencion?.id ?? i}`} withBorder p="sm" radius="md">
              <Stack gap={6}>
                <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                  <Text size="sm" fw={600}>
                    {e.accion}
                  </Text>
                  <BadgeEvento evento={e} />
                </Group>
                <Group gap="xs" wrap="wrap">
                  <Text size="sm">{etiquetaMaquina(e.maquina)}</Text>
                  <CriticidadBadge criticidad={e.maquina.criticidad} size="xs" />
                </Group>
                <Text size="xs" c="dimmed">
                  Plan: {e.plan.nombre} · Sector: {e.sector.nombre}
                </Text>
                <Text size="xs" c="dimmed">
                  Responsable: {e.responsable ? nombreCompleto(e.responsable) : 'Sin responsable'}
                </Text>
                {e.vencida_por_uso && (
                  <Text size="xs" c="red" fw={500}>
                    Venció por uso
                  </Text>
                )}
                {e.tambien_por_uso && (
                  <Text size="xs" c="orange.8">
                    También vence por uso: puede tocar antes
                  </Text>
                )}
                <Group gap="xs" mt={4}>
                  <Button component={Link} to={`/preventivos/planes/${e.plan.id}`} size="xs" variant="light" color="marca">
                    Ver plan
                  </Button>
                  {e.intervencion && (
                    <Button component={Link} to={`/intervenciones/${e.intervencion.id}`} size="xs" variant="default">
                      Ver intervención
                    </Button>
                  )}
                </Group>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </Drawer>
  );
}
