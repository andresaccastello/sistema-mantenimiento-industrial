import { BarChart, CompositeChart } from '@mantine/charts';
import { formatPorcentajeFraccion } from '../../lib/graficos';
import { useEsCelular } from '../../lib/useEsCelular';
import {
  COLOR_GRILLA,
  COLOR_TEXTO_EJES,
  FilaGrafico,
  SerieGrafico,
  TarjetaGrafico,
  contenidoTooltip,
  useAltoGrafico,
} from './TarjetaGrafico';

interface Props {
  titulo: string;
  /** Una fila por período, con `etiqueta` ("sep 26", "23/11") y una clave por serie. */
  datos: FilaGrafico[];
  /** Las cantidades, en barras, contra el eje de la izquierda. */
  barras: SerieGrafico[];
  /** El porcentaje (una fracción de 0 a 1), en línea, contra el eje de la derecha. Sin línea, barras solas. */
  linea?: SerieGrafico;
  /** El formato de las barras en el eje y en el tooltip. */
  formatear: (n: number) => string;
  cargando?: boolean;
  vacio?: boolean;
}

/** GR1, 3: barras con línea y eje doble (cantidades a la izquierda, porcentaje a la derecha). */
export function GraficoEvolucion({ titulo, datos, barras, linea, formatear, cargando, vacio }: Props) {
  const alto = useAltoGrafico();
  const celular = useEsCelular();

  const tooltip = contenidoTooltip((fila) => ({
    titulo: String(fila.titulo ?? fila.etiqueta),
    filas: [
      ...barras.map((s) => ({ etiqueta: s.etiqueta, color: s.color, valor: formatear(Number(fila[s.clave] ?? 0)) })),
      ...(linea
        ? [
            {
              etiqueta: linea.etiqueta,
              color: linea.color,
              valor: fila[linea.clave] === null ? '—' : formatPorcentajeFraccion(Number(fila[linea.clave])),
            },
          ]
        : []),
    ],
  }));

  const ejeX = {
    tick: { fontSize: celular ? 10 : 12 },
    interval: 'preserveStartEnd' as const,
    minTickGap: 4,
  };
  const ejeY = { tickFormatter: formatear, allowDecimals: false, width: celular ? 36 : 56, tick: { fontSize: celular ? 10 : 12 } };

  return (
    <TarjetaGrafico titulo={titulo} cargando={cargando} vacio={vacio}>
      {linea ? (
        <CompositeChart
          h={alto}
          data={datos}
          dataKey="etiqueta"
          series={[
            ...barras.map((s) => ({ name: s.clave, label: s.etiqueta, color: s.color, type: 'bar' as const })),
            { name: linea.clave, label: linea.etiqueta, color: linea.color, type: 'line' as const, yAxisId: 'right' },
          ]}
          withLegend
          legendProps={{ verticalAlign: 'bottom' }}
          withRightYAxis
          rightYAxisProps={{
            domain: [0, 1],
            tickFormatter: (v: number) => formatPorcentajeFraccion(v),
            width: celular ? 44 : 56,
            tick: { fontSize: celular ? 10 : 12 },
          }}
          xAxisProps={ejeX}
          yAxisProps={ejeY}
          tooltipProps={{ content: tooltip }}
          connectNulls={false}
          maxBarWidth={32}
          gridColor={COLOR_GRILLA}
          textColor={COLOR_TEXTO_EJES}
        />
      ) : (
        <BarChart
          h={alto}
          data={datos}
          dataKey="etiqueta"
          series={barras.map((s) => ({ name: s.clave, label: s.etiqueta, color: s.color }))}
          withLegend={barras.length > 1}
          legendProps={{ verticalAlign: 'bottom' }}
          xAxisProps={ejeX}
          yAxisProps={ejeY}
          tooltipProps={{ content: tooltip }}
          maxBarWidth={32}
          gridColor={COLOR_GRILLA}
          textColor={COLOR_TEXTO_EJES}
        />
      )}
    </TarjetaGrafico>
  );
}
