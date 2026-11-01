import React, { useState } from 'react';
import {
  Stack,
  Group,
  Card,
  Text,
  Badge,
  Button,
  Box,
  Title,
  Timeline,
  Modal,
  Textarea,
  Loader,
  Center,
  Anchor,
  Alert,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconEdit,
  IconAlertCircle,
} from '@tabler/icons-react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../api/cliente';
import { EstadoBadge } from '../componentes/EstadoBadge';
import { PantallaVacia } from '../componentes/PantallaVacia';
import { etiquetaMaquina } from '../lib/maquinas';
import { formatFechaHora, formatHace, formatDuracion, parsearId } from '../lib/formato';
import { nombreCompleto } from '../lib/personas';
import { itemHistorial, hayCambiosReporte } from '../lib/intervenciones';
import { obtenerInfoEstado } from '../lib/estados';
import { mensajeError, ApiError } from '../lib/errores';
import type { IntervencionDetalle } from '../api/tipos';

export function DetalleReporteOperario() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const idValido = parsearId(id);

  // Estado para el modal de edición
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editDescripcion, setEditDescripcion] = useState('');
  const [editObservaciones, setEditObservaciones] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  const [errorValidacionDesc, setErrorValidacionDesc] = useState<string | null>(null);
  const [errorValidacionObs, setErrorValidacionObs] = useState<string | null>(null);

  // Consulta del detalle de la intervención
  const {
    data: reporte,
    isLoading,
    error,
  } = useQuery<IntervencionDetalle, ApiError>({
    queryKey: ['intervencion', idValido],
    queryFn: () => clienteApi.get<IntervencionDetalle>(`/api/intervenciones/${idValido}`),
    enabled: idValido !== null,
    refetchInterval: 60000,
    retry: false,
  });

  // Abrir modal de edición con los datos actuales
  const handleAbrirEditar = () => {
    if (!reporte) return;
    setEditDescripcion(reporte.descripcion || '');
    setEditObservaciones(reporte.observaciones || '');
    setErrorEdicion(null);
    setErrorValidacionDesc(null);
    setErrorValidacionObs(null);
    setModalAbierto(true);
  };

  const hayCambios = hayCambiosReporte(
    { descripcion: reporte?.descripcion, observaciones: reporte?.observaciones },
    { descripcion: editDescripcion, observaciones: editObservaciones }
  );

  // Guardar edición
  const handleGuardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reporte || idValido === null) return;

    const descLimpia = editDescripcion.trim();
    if (descLimpia.length < 5) {
      setErrorValidacionDesc('Describí la falla (al menos 5 caracteres).');
      return;
    }
    if (descLimpia.length > 2000) {
      setErrorValidacionDesc('La descripción no puede superar los 2000 caracteres.');
      return;
    }

    const obsLimpia = editObservaciones.trim();
    if (obsLimpia.length > 2000) {
      setErrorValidacionObs('Las observaciones no pueden superar los 2000 caracteres.');
      return;
    }

    setGuardando(true);
    setErrorEdicion(null);

    try {
      await clienteApi.patch(`/api/intervenciones/${idValido}`, {
        estado_esperado: reporte.estado,
        descripcion: descLimpia,
        observaciones: obsLimpia ? obsLimpia : null,
      });

      notifications.show({
        message: 'Reporte actualizado',
        color: 'green',
      });
      setModalAbierto(false);
      await queryClient.invalidateQueries({ queryKey: ['intervencion', idValido] });
    } catch (err: any) {
      const codigo = err?.codigo;
      if (codigo === 'ESTADO_DESACTUALIZADO' || codigo === 'EDICION_NO_PERMITIDA') {
        setModalAbierto(false);
        notifications.show({
          color: 'red',
          message: mensajeError(err),
        });
        await queryClient.invalidateQueries({ queryKey: ['intervencion', idValido] });
      } else {
        setErrorEdicion(mensajeError(err));
      }
    } finally {
      setGuardando(false);
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

  // Manejo de no encontrado o error 404 (o ID inválido)
  if (idValido === null || error || !reporte) {
    const es404 =
      idValido === null ||
      error?.status === 404 ||
      error?.codigo === 'INTERVENCION_NO_ENCONTRADA';

    return (
      <PantallaVacia
        titulo={es404 ? 'No encontramos este reporte.' : 'Error al cargar reporte'}
        mensaje={
          es404
            ? 'Puede que no exista o que no tengas permiso para verlo.'
            : mensajeError(error)
        }
        accion={
          <Button
            variant="default"
            size="md"
            onClick={() => navigate('/mis-reportes')}
          >
            Volver a Mis reportes
          </Button>
        }
      />
    );
  }

  // Lógica de visualización de datos
  const puedeEditar = reporte.acciones_disponibles?.includes('EDITAR');

  // ¿Detuvo la máquina?
  const tienePeriodos =
    reporte.periodos_detencion && reporte.periodos_detencion.length > 0;
  const sigueDetenida =
    tienePeriodos && reporte.periodos_detencion.some((p) => p.esta_abierto);
  const textoDetencion = !tienePeriodos
    ? 'No'
    : sigueDetenida
    ? 'Sí (sigue detenida)'
    : 'Sí';

  return (
    <Stack gap="lg" maw={800}>
      {/* Navegación y encabezado */}
      <Stack gap="xs">
        <Anchor
          component="button"
          type="button"
          onClick={() => navigate('/mis-reportes')}
          size="sm"
          c="#64748b"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <IconArrowLeft size={16} />
          Mis reportes
        </Anchor>

        <Group justify="space-between" align="center" wrap="wrap">
          <Title order={2} size="h2" c="#0f172a">
            Reporte N.º {reporte.id}
          </Title>
          <EstadoBadge entidad="intervencion" estado={reporte.estado} size="lg" />
        </Group>
      </Stack>

      {/* Botón editar si está disponible */}
      {puedeEditar && (
        <Group justify="flex-start">
          <Button
            size="md"
            variant="light"
            color="marca"
            leftSection={<IconEdit size={18} />}
            onClick={handleAbrirEditar}
          >
            Editar
          </Button>
        </Group>
      )}

      {/* Tarjeta Máquina */}
      <Card withBorder radius="md" p="md">
        <Stack gap="xs">
          <Text size="xs" fw={700} tt="uppercase" c="#64748b">
            Máquina
          </Text>
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <Box>
              <Text fw={600} size="md" c="#0f172a">
                {etiquetaMaquina(reporte.maquina)}
              </Text>
              <Text size="sm" c="#64748b">
                Sector: {reporte.maquina.sector.nombre}
              </Text>
            </Box>
            <Group gap="xs" align="center">
              <Text size="xs" c="#64748b">
                Estado de la máquina:
              </Text>
              <EstadoBadge
                entidad="maquina"
                estado={reporte.maquina.estado}
                size="sm"
              />
            </Group>
          </Group>
        </Stack>
      </Card>

      {/* Tarjeta Seguimiento */}
      <Card withBorder radius="md" p="md">
        <Stack gap="md">
          <Text size="xs" fw={700} tt="uppercase" c="#64748b">
            Seguimiento
          </Text>

          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" c="#64748b">
                Reportado
              </Text>
              <Text size="sm" fw={500} c="#1e293b" style={{ textAlign: 'right' }}>
                {formatFechaHora(reporte.fecha_creacion)} ({formatHace(reporte.fecha_creacion)})
              </Text>
            </Group>

            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" c="#64748b">
                Reportado por
              </Text>
              <Text size="sm" fw={500} c="#1e293b" style={{ textAlign: 'right' }}>
                {nombreCompleto(reporte.creado_por)}
              </Text>
            </Group>

            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" c="#64748b">
                Responsable
              </Text>
              <Text size="sm" fw={500} c="#1e293b" style={{ textAlign: 'right' }}>
                {nombreCompleto(reporte.responsable) || 'Sin asignar todavía'}
              </Text>
            </Group>

            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" c="#64748b">
                Espera
              </Text>
              <Group gap={6} justify="flex-end">
                <Text size="sm" fw={500} c="#1e293b">
                  {formatDuracion(reporte.tiempos.espera_minutos)}
                </Text>
                {reporte.tiempos.espera_en_curso && (
                  <Badge size="xs" color="blue" variant="light">
                    en curso
                  </Badge>
                )}
              </Group>
            </Group>

            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" c="#64748b">
                ¿Detuvo la máquina?
              </Text>
              <Text size="sm" fw={500} c={sigueDetenida ? 'red' : '#1e293b'} style={{ textAlign: 'right' }}>
                {textoDetencion}
              </Text>
            </Group>

            {reporte.fecha_finalizacion && (
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" c="#64748b">
                  Finalizado
                </Text>
                <Text size="sm" fw={500} c="#1e293b" style={{ textAlign: 'right' }}>
                  {formatFechaHora(reporte.fecha_finalizacion)}
                </Text>
              </Group>
            )}
          </Stack>
        </Stack>
      </Card>

      {/* Tarjeta Descripción */}
      <Card withBorder radius="md" p="md">
        <Stack gap="md">
          <Text size="xs" fw={700} tt="uppercase" c="#64748b">
            Descripción
          </Text>

          <Text size="sm" c="#1e293b" style={{ whiteSpace: 'pre-wrap' }}>
            {reporte.descripcion}
          </Text>

          {reporte.observaciones && (
            <Box mt="xs" pt="xs" style={{ borderTop: '1px solid #f1f5f9' }}>
              <Text size="xs" fw={600} c="#64748b" mb={4}>
                Observaciones:
              </Text>
              <Text size="sm" c="#475569" style={{ whiteSpace: 'pre-wrap' }}>
                {reporte.observaciones}
              </Text>
            </Box>
          )}

          {reporte.trabajo_realizado && (
            <Box mt="xs" pt="xs" style={{ borderTop: '1px solid #f1f5f9' }}>
              <Text size="xs" fw={600} c="#059669" mb={4}>
                Trabajo realizado:
              </Text>
              <Text size="sm" c="#1e293b" style={{ whiteSpace: 'pre-wrap' }}>
                {reporte.trabajo_realizado}
              </Text>
            </Box>
          )}
        </Stack>
      </Card>

      {/* Tarjeta Historial */}
      <Card withBorder radius="md" p="md">
        <Stack gap="md">
          <Text size="xs" fw={700} tt="uppercase" c="#64748b">
            Historial
          </Text>

          {reporte.historial_estados && reporte.historial_estados.length > 0 ? (
            <Timeline
              active={reporte.historial_estados.length - 1}
              bulletSize={18}
              lineWidth={2}
            >
              {reporte.historial_estados.map((h, i) => {
                const info = itemHistorial(h);
                const infoEstado = obtenerInfoEstado('intervencion', info.estado);
                return (
                  <Timeline.Item
                    key={h.id || i}
                    title={info.titulo}
                    color={infoEstado.color}
                  >
                    <Text size="xs" c="#64748b" mt={2}>
                      {formatFechaHora(info.fecha)} · por {nombreCompleto(h.cambiado_por)}
                    </Text>
                    {h.observacion && (
                      <Text
                        size="sm"
                        c="#64748b"
                        mt={4}
                        style={{ fontStyle: 'italic' }}
                      >
                        {h.observacion}
                      </Text>
                    )}
                  </Timeline.Item>
                );
              })}
            </Timeline>
          ) : (
            <Text size="sm" c="#64748b">
              Sin movimientos registrados
            </Text>
          )}
        </Stack>
      </Card>

      {/* Modal de edición */}
      <Modal
        opened={modalAbierto}
        onClose={() => !guardando && setModalAbierto(false)}
        title="Editar reporte"
        size="lg"
        centered
      >
        <form onSubmit={handleGuardarEdicion} noValidate>
          <Stack gap="md">
            {errorEdicion && (
              <Alert
                color="red"
                variant="light"
                icon={<IconAlertCircle size={18} />}
              >
                {errorEdicion}
              </Alert>
            )}

            <Stack gap={4}>
              <Textarea
                size="md"
                label="¿Qué pasa?"
                minRows={3}
                maxRows={6}
                value={editDescripcion}
                onChange={(e) => {
                  setEditDescripcion(e.currentTarget.value);
                  if (errorValidacionDesc) setErrorValidacionDesc(null);
                }}
                error={errorValidacionDesc}
                disabled={guardando}
              />
              <Group justify="flex-end">
                <Text size="xs" c={editDescripcion.length > 2000 ? 'red' : '#94a3b8'}>
                  {editDescripcion.length}/2000
                </Text>
              </Group>
            </Stack>

            <Stack gap={4}>
              <Textarea
                size="md"
                label="Observaciones (opcional)"
                minRows={2}
                maxRows={4}
                value={editObservaciones}
                onChange={(e) => {
                  setEditObservaciones(e.currentTarget.value);
                  if (errorValidacionObs) setErrorValidacionObs(null);
                }}
                error={errorValidacionObs}
                disabled={guardando}
              />
              <Group justify="flex-end">
                <Text size="xs" c={editObservaciones.length > 2000 ? 'red' : '#94a3b8'}>
                  {editObservaciones.length}/2000
                </Text>
              </Group>
            </Stack>

            <Group justify="flex-end" gap="sm" mt="md">
              <Button
                variant="default"
                onClick={() => setModalAbierto(false)}
                disabled={guardando}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                color="marca"
                loading={guardando}
                disabled={!hayCambios}
              >
                Guardar cambios
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
export default DetalleReporteOperario;
