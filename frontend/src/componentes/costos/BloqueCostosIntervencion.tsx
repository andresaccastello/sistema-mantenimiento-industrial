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
import { IconPlus, IconDotsVertical, IconBan, IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { IntervencionCostosRespuesta, RenglonCosto } from '../../api/tipos';
import { formatFechaHora, formatMoneda } from '../../lib/formato';
import { nombreCompleto } from '../../lib/personas';
import { etiquetaTipoCosto, filasResumenCostos, formatHoras } from '../../lib/costos';
import { ModalCosto } from './ModalCosto';
import { ModalAnularCosto } from './ModalAnularCosto';

export interface BloqueCostosIntervencionProps {
  intervencionId: number;
  estadoIntervencion: string;
}

/**
 * R3: bloque "Costos". Solo se muestra con ve_costos.
 */
export function BloqueCostosIntervencion({ intervencionId, estadoIntervencion }: BloqueCostosIntervencionProps) {
  const [modalCostoAbierto, setModalCostoAbierto] = useState(false);
  const [renglonParaAnular, setRenglonParaAnular] = useState<RenglonCosto | null>(null);

  const { data, isLoading, error } = useQuery<IntervencionCostosRespuesta>({
    queryKey: ['intervencion', intervencionId, 'costos'],
    queryFn: () => clienteApi.get<IntervencionCostosRespuesta>(`/api/intervenciones/${intervencionId}/costos`),
  });

  if (isLoading) {
    return (
      <Paper p="md" withBorder>
        <Skeleton height={24} width={120} mb="sm" />
        <Skeleton height={60} />
      </Paper>
    );
  }

  if (error || !data) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={16} />}>
        Error al cargar los costos de la intervención.
      </Alert>
    );
  }

  const { renglones, resumen, horas_mano_obra, ve_costos, puede_registrar, puede_anular } = data;

  if (!ve_costos) {
    return null;
  }

  const sinCorte = { whiteSpace: 'nowrap' as const };

  return (
    <Paper p="md" withBorder>
      <Stack gap="md">
        <Title order={4}>Costos</Title>

        {/* Resumen */}
        {resumen && (
          <Stack gap={4}>
            {filasResumenCostos(resumen).map((f) => (
              <Group
                key={f.clave}
                justify="space-between"
                wrap="nowrap"
                pt={f.esTotal ? 'xs' : undefined}
                style={f.esTotal ? { borderTop: '1px solid var(--mantine-color-gray-3)' } : undefined}
              >
                <Text size="sm" fw={f.esTotal ? 700 : 400}>
                  {f.etiqueta}
                </Text>
                <Text size="sm" fw={f.esTotal ? 700 : 400} style={sinCorte}>
                  {formatMoneda(f.importe)}
                </Text>
              </Group>
            ))}
          </Stack>
        )}

        {horas_mano_obra > 0 && (
          <Text size="sm" c="dimmed">
            Mano de obra: {formatHoras(horas_mano_obra)}
          </Text>
        )}

        {/* Renglones */}
        {renglones.length === 0 ? (
          <Text size="sm" c="dimmed">
            Todavía no se cargaron costos además de los repuestos.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Tipo</Table.Th>
                  <Table.Th>Detalle</Table.Th>
                  <Table.Th>Horas</Table.Th>
                  <Table.Th style={sinCorte}>Importe</Table.Th>
                  <Table.Th>Registró</Table.Th>
                  {puede_anular && <Table.Th style={{ width: 40 }}></Table.Th>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {renglones.map((r) => {
                  const quien = r.persona ? nombreCompleto(r.persona) : r.proveedor ? r.proveedor.nombre : null;
                  return (
                    <Table.Tr key={r.id} style={{ opacity: r.anulado ? 0.6 : 1 }}>
                      <Table.Td style={{ textDecoration: r.anulado ? 'line-through' : 'none' }}>
                        <Text size="sm" style={sinCorte}>
                          {etiquetaTipoCosto(r.tipo)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={500} style={{ textDecoration: r.anulado ? 'line-through' : 'none' }}>
                          {r.descripcion}
                        </Text>
                        {quien && (
                          <Text size="xs" c="dimmed" style={{ textDecoration: r.anulado ? 'line-through' : 'none' }}>
                            {quien}
                          </Text>
                        )}
                        {r.anulado && (
                          <Text size="xs" c="dimmed">
                            Anulado por {nombreCompleto(r.anulado_por)} el {formatFechaHora(r.anulado_en)}:{' '}
                            {r.motivo_anulacion}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td style={{ textDecoration: r.anulado ? 'line-through' : 'none' }}>
                        <Text size="sm" style={sinCorte}>
                          {formatHoras(r.horas)}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ ...sinCorte, textDecoration: r.anulado ? 'line-through' : 'none' }}>
                        <Text size="sm" style={sinCorte}>
                          {formatMoneda(r.importe)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">
                          {nombreCompleto(r.registrado_por)}
                          <br />
                          <span style={{ color: 'var(--mantine-color-dimmed)' }}>{formatFechaHora(r.registrado_en)}</span>
                        </Text>
                      </Table.Td>
                      {puede_anular && (
                        <Table.Td>
                          {!r.anulado && (
                            <Menu position="bottom-end" shadow="md">
                              <Menu.Target>
                                <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Acciones del renglón">
                                  <IconDotsVertical size={14} />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <Menu.Item
                                  color="red"
                                  leftSection={<IconBan size={14} />}
                                  onClick={() => setRenglonParaAnular(r)}
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

        {puede_registrar && (
          <Group>
            <Button
              size="xs"
              variant="light"
              color="marca"
              leftSection={<IconPlus size={14} />}
              onClick={() => setModalCostoAbierto(true)}
            >
              Agregar costo
            </Button>
          </Group>
        )}
      </Stack>

      <ModalCosto
        abierto={modalCostoAbierto}
        onCerrar={() => setModalCostoAbierto(false)}
        intervencionId={intervencionId}
        estadoIntervencion={estadoIntervencion}
      />

      <ModalAnularCosto
        abierto={Boolean(renglonParaAnular)}
        onCerrar={() => setRenglonParaAnular(null)}
        intervencionId={intervencionId}
        renglon={renglonParaAnular}
      />
    </Paper>
  );
}
