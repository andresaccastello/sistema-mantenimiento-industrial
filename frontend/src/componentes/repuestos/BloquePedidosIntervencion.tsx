import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Paper,
  Stack,
  Title,
  Text,
  Group,
  Button,
  Badge,
  Menu,
  ActionIcon,
  Alert,
  Skeleton,
} from '@mantine/core';
import {
  IconPlus,
  IconDotsVertical,
  IconEdit,
  IconCheck,
  IconX,
  IconAlertCircle,
  IconInfoCircle,
} from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { IntervencionPedidosRespuesta, PedidoIntervencionItem } from '../../api/tipos';
import { formatCantidad } from '../../lib/formato';
import { infoPedido, badgeColorStock } from '../../lib/repuestos';
import { ModalPedido } from './ModalPedido';
import { ModalRecibirPedido } from './ModalRecibirPedido';
import { ModalCancelarPedido } from './ModalCancelarPedido';

export interface BloquePedidosIntervencionProps {
  intervencionId: number;
  estadoIntervencion: string;
}

export function BloquePedidosIntervencion({
  intervencionId,
  estadoIntervencion,
}: BloquePedidosIntervencionProps) {
  const [modalNuevoAbierto, setModalNuevoAbierto] = useState(false);
  const [pedidoParaEditar, setPedidoParaEditar] = useState<PedidoIntervencionItem | null>(null);
  const [pedidoParaRecibir, setPedidoParaRecibir] = useState<PedidoIntervencionItem | null>(null);
  const [pedidoParaCancelar, setPedidoParaCancelar] = useState<PedidoIntervencionItem | null>(null);

  const { data, isLoading, error } = useQuery<IntervencionPedidosRespuesta>({
    queryKey: ['intervencion', intervencionId, 'pedidos'],
    queryFn: () => clienteApi.get<IntervencionPedidosRespuesta>(`/api/intervenciones/${intervencionId}/pedidos`),
  });

  if (isLoading) {
    return (
      <Paper p="md" withBorder>
        <Skeleton height={24} width={180} mb="sm" />
        <Skeleton height={50} />
      </Paper>
    );
  }

  if (error || !data) {
    return null;
  }

  const { pedidos, puede_crear, puede_gestionar } = data;

  // Solo se muestra si hay pedidos o si puede_crear
  if (pedidos.length === 0 && !puede_crear) {
    return null;
  }

  const tienePedidosAbiertos = pedidos.some(
    (p) => p.estado === 'PENDIENTE' || p.estado === 'PEDIDO'
  );
  const esEsperaRepuestos = estadoIntervencion === 'EN_ESPERA_REPUESTOS';

  return (
    <Paper p="md" withBorder>
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Title order={4}>Pedidos de repuestos</Title>
          {puede_crear && (
            <Button
              size="xs"
              variant="light"
              color="marca"
              leftSection={<IconPlus size={14} />}
              onClick={() => setModalNuevoAbierto(true)}
            >
              Agregar pedido
            </Button>
          )}
        </Group>

        {esEsperaRepuestos && !tienePedidosAbiertos && puede_crear && (
          <Alert color="blue" icon={<IconInfoCircle size={16} />}>
            Cargá qué se pidió para seguir la demora.
          </Alert>
        )}

        {pedidos.length === 0 ? (
          <Text size="sm" c="dimmed">
            No hay pedidos de repuestos para esta intervención.
          </Text>
        ) : (
          <Stack gap="xs">
            {pedidos.map((p) => {
              const info = infoPedido(p);
              const estaAbierto = p.estado === 'PENDIENTE' || p.estado === 'PEDIDO';
              const tituloPedido = p.repuesto
                ? `${p.repuesto.nombre} × ${formatCantidad(p.cantidad)} ${p.repuesto.unidad}`
                : `${p.descripcion} × ${formatCantidad(p.cantidad)}`;

              return (
                <Paper
                  key={p.id}
                  p="xs"
                  withBorder
                  style={{
                    backgroundColor: estaAbierto ? 'var(--mantine-color-body)' : 'var(--mantine-color-gray-0)',
                  }}
                >
                  <Group justify="space-between" align="center" wrap="wrap">
                    <Stack gap={2}>
                      <Group gap="xs" align="center">
                        <Text size="sm" fw={600}>
                          {tituloPedido}
                        </Text>
                        <Badge color={badgeColorStock(info.color)} variant="light" size="sm">
                          {info.etiqueta}
                        </Badge>
                      </Group>
                      <Group gap="xs" align="center">
                        {p.proveedor && (
                          <Text size="xs" c="dimmed">
                            Proveedor: {p.proveedor.nombre}
                          </Text>
                        )}
                        {info.plazo && (
                          <Text
                            size="xs"
                            c={info.atrasado ? 'red' : 'dimmed'}
                            fw={info.atrasado ? 700 : 400}
                          >
                            · {info.plazo}
                          </Text>
                        )}
                        {p.observacion && (
                          <Text size="xs" c="dimmed">
                            · {p.observacion}
                          </Text>
                        )}
                      </Group>
                    </Stack>

                    {puede_gestionar && estaAbierto && (
                      <Menu position="bottom-end" shadow="md">
                        <Menu.Target>
                          <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Acciones del pedido">
                            <IconDotsVertical size={14} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            leftSection={<IconEdit size={14} />}
                            onClick={() => setPedidoParaEditar(p)}
                          >
                            Editar
                          </Menu.Item>
                          <Menu.Item
                            color="green"
                            leftSection={<IconCheck size={14} />}
                            onClick={() => setPedidoParaRecibir(p)}
                          >
                            Recibir
                          </Menu.Item>
                          <Menu.Item
                            color="red"
                            leftSection={<IconX size={14} />}
                            onClick={() => setPedidoParaCancelar(p)}
                          >
                            Cancelar
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    )}
                  </Group>
                </Paper>
              );
            })}
          </Stack>
        )}
      </Stack>

      {/* Modales */}
      <ModalPedido
        abierto={modalNuevoAbierto}
        onCerrar={() => setModalNuevoAbierto(false)}
        intervencionId={intervencionId}
      />

      <ModalPedido
        abierto={Boolean(pedidoParaEditar)}
        onCerrar={() => setPedidoParaEditar(null)}
        intervencionId={intervencionId}
        pedido={pedidoParaEditar}
      />

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
    </Paper>
  );
}
