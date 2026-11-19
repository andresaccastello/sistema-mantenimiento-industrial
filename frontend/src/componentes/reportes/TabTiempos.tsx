import {
  Stack,
  Group,
  SegmentedControl,
  Button,
  Table,
  Text,
  Paper,
} from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { TiemposAgrupadosFila } from '../../api/tipos';
import { formatDuracion } from '../../lib/formato';
import {
  AgrupacionTiempos,
  aCsv,
  descargarCsv,
  nombreArchivoReporte,
  filaTiempos,
} from '../../lib/reportes';

interface Props {
  data: TiemposAgrupadosFila[];
  agrupar: AgrupacionTiempos;
  onAgruparChange: (nuevaAgrupacion: AgrupacionTiempos) => void;
  rango: { desde: string; hasta: string };
}

export function TabTiempos({ data, agrupar, onAgruparChange, rango }: Props) {
  const filasVisuales = data.map((t) => filaTiempos(t, agrupar));

  const handleDescargarCsv = () => {
    const columnas = [
      'Grupo',
      'Cantidad',
      'Respuesta promedio (minutos)',
      'Duración neta promedio (minutos)',
      'Duración bruta promedio (minutos)',
      'Duración neta total (minutos)',
    ];
    const filas = filasVisuales.map((ft) => [
      ft.grupo,
      ft.cantidad,
      ft.espera_promedio_minutos ?? '',
      ft.duracion_neta_promedio_minutos ?? '',
      ft.duracion_bruta_promedio_minutos ?? '',
      ft.duracion_neta_total_minutos ?? '',
    ]);
    const csv = aCsv(columnas, filas);
    descargarCsv(nombreArchivoReporte('tiempos', rango.desde, rango.hasta), csv);
  };

  return (
    <Stack gap="md" mt="md">
      <Group justify="space-between" align="center" wrap="wrap">
        <SegmentedControl
          value={agrupar}
          onChange={(val) => onAgruparChange(val as AgrupacionTiempos)}
          data={[
            { value: 'ejecucion', label: 'Ejecución' },
            { value: 'tipo', label: 'Tipo' },
            { value: 'sector', label: 'Sector' },
          ]}
        />

        <Button
          variant="default"
          leftSection={<IconDownload size={16} />}
          onClick={handleDescargarCsv}
        >
          Descargar CSV
        </Button>
      </Group>

      {filasVisuales.length === 0 ? (
        <Text c="dimmed" my="md">
          No hay datos para este período y estos filtros.
        </Text>
      ) : (
        <Paper withBorder radius="sm" style={{ overflowX: 'auto' }}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Grupo</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Cantidad</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Respuesta promedio</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Duración neta promedio</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Duración bruta promedio</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Duración neta total</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filasVisuales.map((ft, idx) => (
                <Table.Tr key={`${ft.grupo}-${idx}`}>
                  <Table.Td fw={500}>{ft.grupo}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{ft.cantidad}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {formatDuracion(ft.espera_promedio_minutos)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {formatDuracion(ft.duracion_neta_promedio_minutos)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {formatDuracion(ft.duracion_bruta_promedio_minutos)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {formatDuracion(ft.duracion_neta_total_minutos)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      <Text c="dimmed" size="xs">
        La duración neta descuenta las pausas; la bruta va del inicio al fin del trabajo. Cuentan
        las intervenciones finalizadas en el período.
      </Text>
    </Stack>
  );
}

