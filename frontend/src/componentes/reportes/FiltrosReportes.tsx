import { SimpleGrid, Select, Stack, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { Planta, SectorLista } from '../../api/tipos';
import { FiltrosReportes, formatFechaCorta, PeriodoOpcion } from '../../lib/reportes';

interface Props {
  filtros: FiltrosReportes;
  onFiltrosChange: (cambios: Partial<FiltrosReportes>) => void;
  plantas?: Planta[];
  sectores?: SectorLista[];
  rango: { desde: string; hasta: string };
}

const OPCIONES_PERIODO = [
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: 'mes', label: 'Este mes' },
  { value: 'mes-anterior', label: 'Mes anterior' },
  { value: 'personalizado', label: 'Personalizado' },
];

export function FiltrosReportesBarra({
  filtros,
  onFiltrosChange,
  plantas = [],
  sectores = [],
  rango,
}: Props) {
  // Sectores filtrados por la planta elegida
  const sectoresFiltrados = filtros.planta
    ? sectores.filter((s) => s.planta?.id === filtros.planta)
    : sectores;

  const fechaDesde = formatFechaCorta(rango.desde);
  const fechaHastaInclusive = (() => {
    const hDate = new Date(rango.hasta);
    if (hDate.getHours() === 0 && hDate.getMinutes() === 0 && hDate.getSeconds() === 0) {
      return new Date(hDate.getTime() - 1000);
    }
    return hDate;
  })();
  const fechaHasta = formatFechaCorta(fechaHastaInclusive);

  const esPersonalizado = filtros.periodo === 'personalizado';

  const dateValue: [Date | null, Date | null] = [
    filtros.desde ? new Date(filtros.desde + 'T00:00:00') : null,
    filtros.hasta ? new Date(filtros.hasta + 'T00:00:00') : null,
  ];

  const handlePeriodoChange = (val: string | null) => {
    if (!val) return;
    const nuevoPeriodo = val as PeriodoOpcion;
    if (nuevoPeriodo === 'personalizado') {
      onFiltrosChange({ periodo: nuevoPeriodo });
    } else {
      onFiltrosChange({ periodo: nuevoPeriodo, desde: null, hasta: null });
    }
  };

  const aYYYYMMDD = (val: unknown): string | null => {
    if (!val) return null;
    if (typeof val === 'string') {
      return val.slice(0, 10);
    }
    if (val instanceof Date) {
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const day = String(val.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    return null;
  };

  const handleDateRangeChange = (val: any) => {
    if (!val) {
      onFiltrosChange({ desde: null, hasta: null });
      return;
    }
    const [d, h] = val;
    onFiltrosChange({
      desde: aYYYYMMDD(d),
      hasta: aYYYYMMDD(h),
    });
  };

  return (
    <Stack gap="xs">
      <SimpleGrid cols={{ base: 1, sm: esPersonalizado ? 4 : 3 }} spacing="sm">
        <Select
          label="Período"
          data={OPCIONES_PERIODO}
          value={filtros.periodo}
          onChange={handlePeriodoChange}
          allowDeselect={false}
        />

        {esPersonalizado && (
          <DatePickerInput
            label="Rango personalizado"
            type="range"
            placeholder="Desde — Hasta"
            valueFormat="DD/MM/YYYY"
            value={dateValue}
            onChange={handleDateRangeChange}
            clearable
          />
        )}

        <Select
          label="Planta"
          placeholder="Todas las plantas"
          data={plantas.map((p) => ({ value: String(p.id), label: p.nombre }))}
          value={filtros.planta ? String(filtros.planta) : null}
          onChange={(val) =>
            onFiltrosChange({
              planta: val ? Number(val) : null,
              sector: null,
            })
          }
          clearable
        />

        <Select
          label="Sector"
          placeholder="Todos los sectores"
          data={sectoresFiltrados.map((s) => ({ value: String(s.id), label: s.nombre }))}
          value={filtros.sector ? String(filtros.sector) : null}
          onChange={(val) => onFiltrosChange({ sector: val ? Number(val) : null })}
          clearable
        />
      </SimpleGrid>

      <Text c="dimmed" size="sm">
        Del {fechaDesde} al {fechaHasta}.
      </Text>
    </Stack>
  );
}
