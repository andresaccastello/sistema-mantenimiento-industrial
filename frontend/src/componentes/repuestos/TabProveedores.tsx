import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Stack,
  Group,
  Switch,
  Button,
  Paper,
  Table,
  Badge,
  Text,
  ActionIcon,
  Tooltip,
  Skeleton,
  Alert,
} from '@mantine/core';
import {
  IconPlus,
  IconEdit,
  IconBan,
  IconRotateClockwise,
  IconAlertCircle,
  IconBuildingStore,
} from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { ProveedorItem } from '../../api/tipos';
import { FiltrosRepuestos } from '../../lib/repuestos';
import { ModalProveedor } from './ModalProveedor';
import { ModalDesactivarElemento } from '../admin/ModalDesactivarElemento';
import { ModalReactivarElemento } from '../admin/ModalReactivarElemento';

export interface TabProveedoresProps {
  filtros: FiltrosRepuestos;
  onCambiarFiltros: (parcial: Partial<FiltrosRepuestos>) => void;
}

export function TabProveedores({ filtros, onCambiarFiltros }: TabProveedoresProps) {
  const [modalNuevoAbierto, setModalNuevoAbierto] = useState(false);
  const [proveedorParaEditar, setProveedorParaEditar] = useState<ProveedorItem | null>(null);
  const [proveedorParaDesactivar, setProveedorParaDesactivar] = useState<ProveedorItem | null>(null);
  const [proveedorParaReactivar, setProveedorParaReactivar] = useState<ProveedorItem | null>(null);

  // Consulta de proveedores
  const { data: proveedores, isLoading, error } = useQuery<ProveedorItem[]>({
    queryKey: ['proveedores', { inactivos: filtros.inactivos }],
    queryFn: () =>
      clienteApi.get<ProveedorItem[]>('/api/proveedores', {
        params: filtros.inactivos ? { inactivos: 'true' } : undefined,
      }),
  });

  return (
    <Stack gap="md">
      {/* Botón Nuevo proveedor e interruptor Mostrar inactivos */}
      <Group justify="space-between" align="center">
        <Button
          leftSection={<IconPlus size={16} />}
          color="marca"
          onClick={() => setModalNuevoAbierto(true)}
        >
          Nuevo proveedor
        </Button>

        <Switch
          label="Mostrar inactivos"
          checked={filtros.inactivos}
          onChange={(e) => onCambiarFiltros({ inactivos: e.currentTarget.checked })}
        />
      </Group>

      {/* Tabla */}
      {isLoading ? (
        <Stack gap="xs">
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </Stack>
      ) : error ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          Error al cargar los proveedores.
        </Alert>
      ) : (proveedores || []).length === 0 ? (
        <Paper p="xl" withBorder style={{ textAlign: 'center' }}>
          <IconBuildingStore size={48} color="gray" style={{ marginBottom: 12, opacity: 0.5 }} />
          <Text size="md" c="dimmed">
            Todavía no hay proveedores cargados.
          </Text>
        </Paper>
      ) : (
        <Paper withBorder>
          <Table.ScrollContainer minWidth={750}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nombre</Table.Th>
                  <Table.Th>Contacto</Table.Th>
                  <Table.Th>Teléfono</Table.Th>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Repuestos</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Acciones</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {proveedores?.map((prov) => (
                  <Table.Tr
                    key={prov.id}
                    style={{ opacity: prov.activo ? 1 : 0.6 }}
                  >
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {prov.nombre}
                      </Text>
                      {prov.notas && (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {prov.notas}
                        </Text>
                      )}
                    </Table.Td>

                    <Table.Td>
                      <Text size="sm">{prov.contacto || '—'}</Text>
                    </Table.Td>

                    <Table.Td>
                      <Text size="sm">{prov.telefono || '—'}</Text>
                    </Table.Td>

                    <Table.Td>
                      <Text size="sm">{prov.email || '—'}</Text>
                    </Table.Td>

                    <Table.Td>
                      <Text size="sm">
                        {prov.repuestos_activos}{' '}
                        {prov.repuestos_activos === 1 ? 'repuesto' : 'repuestos'}
                      </Text>
                    </Table.Td>

                    <Table.Td>
                      {prov.activo ? (
                        <Badge color="green" variant="light" size="sm">
                          Activo
                        </Badge>
                      ) : (
                        <Badge color="gray" variant="outline" size="sm">
                          Inactivo
                        </Badge>
                      )}
                    </Table.Td>

                    <Table.Td style={{ textAlign: 'right' }}>
                      <Group gap="xs" justify="flex-end">
                        <Tooltip label="Editar proveedor">
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            aria-label="Editar proveedor"
                            onClick={() => setProveedorParaEditar(prov)}
                          >
                            <IconEdit size={16} />
                          </ActionIcon>
                        </Tooltip>

                        {prov.activo ? (
                          <Tooltip label="Desactivar proveedor">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              aria-label="Desactivar proveedor"
                              onClick={() => setProveedorParaDesactivar(prov)}
                            >
                              <IconBan size={16} />
                            </ActionIcon>
                          </Tooltip>
                        ) : (
                          <Tooltip label="Reactivar proveedor">
                            <ActionIcon
                              variant="subtle"
                              color="green"
                              aria-label="Reactivar proveedor"
                              onClick={() => setProveedorParaReactivar(prov)}
                            >
                              <IconRotateClockwise size={16} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}

      {/* Modales */}
      <ModalProveedor
        abierto={modalNuevoAbierto}
        onCerrar={() => setModalNuevoAbierto(false)}
      />

      <ModalProveedor
        abierto={Boolean(proveedorParaEditar)}
        onCerrar={() => setProveedorParaEditar(null)}
        proveedor={proveedorParaEditar}
      />

      <ModalDesactivarElemento
        abierto={Boolean(proveedorParaDesactivar)}
        onCerrar={() => setProveedorParaDesactivar(null)}
        tipo="proveedor"
        id={proveedorParaDesactivar?.id ?? null}
        nombre={proveedorParaDesactivar?.nombre ?? ''}
        motivoBloqueo={null}
      />

      <ModalReactivarElemento
        abierto={Boolean(proveedorParaReactivar)}
        onCerrar={() => setProveedorParaReactivar(null)}
        tipo="proveedor"
        id={proveedorParaReactivar?.id ?? null}
        nombre={proveedorParaReactivar?.nombre ?? ''}
      />
    </Stack>
  );
}
