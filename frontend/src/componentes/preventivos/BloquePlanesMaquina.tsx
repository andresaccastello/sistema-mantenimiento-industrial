import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Paper, Stack, Group, Title, Button, Divider, Table, Text, Anchor, Badge, Skeleton } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { PlanLista } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { nombreCompleto } from '../../lib/personas';
import { formatFechaDia, textoPendientes } from '../../lib/preventivos';

/** R5: los planes preventivos de la máquina, solo con PLANES_GESTIONAR (PV2, 5.4). */
export function BloquePlanesMaquina({ maquinaId }: { maquinaId: number }) {
  const { tienePermiso } = useAuth();
  const puede = tienePermiso('PLANES_GESTIONAR');

  const { data: planes, isPending } = useQuery<PlanLista[]>({
    queryKey: ['planes', 'maquina', maquinaId],
    queryFn: () => clienteApi.get<PlanLista[]>('/api/planes', { params: { maquina_id: maquinaId, all: 'true' } }),
    enabled: puede,
  });

  if (!puede) return null;

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Title order={4}>Planes preventivos</Title>
          <Button
            component={Link}
            to={`/preventivos/planes/nuevo?maquina=${maquinaId}`}
            size="xs"
            variant="light"
            color="marca"
            leftSection={<IconPlus size={14} />}
          >
            Nuevo plan
          </Button>
        </Group>
        <Divider />

        {isPending ? (
          <Skeleton height={36} />
        ) : (planes ?? []).length === 0 ? (
          <Text size="sm" c="dimmed">
            Esta máquina no tiene planes preventivos.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={560}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ minWidth: 180 }}>Plan</Table.Th>
                  <Table.Th style={{ minWidth: 140 }}>Responsable</Table.Th>
                  <Table.Th style={{ minWidth: 130 }}>Pendientes</Table.Th>
                  <Table.Th style={{ minWidth: 110 }}>Próxima</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(planes ?? []).map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Anchor component={Link} to={`/preventivos/planes/${p.id}`} size="sm" fw={600}>
                          {p.nombre}
                        </Anchor>
                        {!p.activo && (
                          <Badge color="gray" variant="outline" size="sm" style={{ flexShrink: 0 }}>
                            Inactivo
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c={p.responsable ? undefined : 'dimmed'}>
                        {p.responsable ? nombreCompleto(p.responsable) : 'Sin responsable'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{textoPendientes(p)}</Text>
                    </Table.Td>
                    <Table.Td>{formatFechaDia(p.proxima_fecha)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>
    </Paper>
  );
}
