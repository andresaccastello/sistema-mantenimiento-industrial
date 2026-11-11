import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Stack, Text, Group, Button, Alert } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { PlanDetalle } from '../../api/tipos';
import { mensajeError } from '../../lib/errores';

interface Props {
  plan: PlanDetalle;
  abierto: boolean;
  onCerrar: () => void;
}

/** P2: desactivar o reactivar el plan, con confirmación. */
export function ModalActivoPlan({ plan, abierto, onCerrar }: Props) {
  const queryClient = useQueryClient();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desactivar = plan.activo;

  const confirmar = async () => {
    setGuardando(true);
    setError(null);
    try {
      await clienteApi.post<PlanDetalle>(`/api/planes/${plan.id}/${desactivar ? 'desactivar' : 'reactivar'}`, {});
      for (const clave of [['plan'], ['planes'], ['vencimientos'], ['tablero']]) {
        await queryClient.invalidateQueries({ queryKey: clave });
      }
      notifications.show({ message: desactivar ? 'Plan desactivado.' : 'Plan reactivado.', color: 'green' });
      onCerrar();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal opened={abierto} onClose={onCerrar} title={desactivar ? 'Desactivar el plan' : 'Reactivar el plan'}>
      <Stack gap="md">
        <Text size="sm">
          {desactivar
            ? 'Las tareas no van a aparecer en los vencimientos ni se van a poder generar.'
            : 'Las tareas activas vuelven a aparecer en los vencimientos y se pueden generar.'}
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
