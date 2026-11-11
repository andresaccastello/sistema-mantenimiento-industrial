import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Stack, Text, Textarea, Group, Button, Alert } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconInfoCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { LecturaMedidor } from '../../api/tipos';
import { mensajeError } from '../../lib/errores';
import { textoValorMedidor } from '../../lib/medidores';
import { refrescarMedidores } from './refrescar';

interface Props {
  medidorId: number;
  unidad: string;
  /** La lectura que se anula, o null con el diálogo cerrado. */
  lectura: LecturaMedidor | null;
  onCerrar: () => void;
}

/** 3.2 Anular una lectura vigente: pide el motivo, de al menos 5 caracteres. */
export function ModalAnularLectura({ medidorId, unidad, lectura, onCerrar }: Props) {
  const queryClient = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!lectura) return;
    setMotivo('');
    setErrorMotivo(null);
    setError(null);
  }, [lectura?.id]);

  if (!lectura) return null;

  const anular = async () => {
    if (motivo.trim().length < 5) {
      setErrorMotivo('Indicá el motivo (al menos 5 caracteres).');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await clienteApi.post<LecturaMedidor>(`/api/medidores/${medidorId}/lecturas/${lectura.id}/anular`, { motivo: motivo.trim() });
      await refrescarMedidores(queryClient);
      notifications.show({ message: 'Lectura anulada.', color: 'green' });
      onCerrar();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal opened onClose={() => !guardando && onCerrar()} title={`Anular la lectura de ${textoValorMedidor(lectura.valor, unidad)}`}>
      <Stack gap="md">
        <Textarea
          label="Motivo"
          required
          autosize
          minRows={2}
          maxLength={500}
          value={motivo}
          onChange={(e) => {
            setMotivo(e.currentTarget.value);
            setErrorMotivo(null);
          }}
          error={errorMotivo}
          data-autofocus
        />
        <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
          <Text size="sm">Si la usó una tarea hecha, esa tarea conserva su valor.</Text>
        </Alert>
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button color="red" onClick={anular} loading={guardando}>
            Anular
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
