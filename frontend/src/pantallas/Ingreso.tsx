import React, { useState } from 'react';
import {
  Card,
  TextInput,
  PasswordInput,
  Button,
  Title,
  Text,
  Stack,
  Center,
  Alert,
  Image,
  Box,
} from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { clienteApi } from '../api/cliente';
import { ApiError, mensajeError } from '../lib/errores';
import type { ConfiguracionPublica, LoginResponse } from '../api/tipos';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000';

export function Ingreso() {
  const [legajo, setLegajo] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const { ingresar, usuario } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const { data: config } = useQuery<ConfiguracionPublica>({
    queryKey: ['configuracion-publica'],
    queryFn: () => clienteApi.get<ConfiguracionPublica>('/api/configuracion/publica'),
    staleTime: 1000 * 60 * 10,
  });

  // Si ya tiene sesión activa y no debe cambiar password, va a inicio
  React.useEffect(() => {
    if (usuario && !usuario.debe_cambiar_password) {
      navigate('/', { replace: true });
    }
  }, [usuario, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setEnviando(true);

    try {
      const res = await clienteApi.post<LoginResponse>('/api/auth/login', {
        legajo: legajo.trim(),
        password,
      });

      if (res.token) {
        await ingresar(res.token, Boolean(res.debe_cambiar_password));

        if (res.debe_cambiar_password) {
          navigate('/cambiar-password', { replace: true });
        } else {
          const from = (location.state as any)?.from?.pathname || '/';
          navigate(from, { replace: true });
        }
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && err.codigo === 'CREDENCIALES_INVALIDAS') {
        setErrorMsg('Legajo o contraseña incorrectos.');
      } else {
        setErrorMsg(mensajeError(err));
      }
    } finally {
      setEnviando(false);
    }
  };

  const nombreSistema = config?.nombre_sistema || 'Sistema de Mantenimiento Industrial';
  const nombreEmpresa = config?.nombre_empresa;
  const tieneLogo = config?.tiene_logo;

  return (
    <Center style={{ minHeight: '100vh', background: '#f8fafc', padding: '1.5rem' }}>
      <Card
        withBorder
        radius="sm"
        padding="xl"
        style={{
          width: '100%',
          maxWidth: 420,
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
        }}
      >
        <Stack gap="lg">
          <Box ta="center">
            {tieneLogo && (
              <Center mb="xs">
                <Image
                  src={`${BASE_URL}/api/configuracion/logo`}
                  alt="Logo"
                  h={40}
                  w="auto"
                  fit="contain"
                />
              </Center>
            )}
            {nombreEmpresa && (
              <Text size="sm" c="#64748b" fw={500}>
                {nombreEmpresa}
              </Text>
            )}
            <Title order={2} style={{ fontSize: '1.35rem', fontWeight: 600, color: '#0f172a' }}>
              {nombreSistema}
            </Title>
          </Box>

          {errorMsg && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="red"
              variant="light"
              title="Error al ingresar"
            >
              {errorMsg}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <TextInput
                label="Legajo"
                placeholder="Ej: admin o número de legajo"
                value={legajo}
                onChange={(e) => setLegajo(e.currentTarget.value)}
                required
                autoFocus
                disabled={enviando}
              />

              <PasswordInput
                label="Contraseña"
                placeholder="Tu contraseña"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
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
                Ingresar
              </Button>
            </Stack>
          </form>
        </Stack>
      </Card>
    </Center>
  );
}
