import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  Text,
  Alert,
  Group,
  Button,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { mensajeError } from '../../lib/errores';

export interface ModalReactivarElementoProps {
  abierto: boolean;
  onCerrar: () => void;
  tipo: 'sector' | 'planta' | 'criticidad' | 'tipo_equipo';
  id: number | null;
  nombre: string;
}

export function ModalReactivarElemento({
  abierto,
  onCerrar,
  tipo,
  id,
  nombre,
}: ModalReactivarElementoProps) {
  const queryClient = useQueryClient();
  const esCelular = useMediaQuery('(max-width: 48em)');
  const [guardando, setGuardando] = useState(false);
  const [errorAlerta, setErrorAlerta] = useState<string | null>(null);

  useEffect(() => {
    if (abierto) {
      setErrorAlerta(null);
    }
  }, [abierto]);

  if (!id) return null;

  const handleReactivar = async () => {
    setErrorAlerta(null);
    setGuardando(true);

    try {
      if (tipo === 'sector') {
        await clienteApi.put(`/api/sectores/${id}`, { activo: true });
        await queryClient.invalidateQueries({ queryKey: ['sectores'] });
        await queryClient.invalidateQueries({ queryKey: ['plantas'] });
      } else if (tipo === 'planta') {
        await clienteApi.put(`/api/plantas/${id}`, { activo: true });
        await queryClient.invalidateQueries({ queryKey: ['plantas'] });
        await queryClient.invalidateQueries({ queryKey: ['sectores'] });
      } else if (tipo === 'criticidad') {
        await clienteApi.put(`/api/criticidades/${id}`, { activo: true });
        await queryClient.invalidateQueries({ queryKey: ['criticidades'] });
        await queryClient.invalidateQueries({ queryKey: ['maquinas'] });
      } else if (tipo === 'tipo_equipo') {
        await clienteApi.put(`/api/tipos-equipo/${id}`, { activo: true });
        await queryClient.invalidateQueries({ queryKey: ['tipos-equipo'] });
        await queryClient.invalidateQueries({ queryKey: ['maquinas'] });
      }

      notifications.show({
        message: `${nombre} fue reactivado.`,
        color: 'green',
      });
      onCerrar();
    } catch (err: any) {
      setErrorAlerta(mensajeError(err));
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  const getTitulo = () => {
    if (tipo === 'sector') return 'Reactivar sector';
    if (tipo === 'planta') return 'Reactivar planta';
    if (tipo === 'criticidad') return 'Reactivar criticidad';
    return 'Reactivar tipo de equipo';
  };

  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title={getTitulo()}
      fullScreen={esCelular}
      size="md"
    >
      <Stack gap="md">
        {errorAlerta && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {errorAlerta}
          </Alert>
        )}

        <Text size="sm">
          ¿Querés reactivar <b>{nombre}</b> para que vuelva a estar disponible en el sistema?
        </Text>

        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={handleReactivar} loading={guardando}>
            Reactivar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

