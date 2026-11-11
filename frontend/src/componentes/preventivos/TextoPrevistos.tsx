import { Text, Tooltip } from '@mantine/core';
import { PrevistoParaTexto, textoPrevistos } from '../../lib/preventivos';

interface Props {
  repuestos: PrevistoParaTexto[];
  size?: 'xs' | 'sm';
  dimmed?: boolean;
}

/** Los repuestos previstos de una tarea. Con más de dos, resumidos, y la lista en el Tooltip. */
export function TextoPrevistos({ repuestos, size = 'sm', dimmed = false }: Props) {
  const { texto, detalle } = textoPrevistos(repuestos);
  if (!texto) return null;
  return (
    <Tooltip label={detalle ?? ''} disabled={!detalle} multiline maw={320} withinPortal>
      <Text size={size} c={dimmed ? 'dimmed' : undefined}>
        {texto}
      </Text>
    </Tooltip>
  );
}
