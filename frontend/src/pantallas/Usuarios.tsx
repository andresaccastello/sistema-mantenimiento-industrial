import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Stack,
  Group,
  Title,
  Text,
  Button,
  TextInput,
  Select,
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
  IconShield,
} from '@tabler/icons-react';
import { clienteApi } from '../api/cliente';
import {
  PerfilDetalle,
  SectorLista,
  UsuarioListaItem,
} from '../api/tipos';
import { nombreCompleto } from '../lib/personas';
import { nombrePerfil } from '../lib/perfiles';
import { formatHace } from '../lib/formato';
import {
  FiltrosUsuarios,
  FILTROS_USUARIOS_POR_DEFECTO,
  leerFiltrosUsuarios,
  escribirFiltrosUsuarios,
  filtrarUsuarios,
  hayFiltrosUsuarios,
} from '../lib/usuarios';
import { mensajeError } from '../lib/errores';
import { ModalUsuario } from '../componentes/admin/ModalUsuario';

export function Usuarios() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const filtros = leerFiltrosUsuarios(searchParams);

  const [busquedaLocal, setBusquedaLocal] = useState(filtros.texto);
  const [busquedaDebounced] = useDebouncedValue(busquedaLocal, 300);
  const [modalNuevoAbierto, setModalNuevoAbierto] = useState(false);

  // Sincronizar texto local cuando cambia desde la URL
  useEffect(() => {
    if (filtros.texto !== busquedaLocal.trim()) {
      setBusquedaLocal(filtros.texto);
    }
  }, [filtros.texto]);

  const actualizarFiltros = (parcial: Partial<FiltrosUsuarios>) => {
    const nuevos: FiltrosUsuarios = {
      ...filtros,
      ...parcial,
    };
    setSearchParams(escribirFiltrosUsuarios(nuevos));
  };

  useEffect(() => {
    const debTrim = busquedaDebounced.trim();
    if (debTrim !== filtros.texto) {
      actualizarFiltros({ texto: debTrim });
    }
  }, [busquedaDebounced]);

  // Consultas
  const usuariosQuery = useQuery({
    queryKey: ['usuarios'],
    queryFn: () => clienteApi.get<UsuarioListaItem[]>('/api/usuarios'),
  });

  const perfilesQuery = useQuery({
    queryKey: ['perfiles'],
    queryFn: () => clienteApi.get<PerfilDetalle[]>('/api/perfiles'),
  });

  const sectoresQuery = useQuery({
    queryKey: ['sectores'],
    queryFn: () => clienteApi.get<SectorLista[]>('/api/sectores'),
  });

  const listaFiltrada = filtrarUsuarios(usuariosQuery.data || [], filtros);
  const tieneFiltros = hayFiltrosUsuarios(filtros);

  const opcionesPerfil = (perfilesQuery.data || []).map((p) => ({
    value: String(p.id),
    label: nombrePerfil(p.nombre),
  }));

  const opcionesSector = (sectoresQuery.data || []).map((s) => ({
    value: String(s.id),
    label: s.nombre,
  }));

  const cantidadUsuarios = listaFiltrada.length;
  const textoConteo = `${cantidadUsuarios} ${cantidadUsuarios === 1 ? 'usuario' : 'usuarios'}`;

  return (
    <Stack gap="lg">
      {/* Encabezado */}
      <Group justify="space-between" align="center">
        <Title order={2}>Usuarios</Title>
        <Group>
          <Button
            variant="default"
            leftSection={<IconShield size={16} />}
            onClick={() => navigate('/perfiles')}
          >
            Ver perfiles
          </Button>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => setModalNuevoAbierto(true)}
          >
            Nuevo usuario
          </Button>
        </Group>
      </Group>

      {/* Filtros */}
      <Paper withBorder p="md" radius="sm">
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
            <TextInput
              aria-label="Buscar"
              placeholder="Buscar por legajo, nombre o apellido..."
              leftSection={<IconSearch size={16} />}
              value={busquedaLocal}
              onChange={(e) => setBusquedaLocal(e.currentTarget.value)}
            />

            <Select
              aria-label="Estado"
              data={[
                { value: 'activos', label: 'Activos' },
                { value: 'inactivos', label: 'Inactivos' },
                { value: 'todos', label: 'Todos' },
              ]}
              value={filtros.estado}
              onChange={(val) =>
                actualizarFiltros({ estado: (val as 'activos' | 'inactivos' | 'todos') || 'activos' })
              }
            />

            <Select
              aria-label="Perfil"
              placeholder="Todos los perfiles"
              data={opcionesPerfil}
              value={filtros.perfilId ? String(filtros.perfilId) : null}
              onChange={(val) => actualizarFiltros({ perfilId: val ? Number(val) : null })}
              clearable
            />

            <Select
              aria-label="Sector"
              placeholder="Todos los sectores"
              data={opcionesSector}
              value={filtros.sectorId ? String(filtros.sectorId) : null}
              onChange={(val) => actualizarFiltros({ sectorId: val ? Number(val) : null })}
              clearable
            />
          </SimpleGrid>

          {/* Línea del conteo y limpiar filtros */}
          <Group justify="space-between" align="center">
            <Text size="sm" c="dimmed">
              {textoConteo}
            </Text>
            {tieneFiltros && (
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                leftSection={<IconX size={14} />}
                onClick={() => {
                  setBusquedaLocal('');
                  setSearchParams(escribirFiltrosUsuarios(FILTROS_USUARIOS_POR_DEFECTO));
                }}
              >
                Limpiar filtros
              </Button>
            )}
          </Group>
        </Stack>
      </Paper>

      {/* Tabla de usuarios */}
      {usuariosQuery.isLoading ? (
        <Stack gap="xs">
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </Stack>
      ) : usuariosQuery.isError ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {mensajeError(usuariosQuery.error)}
        </Alert>
      ) : listaFiltrada.length === 0 ? (
        <Paper withBorder p="xl" ta="center">
          <Text c="dimmed" mb="sm">
            {tieneFiltros
              ? 'No hay usuarios con estos filtros.'
              : 'No hay usuarios registrados.'}
          </Text>
          {tieneFiltros && (
            <Button
              variant="default"
              size="xs"
              onClick={() => {
                setBusquedaLocal('');
                setSearchParams(escribirFiltrosUsuarios(FILTROS_USUARIOS_POR_DEFECTO));
              }}
            >
              Limpiar filtros
            </Button>
          )}
        </Paper>
      ) : (
        <Paper withBorder radius="sm">
          <Table.ScrollContainer minWidth={600}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Usuario</Table.Th>
                  <Table.Th>Perfil</Table.Th>
                  <Table.Th>Sectores</Table.Th>
                  <Table.Th>Último acceso</Table.Th>
                  <Table.Th>Contraseña</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {listaFiltrada.map((u) => {
                  const sectoresTexto =
                    Array.isArray(u.sectores) && u.sectores.length > 0
                      ? u.sectores.map((s) => s.nombre).join(', ')
                      : '—';

                  return (
                    <Table.Tr
                      key={u.id}
                      style={{
                        cursor: 'pointer',
                        opacity: u.activo ? 1 : 0.6,
                      }}
                      onClick={() =>
                        navigate(`/usuarios/${u.id}`, {
                          state: { volverA: `${location.pathname}${location.search}` },
                        })
                      }
                    >
                      <Table.Td>
                        <Group gap="xs" wrap="nowrap">
                          <div>
                            <Text size="sm" fw={500}>
                              {nombreCompleto(u)}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {u.legajo}
                            </Text>
                          </div>
                          {!u.activo && (
                            <Badge color="gray" size="sm" variant="outline">
                              Inactivo
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{nombrePerfil(u.perfil.nombre)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{sectoresTexto}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {u.ultimo_acceso_en ? formatHace(u.ultimo_acceso_en) : 'Nunca'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {u.debe_cambiar_password && (
                          <Badge color="yellow" variant="light" size="sm">
                            Debe cambiarla
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}

      {/* Modal nuevo usuario */}
      <ModalUsuario
        abierto={modalNuevoAbierto}
        onCerrar={() => setModalNuevoAbierto(false)}
      />
    </Stack>
  );
}
