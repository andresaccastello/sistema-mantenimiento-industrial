import React, { useState } from 'react';
import { Stack, Title, Text, Skeleton, Alert } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clienteApi } from '../api/cliente';
import { ConfiguracionAvisos, EnviosAvisos } from '../api/tipos';
import { EncabezadoPagina } from '../componentes/EncabezadoPagina';
import { TarjetaCanales } from '../componentes/configuracion/TarjetaCanales';
import { TablaReglas } from '../componentes/configuracion/TablaReglas';
import { TablaUltimosEnvios } from '../componentes/configuracion/TablaUltimosEnvios';
import { mensajeError } from '../lib/errores';

export function Configuracion() {
  const queryClient = useQueryClient();
  const [limiteEnvios, setLimiteEnvios] = useState(20);
  const [estadoFiltro, setEstadoFiltro] = useState('');

  // 1. Consulta de configuración general de avisos
  const avisosQuery = useQuery({
    queryKey: ['configuracion', 'avisos'],
    queryFn: () => clienteApi.get<ConfiguracionAvisos>('/api/configuracion/avisos'),
    refetchInterval: 30000,
  });

  // 2. Consulta de últimos envíos
  const enviosQuery = useQuery({
    queryKey: ['configuracion', 'avisos', 'envios', limiteEnvios, estadoFiltro],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('limit', String(limiteEnvios));
      if (estadoFiltro) {
        params.set('estado', estadoFiltro);
      }
      return clienteApi.get<EnviosAvisos>(`/api/configuracion/avisos/envios?${params.toString()}`);
    },
    refetchInterval: 30000,
  });

  const refetchTodo = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['configuracion', 'avisos'] }),
      queryClient.invalidateQueries({ queryKey: ['configuracion', 'avisos', 'envios'] }),
    ]);
  };

  const handleVerMas = () => {
    setLimiteEnvios((prev) => Math.min(prev + 20, 100));
  };

  if (avisosQuery.isLoading) {
    return (
      <Stack gap="lg">
        <EncabezadoPagina titulo="Configuración" />
        <Skeleton height={200} />
        <Skeleton height={300} />
      </Stack>
    );
  }

  if (avisosQuery.isError || !avisosQuery.data) {
    return (
      <Stack gap="lg">
        <EncabezadoPagina titulo="Configuración" />
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {avisosQuery.error
            ? mensajeError(avisosQuery.error)
            : 'No se pudo cargar la configuración.'}
        </Alert>
      </Stack>
    );
  }

  const { canales, reglas, pendientes } = avisosQuery.data;
  const enviosData = enviosQuery.data;

  return (
    <Stack gap="xl">
      <EncabezadoPagina titulo="Configuración" />

      {/* Bloque: Avisos por email */}
      <Stack gap="lg">
        <div>
          <Title order={3}>Avisos por email</Title>
          <Text size="sm" c="dimmed" mt={4}>
            La campana del sistema avisa siempre. Acá se elige qué avisos, además, salen por email.
          </Text>
        </div>

        {/* 1. Canales */}
        <TarjetaCanales
          canales={canales}
          pendientes={pendientes}
          onActualizado={refetchTodo}
        />

        {/* 2. Qué se envía */}
        <TablaReglas
          reglas={reglas}
          onActualizado={refetchTodo}
        />

        {/* 3. Últimos envíos */}
        <TablaUltimosEnvios
          envios={enviosData?.envios || []}
          total={enviosData?.total || 0}
          pendientes={pendientes}
          estadoFiltro={estadoFiltro}
          onCambiarEstadoFiltro={setEstadoFiltro}
          limite={limiteEnvios}
          onVerMas={handleVerMas}
          cargando={enviosQuery.isLoading}
          onActualizado={refetchTodo}
        />
      </Stack>
    </Stack>
  );
}
