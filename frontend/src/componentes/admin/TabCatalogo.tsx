import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Stack,
  Group,
  Button,
  Paper,
  Table,
  Badge,
  ActionIcon,
  Menu,
  Skeleton,
  Alert,
  Text,
} from '@mantine/core';
import {
  IconPlus,
  IconArrowUp,
  IconArrowDown,
  IconDotsVertical,
  IconCheck,
  IconBan,
  IconRotateClockwise,
  IconAlertCircle,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { CriticidadAdmin, TipoEquipoAdmin } from '../../api/tipos';
import { moverEnOrden, motivoNoDesactivableCatalogo } from '../../lib/catalogos';
import { mensajeError } from '../../lib/errores';

export interface TabCatalogoProps {
  tipo: 'criticidad' | 'tipo_equipo';
  items: (CriticidadAdmin | TipoEquipoAdmin)[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onNuevo: () => void;
  onEditar: (item: CriticidadAdmin | TipoEquipoAdmin) => void;
  onMarcarPorOmision: (id: number, nombre: string) => void;
  onDesactivar: (id: number, nombre: string, motivo: string | null) => void;
  onReactivar: (id: number, nombre: string) => void;
}

export function TabCatalogo({
  tipo,
  items,
  isLoading,
  isError,
  error,
  onNuevo,
  onEditar,
  onMarcarPorOmision,
  onDesactivar,
  onReactivar,
}: TabCatalogoProps) {
  const queryClient = useQueryClient();
  const [reordenando, setReordenando] = useState(false);

  const esCriticidad = tipo === 'criticidad';
  const basePath = esCriticidad ? '/api/criticidades' : '/api/tipos-equipo';
  const cacheKey = esCriticidad ? 'criticidades' : 'tipos-equipo';

  const handleMover = async (id: number, direccion: 'arriba' | 'abajo') => {
    const ids = items.map((i) => i.id);
    const nuevoOrden = moverEnOrden(ids, id, direccion === 'arriba' ? -1 : 1);
    setReordenando(true);
    try {
      await clienteApi.put(`${basePath}/orden`, { orden: nuevoOrden });
      await queryClient.invalidateQueries({ queryKey: [cacheKey] });
      await queryClient.invalidateQueries({ queryKey: ['tablero'] });
      await queryClient.invalidateQueries({ queryKey: ['maquinas'] });
    } catch (err: any) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setReordenando(false);
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        {esCriticidad ? (
          <div>
            <Text size="sm" c="dimmed">
              El orden se usa en el tablero: las máquinas más críticas aparecen primero.
            </Text>
          </div>
        ) : (
          <div />
        )}
        <Button leftSection={<IconPlus size={16} />} onClick={onNuevo}>
          {esCriticidad ? 'Nueva criticidad' : 'Nuevo tipo de equipo'}
        </Button>
      </Group>

      {isLoading ? (
        <Skeleton height={200} />
      ) : isError ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {mensajeError(error)}
        </Alert>
      ) : (
        <Paper withBorder radius="sm">
          <Table.ScrollContainer minWidth={500}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={80}>Orden</Table.Th>
                  <Table.Th>Nombre</Table.Th>
                  {esCriticidad && <Table.Th>Prioridad alta</Table.Th>}
                  <Table.Th>Máquinas activas</Table.Th>
                  <Table.Th w={100}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((item, idx) => {
                  const criticidad = esCriticidad ? (item as CriticidadAdmin) : null;
                  return (
                    <Table.Tr key={item.id} style={{ opacity: item.activo ? 1 : 0.6 }}>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            aria-label="Subir"
                            disabled={idx === 0 || reordenando}
                            onClick={() => handleMover(item.id, 'arriba')}
                          >
                            <IconArrowUp size={16} />
                          </ActionIcon>
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            aria-label="Bajar"
                            disabled={idx === items.length - 1 || reordenando}
                            onClick={() => handleMover(item.id, 'abajo')}
                          >
                            <IconArrowDown size={16} />
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs" wrap="nowrap">
                          <div>
                            <Text size="sm" fw={500}>
                              {item.nombre}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {item.codigo}
                            </Text>
                          </div>
                          {item.por_omision && (
                            <Badge color="blue" size="sm" variant="light">
                              Por omisión
                            </Badge>
                          )}
                          {!item.activo && (
                            <Badge color="gray" size="sm" variant="outline">
                              {esCriticidad ? 'Desactivada' : 'Desactivado'}
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      {esCriticidad && (
                        <Table.Td>
                          <Text size="sm">{criticidad?.prioridad_alta ? 'Sí' : ''}</Text>
                        </Table.Td>
                      )}
                      <Table.Td>
                        <Text size="sm">{item.maquinas_activas}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6} justify="flex-end">
                          <Button
                            variant="subtle"
                            size="xs"
                            onClick={() => onEditar(item)}
                          >
                            Editar
                          </Button>
                          <Menu shadow="md" position="bottom-end">
                            <Menu.Target>
                              <ActionIcon variant="subtle" color="gray" size="sm">
                                <IconDotsVertical size={16} />
                              </ActionIcon>
                            </Menu.Target>
                            <Menu.Dropdown>
                              {!item.por_omision && item.activo && (
                                <Menu.Item
                                  leftSection={<IconCheck size={14} />}
                                  onClick={() => onMarcarPorOmision(item.id, item.nombre)}
                                >
                                  Marcar por omisión
                                </Menu.Item>
                              )}
                              {item.activo ? (
                                <Menu.Item
                                  color="red"
                                  leftSection={<IconBan size={14} />}
                                  onClick={() =>
                                    onDesactivar(
                                      item.id,
                                      item.nombre,
                                      motivoNoDesactivableCatalogo(
                                        item,
                                        esCriticidad ? 'criticidad' : 'tipo'
                                      )
                                    )
                                  }
                                >
                                  Desactivar
                                </Menu.Item>
                              ) : (
                                <Menu.Item
                                  leftSection={<IconRotateClockwise size={14} />}
                                  onClick={() => onReactivar(item.id, item.nombre)}
                                >
                                  Reactivar
                                </Menu.Item>
                              )}
                            </Menu.Dropdown>
                          </Menu>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
    </Stack>
  );
}
