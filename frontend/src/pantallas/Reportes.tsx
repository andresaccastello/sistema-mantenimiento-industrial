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
  ReporteCostosRespuesta,
  ReportePreventivosRespuesta,
} from '../api/tipos';
import {
  leerFiltrosReportes,
  escribirFiltrosReportes,
  rangoDePeriodo,
  FiltrosReportes,
  VistaReporte,
  AgrupacionTiempos,
  AgrupacionPreventivos,
  agruparDeTiempos,
  agruparDePreventivos,
  vistaReporteVisible,
} from '../lib/reportes';
import { FiltrosReportesBarra } from '../componentes/reportes/FiltrosReportes';
import { TabIndicadores } from '../componentes/reportes/TabIndicadores';
import { TabInactividad } from '../componentes/reportes/TabInactividad';
import { TabTiempos } from '../componentes/reportes/TabTiempos';
import {
  TabReporteRepuestos,
  ReporteRepuestosData,
} from '../componentes/reportes/TabReporteRepuestos';
import { TabPreventivos } from '../componentes/reportes/TabPreventivos';
import { TabReporteCostos } from '../componentes/reportes/TabReporteCostos';
import { useAuth } from '../auth/AuthContext';

export function Reportes() {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Filtros actuales desde la URL
  const filtros = useMemo(() => leerFiltrosReportes(searchParams), [searchParams]);

  // La pestaña Costos solo se muestra con COSTOS_VER; sin ese permiso, vuelve a Indicadores
  const { tienePermiso } = useAuth();
  const veCostos = tienePermiso('COSTOS_VER');
  const vista = vistaReporteVisible(filtros.vista, veCostos);

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
    enabled: vista === 'indicadores',
  });

  const queryInactividad = useQuery<InactividadMaquinaFila[]>({
    queryKey: ['reportes', 'inactividad', queryParams],
    queryFn: () => clienteApi.get<InactividadMaquinaFila[]>('/api/reportes/inactividad', { params: queryParams }),
    enabled: vista === 'inactividad',
  });

  const agruparTiempos = agruparDeTiempos(filtros.agrupar);
  const agruparPreventivos = agruparDePreventivos(filtros.agrupar);

  const queryTiemposParams = useMemo(() => {
    return {
      ...queryParams,
      agrupar: agruparTiempos,
    };
  }, [queryParams, agruparTiempos]);

  const queryTiempos = useQuery<TiemposAgrupadosFila[]>({
    queryKey: ['reportes', 'tiempos', queryTiemposParams],
    queryFn: () => clienteApi.get<TiemposAgrupadosFila[]>('/api/reportes/tiempos', { params: queryTiemposParams }),
    enabled: vista === 'tiempos',
  });

  const queryRepuestos = useQuery<ReporteRepuestosData>({
    queryKey: ['reportes', 'repuestos', queryParams],
    queryFn: () => clienteApi.get<ReporteRepuestosData>('/api/reportes/repuestos', { params: queryParams }),
    enabled: vista === 'repuestos',
  });

  const queryPreventivosParams = useMemo(() => {
    return {
      ...queryParams,
      agrupar: agruparPreventivos,
    };
  }, [queryParams, agruparPreventivos]);

  const queryPreventivos = useQuery<ReportePreventivosRespuesta>({
    queryKey: ['reportes', 'preventivos', queryPreventivosParams],
    queryFn: () => clienteApi.get<ReportePreventivosRespuesta>('/api/reportes/preventivos', { params: queryPreventivosParams }),
    enabled: vista === 'preventivos',
  });

  const queryCostos = useQuery<ReporteCostosRespuesta>({
    queryKey: ['reportes', 'costos', queryParams],
    queryFn: () => clienteApi.get<ReporteCostosRespuesta>('/api/reportes/costos', { params: queryParams }),
    enabled: vista === 'costos',
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

  const handleAgruparPreventivosChange = (nuevaAgrupacion: AgrupacionPreventivos) => {
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

      {/* Pestañas: Indicadores · Inactividad · Tiempos · Repuestos · Preventivos · Costos */}
      <Tabs value={vista} onChange={handleTabChange}>
        <Tabs.List>
          <Tabs.Tab value="indicadores">Indicadores</Tabs.Tab>
          <Tabs.Tab value="inactividad">Inactividad</Tabs.Tab>
          <Tabs.Tab value="tiempos">Tiempos</Tabs.Tab>
          <Tabs.Tab value="repuestos">Repuestos</Tabs.Tab>
          <Tabs.Tab value="preventivos">Preventivos</Tabs.Tab>
          {veCostos && <Tabs.Tab value="costos">Costos</Tabs.Tab>}
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
              agrupar={agruparTiempos}
              onAgruparChange={handleAgruparChange}
              rango={rango}
            />
          )}
        </Tabs.Panel>

        <Tabs.Panel value="repuestos">
          {queryRepuestos.isLoading && <Skeleton height={260} mt="md" radius="sm" />}
          {queryRepuestos.isError && (
            <Alert color="red" my="md">
              <Text size="sm">No se pudo cargar el reporte de repuestos.</Text>
            </Alert>
          )}
          {queryRepuestos.data && (
            <TabReporteRepuestos datos={queryRepuestos.data} />
          )}
        </Tabs.Panel>

        <Tabs.Panel value="preventivos">
          <TabPreventivos
            datos={queryPreventivos.data}
            cargando={queryPreventivos.isLoading}
            error={queryPreventivos.isError ? queryPreventivos.error : undefined}
            reintentar={() => queryPreventivos.refetch()}
            agrupar={agruparPreventivos}
            onCambiarAgrupar={handleAgruparPreventivosChange}
            desde={rango.desde}
            hasta={rango.hasta}
          />
        </Tabs.Panel>

        {veCostos && (
          <Tabs.Panel value="costos">
            {queryCostos.isLoading && <Skeleton height={260} mt="md" radius="sm" />}
            {queryCostos.isError && (
              <Alert color="red" my="md">
                <Text size="sm">No se pudo cargar el reporte de costos.</Text>
              </Alert>
            )}
            {queryCostos.data && <TabReporteCostos datos={queryCostos.data} />}
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}

export default Reportes;
