import React, { useState, useEffect } from 'react';
import {
  Modal,
  Stack,
  Text,
  Textarea,
  SegmentedControl,
  Group,
  Button,
  Alert,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { SelectorMomento } from '../SelectorMomento';
import { minimoNuevaDetencion } from '../../lib/intervenciones';
import { validarMomento, momentoAIso, Momento } from '../../lib/fechas';
import type { IntervencionDetalle, PeriodoDetencion } from '../../api/tipos';
import { useAccionIntervencion } from './useAccionIntervencion';

export interface ModalReabrirProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  estadoAlAbrir: string;
  reporte: IntervencionDetalle;
  periodoAbierto?: PeriodoDetencion | null;
}

export function ModalReabrir({
  abierto,
  onCerrar,
  intervencionId,
  estadoAlAbrir,
  reporte,
  periodoAbierto,
}: ModalReabrirProps) {
  const isMobile = useMediaQuery('(max-width: 48em)');

  const [motivoTexto, setMotivoTexto] = useState('');
  const [maquinaDetenidaReabrir, setMaquinaDetenidaReabrir] = useState<boolean | null>(null);
  const [momentoAccion, setMomentoAccion] = useState<Momento>({ modo: 'ahora', fecha: null });
  const [observacionTexto, setObservacionTexto] = useState('');

  const { guardando, errorModal, setErrorModal, ejecutar } = useAccionIntervencion({
    intervencionId,
    onCerrar,
    avisoExito: 'Intervención reabierta.',
  });

  useEffect(() => {
    if (abierto) {
      setMotivoTexto('');
      setMaquinaDetenidaReabrir(null);
      setMomentoAccion({ modo: 'ahora', fecha: null });
      setObservacionTexto('');
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

    let maqDet: boolean | undefined = undefined;
    let desdeIso: string | undefined = undefined;
    let obsDetTrim: string | undefined = undefined;

    if (!periodoAbierto) {
      if (maquinaDetenidaReabrir === null) {
        setErrorModal('Indicá si la máquina volvió a detenerse.');
        return;
      }
      maqDet = maquinaDetenidaReabrir;
      if (maquinaDetenidaReabrir) {
        const minDet = minimoNuevaDetencion(reporte);
        const errMom = validarMomento(momentoAccion, minDet, ahora);
        if (errMom) {
          setErrorModal(errMom);
          return;
        }
        desdeIso = momentoAIso(momentoAccion, minDet);
        obsDetTrim = observacionTexto.trim() || undefined;
      }
    }

    ejecutar(() =>
      clienteApi.post(`/api/intervenciones/${intervencionId}/reabrir`, {
        estado_esperado: estadoAlAbrir,
        motivo: motTrim,
        maquina_detenida: maqDet,
        desde: desdeIso,
        observacion_detencion: obsDetTrim,
      })
    );
  };

  return (
    <Modal
      opened={abierto}
      onClose={() => !guardando && onCerrar()}
      title="Reabrir intervención"
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
            placeholder="Indicá el motivo de la reapertura (al menos 5 caracteres)"
            value={motivoTexto}
            onChange={(e) => setMotivoTexto(e.currentTarget.value)}
            disabled={guardando}
            required
          />

          {!periodoAbierto && (
            <Stack gap="xs">
              <Text size="sm" fw={500}>
                ¿La máquina volvió a detenerse?
              </Text>
              <SegmentedControl
                value={
                  maquinaDetenidaReabrir === true
                    ? 'si'
                    : maquinaDetenidaReabrir === false
                    ? 'no'
                    : ''
                }
                onChange={(val) => setMaquinaDetenidaReabrir(val === 'si')}
                data={[
                  { label: 'Sí', value: 'si' },
                  { label: 'No', value: 'no' },
                ]}
                disabled={guardando}
              />

              {maquinaDetenidaReabrir === true && (
                <Stack gap="xs" mt="xs">
                  <SelectorMomento
                    label="¿Desde cuándo?"
                    opcionAhoraLabel="Ahora"
                    minimo={minimoNuevaDetencion(reporte)}
                    value={momentoAccion}
                    onChange={setMomentoAccion}
                    disabled={guardando}
                  />
                  <Textarea
                    label="Observación de la detención (opcional)"
                    value={observacionTexto}
                    onChange={(e) => setObservacionTexto(e.currentTarget.value)}
                    disabled={guardando}
                  />
                </Stack>
              )}
            </Stack>
          )}

          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Volver
            </Button>
            <Button type="submit" color="marca" loading={guardando}>
              Reabrir
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
