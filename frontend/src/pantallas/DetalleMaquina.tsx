import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Stack,
  Group,
  Title,
  Text,
  Anchor,
  Button,
  Paper,
  Badge,
  Grid,
  Table,
  Modal,
  Textarea,
  Alert,
  Menu,
  Skeleton,
  Divider,
  SimpleGrid,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconChevronDown,
  IconAlertCircle,
  IconAlertTriangle,
} from '@tabler/icons-react';
import { clienteApi } from '../api/cliente';
import {
  DetencionAbiertaMaquina,
  InactividadMaquina,
  IntervencionLista,
  MaquinaLista,
} from '../api/tipos';
import { useAuth } from '../auth/AuthContext';
import { obtenerInfoEstado } from '../lib/estados';
import {
  etiquetaMaquina,
  accionesMaquina,
  etiquetaAccionMaquina,
  motivoNoDesactivable,
  rangoUltimosDias,
  CodigoAccionMaquina,
} from '../lib/maquinas';
import { rangoDiasAIso } from '../lib/fechas';
import {
  formatDuracion,
  formatFechaHora,
  formatHace,
  parsearId,
} from '../lib/formato';
import { nombreCompleto } from '../lib/personas';
import { ApiError, mensajeError, requiereRecargar } from '../lib/errores';
import { EstadoBadge } from '../componentes/EstadoBadge';
import { CriticidadBadge } from '../componentes/CriticidadBadge';
import { ModalConfirmarRecuperacion } from '../componentes/acciones/ModalConfirmarRecuperacion';
import { ModalMaquina } from '../componentes/ModalMaquina';
import { BloqueMedidoresMaquina } from '../componentes/medidores/BloqueMedidoresMaquina';
import { BloquePlanesMaquina } from '../componentes/preventivos/BloquePlanesMaquina';

function parseYMD(str: string | null): Date | null {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatYMD(val: Date | string | null): string | null {
  if (!val) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) return null;
    val = parsed;
  }
  const y = val.getFullYear();
  const m = String(val.getMonth() + 1).padStart(2, '0');
  const d = String(val.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function DetalleMaquina() {
  const { id: idParam } = useParams<{ id: string }>();
  const maquinaId = parsearId(idParam);
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const esCelular = useMediaQuery('(max-width: 48em)');

  const volverA =
    (location.state as { volverA?: string } | null)?.volverA || '/maquinas';

  const permisos = usuario?.permisos || {};
  const puedeVerIntervenciones = Boolean(permisos['INTERVENCIONES_VER']);
  const puedeConsultarReportes = Boolean(permisos['REPORTES_CONSULTAR']);

  const [rangoInactividad, setRangoInactividad] = useState<{
    desde: string | null;
    hasta: string | null;
  }>(() => rangoUltimosDias(30, new Date()));

  const [accionActiva, setAccionActiva] = useState<CodigoAccionMaquina | null>(
    null
  );

  // Estado para diálogos de cambio de estado / desactivar / reactivar
  const [motivoEstado, setMotivoEstado] = useState('');
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null);
  const [guardandoDialogo, setGuardandoDialogo] = useState(false);

  useEffect(() => {
    if (accionActiva) {
      setMotivoEstado('');
      setErrorDialogo(null);
      setGuardandoDialogo(false);
    }
  }, [accionActiva]);

  const maquinaQuery = useQuery({
    queryKey: ['maquina', maquinaId],
    queryFn: () => clienteApi.get<MaquinaLista>(`/api/maquinas/${maquinaId}`),
    enabled: maquinaId !== null,
    refetchInterval: 60_000,
    retry: false,
  });

  const detencionesQuery = useQuery({
    queryKey: ['maquina', maquinaId, 'detenciones'],
    queryFn: () =>
      clienteApi.get<DetencionAbiertaMaquina[]>(
        `/api/maquinas/${maquinaId}/detenciones-abiertas`
      ),
    enabled:
      maquinaId !== null && puedeVerIntervenciones && Boolean(maquinaQuery.data),
    refetchInterval: 60_000,
  });

  const intervencionesQuery = useQuery({
    queryKey: ['intervenciones', { maquina: maquinaId }],
    queryFn: () =>
      clienteApi.listar<IntervencionLista>('/api/intervenciones', {
        params: {
          maquina_id: maquinaId!,
          limit: 10,
        },
      }),
    enabled:
      maquinaId !== null && puedeVerIntervenciones && Boolean(maquinaQuery.data),
    refetchInterval: 60_000,
  });

  const { desde: isoDesde, hasta: isoHasta } = rangoDiasAIso(
    rangoInactividad.desde,
    rangoInactividad.hasta
  );

  const inactividadQuery = useQuery({
    queryKey: [
      'maquina',
      maquinaId,
      'inactividad',
      rangoInactividad.desde,
      rangoInactividad.hasta,
    ],
    queryFn: () =>
      clienteApi.get<InactividadMaquina>(`/api/maquinas/${maquinaId}/inactividad`, {
        params: {
          desde: isoDesde,
          hasta: isoHasta,
        },
      }),
    enabled:
      maquinaId !== null &&
      puedeConsultarReportes &&
      Boolean(maquinaQuery.data) &&
      Boolean(isoDesde && isoHasta),
    refetchInterval: 60_000,
    retry: false,
  });

  if (
    maquinaId === null ||
    (maquinaQuery.isError &&
      maquinaQuery.error instanceof ApiError &&
      maquinaQuery.error.status === 404)
  ) {
    return (
      <Paper withBorder p="xl" radius="md">
        <Stack align="center" gap="sm">
          <Title order={3}>No encontramos esta máquina.</Title>
          <Button component={Link} to="/maquinas" variant="light">
            Volver a Máquinas
          </Button>
        </Stack>
      </Paper>
    );
  }

  if (maquinaQuery.isPending) {
    return (
      <Stack gap="md">
        <Skeleton height={28} width={160} />
        <Skeleton height={42} width="50%" />
        <Skeleton height={240} radius="md" />
      </Stack>
    );
  }

  if (maquinaQuery.isError || !maquinaQuery.data) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />}>
        {mensajeError(maquinaQuery.error)}
      </Alert>
    );
  }

  const maquina = maquinaQuery.data;
  const detencionesAbiertas = detencionesQuery.data || [];
  const intervencionesLista = intervencionesQuery.data?.items || [];
  const totalIntervenciones = intervencionesQuery.data?.total ?? 0;
  const ahora = new Date();

  const { principal, botones, menu } = accionesMaquina(
    maquina,
    permisos,
    detencionesAbiertas.length
  );

  const invalidarTodoMaquina = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['maquina', maquina.id] }),
      queryClient.invalidateQueries({ queryKey: ['maquinas'] }),
      queryClient.invalidateQueries({ queryKey: ['tablero'] }),
    ]);
  };

  const dispararAccion = (codigo: CodigoAccionMaquina) => {
    if (codigo === 'REPORTAR_FALLA') {
      navigate(`/reportar?maquina=${maquina.id}`);
      return;
    }
    setAccionActiva(codigo);
  };

  const handleConfirmarCambioEstado = async (e: React.FormEvent) => {
    e.preventDefault();
    const motivoTrim = motivoEstado.trim();
    if (motivoTrim.length < 5) {
      setErrorDialogo('Indicá el motivo (al menos 5 caracteres).');
      return;
    }

    const esFuera = accionActiva === 'FUERA_DE_SERVICIO';
    setGuardandoDialogo(true);
    setErrorDialogo(null);

    try {
      const res = await clienteApi.post<{ ok: boolean; estado: string }>(
        `/api/maquinas/${maquina.id}/estado`,
        {
          accion: esFuera ? 'FUERA_DE_SERVICIO' : 'REACTIVAR',
          motivo: motivoTrim,
        }
      );

      const aviso = esFuera
        ? 'La máquina quedó fuera de servicio.'
        : `La máquina volvió a servicio: ${
            obtenerInfoEstado('maquina', res.estado).texto
          }.`;

      notifications.show({
        color: 'green',
        message: aviso,
      });

      setAccionActiva(null);
      await invalidarTodoMaquina();
    } catch (err: unknown) {
      const cod =
        err instanceof ApiError
          ? err.codigo
          : (err as { codigo?: string })?.codigo;
      if (cod === 'SIN_CAMBIOS') {
        setAccionActiva(null);
        notifications.show({
          color: 'red',
          message: 'La máquina ya está en ese estado.',
        });
        await invalidarTodoMaquina();
      } else if (requiereRecargar(err)) {
        setAccionActiva(null);
        notifications.show({
          color: 'red',
          message: mensajeError(err),
        });
        await invalidarTodoMaquina();
      } else {
        setErrorDialogo(mensajeError(err));
      }
    } finally {
      setGuardandoDialogo(false);
    }
  };

  const handleDesactivar = async () => {
    setGuardandoDialogo(true);
    setErrorDialogo(null);
    try {
      await clienteApi.delete(`/api/maquinas/${maquina.id}`);
      notifications.show({
        color: 'green',
        message: 'Máquina desactivada.',
      });
      setAccionActiva(null);
      await invalidarTodoMaquina();
    } catch (err: unknown) {
      if (requiereRecargar(err)) {
        setAccionActiva(null);
        notifications.show({
          color: 'red',
          message: mensajeError(err),
        });
        await invalidarTodoMaquina();
      } else {
        setErrorDialogo(mensajeError(err));
      }
    } finally {
      setGuardandoDialogo(false);
    }
  };

  const handleReactivar = async () => {
    setGuardandoDialogo(true);
    setErrorDialogo(null);
    try {
      await clienteApi.put(`/api/maquinas/${maquina.id}`, { activo: true });
      notifications.show({
        color: 'green',
        message: 'Máquina reactivada.',
      });
      setAccionActiva(null);
      await invalidarTodoMaquina();
    } catch (err: unknown) {
      if (requiereRecargar(err)) {
        setAccionActiva(null);
        notifications.show({
          color: 'red',
          message: mensajeError(err),
        });
        await invalidarTodoMaquina();
      } else {
        setErrorDialogo(mensajeError(err));
      }
    } finally {
      setGuardandoDialogo(false);
    }
  };

  const motivoBloqueoDesactivar = motivoNoDesactivable(
    maquina,
    detencionesAbiertas.length
  );

  const bloqueDatos = (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Datos</Title>
        <Divider />

        <SimpleGrid cols={2} spacing="xs">
          <div>
            <Text size="xs" c="dimmed">
              Código
            </Text>
            <Text size="sm" fw={500}>
              {maquina.codigo || '—'}
            </Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Marca y modelo
            </Text>
            <Text size="sm" fw={500}>
              {maquina.modelo || '—'}
            </Text>
          </div>
        </SimpleGrid>

        <SimpleGrid cols={2} spacing="xs">
          <div>
            <Text size="xs" c="dimmed">
              Tipo de equipo
            </Text>
            <Text size="sm" fw={500}>
              {maquina.tipo_equipo?.nombre || '—'}
            </Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Criticidad
            </Text>
            <div style={{ marginTop: 2 }}>
              <CriticidadBadge criticidad={maquina.criticidad} />
            </div>
          </div>
        </SimpleGrid>

        <SimpleGrid cols={2} spacing="xs">
          <div>
            <Text size="xs" c="dimmed">
              Sector
            </Text>
            <Text size="sm" fw={500}>
              {maquina.sector?.nombre || '—'}
            </Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Planta
            </Text>
            <Text size="sm" fw={500}>
              {maquina.sector?.planta?.nombre || '—'}
            </Text>
          </div>
        </SimpleGrid>

        <div>
          <Text size="xs" c="dimmed">
            Ubicación
          </Text>
          <Text size="sm">{maquina.ubicacion || '—'}</Text>
        </div>

        <div>
          <Text size="xs" c="dimmed">
            Notas de mantenimiento
          </Text>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {maquina.observaciones || '—'}
          </Text>
        </div>

        <div>
          <Text size="xs" c="dimmed">
            Alta
          </Text>
          <Text size="sm">{formatFechaHora(maquina.creado_en)}</Text>
        </div>
      </Stack>
    </Paper>
  );

  const bloqueIzquierda = (
    <Stack gap="md">
      {/* 6.4 Detenciones abiertas */}
      {puedeVerIntervenciones && detencionesAbiertas.length > 0 && (
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={4}>Detenciones abiertas</Title>
            <Divider />
            <Stack gap="sm">
              {detencionesAbiertas.map((d) => (
                <Paper key={d.periodo.id} withBorder p="sm" radius="sm">
                  <Stack gap={4}>
                    <Text size="sm">
                      desde {formatFechaHora(d.periodo.desde)} ·{' '}
                      {formatHace(d.periodo.desde, ahora)} ·{' '}
                      <Text span fw={700} c="red">
                        sigue detenida
                      </Text>
                    </Text>

                    {(d.periodo.observacion || d.periodo.abierto_por_nombre) && (
                      <Text size="sm" c="dimmed">
                        {d.periodo.observacion
                          ? `${d.periodo.observacion}${
                              d.periodo.abierto_por_nombre
                                ? ` (${d.periodo.abierto_por_nombre})`
                                : ''
                            }`
                          : `Abierta por ${d.periodo.abierto_por_nombre}`}
                      </Text>
                    )}

                    <Group gap="xs" wrap="wrap" mt={2}>
                      <Text
                        component={Link}
                        to={`/intervenciones/${d.intervencion.id}`}
                        size="sm"
                        fw={600}
                        c="blue"
                        style={{ textDecoration: 'none' }}
                      >
                        Intervención N.º {d.intervencion.id}
                      </Text>
                      <EstadoBadge
                        entidad="intervencion"
                        estado={d.intervencion.estado}
                      />
                      <Text size="xs" c="dimmed">
                        {d.intervencion.responsable_nombre || 'Sin asignar'}
                      </Text>
                    </Group>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Stack>
        </Paper>
      )}

      {/* 6.9 Intervenciones de esta máquina */}
      {puedeVerIntervenciones && (
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={4}>Intervenciones de esta máquina</Title>
            <Divider />

            {intervencionesQuery.isPending ? (
              <Stack gap="xs">
                <Skeleton height={36} />
                <Skeleton height={36} />
              </Stack>
            ) : intervencionesLista.length === 0 ? (
              <Text size="sm" c="dimmed">
                Esta máquina no tiene intervenciones.
              </Text>
            ) : (
              <>
                <Table.ScrollContainer minWidth={560}>
                  <Table highlightOnHover verticalSpacing="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>N.º</Table.Th>
                        <Table.Th style={{ minWidth: 130 }}>Estado</Table.Th>
                        <Table.Th>Descripción</Table.Th>
                        <Table.Th>Reportada</Table.Th>
                        <Table.Th>Responsable</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {intervencionesLista.map((item) => (
                        <Table.Tr
                          key={item.id}
                          onClick={() => navigate(`/intervenciones/${item.id}`)}
                          style={{ cursor: 'pointer' }}
                        >
                          <Table.Td>
                            <Text size="sm" fw={600}>
                              #{item.id}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <EstadoBadge
                              entidad="intervencion"
                              estado={item.estado}
                            />
                          </Table.Td>
                          <Table.Td>
                            <Group gap={6} wrap="nowrap">
                              {item.tipo === 'PREVENTIVO' && <Badge color="teal" variant="light" size="xs" style={{ flexShrink: 0 }}>Preventivo</Badge>}
                              <Text size="sm" lineClamp={1} maw={260}>
                                {item.descripcion}
                              </Text>
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {formatHace(item.fecha_creacion, ahora)}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text
                              size="sm"
                              c={item.responsable ? undefined : 'dimmed'}
                            >
                              {item.responsable
                                ? nombreCompleto(item.responsable)
                                : 'Sin asignar'}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>

                <Group justify="space-between" align="center" wrap="wrap" pt="xs">
                  <Group gap="md">
                    <Text
                      component={Link}
                      to={`/intervenciones?maquina=${maquina.id}`}
                      size="sm"
                      fw={500}
                      c="blue"
                      style={{ textDecoration: 'none' }}
                    >
                      Ver abiertas
                    </Text>
                    <Text
                      component={Link}
                      to={`/intervenciones?vista=cerradas&maquina=${maquina.id}`}
                      size="sm"
                      fw={500}
                      c="blue"
                      style={{ textDecoration: 'none' }}
                    >
                      Ver cerradas
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    Total: {totalIntervenciones}
                  </Text>
                </Group>
              </>
            )}
          </Stack>
        </Paper>
      )}

      {/* PV4: Medidores, con PLANES_GESTIONAR o MAQUINAS_REGISTRAR_LECTURAS */}
      <BloqueMedidoresMaquina maquinaId={maquina.id} maquinaActiva={maquina.activo} />

      {/* PV2: Planes preventivos, solo con PLANES_GESTIONAR */}
      <BloquePlanesMaquina maquinaId={maquina.id} />

      {/* 6.10 Inactividad */}
      {puedeConsultarReportes && (
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Title order={4}>Inactividad</Title>
              <DatePickerInput
                type="range"
                aria-label="Período de inactividad"
                placeholder="Desde — Hasta"
                valueFormat="DD/MM/YYYY"
                allowSingleDateInRange
                value={[
                  parseYMD(rangoInactividad.desde),
                  parseYMD(rangoInactividad.hasta),
                ]}
                onChange={([d, h]) => {
                  const desdeFmt = formatYMD(d);
                  const hastaFmt = formatYMD(h);
                  if (desdeFmt && hastaFmt) {
                    setRangoInactividad({ desde: desdeFmt, hasta: hastaFmt });
                  } else if (desdeFmt && !hastaFmt) {
                    setRangoInactividad({ desde: desdeFmt, hasta: null });
                  }
                }}
                error={
                  inactividadQuery.isError
                    ? mensajeError(inactividadQuery.error)
                    : undefined
                }
                w={{ base: '100%', sm: 260 }}
              />
            </Group>
            <Divider />

            {inactividadQuery.isPending ? (
              <Skeleton height={80} />
            ) : inactividadQuery.data ? (
              <Stack gap="md">
                <div>
                  <Text size="xs" c="dimmed">
                    Detenida
                  </Text>
                  <Text
                    fw={700}
                    style={{ fontSize: '1.6rem', lineHeight: 1.2 }}
                  >
                    {formatDuracion(inactividadQuery.data.inactividad_minutos)}
                  </Text>
                  <Group gap="lg" mt={6}>
                    <Text size="sm" c="dimmed">
                      Correctiva:{' '}
                      <Text span fw={600} c="dark">
                        {formatDuracion(
                          inactividadQuery.data.por_tipo.CORRECTIVO
                        )}
                      </Text>
                    </Text>
                    <Text size="sm" c="dimmed">
                      Preventiva:{' '}
                      <Text span fw={600} c="dark">
                        {formatDuracion(
                          inactividadQuery.data.por_tipo.PREVENTIVO
                        )}
                      </Text>
                    </Text>
                  </Group>
                  {inactividadQuery.data.fuera_de_servicio_descontado_minutos >
                    0 && (
                    <Text size="xs" c="dimmed" mt={4}>
                      Fuera de servicio (no cuenta):{' '}
                      {formatDuracion(
                        inactividadQuery.data
                          .fuera_de_servicio_descontado_minutos
                      )}
                    </Text>
                  )}
                </div>

                {inactividadQuery.data.periodos.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    Sin detenciones en este período.
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {inactividadQuery.data.periodos.map((p) => (
                      <Paper key={p.id} withBorder p="xs" radius="sm">
                        <Group justify="space-between" wrap="wrap" gap="xs">
                          <Text size="sm">
                            {formatFechaHora(p.desde)} →{' '}
                            {p.abierto || !p.hasta ? (
                              <Text span fw={600} c="red">
                                sigue detenida
                              </Text>
                            ) : (
                              formatFechaHora(p.hasta)
                            )}
                          </Text>
                          <Group gap="xs">
                            <Badge
                              size="xs"
                              variant="light"
                              color="gray"
                              styles={{ root: { textTransform: 'none' } }}
                            >
                              {p.tipo === 'PREVENTIVO'
                                ? 'Preventiva'
                                : 'Correctiva'}
                            </Badge>
                            <Text
                              component={Link}
                              to={`/intervenciones/${p.intervencion_id}`}
                              size="sm"
                              fw={500}
                              c="blue"
                              style={{ textDecoration: 'none' }}
                            >
                              Intervención N.º {p.intervencion_id}
                            </Text>
                          </Group>
                        </Group>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </Stack>
            ) : null}
          </Stack>
        </Paper>
      )}
    </Stack>
  );

  const tieneAcciones =
    principal !== null || botones.length > 0 || menu.length > 0;

  return (
    <Stack gap="md">
      {/* Cabecera (6.2) */}
      <Stack gap="xs">
        <Anchor
          component={Link}
          to={volverA}
          size="sm"
          c="dimmed"
          style={{ textDecoration: 'none' }}
        >
          ← Máquinas
        </Anchor>

        <Group gap="sm" align="center" wrap="wrap">
          <Title order={2}>{etiquetaMaquina(maquina)}</Title>
          <CriticidadBadge criticidad={maquina.criticidad} size="md" />
          <EstadoBadge entidad="maquina" estado={maquina.estado} size="md" />
          <Text size="sm" c="dimmed">
            desde {formatFechaHora(maquina.estado_desde)} ·{' '}
            {formatHace(maquina.estado_desde, ahora)}
          </Text>
          {!maquina.activo && (
            <Badge
              color="gray"
              variant="light"
              size="md"
              styles={{ root: { textTransform: 'none' } }}
            >
              Desactivada
            </Badge>
          )}
        </Group>

        {/* Barra de acciones siempre debajo del título */}
        {tieneAcciones && (
          <Group gap="xs" wrap="wrap" mt={4}>
            {principal && (
              <Button
                color={
                  principal === 'CONFIRMAR_RECUPERACION' ? 'green' : 'marca'
                }
                onClick={() => dispararAccion(principal)}
              >
                {etiquetaAccionMaquina(principal)}
              </Button>
            )}

            {botones.map((cod) => (
              <Button
                key={cod}
                variant="default"
                onClick={() => dispararAccion(cod)}
              >
                {etiquetaAccionMaquina(cod)}
              </Button>
            ))}

            {menu.length > 0 && (
              <Menu position="bottom-start" withinPortal>
                <Menu.Target>
                  <Button
                    variant="default"
                    rightSection={<IconChevronDown size={16} />}
                  >
                    Más acciones
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  {menu.map((cod) => (
                    <Menu.Item
                      key={cod}
                      color={cod === 'DESACTIVAR' ? 'red' : undefined}
                      onClick={() => dispararAccion(cod)}
                    >
                      {etiquetaAccionMaquina(cod)}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        )}
      </Stack>

      {/* Distribución (6.3): en celular una sola columna con Datos primero */}
      {esCelular ? (
        <Stack gap="md">
          {bloqueDatos}
          {bloqueIzquierda}
        </Stack>
      ) : (
        <Grid gap="md">
          <Grid.Col span={8}>{bloqueIzquierda}</Grid.Col>
          <Grid.Col span={4}>{bloqueDatos}</Grid.Col>
        </Grid>
      )}

      {/* 6.5 Confirmar que volvió a funcionar */}
      <ModalConfirmarRecuperacion
        abierto={accionActiva === 'CONFIRMAR_RECUPERACION'}
        onCerrar={() => setAccionActiva(null)}
        maquinaId={maquina.id}
        periodos={detencionesAbiertas.map((d) => ({
          id: d.periodo.id,
          desde: d.periodo.desde,
        }))}
      />

      {/* 6.6 Fuera de servicio y vuelta a servicio */}
      <Modal
        opened={
          accionActiva === 'FUERA_DE_SERVICIO' ||
          accionActiva === 'VOLVER_A_SERVICIO'
        }
        onClose={() => !guardandoDialogo && setAccionActiva(null)}
        title={
          accionActiva === 'FUERA_DE_SERVICIO'
            ? 'Dejar fuera de servicio'
            : 'Volver a servicio'
        }
        size="md"
        centered
        fullScreen={Boolean(esCelular)}
      >
        <form onSubmit={handleConfirmarCambioEstado} noValidate>
          <Stack gap="md">
            {errorDialogo && (
              <Alert
                color="red"
                variant="light"
                icon={<IconAlertCircle size={18} />}
              >
                {errorDialogo}
              </Alert>
            )}

            {accionActiva === 'FUERA_DE_SERVICIO' && (
              <Text size="sm" c="dimmed">
                Mientras esté fuera de servicio, su tiempo no cuenta como
                inactividad.
              </Text>
            )}

            <Textarea
              label="Motivo"
              maxLength={500}
              placeholder="Indicá el motivo (al menos 5 caracteres)"
              required
              minRows={3}
              value={motivoEstado}
              onChange={(e) => {
                setMotivoEstado(e.currentTarget.value);
                if (errorDialogo) setErrorDialogo(null);
              }}
              disabled={guardandoDialogo}
            />

            <Group justify="flex-end" gap="sm">
              <Button
                variant="default"
                onClick={() => setAccionActiva(null)}
                disabled={guardandoDialogo}
              >
                Volver
              </Button>
              <Button type="submit" loading={guardandoDialogo}>
                {accionActiva === 'FUERA_DE_SERVICIO'
                  ? 'Dejar fuera de servicio'
                  : 'Volver a servicio'}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* 6.7 Desactivar */}
      <Modal
        opened={accionActiva === 'DESACTIVAR'}
        onClose={() => !guardandoDialogo && setAccionActiva(null)}
        title="Desactivar máquina"
        size="md"
        centered
        fullScreen={Boolean(esCelular)}
      >
        <Stack gap="md">
          {errorDialogo && (
            <Alert
              color="red"
              variant="light"
              icon={<IconAlertCircle size={18} />}
            >
              {errorDialogo}
            </Alert>
          )}

          {motivoBloqueoDesactivar ? (
            <>
              <Alert
                color="orange"
                variant="light"
                icon={<IconAlertTriangle size={18} />}
              >
                {motivoBloqueoDesactivar}
              </Alert>
              <Group justify="flex-end">
                <Button
                  variant="default"
                  onClick={() => setAccionActiva(null)}
                >
                  Volver
                </Button>
              </Group>
            </>
          ) : (
            <>
              <Text size="sm">
                La máquina deja de aparecer en las listas y en Reportar falla.
                Su historial se conserva.
              </Text>
              <Group justify="flex-end" gap="sm">
                <Button
                  variant="default"
                  onClick={() => setAccionActiva(null)}
                  disabled={guardandoDialogo}
                >
                  Volver
                </Button>
                <Button
                  color="red"
                  loading={guardandoDialogo}
                  onClick={handleDesactivar}
                >
                  Desactivar
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>

      {/* 6.7 Reactivar */}
      <Modal
        opened={accionActiva === 'REACTIVAR'}
        onClose={() => !guardandoDialogo && setAccionActiva(null)}
        title="Reactivar máquina"
        size="md"
        centered
        fullScreen={Boolean(esCelular)}
      >
        <Stack gap="md">
          {errorDialogo && (
            <Alert
              color="red"
              variant="light"
              icon={<IconAlertCircle size={18} />}
            >
              {errorDialogo}
            </Alert>
          )}

          <Text size="sm">
            La máquina volverá a aparecer en las listas y en Reportar falla.
          </Text>

          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              onClick={() => setAccionActiva(null)}
              disabled={guardandoDialogo}
            >
              Volver
            </Button>
            <Button loading={guardandoDialogo} onClick={handleReactivar}>
              Reactivar
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* 6.8 Edición */}
      <ModalMaquina
        abierto={accionActiva === 'EDITAR'}
        onCerrar={() => setAccionActiva(null)}
        maquina={maquina}
      />
    </Stack>
  );
}
