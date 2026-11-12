import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Alert, Box, Button, Group, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle } from '@tabler/icons-react';
import { obtenerCalendarioPreventivos } from '../../api/planes';
import { mensajeError } from '../../lib/errores';
import {
  ParamsCalendario,
  escribirParamsCalendario,
  eventosPorDia,
  hoyLocal,
  leerParamsCalendario,
  rangoCalendario,
  semanasDelMes,
} from '../../lib/calendario';
import type { FiltrosPreventivos } from '../../lib/preventivos';
import { FiltrosMaquinaPreventivos } from '../preventivos/FiltrosMaquinaPreventivos';
import { BarraCalendario } from './BarraCalendario';
import { GrillaMes } from './GrillaMes';
import { ListaPorUso } from './ListaPorUso';
import { PanelDia } from './PanelDia';
import { SemanaCalendario } from './SemanaCalendario';

interface Props {
  filtros: FiltrosPreventivos;
  onCambiarFiltros: (parcial: Partial<FiltrosPreventivos>) => void;
  /** La dirección entera: de acá salen `cal` y `fecha`. */
  params: URLSearchParams;
  onCambiarParams: (params: URLSearchParams) => void;
}

/** P1, pestaña Calendario (Etapa CAL1, D-028). */
export function TabCalendario({ filtros, onCambiarFiltros, params, onCambiarParams }: Props) {
  const hoyCompu = hoyLocal();
  const actual = leerParamsCalendario(params, hoyCompu);
  const rango = rangoCalendario(actual.vista, actual.fecha);
  const filtrosApi = { plantaId: filtros.plantaId, sectorId: filtros.sectorId, maquinaId: filtros.maquinaId };
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['planes', 'calendario', rango, filtrosApi],
    queryFn: () => obtenerCalendarioPreventivos(rango, filtrosApi),
    placeholderData: keepPreviousData,
  });

  const porDia = useMemo(() => eventosPorDia(data?.eventos ?? []), [data]);
  const hoy = data?.hoy ?? hoyCompu;
  const ir = (c: ParamsCalendario) => onCambiarParams(escribirParamsCalendario(params, c));
  const vencidas = data?.vencidas ?? 0;

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        <FiltrosMaquinaPreventivos filtros={filtros} onCambiar={onCambiarFiltros} />
      </SimpleGrid>

      <BarraCalendario actual={actual} hoy={hoyCompu} onIr={ir} />

      {vencidas > 0 && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />}>
          <Group justify="space-between" align="center" wrap="wrap" gap="xs">
            <Text size="sm" fw={500}>
              {vencidas === 1 ? 'Hay 1 tarea vencida' : `Hay ${vencidas} tareas vencidas`}
            </Text>
            <Button
              size="xs"
              color="red"
              variant="light"
              onClick={() => onCambiarFiltros({ vista: 'vencimientos', estado: 'VENCIDA', pagina: 1 })}
            >
              Ver vencidas
            </Button>
          </Group>
        </Alert>
      )}

      {isError ? (
        <Alert icon={<IconAlertCircle size={18} />} title="Error al cargar el calendario" color="red">
          <Group justify="space-between" align="center">
            <Text size="sm">{mensajeError(error)}</Text>
            <Button size="xs" variant="light" color="red" loading={isFetching} onClick={() => refetch()}>
              Reintentar
            </Button>
          </Group>
        </Alert>
      ) : isLoading && !data ? (
        <EsqueletoCalendario actual={actual} />
      ) : (
        <Stack gap="xs">
          {data && data.eventos.length === 0 && (
            <Text size="sm" c="dimmed">
              No hay preventivos en este período
            </Text>
          )}
          {actual.vista === 'mes' ? (
            <GrillaMes fecha={actual.fecha} hoy={hoy} porDia={porDia} onAbrirDia={setDiaAbierto} />
          ) : (
            <SemanaCalendario fecha={actual.fecha} hoy={hoy} porDia={porDia} onAbrirDia={setDiaAbierto} />
          )}
        </Stack>
      )}

      {data && <ListaPorUso tareas={data.por_uso} />}

      <PanelDia
        fecha={diaAbierto}
        eventos={diaAbierto ? porDia.get(diaAbierto) ?? [] : []}
        onCerrar={() => setDiaAbierto(null)}
      />
    </Stack>
  );
}

/** Mientras carga: la forma de la grilla (3.6). */
function EsqueletoCalendario({ actual }: { actual: ParamsCalendario }) {
  const filas = actual.vista === 'mes' ? semanasDelMes(actual.fecha).length : 1;
  return (
    <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
      {Array.from({ length: 7 }, (_, i) => (
        <Skeleton key={`t${i}`} height={20} radius="sm" />
      ))}
      {Array.from({ length: filas * 7 }, (_, i) => (
        <Skeleton key={i} height={actual.vista === 'mes' ? 108 : 240} radius="sm" />
      ))}
    </Box>
  );
}
