import React from 'react';
import { Group, Stack, Title, Text, Box } from '@mantine/core';

interface EncabezadoPaginaProps {
  titulo: string;
  subtitulo?: string;
  acciones?: React.ReactNode;
}

export function EncabezadoPagina({ titulo, subtitulo, acciones }: EncabezadoPaginaProps) {
  return (
    <Box mb="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <Stack gap={4}>
          <Title order={2} c="#0f172a" style={{ fontWeight: 600, fontSize: '1.5rem' }}>
            {titulo}
          </Title>
          {subtitulo && (
            <Text size="sm" c="#64748b">
              {subtitulo}
            </Text>
          )}
        </Stack>
        {acciones && <Group gap="xs">{acciones}</Group>}
      </Group>
    </Box>
  );
}
