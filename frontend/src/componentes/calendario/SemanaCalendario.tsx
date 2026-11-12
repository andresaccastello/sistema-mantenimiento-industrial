import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import type { EventoCalendario } from '../../api/tipos';
import { DIAS_SEMANA_CORTOS, diasDeLaSemana } from '../../lib/calendario';
import { etiquetaMaquina } from '../../lib/maquinas';
import { BadgeEvento, estiloEvento } from './PiezasEvento';

interface Props {
  fecha: string;
  hoy: string;
  porDia: Map<string, EventoCalendario[]>;
  onAbrirDia: (fecha: string) => void;
}

const BORDE = '1px solid var(--mantine-color-gray-3)';

/**
 * CAL1, 3.3: la vista de semana, siete columnas con todos sus eventos como tarjetitas.
 * Si las columnas no entran, la barra horizontal va solo acá, no en la página.
 */
export function SemanaCalendario({ fecha, hoy, porDia, onAbrirDia }: Props) {
  const dias = diasDeLaSemana(fecha);
  return (
    <Box style={{ overflowX: 'auto' }}>
      <Box
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(150px, 1fr))',
          border: BORDE,
          borderRadius: 8,
          minWidth: 7 * 150,
        }}
      >
        {dias.map((dia, i) => {
          const eventos = porDia.get(dia) ?? [];
          const esHoy = dia === hoy;
          return (
            <Box key={dia} style={{ borderLeft: i === 0 ? undefined : BORDE, minWidth: 0, minHeight: 240 }}>
              <Box
                py={6}
                px="xs"
                style={{
                  borderBottom: BORDE,
                  background: esHoy ? 'var(--mantine-color-marca-light)' : 'var(--mantine-color-gray-0)',
                }}
              >
                <Text size="xs" fw={600} c={esHoy ? 'marca' : 'dimmed'}>
                  {DIAS_SEMANA_CORTOS[i]} {Number(dia.slice(8, 10))}/{Number(dia.slice(5, 7))}
                </Text>
              </Box>
              <Stack gap={6} p={6}>
                {eventos.map((e, j) => (
                  <UnstyledButton
                    key={`${e.tipo}-${e.tarea_id}-${e.intervencion?.id ?? j}`}
                    onClick={() => onAbrirDia(dia)}
                    style={{ ...estiloEvento(e), borderRadius: 6, padding: 6, display: 'block', minWidth: 0 }}
                  >
                    <Text size="xs" fw={600} c={e.tipo === 'PREVISTA' ? 'dimmed' : '#0f172a'} lineClamp={2}>
                      {etiquetaMaquina(e.maquina)}
                    </Text>
                    <Text size="xs" c={e.tipo === 'PREVISTA' ? 'dimmed' : '#0f172a'} lineClamp={2}>
                      {e.accion}
                    </Text>
                    <Box my={4}>
                      <BadgeEvento evento={e} size="xs" />
                    </Box>
                    <Text size="10px" c="dimmed" truncate="end">
                      {e.plan.nombre}
                    </Text>
                  </UnstyledButton>
                ))}
              </Stack>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
