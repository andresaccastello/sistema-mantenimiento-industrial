import { BarChart } from '@mantine/charts';
import { formatPorcentajeFraccion } from '../../lib/graficos';
import { COLOR_GRILLA, COLOR_TEXTO_EJES, TarjetaGrafico, contenidoTooltip, useAltoGrafico } from './TarjetaGrafico';

export interface ParteProporcion {
  clave: string;
  etiqueta: string;
  valor: number;
  color: string;
}

interface Props {
  titulo: string;
  /** Dos o tres partes. */
  partes: ParteProporcion[];
  /** El valor de cada parte en el tooltip, además de su porcentaje. */
  formatear: (n: number) => string;
  cargando?: boolean;
  vacio?: boolean;
}

/** GR1, 3: una sola barra al 100 %, partida en dos o tres, con su leyenda. */
export function GraficoProporcion({ titulo, partes, formatear, cargando, vacio }: Props) {
  const alto = useAltoGrafico();
  const total = partes.reduce((acc, p) => acc + Math.max(0, p.valor), 0);
  const fila: Record<string, string | number> = { etiqueta: titulo };
  for (const p of partes) fila[p.clave] = Math.max(0, p.valor);

  const tooltip = contenidoTooltip(() => ({
    titulo,
    filas: partes.map((p) => ({
      etiqueta: p.etiqueta,
      color: p.color,
      valor: `${formatear(p.valor)} (${formatPorcentajeFraccion(total > 0 ? Math.max(0, p.valor) / total : 0)})`,
    })),
  }));

  return (
    <TarjetaGrafico titulo={titulo} cargando={cargando} vacio={vacio || total <= 0}>
      <BarChart
        h={alto}
        data={[fila]}
        dataKey="etiqueta"
        type="percent"
        orientation="vertical"
        series={partes.map((p) => ({ name: p.clave, label: p.etiqueta, color: p.color }))}
        withYAxis={false}
        withLegend
        legendProps={{ verticalAlign: 'bottom' }}
        gridAxis="none"
        tooltipProps={{ content: tooltip }}
        maxBarWidth={56}
        gridColor={COLOR_GRILLA}
        textColor={COLOR_TEXTO_EJES}
      />
    </TarjetaGrafico>
  );
}
