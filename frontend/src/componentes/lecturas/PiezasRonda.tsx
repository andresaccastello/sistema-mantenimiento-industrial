import { Link } from 'react-router';
import { Anchor, Badge, Group, Stack, Text } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import type { MedidorRonda, TareaRonda } from '../../api/tipos';
import { confirmarSalida } from '../../app/salida';
import { textoTareaRonda, type Consecuencia } from '../../lib/lecturas';
import { TEXTO_CHIP_POR_USO } from '../../lib/estimacion';
import { CampoNumero } from '../CampoNumero';
import { EstadoBadge } from '../EstadoBadge';

/** Lo que dejó guardar un medidor (4.2): "✓ Guardada" y, debajo, lo que cambió. */
export function ResultadoGuardado({ consecuencias }: { consecuencias: Consecuencia[] }) {
  return (
    <Stack gap={2}>
      <Group gap={4} wrap="nowrap">
        <IconCheck size={14} color="var(--mantine-color-green-7)" />
        <Text size="sm" c="green.7" fw={600}>
          Guardada
        </Text>
      </Group>
      {consecuencias.map((c) =>
        c.intervencionId !== undefined ? (
          <Anchor
            key={c.texto}
            component={Link}
            to={`/intervenciones/${c.intervencionId}`}
            size="xs"
            onClick={(e) => {
              if (!confirmarSalida()) e.preventDefault();
            }}
          >
            {c.texto}
          </Anchor>
        ) : (
          <Text key={c.texto} size="xs" c="dimmed">
            {c.texto}
          </Text>
        )
      )}
    </Stack>
  );
}

/** "Atrasado", en rojo. */
export function InsigniaAtrasado() {
  return (
    <Badge color="red" variant="filled" size="sm" style={{ flexShrink: 0 }}>
      Atrasado
    </Badge>
  );
}

/**
 * HE1, 6: por el ritmo de uso, una tarea ya estaría para avisar o vencida, y ninguna lectura lo
 * confirma. No muestra el valor estimado: invita a copiarlo sin mirar el medidor.
 */
export function ChipPorUso() {
  return (
    <Badge color="orange" variant="light" size="sm" style={{ flexShrink: 0 }} styles={{ root: { textTransform: 'none' } }}>
      {TEXTO_CHIP_POR_USO}
    </Badge>
  );
}

/** Una tarea: "Cambiar aceite · faltan 160 horas", con el badge de su estado. */
export function LineaTarea({ tarea, unidad }: { tarea: TareaRonda; unidad: string }) {
  return (
    <Group gap={6} wrap="nowrap" align="center">
      <EstadoBadge entidad="tarea_preventiva" estado={tarea.estado} size="xs" />
      <Text size="sm" style={{ minWidth: 0 }}>
        {textoTareaRonda(tarea, unidad)}
      </Text>
    </Group>
  );
}

interface CampoProps {
  medidor: MedidorRonda;
  valor: string | number | undefined;
  onCambiar: (valor: string | number) => void;
  error: string | null;
  /** En el celular: más grande. */
  grande?: boolean;
  deshabilitado?: boolean;
}

/** El campo de la lectura nueva, con la unidad a la derecha y el teclado numérico en el celular. */
export function CampoLectura({ medidor, valor, onCambiar, error, grande = false, deshabilitado = false }: CampoProps) {
  return (
    <CampoNumero
      aria-label={`Nueva lectura de ${medidor.nombre}`}
      placeholder={medidor.ultima ? undefined : 'Sin lecturas'}
      decimalScale={2}
      allowNegative={false}
      inputMode="decimal"
      size={grande ? 'lg' : 'sm'}
      rightSection={
        <Text size="xs" c="dimmed" pr="xs">
          {medidor.unidad}
        </Text>
      }
      rightSectionWidth={Math.min(110, 18 + medidor.unidad.length * 8)}
      value={valor ?? ''}
      onChange={onCambiar}
      error={error}
      disabled={deshabilitado}
    />
  );
}
