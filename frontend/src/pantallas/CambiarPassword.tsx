import React, { useState } from 'react';
import {
  Card,
  PasswordInput,
  Button,
  Stack,
  Alert,
  Container,
} from '@mantine/core';
import { IconAlertCircle, IconInfoCircle } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { notifications } from '@mantine/notifications';
import { useAuth } from '../auth/AuthContext';
import { clienteApi } from '../api/cliente';
import { ApiError, mensajeError } from '../lib/errores';
import { guardarToken } from '../auth/sesion';
import { EncabezadoPagina } from '../componentes/EncabezadoPagina';
import type { CambiarPasswordResponse } from '../api/tipos';

export function CambiarPassword() {
  const [passwordActual, setPasswordActual] = useState('');
  const [passwordNueva, setPasswordNueva] = useState('');
  const [passwordRepetir, setPasswordRepetir] = useState('');

  const [errorActual, setErrorActual] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const { usuario, recargarUsuario } = useAuth();
  const navigate = useNavigate();

  const esObligatorio = Boolean(usuario?.debe_cambiar_password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorActual(null);
    setErrorGeneral(null);

    // Validación en pantalla
    if (passwordNueva.length < 8) {
      setErrorGeneral('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }

    if (passwordNueva !== passwordRepetir) {
      setErrorGeneral('Las contraseñas nuevas no coinciden.');
      return;
    }

    setEnviando(true);

    try {
      const res = await clienteApi.post<CambiarPasswordResponse>('/api/auth/cambiar-password', {
        password_actual: passwordActual,
        password_nueva: passwordNueva,
      });

      if (res.token) {
        guardarToken(res.token);
      }

      await recargarUsuario();

      notifications.show({
        color: 'green',
        title: 'Éxito',
        message: 'Contraseña actualizada',
      });

      navigate('/', { replace: true });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.codigo === 'CREDENCIALES_INVALIDAS') {
          setErrorActual('La contraseña actual es incorrecta.');
        } else {
          setErrorGeneral(mensajeError(err));
        }
      } else {
        setErrorGeneral(mensajeError(err));
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Container size="xs" py="md">
      <EncabezadoPagina
        titulo="Cambiar contraseña"
        subtitulo={
          esObligatorio
            ? 'Por seguridad, tenés que cambiar la contraseña temporal antes de continuar.'
            : 'Modificá tu contraseña de acceso al sistema'
        }
      />

      <Card withBorder radius="sm" padding="xl">
        <Stack gap="lg">
          {esObligatorio && (
            <Alert
              icon={<IconInfoCircle size={16} />}
              color="yellow"
              variant="light"
            >
              Por seguridad, tenés que cambiar la contraseña temporal antes de continuar.
            </Alert>
          )}

          {errorGeneral && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="red"
              variant="light"
            >
              {errorGeneral}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <PasswordInput
                label="Contraseña actual"
                placeholder="Tu contraseña actual o temporal"
                value={passwordActual}
                onChange={(e) => {
                  setPasswordActual(e.currentTarget.value);
                  setErrorActual(null);
                }}
                error={errorActual}
                required
                disabled={enviando}
                autoFocus
              />

              <PasswordInput
                label="Nueva contraseña"
                placeholder="Mínimo 8 caracteres"
                value={passwordNueva}
                onChange={(e) => setPasswordNueva(e.currentTarget.value)}
                required
                disabled={enviando}
              />

              <PasswordInput
                label="Repetir nueva contraseña"
                placeholder="Repetí la nueva contraseña"
                value={passwordRepetir}
                onChange={(e) => setPasswordRepetir(e.currentTarget.value)}
                required
                disabled={enviando}
              />

              <Button
                type="submit"
                fullWidth
                loading={enviando}
                color="marca"
                mt="xs"
              >
                Actualizar contraseña
              </Button>
            </Stack>
          </form>
        </Stack>
      </Card>
    </Container>
  );
}
