import { Link } from 'react-router';
import { Badge, Divider, Group, Paper, Skeleton, Stack, Text, Title } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import type { InactividadMaquina } from '../../api/tipos';
import { formatDuracion, formatFechaHora } from '../../lib/formato';
import { mensajeError } from '../../lib/errores';

function parseYMD(str: string | null): Date | null {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatYMD(val: Date | string | null): string | null {
  if (!val) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) return null;
    val = parsed;
  }
  const y = val.getFullYear();
  const m = String(val.getMonth() + 1).padStart(2, '0');
  const d = String(val.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface RangoInactividad {
  desde: string | null;
  hasta: string | null;
}

interface Props {
  rango: RangoInactividad;
  onCambiarRango: (rango: RangoInactividad) => void;
  /** La consulta vive en la pantalla: el rango no se pierde al cambiar de distribución. */
  cargando: boolean;
  error: unknown;
  datos: InactividadMaquina | undefined;
}

/** 6.10: la inactividad de la máquina en un período, con sus detenciones. */
export function BloqueInactividadMaquina({ rango, onCambiarRango, cargando, error, datos }: Props) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Title order={4}>Inactividad</Title>
          <DatePickerInput
            type="range"
            aria-label="Período de inactividad"
            placeholder="Desde — Hasta"
            valueFormat="DD/MM/YYYY"
            allowSingleDateInRange
            value={[
              parseYMD(rango.desde),
              parseYMD(rango.hasta),
            ]}
            onChange={([d, h]) => {
              const desdeFmt = formatYMD(d);
              const hastaFmt = formatYMD(h);
              if (desdeFmt && hastaFmt) {
                onCambiarRango({ desde: desdeFmt, hasta: hastaFmt });
              } else if (desdeFmt && !hastaFmt) {
                onCambiarRango({ desde: desdeFmt, hasta: null });
              }
            }}
            error={
              error
                ? mensajeError(error)
                : undefined
            }
            w={{ base: '100%', sm: 260 }}
          />
        </Group>
        <Divider />

        {cargando ? (
          <Skeleton height={80} />
        ) : datos ? (
          <Stack gap="md">
            <div>
              <Text size="xs" c="dimmed">
                Detenida
              </Text>
              <Text
                fw={700}
                style={{ fontSize: '1.6rem', lineHeight: 1.2 }}
              >
                {formatDuracion(datos.inactividad_minutos)}
              </Text>
              <Group gap="lg" mt={6}>
                <Text size="sm" c="dimmed">
                  Correctiva:{' '}
                  <Text span fw={600} c="dark">
                    {formatDuracion(
                      datos.por_tipo.CORRECTIVO
                    )}
                  </Text>
                </Text>
                <Text size="sm" c="dimmed">
                  Preventiva:{' '}
                  <Text span fw={600} c="dark">
                    {formatDuracion(
                      datos.por_tipo.PREVENTIVO
                    )}
                  </Text>
                </Text>
              </Group>
              {datos.fuera_de_servicio_descontado_minutos >
                0 && (
                <Text size="xs" c="dimmed" mt={4}>
                  Fuera de servicio (no cuenta):{' '}
                  {formatDuracion(
                    datos
                      .fuera_de_servicio_descontado_minutos
                  )}
                </Text>
              )}
            </div>

            {datos.periodos.length === 0 ? (
              <Text size="sm" c="dimmed">
                Sin detenciones en este período.
              </Text>
            ) : (
              <Stack gap="xs">
                {datos.periodos.map((p) => (
                  <Paper key={p.id} withBorder p="xs" radius="sm">
                    <Group justify="space-between" wrap="wrap" gap="xs">
                      <Text size="sm">
                        {formatFechaHora(p.desde)} →{' '}
                        {p.abierto || !p.hasta ? (
                          <Text span fw={600} c="red">
                            sigue detenida
                          </Text>
                        ) : (
                          formatFechaHora(p.hasta)
                        )}
                      </Text>
                      <Group gap="xs">
                        <Badge
                          size="xs"
                          variant="light"
                          color="gray"
                          styles={{ root: { textTransform: 'none' } }}
                        >
                          {p.tipo === 'PREVENTIVO'
                            ? 'Preventiva'
                            : 'Correctiva'}
                        </Badge>
                        <Text
                          component={Link}
                          to={`/intervenciones/${p.intervencion_id}`}
                          size="sm"
                          fw={500}
                          c="blue"
                          style={{ textDecoration: 'none' }}
                        >
                          Intervención N.º {p.intervencion_id}
                        </Text>
                      </Group>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            )}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}
