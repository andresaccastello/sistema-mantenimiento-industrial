import { Card, Stack, Text, Timeline } from '@mantine/core';
import type { IntervencionDetalle } from '../../api/tipos';
import { eventosHistorial } from '../../lib/intervenciones';
import { obtenerInfoEstado } from '../../lib/estados';
import { formatFechaHora } from '../../lib/formato';
import { nombreCompleto } from '../../lib/personas';

/** El historial de la intervención, en una línea de tiempo. */
export function HistorialIntervencion({ reporte }: { reporte: IntervencionDetalle }) {
  const eventos = eventosHistorial(reporte);
  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="md">
        <Text fw={700} size="sm" tt="uppercase" c="#64748b">Historial</Text>
        {eventos.length === 0 ? (
          <Text size="sm" c="dimmed">Sin eventos registrados.</Text>
        ) : (
          <Timeline active={eventos.length} bulletSize={20} lineWidth={2}>
            {eventos.map((ev) => {
              const colorPunto = ev.estado ? obtenerInfoEstado('intervencion', ev.estado).color : 'gray';
              return (
                <Timeline.Item key={ev.clave} color={colorPunto} title={<Text fw={600} size="sm">{ev.titulo}</Text>}>
                  <Text size="xs" c="dimmed">{formatFechaHora(ev.fecha)} · por {nombreCompleto(ev.persona)}</Text>
                  {ev.mostrarRegistrado && (
                    <Text size="xs" c="dimmed">cargado el {formatFechaHora(ev.registrado)}</Text>
                  )}
                  {ev.detalle && (
                    <Text size="xs" c="#64748b" lineClamp={3} mt={2}>{ev.detalle}</Text>
                  )}
                </Timeline.Item>
              );
            })}
          </Timeline>
        )}
      </Stack>
    </Card>
  );
}
