import {
  Alert,
  Box,
  Button,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { IconAlertCircle, IconDownload } from '@tabler/icons-react';
import type { AgrupacionPreventivos, ReportePreventivosRespuesta } from '../../api/tipos';
import {
  aCsv,
  colorCumplimiento,
  descargarCsv,
  filasReportePreventivos,
  nombreArchivoReporte,
  nombreGrupoPreventivos,
  textoAtrasoPromedio,
  textoCumplimiento,
} from '../../lib/reportes';

interface TabPreventivosProps {
  datos?: ReportePreventivosRespuesta;
  cargando: boolean;
  error?: unknown;
  reintentar?: () => void;
  agrupar: AgrupacionPreventivos;
  onCambiarAgrupar: (nuevo: AgrupacionPreventivos) => void;
  desde: string;
  hasta: string;
}

export function TabPreventivos({
  datos,
  cargando,
  error,
  reintentar,
  agrupar,
  onCambiarAgrupar,
  desde,
  hasta,
}: TabPreventivosProps) {
  if (cargando) {
    return (
      <Stack gap="md" mt="md">
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={95} radius="md" />
          ))}
        </SimpleGrid>
        <Skeleton height={44} radius="md" />
        <Skeleton height={220} radius="md" />
      </Stack>
    );
  }

  if (error) {
    return (
      <Alert icon={<IconAlertCircle size={18} />} title="Error al cargar el cumplimiento de preventivos" color="red" my="md">
        <Group justify="space-between" align="center">
          <Text size="sm">No se pudieron obtener los datos de preventivos del período.</Text>
          {reintentar && (
            <Button size="xs" variant="light" color="red" onClick={reintentar}>
              Reintentar
            </Button>
          )}
        </Group>
      </Alert>
    );
  }

  const resumen = datos?.resumen ?? {
    hechas: 0,
    a_tiempo: 0,
    tarde: 0,
    vencidas_sin_hacer: 0,
    cumplimiento: null,
    atraso_promedio_dias: null,
  };
  const grupos = datos?.grupos ?? [];
  const sinDatos = grupos.length === 0;

  const colorResumen = colorCumplimiento(resumen.cumplimiento);
  const colorTextoCumplimiento = colorResumen === 'gray' ? 'dimmed' : `${colorResumen}.7`;

  const handleDescargarCsv = () => {
    const { columnas, filas } = filasReportePreventivos(grupos, agrupar);
    const contenido = aCsv(columnas, filas);
    const nombre = nombreArchivoReporte('preventivos', desde, hasta);
    descargarCsv(nombre, contenido);
  };

  return (
    <Stack gap="md" mt="md">
      {/* Cinco tarjetas arriba */}
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm">
        <Paper withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" fw={600} tt="uppercase">
            Cumplimiento
          </Text>
          <Text size="xl" fw={700} mt={4} c={colorTextoCumplimiento}>
            {textoCumplimiento(resumen.cumplimiento)}
          </Text>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" fw={600} tt="uppercase">
            A tiempo
          </Text>
          <Text size="xl" fw={700} mt={4}>
            {resumen.a_tiempo}
          </Text>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" fw={600} tt="uppercase">
            Tarde
          </Text>
          <Text size="xl" fw={700} mt={4}>
            {resumen.tarde}
          </Text>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" fw={600} tt="uppercase">
            Vencidas sin hacer
          </Text>
          <Text size="xl" fw={700} mt={4}>
            {resumen.vencidas_sin_hacer}
          </Text>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" fw={600} tt="uppercase">
            Atraso promedio
          </Text>
          <Text size="xl" fw={700} mt={4}>
            {textoAtrasoPromedio(resumen.atraso_promedio_dias)}
          </Text>
        </Paper>
      </SimpleGrid>

      {/* Línea de ayuda debajo de las tarjetas */}
      <Text size="xs" c="dimmed">
        Una tarea está a tiempo si se hizo hasta su fecha programada y sin pasar el uso programado. Las vencidas sin hacer son las que vencieron en el período y siguen pendientes.
      </Text>

      {/* Barra de controles: SegmentedControl y Descargar CSV */}
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap="xs" align="center" wrap="wrap">
          <Text size="sm" fw={500} c="dimmed">
            Agrupar por:
          </Text>
          <SegmentedControl
            size="xs"
            value={agrupar}
            onChange={(val) => onCambiarAgrupar(val as AgrupacionPreventivos)}
            data={[
              { value: 'sector', label: 'Sector' },
              { value: 'maquina', label: 'Máquina' },
              { value: 'plan', label: 'Plan' },
            ]}
          />
        </Group>

        <Button
          size="xs"
          variant="default"
          leftSection={<IconDownload size={14} />}
          onClick={handleDescargarCsv}
          disabled={sinDatos}
        >
          Descargar CSV
        </Button>
      </Group>

      {/* Tabla o mensaje vacío */}
      {sinDatos ? (
        <Paper withBorder p="xl" radius="md" ta="center">
          <Text c="dimmed" size="sm">
            No hay tareas preventivas para medir en este período.
          </Text>
        </Paper>
      ) : (
        <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
          <Box style={{ overflowX: 'auto' }}>
            <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Grupo</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Hechas</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>A tiempo</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Tarde</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Vencidas sin hacer</Table.Th>
                  <Table.Th style={{ minWidth: 160 }}>Cumplimiento</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Atraso</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {grupos.map((g, idx) => {
                  const nombre = nombreGrupoPreventivos(g, agrupar);
                  const color = colorCumplimiento(g.cumplimiento);
                  const pct = g.cumplimiento !== null && g.cumplimiento !== undefined ? Math.max(0, Math.min(100, g.cumplimiento)) : 0;

                  return (
                    <Table.Tr key={`${nombre}-${idx}`}>
                      <Table.Td fw={600}>{nombre}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{g.hechas}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{g.a_tiempo}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{g.tarde}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{g.vencidas_sin_hacer}</Table.Td>
                      <Table.Td>
                        <Stack gap={4}>
                          <Text size="sm" fw={600} c={color === 'gray' ? 'dimmed' : `${color}.7`}>
                            {textoCumplimiento(g.cumplimiento)}
                          </Text>
                          <Progress value={pct} color={color} size="sm" radius="xl" />
                        </Stack>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {textoAtrasoPromedio(g.atraso_promedio_dias)}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Box>
        </Paper>
      )}
    </Stack>
  );
}
