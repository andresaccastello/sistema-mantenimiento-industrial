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
import { clienteApi } from '../../api/cliente';
import { SeccionRecuperacionMaquina } from '../SeccionRecuperacionMaquina';
import { validarMomento, momentoAIso, Momento } from '../../lib/fechas';
import type { PeriodoDetencion } from '../../api/tipos';
import { useAccionIntervencion } from './useAccionIntervencion';

export interface ModalCancelarProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  estadoAlAbrir: string;
  periodoAbierto?: PeriodoDetencion | null;
  puedeConfirmarRecuperacion: boolean;
}

export function ModalCancelar({
  abierto,
  onCerrar,
  intervencionId,
  estadoAlAbrir,
  periodoAbierto,
  puedeConfirmarRecuperacion,
}: ModalCancelarProps) {
  const isMobile = useMediaQuery('(max-width: 48em)');

  const [motivoTexto, setMotivoTexto] = useState('');
  const [maquinaRecuperada, setMaquinaRecuperada] = useState<boolean | null>(null);
  const [momentoRecuperacion, setMomentoRecuperacion] = useState<Momento>({ modo: 'ahora', fecha: null });
  const [observacionRecuperacion, setObservacionRecuperacion] = useState('');

  const { guardando, errorModal, setErrorModal, ejecutar } = useAccionIntervencion({
    intervencionId,
    onCerrar,
    avisoExito: 'Intervención cancelada.',
  });

  useEffect(() => {
    if (abierto) {
      setMotivoTexto('');
      setMaquinaRecuperada(null);
      setMomentoRecuperacion({ modo: 'ahora', fecha: null });
      setObservacionRecuperacion('');
      setErrorModal(null);
    }
  }, [abierto, setErrorModal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ahora = new Date();

    const motTrim = motivoTexto.trim();
    if (motTrim.length < 5) {
      setErrorModal('Indicá el motivo (al menos 5 caracteres).');
      return;
    }

    let reqRecuperada: boolean | undefined = undefined;
    let reqFechaRec: string | undefined = undefined;
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
          const errMomRec = validarMomento(momentoRecuperacion, periodoAbierto.desde, ahora);
          if (errMomRec) {
            setErrorModal(errMomRec);
            return;
          }
          reqFechaRec = momentoAIso(momentoRecuperacion, periodoAbierto.desde);
          reqObsRec = observacionRecuperacion.trim() || undefined;
        }
      }
    }

    ejecutar(() =>
      clienteApi.post(`/api/intervenciones/${intervencionId}/cancelar`, {
        estado_esperado: estadoAlAbrir,
        motivo: motTrim,
        maquina_recuperada: reqRecuperada,
        fecha_recuperacion: reqFechaRec,
        observacion_recuperacion: reqObsRec,
      })
    );
  };

  return (
    <Modal
      opened={abierto}
      onClose={() => !guardando && onCerrar()}
      title="Cancelar intervención"
      size="md"
      centered
      fullScreen={isMobile}
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          {errorModal && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              {errorModal}
            </Alert>
          )}

          <Textarea
            label="Motivo"
            maxLength={500}
            placeholder="Indicá el motivo de la cancelación (al menos 5 caracteres)"
            value={motivoTexto}
            onChange={(e) => setMotivoTexto(e.currentTarget.value)}
            disabled={guardando}
            required
          />

          {periodoAbierto && (
            <SeccionRecuperacionMaquina
              puedeConfirmar={puedeConfirmarRecuperacion}
              minimoDesde={periodoAbierto.desde}
              primeraOpcionFechaLabel="Ahora"
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
              Cancelar intervención
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
