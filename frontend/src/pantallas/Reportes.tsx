import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Stack, Title, Tabs, Skeleton, Alert, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { clienteApi } from '../api/cliente';
import {
  Planta,
  SectorLista,
  IndicadoresReporte,
  InactividadMaquinaFila,
  TiemposAgrupadosFila,
} from '../api/tipos';
import {
  leerFiltrosReportes,
  escribirFiltrosReportes,
  rangoDePeriodo,
  FiltrosReportes,
  VistaReporte,
  AgrupacionTiempos,
} from '../lib/reportes';
import { FiltrosReportesBarra } from '../componentes/reportes/FiltrosReportes';
import { TabIndicadores } from '../componentes/reportes/TabIndicadores';
import { TabInactividad } from '../componentes/reportes/TabInactividad';
import { TabTiempos } from '../componentes/reportes/TabTiempos';

export function Reportes() {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Filtros actuales desde la URL
  const filtros = useMemo(() => leerFiltrosReportes(searchParams), [searchParams]);

  // 2. Rango de fechas ISO calculado a partir del período
  const rango = useMemo(() => rangoDePeriodo(filtros), [filtros]);

  // 3. Plantas y sectores para los filtros
  const { data: plantas } = useQuery<Planta[]>({
    queryKey: ['plantas'],
    queryFn: () => clienteApi.get<Planta[]>('/api/plantas'),
    staleTime: 300000,
  });

  const { data: sectores } = useQuery<SectorLista[]>({
    queryKey: ['sectores'],
    queryFn: () => clienteApi.get<SectorLista[]>('/api/sectores'),
    staleTime: 300000,
  });

  // 4. Parámetros de consulta para la API
  const queryParams = useMemo(() => {
    const p: Record<string, string | number> = {
      desde: rango.desde,
      hasta: rango.hasta,
    };
    if (filtros.planta) p.planta_id = filtros.planta;
    if (filtros.sector) p.sector_id = filtros.sector;
    return p;
  }, [rango, filtros.planta, filtros.sector]);

  // 5. Consultas según la pestaña activa
  const queryIndicadores = useQuery<IndicadoresReporte>({
    queryKey: ['reportes', 'indicadores', queryParams],
    queryFn: () => clienteApi.get<IndicadoresReporte>('/api/reportes/indicadores', { params: queryParams }),
    enabled: filtros.vista === 'indicadores',
  });

  const queryInactividad = useQuery<InactividadMaquinaFila[]>({
    queryKey: ['reportes', 'inactividad', queryParams],
    queryFn: () => clienteApi.get<InactividadMaquinaFila[]>('/api/reportes/inactividad', { params: queryParams }),
    enabled: filtros.vista === 'inactividad',
  });

  const queryTiemposParams = useMemo(() => {
    return {
      ...queryParams,
      agrupar: filtros.agrupar,
    };
  }, [queryParams, filtros.agrupar]);

  const queryTiempos = useQuery<TiemposAgrupadosFila[]>({
    queryKey: ['reportes', 'tiempos', queryTiemposParams],
    queryFn: () => clienteApi.get<TiemposAgrupadosFila[]>('/api/reportes/tiempos', { params: queryTiemposParams }),
    enabled: filtros.vista === 'tiempos',
  });

  // 6. Actualización de filtros sincronizada con la URL
  const handleFiltrosChange = (cambios: Partial<FiltrosReportes>) => {
    const nuevosFiltros: FiltrosReportes = {
      ...filtros,
      ...cambios,
    };
    setSearchParams(escribirFiltrosReportes(nuevosFiltros));
  };

  const handleTabChange = (val: string | null) => {
    if (!val) return;
    handleFiltrosChange({ vista: val as VistaReporte });
  };

  const handleAgruparChange = (nuevaAgrupacion: AgrupacionTiempos) => {
    handleFiltrosChange({ agrupar: nuevaAgrupacion });
  };

  return (
    <Stack gap="lg">
      <Title order={2} c="#0f172a">
        Reportes
      </Title>

      {/* Barra de filtros (Período, Planta, Sector y rango visible) */}
      <FiltrosReportesBarra
        filtros={filtros}
        onFiltrosChange={handleFiltrosChange}
        plantas={plantas}
        sectores={sectores}
        rango={rango}
      />

      {/* Pestañas: Indicadores · Inactividad · Tiempos */}
      <Tabs value={filtros.vista} onChange={handleTabChange}>
        <Tabs.List>
          <Tabs.Tab value="indicadores">Indicadores</Tabs.Tab>
          <Tabs.Tab value="inactividad">Inactividad</Tabs.Tab>
          <Tabs.Tab value="tiempos">Tiempos</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="indicadores">
          {queryIndicadores.isLoading && <Skeleton height={260} mt="md" radius="sm" />}
          {queryIndicadores.isError && (
            <Alert color="red" my="md">
              <Text size="sm">No se pudieron cargar los indicadores de mantenimiento.</Text>
            </Alert>
          )}
          {queryIndicadores.data && (
            <TabIndicadores data={queryIndicadores.data} rango={rango} />
          )}
        </Tabs.Panel>

        <Tabs.Panel value="inactividad">
          {queryInactividad.isLoading && <Skeleton height={260} mt="md" radius="sm" />}
          {queryInactividad.isError && (
            <Alert color="red" my="md">
              <Text size="sm">No se pudo cargar el reporte de inactividad.</Text>
            </Alert>
          )}
          {queryInactividad.data && (
            <TabInactividad data={queryInactividad.data} rango={rango} />
          )}
        </Tabs.Panel>

        <Tabs.Panel value="tiempos">
          {queryTiempos.isLoading && <Skeleton height={260} mt="md" radius="sm" />}
          {queryTiempos.isError && (
            <Alert color="red" my="md">
              <Text size="sm">No se pudo cargar el reporte de tiempos agrupados.</Text>
            </Alert>
          )}
          {queryTiempos.data && (
            <TabTiempos
              data={queryTiempos.data}
              agrupar={filtros.agrupar}
              onAgruparChange={handleAgruparChange}
              rango={rango}
            />
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

export default Reportes;
