import React from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Stack,
  Group,
  Title,
  Text,
  Select,
  SimpleGrid,
  Card,
  Table,
  Badge,
  Paper,
  Skeleton,
  Alert,
  ThemeIcon,
} from '@mantine/core';
import {
  IconClock,
  IconTool,
  IconPackage,
  IconCircleCheck,
  IconCircleX,
  IconAlertTriangle,
  IconBan,
  IconUserCheck,
  IconAlertCircle,
} from '@tabler/icons-react';
import { clienteApi } from '../api/cliente';
import { Criticidad, Planta, TableroResumen } from '../api/tipos';
import { useAuth } from '../auth/AuthContext';
import { obtenerInfoEstado } from '../lib/estados';
import { etiquetaMaquina } from '../lib/maquinas';
import { formatDuracion, formatFechaHora, formatHace, parsearId } from '../lib/formato';
import { mensajeError } from '../lib/errores';
import {
  enlacesTablero,
  contadoresIntervencion,
  ClaveContadorIntervencion,
} from '../lib/tablero';
import { CriticidadBadge } from '../componentes/CriticidadBadge';
import { EstadoBadge } from '../componentes/EstadoBadge';

const ICONOS_ESTADO: Record<
  string,
  React.ComponentType<{ size?: number; style?: React.CSSProperties }>
> = {
  IconClock,
  IconTool,
  IconPackage,
  IconCircleCheck,
  IconCircleX,
  IconAlertTriangle,
  IconBan,
};

const TARJETAS_MAQUINAS: {
  estado: 'OPERATIVA' | 'DETENIDA' | 'EN_MANTENIMIENTO' | 'FUERA_DE_SERVICIO';
  etiqueta: string;
}[] = [
  { estado: 'OPERATIVA', etiqueta: 'Operativas' },
  { estado: 'DETENIDA', etiqueta: 'Detenidas' },
  { estado: 'EN_MANTENIMIENTO', etiqueta: 'En mantenimiento' },
  { estado: 'FUERA_DE_SERVICIO', etiqueta: 'Fuera de servicio' },
];

const INFO_CONTADORES_INTERVENCION: Record<
  ClaveContadorIntervencion,
  {
    etiqueta: string;
    color: string;
    Icono: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  }
> = {
  sin_asignar: {
    etiqueta: 'Sin asignar',
    color: obtenerInfoEstado('intervencion', 'PENDIENTE').color,
    Icono: IconClock,
  },
  en_proceso: {
    etiqueta: 'En proceso',
    color: obtenerInfoEstado('intervencion', 'EN_PROCESO').color,
    Icono: IconTool,
  },
  en_espera_repuestos: {
    etiqueta: 'Esperando repuestos',
    color: obtenerInfoEstado('intervencion', 'EN_ESPERA_REPUESTOS').color,
    Icono: IconPackage,
  },
  mias_abiertas: {
    etiqueta: 'Asignadas a mí',
    color: 'blue',
    Icono: IconUserCheck,
  },
};

export function Tablero() {
  const { usuario } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const plantaId = parsearId(searchParams.get('planta'));

  const plantasQuery = useQuery({
    queryKey: ['plantas'],
    queryFn: () => clienteApi.get<Planta[]>('/api/plantas'),
  });

  const criticidadesQuery = useQuery({
    queryKey: ['criticidades'],
    queryFn: () => clienteApi.get<Criticidad[]>('/api/criticidades'),
  });

  const tableroQuery = useQuery({
    queryKey: ['tablero', { plantaId }],
    queryFn: () =>
      clienteApi.get<TableroResumen>(
        '/api/tablero',
        plantaId !== null ? { params: { planta_id: plantaId } } : undefined
      ),
    refetchInterval: 60_000,
  });

  const plantas = plantasQuery.data || [];
  const mostrarSelectorPlanta = plantas.length >= 2;
  const opcionesPlanta = [
    { value: '', label: 'Todas las plantas' },
    ...plantas.map((p) => ({ value: String(p.id), label: p.nombre })),
  ];

  const criticidadesMap = new Map<number, Criticidad>(
    (criticidadesQuery.data || []).map((c) => [c.id, c])
  );

  const handlePlantaChange = (val: string | null) => {
    const id = parsearId(val);
    const next = new URLSearchParams(searchParams);
    if (id !== null) {
      next.set('planta', String(id));
    } else {
      next.delete('planta');
    }
    setSearchParams(next);
  };

  const enlaces = enlacesTablero(plantaId);
  const clavesInt = contadoresIntervencion(usuario?.permisos || {});
  const resumen = tableroQuery.data;
  const ahora = new Date();

  const valorContadorIntervencion = (clave: ClaveContadorIntervencion): number => {
    if (!resumen) return 0;
    switch (clave) {
      case 'sin_asignar':
        return resumen.intervenciones.sin_asignar;
      case 'en_proceso':
        return resumen.intervenciones.EN_PROCESO;
      case 'en_espera_repuestos':
        return resumen.intervenciones.EN_ESPERA_REPUESTOS;
      case 'mias_abiertas':
        return resumen.intervenciones.mias_abiertas;
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={2}>Tablero</Title>
        {mostrarSelectorPlanta && (
          <Select
            aria-label="Planta"
            placeholder="Todas las plantas"
            data={opcionesPlanta}
            value={plantaId !== null ? String(plantaId) : ''}
            onChange={handlePlantaChange}
            w={{ base: '100%', xs: 240 }}
          />
        )}
      </Group>

      {tableroQuery.isError && (
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {mensajeError(tableroQuery.error)}
        </Alert>
      )}

      {/* Fila 1: Contadores de Máquinas */}
      <Stack gap="xs">
        <Text size="sm" fw={600} c="dimmed">
          Máquinas
        </Text>
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
          {TARJETAS_MAQUINAS.map(({ estado, etiqueta }) => {
            const info = obtenerInfoEstado('maquina', estado);
            const Icono = ICONOS_ESTADO[info.icono] || IconCircleCheck;
            const cantidad = resumen ? (resumen.maquinas[estado] ?? 0) : 0;
            const colorActivo = cantidad > 0 ? info.color : 'gray';

            return (
              <Card
                key={estado}
                component={Link}
                to={enlaces[estado]}
                withBorder
                radius="md"
                p="md"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                {tableroQuery.isPending ? (
                  <Stack gap="xs">
                    <Skeleton height={28} width={60} />
                    <Skeleton height={16} width="70%" />
                  </Stack>
                ) : (
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <div>
                      <Text
                        size="xl"
                        fw={700}
                         c={cantidad === 0 ? 'dimmed' : undefined}
                        style={{ fontSize: '1.75rem', lineHeight: 1.2 }}
                      >
                        {cantidad}
                      </Text>
                      <Text size="sm" c="dimmed" mt={4}>
                        {etiqueta}
                      </Text>
                    </div>
                    <ThemeIcon color={colorActivo} variant="light" size="lg" radius="md">
                      <Icono size={20} />
                    </ThemeIcon>
                  </Group>
                )}
              </Card>
            );
          })}
        </SimpleGrid>
      </Stack>

      {/* Fila 2: Contadores de Intervenciones */}
      <Stack gap="xs">
        <Text size="sm" fw={600} c="dimmed">
          Intervenciones
        </Text>
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
          {clavesInt.map((clave) => {
            const info = INFO_CONTADORES_INTERVENCION[clave];
            const Icono = info.Icono;
            const cantidad = valorContadorIntervencion(clave);
            const colorActivo = cantidad > 0 ? info.color : 'gray';

            return (
              <Card
                key={clave}
                component={Link}
                to={enlaces[clave]}
                withBorder
                radius="md"
                p="md"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                {tableroQuery.isPending ? (
                  <Stack gap="xs">
                    <Skeleton height={28} width={60} />
                    <Skeleton height={16} width="70%" />
                  </Stack>
                ) : (
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <div>
                      <Text
                        size="xl"
                        fw={700}
                        c={cantidad === 0 ? 'dimmed' : undefined}
                        style={{ fontSize: '1.75rem', lineHeight: 1.2 }}
                      >
                        {cantidad}
                      </Text>
                      <Text size="sm" c="dimmed" mt={4}>
                        {info.etiqueta}
                      </Text>
                    </div>
                    <ThemeIcon color={colorActivo} variant="light" size="lg" radius="md">
                      <Icono size={20} />
                    </ThemeIcon>
                  </Group>
                )}
              </Card>
            );
          })}
        </SimpleGrid>
      </Stack>

      {/* Bloque: Detenidas ahora */}
      <Stack gap="xs">
        <div>
          <Title order={4}>Detenidas ahora</Title>
          <Text size="sm" c="dimmed">
            Máquinas paradas ahora, estén detenidas o en mantenimiento.
          </Text>
        </div>
        <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
          {tableroQuery.isPending ? (
            <Stack p="md" gap="sm">
              {Array.from({ length: 3 }).map((_, idx) => (
                <Skeleton key={idx} height={42} radius="sm" />
              ))}
            </Stack>
          ) : !resumen || resumen.detenidas_ahora.length === 0 ? (
            <Group justify="center" p="xl" gap="xs">
              <ThemeIcon color="green" variant="light" radius="xl" size="md">
                <IconCircleCheck size={18} />
              </ThemeIcon>
              <Text c="dimmed">No hay máquinas detenidas.</Text>
            </Group>
          ) : (
            <Table.ScrollContainer minWidth={720}>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Máquina</Table.Th>
                    <Table.Th>Criticidad</Table.Th>
                    <Table.Th>Sector</Table.Th>
                    <Table.Th>Detenida desde</Table.Th>
                    <Table.Th>Inactividad</Table.Th>
                    <Table.Th>Abiertas</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {resumen.detenidas_ahora.map((item) => {
                    const critCatalogo = criticidadesMap.get(item.maquina.criticidad.id);
                    const prioridadAlta =
                      critCatalogo?.prioridad_alta ??
                      item.maquina.criticidad.prioridad_alta ??
                      false;

                    return (
                      <Table.Tr key={item.maquina.id}>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text
                              component={Link}
                              to={`/maquinas/${item.maquina.id}`}
                              size="sm"
                              fw={600}
                              c="blue"
                              style={{ textDecoration: 'none' }}
                            >
                              {etiquetaMaquina(item.maquina)}
                            </Text>
                            <div>
                              <EstadoBadge entidad="maquina" estado={item.estado} />
                            </div>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <CriticidadBadge
                            criticidad={{
                              nombre: item.maquina.criticidad.nombre,
                              prioridad_alta: prioridadAlta,
                            }}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{item.maquina.sector.nombre}</Text>
                          {item.maquina.sector.planta && (
                            <Text size="xs" c="dimmed">
                              {item.maquina.sector.planta.nombre}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{formatFechaHora(item.detenida_desde)}</Text>
                          <Text size="xs" c="dimmed">
                            {formatHace(item.detenida_desde, ahora)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text size="sm" fw={500}>
                              {formatDuracion(item.inactividad_en_curso_minutos)}
                            </Text>
                            <div>
                              <Badge
                                size="xs"
                                variant="light"
                                color="blue"
                                styles={{ root: { textTransform: 'none' } }}
                              >
                                en curso
                              </Badge>
                            </div>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" fw={500}>
                            {item.intervenciones_abiertas}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Paper>
      </Stack>
    </Stack>
  );
}
