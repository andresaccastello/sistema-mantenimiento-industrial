import React from 'react';
import {
  Card,
  Stack,
  Group,
  Text,
  Badge,
  Button,
  Divider,
  Box,
} from '@mantine/core';
import { IconKey, IconLogout, IconUser } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { EncabezadoPagina } from '../componentes/EncabezadoPagina';

export function MiCuenta() {
  const { usuario, salir } = useAuth();
  const navigate = useNavigate();

  const nombreCompleto = usuario
    ? `${usuario.nombre} ${usuario.apellido}`.trim()
    : 'Usuario';

  return (
    <>
      <EncabezadoPagina
        titulo="Mi cuenta"
        subtitulo="Información personal y configuración de acceso"
      />

      <Card withBorder radius="sm" padding="xl" maw={600}>
        <Stack gap="lg">
          <Group gap="md">
            <Box
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                backgroundColor: '#ecfdf5',
                color: '#059669',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconUser size={26} />
            </Box>
            <Stack gap={2}>
              <Text fw={600} size="lg" c="#0f172a">
                {nombreCompleto}
              </Text>
              <Text size="sm" c="#64748b">
                Legajo: {usuario?.legajo || '—'}
              </Text>
            </Stack>
          </Group>

          <Divider />

          <Stack gap="xs">
            <Text size="sm" fw={500} c="#475569">
              Perfil asignado
            </Text>
            <Box>
              <Badge color="marca" variant="light" size="md">
                {usuario?.perfil?.nombre || 'Sin perfil'}
              </Badge>
            </Box>
          </Stack>

          <Stack gap="xs">
            <Text size="sm" fw={500} c="#475569">
              Sectores autorizados
            </Text>
            <Group gap="xs" wrap="wrap">
              {usuario?.sectores && usuario.sectores.length > 0 ? (
                usuario.sectores.map((s) => (
                  <Badge key={s.id} color="gray" variant="outline" size="sm">
                    {s.nombre}
                  </Badge>
                ))
              ) : (
                <Text size="sm" c="#94a3b8">
                  Sin sectores asignados
                </Text>
              )}
            </Group>
          </Stack>

          <Divider />

          <Group justify="space-between" mt="sm" wrap="wrap" gap="sm">
            <Button
              variant="default"
              leftSection={<IconKey size={16} />}
              onClick={() => navigate('/cambiar-password')}
            >
              Cambiar contraseña
            </Button>

            <Button
              variant="subtle"
              color="red"
              leftSection={<IconLogout size={16} />}
              onClick={salir}
            >
              Salir
            </Button>
          </Group>
        </Stack>
      </Card>
    </>
  );
}
