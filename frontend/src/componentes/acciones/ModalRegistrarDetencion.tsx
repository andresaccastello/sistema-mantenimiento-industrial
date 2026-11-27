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
import { useAccionIntervencion } from './useAccionIntervencion';

export interface ModalRegistrarDetencionProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  estadoAlAbrir: string;
  fechaCreacion: string;
}

export function ModalRegistrarDetencion({
  abierto,
  onCerrar,
  intervencionId,
  estadoAlAbrir,
  fechaCreacion,
}: ModalRegistrarDetencionProps) {
  const isMobile = useMediaQuery('(max-width: 48em)');

  const [momentoAccion, setMomentoAccion] = useState<Momento>({ modo: 'ahora', fecha: null });
  const [observacionTexto, setObservacionTexto] = useState('');

  const { guardando, errorModal, setErrorModal, ejecutar } = useAccionIntervencion({
    intervencionId,
    onCerrar,
    avisoExito: 'Detención registrada.',
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
    const desdeIso = momentoAIso(momentoAccion, fechaCreacion);

    const obsTrim = observacionTexto.trim();
    if (obsTrim.length < 5) {
      setErrorModal('Completá qué pasó (al menos 5 caracteres).');
      return;
    }

    ejecutar(() =>
      clienteApi.post(`/api/intervenciones/${intervencionId}/registrar-detencion`, {
        estado_esperado: estadoAlAbrir,
        desde: desdeIso,
        observacion: obsTrim,
      })
    );
  };

  return (
    <Modal
      opened={abierto}
      onClose={() => !guardando && onCerrar()}
      title="Registrar detención"
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

          <SelectorMomento
            label="¿Desde cuándo está detenida?"
            opcionAhoraLabel="Ahora"
            minimo={fechaCreacion}
            value={momentoAccion}
            onChange={setMomentoAccion}
            disabled={guardando}
          />

          <Textarea
            label="Qué pasó"
            placeholder="Se paró al volver a arrancarla"
            value={observacionTexto}
            onChange={(e) => setObservacionTexto(e.currentTarget.value)}
            disabled={guardando}
            required
          />

          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Volver
            </Button>
            <Button type="submit" color="marca" loading={guardando}>
              Registrar detención
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
