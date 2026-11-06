import { useMemo } from 'react';
import { Link } from 'react-router';
import { Stack, SimpleGrid, Paper, Text, Title, Table, Group, Button } from '@mantine/core';
import { IconDownload, IconReceipt } from '@tabler/icons-react';
import { ReporteCostosRespuesta } from '../../api/tipos';
import { formatMoneda } from '../../lib/formato';
import { nombreCompleto } from '../../lib/personas';
import { formatHoras } from '../../lib/costos';
import { aCsv, descargarCsv, nombreArchivoReporte, filasReporteCostos } from '../../lib/reportes';

export interface TabReporteCostosProps {
  datos?: ReporteCostosRespuesta | null;
}

const sinCorte = { whiteSpace: 'nowrap' as const };

function Tarjeta({ titulo, importe }: { titulo: string; importe: number }) {
  return (
    <Paper p="md" withBorder>
      <Stack gap={4}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          {titulo}
        </Text>
        <Text size="xl" fw={700} style={sinCorte}>
          {formatMoneda(importe)}
        </Text>
      </Stack>
    </Paper>
  );
}

export function TabReporteCostos({ datos }: TabReporteCostosProps) {
  const { columnas, filas } = useMemo(() => filasReporteCostos(datos), [datos]);

  if (!datos || datos.intervenciones === 0) {
    return (
      <Paper p="xl" withBorder style={{ textAlign: 'center' }}>
        <IconReceipt size={48} color="gray" style={{ marginBottom: 12, opacity: 0.5 }} />
        <Text size="md" c="dimmed">
          No hay costos registrados para este período y estos filtros.
        </Text>
      </Paper>
    );
  }

  const { por_tipo, por_maquina, horas_por_persona } = datos;
  // Otros: servicio externo, transporte, otro y ajuste (en centavos, sin errores de coma flotante)
  const otros =
    Math.round((por_tipo.servicio_externo + por_tipo.transporte + por_tipo.otro + por_tipo.ajuste) * 100) / 100;

  const handleDescargarCsv = () => {
    descargarCsv(nombreArchivoReporte('costos', datos.desde, datos.hasta), aCsv(columnas, filas));
  };

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md">
        <Tarjeta titulo="Total" importe={datos.total} />
        <Tarjeta titulo="Repuestos" importe={por_tipo.repuestos} />
        <Tarjeta titulo="Mano de obra" importe={por_tipo.mano_obra} />
        <Tarjeta titulo="Otros" importe={otros} />
      </SimpleGrid>

      {/* Por máquina */}
      <Paper p="md" withBorder>
        <Stack gap="md">
          <Group justify="space-between" align="center" wrap="wrap">
            <Title order={4}>Por máquina</Title>
            <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} onClick={handleDescargarCsv}>
              Descargar CSV
            </Button>
          </Group>

          <Table.ScrollContainer minWidth={680}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Máquina</Table.Th>
                  <Table.Th>Sector</Table.Th>
                  <Table.Th style={sinCorte}>Repuestos</Table.Th>
                  <Table.Th style={sinCorte}>Mano de obra</Table.Th>
                  <Table.Th style={sinCorte}>Otros</Table.Th>
                  <Table.Th style={sinCorte}>Total</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {por_maquina.map((m) => (
                  <Table.Tr key={m.maquina.id}>
                    <Table.Td>
                      <Link to={`/maquinas/${m.maquina.id}`} style={{ color: 'inherit', textDecoration: 'underline' }}>
                        <Text size="sm" fw={500}>
                          {m.maquina.codigo ? `${m.maquina.codigo} · ${m.maquina.nombre}` : m.maquina.nombre}
                        </Text>
                      </Link>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{m.sector.nombre}</Text>
                    </Table.Td>
                    <Table.Td style={sinCorte}>
                      <Text size="sm">{formatMoneda(m.repuestos)}</Text>
                    </Table.Td>
                    <Table.Td style={sinCorte}>
                      <Text size="sm">{formatMoneda(m.mano_obra)}</Text>
                    </Table.Td>
                    <Table.Td style={sinCorte}>
                      <Text size="sm">{formatMoneda(m.otros)}</Text>
                    </Table.Td>
                    <Table.Td style={sinCorte}>
                      <Text size="sm" fw={700}>
                        {formatMoneda(m.total)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      </Paper>

      {/* Horas por persona */}
      <Paper p="md" withBorder>
        <Stack gap="md">
          <Title order={4}>Horas por persona</Title>
          {horas_por_persona.length === 0 ? (
            <Text size="sm" c="dimmed">
              No se cargó mano de obra en este período.
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={420}>
              <Table verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Persona o proveedor</Table.Th>
                    <Table.Th>Horas</Table.Th>
                    <Table.Th style={sinCorte}>Importe</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {horas_por_persona.map((h, idx) => (
                    <Table.Tr key={idx}>
                      <Table.Td>
                        <Text size="sm">
                          {h.persona ? nombreCompleto(h.persona) : h.proveedor ? `${h.proveedor.nombre} (externo)` : '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td style={sinCorte}>
                        <Text size="sm">{formatHoras(h.horas)}</Text>
                      </Table.Td>
                      <Table.Td style={sinCorte}>
                        <Text size="sm">{formatMoneda(h.importe)}</Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
