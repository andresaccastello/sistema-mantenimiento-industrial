import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Group, Paper, SimpleGrid, Skeleton, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { clienteApi } from '../../api/cliente';
import type { FrecuenciaRutina, ReporteRutinas, RutinaReporte } from '../../api/tipos';
import { mensajeError } from '../../lib/errores';
import { useEsCelular } from '../../lib/useEsCelular';
import {
  columnasGrilla,
  estadoVisual,
  filasGrilla,
  formatoPorcentaje,
  nombreMaquina,
  tooltipPeriodo,
  ultimosPeriodos,
} from '../../lib/rutinas';
import { PuntoPeriodo } from '../rutinas/PuntoPeriodo';

interface Props {
  /** Los parámetros de la pantalla: desde, hasta, planta_id y sector_id. */
  params: Record<string, string | number>;
}

/** RT1, 5.2: la pestaña "Rutinas" de Reportes. */
export function TabRutinas({ params }: Props) {
  const esCelular = useEsCelular();
  const { data, isPending, isError, error, refetch } = useQuery<ReporteRutinas>({
    queryKey: ['reportes', 'rutinas', params],
    queryFn: () => clienteApi.get<ReporteRutinas>('/api/reportes/rutinas', { params }),
  });

  if (isPending) return <Skeleton height={260} mt="md" radius="sm" />;
  if (isError || !data) {
    return (
      <Alert color="red" my="md" title="No se pudo cargar el reporte de rutinas">
        <Text size="sm">{mensajeError(error)}</Text>
        <Button variant="light" color="red" size="xs" mt="sm" onClick={() => refetch()}>
          Reintentar
        </Button>
      </Alert>
    );
  }

  const r = data.resumen;
  return (
    <Stack gap="lg" mt="md">
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <Dato titulo="Esperadas" valor={String(r.esperadas)} />
        <Dato titulo="Hechas" valor={String(r.hechas)} />
        <Dato titulo="No hechas" valor={String(r.no_hechas)} />
        <Dato titulo="Cumplimiento" valor={formatoPorcentaje(r.porcentaje)} />
      </SimpleGrid>

      {data.rutinas.length === 0 ? (
        <Text size="sm" c="var(--sm-tenue)">
          No hay tareas de rutina en el período.
        </Text>
      ) : esCelular ? (
        <ListaCelular rutinas={data.rutinas} hoy={data.hoy} />
      ) : (
        <>
          <Grilla rutinas={data.rutinas} frecuencia="DIARIA" hoy={data.hoy} titulo="Diarias" />
          <Grilla rutinas={data.rutinas} frecuencia="SEMANAL" hoy={data.hoy} titulo="Semanales" />
        </>
      )}
    </Stack>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <Paper withBorder p="sm" radius="sm" bg="var(--sm-superficie)">
      <Text size="xs" c="var(--sm-tenue)">
        {titulo}
      </Text>
      <Text fw={600} size="lg" c="var(--sm-titulo)">
        {valor}
      </Text>
    </Paper>
  );
}

function Grilla({
  rutinas,
  frecuencia,
  hoy,
  titulo,
}: {
  rutinas: RutinaReporte[];
  frecuencia: FrecuenciaRutina;
  hoy: string;
  titulo: string;
}) {
  const columnas = columnasGrilla(rutinas, frecuencia);
  const filas = filasGrilla(rutinas, frecuencia, columnas);
  if (filas.length === 0) return null;

  return (
    <Stack gap="xs">
      <Title order={5} c="var(--sm-titulo)">
        {titulo}
      </Title>
      {/* El scroll horizontal queda dentro de la grilla, nunca en la página */}
      <Table.ScrollContainer minWidth={320 + columnas.length * 44}>
        <Table withTableBorder withColumnBorders verticalSpacing={4} horizontalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ minWidth: 220 }}>Máquina y tarea</Table.Th>
              {columnas.map((c) => (
                <Table.Th key={c.periodo} ta="center" style={{ whiteSpace: 'nowrap', fontSize: 'var(--mantine-font-size-xs)' }}>
                  {c.rotulo}
                </Table.Th>
              ))}
              <Table.Th ta="right">%</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filas.map(({ rutina, celdas }) => (
              <Table.Tr key={rutina.id}>
                <Table.Td>
                  <Text size="xs" c="var(--sm-tenue)">
                    {nombreMaquina(rutina.maquina)}
                  </Text>
                  <Text size="sm" c="var(--sm-texto-fuerte)">
                    {rutina.descripcion}
                  </Text>
                </Table.Td>
                {celdas.map((p, i) => (
                  <Table.Td key={columnas[i].periodo} ta="center" p={2}>
                    {p && <Celda tooltip={tooltipPeriodo(p, frecuencia, hoy)} estado={p.estado} />}
                  </Table.Td>
                ))}
                <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                  {formatoPorcentaje(rutina.resumen.porcentaje)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

function Celda({ tooltip, estado }: { tooltip: string; estado: RutinaReporte['periodos'][number]['estado'] }) {
  const v = estadoVisual(estado);
  return (
    <Tooltip label={tooltip} withArrow multiline maw={280}>
      <Box
        role="img"
        aria-label={tooltip}
        mx="auto"
        style={{
          width: 28,
          height: 22,
          borderRadius: 4,
          backgroundColor: v.fondo,
          border: v.borde ? `2px solid ${v.borde}` : undefined,
        }}
      />
    </Tooltip>
  );
}

function ListaCelular({ rutinas, hoy }: { rutinas: RutinaReporte[]; hoy: string }) {
  return (
    <Stack gap="xs">
      {rutinas.map((r) => (
        <Paper key={r.id} withBorder p="sm" radius="sm" bg="var(--sm-superficie)">
          <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Text size="xs" c="var(--sm-tenue)" style={{ overflowWrap: 'anywhere' }}>
                {nombreMaquina(r.maquina)}
              </Text>
              <Text size="sm" c="var(--sm-texto-fuerte)" style={{ overflowWrap: 'anywhere' }}>
                {r.descripcion}
              </Text>
            </Stack>
            <Text fw={600} c="var(--sm-titulo)" style={{ whiteSpace: 'nowrap' }}>
              {formatoPorcentaje(r.resumen.porcentaje)}
            </Text>
          </Group>
          <Group gap={6} mt={6}>
            {ultimosPeriodos(r.periodos, 5).map((p) => (
              <PuntoPeriodo
                key={p.periodo}
                estado={p.estado}
                tooltip={tooltipPeriodo(p, r.frecuencia, hoy)}
              />
            ))}
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}
