import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconAlertTriangle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { MaquinaLista } from '../../api/tipos';
import { obtenerInfoEstado } from '../../lib/estados';
import { motivoNoDesactivable, type CodigoAccionMaquina } from '../../lib/maquinas';
import { ApiError, mensajeError, requiereRecargar } from '../../lib/errores';

interface Props {
  maquina: MaquinaLista;
  accionActiva: CodigoAccionMaquina | null;
  onCerrar: () => void;
  cantidadDetencionesAbiertas: number;
  esCelular: boolean;
}

/** 6.6 y 6.7: dejar fuera de servicio, volver a servicio, desactivar y reactivar. */
export function DialogosEstadoMaquina({ maquina, accionActiva, onCerrar, cantidadDetencionesAbiertas, esCelular }: Props) {
  const queryClient = useQueryClient();

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

  const invalidarTodoMaquina = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['maquina', maquina.id] }),
      queryClient.invalidateQueries({ queryKey: ['maquinas'] }),
      queryClient.invalidateQueries({ queryKey: ['tablero'] }),
    ]);
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

      onCerrar();
      await invalidarTodoMaquina();
    } catch (err: unknown) {
      const cod =
        err instanceof ApiError
          ? err.codigo
          : (err as { codigo?: string })?.codigo;
      if (cod === 'SIN_CAMBIOS') {
        onCerrar();
        notifications.show({
          color: 'red',
          message: 'La máquina ya está en ese estado.',
        });
        await invalidarTodoMaquina();
      } else if (requiereRecargar(err)) {
        onCerrar();
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

  /** Desactivar y reactivar: el mismo manejo de errores. */
  const ejecutar = async (llamada: () => Promise<unknown>, aviso: string) => {
    setGuardandoDialogo(true);
    setErrorDialogo(null);
    try {
      await llamada();
      notifications.show({
        color: 'green',
        message: aviso,
      });
      onCerrar();
      await invalidarTodoMaquina();
    } catch (err: unknown) {
      if (requiereRecargar(err)) {
        onCerrar();
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

  const handleDesactivar = () =>
    ejecutar(() => clienteApi.delete(`/api/maquinas/${maquina.id}`), 'Máquina desactivada.');
  const handleReactivar = () =>
    ejecutar(() => clienteApi.put(`/api/maquinas/${maquina.id}`, { activo: true }), 'Máquina reactivada.');

  const motivoBloqueoDesactivar = motivoNoDesactivable(
    maquina,
    cantidadDetencionesAbiertas
  );

  const alertaError = errorDialogo && (
    <Alert
      color="red"
      variant="light"
      icon={<IconAlertCircle size={18} />}
    >
      {errorDialogo}
    </Alert>
  );

  return (
    <>
      {/* 6.6 Fuera de servicio y vuelta a servicio */}
      <Modal
        opened={
          accionActiva === 'FUERA_DE_SERVICIO' ||
          accionActiva === 'VOLVER_A_SERVICIO'
        }
        onClose={() => !guardandoDialogo && onCerrar()}
        title={
          accionActiva === 'FUERA_DE_SERVICIO'
            ? 'Dejar fuera de servicio'
            : 'Volver a servicio'
        }
        size="md"
        centered
        fullScreen={esCelular}
      >
        <form onSubmit={handleConfirmarCambioEstado} noValidate>
          <Stack gap="md">
            {alertaError}

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
                onClick={onCerrar}
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
        onClose={() => !guardandoDialogo && onCerrar()}
        title="Desactivar máquina"
        size="md"
        centered
        fullScreen={esCelular}
      >
        <Stack gap="md">
          {alertaError}

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
                  onClick={onCerrar}
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
                  onClick={onCerrar}
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
        onClose={() => !guardandoDialogo && onCerrar()}
        title="Reactivar máquina"
        size="md"
        centered
        fullScreen={esCelular}
      >
        <Stack gap="md">
          {alertaError}

          <Text size="sm">
            La máquina volverá a aparecer en las listas y en Reportar falla.
          </Text>

          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              onClick={onCerrar}
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
    </>
  );
}
