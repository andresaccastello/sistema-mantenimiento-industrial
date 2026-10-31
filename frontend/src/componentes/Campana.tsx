import React from 'react';
import { ActionIcon, Indicator, Tooltip } from '@mantine/core';
import { IconBell } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { clienteApi } from '../api/cliente';
import type { ContadorNotificaciones } from '../api/tipos';

export function Campana() {
  const navigate = useNavigate();

  const { data } = useQuery<ContadorNotificaciones>({
    queryKey: ['notificaciones-contador'],
    queryFn: () => clienteApi.get<ContadorNotificaciones>('/api/notificaciones/contador'),
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });

  const noLeidas = data?.no_leidas ?? 0;
  const tieneAlta = (data?.no_leidas_alta ?? 0) > 0;

  return (
    <Tooltip label="Avisos y notificaciones" withArrow>
      <Indicator
        disabled={noLeidas === 0}
        label={noLeidas > 99 ? '99+' : noLeidas}
        size={18}
        offset={4}
        color={tieneAlta ? 'red' : 'marca'}
        withBorder
      >
        <ActionIcon
          variant="subtle"
          color="gray"
          size="lg"
          radius="sm"
          onClick={() => navigate('/notificaciones')}
          aria-label="Notificaciones"
        >
          <IconBell size={20} stroke={1.5} />
        </ActionIcon>
      </Indicator>
    </Tooltip>
  );
}
