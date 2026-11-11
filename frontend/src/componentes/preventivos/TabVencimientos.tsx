import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Stack, SimpleGrid, Table, Text, Anchor, Button, Group, Pagination, Center, Loader, Alert } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { VencimientosRespuesta } from '../../api/tipos';
import { mensajeError } from '../../lib/errores';
import { etiquetaMaquina } from '../../lib/maquinas';
import { nombreCompleto } from '../../lib/personas';
import {
  FiltrosPreventivos,
  TAMANIO_PAGINA_VENCIMIENTOS,
  alternarEstado,
  paramsVencimientos,
  textoFrecuenciaTarea,
} from '../../lib/preventivos';
import { CriticidadBadge } from '../CriticidadBadge';
import { EstadoBadge } from '../EstadoBadge';
import { PantallaVacia } from '../PantallaVacia';
import { CeldaProxima } from './CeldaProxima';
import { FiltrosMaquinaPreventivos } from './FiltrosMaquinaPreventivos';
import { ModalGenerar } from './ModalGenerar';
import { TarjetasResumen } from './TarjetasResumen';

interface Props {
  filtros: FiltrosPreventivos;
  onCambiarFiltros: (parcial: Partial<FiltrosPreventivos>) => void;
}

/** P1, pestaña Vencimientos. */
export function TabVencimientos({ filtros, onCambiarFiltros }: Props) {
  const [planAGenerar, setPlanAGenerar] = useState<number | null>(null);
  const params = paramsVencimientos(filtros);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['vencimientos', params],
    queryFn: async () => {
      const { datos, total } = await clienteApi.getConTotal<VencimientosRespuesta>('/api/planes/vencimientos', { params });
      return { respuesta: datos, total: total ?? datos.tareas.length };
    },
    placeholderData: keepPreviousData,
  });

  const conFiltros = filtros.estado !== null || filtros.plantaId !== null || filtros.sectorId !== null || filtros.maquinaId !== null;
  const totalPaginas = Math.ceil((data?.total ?? 0) / TAMANIO_PAGINA_VENCIMIENTOS);
  const tareas = data?.respuesta.tareas ?? [];

  return (
    <Stack gap="md">
      <TarjetasResumen
        resumen={data?.respuesta.resumen}
        elegido={filtros.estado}
        onTocar={(estado) => onCambiarFiltros({ estado: alternarEstado(filtros.estado, estado), pagina: 1 })}
      />

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        <FiltrosMaquinaPreventivos filtros={filtros} onCambiar={onCambiarFiltros} />
      </SimpleGrid>

      {isError && (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {mensajeError(error)}
        </Alert>
      )}

      {isLoading && !data ? (
        <Center py="xl">
          <Loader color="marca" />
        </Center>
      ) : tareas.length === 0 ? (
        <PantallaVacia titulo={conFiltros ? 'No hay tareas con estos filtros.' : 'No hay tareas vencidas ni próximas.'} />
      ) : (
        <>
          <Table.ScrollContainer minWidth={1000}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ minWidth: 130 }}>Estado</Table.Th>
                  <Table.Th style={{ minWidth: 120 }}>Vence</Table.Th>
                  <Table.Th style={{ minWidth: 200 }}>Tarea</Table.Th>
                  <Table.Th style={{ minWidth: 160 }}>Máquina</Table.Th>
                  <Table.Th style={{ minWidth: 150 }}>Plan</Table.Th>
                  <Table.Th style={{ minWidth: 140 }}>Responsable</Table.Th>
                  <Table.Th style={{ minWidth: 130 }}>Acción</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tareas.map((t) => (
                  <Table.Tr key={t.tarea_id}>
                    <Table.Td>
                      <EstadoBadge entidad="tarea_preventiva" estado={t.estado} />
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      <CeldaProxima proxima_fecha={t.proxima_fecha} dias={t.dias} uso={t.uso} />
                    </Table.Td>
                    <Table.Td style={{ maxWidth: 260 }}>
                      <Text size="sm" fw={500}>
                        {t.accion}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {textoFrecuenciaTarea(t)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={4} align="flex-start">
                        <Anchor component={Link} to={`/maquinas/${t.maquina.id}`} size="sm">
                          {etiquetaMaquina(t.maquina)}
                        </Anchor>
                        <CriticidadBadge criticidad={t.maquina.criticidad} size="xs" />
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <Anchor component={Link} to={`/preventivos/planes/${t.plan.id}`} size="sm">
                        {t.plan.nombre}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c={t.responsable ? undefined : 'dimmed'}>
                        {t.responsable ? nombreCompleto(t.responsable) : 'Sin responsable'}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      {t.intervencion_en_curso ? (
                        <Anchor component={Link} to={`/intervenciones/${t.intervencion_en_curso.id}`} size="sm">
                          Intervención N.º {t.intervencion_en_curso.id}
                        </Anchor>
                      ) : (
                        <Button size="xs" variant="light" color="marca" onClick={() => setPlanAGenerar(t.plan.id)}>
                          Generar
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          {totalPaginas > 1 && (
            <Group justify="center">
              <Pagination total={totalPaginas} value={filtros.pagina} onChange={(p) => onCambiarFiltros({ pagina: p })} />
            </Group>
          )}
        </>
      )}

      <ModalGenerar planId={planAGenerar} onCerrar={() => setPlanAGenerar(null)} />
    </Stack>
  );
}
