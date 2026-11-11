import React, { useState, useEffect } from 'react';
import {
  Modal,
  Stack,
  Text,
  Textarea,
  Group,
  Button,
  Alert,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { nombreCompleto } from '../../lib/personas';
import type { Persona } from '../../api/tipos';
import { useAccionIntervencion } from './useAccionIntervencion';

export interface ModalDesasignarProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  estadoAlAbrir: string;
  responsableActual?: Persona | null;
}

export function ModalDesasignar({
  abierto,
  onCerrar,
  intervencionId,
  estadoAlAbrir,
  responsableActual,
}: ModalDesasignarProps) {
  const isMobile = useMediaQuery('(max-width: 48em)');
  const [motivoTexto, setMotivoTexto] = useState('');

  const { guardando, errorModal, setErrorModal, ejecutar } = useAccionIntervencion({
    intervencionId,
    onCerrar,
    avisoExito: 'Se quitó el responsable.',
  });

  useEffect(() => {
    if (abierto) {
      setMotivoTexto('');
      setErrorModal(null);
    }
  }, [abierto, setErrorModal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const motivoTrim = motivoTexto.trim();
    if (motivoTrim.length === 0) {
      setErrorModal('Indicá el motivo.');
      return;
    }

    ejecutar(() =>
      clienteApi.delete(`/api/intervenciones/${intervencionId}/responsable`, {
        motivo: motivoTrim,
        estado_esperado: estadoAlAbrir,
      })
    );
  };

  return (
    <Modal
      opened={abierto}
      onClose={() => !guardando && onCerrar()}
      title="Quitar responsable"
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

          <Text size="sm">
            ¿Querés quitar a {responsableActual ? nombreCompleto(responsableActual) : 'la persona responsable'} de esta intervención?
          </Text>

          <Textarea
            label="Motivo"
            maxLength={500}
            placeholder="Indicá el motivo por el cual se quita la responsabilidad"
            value={motivoTexto}
            onChange={(e) => setMotivoTexto(e.currentTarget.value)}
            disabled={guardando}
            required
          />

          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Volver
            </Button>
            <Button type="submit" color="marca" loading={guardando}>
              Quitar responsable
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
