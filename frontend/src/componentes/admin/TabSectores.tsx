import { useState } from 'react';
import { Link } from 'react-router';
import {
  Stack,
  Group,
  Button,
  Paper,
  Table,
  Badge,
  Switch,
  ActionIcon,
  Menu,
  Skeleton,
  Alert,
  Text,
} from '@mantine/core';
import {
  IconPlus,
  IconDotsVertical,
  IconBan,
  IconRotateClockwise,
  IconAlertCircle,
} from '@tabler/icons-react';
import { SectorAdmin } from '../../api/tipos';
import { motivoNoDesactivableSector } from '../../lib/catalogos';
import { mensajeError } from '../../lib/errores';

export interface TabSectoresProps {
  sectores: SectorAdmin[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  puedeGestionarUsuarios: boolean;
  onNuevoSector: () => void;
  onEditarSector: (sector: SectorAdmin) => void;
  onDesactivarSector: (id: number, nombre: string, motivo: string | null) => void;
  onReactivarSector: (id: number, nombre: string) => void;
}

export function TabSectores({
  sectores,
  isLoading,
  isError,
  error,
  puedeGestionarUsuarios,
  onNuevoSector,
  onEditarSector,
  onDesactivarSector,
  onReactivarSector,
}: TabSectoresProps) {
  const [verDesactivados, setVerDesactivados] = useState(false);

  const sectoresFiltrados = sectores.filter((s) => verDesactivados || s.activo);

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Switch
          label="Ver desactivados"
          checked={verDesactivados}
          onChange={(e) => setVerDesactivados(e.currentTarget.checked)}
        />
        <Button leftSection={<IconPlus size={16} />} onClick={onNuevoSector}>
          Nuevo sector
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
          <Table.ScrollContainer minWidth={600}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Sector</Table.Th>
                  <Table.Th>Planta</Table.Th>
                  <Table.Th>Máquinas activas</Table.Th>
                  <Table.Th>Usuarios activos</Table.Th>
                  <Table.Th w={100}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sectoresFiltrados.map((s) => (
                  <Table.Tr key={s.id} style={{ opacity: s.activo ? 1 : 0.6 }}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <div>
                          <Text size="sm" fw={500}>
                            {s.nombre}
                          </Text>
                          {s.descripcion && (
                            <Text size="xs" c="dimmed">
                              {s.descripcion}
                            </Text>
                          )}
                        </div>
                        {!s.activo && (
                          <Badge color="gray" size="sm" variant="outline">
                            Desactivado
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{s.planta ? s.planta.nombre : '—'}</Text>
                    </Table.Td>
                    <Table.Td>
                      {s.maquinas_activas > 0 ? (
                        <Text
                          component={Link}
                          to={`/maquinas?sector=${s.id}`}
                          size="sm"
                          c="blue"
                          fw={500}
                          style={{ textDecoration: 'none' }}
                        >
                          {s.maquinas_activas}
                        </Text>
                      ) : (
                        <Text size="sm">{s.maquinas_activas}</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {s.usuarios_activos > 0 && puedeGestionarUsuarios ? (
                        <Text
                          component={Link}
                          to={`/usuarios?sector=${s.id}`}
                          size="sm"
                          c="blue"
                          fw={500}
                          style={{ textDecoration: 'none' }}
                        >
                          {s.usuarios_activos}
                        </Text>
                      ) : (
                        <Text size="sm">{s.usuarios_activos}</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6} justify="flex-end" wrap="nowrap">
                        <Button
                          variant="subtle"
                          size="xs"
                          onClick={() => onEditarSector(s)}
                        >
                          Editar
                        </Button>
                        <Menu shadow="md" position="bottom-end">
                          <Menu.Target>
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              size="sm"
                              aria-label="Más acciones"
                            >
                              <IconDotsVertical size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            {s.activo ? (
                              <Menu.Item
                                color="red"
                                leftSection={<IconBan size={14} />}
                                onClick={() =>
                                  onDesactivarSector(
                                    s.id,
                                    s.nombre,
                                    motivoNoDesactivableSector(s)
                                  )
                                }
                              >
                                Desactivar
                              </Menu.Item>
                            ) : (
                              <Menu.Item
                                leftSection={<IconRotateClockwise size={14} />}
                                onClick={() => onReactivarSector(s.id, s.nombre)}
                              >
                                Reactivar
                              </Menu.Item>
                            )}
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
    </Stack>
  );
}

