import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Paper,
  Stack,
  Title,
  Text,
  Table,
  Group,
  Button,
  Menu,
  ActionIcon,
  Alert,
  Skeleton,
} from '@mantine/core';
import {
  IconPlus,
  IconDotsVertical,
  IconBan,
  IconAlertTriangle,
  IconAlertCircle,
} from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { IntervencionRepuestosRespuesta } from '../../api/tipos';
import { formatCantidad, formatFechaHora, formatMoneda } from '../../lib/formato';
import { nombreCompleto } from '../../lib/personas';
import { ModalConsumo } from './ModalConsumo';
import { ModalAnularConsumo, ConsumoParaAnular } from './ModalAnularConsumo';

export interface BloqueRepuestosIntervencionProps {
  intervencionId: number;
  estadoIntervencion: string;
}

export function BloqueRepuestosIntervencion({
  intervencionId,
  estadoIntervencion,
}: BloqueRepuestosIntervencionProps) {
  const [modalConsumoAbierto, setModalConsumoAbierto] = useState(false);
  const [consumoParaAnular, setConsumoParaAnular] = useState<ConsumoParaAnular | null>(null);

  const { data, isLoading, error } = useQuery<IntervencionRepuestosRespuesta>({
    queryKey: ['intervencion', intervencionId, 'repuestos'],
    queryFn: () => clienteApi.get<IntervencionRepuestosRespuesta>(`/api/intervenciones/${intervencionId}/repuestos`),
  });

  if (isLoading) {
    return (
      <Paper p="md" withBorder>
        <Skeleton height={24} width={180} mb="sm" />
        <Skeleton height={60} />
      </Paper>
    );
  }

  if (error || !data) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={16} />}>
        Error al cargar los repuestos de la intervención.
      </Alert>
    );
  }

  const { consumos, total_repuestos, ve_costos, puede_registrar, puede_anular } = data;
  const tieneConsumosVigentes = consumos.some((c) => !c.anulado);
  const esCancelada = estadoIntervencion === 'CANCELADA';

  return (
    <Paper p="md" withBorder>
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Title order={4}>Repuestos usados</Title>
          {puede_registrar && (
            <Button
              size="xs"
              variant="light"
              color="marca"
              leftSection={<IconPlus size={14} />}
              onClick={() => setModalConsumoAbierto(true)}
            >
              Agregar repuesto
            </Button>
          )}
        </Group>

        {esCancelada && tieneConsumosVigentes && puede_anular && (
          <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
            La intervención está cancelada. Si algún repuesto no se usó, anulalo para devolverlo al
            stock.
          </Alert>
        )}

        {consumos.length === 0 ? (
          <Text size="sm" c="dimmed">
            Todavía no se registraron repuestos.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={600}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Repuesto</Table.Th>
                  <Table.Th>Cantidad</Table.Th>
                  {ve_costos && <Table.Th style={{ whiteSpace: 'nowrap' }}>Costo unitario</Table.Th>}
                  {ve_costos && <Table.Th style={{ whiteSpace: 'nowrap' }}>Importe</Table.Th>}
                  <Table.Th>Registró</Table.Th>
                  {puede_anular && <Table.Th style={{ width: 40 }}></Table.Th>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {consumos.map((c) => {
                  const nombreRepuesto = c.repuesto.codigo
                    ? `${c.repuesto.codigo} · ${c.repuesto.nombre}`
                    : c.repuesto.nombre;

                  return (
                    <Table.Tr
                      key={c.id}
                      style={{
                        opacity: c.anulado ? 0.6 : 1,
                        textDecoration: c.anulado ? 'line-through' : 'none',
                      }}
                    >
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {nombreRepuesto}
                        </Text>
                        {c.anulado ? (
                          <Text size="xs" c="dimmed" style={{ textDecoration: 'none' }}>
                            Anulado por {nombreCompleto(c.anulado_por)} el{' '}
                            {formatFechaHora(c.anulado_en)}: {c.motivo_anulacion}
                          </Text>
                        ) : (
                          c.observacion && (
                            <Text size="xs" c="dimmed">
                              {c.observacion}
                            </Text>
                          )
                        )}
                      </Table.Td>

                      <Table.Td>
                        <Text size="sm">
                          {formatCantidad(c.cantidad)} {c.repuesto.unidad}
                        </Text>
                      </Table.Td>

                      {ve_costos && (
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          <Text size="sm">{formatMoneda(c.costo_unitario_aplicado)}</Text>
                        </Table.Td>
                      )}

                      {ve_costos && (
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          <Text size="sm">{formatMoneda(c.importe)}</Text>
                        </Table.Td>
                      )}

                      <Table.Td>
                        <Text size="xs">
                          {nombreCompleto(c.registrado_por)}
                          <br />
                          <span style={{ color: 'var(--mantine-color-dimmed)' }}>
                            {formatFechaHora(c.registrado_en)}
                          </span>
                        </Text>
                      </Table.Td>

                      {puede_anular && (
                        <Table.Td>
                          {!c.anulado && (
                            <Menu position="bottom-end" shadow="md">
                              <Menu.Target>
                                <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Acciones del consumo">
                                  <IconDotsVertical size={14} />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <Menu.Item
                                  color="red"
                                  leftSection={<IconBan size={14} />}
                                  onClick={() =>
                                    setConsumoParaAnular({
                                      id: c.id,
                                      repuesto: c.repuesto,
                                      cantidad: c.cantidad,
                                      movio_stock: c.movio_stock,
                                    })
                                  }
                                >
                                  Anular
                                </Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
                          )}
                        </Table.Td>
                      )}
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        {ve_costos && (
          <Group justify="flex-end" pt="xs" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
            <Text size="sm" fw={700}>
              Total en repuestos: {formatMoneda(total_repuestos)}
            </Text>
          </Group>
        )}
      </Stack>

      {/* Modales */}
      <ModalConsumo
        abierto={modalConsumoAbierto}
        onCerrar={() => setModalConsumoAbierto(false)}
        intervencionId={intervencionId}
        estadoIntervencion={estadoIntervencion}
      />

      <ModalAnularConsumo
        abierto={Boolean(consumoParaAnular)}
        onCerrar={() => setConsumoParaAnular(null)}
        intervencionId={intervencionId}
        consumo={consumoParaAnular}
      />
    </Paper>
  );
}
