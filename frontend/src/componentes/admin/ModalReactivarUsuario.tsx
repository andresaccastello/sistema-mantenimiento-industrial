import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  Text,
  Textarea,
  Group,
  Button,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { UsuarioDetalleAdmin } from '../../api/tipos';
import { validarMotivo } from '../../lib/usuarios';
import { mensajeError } from '../../lib/errores';

export interface ModalReactivarUsuarioProps {
  abierto: boolean;
  onCerrar: () => void;
  usuario: UsuarioDetalleAdmin | null;
}

export function ModalReactivarUsuario({
  abierto,
  onCerrar,
  usuario,
}: ModalReactivarUsuarioProps) {
  const queryClient = useQueryClient();
  const esCelular = useMediaQuery('(max-width: 48em)');

  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (abierto) {
      setMotivo('');
      setErrorMotivo(null);
    }
  }, [abierto]);

  if (!usuario) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMotivo(null);

    const errMot = validarMotivo(motivo);
    if (errMot) {
      setErrorMotivo(errMot);
      return;
    }

    setGuardando(true);
    try {
      await clienteApi.post(`/api/usuarios/${usuario.id}/reactivar`, {
        motivo: motivo.trim(),
      });

      notifications.show({ message: 'Usuario reactivado.', color: 'green' });
      await queryClient.invalidateQueries({ queryKey: ['usuario', usuario.id] });
      await queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      await queryClient.invalidateQueries({ queryKey: ['perfiles'] });
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
      title="Reactivar usuario"
      fullScreen={esCelular}
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <Text size="sm">
            El usuario volverá a estar habilitado para ingresar al sistema con su perfil y permisos actuales.
          </Text>

          <Textarea
            label="Motivo"
            maxLength={500}
            placeholder="Indicá el motivo (al menos 5 caracteres)"
            value={motivo}
            onChange={(e) => setMotivo(e.currentTarget.value)}
            required
            error={errorMotivo}
            minRows={3}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" loading={guardando}>
              Reactivar
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

