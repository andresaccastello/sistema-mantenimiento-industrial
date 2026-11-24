import { useEffect, useState } from 'react';
import { Button, Group, Stack, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import type { EmailPropio } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { mensajeError } from '../../lib/errores';

/** Mi cuenta: cada usuario carga su propio email. Vacío se guarda como null. */
export function EmailCuenta() {
  const { usuario, recargarUsuario } = useAuth();
  const actual = usuario?.email ?? '';
  const [valor, setValor] = useState(actual);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValor(actual);
  }, [actual]);

  const sinCambios = valor.trim().toLowerCase() === actual;

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const limpio = valor.trim();
      await clienteApi.patch<EmailPropio>('/api/auth/email', { email: limpio === '' ? null : limpio });
      await recargarUsuario();
      notifications.show({ message: 'Email guardado', color: 'green', autoClose: 2000 });
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Stack gap="xs">
      <TextInput
        label="Email"
        description="Acá te llegan los avisos por email"
        placeholder="nombre@empresa.com"
        type="email"
        value={valor}
        onChange={(e) => {
          setValor(e.currentTarget.value);
          setError(null);
        }}
        error={error}
        disabled={guardando}
      />
      <Group justify="flex-end">
        <Button onClick={guardar} loading={guardando} disabled={sinCambios}>
          Guardar
        </Button>
      </Group>
    </Stack>
  );
}
