import React, { useState, useEffect } from 'react';
import {
  Modal,
  Stack,
  Textarea,
  Group,
  Button,
  Alert,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertCircle } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { SeccionRecuperacionMaquina } from '../SeccionRecuperacionMaquina';
import { mensajeError, requiereRecargar } from '../../lib/errores';
import { Momento } from '../../lib/fechas';
import type { PeriodoDetencion } from '../../api/tipos';

export interface ModalEliminarProps {
  abierto: boolean;
  onCerrar: () => void;
  onEliminada: () => void;
  intervencionId: number;
  destinoVolver: string;
  periodoAbierto?: PeriodoDetencion | null;
  puedeConfirmarRecuperacion: boolean;
}

export function ModalEliminar({
  abierto,
  onCerrar,
  onEliminada,
  intervencionId,
  destinoVolver,
  periodoAbierto,
  puedeConfirmarRecuperacion,
}: ModalEliminarProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useMediaQuery('(max-width: 48em)');

  const [motivoTexto, setMotivoTexto] = useState('');
  const [maquinaRecuperada, setMaquinaRecuperada] = useState<boolean | null>(null);
  const [momentoRecuperacion, setMomentoRecuperacion] = useState<Momento>({ modo: 'ahora', fecha: null });
  const [observacionRecuperacion, setObservacionRecuperacion] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [errorModal, setErrorModal] = useState<string | null>(null);

  useEffect(() => {
    if (abierto) {
      setMotivoTexto('');
      setMaquinaRecuperada(null);
      setMomentoRecuperacion({ modo: 'ahora', fecha: null });
      setObservacionRecuperacion('');
      setErrorModal(null);
    }
  }, [abierto]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const motTrim = motivoTexto.trim();
    if (motTrim.length < 5) {
      setErrorModal('Indicá el motivo (al menos 5 caracteres).');
      return;
    }

    let reqRecuperada: boolean | undefined = undefined;
    let reqObsRec: string | undefined = undefined;

    if (periodoAbierto) {
      if (!puedeConfirmarRecuperacion) {
        reqRecuperada = false;
      } else {
        if (maquinaRecuperada === null) {
          setErrorModal('Indicá si la máquina volvió a funcionar.');
          return;
        }
        reqRecuperada = maquinaRecuperada;
        if (maquinaRecuperada) {
          reqObsRec = observacionRecuperacion.trim() || undefined;
        }
      }
    }

    setErrorModal(null);
    setGuardando(true);

    try {
      await clienteApi.post(`/api/intervenciones/${intervencionId}/eliminar`, {
        motivo: motTrim,
        maquina_recuperada: reqRecuperada,
        observacion_recuperacion: reqObsRec,
      });

      notifications.show({
        color: 'green',
        message: `Intervención N.º ${intervencionId} eliminada.`,
      });

      onEliminada();
      onCerrar();
      navigate(destinoVolver);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['intervenciones'] }),
        queryClient.invalidateQueries({ queryKey: ['maquinas'] }),
        queryClient.invalidateQueries({ queryKey: ['notificaciones-contador'] }),
        queryClient.invalidateQueries({ queryKey: ['tablero'] }),
        queryClient.invalidateQueries({ queryKey: ['planes'] }),
        queryClient.invalidateQueries({ queryKey: ['plan'] }),
        queryClient.invalidateQueries({ queryKey: ['vencimientos'] }),
      ]);
    } catch (err: unknown) {
      if (requiereRecargar(err)) {
        onCerrar();
        notifications.show({
          color: 'red',
          message: mensajeError(err),
        });
        await queryClient.invalidateQueries({ queryKey: ['intervencion', intervencionId] });
      } else {
        setErrorModal(mensajeError(err));
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      opened={abierto}
      onClose={() => !guardando && onCerrar()}
      title="Eliminar intervención"
      size="md"
      centered
      fullScreen={isMobile}
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <Alert color="yellow" variant="light">
            Se usa para reportes cargados por error. La intervención deja de aparecer en las listas.
          </Alert>

          {errorModal && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              {errorModal}
            </Alert>
          )}

          <Textarea
            label="Motivo"
            placeholder="Indicá el motivo de la eliminación (al menos 5 caracteres)"
            value={motivoTexto}
            onChange={(e) => setMotivoTexto(e.currentTarget.value)}
            disabled={guardando}
            required
          />

          {periodoAbierto && (
            <SeccionRecuperacionMaquina
              puedeConfirmar={puedeConfirmarRecuperacion}
              incluyeFecha={false}
              maquinaRecuperada={maquinaRecuperada}
              onMaquinaRecuperadaChange={setMaquinaRecuperada}
              momentoRecuperacion={momentoRecuperacion}
              onMomentoRecuperacionChange={setMomentoRecuperacion}
              observacionRecuperacion={observacionRecuperacion}
              onObservacionRecuperacionChange={setObservacionRecuperacion}
              disabled={guardando}
            />
          )}

          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Volver
            </Button>
            <Button type="submit" color="red" loading={guardando}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
