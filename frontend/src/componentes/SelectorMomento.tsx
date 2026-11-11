import React from 'react';
import { Stack, SegmentedControl, Text } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import type { Momento } from '../lib/fechas';
import { fechaLocalTexto } from '../lib/fechas';

export interface SelectorMomentoProps {
  label: string;
  opcionAhoraLabel?: string;
  minimo?: string | Date | null;
  value: Momento;
  onChange: (val: Momento) => void;
  error?: string | null;
  disabled?: boolean;
}

export function SelectorMomento({
  label,
  opcionAhoraLabel = 'Ahora',
  minimo,
  value,
  onChange,
  error,
  disabled = false,
}: SelectorMomentoProps) {
  const minDate = minimo ? (typeof minimo === 'string' ? new Date(minimo) : minimo) : undefined;
  const maxDate = new Date();

  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>
        {label}
      </Text>
      <SegmentedControl
        value={value.modo}
        onChange={(val) => {
          if (val === 'ahora') {
            onChange({ modo: 'ahora', fecha: null });
          } else {
            onChange({ modo: 'otra', fecha: value.fecha || fechaLocalTexto(new Date()) });
          }
        }}
        data={[
          { label: opcionAhoraLabel, value: 'ahora' },
          { label: 'Otra fecha y hora', value: 'otra' },
        ]}
        disabled={disabled}
      />

      {value.modo === 'otra' && (
        <DateTimePicker
          valueFormat="DD/MM/YYYY HH:mm"
          placeholder="DD/MM/YYYY HH:mm"
          value={value.fecha}
          onChange={(val: unknown) => {
            const strVal = typeof val === 'string' ? val : (val as any) instanceof Date ? fechaLocalTexto(val as Date) : null;
            onChange({ modo: 'otra', fecha: strVal });
          }}
          minDate={minDate ? fechaLocalTexto(minDate) : undefined}
          maxDate={fechaLocalTexto(maxDate)}
          error={error}
          disabled={disabled}
        />
      )}
    </Stack>
  );
}

export default SelectorMomento;
