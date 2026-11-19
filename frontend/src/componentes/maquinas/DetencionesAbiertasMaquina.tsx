import { Link } from 'react-router';
import { Divider, Group, Paper, Stack, Text, Title } from '@mantine/core';
import type { DetencionAbiertaMaquina } from '../../api/tipos';
import { formatFechaHora, formatHace } from '../../lib/formato';
import { EstadoBadge } from '../EstadoBadge';

/** 6.4: las detenciones abiertas de la máquina, cada una con su intervención. */
export function DetencionesAbiertasMaquina({
  detenciones,
  ahora,
}: {
  detenciones: DetencionAbiertaMaquina[];
  ahora: Date;
}) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Detenciones abiertas</Title>
        <Divider />
        <Stack gap="sm">
          {detenciones.map((d) => (
            <Paper key={d.periodo.id} withBorder p="sm" radius="sm">
              <Stack gap={4}>
                <Text size="sm">
                  desde {formatFechaHora(d.periodo.desde)} ·{' '}
                  {formatHace(d.periodo.desde, ahora)} ·{' '}
                  <Text span fw={700} c="red">
                    sigue detenida
                  </Text>
                </Text>

                {(d.periodo.observacion || d.periodo.abierto_por_nombre) && (
                  <Text size="sm" c="dimmed">
                    {d.periodo.observacion
                      ? `${d.periodo.observacion}${
                          d.periodo.abierto_por_nombre
                            ? ` (${d.periodo.abierto_por_nombre})`
                            : ''
                        }`
                      : `Abierta por ${d.periodo.abierto_por_nombre}`}
                  </Text>
                )}

                <Group gap="xs" wrap="wrap" mt={2}>
                  <Text
                    component={Link}
                    to={`/intervenciones/${d.intervencion.id}`}
                    size="sm"
                    fw={600}
                    c="blue"
                    style={{ textDecoration: 'none' }}
                  >
                    Intervención N.º {d.intervencion.id}
                  </Text>
                  <EstadoBadge
                    entidad="intervencion"
                    estado={d.intervencion.estado}
                  />
                  <Text size="xs" c="dimmed">
                    {d.intervencion.responsable_nombre || 'Sin asignar'}
                  </Text>
                </Group>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}
