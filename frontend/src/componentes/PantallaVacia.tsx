import React from 'react';
import { Stack, Text, Box, Center } from '@mantine/core';
import { IconInbox } from '@tabler/icons-react';

interface PantallaVaciaProps {
  titulo?: string;
  mensaje?: string;
  icono?: React.ReactNode;
  accion?: React.ReactNode;
}

export function PantallaVacia({
  titulo = 'Sin elementos',
  mensaje,
  icono,
  accion,
}: PantallaVaciaProps) {
  return (
    <Center py="xl">
      <Stack align="center" gap="sm" style={{ textAlign: 'center', maxWidth: 400 }}>
        <Box c="#94a3b8">
          {icono || <IconInbox size={48} stroke={1.5} />}
        </Box>
        <Text fw={600} size="lg" c="#334155">
          {titulo}
        </Text>
        {mensaje && (
          <Text size="sm" c="#64748b">
            {mensaje}
          </Text>
        )}
        {accion && <Box mt="xs">{accion}</Box>}
      </Stack>
    </Center>
  );
}
