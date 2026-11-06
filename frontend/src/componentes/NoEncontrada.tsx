import React from 'react';
import { Card, Text, Stack, Button, ThemeIcon, Container } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { EncabezadoPagina } from './EncabezadoPagina';

export function NoEncontrada() {
  const navigate = useNavigate();

  return (
    <Container size="sm" py="xl">
      <EncabezadoPagina titulo="Página no encontrada" />
      <Card padding="xl" radius="sm" withBorder>
        <Stack align="center" gap="md" py="xl">
          <ThemeIcon size={56} radius="xl" color="gray" variant="light">
            <IconAlertCircle size={28} />
          </ThemeIcon>
          <Text size="lg" fw={600} c="#1e293b">
            La página que buscás no existe o fue movida
          </Text>
          <Text size="sm" c="#64748b" ta="center" maw={450}>
            Verificá la dirección ingresada o regresá al inicio del sistema.
          </Text>
          <Button variant="default" onClick={() => navigate('/')} mt="sm">
            Ir al inicio
          </Button>
        </Stack>
      </Card>
    </Container>
  );
}
