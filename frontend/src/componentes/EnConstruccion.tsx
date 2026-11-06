import React from 'react';
import { Card, Text, Stack, ThemeIcon } from '@mantine/core';
import { IconTool } from '@tabler/icons-react';
import { EncabezadoPagina } from './EncabezadoPagina';

interface EnConstruccionProps {
  titulo: string;
  etapa: string;
  subtitulo?: string;
}

export function EnConstruccion({ titulo, etapa, subtitulo }: EnConstruccionProps) {
  return (
    <>
      <EncabezadoPagina titulo={titulo} subtitulo={subtitulo} />
      <Card padding="xl" radius="sm" withBorder>
        <Stack align="center" gap="md" py="xl">
          <ThemeIcon size={56} radius="xl" color="marca" variant="light">
            <IconTool size={28} />
          </ThemeIcon>
          <Text size="lg" fw={500} c="#1e293b">
            Esta pantalla se construye en la etapa {etapa}
          </Text>
          <Text size="sm" c="#64748b" ta="center" maw={450}>
            La navegación y permisos correspondientes ya se encuentran operativos en la etapa base.
          </Text>
        </Stack>
      </Card>
    </>
  );
}
