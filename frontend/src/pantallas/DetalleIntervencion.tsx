import { useState, useMemo } from 'react';
import {
  Stack, Group, Card, Text, Badge, Button, Box,
  Title, Timeline, Loader, Center, Anchor, Menu, Grid,
} from '@mantine/core';
import { IconDotsVertical, IconCheck } from '@tabler/icons-react';
import { useParams, useNavigate, useLocation, Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';

import { clienteApi } from '../api/cliente';
import { EstadoBadge } from '../componentes/EstadoBadge';
import { PantallaVacia } from '../componentes/PantallaVacia';
import { ModalEditarReporte } from '../componentes/ModalEditarReporte';
import {
  ModalAsignar,
  ModalDesasignar,
  ModalIniciar,
  ModalEsperaRepuestos,
  ModalReanudar,
  ModalFinalizar,
  ModalResolverAhora,
  ModalCancelar,
  ModalReabrir,
  ModalRegistrarDetencion,
  ModalEliminar,
  ModalConfirmarRecuperacion,
} from '../componentes/acciones';

import { useAuth } from '../auth/AuthContext';
import { etiquetaMaquina } from '../lib/maquinas';
import { formatFechaHora, formatDuracion, parsearId } from '../lib/formato';
import { nombreCompleto } from '../lib/personas';
import { eventosHistorial } from '../lib/intervenciones';
import { ordenarAcciones, etiquetaAccion, CodigoAccion } from '../lib/acciones';
import { minutosEntre } from '../lib/fechas';
import { obtenerInfoEstado } from '../lib/estados';
import { mensajeError, requiereRecargar, ApiError } from '../lib/errores';
import type { IntervencionDetalle, PeriodoDetencion } from '../api/tipos';

export function DetalleIntervencion() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { usuario } = useAuth();

  const idValido = parsearId(id);

  // Destino del botón "Volver"
  const volverA = (location.state as any)?.volverA;
  const destinoVolver =
    volverA && typeof volverA === 'string' && volverA.startsWith('/intervenciones')
      ? volverA
      : '/intervenciones';

  // Consulta de la intervención
  const {
    data: reporte,
    isLoading,
    isError,
  } = useQuery<IntervencionDetalle, ApiError>({
    queryKey: ['intervencion', idValido],
    queryFn: () => clienteApi.get<IntervencionDetalle>(`/api/intervenciones/${idValido}`),
    enabled: idValido !== null,
    refetchInterval: 60000,
    retry: false,
  });

  // Estado del modal activo
  const [modalActivo, setModalActivo] = useState<CodigoAccion | 'CONFIRMAR_RECUPERACION' | null>(null);
  const [estadoAlAbrir, setEstadoAlAbrir] = useState<string>('');
  const [tomandoDirecto, setTomandoDirecto] = useState(false);

  // Período para confirmar recuperación individual (Sección 7.4)
  const [periodoParaRecuperar, setPeriodoParaRecuperar] = useState<PeriodoDetencion | null>(null);

  // Período de detención abierto
  const periodoAbierto = useMemo(() => {
    return reporte?.periodos_detencion?.find((p) => p.esta_abierto || p.hasta === null) || null;
  }, [reporte?.periodos_detencion]);

  const puedeConfirmarRecuperacion = Boolean(usuario?.permisos?.['INTERVENCIONES_CONFIRMAR_RECUPERACION']);

  // Reset y apertura de modal
  const abrirModal = (accion: CodigoAccion) => {
    if (!reporte) return;
    setEstadoAlAbrir(reporte.estado);
    setModalActivo(accion);
  };

  const cerrarModal = () => {
    setModalActivo(null);
    setPeriodoParaRecuperar(null);
  };

  // Invalidar caché tras éxito de acciones directas
  const invalidarConsultas = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['intervencion', idValido] }),
      queryClient.invalidateQueries({ queryKey: ['intervenciones'] }),
      queryClient.invalidateQueries({ queryKey: ['maquinas'] }),
      queryClient.invalidateQueries({ queryKey: ['notificaciones-contador'] }),
    ]);
  };

  // 7.2.1 Acción TOMAR directa
  const handleTomarDirecto = async () => {
    if (!reporte || idValido === null) return;
    setTomandoDirecto(true);
    try {
      await clienteApi.post(`/api/intervenciones/${idValido}/tomar`, {
        estado_esperado: reporte.estado,
      });
      notifications.show({ color: 'green', message: 'Tomaste la intervención.' });
      await invalidarConsultas();
    } catch (err: unknown) {
      const mensaje =
        err instanceof ApiError && err.codigo === 'RESPONSABLE_SIN_CAMBIOS'
          ? 'Ya sos el responsable de esta intervención.'
          : mensajeError(err);
      notifications.show({ color: 'red', message: mensaje });
      if (requiereRecargar(err)) {
        await queryClient.invalidateQueries({ queryKey: ['intervencion', idValido] });
      }
    } finally {
      setTomandoDirecto(false);
    }
  };

  // Manejo de carga
  if (isLoading) {
    return (
      <Center py="xl">
        <Loader color="marca" />
      </Center>
    );
  }

  // Manejo de 404 o no encontrado
  if (idValido === null || isError || !reporte) {
    return (
      <PantallaVacia
        titulo="No encontramos esta intervención."
        accion={
          <Button variant="default" onClick={() => navigate(destinoVolver)}>
            Volver a Intervenciones
          </Button>
        }
      />
    );
  }

  // Clasificación de acciones disponibles
  const tieneResponsable = Boolean(reporte.responsable);
  const { principal, visibles, menu } = ordenarAcciones(reporte.acciones_disponibles);
  const menuNormales = menu.filter((a) => a !== 'CANCELAR' && a !== 'ELIMINAR');
  const menuPeligrosas = menu.filter((a) => a === 'CANCELAR' || a === 'ELIMINAR');

  const tieneDetencionAbierta = Boolean(periodoAbierto);
  const eventos = eventosHistorial(reporte);

  return (
    <Stack gap="lg">
      {/* 6.1 Encabezado y 6.2 Barra de acciones */}
      <Stack gap="sm">
        <Anchor component={Link} to={destinoVolver} size="sm" c="dimmed" style={{ textDecoration: 'none' }}>
          ← Intervenciones
        </Anchor>

        <Group gap="sm" align="center" wrap="wrap">
          <Title order={2} c="#0f172a">Intervención N.º {reporte.id}</Title>
          <EstadoBadge entidad="intervencion" estado={reporte.estado} size="lg" />
          {tieneDetencionAbierta && <Badge color="red" variant="filled" size="md">Máquina detenida</Badge>}
        </Group>

        {/* 7.1 Barra de acciones */}
        {reporte.acciones_disponibles.length > 0 && (
          <Group gap="xs" wrap="wrap">
            {principal && (
              <Button color="marca" onClick={() => abrirModal(principal as CodigoAccion)}>
                {etiquetaAccion(principal, tieneResponsable)}
              </Button>
            )}

            {visibles.map((a) => (
              a === 'TOMAR' ? (
                <Button key={a} variant="default" loading={tomandoDirecto} onClick={handleTomarDirecto}>
                  Tomar
                </Button>
              ) : (
                <Button key={a} variant="default" onClick={() => abrirModal(a as CodigoAccion)}>
                  {etiquetaAccion(a, tieneResponsable)}
                </Button>
              )
            ))}

            {menu.length > 0 && (
              <Menu position="bottom-end" shadow="md" withinPortal>
                <Menu.Target>
                  <Button variant="default" rightSection={<IconDotsVertical size={16} />}>
                    Más acciones
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  {menuNormales.map((a) => (
                    <Menu.Item key={a} onClick={() => abrirModal(a as CodigoAccion)}>
                      {etiquetaAccion(a, tieneResponsable)}
                    </Menu.Item>
                  ))}
                  {menuPeligrosas.length > 0 && menuNormales.length > 0 && <Menu.Divider />}
                  {menuPeligrosas.map((a) => (
                    <Menu.Item key={a} color="red" onClick={() => abrirModal(a as CodigoAccion)}>
                      {etiquetaAccion(a, tieneResponsable)}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        )}
      </Stack>

      {/* 6.3 Distribución */}
      <Grid gap="md">
        {/* Columna principal */}
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="md">
            {/* 1. Falla reportada */}
            <Card withBorder radius="md" p="md">
              <Stack gap="xs">
                <Text fw={700} size="sm" tt="uppercase" c="#64748b">Falla reportada</Text>
                <Text fw={600} size="md" c="#0f172a">{reporte.descripcion}</Text>
                {reporte.observaciones && (
                  <Text size="sm" c="#475569" style={{ whiteSpace: 'pre-wrap' }}>{reporte.observaciones}</Text>
                )}
              </Stack>
            </Card>

            {/* 2. Trabajo realizado */}
            {reporte.trabajo_realizado && (
              <Card withBorder radius="md" p="md">
                <Stack gap="xs">
                  <Text fw={700} size="sm" tt="uppercase" c="#64748b">Trabajo realizado</Text>
                  <Text size="sm" c="#0f172a" style={{ whiteSpace: 'pre-wrap' }}>{reporte.trabajo_realizado}</Text>
                  <Group justify="space-between" mt="xs" wrap="wrap">
                    <Text size="xs" c="dimmed">
                      Lo hizo: {reporte.ejecucion === 'EXTERNA' ? 'Servicio externo' : 'Personal propio'}
                    </Text>
                    {reporte.fecha_finalizacion && (
                      <Text size="xs" c="dimmed">Finalizado: {formatFechaHora(reporte.fecha_finalizacion)}</Text>
                    )}
                  </Group>
                </Stack>
              </Card>
            )}

            {/* 3. Historial */}
            <Card withBorder radius="md" p="md">
              <Stack gap="md">
                <Text fw={700} size="sm" tt="uppercase" c="#64748b">Historial</Text>
                {eventos.length === 0 ? (
                  <Text size="sm" c="dimmed">Sin eventos registrados.</Text>
                ) : (
                  <Timeline active={eventos.length} bulletSize={20} lineWidth={2}>
                    {eventos.map((ev) => {
                      const colorPunto = ev.estado ? obtenerInfoEstado('intervencion', ev.estado).color : 'gray';
                      return (
                        <Timeline.Item key={ev.clave} color={colorPunto} title={<Text fw={600} size="sm">{ev.titulo}</Text>}>
                          <Text size="xs" c="dimmed">{formatFechaHora(ev.fecha)} · por {nombreCompleto(ev.persona)}</Text>
                          {ev.mostrarRegistrado && (
                            <Text size="xs" c="dimmed">cargado el {formatFechaHora(ev.registrado)}</Text>
                          )}
                          {ev.detalle && (
                            <Text size="xs" c="#64748b" lineClamp={3} mt={2}>{ev.detalle}</Text>
                          )}
                        </Timeline.Item>
                      );
                    })}
                  </Timeline>
                )}
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>

        {/* Columna lateral */}
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="md">
            {/* 1. Datos */}
            <Card withBorder radius="md" p="md">
              <Stack gap="xs">
                <Text fw={700} size="sm" tt="uppercase" c="#64748b">Datos</Text>
                <Group justify="space-between" align="flex-start">
                  <Text size="sm" c="dimmed">Máquina</Text>
                  <Text size="sm" fw={600} ta="right">{etiquetaMaquina(reporte.maquina)}</Text>
                </Group>
                <Group justify="space-between" align="flex-start">
                  <Text size="sm" c="dimmed">Sector</Text>
                  <Text size="sm">{reporte.maquina.sector.nombre}</Text>
                </Group>
                <Group justify="space-between" align="flex-start">
                  <Text size="sm" c="dimmed">Estado de la máquina</Text>
                  <EstadoBadge entidad="maquina" estado={reporte.maquina.estado} />
                </Group>
                <Group justify="space-between" align="flex-start">
                  <Text size="sm" c="dimmed">Reportada por</Text>
                  <Text size="sm">{nombreCompleto(reporte.creado_por)} · {reporte.creado_por.legajo || '—'}</Text>
                </Group>
                <Group justify="space-between" align="flex-start">
                  <Text size="sm" c="dimmed">Reportada</Text>
                  <Text size="sm">{formatFechaHora(reporte.fecha_creacion)}</Text>
                </Group>
                <Group justify="space-between" align="flex-start">
                  <Text size="sm" c="dimmed">Responsable</Text>
                  <Text size="sm">{reporte.responsable ? nombreCompleto(reporte.responsable) : 'Sin asignar'}</Text>
                </Group>
                <Group justify="space-between" align="flex-start">
                  <Text size="sm" c="dimmed">Inicio del trabajo</Text>
                  <Text size="sm">{reporte.fecha_inicio ? formatFechaHora(reporte.fecha_inicio) : '—'}</Text>
                </Group>
                {reporte.fecha_finalizacion && (
                  <Group justify="space-between" align="flex-start">
                    <Text size="sm" c="dimmed">Finalización</Text>
                    <Text size="sm">{formatFechaHora(reporte.fecha_finalizacion)}</Text>
                  </Group>
                )}
              </Stack>
            </Card>

            {/* 2. Tiempos */}
            <Card withBorder radius="md" p="md">
              <Stack gap="xs">
                <Text fw={700} size="sm" tt="uppercase" c="#64748b">Tiempos</Text>
                <Group justify="space-between" align="center">
                  <Text size="sm" c="dimmed">Espera hasta empezar</Text>
                  <Group gap={6}>
                    <Text size="sm" fw={600}>{formatDuracion(reporte.tiempos.espera_minutos)}</Text>
                    {reporte.tiempos.espera_en_curso && <Badge color="yellow" variant="light" size="xs">en curso</Badge>}
                  </Group>
                </Group>
                <Group justify="space-between" align="center">
                  <Text size="sm" c="dimmed">Duración del trabajo</Text>
                  <Group gap={6}>
                    <Text size="sm" fw={600}>{formatDuracion(reporte.tiempos.duracion_bruta_minutos)}</Text>
                    {reporte.tiempos.trabajo_en_curso && <Badge color="yellow" variant="light" size="xs">en curso</Badge>}
                  </Group>
                </Group>
                <Box>
                  <Group justify="space-between" align="center">
                    <Text size="sm" c="dimmed">Trabajo efectivo</Text>
                    <Group gap={6}>
                      <Text size="sm" fw={600}>{formatDuracion(reporte.tiempos.duracion_neta_minutos)}</Text>
                      {reporte.estado === 'EN_PROCESO' && <Badge color="yellow" variant="light" size="xs">en curso</Badge>}
                    </Group>
                  </Group>
                  <Text size="xs" c="dimmed">sin contar la espera de repuestos</Text>
                </Box>
                <Box>
                  <Group justify="space-between" align="center">
                    <Text size="sm" c="dimmed">Tiempo total</Text>
                    <Text size="sm" fw={600}>{formatDuracion(reporte.tiempos.tiempo_total_minutos)}</Text>
                  </Group>
                  <Text size="xs" c="dimmed">del reporte al cierre</Text>
                </Box>
                <Group justify="space-between" align="center">
                  <Text size="sm" c="dimmed">Máquina detenida</Text>
                  <Group gap={6}>
                    <Text size="sm" fw={600}>{formatDuracion(reporte.tiempos.inactividad_minutos)}</Text>
                    {reporte.tiempos.inactividad_en_curso && <Badge color="yellow" variant="light" size="xs">en curso</Badge>}
                  </Group>
                </Group>
              </Stack>
            </Card>

            {/* 3. Detenciones de la máquina */}
            <Card withBorder radius="md" p="md">
              <Stack gap="sm">
                <Text fw={700} size="sm" tt="uppercase" c="#64748b">Detenciones de la máquina</Text>
                {!reporte.periodos_detencion || reporte.periodos_detencion.length === 0 ? (
                  <Text size="sm" c="dimmed">Esta falla no detuvo la máquina.</Text>
                ) : (
                  reporte.periodos_detencion.map((p) => {
                    const estaAbierto = p.esta_abierto || p.hasta === null;
                    return (
                      <Card key={p.id} withBorder radius="sm" p="xs" bg="#f8fafc">
                        <Stack gap={4}>
                          <Group justify="space-between" align="center" wrap="wrap">
                            <Text size="sm" fw={600}>
                              {formatFechaHora(p.desde)} →{' '}
                              {estaAbierto ? <Text span c="red" fw={700}>sigue detenida</Text> : formatFechaHora(p.hasta)}
                            </Text>
                            <Group gap={6}>
                              <Text size="xs">{formatDuracion(minutosEntre(p.desde, p.hasta, new Date()))}</Text>
                              {estaAbierto && <Badge color="yellow" variant="light" size="xs">en curso</Badge>}
                            </Group>
                          </Group>
                          <Text size="xs" c="dimmed">
                            Registrada por {nombreCompleto(p.abierto_por)}
                            {p.observacion ? `: ${p.observacion}` : ''}
                          </Text>
                          {!estaAbierto && p.confirmado_por && (
                            <Text size="xs" c="dimmed">
                              Volvió a funcionar, confirmado por {nombreCompleto(p.confirmado_por)}
                              {p.observacion_confirmacion ? ` (${p.observacion_confirmacion})` : ''}
                            </Text>
                          )}
                          {estaAbierto && puedeConfirmarRecuperacion && (
                            <Button
                              size="xs"
                              variant="light"
                              color="green"
                              mt={4}
                              leftSection={<IconCheck size={14} />}
                              onClick={() => {
                                setPeriodoParaRecuperar(p);
                                setModalActivo('CONFIRMAR_RECUPERACION');
                              }}
                            >
                              Confirmar que volvió a funcionar
                            </Button>
                          )}
                        </Stack>
                      </Card>
                    );
                  })
                )}
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>

      {/* DIÁLOGOS DE ACCIONES */}
      <ModalEditarReporte
        abierto={modalActivo === 'EDITAR'} onCerrar={cerrarModal} intervencionId={idValido}
        estadoEsperado={estadoAlAbrir} descripcionInicial={reporte.descripcion} observacionesIniciales={reporte.observaciones}
      />
      <ModalAsignar
        abierto={modalActivo === 'ASIGNAR'} onCerrar={cerrarModal} intervencionId={idValido}
        estadoAlAbrir={estadoAlAbrir} responsableActual={reporte.responsable}
      />
      <ModalDesasignar
        abierto={modalActivo === 'DESASIGNAR'} onCerrar={cerrarModal} intervencionId={idValido}
        estadoAlAbrir={estadoAlAbrir} responsableActual={reporte.responsable}
      />
      <ModalIniciar
        abierto={modalActivo === 'INICIAR'} onCerrar={cerrarModal} intervencionId={idValido}
        estadoAlAbrir={estadoAlAbrir} fechaCreacion={reporte.fecha_creacion} tieneResponsable={tieneResponsable}
      />
      <ModalEsperaRepuestos
        abierto={modalActivo === 'ESPERAR_REPUESTOS'} onCerrar={cerrarModal}
        intervencionId={idValido} estadoAlAbrir={estadoAlAbrir}
      />
      <ModalReanudar
        abierto={modalActivo === 'REANUDAR'} onCerrar={cerrarModal}
        intervencionId={idValido} estadoAlAbrir={estadoAlAbrir}
      />
      <ModalFinalizar
        abierto={modalActivo === 'FINALIZAR'} onCerrar={cerrarModal} intervencionId={idValido}
        estadoAlAbrir={estadoAlAbrir} fechaInicio={reporte.fecha_inicio} fechaCreacion={reporte.fecha_creacion}
        periodoAbierto={periodoAbierto} puedeConfirmarRecuperacion={puedeConfirmarRecuperacion}
      />
      <ModalResolverAhora
        abierto={modalActivo === 'RESOLVER_AHORA'} onCerrar={cerrarModal} intervencionId={idValido}
        estadoAlAbrir={estadoAlAbrir} fechaCreacion={reporte.fecha_creacion}
        periodoAbierto={periodoAbierto} puedeConfirmarRecuperacion={puedeConfirmarRecuperacion}
      />
      <ModalCancelar
        abierto={modalActivo === 'CANCELAR'} onCerrar={cerrarModal} intervencionId={idValido}
        estadoAlAbrir={estadoAlAbrir} periodoAbierto={periodoAbierto} puedeConfirmarRecuperacion={puedeConfirmarRecuperacion}
      />
      <ModalReabrir
        abierto={modalActivo === 'REABRIR'} onCerrar={cerrarModal} intervencionId={idValido}
        estadoAlAbrir={estadoAlAbrir} reporte={reporte} periodoAbierto={periodoAbierto}
      />
      <ModalRegistrarDetencion
        abierto={modalActivo === 'REGISTRAR_DETENCION'} onCerrar={cerrarModal}
        intervencionId={idValido} estadoAlAbrir={estadoAlAbrir} fechaCreacion={reporte.fecha_creacion}
      />
      <ModalEliminar
        abierto={modalActivo === 'ELIMINAR'} onCerrar={cerrarModal} intervencionId={idValido}
        destinoVolver={destinoVolver} periodoAbierto={periodoAbierto} puedeConfirmarRecuperacion={puedeConfirmarRecuperacion}
      />
      <ModalConfirmarRecuperacion
        abierto={modalActivo === 'CONFIRMAR_RECUPERACION'} onCerrar={cerrarModal}
        maquinaId={reporte.maquina.id} periodo={periodoParaRecuperar}
      />
    </Stack>
  );
}

export default DetalleIntervencion;
