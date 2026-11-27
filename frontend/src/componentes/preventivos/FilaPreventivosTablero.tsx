import React from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Stack, Text, SimpleGrid, Card, Group, ThemeIcon, Skeleton } from '@mantine/core';
import { IconAlertTriangle, IconClock, IconTool } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { EstadoVencimiento, VencimientosRespuesta } from '../../api/tipos';
import { obtenerInfoEstado } from '../../lib/estados';
import { escribirFiltrosPreventivos, leerFiltrosPreventivos } from '../../lib/preventivos';

const TARJETAS: Array<{
  estado: EstadoVencimiento;
  etiqueta: string;
  clave: keyof VencimientosRespuesta['resumen'];
  Icono: React.ComponentType<{ size?: number }>;
}> = [
  { estado: 'VENCIDA', etiqueta: 'Vencidas', clave: 'vencidas', Icono: IconAlertTriangle },
  { estado: 'PROXIMA', etiqueta: 'Próximas', clave: 'proximas', Icono: IconClock },
  { estado: 'EN_CURSO', etiqueta: 'En curso', clave: 'en_curso', Icono: IconTool },
];

/** R1: la fila "Preventivos" del tablero, con la planta elegida (PV2, 5.1). */
export function FilaPreventivosTablero({ plantaId }: { plantaId: number | null }) {
  const { data, isPending } = useQuery({
    queryKey: ['tablero', 'preventivos', { plantaId }],
    queryFn: () =>
      clienteApi.get<VencimientosRespuesta>('/api/planes/vencimientos', {
        params: { limit: 1, planta_id: plantaId },
      }),
    refetchInterval: 60_000,
  });

  const enlace = (estado: EstadoVencimiento) => {
    const filtros = { ...leerFiltrosPreventivos(new URLSearchParams()), estado, plantaId };
    return `/preventivos?${escribirFiltrosPreventivos(filtros).toString()}`;
  };

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600} c="dimmed">
        Preventivos
      </Text>
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
        {TARJETAS.map(({ estado, etiqueta, clave, Icono }) => {
          const cantidad = data ? data.resumen[clave] : 0;
          const color = cantidad > 0 ? obtenerInfoEstado('tarea_preventiva', estado).color : 'gray';
          return (
            <Card
              key={estado}
              component={Link}
              to={enlace(estado)}
              withBorder
              radius="md"
              p="md"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              {isPending ? (
                <Stack gap="xs">
                  <Skeleton height={28} width={60} />
                  <Skeleton height={16} width="70%" />
                </Stack>
              ) : (
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <div>
                    <Text
                      size="xl"
                      fw={700}
                      c={cantidad === 0 ? 'dimmed' : undefined}
                      style={{ fontSize: '1.75rem', lineHeight: 1.2 }}
                    >
                      {cantidad}
                    </Text>
                    <Text size="sm" c="dimmed" mt={4}>
                      {etiqueta}
                    </Text>
                  </div>
                  <ThemeIcon color={color} variant="light" size="lg" radius="md">
                    <Icono size={20} />
                  </ThemeIcon>
                </Group>
              )}
            </Card>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
