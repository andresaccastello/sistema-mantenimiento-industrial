import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Stack, Text, Group, Button, Alert } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { MedidorDetalle, MedidorLista } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import { refrescarMedidores } from './refrescar';

interface Props {
  /** El medidor que se desactiva o reactiva, o null con el diálogo cerrado. */
  medidor: MedidorLista | null;
  onCerrar: () => void;
}

/** 3.2 Desactivar o reactivar un medidor, con confirmación. */
export function ModalActivoMedidor({ medidor, onCerrar }: Props) {
  const queryClient = useQueryClient();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (medidor) setError(null);
  }, [medidor?.id]);

  if (!medidor) return null;
  const desactivar = medidor.activo;

  const confirmar = async () => {
    setGuardando(true);
    setError(null);
    try {
      await clienteApi.post<MedidorDetalle>(`/api/medidores/${medidor.id}/${desactivar ? 'desactivar' : 'reactivar'}`, {});
      await refrescarMedidores(queryClient);
      notifications.show({ message: desactivar ? 'Medidor desactivado.' : 'Medidor reactivado.', color: 'green' });
      onCerrar();
    } catch (err) {
      if (err instanceof ApiError && err.codigo === 'MEDIDOR_EN_USO') {
        setError('Lo usan tareas activas: desactivalas o cambiales el medidor primero.');
      } else {
        setError(mensajeError(err));
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      opened
      onClose={() => !guardando && onCerrar()}
      title={desactivar ? `Desactivar ${medidor.nombre}` : `Reactivar ${medidor.nombre}`}
    >
      <Stack gap="md">
        <Text size="sm">
          {desactivar
            ? 'No se van a poder cargar lecturas ni usarlo en tareas nuevas. Las lecturas que tiene quedan.'
            : 'Se vuelven a poder cargar lecturas y usarlo en las tareas.'}
        </Text>
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button color={desactivar ? 'red' : 'marca'} onClick={confirmar} loading={guardando}>
            {desactivar ? 'Desactivar' : 'Reactivar'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
