import React from 'react';
import { Card, Text, Stack, Button, ThemeIcon } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { EncabezadoPagina } from './EncabezadoPagina';

interface SinPermisoProps {
  permisoRequerido?: string;
}

export function SinPermiso({ permisoRequerido }: SinPermisoProps) {
  const navigate = useNavigate();

  return (
    <>
      <EncabezadoPagina titulo="Acceso restringido" />
      <Card padding="xl" radius="sm" withBorder>
        <Stack align="center" gap="md" py="xl">
          <ThemeIcon size={56} radius="xl" color="red" variant="light">
            <IconLock size={28} />
          </ThemeIcon>
          <Text size="lg" fw={600} c="#1e293b">
            Sin permiso suficiente
          </Text>
          <Text size="sm" c="#64748b" ta="center" maw={450}>
            No tenés los permisos requeridos para acceder a esta pantalla
            {permisoRequerido ? ` (${permisoRequerido})` : ''}.
          </Text>
          <Button variant="default" onClick={() => navigate('/')} mt="sm">
            Volver al inicio
          </Button>
        </Stack>
      </Card>
    </>
  );
}
