import React from 'react';
import { Stack, SegmentedControl, Text, Textarea, Alert } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { SelectorMomento } from './SelectorMomento';
import type { Momento } from '../lib/fechas';

export interface SeccionRecuperacionMaquinaProps {
  puedeConfirmar: boolean;
  minimoDesde?: string | Date | null;
  incluyeFecha?: boolean; // false para Eliminar
  primeraOpcionFechaLabel?: string; // 'Al terminar el trabajo' o 'Ahora'
  maquinaRecuperada: boolean | null;
  onMaquinaRecuperadaChange: (val: boolean) => void;
  momentoRecuperacion: Momento;
  onMomentoRecuperacionChange: (val: Momento) => void;
  errorMomento?: string | null;
  observacionRecuperacion: string;
  onObservacionRecuperacionChange: (val: string) => void;
  disabled?: boolean;
}

export function SeccionRecuperacionMaquina({
  puedeConfirmar,
  minimoDesde,
  incluyeFecha = true,
  primeraOpcionFechaLabel = 'Ahora',
  maquinaRecuperada,
  onMaquinaRecuperadaChange,
  momentoRecuperacion,
  onMomentoRecuperacionChange,
  errorMomento,
  observacionRecuperacion,
  onObservacionRecuperacionChange,
  disabled = false,
}: SeccionRecuperacionMaquinaProps) {
  if (!puedeConfirmar) {
    return (
      <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
        La máquina va a seguir figurando detenida hasta que alguien con permiso confirme que volvió a funcionar.
      </Alert>
    );
  }

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        ¿La máquina volvió a funcionar?
      </Text>
      <SegmentedControl
        value={
          maquinaRecuperada === true
            ? 'si'
            : maquinaRecuperada === false
            ? 'no'
            : ''
        }
        onChange={(val) => onMaquinaRecuperadaChange(val === 'si')}
        data={[
          { label: 'Sí, ya funciona', value: 'si' },
          { label: 'No, sigue detenida', value: 'no' },
        ]}
        disabled={disabled}
      />

      {maquinaRecuperada === true && (
        <Stack gap="xs" mt="xs">
          {incluyeFecha && (
            <SelectorMomento
              label="¿Desde cuándo funciona?"
              opcionAhoraLabel={primeraOpcionFechaLabel}
              minimo={minimoDesde}
              value={momentoRecuperacion}
              onChange={onMomentoRecuperacionChange}
              error={errorMomento}
              disabled={disabled}
            />
          )}
          <Textarea
            label="Observación de la recuperación (opcional)"
            value={observacionRecuperacion}
            onChange={(e) => onObservacionRecuperacionChange(e.currentTarget.value)}
            disabled={disabled}
          />
        </Stack>
      )}
    </Stack>
  );
}

export default SeccionRecuperacionMaquina;
