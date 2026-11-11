import { useState } from 'react';
import {
  Stack,
  Group,
  Text,
  Switch,
  Button,
  Paper,
  Progress,
  ColorSwatch,
  Anchor,
  Box,
} from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { Link } from 'react-router';
import { InactividadMaquinaFila } from '../../api/tipos';
import { formatDuracion } from '../../lib/formato';
import {
  barrasInactividad,
  aCsv,
  descargarCsv,
  nombreArchivoReporte,
} from '../../lib/reportes';

interface Props {
  data: InactividadMaquinaFila[];
  rango: { desde: string; hasta: string };
}

export function TabInactividad({ data, rango }: Props) {
  const [incluirSinDetenciones, setIncluirSinDetenciones] = useState(false);
  const [mostrarTodas, setMostrarTodas] = useState(false);

  // Filtrar según el switch
  const filasFiltradas = incluirSinDetenciones
    ? data
    : data.filter((f) => f.inactividad_minutos > 0);

  // Anchos porcentuales relativos de las barras
  const barras = barrasInactividad(
    filasFiltradas.map((f) => ({
      correctivo_minutos: f.por_tipo.CORRECTIVO,
      preventivo_minutos: f.por_tipo.PREVENTIVO,
    }))
  );

  // Límite de las primeras 15 máquinas
  const filasVisibles = mostrarTodas ? filasFiltradas : filasFiltradas.slice(0, 15);
  const hayMasDe15 = filasFiltradas.length > 15;

  const handleDescargarCsv = () => {
    const columnas = [
      'Máquina',
      'Código',
      'Sector',
      'Total (minutos)',
      'Correctivo (minutos)',
      'Preventivo (minutos)',
    ];
    // CSV con todas las máquinas
    const filasCsv = data.map((f) => [
      f.maquina.nombre,
      f.maquina.codigo,
      f.maquina.sector.nombre,
      f.inactividad_minutos,
      f.por_tipo.CORRECTIVO,
      f.por_tipo.PREVENTIVO,
    ]);
    const csv = aCsv(columnas, filasCsv);
    descargarCsv(nombreArchivoReporte('inactividad', rango.desde, rango.hasta), csv);
  };

  return (
    <Stack gap="md" mt="md">
      {/* Controles superiores: leyenda, switch y botón descargar CSV */}
      <Group justify="space-between" align="center" wrap="wrap">
        <Group gap="lg" align="center" wrap="wrap">
          {/* Leyenda de colores */}
          <Group gap="xs" align="center">
            <ColorSwatch color="var(--mantine-color-red-6)" size={12} />
            <Text size="sm">Correctivo</Text>
          </Group>
          <Group gap="xs" align="center">
            <ColorSwatch color="var(--mantine-color-blue-6)" size={12} />
            <Text size="sm">Preventivo</Text>
          </Group>

          <Switch
            label="Incluir máquinas sin detenciones"
            checked={incluirSinDetenciones}
            onChange={(e) => setIncluirSinDetenciones(e.currentTarget.checked)}
          />
        </Group>

        <Button
          variant="default"
          leftSection={<IconDownload size={16} />}
          onClick={handleDescargarCsv}
        >
          Descargar CSV
        </Button>
      </Group>

      {/* Lista de máquinas */}
      {filasFiltradas.length === 0 ? (
        <Text c="dimmed" my="md">
          No hay datos para este período y estos filtros.
        </Text>
      ) : (
        <Stack gap="xs">
          {filasVisibles.map((f, idx) => {
            const b = barras[idx] ?? { correctivo: 0, preventivo: 0 };
            return (
              <Paper key={f.maquina.id} withBorder p="sm" radius="sm">
                <Group justify="space-between" align="center" mb={6} wrap="wrap">
                  <Group gap="xs" align="baseline">
                    <Anchor
                      component={Link}
                      to={`/maquinas/${f.maquina.id}`}
                      fw={600}
                      size="sm"
                      c="marca.8"
                    >
                      {f.maquina.nombre} ({f.maquina.codigo})
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      · {f.maquina.sector.nombre}
                    </Text>
                  </Group>

                  <Text fw={600} size="sm">
                    {formatDuracion(f.inactividad_minutos)}
                  </Text>
                </Group>

                <Box style={{ width: '100%' }}>
                  <Progress.Root size="md" radius="sm">
                    {b.correctivo > 0 && (
                      <Progress.Section value={b.correctivo} color="red" />
                    )}
                    {b.preventivo > 0 && (
                      <Progress.Section value={b.preventivo} color="blue" />
                    )}
                  </Progress.Root>
                </Box>
              </Paper>
            );
          })}

          {hayMasDe15 && !mostrarTodas && (
            <Group justify="center" mt="sm">
              <Button variant="subtle" onClick={() => setMostrarTodas(true)}>
                Ver todas ({filasFiltradas.length})
              </Button>
            </Group>
          )}
        </Stack>
      )}
    </Stack>
  );
}
