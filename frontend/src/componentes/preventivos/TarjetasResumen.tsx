import { SimpleGrid, Paper, Text, UnstyledButton } from '@mantine/core';
import type { EstadoVencimiento, VencimientosRespuesta } from '../../api/tipos';
import { obtenerInfoEstado } from '../../lib/estados';

interface Props {
  resumen: VencimientosRespuesta['resumen'] | undefined;
  /** El estado elegido con una tarjeta, o null con el filtro por omisión. */
  elegido: EstadoVencimiento | null;
  onTocar: (estado: EstadoVencimiento) => void;
  /** Solo algunas tarjetas (el tablero muestra tres). */
  estados?: EstadoVencimiento[];
}

const CLAVES: Record<EstadoVencimiento, keyof VencimientosRespuesta['resumen']> = {
  VENCIDA: 'vencidas',
  PROXIMA: 'proximas',
  SIN_LECTURA: 'sin_lectura',
  EN_CURSO: 'en_curso',
  AL_DIA: 'al_dia',
};

const TITULOS: Record<EstadoVencimiento, string> = {
  VENCIDA: 'Vencidas',
  PROXIMA: 'Próximas',
  SIN_LECTURA: 'Sin lectura',
  EN_CURSO: 'En curso',
  AL_DIA: 'Al día',
};

/**
 * Las tarjetas del resumen de vencimientos. Cada una es un filtro por estado. Todas en
 * una fila desde 1200 px (lg); en celular, de a dos.
 */
export function TarjetasResumen({
  resumen,
  elegido,
  onTocar,
  estados = ['VENCIDA', 'PROXIMA', 'SIN_LECTURA', 'EN_CURSO', 'AL_DIA'],
}: Props) {
  return (
    <SimpleGrid cols={{ base: 2, sm: Math.min(estados.length, 3), lg: estados.length }} spacing="sm">
      {estados.map((estado) => {
        const cantidad = resumen ? resumen[CLAVES[estado]] : null;
        const info = obtenerInfoEstado('tarea_preventiva', estado);
        const activa = elegido === estado;
        const color = cantidad ? info.color : 'gray';
        return (
          <UnstyledButton key={estado} onClick={() => onTocar(estado)} aria-pressed={activa}>
            <Paper
              withBorder
              p="md"
              style={{
                borderColor: activa ? `var(--mantine-color-${info.color}-6)` : undefined,
                borderWidth: activa ? 2 : 1,
              }}
            >
              <Text size="sm" c="dimmed">
                {TITULOS[estado]}
              </Text>
              <Text size="xl" fw={700} c={cantidad ? `${color}.7` : 'dimmed'}>
                {cantidad ?? '—'}
              </Text>
            </Paper>
          </UnstyledButton>
        );
      })}
    </SimpleGrid>
  );
}
