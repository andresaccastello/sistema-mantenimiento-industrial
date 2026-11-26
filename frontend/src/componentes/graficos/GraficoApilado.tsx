import { BarChart } from '@mantine/charts';
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
  /** Una fila por período o por grupo, con `etiqueta` y una clave por serie. */
  datos: FilaGrafico[];
  series: SerieGrafico[];
  /** El valor en el tooltip. */
  formatear: (n: number) => string;
  /** El eje de los valores, más corto. */
  formatearEje: (n: number) => string;
  /** Apiladas (por omisión) o agrupadas, una al lado de la otra. */
  agrupadas?: boolean;
  /** Una aclaración en el tooltip de una fila, por ejemplo un valor que se recortó a 0. */
  nota?: (fila: FilaGrafico) => string | null;
  cargando?: boolean;
  vacio?: boolean;
}

/** GR1, 3: barras apiladas por período, con leyenda. Con `agrupadas`, una al lado de la otra. */
export function GraficoApilado({ titulo, datos, series, formatear, formatearEje, agrupadas = false, nota, cargando, vacio }: Props) {
  const alto = useAltoGrafico();
  const celular = useEsCelular();

  const tooltip = contenidoTooltip((fila) => ({
    titulo: String(fila.titulo ?? fila.etiqueta),
    filas: series.map((s) => ({ etiqueta: s.etiqueta, color: s.color, valor: formatear(Number(fila[s.clave] ?? 0)) })),
    nota: nota ? nota(fila) : null,
  }));

  return (
    <TarjetaGrafico titulo={titulo} cargando={cargando} vacio={vacio}>
      <BarChart
        h={alto}
        data={datos}
        dataKey="etiqueta"
        type={agrupadas ? 'default' : 'stacked'}
        series={series.map((s) => ({ name: s.clave, label: s.etiqueta, color: s.color }))}
        withLegend
        legendProps={{ verticalAlign: 'bottom' }}
        xAxisProps={{ tick: { fontSize: celular ? 10 : 12 }, interval: 'preserveStartEnd', minTickGap: 4 }}
        yAxisProps={{ tickFormatter: formatearEje, width: celular ? 52 : 72, tick: { fontSize: celular ? 10 : 12 } }}
        tooltipProps={{ content: tooltip }}
        maxBarWidth={agrupadas ? 20 : 32}
        gridColor={COLOR_GRILLA}
        textColor={COLOR_TEXTO_EJES}
      />
    </TarjetaGrafico>
  );
}
