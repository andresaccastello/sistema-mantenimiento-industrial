import React from 'react';
import {
  Card,
  Stack,
  Group,
  Text,
  Title,
  Button,
  TextInput,
  Select,
  Textarea,
  Table,
  Box,
  Divider,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { EncabezadoPagina } from '../componentes/EncabezadoPagina';
import { EstadoBadge } from '../componentes/EstadoBadge';
import { PantallaVacia } from '../componentes/PantallaVacia';
import { formatDuracion, formatHace } from '../lib/formato';

export function Muestra() {
  const mostrarAvisoExito = () => {
    notifications.show({
      color: 'green',
      title: 'Operación exitosa',
      message: 'Los cambios se guardaron correctamente en el sistema.',
    });
  };

  const mostrarAvisoError = () => {
    notifications.show({
      color: 'red',
      title: 'Error detectado',
      message: 'No fue posible completar la acción solicitada.',
    });
  };

  const estadosIntervencion = [
    'PENDIENTE',
    'EN_PROCESO',
    'EN_ESPERA_REPUESTOS',
    'FINALIZADA',
    'CANCELADA',
  ] as const;

  const estadosMaquina = [
    'OPERATIVA',
    'DETENIDA',
    'EN_MANTENIMIENTO',
    'FUERA_DE_SERVICIO',
  ] as const;

  return (
    <>
      <EncabezadoPagina
        titulo="Muestra de componentes"
        subtitulo="Catálogo visual de los componentes del sistema (solo desarrollo)"
        acciones={
          <Group gap="xs">
            <Button size="sm" color="green" onClick={mostrarAvisoExito}>
              Aviso éxito
            </Button>
            <Button size="sm" color="red" variant="light" onClick={mostrarAvisoError}>
              Aviso error
            </Button>
          </Group>
        }
      />

      <Stack gap="xl">
        {/* 1. Badges de estados */}
        <Card withBorder radius="sm" padding="lg">
          <Title order={4} mb="md" c="#1e293b">
            1. Tabla de estados (9 estados)
          </Title>
          <Stack gap="md">
            <Box>
              <Text size="xs" fw={600} c="#64748b" tt="uppercase" mb="xs">
                Estados de intervención
              </Text>
              <Group gap="sm" wrap="wrap">
                {estadosIntervencion.map((est) => (
                  <EstadoBadge key={est} entidad="intervencion" estado={est} />
                ))}
              </Group>
            </Box>
            <Box>
              <Text size="xs" fw={600} c="#64748b" tt="uppercase" mb="xs">
                Estados de máquina
              </Text>
              <Group gap="sm" wrap="wrap">
                {estadosMaquina.map((est) => (
                  <EstadoBadge key={est} entidad="maquina" estado={est} />
                ))}
              </Group>
            </Box>
          </Stack>
        </Card>

        {/* 2. Botones */}
        <Card withBorder radius="sm" padding="lg">
          <Title order={4} mb="md" c="#1e293b">
            2. Botones
          </Title>
          <Group gap="md" wrap="wrap">
            <Button color="marca">Primario</Button>
            <Button variant="default">Secundario</Button>
            <Button color="red">Peligro</Button>
            <Button disabled>Deshabilitado</Button>
          </Group>
        </Card>

        {/* 3. Formulario de ejemplo */}
        <Card withBorder radius="sm" padding="lg">
          <Title order={4} mb="md" c="#1e293b">
            3. Formulario de ejemplo
          </Title>
          <Stack gap="sm" maw={500}>
            <TextInput label="Campo de texto" placeholder="Ingresá un valor" />
            <Select
              label="Selector"
              placeholder="Elegí una opción"
              data={['Opción 1', 'Opción 2', 'Opción 3']}
            />
            <TextInput label="Fecha" type="date" />
            <Textarea label="Observaciones" placeholder="Descripción detallada" rows={3} />
            <Group justify="flex-end" mt="xs">
              <Button variant="default">Cancelar</Button>
              <Button color="marca">Guardar</Button>
            </Group>
          </Stack>
        </Card>

        {/* 4. Tabla de ejemplo con 5 filas */}
        <Card withBorder radius="sm" padding="lg">
          <Title order={4} mb="md" c="#1e293b">
            4. Tabla de ejemplo (5 filas)
          </Title>
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>ID</Table.Th>
                <Table.Th>Máquina</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Duración</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td>#101</Table.Td>
                <Table.Td>Torno CNC A</Table.Td>
                <Table.Td>Correctivo</Table.Td>
                <Table.Td>
                  <EstadoBadge entidad="intervencion" estado="EN_PROCESO" />
                </Table.Td>
                <Table.Td>{formatDuracion(45)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>#102</Table.Td>
                <Table.Td>Fresadora B</Table.Td>
                <Table.Td>Preventivo</Table.Td>
                <Table.Td>
                  <EstadoBadge entidad="intervencion" estado="PENDIENTE" />
                </Table.Td>
                <Table.Td>{formatDuracion(0)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>#103</Table.Td>
                <Table.Td>Inyectora C</Table.Td>
                <Table.Td>Correctivo</Table.Td>
                <Table.Td>
                  <EstadoBadge entidad="intervencion" estado="EN_ESPERA_REPUESTOS" />
                </Table.Td>
                <Table.Td>{formatDuracion(135)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>#104</Table.Td>
                <Table.Td>Prensa Hidráulica</Table.Td>
                <Table.Td>Mejora</Table.Td>
                <Table.Td>
                  <EstadoBadge entidad="intervencion" estado="FINALIZADA" />
                </Table.Td>
                <Table.Td>{formatDuracion(1500)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>#105</Table.Td>
                <Table.Td>Compresor Central</Table.Td>
                <Table.Td>Inspección</Table.Td>
                <Table.Td>
                  <EstadoBadge entidad="intervencion" estado="CANCELADA" />
                </Table.Td>
                <Table.Td>{formatDuracion(null)}</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Card>

        {/* 5. Pantalla vacía */}
        <Card withBorder radius="sm" padding="lg">
          <Title order={4} mb="md" c="#1e293b">
            5. Pantalla vacía
          </Title>
          <PantallaVacia
            titulo="No se encontraron registros"
            mensaje="Probá ajustando los filtros de búsqueda para ver más resultados."
            accion={<Button variant="default" size="xs">Limpiar filtros</Button>}
          />
        </Card>

        {/* 6. Ejemplos de formato de tiempos */}
        <Card withBorder radius="sm" padding="lg">
          <Title order={4} mb="md" c="#1e293b">
            6. Formato de tiempos legibles
          </Title>
          <Stack gap="xs">
            <Text size="sm">
              <code>formatDuracion(null)</code> → <b>{formatDuracion(null)}</b>
            </Text>
            <Text size="sm">
              <code>formatDuracion(0)</code> → <b>{formatDuracion(0)}</b>
            </Text>
            <Text size="sm">
              <code>formatDuracion(45)</code> → <b>{formatDuracion(45)}</b>
            </Text>
            <Text size="sm">
              <code>formatDuracion(60)</code> → <b>{formatDuracion(60)}</b>
            </Text>
            <Text size="sm">
              <code>formatDuracion(135)</code> → <b>{formatDuracion(135)}</b>
            </Text>
            <Text size="sm">
              <code>formatDuracion(1440)</code> → <b>{formatDuracion(1440)}</b>
            </Text>
            <Text size="sm">
              <code>formatDuracion(1500)</code> → <b>{formatDuracion(1500)}</b>
            </Text>
            <Divider my="xs" />
            <Text size="sm">
              <code>formatHace(hace 30 segundos)</code> →{' '}
              <b>{formatHace(new Date(Date.now() - 30 * 1000))}</b>
            </Text>
            <Text size="sm">
              <code>formatHace(hace 80 minutos)</code> →{' '}
              <b>{formatHace(new Date(Date.now() - 80 * 60 * 1000))}</b>
            </Text>
          </Stack>
        </Card>
      </Stack>
    </>
  );
}
