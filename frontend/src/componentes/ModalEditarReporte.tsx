import React, { useState, useEffect } from 'react';
import {
  Modal,
  Stack,
  Textarea,
  Group,
  Text,
  Button,
  Alert,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertCircle } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { clienteApi } from '../api/cliente';
import { mensajeError, requiereRecargar } from '../lib/errores';
import { hayCambiosReporte } from '../lib/intervenciones';

export interface ModalEditarReporteProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  estadoEsperado: string;
  descripcionInicial: string;
  observacionesIniciales?: string | null;
  onExito?: () => void;
}

export function ModalEditarReporte({
  abierto,
  onCerrar,
  intervencionId,
  estadoEsperado,
  descripcionInicial,
  observacionesIniciales,
  onExito,
}: ModalEditarReporteProps) {
  const queryClient = useQueryClient();
  const isMobile = useMediaQuery('(max-width: 48em)');

  const [descripcion, setDescripcion] = useState(descripcionInicial);
  const [observaciones, setObservaciones] = useState(observacionesIniciales || '');
  const [guardando, setGuardando] = useState(false);
  const [errorValidacionDesc, setErrorValidacionDesc] = useState<string | null>(null);
  const [errorValidacionObs, setErrorValidacionObs] = useState<string | null>(null);
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);

  // Reiniciar estado cada vez que se abre el modal
  useEffect(() => {
    if (abierto) {
      setDescripcion(descripcionInicial);
      setObservaciones(observacionesIniciales || '');
      setErrorValidacionDesc(null);
      setErrorValidacionObs(null);
      setErrorEdicion(null);
      setGuardando(false);
    }
  }, [abierto, descripcionInicial, observacionesIniciales]);

  const hayCambios = hayCambiosReporte(
    { descripcion: descripcionInicial, observaciones: observacionesIniciales },
    { descripcion, observaciones }
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const descLimpia = descripcion.trim();
    if (descLimpia.length < 5) {
      setErrorValidacionDesc('Describí la falla (al menos 5 caracteres).');
      return;
    }
    if (descLimpia.length > 2000) {
      setErrorValidacionDesc('La descripción no puede superar los 2000 caracteres.');
      return;
    }

    const obsLimpia = observaciones.trim();
    if (obsLimpia.length > 2000) {
      setErrorValidacionObs('Las observaciones no pueden superar los 2000 caracteres.');
      return;
    }

    setGuardando(true);
    setErrorEdicion(null);

    try {
      await clienteApi.patch(`/api/intervenciones/${intervencionId}`, {
        estado_esperado: estadoEsperado,
        descripcion: descLimpia,
        observaciones: obsLimpia.length > 0 ? obsLimpia : null,
      });

      notifications.show({
        message: 'Cambios guardados.',
        color: 'green',
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['intervencion', intervencionId] }),
        queryClient.invalidateQueries({ queryKey: ['intervenciones'] }),
        queryClient.invalidateQueries({ queryKey: ['maquinas'] }),
        queryClient.invalidateQueries({ queryKey: ['notificaciones-contador'] }),
      ]);

      onCerrar();
      onExito?.();
    } catch (err: unknown) {
      if (requiereRecargar(err)) {
        onCerrar();
        notifications.show({
          color: 'red',
          message: mensajeError(err),
        });
        await queryClient.invalidateQueries({ queryKey: ['intervencion', intervencionId] });
      } else {
        setErrorEdicion(mensajeError(err));
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      opened={abierto}
      onClose={() => !guardando && onCerrar()}
      title="Editar intervención"
      size="lg"
      centered
      fullScreen={isMobile}
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          {errorEdicion && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />}>
              {errorEdicion}
            </Alert>
          )}

          <Stack gap={4}>
            <Textarea
              size="md"
              label="¿Qué pasa?"
              minRows={3}
              maxRows={6}
              value={descripcion}
              onChange={(e) => {
                setDescripcion(e.currentTarget.value);
                if (errorValidacionDesc) setErrorValidacionDesc(null);
              }}
              error={errorValidacionDesc}
              disabled={guardando}
            />
            <Group justify="flex-end">
              <Text size="xs" c={descripcion.length > 2000 ? 'red' : '#94a3b8'}>
                {descripcion.length}/2000
              </Text>
            </Group>
          </Stack>

          <Stack gap={4}>
            <Textarea
              size="md"
              label="Observaciones (opcional)"
              minRows={2}
              maxRows={4}
              value={observaciones}
              onChange={(e) => {
                setObservaciones(e.currentTarget.value);
                if (errorValidacionObs) setErrorValidacionObs(null);
              }}
              error={errorValidacionObs}
              disabled={guardando}
            />
            <Group justify="flex-end">
              <Text size="xs" c={observaciones.length > 2000 ? 'red' : '#94a3b8'}>
                {observaciones.length}/2000
              </Text>
            </Group>
          </Stack>

          <Group justify="flex-end" gap="sm" mt="md">
            <Button
              variant="default"
              onClick={onCerrar}
              disabled={guardando}
            >
              Volver
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
  );
}

export default ModalEditarReporte;
