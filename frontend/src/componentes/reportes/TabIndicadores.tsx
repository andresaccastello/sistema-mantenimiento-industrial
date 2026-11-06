import { SimpleGrid, Paper, Text, Stack, Group, Button } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { IndicadoresReporte } from '../../api/tipos';
import { formatDuracion } from '../../lib/formato';
import {
  formatPorcentaje,
  formatHoras,
  aCsv,
  descargarCsv,
  nombreArchivoReporte,
} from '../../lib/reportes';

interface Props {
  data: IndicadoresReporte;
  rango: { desde: string; hasta: string };
}

interface TarjetaIndicador {
  id: string;
  nombre: string;
  valor: string | number;
  esNull: boolean;
  definicion: string;
}

export function TabIndicadores({ data, rango }: Props) {
  const tarjetas: TarjetaIndicador[] = [
    {
      id: 'disponibilidad',
      nombre: 'Disponibilidad',
      valor: formatPorcentaje(data.disponibilidad),
      esNull: data.disponibilidad === null,
      definicion: 'Tiempo sin detenciones sobre el tiempo del período.',
    },
    {
      id: 'fallas',
      nombre: 'Fallas reportadas',
      valor: data.fallas,
      esNull: false,
      definicion: 'Intervenciones correctivas reportadas en el período, sin canceladas.',
    },
    {
      id: 'mttr',
      nombre: 'MTTR',
      valor: formatDuracion(data.mttr_minutos),
      esNull: data.mttr_minutos === null,
      definicion: 'Duración neta promedio de las correctivas finalizadas, sin pausas.',
    },
    {
      id: 'mtbf',
      nombre: 'MTBF',
      valor: formatHoras(data.mtbf_horas),
      esNull: data.mtbf_horas === null,
      definicion: 'Tiempo del período sin detenciones correctivas sobre cantidad de fallas.',
    },
    {
      id: 'respuesta',
      nombre: 'Tiempo de respuesta',
      valor: formatDuracion(data.respuesta_promedio_minutos),
      esNull: data.respuesta_promedio_minutos === null,
      definicion: 'Espera promedio de las correctivas finalizadas hasta el inicio del trabajo.',
    },
    {
      id: 'preventivas',
      nombre: 'Preventivas finalizadas',
      valor: data.preventivas_finalizadas,
      esNull: false,
      definicion: 'Intervenciones preventivas completadas en el período.',
    },
  ];

  const handleDescargarCsv = () => {
    const columnas = ['Indicador', 'Valor'];
    const filas = tarjetas.map((t) => [t.nombre, t.valor]);
    const csv = aCsv(columnas, filas);
    descargarCsv(nombreArchivoReporte('indicadores', rango.desde, rango.hasta), csv);
  };

  const textoMaquinas =
    data.maquinas === 1 ? 'Sobre 1 máquina activa.' : `Sobre ${data.maquinas} máquinas activas.`;

  return (
    <Stack gap="md" mt="md">
      <Group justify="flex-end">
        <Button
          variant="default"
          leftSection={<IconDownload size={16} />}
          onClick={handleDescargarCsv}
        >
          Descargar CSV
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        {tarjetas.map((t) => (
          <Paper key={t.id} withBorder p="md" radius="sm">
            <Stack gap="xs">
              <Text fz="2rem" fw={700} lh={1.1} c={t.esNull ? 'dimmed' : '#0f172a'}>
                {t.valor}
              </Text>
              {t.esNull && (
                <Text c="dimmed" size="xs">
                  Sin datos en el período
                </Text>
              )}
              <Text fw={600} size="sm" mt={t.esNull ? undefined : 'xs'}>
                {t.nombre}
              </Text>
              <Text c="dimmed" size="xs">
                {t.definicion}
              </Text>
            </Stack>
          </Paper>
        ))}
      </SimpleGrid>

      <Text c="dimmed" size="sm">
        {textoMaquinas}
      </Text>
    </Stack>
  );
}
