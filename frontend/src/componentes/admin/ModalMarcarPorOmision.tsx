import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  Text,
  Group,
  Button,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { mensajeError } from '../../lib/errores';

export interface ModalMarcarPorOmisionProps {
  abierto: boolean;
  onCerrar: () => void;
  entidad: 'criticidad' | 'tipo';
  id: number | null;
  nombre: string;
}

export function ModalMarcarPorOmision({
  abierto,
  onCerrar,
  entidad,
  id,
  nombre,
}: ModalMarcarPorOmisionProps) {
  const queryClient = useQueryClient();
  const esCelular = useMediaQuery('(max-width: 48em)');
  const [guardando, setGuardando] = useState(false);

  if (!id) return null;

  const handleConfirmar = async () => {
    setGuardando(true);
    const basePath = entidad === 'criticidad' ? '/api/criticidades' : '/api/tipos-equipo';
    const cacheKey = entidad === 'criticidad' ? 'criticidades' : 'tipos-equipo';

    try {
      await clienteApi.put(`${basePath}/${id}`, { por_omision: true });
      notifications.show({
        message: 'Marcado por omisión.',
        color: 'green',
      });
      await queryClient.invalidateQueries({ queryKey: [cacheKey] });
      await queryClient.invalidateQueries({ queryKey: ['maquinas'] });
      onCerrar();
    } catch (err: any) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title="Marcar por omisión"
      fullScreen={esCelular}
      size="sm"
    >
      <Stack gap="md">
        <Text size="sm">
          ¿Querés marcar <b>{nombre}</b> como el valor por omisión?
        </Text>
        <Text size="sm" c="dimmed">
          Las máquinas nuevas van a tomar este valor si no se elige otro.
        </Text>

        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={handleConfirmar} loading={guardando}>
            Confirmar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

