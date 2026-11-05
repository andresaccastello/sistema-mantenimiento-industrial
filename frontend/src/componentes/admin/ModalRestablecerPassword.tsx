import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  PasswordInput,
  Text,
  Group,
  Button,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { UsuarioDetalleAdmin } from '../../api/tipos';
import { validarPasswordTemporal } from '../../lib/usuarios';
import { ApiError, mensajeError } from '../../lib/errores';

export interface ModalRestablecerPasswordProps {
  abierto: boolean;
  onCerrar: () => void;
  usuario: UsuarioDetalleAdmin | null;
}

export function ModalRestablecerPassword({
  abierto,
  onCerrar,
  usuario,
}: ModalRestablecerPasswordProps) {
  const queryClient = useQueryClient();
  const esCelular = useMediaQuery('(max-width: 48em)');

  const [passwordTemporal, setPasswordTemporal] = useState('');
  const [errorPassword, setErrorPassword] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (abierto) {
      setPasswordTemporal('');
      setErrorPassword(null);
    }
  }, [abierto]);

  if (!usuario) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorPassword(null);

    const errPass = validarPasswordTemporal(passwordTemporal, usuario.legajo);
    if (errPass) {
      setErrorPassword(errPass);
      return;
    }

    setGuardando(true);
    try {
      await clienteApi.post(`/api/usuarios/${usuario.id}/restablecer-password`, {
        password_temporal: passwordTemporal,
      });

      notifications.show({ message: 'Contraseña restablecida.', color: 'green' });
      await queryClient.invalidateQueries({ queryKey: ['usuario', usuario.id] });
      await queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      onCerrar();
    } catch (err: any) {
      if (err instanceof ApiError && err.codigo === 'PASSWORD_INVALIDA') {
        setErrorPassword(mensajeError(err));
        return;
      }
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title="Restablecer contraseña"
      fullScreen={esCelular}
      size="sm"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <Text size="sm">
            La persona va a tener que cambiarla al entrar. Se cierran las sesiones que tenga abiertas.
          </Text>

          <PasswordInput
            label="Contraseña temporal"
            placeholder="Al menos 8 caracteres"
            value={passwordTemporal}
            onChange={(e) => setPasswordTemporal(e.currentTarget.value)}
            required
            error={errorPassword}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" loading={guardando}>
              Restablecer
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

