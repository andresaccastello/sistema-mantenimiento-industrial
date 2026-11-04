import React, { useState, useEffect, useMemo } from 'react';
import {
  Stack,
  Group,
  Title,
  Button,
  Tabs,
  TextInput,
  MultiSelect,
  Select,
  Table,
  Badge,
  Text,
  Center,
  Loader,
  Alert,
  Pagination,
  Box,
  SimpleGrid,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconSearch, IconAlertCircle, IconPlus } from '@tabler/icons-react';
import { useSearchParams, useNavigate, useLocation, Link } from 'react-router';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useDebouncedValue } from '@mantine/hooks';
import { useAuth } from '../auth/AuthContext';
import { clienteApi } from '../api/cliente';
import { EstadoBadge } from '../componentes/EstadoBadge';
import { PantallaVacia } from '../componentes/PantallaVacia';
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
import { tiempoLista } from '../lib/intervenciones';
import { etiquetaMaquina, coincideMaquina } from '../lib/maquinas';
import { nombreCompleto } from '../lib/personas';
import { formatHace, formatFechaHora } from '../lib/formato';
import { obtenerInfoEstado } from '../lib/estados';
import { mensajeError } from '../lib/errores';
import type { IntervencionLista, SectorLista, MaquinaLista, Planta } from '../api/tipos';

const ESTADOS_OPCIONES: Record<VistaIntervenciones, Array<{ value: string; label: string }>> = {
  'sin-asignar': [],
  mias: [
    { value: 'PENDIENTE', label: 'Pendiente' },
    { value: 'EN_PROCESO', label: 'En proceso' },
    { value: 'EN_ESPERA_REPUESTOS', label: 'En espera de repuestos' },
  ],
  abiertas: [
    { value: 'PENDIENTE', label: 'Pendiente' },
    { value: 'EN_PROCESO', label: 'En proceso' },
    { value: 'EN_ESPERA_REPUESTOS', label: 'En espera de repuestos' },
  ],
  cerradas: [
    { value: 'FINALIZADA', label: 'Finalizada' },
    { value: 'CANCELADA', label: 'Cancelada' },
  ],
};

function aYYYYMMDD(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'string') {
    return val.slice(0, 10);
  }
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const day = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return null;
}

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
        <Title order={2} c="#0f172a">
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
      <SimpleGrid
        cols={{ base: 1, sm: 2, lg: 3, xl: mostrarPlanta ? 6 : 5 }}
        spacing="sm"
      >
        <TextInput
          aria-label="Buscar"
          placeholder="Máquina, código o descripción"
          leftSection={<IconSearch size={16} />}
          value={busquedaLocal}
          onChange={(e) => setBusquedaLocal(e.currentTarget.value)}
        />

        <MultiSelect
          aria-label="Estado"
          placeholder={filtros.estados.length === 0 ? 'Estado' : undefined}
          data={ESTADOS_OPCIONES[filtros.vista]}
          value={filtros.estados}
          onChange={handleEstadosChange}
          clearable
          disabled={filtros.vista === 'sin-asignar'}
        />

        {mostrarPlanta && (
          <Select
            aria-label="Planta"
            placeholder="Planta"
            data={(plantas || []).map((p) => ({
              value: String(p.id),
              label: p.nombre,
            }))}
            value={filtros.plantaId ? String(filtros.plantaId) : null}
            onChange={handlePlantaChange}
            clearable
          />
        )}

        <Select
          aria-label="Sector"
          placeholder="Sector"
          data={sectoresVisibles.map((s) => ({
            value: String(s.id),
            label: s.nombre,
          }))}
          value={filtros.sectorId ? String(filtros.sectorId) : null}
          onChange={handleSectorChange}
          clearable
        />

        <Select
          aria-label="Máquina"
          placeholder="Máquina"
          searchable
          data={maquinasFiltradas.map((m) => ({
            value: String(m.id),
            label: etiquetaMaquina(m),
          }))}
          filter={({ options, search }) => {
            if (!search) return options;
            return options.filter((opt) => {
              if ('value' in opt) {
                const maq = maquinas?.find((m) => String(m.id) === opt.value);
                return maq ? coincideMaquina(maq, search) : opt.label.toLowerCase().includes(search.toLowerCase());
              }
              return true;
            });
          }}
          value={filtros.maquinaId ? String(filtros.maquinaId) : null}
          onChange={handleMaquinaChange}
          clearable
        />

        <DatePickerInput
          aria-label="Reportadas entre"
          type="range"
          allowSingleDateInRange
          placeholder="Reportadas entre"
          valueFormat="DD/MM/YYYY"
          clearable
          value={
            filtros.desde || filtros.hasta
              ? [
                  filtros.desde ? new Date(`${filtros.desde}T00:00:00`) : null,
                  filtros.hasta ? new Date(`${filtros.hasta}T00:00:00`) : null,
                ]
              : [null, null]
          }
          onChange={(dates) => {
            if (!dates) {
              handleRangoFechasChange([null, null]);
            } else {
              handleRangoFechasChange([
                dates[0] ? aYYYYMMDD(dates[0]) : null,
                dates[1] ? aYYYYMMDD(dates[1]) : null,
              ]);
            }
          }}
        />
      </SimpleGrid>

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
          {tieneFiltrosActivos && (
            <Button variant="subtle" color="gray" size="sm" onClick={handleLimpiarFiltros}>
              Limpiar filtros
            </Button>
          )}
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
          <Table.ScrollContainer minWidth={900}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 80 }}>N.º</Table.Th>
                  <Table.Th>Máquina</Table.Th>
                  <Table.Th style={{ minWidth: 180 }}>Estado</Table.Th>
                  <Table.Th style={{ minWidth: 160 }}>Responsable</Table.Th>
                  <Table.Th style={{ minWidth: 130 }}>Reportada</Table.Th>
                  <Table.Th style={{ minWidth: 210, whiteSpace: 'nowrap' }}>Tiempo</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(data?.items || []).map((item) => {
                  const t = tiempoLista(item);
                  return (
                    <Table.Tr
                      key={item.id}
                      onClick={() => handleFilaClick(item.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Table.Td onClick={(e) => e.stopPropagation()}>
                        <Link
                          to={`/intervenciones/${item.id}`}
                          state={{ volverA: location.pathname + location.search }}
                          style={{
                            textDecoration: 'none',
                            color: 'inherit',
                            fontWeight: 600,
                          }}
                        >
                          #{item.id}
                        </Link>
                      </Table.Td>

                      <Table.Td>
                        <Text fw={600} size="sm">
                          {etiquetaMaquina(item.maquina)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {item.maquina.sector.nombre}
                        </Text>
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {item.descripcion}
                        </Text>
                      </Table.Td>

                      <Table.Td>
                        <Group gap="xs" align="center" wrap="wrap">
                          <EstadoBadge entidad="intervencion" estado={item.estado} />
                          {item.detiene_maquina_actualmente && (
                            <Badge color="red" variant="filled" size="sm">
                              Máquina detenida
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>

                      <Table.Td>
                        {item.responsable ? (
                          <Text size="sm">{nombreCompleto(item.responsable)}</Text>
                        ) : (
                          <Text size="sm" c="dimmed">
                            Sin asignar
                          </Text>
                        )}
                      </Table.Td>

                      <Table.Td>
                        <Text size="sm" title={formatFechaHora(item.fecha_creacion)}>
                          {formatHace(item.fecha_creacion)}
                        </Text>
                      </Table.Td>

                      <Table.Td style={{ minWidth: 210, whiteSpace: 'nowrap' }}>
                        <Group gap={6} align="center" wrap="nowrap">
                          <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
                            {t.etiqueta ? `${t.etiqueta} ${t.texto}` : t.texto}
                          </Text>
                          {t.enCurso && (
                            <Badge color="yellow" variant="light" size="xs">
                              en curso
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

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
