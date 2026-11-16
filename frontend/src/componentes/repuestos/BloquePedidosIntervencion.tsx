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
  Anchor,
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
import {
  IntervencionPedidosRespuesta,
  IntervencionRepuestosRespuesta,
  PedidoIntervencionItem,
  RecepcionPedidoRespuesta,
} from '../../api/tipos';
import { formatCantidad, formatMoneda } from '../../lib/formato';
import { infoPedido, badgeColorStock } from '../../lib/repuestos';
import { observacionEspera, ofrecerReanudar, preguntarEspera, textoUsado } from '../../lib/compras';
import { ModalEsperaRepuestos } from '../acciones/ModalEsperaRepuestos';
import { ModalReanudar } from '../acciones/ModalReanudar';
import { ModalPedido } from './ModalPedido';
import { ModalRecibirPedido } from './ModalRecibirPedido';
import { ModalCancelarPedido } from './ModalCancelarPedido';

export interface BloquePedidosIntervencionProps {
  intervencionId: number;
  estadoIntervencion: string;
  /** PC1: las acciones disponibles de la intervención, para preguntar por la espera y ofrecer reanudar. */
  acciones?: readonly string[];
  /** PC1, 6.1: la máquina está parada por esta intervención. */
  maquinaDetenida?: boolean;
}

export function BloquePedidosIntervencion({
  intervencionId,
  estadoIntervencion,
  acciones = [],
  maquinaDetenida = false,
}: BloquePedidosIntervencionProps) {
  const [modalNuevoAbierto, setModalNuevoAbierto] = useState(false);
  const [pedidoParaEditar, setPedidoParaEditar] = useState<PedidoIntervencionItem | null>(null);
  const [pedidoParaRecibir, setPedidoParaRecibir] = useState<PedidoIntervencionItem | null>(null);
  const [pedidoParaCancelar, setPedidoParaCancelar] = useState<PedidoIntervencionItem | null>(null);
  // PC1, 6.1 y 6.3: después de cargar un pedido, la espera; después de recibir, reanudar
  const [pedidoParaEsperar, setPedidoParaEsperar] = useState<PedidoIntervencionItem | null>(null);
  const [estadoParaReanudar, setEstadoParaReanudar] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<IntervencionPedidosRespuesta>({
    queryKey: ['intervencion', intervencionId, 'pedidos'],
    queryFn: () => clienteApi.get<IntervencionPedidosRespuesta>(`/api/intervenciones/${intervencionId}/pedidos`),
  });

  // Los usos de la intervención: si el usuario puede cargarlos, y cuánto se usó de cada pedido
  const { data: repuestos } = useQuery<IntervencionRepuestosRespuesta>({
    queryKey: ['intervencion', intervencionId, 'repuestos'],
    queryFn: () => clienteApi.get<IntervencionRepuestosRespuesta>(`/api/intervenciones/${intervencionId}/repuestos`),
  });

  const alCrear = (p: PedidoIntervencionItem) => {
    if (preguntarEspera(estadoIntervencion, acciones)) setPedidoParaEsperar(p);
  };
  const alRecibir = (r: RecepcionPedidoRespuesta) => {
    if (ofrecerReanudar(r, acciones.includes('REANUDAR'))) setEstadoParaReanudar(r.intervencion_estado);
  };
  const irAlUso = (consumoId: number) => {
    document.getElementById(`consumo-${consumoId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

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

  /** "Usado: 4 de 10", con la cantidad del uso; si todavía no cargó, "Ver el uso". */
  const textoUsoDePedido = (p: PedidoIntervencionItem) => {
    const uso = repuestos?.consumos.find((c) => c.id === p.consumo_id);
    return uso ? textoUsado(uso.cantidad, p.cantidad) : 'Ver el uso';
  };

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
                      {(p.comprobante || p.costo_unitario !== null || p.consumo_id !== null) && (
                        <Group gap="xs" align="center">
                          {p.comprobante && (
                            <Text size="xs" c="dimmed">
                              Comprobante: {p.comprobante}
                            </Text>
                          )}
                          {p.costo_unitario !== null && (
                            <Text size="xs" c="dimmed">
                              · {formatMoneda(p.costo_unitario)} c/u
                            </Text>
                          )}
                          {p.consumo_id !== null && (
                            <Anchor
                              size="xs"
                              href={`#consumo-${p.consumo_id}`}
                              onClick={(e) => {
                                e.preventDefault();
                                if (p.consumo_id !== null) irAlUso(p.consumo_id);
                              }}
                            >
                              {textoUsoDePedido(p)}
                            </Anchor>
                          )}
                        </Group>
                      )}
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
        onCreado={alCrear}
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
        usoEnIntervencion={{ estado: estadoIntervencion, puedeRegistrar: Boolean(repuestos?.puede_registrar) }}
        onRecibido={alRecibir}
      />

      <ModalEsperaRepuestos
        abierto={Boolean(pedidoParaEsperar)}
        onCerrar={() => setPedidoParaEsperar(null)}
        intervencionId={intervencionId}
        estadoAlAbrir={estadoIntervencion}
        textoArriba="Cargaste un pedido. ¿La intervención queda esperando este repuesto?"
        avisoMaquina={maquinaDetenida ? 'La máquina va a figurar como Detenida mientras se espera' : undefined}
        observacionInicial={pedidoParaEsperar ? observacionEspera(pedidoParaEsperar) : undefined}
        textoConfirmar="Sí, esperar"
        textoCancelar="No, sigue en proceso"
      />

      <ModalReanudar
        abierto={estadoParaReanudar !== null}
        onCerrar={() => setEstadoParaReanudar(null)}
        intervencionId={intervencionId}
        estadoAlAbrir={estadoParaReanudar ?? ''}
        textoArriba="Llegó lo último que faltaba. ¿Reanudar la intervención?"
        textoConfirmar="Reanudar"
        textoCancelar="Todavía no"
      />

      <ModalCancelarPedido
        abierto={Boolean(pedidoParaCancelar)}
        onCerrar={() => setPedidoParaCancelar(null)}
        pedido={pedidoParaCancelar}
      />
    </Paper>
  );
}
