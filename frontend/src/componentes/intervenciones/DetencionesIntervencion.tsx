import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import type { IntervencionDetalle, PeriodoDetencion } from '../../api/tipos';
import { minutosEntre } from '../../lib/fechas';
import { formatDuracion, formatFechaHora } from '../../lib/formato';
import { nombreCompleto } from '../../lib/personas';

interface Props {
  reporte: IntervencionDetalle;
  puedeConfirmarRecuperacion: boolean;
  /** 7.4: confirmar que volvió a funcionar, período por período. */
  onConfirmarRecuperacion: (periodo: PeriodoDetencion) => void;
}

/** Las detenciones de la máquina por esta intervención. */
export function DetencionesIntervencion({ reporte, puedeConfirmarRecuperacion, onConfirmarRecuperacion }: Props) {
  const esPreventivo = reporte.tipo === 'PREVENTIVO';
  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Text fw={700} size="sm" tt="uppercase" c="var(--sm-tenue)">Detenciones de la máquina</Text>
        {!reporte.periodos_detencion || reporte.periodos_detencion.length === 0 ? (
          <Text size="sm" c="dimmed">{esPreventivo ? 'Esta intervención no detuvo la máquina.' : 'Esta falla no detuvo la máquina.'}</Text>
        ) : (
          reporte.periodos_detencion.map((p) => {
            const estaAbierto = p.esta_abierto || p.hasta === null;
            return (
              <Card key={p.id} withBorder radius="sm" p="xs" bg="var(--sm-fondo)">
                <Stack gap={4}>
                  <Group justify="space-between" align="center" wrap="wrap">
                    <Text size="sm" fw={600}>
                      {formatFechaHora(p.desde)} →{' '}
                      {estaAbierto ? <Text span c="red" fw={700}>sigue detenida</Text> : formatFechaHora(p.hasta)}
                    </Text>
                    <Group gap={6}>
                      <Text size="xs">{formatDuracion(minutosEntre(p.desde, p.hasta, new Date()))}</Text>
                      {estaAbierto && <Badge color="yellow" variant="light" size="xs">en curso</Badge>}
                    </Group>
                  </Group>
                  <Text size="xs" c="dimmed">
                    Registrada por {nombreCompleto(p.abierto_por)}
                    {p.observacion ? `: ${p.observacion}` : ''}
                  </Text>
                  {!estaAbierto && p.confirmado_por && (
                    <Text size="xs" c="dimmed">
                      Volvió a funcionar, confirmado por {nombreCompleto(p.confirmado_por)}
                      {p.observacion_confirmacion ? ` (${p.observacion_confirmacion})` : ''}
                    </Text>
                  )}
                  {estaAbierto && puedeConfirmarRecuperacion && (
                    <Button
                      size="xs"
                      variant="light"
                      color="green"
                      mt={4}
                      leftSection={<IconCheck size={14} />}
                      onClick={() => onConfirmarRecuperacion(p)}
                    >
                      Confirmar que volvió a funcionar
                    </Button>
                  )}
                </Stack>
              </Card>
            );
          })
        )}
      </Stack>
    </Card>
  );
}
