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
import { SelectorMomento } from '../SelectorMomento';
import { validarMomento, momentoAIso, Momento } from '../../lib/fechas';
import type { PeriodoDetencion } from '../../api/tipos';
import { useAccionIntervencion } from './useAccionIntervencion';

export interface ModalConfirmarRecuperacionProps {
  abierto: boolean;
  onCerrar: () => void;
  maquinaId: number;
  periodo: PeriodoDetencion | null;
}

export function ModalConfirmarRecuperacion({
  abierto,
  onCerrar,
  maquinaId,
  periodo,
}: ModalConfirmarRecuperacionProps) {
  const isMobile = useMediaQuery('(max-width: 48em)');

  const [momentoAccion, setMomentoAccion] = useState<Momento>({ modo: 'ahora', fecha: null });
  const [observacionTexto, setObservacionTexto] = useState('');

  const { guardando, errorModal, setErrorModal, ejecutar } = useAccionIntervencion({
    onCerrar,
    avisoExito: 'Listo: la máquina volvió a funcionar.',
  });

  useEffect(() => {
    if (abierto) {
      setMomentoAccion({ modo: 'ahora', fecha: null });
      setObservacionTexto('');
      setErrorModal(null);
    }
  }, [abierto, setErrorModal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!periodo) return;

    const ahora = new Date();
    const errMom = validarMomento(momentoAccion, periodo.desde, ahora);
    if (errMom) {
      setErrorModal(errMom);
      return;
    }
    const fRecIso = momentoAIso(momentoAccion, periodo.desde);
    const obsTrim = observacionTexto.trim();

    ejecutar(() =>
      clienteApi.post(`/api/maquinas/${maquinaId}/confirmar-recuperacion`, {
        periodo_ids: [periodo.id],
        fecha_recuperacion: fRecIso,
        observacion: obsTrim.length > 0 ? obsTrim : undefined,
      })
    );
  };

  return (
    <Modal
      opened={abierto}
      onClose={() => !guardando && onCerrar()}
      title="Confirmar que la máquina volvió a funcionar"
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

          {periodo && (
            <SelectorMomento
              label="¿Desde cuándo funciona?"
              opcionAhoraLabel="Ahora"
              minimo={periodo.desde}
              value={momentoAccion}
              onChange={setMomentoAccion}
              disabled={guardando}
            />
          )}

          <Textarea
            label="Observación (opcional)"
            placeholder="Detalle de la recuperación de la máquina"
            value={observacionTexto}
            onChange={(e) => setObservacionTexto(e.currentTarget.value)}
            disabled={guardando}
          />

          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Volver
            </Button>
            <Button type="submit" color="green" loading={guardando}>
              Confirmar que volvió a funcionar
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
