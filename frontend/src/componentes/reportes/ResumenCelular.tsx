import { useMemo, useState } from 'react';
import { Paper, SegmentedControl, Skeleton, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { clienteApi } from '../../api/cliente';
import type {
  EvolucionReporte,
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
import { GraficoEvolucion } from '../graficos/GraficoEvolucion';
import { GraficoRanking } from '../graficos/GraficoRanking';
import { COLOR_CORRECTIVO, formatEntero, formatHorasEje, formatTiempo, hayValores } from '../../lib/graficos';
import {
  TEXTO_EVOLUCION_7_DIAS,
  filasFallasSemana,
  rankingInactividad,
  tituloFallasSemana,
} from '../../lib/graficosReportes';

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

  // GR1, 4: la evolución de las fallas por semana; con 7 días hay una sola semana y no se pide
  const paramsEvolucion = useMemo(
    () => ({ desde: rango.desde, hasta: rango.hasta, agrupar: 'semana' }),
    [rango.desde, rango.hasta]
  );
  const queryEvolucion = useQuery<EvolucionReporte>({
    queryKey: ['reportes', 'evolucion', 'celular', paramsEvolucion],
    queryFn: () => clienteApi.get<EvolucionReporte>('/api/reportes/evolucion', { params: paramsEvolucion }),
    enabled: periodo !== '7d',
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
                : 'var(--sm-titulo)';

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
                        <Text key={idx} size="sm" fw={600} c="var(--sm-titulo)">
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

      {/* GR1, 4: debajo de las tarjetas, dos gráficos chicos */}
      {periodo === '7d' ? (
        <Paper withBorder p="md" radius="md">
          <Text size="sm" c="var(--sm-tenue)" ta="center">
            {TEXTO_EVOLUCION_7_DIAS}
          </Text>
        </Paper>
      ) : queryEvolucion.isError ? (
        <Text size="sm" c="var(--sm-peligro)">
          No se pudo cargar la evolución.
        </Text>
      ) : (
        <GraficoEvolucion
          titulo={queryEvolucion.data ? tituloFallasSemana(queryEvolucion.data) : 'Fallas por semana'}
          datos={queryEvolucion.data ? filasFallasSemana(queryEvolucion.data) : []}
          barras={[{ clave: 'fallas', etiqueta: 'Fallas', color: COLOR_CORRECTIVO }]}
          formatear={formatEntero}
          cargando={queryEvolucion.isLoading}
          vacio={queryEvolucion.data ? !hayValores(queryEvolucion.data.periodos.map((p) => p.fallas)) : false}
        />
      )}

      {queryInactividad.isError ? null : (
        (() => {
          const r = rankingInactividad(queryInactividad.data ?? [], 5);
          return (
            <GraficoRanking
              titulo={r.titulo}
              items={r.items}
              nombreValor="Tiempo parada"
              color="var(--sm-graf-3)"
              formatear={formatTiempo}
              formatearEje={formatHorasEje}
              cargando={queryInactividad.isLoading}
              vacio={r.items.length === 0}
            />
          );
        })()
      )}

      <Text size="xs" c="dimmed" ta="center" mt="xs">
        Para ver todos los reportes, apagá el modo simple en Mi cuenta
      </Text>
    </Stack>
  );
}
