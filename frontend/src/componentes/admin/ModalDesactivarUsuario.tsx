import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  Text,
  Textarea,
  Alert,
  Group,
  Button,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { UsuarioDetalleAdmin } from '../../api/tipos';
import { validarMotivo } from '../../lib/usuarios';
import { ApiError, mensajeError } from '../../lib/errores';

export interface ModalDesactivarUsuarioProps {
  abierto: boolean;
  onCerrar: () => void;
  usuario: UsuarioDetalleAdmin | null;
}

export function ModalDesactivarUsuario({
  abierto,
  onCerrar,
  usuario,
}: ModalDesactivarUsuarioProps) {
  const queryClient = useQueryClient();
  const esCelular = useMediaQuery('(max-width: 48em)');

  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [errorAlerta, setErrorAlerta] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (abierto) {
      setMotivo('');
      setErrorMotivo(null);
      setErrorAlerta(null);
    }
  }, [abierto]);

  if (!usuario) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMotivo(null);
    setErrorAlerta(null);

    const errMot = validarMotivo(motivo);
    if (errMot) {
      setErrorMotivo(errMot);
      return;
    }

    setGuardando(true);
    try {
      await clienteApi.post(`/api/usuarios/${usuario.id}/desactivar`, {
        motivo: motivo.trim(),
      });

      notifications.show({ message: 'Usuario desactivado.', color: 'green' });
      await queryClient.invalidateQueries({ queryKey: ['usuario', usuario.id] });
      await queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      await queryClient.invalidateQueries({ queryKey: ['perfiles'] });
      onCerrar();
    } catch (err: any) {
      if (err instanceof ApiError && err.codigo === 'ULTIMO_ADMINISTRADOR') {
        setErrorAlerta(mensajeError(err));
        await queryClient.invalidateQueries({ queryKey: ['usuarios'] });
        await queryClient.invalidateQueries({ queryKey: ['usuario', usuario.id] });
        return;
      }
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  const n = usuario.intervenciones_abiertas_como_responsable ?? 0;
  const textoIntervenciones =
    n === 1
      ? 'Es responsable de 1 intervención abierta. Sigue a su nombre hasta que alguien la reasigne.'
      : `Es responsable de ${n} intervenciones abiertas. Siguen a su nombre hasta que alguien las reasigne.`;

  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title="Desactivar usuario"
      fullScreen={esCelular}
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          {errorAlerta && (
            <Alert color="red" icon={<IconAlertCircle size={16} />}>
              {errorAlerta}
            </Alert>
          )}

          {n > 0 && (
            <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
              {textoIntervenciones}
            </Alert>
          )}

          <Text size="sm">
            No va a poder entrar al sistema. Se cierran las sesiones que tenga abiertas. Su historial se conserva.
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
            <Button color="red" type="submit" loading={guardando}>
              Desactivar
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

