import { useState, useMemo } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Stack,
  Group,
  Switch,
  Paper,
  Table,
  Badge,
  Text,
  Button,
  Skeleton,
  Alert,
} from '@mantine/core';
import { IconAlertCircle, IconCheck, IconX, IconPackage } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { PedidoRepuestoItem } from '../../api/tipos';
import { formatCantidad } from '../../lib/formato';
import {
  FiltrosRepuestos,
  infoPedido,
  badgeColorStock,
} from '../../lib/repuestos';
import { ModalRecibirPedido } from './ModalRecibirPedido';
import { ModalCancelarPedido } from './ModalCancelarPedido';

export interface TabPedidosProps {
  filtros: FiltrosRepuestos;
  onCambiarFiltros: (parcial: Partial<FiltrosRepuestos>) => void;
}

export function TabPedidos({ filtros, onCambiarFiltros }: TabPedidosProps) {
  const [pedidoParaRecibir, setPedidoParaRecibir] = useState<PedidoRepuestoItem | null>(null);
  const [pedidoParaCancelar, setPedidoParaCancelar] = useState<PedidoRepuestoItem | null>(null);

  // Consulta de pedidos
  const { data: pedidos, isLoading, error } = useQuery<PedidoRepuestoItem[]>({
    queryKey: ['pedidos-repuesto', { cerrados: filtros.cerrados }],
    queryFn: () =>
      clienteApi.get<PedidoRepuestoItem[]>('/api/pedidos-repuesto', {
        params: filtros.cerrados ? { estado: 'TODOS' } : undefined,
      }),
  });

  return (
    <Stack gap="md">
      {/* Filtro incluir cerrados */}
      <Group justify="flex-end" align="center">
        <Switch
          label="Incluir cerrados"
          checked={filtros.cerrados}
          onChange={(e) => onCambiarFiltros({ cerrados: e.currentTarget.checked })}
        />
      </Group>

      {/* Contenido / Tabla */}
      {isLoading ? (
        <Stack gap="xs">
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </Stack>
      ) : error ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          Error al cargar los pedidos de repuesto.
        </Alert>
      ) : (pedidos || []).length === 0 ? (
        <Paper p="xl" withBorder style={{ textAlign: 'center' }}>
          <IconPackage size={48} color="gray" style={{ marginBottom: 12, opacity: 0.5 }} />
          <Text size="md" c="dimmed">
            No hay pedidos abiertos.
          </Text>
        </Paper>
      ) : (
        <Paper withBorder>
          <Table.ScrollContainer minWidth={800}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Repuesto / Descripción</Table.Th>
                  <Table.Th>Cantidad</Table.Th>
                  <Table.Th>Proveedor</Table.Th>
                  <Table.Th>Intervención</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Plazo</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Acciones</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pedidos?.map((p) => {
                  const info = infoPedido(p);
                  const estaAbierto = p.estado === 'PENDIENTE' || p.estado === 'PEDIDO';

                  return (
                    <Table.Tr key={p.id}>
                      <Table.Td>
                        {p.repuesto ? (
                          <Group gap="xs" align="center">
                            <Link
                              to={`/repuestos/${p.repuesto.id}`}
                              style={{ color: 'inherit', textDecoration: 'none' }}
                            >
                              <Text size="sm" fw={600}>
                                {p.repuesto.codigo ? `${p.repuesto.codigo} · ` : ''}
                                {p.repuesto.nombre}
                              </Text>
                            </Link>
                          </Group>
                        ) : (
                          <Text size="sm" fw={500}>
                            {p.descripcion}
                          </Text>
                        )}
                        {p.observacion && (
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {p.observacion}
                          </Text>
                        )}
                      </Table.Td>

                      <Table.Td>
                        <Text size="sm">
                          {formatCantidad(p.cantidad)} {p.repuesto?.unidad || ''}
                        </Text>
                      </Table.Td>

                      <Table.Td>
                        <Text size="sm">{p.proveedor?.nombre || '—'}</Text>
                      </Table.Td>

                      <Table.Td>
                        <Link
                          to={`/intervenciones/${p.intervencion_id}`}
                          style={{ color: 'inherit', textDecoration: 'underline' }}
                        >
                          <Text size="sm">
                            N.º {p.intervencion_id}
                            {p.maquina?.nombre ? ` · ${p.maquina.nombre}` : ''}
                          </Text>
                        </Link>
                      </Table.Td>

                      <Table.Td>
                        <Badge color={badgeColorStock(info.color)} variant="light" size="sm">
                          {info.etiqueta}
                        </Badge>
                      </Table.Td>

                      <Table.Td>
                        {info.plazo ? (
                          <Text size="sm" c={info.atrasado ? 'red' : undefined} fw={info.atrasado ? 600 : 400}>
                            {info.plazo}
                          </Text>
                        ) : (
                          <Text size="sm" c="dimmed">—</Text>
                        )}
                      </Table.Td>

                      <Table.Td style={{ textAlign: 'right' }}>
                        {estaAbierto ? (
                          <Group gap="xs" justify="flex-end">
                            <Button
                              size="xs"
                              variant="light"
                              color="green"
                              leftSection={<IconCheck size={14} />}
                              onClick={() => setPedidoParaRecibir(p)}
                            >
                              Recibir
                            </Button>
                            <Button
                              size="xs"
                              variant="subtle"
                              color="red"
                              leftSection={<IconX size={14} />}
                              onClick={() => setPedidoParaCancelar(p)}
                            >
                              Cancelar
                            </Button>
                          </Group>
                        ) : (
                          <Text size="xs" c="dimmed">
                            {p.estado === 'RECIBIDO' ? 'Recibido' : 'Cancelado'}
                          </Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}

      {/* Modales */}
      <ModalRecibirPedido
        abierto={Boolean(pedidoParaRecibir)}
        onCerrar={() => setPedidoParaRecibir(null)}
        pedido={pedidoParaRecibir}
      />

      <ModalCancelarPedido
        abierto={Boolean(pedidoParaCancelar)}
        onCerrar={() => setPedidoParaCancelar(null)}
        pedido={pedidoParaCancelar}
      />
    </Stack>
  );
}
