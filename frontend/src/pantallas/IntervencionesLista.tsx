import { useState, useEffect, useMemo } from 'react';
import {
  Stack,
  Group,
  Title,
  Button,
  Tabs,
  Text,
  Center,
  Loader,
  Alert,
  Pagination,
} from '@mantine/core';
import { IconAlertCircle, IconPlus } from '@tabler/icons-react';
import { useSearchParams, useNavigate, useLocation } from 'react-router';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useDebouncedValue } from '@mantine/hooks';
import { useAuth } from '../auth/AuthContext';
import { clienteApi } from '../api/cliente';
import { PantallaVacia } from '../componentes/PantallaVacia';
import { FiltrosIntervenciones } from '../componentes/intervenciones/FiltrosIntervenciones';
import { TablaIntervenciones } from '../componentes/intervenciones/TablaIntervenciones';
import { BotonExportar } from '../componentes/intervenciones/BotonExportar';
import { paramsExportacion } from '../lib/exportacion';
import {
  vistasDisponibles,
  leerFiltros,
  escribirFiltros,
  paramsListado,
  hayFiltros,
  paginaValida,
  FILTROS_POR_DEFECTO,
  VistaIntervenciones,
} from '../lib/listado';
import { mensajeError } from '../lib/errores';
import type { IntervencionLista, SectorLista, MaquinaLista, Planta } from '../api/tipos';

export function IntervencionesLista() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const permitidas = useMemo(
    () => vistasDisponibles(usuario?.permisos),
    [usuario?.permisos]
  );

  const filtros = useMemo(
    () => leerFiltros(searchParams, permitidas),
    [searchParams, permitidas]
  );

  // Debounced search text
  const [busquedaLocal, setBusquedaLocal] = useState(filtros.texto);
  const [debouncedBusqueda] = useDebouncedValue(busquedaLocal, 400);

  // Sincronizar input si los query params cambian externamente (ej: volver atrás, limpiar filtros)
  useEffect(() => {
    if (filtros.texto !== busquedaLocal.trim()) {
      setBusquedaLocal(filtros.texto);
    }
  }, [filtros.texto]);

  // Actualizar filtros cuando termina el debounce
  useEffect(() => {
    if (debouncedBusqueda.trim() !== filtros.texto) {
      setSearchParams(
        escribirFiltros({
          ...filtros,
          texto: debouncedBusqueda.trim(),
          pagina: 1,
        })
      );
    }
  }, [debouncedBusqueda]);

  // Plantas, sectores y máquinas para los selects de filtro
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

  const { data: maquinas } = useQuery<MaquinaLista[]>({
    queryKey: ['maquinas'],
    queryFn: () => clienteApi.get<MaquinaLista[]>('/api/maquinas'),
    staleTime: 300000,
  });

  const mostrarPlanta = (plantas?.length ?? 0) >= 2;

  const sectoresVisibles = useMemo(() => {
    if (!sectores) return [];
    if (filtros.plantaId === null) return sectores;
    return sectores.filter((s) => s.planta?.id === filtros.plantaId);
  }, [sectores, filtros.plantaId]);

  const maquinasFiltradas = useMemo(() => {
    if (!maquinas) return [];
    return maquinas.filter((m) => {
      if (filtros.sectorId !== null && m.sector.id !== filtros.sectorId) {
        return false;
      }
      if (filtros.plantaId !== null && m.sector.planta?.id !== filtros.plantaId) {
        return false;
      }
      return true;
    });
  }, [maquinas, filtros.sectorId, filtros.plantaId]);

  // Petición del listado de intervenciones
  const queryParams = useMemo(() => paramsListado(filtros, 25), [filtros]);

  const { data, isLoading, isError, error, isPlaceholderData } = useQuery({
    queryKey: ['intervenciones', queryParams],
    queryFn: () =>
      clienteApi.listar<IntervencionLista>('/api/intervenciones', {
        params: queryParams,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 60000,
  });

  // Reajustar página si queda fuera de rango
  useEffect(() => {
    if (data && !isPlaceholderData && data.total !== undefined) {
      const paginaAjustada = paginaValida(filtros.pagina, data.total, 25);
      if (paginaAjustada !== filtros.pagina) {
        setSearchParams(
          escribirFiltros({
            ...filtros,
            pagina: paginaAjustada,
          }),
          { replace: true }
        );
      }
    }
  }, [data, isPlaceholderData, filtros, setSearchParams]);

  const puedeCrear = Boolean(usuario?.permisos?.['INTERVENCIONES_CREAR']);
  const tieneFiltrosActivos = hayFiltros(filtros);
  const totalPaginas = Math.ceil((data?.total ?? 0) / 25);

  const handleTabChange = (value: string | null) => {
    if (!value) return;
    const nuevaVista = value as VistaIntervenciones;
    setSearchParams(
      escribirFiltros({
        ...filtros,
        vista: nuevaVista,
        estados: [],
        pagina: 1,
      })
    );
  };

  const handlePlantaChange = (val: string | null) => {
    const nuevaPlantaId = val ? Number(val) : null;
    let nuevoSectorId = filtros.sectorId;
    if (nuevaPlantaId !== null && nuevoSectorId !== null && sectores) {
      const sec = sectores.find((s) => s.id === nuevoSectorId);
      if (!sec || sec.planta?.id !== nuevaPlantaId) {
        nuevoSectorId = null;
      }
    }
    let nuevaMaquinaId = filtros.maquinaId;
    if (nuevaMaquinaId !== null && maquinas) {
      const maq = maquinas.find((m) => m.id === nuevaMaquinaId);
      if (
        maq &&
        ((nuevoSectorId !== null && maq.sector.id !== nuevoSectorId) ||
          (nuevaPlantaId !== null && maq.sector.planta?.id !== nuevaPlantaId))
      ) {
        nuevaMaquinaId = null;
      }
    }
    setSearchParams(
      escribirFiltros({
        ...filtros,
        plantaId: nuevaPlantaId,
        sectorId: nuevoSectorId,
        maquinaId: nuevaMaquinaId,
        pagina: 1,
      })
    );
  };

  const handleSectorChange = (val: string | null) => {
    const nuevoSectorId = val ? Number(val) : null;
    let nuevaMaquinaId = filtros.maquinaId;
    if (nuevoSectorId !== null && nuevaMaquinaId !== null && maquinas) {
      const maq = maquinas.find((m) => m.id === nuevaMaquinaId);
      if (maq && maq.sector.id !== nuevoSectorId) {
        nuevaMaquinaId = null;
      }
    }
    setSearchParams(
      escribirFiltros({
        ...filtros,
        sectorId: nuevoSectorId,
        maquinaId: nuevaMaquinaId,
        pagina: 1,
      })
    );
  };

  const handleMaquinaChange = (val: string | null) => {
    const nuevaMaquinaId = val ? Number(val) : null;
    setSearchParams(
      escribirFiltros({
        ...filtros,
        maquinaId: nuevaMaquinaId,
        pagina: 1,
      })
    );
  };

  const handleEstadosChange = (val: string[]) => {
    setSearchParams(
      escribirFiltros({
        ...filtros,
        estados: val,
        pagina: 1,
      })
    );
  };

  const handleTipoChange = (v: string | null) => {
    const { tipo: _anterior, ...resto } = filtros;
    const tipo = v === 'CORRECTIVO' || v === 'PREVENTIVO' ? v : undefined;
    setSearchParams(escribirFiltros({ ...resto, ...(tipo ? { tipo } : {}), pagina: 1 }));
  };

  const handleRangoFechasChange = (dates: [string | null, string | null]) => {
    const desde = dates[0] ? dates[0] : null;
    const hasta = dates[1] ? dates[1] : null;
    setSearchParams(
      escribirFiltros({
        ...filtros,
        desde,
        hasta,
        pagina: 1,
      })
    );
  };

  const handleLimpiarFiltros = () => {
    setBusquedaLocal('');
    setSearchParams(
      escribirFiltros({
        ...FILTROS_POR_DEFECTO,
        vista: filtros.vista,
      })
    );
  };

  const handleFilaClick = (id: number) => {
    navigate(`/intervenciones/${id}`, {
      state: { volverA: location.pathname + location.search },
    });
  };

  return (
    <Stack gap="lg">
      {/* 5.1 Encabezado */}
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={2} c="var(--sm-titulo)">
          Intervenciones
        </Title>
        {puedeCrear && (
          <Button
            color="marca"
            leftSection={<IconPlus size={18} />}
            onClick={() => navigate('/reportar')}
          >
            Reportar falla
          </Button>
        )}
      </Group>

      {/* Pestañas de vistas */}
      <Tabs value={filtros.vista} onChange={handleTabChange}>
        <Tabs.List>
          {permitidas.includes('sin-asignar') && (
            <Tabs.Tab value="sin-asignar">Sin asignar</Tabs.Tab>
          )}
          {permitidas.includes('mias') && (
            <Tabs.Tab value="mias">Mías</Tabs.Tab>
          )}
          {permitidas.includes('abiertas') && (
            <Tabs.Tab value="abiertas">Abiertas</Tabs.Tab>
          )}
          {permitidas.includes('cerradas') && (
            <Tabs.Tab value="cerradas">Cerradas</Tabs.Tab>
          )}
        </Tabs.List>
      </Tabs>

      {/* 5.2 Filtros */}
      <FiltrosIntervenciones
        filtros={filtros}
        busqueda={busquedaLocal}
        onBusqueda={setBusquedaLocal}
        mostrarPlanta={mostrarPlanta}
        plantas={plantas}
        sectoresVisibles={sectoresVisibles}
        maquinasFiltradas={maquinasFiltradas}
        maquinas={maquinas}
        onEstados={handleEstadosChange}
        onPlanta={handlePlantaChange}
        onSector={handleSectorChange}
        onMaquina={handleMaquinaChange}
        onTipo={handleTipoChange}
        onRangoFechas={handleRangoFechasChange}
      />

      {/* 5.4 Mensaje de error al pedir */}
      {isError && (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {mensajeError(error)}
        </Alert>
      )}

      {/* Conteo total y limpiar filtros */}
      {data && (
        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">
            {data.total} {data.total === 1 ? 'intervención' : 'intervenciones'}
          </Text>
          <Group gap="xs">
            {tieneFiltrosActivos && (
              <Button variant="subtle" color="gray" size="sm" onClick={handleLimpiarFiltros}>
                Limpiar filtros
              </Button>
            )}
            {/* MQ1, 4.3: con los filtros que estén puestos */}
            {data.total > 0 && <BotonExportar params={paramsExportacion(filtros)} />}
          </Group>
        </Group>
      )}

      {/* 5.3 y 5.4 Tabla / Carga / Vacío */}
      {isLoading && !data ? (
        <Center py="xl">
          <Loader color="marca" />
        </Center>
      ) : data?.total === 0 ? (
        tieneFiltrosActivos ? (
          <PantallaVacia
            titulo="No hay intervenciones con estos filtros."
            accion={
              <Button variant="default" onClick={handleLimpiarFiltros}>
                Limpiar filtros
              </Button>
            }
          />
        ) : filtros.vista === 'sin-asignar' ? (
          <PantallaVacia titulo="No hay fallas sin asignar." />
        ) : (
          <PantallaVacia titulo="No hay intervenciones en esta vista." />
        )
      ) : (
        <Stack gap="md">
          <TablaIntervenciones
            items={data?.items || []}
            volverA={location.pathname + location.search}
            onFilaClick={handleFilaClick}
          />

          {/* 5.3 Paginación */}
          {totalPaginas > 1 && (
            <Group justify="center" mt="md">
              <Pagination
                total={totalPaginas}
                value={filtros.pagina}
                onChange={(p) =>
                  setSearchParams(escribirFiltros({ ...filtros, pagina: p }))
                }
              />
            </Group>
          )}
        </Stack>
      )}
    </Stack>
  );
}

export default IntervencionesLista;
