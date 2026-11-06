import { useState } from 'react';
import { useParams, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Stack,
  Group,
  Title,
  Text,
  Badge,
  Button,
  Paper,
  SimpleGrid,
  Tabs,
  Table,
  Menu,
  ActionIcon,
  Skeleton,
  Alert,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconEdit,
  IconPlus,
  IconMinus,
  IconArrowsExchange,
  IconDotsVertical,
  IconBan,
  IconRotateClockwise,
  IconAlertCircle,
} from '@tabler/icons-react';
import { clienteApi } from '../api/cliente';
import {
  RepuestoDetalle,
  MovimientoStockItem,
  UsoRepuestoItem,
  CostoHistorialItem,
} from '../api/tipos';
import { NoEncontrada } from '../componentes/NoEncontrada';
import { ModalRepuesto } from '../componentes/repuestos/ModalRepuesto';
import {
  ModalMovimiento,
  TipoMovimientoModal,
} from '../componentes/repuestos/ModalMovimiento';
import { ModalDesactivarElemento } from '../componentes/admin/ModalDesactivarElemento';
import { ModalReactivarElemento } from '../componentes/admin/ModalReactivarElemento';
import { formatCantidad, formatFechaHora, formatMoneda } from '../lib/formato';
import { nombreCompleto } from '../lib/personas';
import {
  infoEstadoStock,
  badgeColorStock,
  textoMovimiento,
} from '../lib/repuestos';

export function DetalleRepuesto() {
  const { id } = useParams<{ id: string }>();
  const repuestoId = Number(id);

  const [modalEditarAbierto, setModalEditarAbierto] = useState(false);
  const [modalDesactivarAbierto, setModalDesactivarAbierto] = useState(false);
  const [modalReactivarAbierto, setModalReactivarAbierto] = useState(false);
  const [modalMovimientoTipo, setModalMovimientoTipo] = useState<TipoMovimientoModal | null>(null);

  // 1. Detalle del repuesto
  const {
    data: repuesto,
    isLoading,
    error,
  } = useQuery<RepuestoDetalle>({
    queryKey: ['repuesto', repuestoId],
    queryFn: () => clienteApi.get<RepuestoDetalle>(`/api/repuestos/${repuestoId}`),
    enabled: !isNaN(repuestoId) && repuestoId > 0,
    retry: false,
  });

  // 2. Movimientos
  const { data: movimientos } = useQuery<MovimientoStockItem[]>({
    queryKey: ['repuesto', repuestoId, 'movimientos'],
    queryFn: () => clienteApi.get<MovimientoStockItem[]>(`/api/repuestos/${repuestoId}/movimientos`),
    enabled: Boolean(repuesto?.lleva_stock),
  });

  // 3. Usos
  const { data: usos } = useQuery<UsoRepuestoItem[]>({
    queryKey: ['repuesto', repuestoId, 'usos'],
    queryFn: () => clienteApi.get<UsoRepuestoItem[]>(`/api/repuestos/${repuestoId}/usos`),
    enabled: Boolean(repuesto),
  });

  // 4. Costos
  const { data: costos } = useQuery<CostoHistorialItem[]>({
    queryKey: ['repuesto', repuestoId, 'costos'],
    queryFn: () => clienteApi.get<CostoHistorialItem[]>(`/api/repuestos/${repuestoId}/costos`),
    enabled: Boolean(repuesto),
  });

  if (isNaN(repuestoId) || repuestoId <= 0) {
    return <NoEncontrada />;
  }

  if (isLoading) {
    return (
      <Stack gap="md">
        <Skeleton height={30} width={200} />
        <Skeleton height={120} />
        <Skeleton height={300} />
      </Stack>
    );
  }

  if (error || !repuesto) {
    const status = (error as any)?.status;
    if (status === 404) {
      return <NoEncontrada />;
    }
    return (
      <Alert color="red" icon={<IconAlertCircle size={16} />}>
        Error al cargar el repuesto.
      </Alert>
    );
  }

  const infoStock = infoEstadoStock(repuesto.estado_stock);

  return (
    <Stack gap="lg">
      {/* Botón volver */}
      <Group>
        <Button
          component={Link}
          to="/repuestos"
          variant="subtle"
          color="gray"
          leftSection={<IconArrowLeft size={16} />}
        >
          Volver a repuestos
        </Button>
      </Group>

      {/* Encabezado */}
      <Paper p="lg" withBorder>
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Stack gap={4}>
            <Group gap="xs" align="center">
              <Title order={2}>{repuesto.nombre}</Title>
              {!repuesto.activo && (
                <Badge color="gray" variant="outline" size="md">
                  Inactivo
                </Badge>
              )}
            </Group>
            <Group gap="xs" align="center">
              {repuesto.codigo && (
                <Text size="sm" fw={600} c="dimmed">
                  Código: {repuesto.codigo}
                </Text>
              )}
              <Badge color={badgeColorStock(infoStock.color)} variant="light" size="sm">
                {infoStock.etiqueta}
              </Badge>
            </Group>
          </Stack>

          <Group gap="xs" align="center">
            {repuesto.lleva_stock && (
              <Stack gap={0} align="flex-end" mr="md">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Stock actual
                </Text>
                <Text size="xl" fw={700}>
                  {formatCantidad(repuesto.cantidad_disponible)} {repuesto.unidad}
                </Text>
              </Stack>
            )}

            {repuesto.activo && repuesto.lleva_stock && (
              <>
                <Button
                  size="xs"
                  variant="light"
                  color="green"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => setModalMovimientoTipo('ingreso')}
                >
                  Ingreso
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  leftSection={<IconMinus size={14} />}
                  onClick={() => setModalMovimientoTipo('egreso')}
                >
                  Egreso
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  color="blue"
                  leftSection={<IconArrowsExchange size={14} />}
                  onClick={() => setModalMovimientoTipo('ajuste')}
                >
                  Ajuste
                </Button>
              </>
            )}

            <Button
              size="xs"
              variant="default"
              leftSection={<IconEdit size={14} />}
              onClick={() => setModalEditarAbierto(true)}
            >
              Editar
            </Button>

            <Menu shadow="md" width={180} position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label="Acciones del repuesto">
                  <IconDotsVertical size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {repuesto.activo ? (
                  <Menu.Item
                    color="red"
                    leftSection={<IconBan size={14} />}
                    onClick={() => setModalDesactivarAbierto(true)}
                  >
                    Desactivar repuesto
                  </Menu.Item>
                ) : (
                  <Menu.Item
                    color="green"
                    leftSection={<IconRotateClockwise size={14} />}
                    onClick={() => setModalReactivarAbierto(true)}
                  >
                    Reactivar repuesto
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </Paper>

      {/* Tarjeta de datos */}
      <Paper p="md" withBorder>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
          <Stack gap={2}>
            <Text size="xs" c="dimmed">Unidad de medida</Text>
            <Text size="sm" fw={500}>{repuesto.unidad}</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">Stock mínimo</Text>
            <Text size="sm" fw={500}>
              {repuesto.lleva_stock && repuesto.stock_minimo !== null && repuesto.stock_minimo !== undefined
                ? `${formatCantidad(repuesto.stock_minimo)} ${repuesto.unidad}`
                : '—'}
            </Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">Costo unitario vigente</Text>
            <Text size="sm" fw={500}>{formatMoneda(repuesto.costo_unitario)}</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">Proveedor habitual</Text>
            <Text size="sm" fw={500}>{repuesto.proveedor?.nombre || '—'}</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">Ubicación en planta / depósito</Text>
            <Text size="sm" fw={500}>{repuesto.ubicacion || '—'}</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">Pedidos abiertos</Text>
            <Text size="sm" fw={500}>{repuesto.pedidos_abiertos}</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">Consumos vigentes</Text>
            <Text size="sm" fw={500}>{repuesto.consumos_vigentes}</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">Descripción</Text>
            <Text size="sm" fw={500}>{repuesto.descripcion || '—'}</Text>
          </Stack>
        </SimpleGrid>
      </Paper>

      {/* Pestañas: Movimientos · Usos · Costos */}
      <Tabs defaultValue={repuesto.lleva_stock ? 'movimientos' : 'usos'}>
        <Tabs.List mb="md">
          {repuesto.lleva_stock && <Tabs.Tab value="movimientos">Movimientos</Tabs.Tab>}
          <Tabs.Tab value="usos">Usos ({repuesto.consumos_vigentes})</Tabs.Tab>
          <Tabs.Tab value="costos">Costos</Tabs.Tab>
        </Tabs.List>

        {repuesto.lleva_stock && (
          <Tabs.Panel value="movimientos">
            {(movimientos || []).length === 0 ? (
              <Text size="sm" c="dimmed" p="md">No hay movimientos de stock registrados.</Text>
            ) : (
              <Paper withBorder>
                <Table.ScrollContainer minWidth={750}>
                  <Table verticalSpacing="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Fecha</Table.Th>
                        <Table.Th>Tipo y cantidad</Table.Th>
                        <Table.Th>Stock resultante</Table.Th>
                        <Table.Th>Costo</Table.Th>
                        <Table.Th>Proveedor / Remito</Table.Th>
                        <Table.Th>Intervención</Table.Th>
                        <Table.Th>Usuario</Table.Th>
                        <Table.Th>Observación</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {movimientos?.map((m) => {
                        const { etiqueta, cantidad } = textoMovimiento(m);
                        return (
                          <Table.Tr key={m.id}>
                            <Table.Td>{formatFechaHora(m.realizado_en)}</Table.Td>
                            <Table.Td>
                              <Text size="sm" fw={600}>
                                {etiqueta} {cantidad} {repuesto.unidad}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              {m.stock_resultante !== null ? `${formatCantidad(m.stock_resultante)} ${repuesto.unidad}` : '—'}
                            </Table.Td>
                            <Table.Td>{formatMoneda(m.costo_unitario)}</Table.Td>
                            <Table.Td>
                              {m.proveedor?.nombre || ''}
                              {m.comprobante ? ` (${m.comprobante})` : ''}
                              {!m.proveedor && !m.comprobante ? '—' : ''}
                            </Table.Td>
                            <Table.Td>
                              {m.intervencion_id ? (
                                <Link to={`/intervenciones/${m.intervencion_id}`} style={{ color: 'inherit' }}>
                                  N.º {m.intervencion_id}
                                </Link>
                              ) : '—'}
                            </Table.Td>
                            <Table.Td>{nombreCompleto(m.realizado_por)}</Table.Td>
                            <Table.Td>{m.observacion || '—'}</Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Paper>
            )}
          </Tabs.Panel>
        )}

        <Tabs.Panel value="usos">
          {(usos || []).length === 0 ? (
            <Text size="sm" c="dimmed" p="md">No hay usos registrados en intervenciones.</Text>
          ) : (
            <Paper withBorder>
              <Table.ScrollContainer minWidth={650}>
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Fecha</Table.Th>
                      <Table.Th>Intervención</Table.Th>
                      <Table.Th>Máquina</Table.Th>
                      <Table.Th>Cantidad</Table.Th>
                      <Table.Th>Importe</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {usos?.map((u) => (
                      <Table.Tr
                        key={u.consumo_id}
                        style={{
                          textDecoration: u.anulado ? 'line-through' : 'none',
                          opacity: u.anulado ? 0.6 : 1,
                        }}
                      >
                        <Table.Td>{formatFechaHora(u.registrado_en)}</Table.Td>
                        <Table.Td>
                          <Group gap="xs" align="center">
                            <Link to={`/intervenciones/${u.intervencion.id}`} style={{ color: 'inherit' }}>
                              N.º {u.intervencion.id}
                            </Link>
                            <Badge size="xs" variant="light">
                              {u.intervencion.estado}
                            </Badge>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          {u.maquina.codigo ? `${u.maquina.codigo} · ` : ''}
                          {u.maquina.nombre}
                        </Table.Td>
                        <Table.Td>
                          {formatCantidad(u.cantidad)} {repuesto.unidad}
                        </Table.Td>
                        <Table.Td>{formatMoneda(u.importe)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="costos">
          {(costos || []).length === 0 ? (
            <Text size="sm" c="dimmed" p="md">No hay historial de costos registrado.</Text>
          ) : (
            <Paper withBorder>
              <Table.ScrollContainer minWidth={500}>
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Fecha</Table.Th>
                      <Table.Th>Costo</Table.Th>
                      <Table.Th>Origen</Table.Th>
                      <Table.Th>Usuario</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {costos?.map((c) => (
                      <Table.Tr key={c.id}>
                        <Table.Td>{formatFechaHora(c.registrado_en)}</Table.Td>
                        <Table.Td>{formatMoneda(c.costo_unitario)}</Table.Td>
                        <Table.Td>
                          <Badge size="sm" variant="outline">
                            {c.origen}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{nombreCompleto(c.registrado_por)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          )}
        </Tabs.Panel>
      </Tabs>

      {/* Modales */}
      <ModalRepuesto
        abierto={modalEditarAbierto}
        onCerrar={() => setModalEditarAbierto(false)}
        repuesto={repuesto}
      />

      <ModalMovimiento
        abierto={Boolean(modalMovimientoTipo)}
        onCerrar={() => setModalMovimientoTipo(null)}
        tipo={modalMovimientoTipo || 'ingreso'}
        repuesto={repuesto}
      />

      <ModalDesactivarElemento
        abierto={modalDesactivarAbierto}
        onCerrar={() => setModalDesactivarAbierto(false)}
        tipo="repuesto"
        id={repuesto.id}
        nombre={repuesto.nombre}
        motivoBloqueo={null}
      />

      <ModalReactivarElemento
        abierto={modalReactivarAbierto}
        onCerrar={() => setModalReactivarAbierto(false)}
        tipo="repuesto"
        id={repuesto.id}
        nombre={repuesto.nombre}
      />
    </Stack>
  );
}
