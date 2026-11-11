import { useMemo } from 'react';
import { Link } from 'react-router';
import {
  Stack,
  SimpleGrid,
  Paper,
  Text,
  Title,
  Table,
  Group,
  Button,
  Alert,
} from '@mantine/core';
import { IconDownload, IconPackage } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { ReporteRepuestosRespuesta } from '../../api/tipos';
import { formatCantidad, formatMoneda } from '../../lib/formato';
import {
  aCsv,
  descargarCsv,
  nombreArchivoReporte,
  filasReporteRepuestos,
} from '../../lib/reportes';

export type ReporteRepuestosData = ReporteRepuestosRespuesta;

export interface TabReporteRepuestosProps {
  datos?: ReporteRepuestosRespuesta | null;
}

export function TabReporteRepuestos({ datos }: TabReporteRepuestosProps) {
  const sinDatos = !datos || datos.consumos === 0;

  const { columnas, filas } = useMemo(() => {
    return filasReporteRepuestos(datos);
  }, [datos]);

  const handleDescargarCsv = () => {
    if (!datos) return;
    const csv = aCsv(columnas, filas);
    const nombre = nombreArchivoReporte('repuestos', datos.desde, datos.hasta);
    descargarCsv(nombre, csv);
  };

  if (sinDatos) {
    return (
      <Paper p="xl" withBorder style={{ textAlign: 'center' }}>
        <IconPackage size={48} color="gray" style={{ marginBottom: 12, opacity: 0.5 }} />
        <Text size="md" c="dimmed">
          No hay consumos de repuestos para este período y estos filtros.
        </Text>
      </Paper>
    );
  }

  const { ve_costos, consumos, intervenciones, importe_total, por_repuesto, por_maquina } = datos;

  return (
    <Stack gap="lg">
      {/* Tarjetas de métricas principales */}
      <SimpleGrid cols={{ base: 1, sm: ve_costos ? 3 : 2 }} spacing="md">
        {ve_costos && (
          <Paper p="md" withBorder>
            <Stack gap={4}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                Gastado en repuestos
              </Text>
              <Text size="xl" fw={700}>
                {formatMoneda(importe_total)}
              </Text>
            </Stack>
          </Paper>
        )}

        <Paper p="md" withBorder>
          <Stack gap={4}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Consumos
            </Text>
            <Text size="xl" fw={700}>
              {consumos}
            </Text>
          </Stack>
        </Paper>

        <Paper p="md" withBorder>
          <Stack gap={4}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Intervenciones con repuestos
            </Text>
            <Text size="xl" fw={700}>
              {intervenciones}
            </Text>
          </Stack>
        </Paper>
      </SimpleGrid>

      {/* Tabla 1: Más usados */}
      <Paper p="md" withBorder>
        <Stack gap="md">
          <Group justify="space-between" align="center" wrap="wrap">
            <Title order={4}>Más usados</Title>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconDownload size={14} />}
              onClick={handleDescargarCsv}
            >
              Descargar CSV
            </Button>
          </Group>

          <Table.ScrollContainer minWidth={650}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Repuesto</Table.Th>
                  <Table.Th>Cantidad</Table.Th>
                  <Table.Th>Unidad</Table.Th>
                  <Table.Th>Consumos</Table.Th>
                  <Table.Th>Intervenciones</Table.Th>
                  {ve_costos && <Table.Th>Importe</Table.Th>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {por_repuesto.map((item, idx) => {
                  const nombre = item.repuesto.codigo
                    ? `${item.repuesto.codigo} · ${item.repuesto.nombre}`
                    : item.repuesto.nombre;

                  return (
                    <Table.Tr key={idx}>
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {nombre}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{formatCantidad(item.cantidad)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{item.repuesto.unidad}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{item.consumos}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{item.intervenciones}</Text>
                      </Table.Td>
                      {ve_costos && (
                        <Table.Td>
                          <Text size="sm">{formatMoneda(item.importe)}</Text>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      </Paper>

      {/* Tabla 2: Por máquina */}
      <Paper p="md" withBorder>
        <Stack gap="md">
          <Title order={4}>Por máquina</Title>

          <Table.ScrollContainer minWidth={600}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Máquina</Table.Th>
                  <Table.Th>Sector</Table.Th>
                  <Table.Th>Consumos</Table.Th>
                  {ve_costos && <Table.Th>Importe</Table.Th>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {por_maquina.map((m, idx) => {
                  const nombreMaquina = m.maquina.codigo
                    ? `${m.maquina.codigo} · ${m.maquina.nombre}`
                    : m.maquina.nombre;

                  return (
                    <Table.Tr key={idx}>
                      <Table.Td>
                        <Link
                          to={`/maquinas/${m.maquina.id}`}
                          style={{ color: 'inherit', textDecoration: 'underline' }}
                        >
                          <Text size="sm" fw={500}>
                            {nombreMaquina}
                          </Text>
                        </Link>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{m.sector?.nombre || '—'}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{m.consumos}</Text>
                      </Table.Td>
                      {ve_costos && (
                        <Table.Td>
                          <Text size="sm">{formatMoneda(m.importe)}</Text>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      </Paper>
    </Stack>
  );
}
