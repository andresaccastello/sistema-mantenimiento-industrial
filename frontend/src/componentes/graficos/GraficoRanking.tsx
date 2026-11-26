import { BarChart } from '@mantine/charts';
import { acortar, type ItemRanking } from '../../lib/graficos';
import { useEsCelular } from '../../lib/useEsCelular';
import { COLOR_GRILLA, COLOR_TEXTO_EJES, TarjetaGrafico, contenidoTooltip, useAltoGrafico } from './TarjetaGrafico';

interface Props {
  titulo: string;
  /** Ya ordenados y recortados (top N con "Otras"), de mayor a menor. */
  items: ItemRanking[];
  /** El nombre del valor en el tooltip: "Horas paradas", "Importe". */
  nombreValor: string;
  color: string;
  /** El valor al final de cada barra y en el tooltip. */
  formatear: (n: number) => string;
  /** El eje de los valores, más corto. */
  formatearEje: (n: number) => string;
  /** Un eje fijo, por ejemplo [0, 1] para un porcentaje. */
  dominio?: [number, number];
  cargando?: boolean;
  vacio?: boolean;
}

/**
 * GR1, 3: barras horizontales, con la etiqueta de la máquina o el repuesto a la izquierda y el
 * valor formateado al final de cada barra.
 */
export function GraficoRanking({ titulo, items, nombreValor, color, formatear, formatearEje, dominio, cargando, vacio }: Props) {
  const alto = useAltoGrafico();
  const celular = useEsCelular();
  const largo = celular ? 12 : 22;

  const datos = items.map((i) => ({ etiqueta: acortar(i.etiqueta, largo), titulo: i.etiqueta, valor: i.valor }));

  const tooltip = contenidoTooltip((fila) => ({
    titulo: String(fila.titulo),
    filas: [{ etiqueta: nombreValor, color, valor: formatear(Number(fila.valor)) }],
  }));

  return (
    <TarjetaGrafico titulo={titulo} cargando={cargando} vacio={vacio}>
      <BarChart
        h={alto}
        data={datos}
        dataKey="etiqueta"
        orientation="vertical"
        series={[{ name: 'valor', label: nombreValor, color }]}
        gridAxis="none"
        withXAxis={false}
        yAxisProps={{ width: celular ? 84 : 150, tick: { fontSize: celular ? 10 : 12 }, interval: 0 }}
        xAxisProps={{ tickFormatter: formatearEje, domain: dominio }}
        withBarValueLabel
        valueLabelProps={{ position: 'right', formatter: (v: unknown) => formatear(Number(v)), fontSize: celular ? 10 : 12 }}
        barChartProps={{ margin: { right: celular ? 56 : 80 } }}
        tooltipProps={{ content: tooltip }}
        maxBarWidth={24}
        gridColor={COLOR_GRILLA}
        textColor={COLOR_TEXTO_EJES}
      />
    </TarjetaGrafico>
  );
}
