import '@mantine/charts/styles.css';
import type { ReactNode } from 'react';
import { Center, Group, Paper, Skeleton, Stack, Text } from '@mantine/core';
import { useEsCelular } from '../../lib/useEsCelular';

/** GR1, 3: 280 px en la computadora y 220 px en el celular; el ancho, siempre al 100 %. */
export function useAltoGrafico(): number {
  return useEsCelular() ? 220 : 280;
}

/** Una serie de un gráfico: la clave en los datos, el nombre en la leyenda y su color `--sm-graf-*`. */
export interface SerieGrafico {
  clave: string;
  etiqueta: string;
  color: string;
}

/** Los colores de la grilla y de los ejes, comunes a todos los gráficos. */
export const COLOR_GRILLA = 'var(--sm-linea)';
export const COLOR_TEXTO_EJES = 'var(--sm-tenue)';

interface PropsTarjeta {
  /** La conclusión, o un título descriptivo si no hay una clara. Lo arma quien llama, desde lib. */
  titulo: string;
  cargando?: boolean;
  /** Todo en cero o la lista vacía: en lugar del gráfico vacío, "Sin datos en el período". */
  vacio?: boolean;
  children: ReactNode;
}

/** GR1, 3: la tarjeta de un gráfico, con el título adentro y el mismo alto mientras carga. */
export function TarjetaGrafico({ titulo, cargando = false, vacio = false, children }: PropsTarjeta) {
  const alto = useAltoGrafico();
  return (
    <Paper withBorder p="md" radius="sm" style={{ minWidth: 0 }}>
      <Stack gap="sm">
        <Text fw={600} size="sm" c="var(--sm-titulo)">
          {titulo}
        </Text>
        {cargando ? (
          <Skeleton height={alto} radius="sm" />
        ) : vacio ? (
          <Center h={alto}>
            <Text size="sm" c="var(--sm-tenue)">
              Sin datos en el período
            </Text>
          </Center>
        ) : (
          <div style={{ width: '100%', minWidth: 0 }}>{children}</div>
        )}
      </Stack>
    </Paper>
  );
}

/** Una línea del tooltip: la serie, su color y el valor ya formateado. */
export interface FilaTooltip {
  etiqueta: string;
  valor: string;
  color: string;
}

/** GR1, 3: el tooltip de los gráficos, con los números formateados en castellano. */
export function TooltipGrafico({ titulo, filas, nota }: { titulo: string; filas: FilaTooltip[]; nota?: string | null }) {
  return (
    <Paper withBorder shadow="sm" p="xs" radius="sm" style={{ maxWidth: 260 }}>
      <Stack gap={4}>
        <Text size="xs" fw={600} c="var(--sm-titulo)">
          {titulo}
        </Text>
        {filas.map((f) => (
          <Group key={f.etiqueta} gap="xs" wrap="nowrap" justify="space-between">
            <Group gap={6} wrap="nowrap">
              <span
                aria-hidden
                style={{ width: 10, height: 10, borderRadius: 2, background: f.color, flexShrink: 0 }}
              />
              <Text size="xs" c="var(--sm-texto)">
                {f.etiqueta}
              </Text>
            </Group>
            <Text size="xs" fw={600} c="var(--sm-titulo)" style={{ whiteSpace: 'nowrap' }}>
              {f.valor}
            </Text>
          </Group>
        ))}
        {nota && (
          <Text size="xs" c="var(--sm-tenue)">
            {nota}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

/** Una fila de datos de un gráfico: la etiqueta del eje y los valores de cada serie. */
export type FilaGrafico = Record<string, string | number | boolean | null>;

/** Lo que recharts le pasa al contenido del tooltip: la fila de datos está en `payload[0].payload`. */
interface PropsContenido {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}

/** El contenido del tooltip a partir de la fila de datos. */
export function contenidoTooltip(armar: (fila: FilaGrafico) => { titulo: string; filas: FilaTooltip[]; nota?: string | null }) {
  return function Contenido({ active, payload }: PropsContenido) {
    const fila = payload?.[0]?.payload as FilaGrafico | undefined;
    if (!active || !fila) return null;
    return <TooltipGrafico {...armar(fila)} />;
  };
}
