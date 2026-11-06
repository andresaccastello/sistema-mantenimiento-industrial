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
} from '../../lib/reportes';

interface Props {
  data: TiemposAgrupadosFila[];
  agrupar: AgrupacionTiempos;
  onAgruparChange: (nuevaAgrupacion: AgrupacionTiempos) => void;
  rango: { desde: string; hasta: string };
}

function formatoGrupo(grupo: string | null | undefined, agrupar: AgrupacionTiempos): string {
  if (agrupar === 'ejecucion') {
    if (grupo === 'INTERNA') return 'Interna';
    if (grupo === 'EXTERNA') return 'Externa';
    return 'Sin definir';
  }
  return grupo || 'Sin definir';
}

export function TabTiempos({ data, agrupar, onAgruparChange, rango }: Props) {
  const handleDescargarCsv = () => {
    const columnas = [
      'Grupo',
      'Cantidad',
      'Respuesta promedio (minutos)',
      'Duración neta promedio (minutos)',
      'Duración bruta promedio (minutos)',
      'Duración neta total (minutos)',
    ];
    const filas = data.map((t) => [
      formatoGrupo(t.grupo, agrupar),
      t.cantidad,
      t.respuesta_promedio_minutos ?? '',
      t.duracion_neta_promedio_minutos ?? '',
      t.duracion_bruta_promedio_minutos ?? '',
      t.duracion_neta_total_minutos ?? '',
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

      {data.length === 0 ? (
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
              {data.map((t, idx) => (
                <Table.Tr key={`${t.grupo}-${idx}`}>
                  <Table.Td fw={500}>{formatoGrupo(t.grupo, agrupar)}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{t.cantidad}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {formatDuracion(t.respuesta_promedio_minutos)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {formatDuracion(t.duracion_neta_promedio_minutos)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {formatDuracion(t.duracion_bruta_promedio_minutos)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {formatDuracion(t.duracion_neta_total_minutos)}
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
