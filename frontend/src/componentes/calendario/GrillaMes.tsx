import { Box, Text, UnstyledButton } from '@mantine/core';
import type { EventoCalendario } from '../../api/tipos';
import { DIAS_SEMANA_CORTOS, semanasDelMes, textoDia, visiblesEnCelda } from '../../lib/calendario';
import { estiloEvento, textoLineaEvento } from './PiezasEvento';

/** Cuántos eventos entran en una celda antes de "+N más" (3.2). */
const POR_CELDA = 3;

interface Props {
  fecha: string;
  hoy: string;
  porDia: Map<string, EventoCalendario[]>;
  onAbrirDia: (fecha: string) => void;
}

const BORDE = '1px solid var(--mantine-color-gray-3)';

/** CAL1, 3.2: la vista de mes, de lunes a domingo, de 4 a 6 filas. */
export function GrillaMes({ fecha, hoy, porDia, onAbrirDia }: Props) {
  const semanas = semanasDelMes(fecha);
  return (
    <Box style={{ border: BORDE, borderRadius: 8, overflow: 'hidden' }}>
      <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', background: 'var(--mantine-color-gray-0)' }}>
        {DIAS_SEMANA_CORTOS.map((d) => (
          <Text key={d} size="xs" fw={600} c="dimmed" ta="center" py={6} style={{ borderBottom: BORDE }}>
            {d}
          </Text>
        ))}
      </Box>
      {semanas.map((semana) => (
        <Box key={semana[0].fecha} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
          {semana.map((dia, i) => {
            const eventos = porDia.get(dia.fecha) ?? [];
            const { visibles, mas } = visiblesEnCelda(eventos, POR_CELDA);
            const esHoy = dia.fecha === hoy;
            return (
              <UnstyledButton
                key={dia.fecha}
                onClick={() => onAbrirDia(dia.fecha)}
                aria-label={`${textoDia(dia.fecha)}: ${eventos.length} ${eventos.length === 1 ? 'preventivo' : 'preventivos'}`}
                style={{
                  minHeight: 112,
                  minWidth: 0,
                  padding: 6,
                  borderTop: BORDE,
                  borderLeft: i === 0 ? undefined : BORDE,
                  background: esHoy ? 'var(--mantine-color-marca-light)' : undefined,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  alignItems: 'stretch',
                  justifyContent: 'flex-start',
                }}
              >
                <Text
                  size="xs"
                  fw={esHoy ? 700 : 500}
                  c={esHoy ? 'marca' : dia.delMes ? undefined : 'dimmed'}
                  style={{ opacity: dia.delMes ? 1 : 0.6 }}
                >
                  {Number(dia.fecha.slice(8, 10))}
                </Text>
                <Box style={{ opacity: dia.delMes ? 1 : 0.6, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  {visibles.map((e, j) => (
                    <Text
                      key={`${e.tipo}-${e.tarea_id}-${e.intervencion?.id ?? j}`}
                      size="xs"
                      truncate="end"
                      style={{ ...estiloEvento(e), borderRadius: 4, padding: '1px 4px', lineHeight: 1.4 }}
                    >
                      {textoLineaEvento(e)}
                    </Text>
                  ))}
                  {mas > 0 && (
                    <Text size="xs" c="dimmed" fw={500}>
                      +{mas} más
                    </Text>
                  )}
                </Box>
              </UnstyledButton>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
