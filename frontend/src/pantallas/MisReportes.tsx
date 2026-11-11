import React, { useState } from 'react';
import {
  Stack,
  Group,
  SimpleGrid,
  Card,
  Text,
  Badge,
  Button,
  Box,
  Title,
  Loader,
  Center,
} from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useNavigate, Navigate } from 'react-router';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { clienteApi } from '../api/cliente';
import { destinoInicio } from '../lib/inicio';
import { etiquetaMaquina } from '../lib/maquinas';
import { formatHace } from '../lib/formato';
import { nombreCompleto } from '../lib/personas';
import { EstadoBadge } from '../componentes/EstadoBadge';
import { PantallaVacia } from '../componentes/PantallaVacia';
import { EncabezadoPagina } from '../componentes/EncabezadoPagina';
import type { IntervencionLista, ListaResultado } from '../api/tipos';

function TarjetaReporte({
  item,
  onClick,
}: {
  item: IntervencionLista;
  onClick: () => void;
}) {
  return (
    <Card
      withBorder
      radius="md"
      p="md"
      tabIndex={0}
      role="button"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'transform 150ms ease, box-shadow 150ms ease',
      }}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text fw={600} size="sm" c="#0f172a" lineClamp={1}>
              {etiquetaMaquina(item.maquina)}
            </Text>
            <Text size="xs" c="#64748b" lineClamp={1}>
              {item.maquina.sector.nombre}
            </Text>
          </Box>
          <EstadoBadge entidad="intervencion" estado={item.estado} size="xs" />
        </Group>

        <Group gap="xs" wrap="wrap">
          <Text size="xs" c="#64748b">
            Reportado {formatHace(item.fecha_creacion)}
          </Text>
          {item.detiene_maquina_actualmente && (
            <Badge color="red" variant="filled" size="xs">
              Máquina detenida
            </Badge>
          )}
        </Group>

        <Text size="sm" c="#334155" lineClamp={2}>
          {item.descripcion}
        </Text>
      </Stack>

      <Box mt="sm" pt="xs" style={{ borderTop: '1px solid #f1f5f9' }}>
        <Text size="xs" c="#64748b">
          Responsable:{' '}
          <Text span fw={500} c="#1e293b">
            {nombreCompleto(item.responsable) || 'Sin asignar'}
          </Text>
        </Text>
      </Box>
    </Card>
  );
}

export function MisReportes() {
  const { usuario } = useAuth();

  // Redirección si no es el destino de inicio del perfil (sin hooks internos)
  if (destinoInicio(usuario?.permisos) !== '/mis-reportes') {
    return <Navigate to="/" replace />;
  }

  return <MisReportesContenido />;
}

function MisReportesContenido() {
  const { usuario } = useAuth();
  const navigate = useNavigate();

  const tieneCrear = Boolean(usuario?.permisos?.['INTERVENCIONES_CREAR']);
  const tieneVer = Boolean(usuario?.permisos?.['INTERVENCIONES_VER']);

  const [limitCerrados, setLimitCerrados] = useState(10);

  const { data: dataAbiertos, isLoading: cargandoAbiertos } = useQuery<ListaResultado<IntervencionLista>>({
    queryKey: ['intervenciones', { estado: 'PENDIENTE,EN_PROCESO,EN_ESPERA_REPUESTOS', limit: 50 }],
    queryFn: () =>
      clienteApi.listar<IntervencionLista>('/api/intervenciones', {
        params: { estado: 'PENDIENTE,EN_PROCESO,EN_ESPERA_REPUESTOS', limit: 50 },
      }),
    enabled: tieneVer,
    refetchInterval: 60000,
  });

  const {
    data: dataCerrados,
    isLoading: cargandoCerrados,
    isPlaceholderData: trayendoMasCerrados,
  } = useQuery<ListaResultado<IntervencionLista>>({
    queryKey: ['intervenciones', { estado: 'FINALIZADA,CANCELADA', limit: limitCerrados }],
    queryFn: () =>
      clienteApi.listar<IntervencionLista>('/api/intervenciones', {
        params: { estado: 'FINALIZADA,CANCELADA', limit: limitCerrados },
      }),
    enabled: tieneVer,
    refetchInterval: 60000,
    placeholderData: keepPreviousData,
  });

  const botonReportar = tieneCrear ? (
    <Button
      size="xl"
      color="marca"
      leftSection={<IconAlertTriangle size={24} />}
      onClick={() => navigate('/reportar')}
      w={{ base: '100%', sm: 'auto' }}
    >
      Reportar falla
    </Button>
  ) : null;

  if (!tieneVer) {
    return (
      <Stack gap="lg">
        <EncabezadoPagina titulo="Mis reportes" />
        {botonReportar && <Box>{botonReportar}</Box>}
      </Stack>
    );
  }

  const primeraCarga = (cargandoAbiertos && !dataAbiertos) || (cargandoCerrados && !dataCerrados);
  const abiertos = dataAbiertos?.items || [];
  const cerrados = dataCerrados?.items || [];
  const totalAbiertos = dataAbiertos?.total ?? abiertos.length;
  const totalCerrados = dataCerrados?.total ?? cerrados.length;
  const sinReportes = !primeraCarga && totalAbiertos === 0 && totalCerrados === 0;

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <EncabezadoPagina
          titulo="Mis reportes"
          subtitulo="Seguimiento de fallas que reportaste"
        />
        {botonReportar && <Box w={{ base: '100%', sm: 'auto' }}>{botonReportar}</Box>}
      </Group>

      {primeraCarga && (
        <Center py="xl">
          <Loader color="marca" />
        </Center>
      )}

      {sinReportes && (
        <PantallaVacia
          titulo="Todavía no reportaste fallas."
          mensaje="Cuando cargues una falla la vas a poder seguir desde acá."
          accion={botonReportar}
        />
      )}

      {!primeraCarga && !sinReportes && (
        <Stack gap="xl">
          {/* Bloque Abiertos */}
          <Stack gap="sm">
            <Group justify="space-between" align="baseline">
              <Title order={3} size="h4" c="#0f172a">
                Abiertos ({totalAbiertos})
              </Title>
              {totalAbiertos > 50 && (
                <Text size="xs" c="#64748b">
                  Se muestran los 50 más recientes de {totalAbiertos}.
                </Text>
              )}
            </Group>

            {abiertos.length === 0 ? (
              <Text size="sm" c="#64748b">
                No tenés reportes abiertos en este momento.
              </Text>
            ) : (
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                {abiertos.map((item) => (
                  <TarjetaReporte
                    key={item.id}
                    item={item}
                    onClick={() => navigate(`/intervenciones/${item.id}`)}
                  />
                ))}
              </SimpleGrid>
            )}
          </Stack>

          {/* Bloque Cerrados recientemente */}
          <Stack gap="sm">
            <Title order={3} size="h4" c="#0f172a">
              Cerrados recientemente
            </Title>

            {cerrados.length === 0 ? (
              <Text size="sm" c="#64748b">
                No hay reportes cerrados recientemente.
              </Text>
            ) : (
              <>
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                  {cerrados.map((item) => (
                    <TarjetaReporte
                      key={item.id}
                      item={item}
                      onClick={() => navigate(`/intervenciones/${item.id}`)}
                    />
                  ))}
                </SimpleGrid>

                {cerrados.length < totalCerrados && (
                  <Group justify="center" mt="md">
                    <Button
                      variant="default"
                      size="md"
                      loading={trayendoMasCerrados}
                      onClick={() => setLimitCerrados((l) => l + 10)}
                    >
                      Ver más
                    </Button>
                  </Group>
                )}
              </>
            )}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}

export default MisReportes;
