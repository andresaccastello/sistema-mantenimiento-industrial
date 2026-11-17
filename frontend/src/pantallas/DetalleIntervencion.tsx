import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Stack, Group, Card, Text, Badge, Button,
  Title, Loader, Center, Anchor, Menu, Grid,
} from '@mantine/core';
import { IconDotsVertical } from '@tabler/icons-react';
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
import { formatFechaHora, parsearId } from '../lib/formato';
import { ordenarAcciones, etiquetaAccion, CodigoAccion } from '../lib/acciones';
import { BloqueRepuestosIntervencion } from '../componentes/repuestos/BloqueRepuestosIntervencion';
import { BloquePedidosIntervencion } from '../componentes/repuestos/BloquePedidosIntervencion';
import { BloqueCostosIntervencion } from '../componentes/costos/BloqueCostosIntervencion';
import { BloqueTareasIntervencion } from '../componentes/preventivos/BloqueTareasIntervencion';
import { PlanDeIntervencion } from '../componentes/preventivos/PlanDeIntervencion';
import { DatosIntervencion } from '../componentes/intervenciones/DatosIntervencion';
import { DetencionesIntervencion } from '../componentes/intervenciones/DetencionesIntervencion';
import { HistorialIntervencion } from '../componentes/intervenciones/HistorialIntervencion';
import { TiemposIntervencion } from '../componentes/intervenciones/TiemposIntervencion';
import { mensajeError, requiereRecargar, ApiError } from '../lib/errores';
import type { IntervencionDetalle, PeriodoDetencion } from '../api/tipos';

export function DetalleIntervencion() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { usuario } = useAuth();

  const idValido = parsearId(id);

  const eliminadaRef = useRef(false);
  useEffect(() => () => {
    if (eliminadaRef.current) {
      eliminadaRef.current = false;
      queryClient.removeQueries({ queryKey: ['intervencion', idValido] });
    }
  }, [idValido, queryClient]);

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
  const esPreventivo = reporte.tipo === 'PREVENTIVO';

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
          {esPreventivo && <Badge color="teal" variant="light" size="md">Preventivo</Badge>}
        </Group>
        <PlanDeIntervencion plan={reporte.plan} />

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
                <Text fw={700} size="sm" tt="uppercase" c="#64748b">{esPreventivo ? 'Trabajo programado' : 'Falla reportada'}</Text>
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

            {reporte.plan && <BloqueTareasIntervencion intervencionId={reporte.id} estadoIntervencion={reporte.estado} />}

            {/* Repuestos usados y Pedidos */}
            <BloqueRepuestosIntervencion
              intervencionId={reporte.id}
              estadoIntervencion={reporte.estado} conPlan={Boolean(reporte.plan)}
            />
            <BloquePedidosIntervencion
              intervencionId={reporte.id}
              estadoIntervencion={reporte.estado} acciones={reporte.acciones_disponibles} maquinaDetenida={tieneDetencionAbierta}
            />
            <BloqueCostosIntervencion intervencionId={reporte.id} estadoIntervencion={reporte.estado} />

            {/* 3. Historial */}
            <HistorialIntervencion reporte={reporte} />
          </Stack>
        </Grid.Col>

        {/* Columna lateral */}
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="md">
            {/* 1. Datos */}
            <DatosIntervencion reporte={reporte} />

            {/* 2. Tiempos */}
            <TiemposIntervencion reporte={reporte} />

            {/* 3. Detenciones de la máquina */}
            <DetencionesIntervencion
              reporte={reporte}
              puedeConfirmarRecuperacion={puedeConfirmarRecuperacion}
              onConfirmarRecuperacion={(p) => {
                setPeriodoParaRecuperar(p);
                setModalActivo('CONFIRMAR_RECUPERACION');
              }}
            />
          </Stack>
        </Grid.Col>
      </Grid>

      {/* DIÁLOGOS DE ACCIONES */}
      <ModalEditarReporte
        abierto={modalActivo === 'EDITAR'} onCerrar={cerrarModal} intervencionId={idValido}
        estadoEsperado={estadoAlAbrir} descripcionInicial={reporte.descripcion} observacionesIniciales={reporte.observaciones} esPreventivo={esPreventivo}
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
        periodoAbierto={periodoAbierto} puedeConfirmarRecuperacion={puedeConfirmarRecuperacion} conTareas={Boolean(reporte.plan)}
      />
      <ModalResolverAhora
        abierto={modalActivo === 'RESOLVER_AHORA'} onCerrar={cerrarModal} intervencionId={idValido}
        estadoAlAbrir={estadoAlAbrir} fechaCreacion={reporte.fecha_creacion}
        periodoAbierto={periodoAbierto} puedeConfirmarRecuperacion={puedeConfirmarRecuperacion} conTareas={Boolean(reporte.plan)}
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
        abierto={modalActivo === 'ELIMINAR'} onCerrar={cerrarModal}
        onEliminada={() => { eliminadaRef.current = true; }} intervencionId={idValido}
        destinoVolver={destinoVolver} periodoAbierto={periodoAbierto} puedeConfirmarRecuperacion={puedeConfirmarRecuperacion}
      />
      <ModalConfirmarRecuperacion
        abierto={modalActivo === 'CONFIRMAR_RECUPERACION'} onCerrar={cerrarModal}
        maquinaId={reporte.maquina.id} periodos={periodoParaRecuperar ? [periodoParaRecuperar] : []}
      />
    </Stack>
  );
}

export default DetalleIntervencion;
