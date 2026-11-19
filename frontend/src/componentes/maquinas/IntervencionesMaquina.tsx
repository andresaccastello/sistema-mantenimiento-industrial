import { Link, useNavigate } from 'react-router';
import { Badge, Divider, Group, Paper, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import type { IntervencionLista } from '../../api/tipos';
import { formatHace } from '../../lib/formato';
import { nombreCompleto } from '../../lib/personas';
import { EstadoBadge } from '../EstadoBadge';

interface Props {
  maquinaId: number;
  cargando: boolean;
  intervenciones: IntervencionLista[];
  total: number;
  ahora: Date;
}

/** 6.9: las últimas intervenciones de la máquina, con los enlaces a la lista. */
export function IntervencionesMaquina({ maquinaId, cargando, intervenciones, total, ahora }: Props) {
  const navigate = useNavigate();
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Intervenciones de esta máquina</Title>
        <Divider />

        {cargando ? (
          <Stack gap="xs">
            <Skeleton height={36} />
            <Skeleton height={36} />
          </Stack>
        ) : intervenciones.length === 0 ? (
          <Text size="sm" c="dimmed">
            Esta máquina no tiene intervenciones.
          </Text>
        ) : (
          <>
            <Table.ScrollContainer minWidth={560}>
              <Table highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>N.º</Table.Th>
                    <Table.Th style={{ minWidth: 130 }}>Estado</Table.Th>
                    <Table.Th>Descripción</Table.Th>
                    <Table.Th>Reportada</Table.Th>
                    <Table.Th>Responsable</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {intervenciones.map((item) => (
                    <Table.Tr
                      key={item.id}
                      onClick={() => navigate(`/intervenciones/${item.id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Table.Td>
                        <Text size="sm" fw={600}>
                          #{item.id}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <EstadoBadge
                          entidad="intervencion"
                          estado={item.estado}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          {item.tipo === 'PREVENTIVO' && <Badge color="teal" variant="light" size="xs" style={{ flexShrink: 0 }}>Preventivo</Badge>}
                          <Text size="sm" lineClamp={1} maw={260}>
                            {item.descripcion}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {formatHace(item.fecha_creacion, ahora)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text
                          size="sm"
                          c={item.responsable ? undefined : 'dimmed'}
                        >
                          {item.responsable
                            ? nombreCompleto(item.responsable)
                            : 'Sin asignar'}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>

            <Group justify="space-between" align="center" wrap="wrap" pt="xs">
              <Group gap="md">
                <Text
                  component={Link}
                  to={`/intervenciones?maquina=${maquinaId}`}
                  size="sm"
                  fw={500}
                  c="blue"
                  style={{ textDecoration: 'none' }}
                >
                  Ver abiertas
                </Text>
                <Text
                  component={Link}
                  to={`/intervenciones?vista=cerradas&maquina=${maquinaId}`}
                  size="sm"
                  fw={500}
                  c="blue"
                  style={{ textDecoration: 'none' }}
                >
                  Ver cerradas
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                Total: {total}
              </Text>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}
