import { Link } from 'react-router';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Stack, SimpleGrid, Switch, Table, Text, Anchor, Badge, Group, Center, Loader, Alert } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { PlanLista } from '../../api/tipos';
import { mensajeError } from '../../lib/errores';
import { etiquetaMaquina } from '../../lib/maquinas';
import { nombreCompleto } from '../../lib/personas';
import { FiltrosPreventivos, formatFechaDia, paramsPlanes, textoPendientes } from '../../lib/preventivos';
import { PantallaVacia } from '../PantallaVacia';
import { FiltrosMaquinaPreventivos } from './FiltrosMaquinaPreventivos';

interface Props {
  filtros: FiltrosPreventivos;
  onCambiarFiltros: (parcial: Partial<FiltrosPreventivos>) => void;
}

/** P1, pestaña Planes. */
export function TabPlanes({ filtros, onCambiarFiltros }: Props) {
  const params = paramsPlanes(filtros);
  const { data: planes, isLoading, isError, error } = useQuery<PlanLista[]>({
    queryKey: ['planes', 'lista', params],
    queryFn: () => clienteApi.get<PlanLista[]>('/api/planes', { params }),
    placeholderData: keepPreviousData,
  });

  const conFiltros = filtros.plantaId !== null || filtros.sectorId !== null || filtros.maquinaId !== null;

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
        <FiltrosMaquinaPreventivos filtros={filtros} onCambiar={onCambiarFiltros} />
        <Group align="center">
          <Switch
            label="Ver inactivos"
            checked={filtros.inactivos}
            onChange={(e) => onCambiarFiltros({ inactivos: e.currentTarget.checked })}
          />
        </Group>
      </SimpleGrid>

      {isError && (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {mensajeError(error)}
        </Alert>
      )}

      {isLoading && !planes ? (
        <Center py="xl">
          <Loader color="marca" />
        </Center>
      ) : (planes ?? []).length === 0 ? (
        conFiltros || filtros.inactivos ? (
          <PantallaVacia titulo="No hay planes con estos filtros." />
        ) : (
          <PantallaVacia
            titulo="Todavía no hay planes preventivos."
            mensaje="Creá el primero con «Nuevo plan» o desde la ficha de una máquina."
          />
        )
      ) : (
        <Table.ScrollContainer minWidth={820}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ minWidth: 200 }}>Plan</Table.Th>
                <Table.Th style={{ minWidth: 160 }}>Máquina</Table.Th>
                <Table.Th style={{ minWidth: 140 }}>Responsable</Table.Th>
                <Table.Th style={{ minWidth: 80 }}>Tareas</Table.Th>
                <Table.Th style={{ minWidth: 140 }}>Pendientes</Table.Th>
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
                    <Text size="sm">{etiquetaMaquina(p.maquina)}</Text>
                    <Text size="xs" c="dimmed">
                      {p.maquina.sector.nombre}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={p.responsable ? undefined : 'dimmed'}>
                      {p.responsable ? nombreCompleto(p.responsable) : 'Sin responsable'}
                    </Text>
                  </Table.Td>
                  <Table.Td>{p.tareas_activas}</Table.Td>
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
  );
}
