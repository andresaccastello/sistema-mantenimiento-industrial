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
import { useAccionIntervencion } from './useAccionIntervencion';

export interface ModalReanudarProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  estadoAlAbrir: string;
}

export function ModalReanudar({
  abierto,
  onCerrar,
  intervencionId,
  estadoAlAbrir,
}: ModalReanudarProps) {
  const isMobile = useMediaQuery('(max-width: 48em)');
  const [observacionTexto, setObservacionTexto] = useState('');

  const { guardando, errorModal, setErrorModal, ejecutar } = useAccionIntervencion({
    intervencionId,
    onCerrar,
    avisoExito: 'Trabajo reanudado.',
  });

  useEffect(() => {
    if (abierto) {
      setObservacionTexto('');
      setErrorModal(null);
    }
  }, [abierto, setErrorModal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const obsTrim = observacionTexto.trim();

    ejecutar(() =>
      clienteApi.post(`/api/intervenciones/${intervencionId}/reanudar`, {
        estado_esperado: estadoAlAbrir,
        observacion: obsTrim.length > 0 ? obsTrim : undefined,
      })
    );
  };

  return (
    <Modal
      opened={abierto}
      onClose={() => !guardando && onCerrar()}
      title="Reanudar trabajo"
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
            label="Observación (opcional)"
            placeholder="Llegó el rodamiento"
            value={observacionTexto}
            onChange={(e) => setObservacionTexto(e.currentTarget.value)}
            disabled={guardando}
          />

          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Volver
            </Button>
            <Button type="submit" color="marca" loading={guardando}>
              Reanudar
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
