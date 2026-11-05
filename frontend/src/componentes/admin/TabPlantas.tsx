import { useState } from 'react';
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
import { PlantaAdmin } from '../../api/tipos';
import { motivoNoDesactivablePlanta } from '../../lib/catalogos';
import { mensajeError } from '../../lib/errores';

export interface TabPlantasProps {
  plantas: PlantaAdmin[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onNuevaPlanta: () => void;
  onEditarPlanta: (planta: PlantaAdmin) => void;
  onDesactivarPlanta: (id: number, nombre: string, motivo: string | null) => void;
  onReactivarPlanta: (id: number, nombre: string) => void;
}

export function TabPlantas({
  plantas,
  isLoading,
  isError,
  error,
  onNuevaPlanta,
  onEditarPlanta,
  onDesactivarPlanta,
  onReactivarPlanta,
}: TabPlantasProps) {
  const [verDesactivadas, setVerDesactivadas] = useState(false);

  const plantasFiltradas = plantas.filter((p) => verDesactivadas || p.activo);

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Switch
          label="Ver desactivadas"
          checked={verDesactivadas}
          onChange={(e) => setVerDesactivadas(e.currentTarget.checked)}
        />
        <Button leftSection={<IconPlus size={16} />} onClick={onNuevaPlanta}>
          Nueva planta
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
                  <Table.Th>Planta</Table.Th>
                  <Table.Th>Sectores activos</Table.Th>
                  <Table.Th w={100}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {plantasFiltradas.map((p) => (
                  <Table.Tr key={p.id} style={{ opacity: p.activo ? 1 : 0.6 }}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <div>
                          <Text size="sm" fw={500}>
                            {p.nombre}
                          </Text>
                          {p.descripcion && (
                            <Text size="xs" c="dimmed">
                              {p.descripcion}
                            </Text>
                          )}
                        </div>
                        {!p.activo && (
                          <Badge color="gray" size="sm" variant="outline">
                            Desactivada
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{p.sectores_activos}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6} justify="flex-end">
                        <Button
                          variant="subtle"
                          size="xs"
                          onClick={() => onEditarPlanta(p)}
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
                            {p.activo ? (
                              <Menu.Item
                                color="red"
                                leftSection={<IconBan size={14} />}
                                onClick={() =>
                                  onDesactivarPlanta(
                                    p.id,
                                    p.nombre,
                                    motivoNoDesactivablePlanta(p)
                                  )
                                }
                              >
                                Desactivar
                              </Menu.Item>
                            ) : (
                              <Menu.Item
                                leftSection={<IconRotateClockwise size={14} />}
                                onClick={() => onReactivarPlanta(p.id, p.nombre)}
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

