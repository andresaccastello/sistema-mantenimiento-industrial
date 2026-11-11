import React, { useState } from 'react';
import { Link } from 'react-router';
import {
  Table,
  Badge,
  Text,
  Stack,
  Group,
  Button,
  Select,
  Paper,
  Title,
  Center,
} from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { EnvioAviso, EnviosAvisos } from '../../api/tipos';
import { estadoEnvio, detalleEnvio, nombreTipoAviso } from '../../lib/avisos';
import { formatFechaHora } from '../../lib/formato';
import { nombreCompleto } from '../../lib/personas';
import { mensajeError } from '../../lib/errores';

export interface TablaUltimosEnviosProps {
  envios: EnvioAviso[];
  total: number;
  pendientes: number;
  estadoFiltro: string;
  onCambiarEstadoFiltro: (estado: string) => void;
  limite: number;
  onVerMas: () => void;
  cargando?: boolean;
  onActualizado: () => void;
}

const OPCIONES_ESTADO = [
  { value: '', label: 'Todos' },
  { value: 'PENDIENTE', label: 'Pendientes' },
  { value: 'ENVIADO', label: 'Enviados' },
  { value: 'ERROR', label: 'Con error' },
  { value: 'DESCARTADO', label: 'Descartados' },
];

export function TablaUltimosEnvios({
  envios,
  total,
  pendientes,
  estadoFiltro,
  onCambiarEstadoFiltro,
  limite,
  onVerMas,
  cargando,
  onActualizado,
}: TablaUltimosEnviosProps) {
  const [procesando, setProcesando] = useState(false);

  const handleProcesar = async () => {
    setProcesando(true);
    try {
      const res = await clienteApi.post<{ procesados: number; enviados: number }>(
        '/api/configuracion/avisos/procesar'
      );
      notifications.show({
        message: `Procesados: ${res.procesados}. Enviados: ${res.enviados}.`,
        color: 'green',
      });
      onActualizado();
    } catch (err) {
      notifications.show({
        message: mensajeError(err),
        color: 'red',
      });
    } finally {
      setProcesando(false);
    }
  };

  const badgeColor = (color: string) => {
    switch (color) {
      case 'amarillo':
        return 'yellow';
      case 'marca':
        return 'marca';
      case 'rojo':
        return 'red';
      default:
        return 'gray';
    }
  };

  return (
    <Paper withBorder radius="sm" p="md">
      <Stack gap="md">
        <Group justify="space-between" wrap="wrap">
          <Group gap="md">
            <Title order={4}>Últimos envíos</Title>
            <Badge color="yellow" variant="light" size="sm">
              {pendientes} por salir
            </Badge>
          </Group>

          <Group gap="sm">
            <Select
              size="sm"
              w={160}
              data={OPCIONES_ESTADO}
              value={estadoFiltro}
              onChange={(val) => onCambiarEstadoFiltro(val || '')}
              allowDeselect={false}
            />
            <Button
              variant="default"
              size="sm"
              leftSection={<IconRefresh size={16} />}
              onClick={handleProcesar}
              loading={procesando}
            >
              Procesar ahora
            </Button>
          </Group>
        </Group>

        {envios.length === 0 ? (
          <Center py="xl">
            <Text c="dimmed" size="sm">
              Todavía no se envió nada.
            </Text>
          </Center>
        ) : (
          <>
            <Table verticalSpacing="sm" striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: '15%' }}>Fecha</Table.Th>
                  <Table.Th style={{ width: '25%' }}>Para</Table.Th>
                  <Table.Th style={{ width: '35%' }}>Aviso</Table.Th>
                  <Table.Th style={{ width: '25%' }}>Estado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {envios.map((e) => {
                  const est = estadoEnvio(e.estado);
                  const det = detalleEnvio(e);

                  return (
                    <Table.Tr key={e.id}>
                      <Table.Td>
                        <Text size="sm">{formatFechaHora(e.creado_en)}</Text>
                      </Table.Td>

                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {nombreCompleto(e.usuario)}
                        </Text>
                        {e.destino && (
                          <Text size="xs" c="dimmed">
                            {e.destino}
                          </Text>
                        )}
                      </Table.Td>

                      <Table.Td>
                        {e.notificacion.intervencion_id ? (
                          <Link
                            to={`/intervenciones/${e.notificacion.intervencion_id}`}
                            style={{ color: 'inherit', textDecoration: 'underline' }}
                          >
                            <Text size="sm" fw={500} component="span">
                              {e.notificacion.titulo}
                            </Text>
                          </Link>
                        ) : (
                          <Text size="sm" fw={500}>
                            {e.notificacion.titulo}
                          </Text>
                        )}
                        <Text size="xs" c="dimmed">
                          {nombreTipoAviso(e.notificacion.tipo_evento)}
                        </Text>
                      </Table.Td>

                      <Table.Td>
                        <Badge color={badgeColor(est.color)} variant="light" size="sm">
                          {est.etiqueta}
                        </Badge>
                        {det && (
                          <Text size="xs" c="dimmed" mt={4}>
                            {det}
                          </Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>

            {envios.length < total && limite < 100 && (
              <Center mt="sm">
                <Button variant="subtle" size="sm" onClick={onVerMas} loading={cargando}>
                  Ver más
                </Button>
              </Center>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
