import React, { useState, useEffect } from 'react';
import {
  Modal,
  Stack,
  Textarea,
  Group,
  Button,
  Alert,
  Text,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { SelectorMomento } from '../SelectorMomento';
import { validarMomento, momentoAIso, Momento } from '../../lib/fechas';
import { useAccionIntervencion } from './useAccionIntervencion';

export interface ModalConfirmarRecuperacionProps {
  abierto: boolean;
  onCerrar: () => void;
  maquinaId: number;
  periodos: { id: number; desde: string }[];
}

export function ModalConfirmarRecuperacion({
  abierto,
  onCerrar,
  maquinaId,
  periodos,
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

  const desdeMasReciente =
    periodos.length > 0
      ? periodos.reduce((max, p) =>
          new Date(p.desde).getTime() > new Date(max).getTime() ? p.desde : max
        , periodos[0].desde)
      : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!desdeMasReciente || periodos.length === 0) return;

    const ahora = new Date();
    const errMom = validarMomento(momentoAccion, desdeMasReciente, ahora);
    if (errMom) {
      setErrorModal(errMom);
      return;
    }
    const fRecIso = momentoAIso(momentoAccion, desdeMasReciente);
    const obsTrim = observacionTexto.trim();

    ejecutar(() =>
      clienteApi.post(`/api/maquinas/${maquinaId}/confirmar-recuperacion`, {
        periodo_ids: periodos.map((p) => p.id),
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

          {periodos.length > 1 && (
            <Text size="sm" c="dimmed">
              Se confirman las {periodos.length} detenciones abiertas de esta máquina.
            </Text>
          )}

          {desdeMasReciente && (
            <SelectorMomento
              label="¿Desde cuándo funciona?"
              opcionAhoraLabel="Ahora"
              minimo={desdeMasReciente}
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
