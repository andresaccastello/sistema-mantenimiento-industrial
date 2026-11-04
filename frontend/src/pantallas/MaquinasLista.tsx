import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Stack,
  Group,
  Title,
  Text,
  Button,
  TextInput,
  Select,
  MultiSelect,
  Switch,
  SimpleGrid,
  Paper,
  Table,
  Badge,
  Skeleton,
  Alert,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconSearch,
  IconPlus,
  IconX,
  IconAlertCircle,
} from '@tabler/icons-react';
import { clienteApi } from '../api/cliente';
import {
  Criticidad,
  MaquinaLista,
  Planta,
  SectorLista,
  TipoEquipo,
} from '../api/tipos';
import { useAuth } from '../auth/AuthContext';
import { obtenerInfoEstado } from '../lib/estados';
import { etiquetaMaquina } from '../lib/maquinas';
import {
  leerFiltrosMaquinas,
  escribirFiltrosMaquinas,
  filtrarMaquinas,
  hayFiltrosMaquinas,
  FILTROS_MAQUINAS_POR_DEFECTO,
  ESTADOS_MAQUINA_VALIDOS,
  FiltrosMaquinas,
} from '../lib/maquinasLista';
import { formatHace } from '../lib/formato';
import { mensajeError } from '../lib/errores';
import { EstadoBadge } from '../componentes/EstadoBadge';
import { CriticidadBadge } from '../componentes/CriticidadBadge';
import { ModalMaquina } from '../componentes/ModalMaquina';

export function MaquinasLista() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const puedeGestionar = Boolean(usuario?.permisos?.['MAQUINAS_GESTIONAR']);
  const filtros = leerFiltrosMaquinas(searchParams, puedeGestionar);

  const [busquedaLocal, setBusquedaLocal] = useState(filtros.texto);
  const [busquedaDebounced] = useDebouncedValue(busquedaLocal, 300);
  const [modalNuevaAbierto, setModalNuevaAbierto] = useState(false);

  // Sincronizar texto local cuando cambia desde la URL
  useEffect(() => {
    if (filtros.texto !== busquedaLocal.trim()) {
      setBusquedaLocal(filtros.texto);
    }
  }, [filtros.texto]);

  const actualizarFiltros = (parcial: Partial<FiltrosMaquinas>) => {
    const nuevos: FiltrosMaquinas = {
      ...filtros,
      ...parcial,
    };
    setSearchParams(escribirFiltrosMaquinas(nuevos));
  };

  useEffect(() => {
    const debTrim = busquedaDebounced.trim();
    if (debTrim !== filtros.texto) {
      actualizarFiltros({ texto: debTrim });
    }
  }, [busquedaDebounced]);

  const all = Boolean(puedeGestionar && filtros.inactivas);

  const maquinasQuery = useQuery({
    queryKey: ['maquinas', { all }],
    queryFn: () =>
      clienteApi.get<MaquinaLista[]>(
        '/api/maquinas',
        all ? { params: { all: 'true' } } : undefined
      ),
    refetchInterval: 60_000,
  });

  const criticidadesQuery = useQuery({
    queryKey: ['criticidades'],
    queryFn: () => clienteApi.get<Criticidad[]>('/api/criticidades'),
  });

  const tiposQuery = useQuery({
    queryKey: ['tipos-equipo'],
    queryFn: () => clienteApi.get<TipoEquipo[]>('/api/tipos-equipo'),
  });

  const plantasQuery = useQuery({
    queryKey: ['plantas'],
    queryFn: () => clienteApi.get<Planta[]>('/api/plantas'),
  });

  const sectoresQuery = useQuery({
    queryKey: ['sectores'],
    queryFn: () => clienteApi.get<SectorLista[]>('/api/sectores'),
  });

  const maquinas = maquinasQuery.data || [];
  const criticidades = criticidadesQuery.data || [];
  const tiposEquipo = tiposQuery.data || [];
  const plantas = plantasQuery.data || [];
  const sectores = sectoresQuery.data || [];

  const mostrarPlanta = plantas.length >= 2;

  const sectoresVisibles =
    filtros.plantaId !== null
      ? sectores.filter((s) => s.planta?.id === filtros.plantaId)
      : sectores;

  const opcionesEstado = ESTADOS_MAQUINA_VALIDOS.map((est) => ({
    value: est,
    label: obtenerInfoEstado('maquina', est).texto,
  }));

  const opcionesCriticidad = criticidades.map((c) => ({
    value: String(c.id),
    label: c.nombre,
  }));

  const opcionesTipo = tiposEquipo.map((t) => ({
    value: String(t.id),
    label: t.nombre,
  }));

  const opcionesSector = sectoresVisibles.map((s) => ({
    value: String(s.id),
    label: s.nombre,
  }));

  const opcionesPlanta = plantas.map((p) => ({
    value: String(p.id),
    label: p.nombre,
  }));

  const handlePlantaChange = (val: string | null) => {
    const nuevaPlantaId = val ? Number(val) : null;
    let nuevoSectorId = filtros.sectorId;
    if (nuevaPlantaId !== null && nuevoSectorId !== null) {
      const sec = sectores.find((s) => s.id === nuevoSectorId);
      if (!sec || sec.planta?.id !== nuevaPlantaId) {
        nuevoSectorId = null;
      }
    }
    actualizarFiltros({ plantaId: nuevaPlantaId, sectorId: nuevoSectorId });
  };

  const limpiarTodosLosFiltros = () => {
    setBusquedaLocal('');
    setSearchParams(
      escribirFiltrosMaquinas({
        ...FILTROS_MAQUINAS_POR_DEFECTO,
        inactivas: filtros.inactivas,
      })
    );
  };

  const maquinasFiltradas = filtrarMaquinas(maquinas, filtros);
  const tieneFiltrosActivos = hayFiltrosMaquinas(filtros);
  const ahora = new Date();
  const volverA = `${location.pathname}${location.search}`;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={2}>Máquinas</Title>
        {puedeGestionar && (
          <Button
            leftSection={<IconPlus size={18} />}
            onClick={() => setModalNuevaAbierto(true)}
          >
            Nueva máquina
          </Button>
        )}
      </Group>

      {/* Barra de filtros */}
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <SimpleGrid
            cols={{
              base: 1,
              sm: 2,
              md: 3,
              xl: mostrarPlanta ? 6 : 5,
            }}
            spacing="sm"
          >
            <TextInput
              aria-label="Buscar"
              placeholder="Buscar por código, nombre o modelo..."
              leftSection={<IconSearch size={16} />}
              value={busquedaLocal}
              onChange={(e) => setBusquedaLocal(e.currentTarget.value)}
            />

            <MultiSelect
              aria-label="Estado"
              placeholder="Estado"
              data={opcionesEstado}
              value={filtros.estados}
              onChange={(estados) => actualizarFiltros({ estados })}
              clearable
              styles={{
                pill: { flexShrink: 0 },
                pillsList: { flexWrap: 'nowrap', overflow: 'hidden' },
              }}
            />

            <MultiSelect
              aria-label="Criticidad"
              placeholder="Criticidad"
              data={opcionesCriticidad}
              value={filtros.criticidades.map(String)}
              onChange={(vals) =>
                actualizarFiltros({ criticidades: vals.map(Number) })
              }
              clearable
              styles={{
                pill: { flexShrink: 0 },
                pillsList: { flexWrap: 'nowrap', overflow: 'hidden' },
              }}
            />

            <Select
              aria-label="Tipo"
              placeholder="Tipo de equipo"
              data={opcionesTipo}
              value={filtros.tipoEquipoId ? String(filtros.tipoEquipoId) : null}
              onChange={(val) =>
                actualizarFiltros({ tipoEquipoId: val ? Number(val) : null })
              }
              clearable
              searchable
            />

            <Select
              aria-label="Sector"
              placeholder="Sector"
              data={opcionesSector}
              value={filtros.sectorId ? String(filtros.sectorId) : null}
              onChange={(val) =>
                actualizarFiltros({ sectorId: val ? Number(val) : null })
              }
              clearable
              searchable
            />

            {mostrarPlanta && (
              <Select
                aria-label="Planta"
                placeholder="Planta"
                data={opcionesPlanta}
                value={filtros.plantaId ? String(filtros.plantaId) : null}
                onChange={handlePlantaChange}
                clearable
              />
            )}
          </SimpleGrid>

          <Group justify="space-between" align="center" wrap="wrap">
            <Group gap="md">
              <Text size="sm" c="dimmed">
                {maquinasQuery.isPending
                  ? 'Cargando...'
                  : `${maquinasFiltradas.length} máquinas`}
              </Text>
              {tieneFiltrosActivos && (
                <Button
                  variant="subtle"
                  size="compact-xs"
                  leftSection={<IconX size={14} />}
                  onClick={limpiarTodosLosFiltros}
                >
                  Limpiar filtros
                </Button>
              )}
            </Group>

            {puedeGestionar && (
              <Switch
                label="Ver desactivadas"
                checked={filtros.inactivas}
                onChange={(e) =>
                  actualizarFiltros({ inactivas: e.currentTarget.checked })
                }
              />
            )}
          </Group>
        </Stack>
      </Paper>

      {maquinasQuery.isError && (
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {mensajeError(maquinasQuery.error)}
        </Alert>
      )}

      {/* Tabla */}
      <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
        {maquinasQuery.isPending ? (
          <Stack p="md" gap="sm">
            {Array.from({ length: 5 }).map((_, idx) => (
              <Skeleton key={idx} height={46} radius="sm" />
            ))}
          </Stack>
        ) : maquinas.length === 0 ? (
          <Stack align="center" p="xl" gap="sm">
            <Text c="dimmed">Todavía no hay máquinas cargadas.</Text>
            {puedeGestionar && (
              <Button
                variant="light"
                leftSection={<IconPlus size={16} />}
                onClick={() => setModalNuevaAbierto(true)}
              >
                Nueva máquina
              </Button>
            )}
          </Stack>
        ) : maquinasFiltradas.length === 0 ? (
          <Stack align="center" p="xl" gap="sm">
            <Text c="dimmed">No hay máquinas con estos filtros.</Text>
            {tieneFiltrosActivos && (
              <Button variant="light" size="sm" onClick={limpiarTodosLosFiltros}>
                Limpiar filtros
              </Button>
            )}
          </Stack>
        ) : (
          <Table.ScrollContainer minWidth={780}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Máquina</Table.Th>
                  <Table.Th>Criticidad</Table.Th>
                  <Table.Th>Tipo</Table.Th>
                  <Table.Th>Sector</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Abiertas</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {maquinasFiltradas.map((m) => (
                  <Table.Tr
                    key={m.id}
                    onClick={() =>
                      navigate(`/maquinas/${m.id}`, { state: { volverA } })
                    }
                    style={{
                      cursor: 'pointer',
                      opacity: m.activo ? 1 : 0.6,
                    }}
                  >
                    <Table.Td>
                      <Group gap="xs" wrap="wrap">
                        <Text
                          size="sm"
                          fw={600}
                          c={m.activo ? undefined : 'dimmed'}
                        >
                          {etiquetaMaquina(m)}
                        </Text>
                        {!m.activo && (
                          <Badge
                            color="gray"
                            variant="light"
                            size="xs"
                            styles={{ root: { textTransform: 'none' } }}
                          >
                            Desactivada
                          </Badge>
                        )}
                      </Group>
                      {m.modelo && (
                        <Text size="xs" c="dimmed">
                          {m.modelo}
                        </Text>
                      )}
                    </Table.Td>

                    <Table.Td>
                      <CriticidadBadge criticidad={m.criticidad} />
                    </Table.Td>

                    <Table.Td>
                      <Text size="sm" c={m.activo ? undefined : 'dimmed'}>
                        {m.tipo_equipo.nombre}
                      </Text>
                    </Table.Td>

                    <Table.Td>
                      <Text size="sm" c={m.activo ? undefined : 'dimmed'}>
                        {m.sector.nombre}
                      </Text>
                      {m.sector.planta && (
                        <Text size="xs" c="dimmed">
                          {m.sector.planta.nombre}
                        </Text>
                      )}
                    </Table.Td>

                    <Table.Td>
                      <Stack gap={2}>
                        <div>
                          <EstadoBadge entidad="maquina" estado={m.estado} />
                        </div>
                        <Text size="xs" c="dimmed">
                          desde {formatHace(m.estado_desde, ahora)}
                        </Text>
                      </Stack>
                    </Table.Td>

                    <Table.Td onClick={(e) => e.stopPropagation()}>
                      {m.intervenciones_abiertas > 0 ? (
                        <Text
                          component={Link}
                          to={`/intervenciones?maquina=${m.id}`}
                          size="sm"
                          fw={600}
                          c="blue"
                          style={{ textDecoration: 'none' }}
                        >
                          {m.intervenciones_abiertas}
                        </Text>
                      ) : (
                        <Text size="sm" c="dimmed">
                          0
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>

      <ModalMaquina
        abierto={modalNuevaAbierto}
        onCerrar={() => setModalNuevaAbierto(false)}
      />
    </Stack>
  );
}
