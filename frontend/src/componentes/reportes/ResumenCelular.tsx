import { useMemo, useState } from 'react';
import { Paper, SegmentedControl, Skeleton, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { clienteApi } from '../../api/cliente';
import type {
  InactividadMaquinaFila,
  IndicadoresReporte,
  ReporteCostosRespuesta,
  ReportePreventivosRespuesta,
} from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import {
  PeriodoResumenCelular,
  rangoResumenCelular,
  tarjetasResumenCelular,
} from '../../lib/reportes';

export function ResumenCelular() {
  const { usuario, tienePermiso } = useAuth();
  const veCostos = tienePermiso('COSTOS_VER');
  const [periodo, setPeriodo] = useState<PeriodoResumenCelular>('30d');

  const rango = useMemo(() => rangoResumenCelular(periodo), [periodo]);

  const paramsBase = useMemo(
    () => ({
      desde: rango.desde,
      hasta: rango.hasta,
    }),
    [rango.desde, rango.hasta]
  );

  const paramsPreventivos = useMemo(
    () => ({
      desde: rango.desde,
      hasta: rango.hasta,
      agrupar: 'sector',
    }),
    [rango.desde, rango.hasta]
  );

  const queryIndicadores = useQuery<IndicadoresReporte>({
    queryKey: ['reportes', 'indicadores', 'celular', paramsBase],
    queryFn: () => clienteApi.get<IndicadoresReporte>('/api/reportes/indicadores', { params: paramsBase }),
  });

  const queryPreventivos = useQuery<ReportePreventivosRespuesta>({
    queryKey: ['reportes', 'preventivos', 'celular', paramsPreventivos],
    queryFn: () =>
      clienteApi.get<ReportePreventivosRespuesta>('/api/reportes/preventivos', {
        params: paramsPreventivos,
      }),
  });

  const queryCostos = useQuery<ReporteCostosRespuesta>({
    queryKey: ['reportes', 'costos', 'celular', paramsBase],
    queryFn: () => clienteApi.get<ReporteCostosRespuesta>('/api/reportes/costos', { params: paramsBase }),
    enabled: veCostos,
  });

  const queryInactividad = useQuery<InactividadMaquinaFila[]>({
    queryKey: ['reportes', 'inactividad', 'celular', paramsBase],
    queryFn: () => clienteApi.get<InactividadMaquinaFila[]>('/api/reportes/inactividad', { params: paramsBase }),
  });

  const tarjetas = useMemo(
    () =>
      tarjetasResumenCelular(
        {
          indicadores: queryIndicadores.data,
          preventivos: queryPreventivos.data,
          costos: queryCostos.data,
          inactividad: queryInactividad.data,
          cargando: {
            indicadores: queryIndicadores.isLoading,
            preventivos: queryPreventivos.isLoading,
            costos: veCostos && queryCostos.isLoading,
            inactividad: queryInactividad.isLoading,
          },
          error: {
            indicadores: queryIndicadores.isError,
            preventivos: queryPreventivos.isError,
            costos: veCostos && queryCostos.isError,
            inactividad: queryInactividad.isError,
          },
        },
        usuario?.permisos
      ),
    [
      queryIndicadores.data,
      queryIndicadores.isLoading,
      queryIndicadores.isError,
      queryPreventivos.data,
      queryPreventivos.isLoading,
      queryPreventivos.isError,
      queryCostos.data,
      queryCostos.isLoading,
      queryCostos.isError,
      queryInactividad.data,
      queryInactividad.isLoading,
      queryInactividad.isError,
      veCostos,
      usuario?.permisos,
    ]
  );

  return (
    <Stack gap="md">
      <SegmentedControl
        fullWidth
        value={periodo}
        onChange={(val) => setPeriodo(val as PeriodoResumenCelular)}
        data={[
          { value: '7d', label: '7 días' },
          { value: '30d', label: '30 días' },
          { value: 'mes', label: 'Este mes' },
        ]}
      />

      <Stack gap="sm">
        {tarjetas.map((t) => {
          const colorValor =
            t.color === 'green' || t.color === 'yellow' || t.color === 'red'
              ? `${t.color}.7`
              : t.valor === '—'
                ? 'dimmed'
                : '#0f172a';

          return (
            <Paper key={t.id} withBorder p="md" radius="md">
              <Stack gap={4}>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                  {t.titulo}
                </Text>

                {t.cargando ? (
                  <>
                    <Skeleton height={28} width="50%" radius="sm" mt={4} />
                    <Skeleton height={14} width="65%" radius="sm" mt={4} />
                  </>
                ) : t.error ? (
                  <Text size="sm" c="red" mt={4}>
                    {t.error}
                  </Text>
                ) : t.id === 'inactividad' ? (
                  t.items && t.items.length > 0 ? (
                    <Stack gap={4} mt={4}>
                      {t.items.map((linea, idx) => (
                        <Text key={idx} size="sm" fw={600} c="#0f172a">
                          {linea}
                        </Text>
                      ))}
                    </Stack>
                  ) : (
                    <Text fz="1.75rem" fw={700} lh={1.15} c="dimmed" mt={2}>
                      —
                    </Text>
                  )
                ) : (
                  <>
                    <Text fz="1.75rem" fw={700} lh={1.15} c={colorValor} mt={2}>
                      {t.valor}
                    </Text>
                    {t.lineaChica && (
                      <Text size="xs" c="dimmed">
                        {t.lineaChica}
                      </Text>
                    )}
                  </>
                )}
              </Stack>
            </Paper>
          );
        })}
      </Stack>

      <Text size="xs" c="dimmed" ta="center" mt="xs">
        El detalle completo está en Reportes, desde la computadora.
      </Text>
    </Stack>
  );
}
