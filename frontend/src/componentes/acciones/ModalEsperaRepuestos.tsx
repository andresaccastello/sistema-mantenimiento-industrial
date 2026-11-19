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
import { IconAlertCircle, IconAlertTriangle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { useAccionIntervencion } from './useAccionIntervencion';

export interface ModalEsperaRepuestosProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  estadoAlAbrir: string;
  /** PC1, 6.1: el texto de arriba, por ejemplo después de cargar un pedido. */
  textoArriba?: string;
  /** PC1, 6.1: el aviso de la máquina parada por esta intervención. */
  avisoMaquina?: string;
  /** PC1, 6.1: la observación precargada. */
  observacionInicial?: string;
  /** Los textos de los botones; sin ellos, "Esperar repuestos" y "Volver". */
  textoConfirmar?: string;
  textoCancelar?: string;
}

export function ModalEsperaRepuestos({
  abierto,
  onCerrar,
  intervencionId,
  estadoAlAbrir,
  textoArriba,
  avisoMaquina,
  observacionInicial,
  textoConfirmar = 'Esperar repuestos',
  textoCancelar = 'Volver',
}: ModalEsperaRepuestosProps) {
  const isMobile = useMediaQuery('(max-width: 48em)');
  const [observacionTexto, setObservacionTexto] = useState('');

  const { guardando, errorModal, setErrorModal, ejecutar } = useAccionIntervencion({
    intervencionId,
    onCerrar,
    avisoExito: 'Quedó esperando repuestos.',
  });

  useEffect(() => {
    if (abierto) {
      setObservacionTexto(observacionInicial ?? '');
      setErrorModal(null);
    }
  }, [abierto, observacionInicial, setErrorModal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const obsTrim = observacionTexto.trim();
    if (obsTrim.length < 5) {
      setErrorModal('Completá la observación (al menos 5 caracteres).');
      return;
    }

    ejecutar(() =>
      clienteApi.post(`/api/intervenciones/${intervencionId}/espera-repuestos`, {
        estado_esperado: estadoAlAbrir,
        observacion: obsTrim,
      })
    );
  };

  return (
    <Modal
      opened={abierto}
      onClose={() => !guardando && onCerrar()}
      title="Esperar repuestos"
      size="md"
      centered
      fullScreen={isMobile}
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          {textoArriba && <Text size="sm">{textoArriba}</Text>}
          {avisoMaquina && (
            <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
              {avisoMaquina}
            </Alert>
          )}
          {errorModal && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              {errorModal}
            </Alert>
          )}

          <Textarea
            label="¿Qué falta?"
            placeholder="Rodamiento 6204, pedido al proveedor"
            value={observacionTexto}
            onChange={(e) => setObservacionTexto(e.currentTarget.value)}
            disabled={guardando}
            required
          />

          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              {textoCancelar}
            </Button>
            <Button type="submit" color="marca" loading={guardando}>
              {textoConfirmar}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
