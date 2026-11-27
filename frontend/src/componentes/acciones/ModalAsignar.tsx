import React, { useState, useEffect } from 'react';
import {
  Modal,
  Stack,
  Select,
  Textarea,
  Group,
  Button,
  Alert,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertCircle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { clienteApi } from '../../api/cliente';
import { nombreCompleto } from '../../lib/personas';
import type { Persona } from '../../api/tipos';
import { useAccionIntervencion } from './useAccionIntervencion';

export interface ModalAsignarProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  estadoAlAbrir: string;
  responsableActual?: Persona | null;
}

export function ModalAsignar({
  abierto,
  onCerrar,
  intervencionId,
  estadoAlAbrir,
  responsableActual,
}: ModalAsignarProps) {
  const isMobile = useMediaQuery('(max-width: 48em)');
  const tieneResponsable = Boolean(responsableActual);

  const [destinatarioUsuarioId, setDestinatarioUsuarioId] = useState<string | null>(null);
  const [motivoTexto, setMotivoTexto] = useState('');

  const { guardando, errorModal, setErrorModal, ejecutar } = useAccionIntervencion({
    intervencionId,
    onCerrar,
    avisoExito: 'Responsable asignado.',
  });

  const { data: responsablesHabilitados, isLoading: cargandoResponsables } = useQuery<Persona[]>({
    queryKey: ['responsables-habilitados', intervencionId],
    queryFn: () => clienteApi.get<Persona[]>(`/api/intervenciones/${intervencionId}/responsables-habilitados`),
    enabled: abierto,
  });

  useEffect(() => {
    if (abierto) {
      setDestinatarioUsuarioId(null);
      setMotivoTexto('');
      setErrorModal(null);
    }
  }, [abierto, setErrorModal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!destinatarioUsuarioId) {
      setErrorModal('Seleccioná a la persona responsable.');
      return;
    }
    const motivoTrim = motivoTexto.trim();
    if (tieneResponsable && motivoTrim.length === 0) {
      setErrorModal('Indicá el motivo.');
      return;
    }

    ejecutar(() =>
      clienteApi.put(`/api/intervenciones/${intervencionId}/responsable`, {
        usuario_id: Number(destinatarioUsuarioId),
        motivo: motivoTrim.length > 0 ? motivoTrim : undefined,
        estado_esperado: estadoAlAbrir,
      })
    );
  };

  return (
    <Modal
      opened={abierto}
      onClose={() => !guardando && onCerrar()}
      title={tieneResponsable ? 'Reasignar responsable' : 'Asignar responsable'}
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

          <Select
            label="Responsable"
            placeholder={cargandoResponsables ? 'Cargando personas...' : 'Elegir responsable'}
            data={(responsablesHabilitados || [])
              .filter((u) => u.id !== responsableActual?.id)
              .map((u) => ({
                value: String(u.id),
                label: `${nombreCompleto(u)} · ${u.legajo}`,
              }))}
            value={destinatarioUsuarioId}
            onChange={setDestinatarioUsuarioId}
            disabled={guardando || cargandoResponsables}
            nothingFoundMessage="No hay personas habilitadas para esta máquina."
          />

          <Textarea
            label={`Motivo${tieneResponsable ? '' : ' (opcional)'}`}
            maxLength={500}
            placeholder="Explicá el motivo de la asignación"
            value={motivoTexto}
            onChange={(e) => setMotivoTexto(e.currentTarget.value)}
            disabled={guardando}
          />

          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Volver
            </Button>
            <Button
              type="submit"
              color="marca"
              loading={guardando}
              disabled={cargandoResponsables || !destinatarioUsuarioId}
            >
              {tieneResponsable ? 'Reasignar' : 'Asignar'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
