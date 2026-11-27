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
import { SelectorMomento } from '../SelectorMomento';
import { validarMomento, momentoAIso, Momento } from '../../lib/fechas';
import { useAccionIntervencion } from './useAccionIntervencion';

export interface ModalIniciarProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  estadoAlAbrir: string;
  fechaCreacion: string;
  tieneResponsable: boolean;
}

export function ModalIniciar({
  abierto,
  onCerrar,
  intervencionId,
  estadoAlAbrir,
  fechaCreacion,
  tieneResponsable,
}: ModalIniciarProps) {
  const isMobile = useMediaQuery('(max-width: 48em)');
  const [momentoAccion, setMomentoAccion] = useState<Momento>({ modo: 'ahora', fecha: null });
  const [observacionTexto, setObservacionTexto] = useState('');

  const { guardando, errorModal, setErrorModal, ejecutar } = useAccionIntervencion({
    intervencionId,
    onCerrar,
    avisoExito: 'Trabajo iniciado.',
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
    const ahora = new Date();
    const errMom = validarMomento(momentoAccion, fechaCreacion, ahora);
    if (errMom) {
      setErrorModal(errMom);
      return;
    }

    const fIniIso = momentoAIso(momentoAccion, fechaCreacion);
    const obsTrim = observacionTexto.trim();

    ejecutar(() =>
      clienteApi.post(`/api/intervenciones/${intervencionId}/iniciar`, {
        estado_esperado: estadoAlAbrir,
        fecha_inicio: fIniIso,
        observacion: obsTrim.length > 0 ? obsTrim : undefined,
      })
    );
  };

  return (
    <Modal
      opened={abierto}
      onClose={() => !guardando && onCerrar()}
      title="Iniciar trabajo"
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

          {!tieneResponsable && (
            <Text size="sm" c="dimmed">
              Vas a quedar como responsable.
            </Text>
          )}

          <SelectorMomento
            label="¿Cuándo empezó?"
            opcionAhoraLabel="Ahora"
            minimo={fechaCreacion}
            value={momentoAccion}
            onChange={setMomentoAccion}
            disabled={guardando}
          />

          <Textarea
            label="Observación (opcional)"
            placeholder="Detalle inicial del trabajo"
            value={observacionTexto}
            onChange={(e) => setObservacionTexto(e.currentTarget.value)}
            disabled={guardando}
          />

          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Volver
            </Button>
            <Button type="submit" color="marca" loading={guardando}>
              Iniciar trabajo
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
