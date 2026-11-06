import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Stack,
  Group,
  TextInput,
  Select,
  Switch,
  Button,
  Paper,
  Table,
  Badge,
  Text,
  Skeleton,
  Alert,
  UnstyledButton,
} from '@mantine/core';
import { IconSearch, IconPlus, IconAlertCircle, IconPackage } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { RepuestoListaItem, ProveedorOpcion } from '../../api/tipos';
import { formatCantidad, formatMoneda } from '../../lib/formato';
import {
  EstadoStockFiltro,
  FiltrosRepuestos,
  filtrarRepuestos,
  resumenStock,
  infoEstadoStock,
  badgeColorStock,
} from '../../lib/repuestos';
import { ModalRepuesto } from './ModalRepuesto';

export interface TabRepuestosProps {
  filtros: FiltrosRepuestos;
  onCambiarFiltros: (parcial: Partial<FiltrosRepuestos>) => void;
}

export function TabRepuestos({ filtros, onCambiarFiltros }: TabRepuestosProps) {
  const navigate = useNavigate();
  const [modalNuevoAbierto, setModalNuevoAbierto] = useState(false);

  // Lista de repuestos
  const { data: repuestos, isLoading, error } = useQuery<RepuestoListaItem[]>({
    queryKey: ['repuestos', { inactivos: filtros.inactivos }],
    queryFn: () =>
      clienteApi.get<RepuestoListaItem[]>('/api/repuestos', {
        params: filtros.inactivos ? { inactivos: 'true' } : undefined,
      }),
  });

  // Opciones de proveedores para el filtro
  const { data: opcionesProveedores } = useQuery<ProveedorOpcion[]>({
    queryKey: ['proveedores', 'opciones'],
    queryFn: () => clienteApi.get<ProveedorOpcion[]>('/api/proveedores/opciones'),
  });

  const selectProveedores = useMemo(() => {
    const list = (opcionesProveedores || []).map((p) => ({
      value: String(p.id),
      label: p.nombre,
    }));
    return [{ value: 'todos', label: 'Todos los proveedores' }, ...list];
  }, [opcionesProveedores]);

  // Resumen del stock (calculado sobre los activos)
  const resumen = useMemo(() => {
    return resumenStock(repuestos || []);
  }, [repuestos]);

  // Filtrado en memoria
  const repuestosFiltrados = useMemo(() => {
    if (!repuestos) return [];
    return filtrarRepuestos(repuestos, filtros);
  }, [repuestos, filtros]);

  const opcionesEstado: Array<{ value: EstadoStockFiltro; label: string }> = [
    { value: 'todos', label: 'Todos los estados' },
    { value: 'OK', label: 'En stock' },
    { value: 'BAJO', label: 'Bajo mínimo' },
    { value: 'SIN_STOCK', label: 'Sin stock' },
    { value: 'SIN_CONTROL', label: 'Sin control de stock' },
  ];

  return (
    <Stack gap="md">
      {/* Resumen y botón Nuevo repuesto */}
      <Group justify="space-between" align="center" wrap="wrap">
        <Group gap="xs" align="center">
          <Text size="sm" fw={500}>
            {resumen.total} {resumen.total === 1 ? 'repuesto' : 'repuestos'}
          </Text>
          <Text size="sm" c="dimmed">·</Text>
          <UnstyledButton
            onClick={() => onCambiarFiltros({ estado: filtros.estado === 'BAJO' ? 'todos' : 'BAJO' })}
          >
            <Text
              size="sm"
              c={filtros.estado === 'BAJO' ? 'orange' : 'dimmed'}
              fw={filtros.estado === 'BAJO' ? 700 : 400}
              style={{ textDecoration: 'underline' }}
            >
              {resumen.bajo} bajo mínimo
            </Text>
          </UnstyledButton>
          <Text size="sm" c="dimmed">·</Text>
          <UnstyledButton
            onClick={() => onCambiarFiltros({ estado: filtros.estado === 'SIN_STOCK' ? 'todos' : 'SIN_STOCK' })}
          >
            <Text
              size="sm"
              c={filtros.estado === 'SIN_STOCK' ? 'red' : 'dimmed'}
              fw={filtros.estado === 'SIN_STOCK' ? 700 : 400}
              style={{ textDecoration: 'underline' }}
            >
              {resumen.sinStock} sin stock
            </Text>
          </UnstyledButton>
        </Group>

        <Button
          leftSection={<IconPlus size={16} />}
          color="marca"
          onClick={() => setModalNuevoAbierto(true)}
        >
          Nuevo repuesto
        </Button>
      </Group>

      {/* Barra de filtros */}
      <Paper p="md" withBorder>
        <Group gap="md" align="flex-end" wrap="wrap">
          <TextInput
            placeholder="Buscar por código, nombre o ubicación..."
            leftSection={<IconSearch size={16} />}
            value={filtros.q}
            onChange={(e) => onCambiarFiltros({ q: e.currentTarget.value })}
            style={{ flex: 1, minWidth: 220 }}
          />

          <Select<EstadoStockFiltro>
            data={opcionesEstado}
            value={filtros.estado}
            onChange={(val) => onCambiarFiltros({ estado: val || 'todos' })}
            style={{ width: 180 }}
          />

          <Select
            data={selectProveedores}
            value={filtros.proveedor ? String(filtros.proveedor) : 'todos'}
            onChange={(val) =>
              onCambiarFiltros({
                proveedor: val && val !== 'todos' ? Number(val) : null,
              })
            }
            style={{ width: 220 }}
            searchable
          />

          <Switch
            label="Mostrar inactivos"
            checked={filtros.inactivos}
            onChange={(e) => onCambiarFiltros({ inactivos: e.currentTarget.checked })}
            mb={6}
          />
        </Group>
      </Paper>

      {/* Contenido principal / Tabla */}
      {isLoading ? (
        <Stack gap="xs">
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </Stack>
      ) : error ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          Error al cargar los repuestos.
        </Alert>
      ) : (repuestos || []).length === 0 ? (
        <Paper p="xl" withBorder style={{ textAlign: 'center' }}>
          <IconPackage size={48} color="gray" style={{ marginBottom: 12, opacity: 0.5 }} />
          <Text size="md" c="dimmed">
            Todavía no hay repuestos cargados.
          </Text>
        </Paper>
      ) : repuestosFiltrados.length === 0 ? (
        <Paper p="xl" withBorder style={{ textAlign: 'center' }}>
          <Text size="md" c="dimmed">
            Ningún repuesto coincide con los filtros.
          </Text>
        </Paper>
      ) : (
        <Paper withBorder>
          <Table.ScrollContainer minWidth={750}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Código</Table.Th>
                  <Table.Th>Nombre</Table.Th>
                  <Table.Th>Stock</Table.Th>
                  <Table.Th>Mínimo</Table.Th>
                  <Table.Th>Costo unitario</Table.Th>
                  <Table.Th>Proveedor</Table.Th>
                  <Table.Th>Ubicación</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {repuestosFiltrados.map((r) => {
                  const infoStock = infoEstadoStock(r.estado_stock);
                  return (
                    <Table.Tr
                      key={r.id}
                      onClick={() => navigate(`/repuestos/${r.id}`)}
                      style={{
                        cursor: 'pointer',
                        opacity: r.activo ? 1 : 0.6,
                      }}
                    >
                      <Table.Td>
                        <Text size="sm" fw={600}>
                          {r.codigo || '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs" align="center">
                          <Text size="sm" fw={500}>
                            {r.nombre}
                          </Text>
                          {!r.activo && (
                            <Badge color="gray" variant="outline" size="sm">
                              Inactivo
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs" align="center">
                          <Text size="sm">
                            {r.lleva_stock
                              ? `${formatCantidad(r.cantidad_disponible)} ${r.unidad}`
                              : '—'}
                          </Text>
                          <Badge
                            color={badgeColorStock(infoStock.color)}
                            variant="light"
                            size="sm"
                          >
                            {infoStock.etiqueta}
                          </Badge>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {r.lleva_stock && r.stock_minimo !== null && r.stock_minimo !== undefined
                            ? `${formatCantidad(r.stock_minimo)} ${r.unidad}`
                            : '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{formatMoneda(r.costo_unitario)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{r.proveedor?.nombre || '—'}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{r.ubicacion || '—'}</Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}

      {/* Modal nuevo repuesto */}
      <ModalRepuesto
        abierto={modalNuevoAbierto}
        onCerrar={() => setModalNuevoAbierto(false)}
        onExito={(id) => navigate(`/repuestos/${id}`)}
      />
    </Stack>
  );
}
