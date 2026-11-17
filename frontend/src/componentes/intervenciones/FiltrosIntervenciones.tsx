import { MultiSelect, Select, SimpleGrid, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconSearch } from '@tabler/icons-react';
import type { MaquinaLista, Planta, SectorLista } from '../../api/tipos';
import type { FiltrosIntervenciones as Filtros, VistaIntervenciones } from '../../lib/listado';
import { coincideMaquina, etiquetaMaquina } from '../../lib/maquinas';

const ESTADOS_OPCIONES: Record<VistaIntervenciones, Array<{ value: string; label: string }>> = {
  'sin-asignar': [],
  mias: [
    { value: 'PENDIENTE', label: 'Pendiente' },
    { value: 'EN_PROCESO', label: 'En proceso' },
    { value: 'EN_ESPERA_REPUESTOS', label: 'En espera de repuestos' },
  ],
  abiertas: [
    { value: 'PENDIENTE', label: 'Pendiente' },
    { value: 'EN_PROCESO', label: 'En proceso' },
    { value: 'EN_ESPERA_REPUESTOS', label: 'En espera de repuestos' },
  ],
  cerradas: [
    { value: 'FINALIZADA', label: 'Finalizada' },
    { value: 'CANCELADA', label: 'Cancelada' },
  ],
};

function aYYYYMMDD(val: unknown): string | null {
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
}

interface Props {
  filtros: Filtros;
  busqueda: string;
  onBusqueda: (texto: string) => void;
  mostrarPlanta: boolean;
  plantas: Planta[] | undefined;
  sectoresVisibles: SectorLista[];
  maquinasFiltradas: MaquinaLista[];
  /** Todas, para buscar por código y nombre en el select. */
  maquinas: MaquinaLista[] | undefined;
  onEstados: (val: string[]) => void;
  onPlanta: (val: string | null) => void;
  onSector: (val: string | null) => void;
  onMaquina: (val: string | null) => void;
  onTipo: (val: string | null) => void;
  onRangoFechas: (fechas: [string | null, string | null]) => void;
}

/** 5.2: los filtros de la lista de intervenciones. */
export function FiltrosIntervenciones({
  filtros,
  busqueda,
  onBusqueda,
  mostrarPlanta,
  plantas,
  sectoresVisibles,
  maquinasFiltradas,
  maquinas,
  onEstados,
  onPlanta,
  onSector,
  onMaquina,
  onTipo,
  onRangoFechas,
}: Props) {
  return (
    <SimpleGrid
      cols={{ base: 1, sm: 2, lg: 3, xl: mostrarPlanta ? 7 : 6 }}
      spacing="sm"
    >
      <TextInput
        aria-label="Buscar"
        placeholder="Máquina, código o descripción"
        leftSection={<IconSearch size={16} />}
        value={busqueda}
        onChange={(e) => onBusqueda(e.currentTarget.value)}
      />

      <MultiSelect
        aria-label="Estado"
        placeholder={filtros.estados.length === 0 ? 'Estado' : undefined}
        data={ESTADOS_OPCIONES[filtros.vista]}
        value={filtros.estados}
        onChange={onEstados}
        clearable
        disabled={filtros.vista === 'sin-asignar'}
      />

      {mostrarPlanta && (
        <Select
          aria-label="Planta"
          placeholder="Planta"
          data={(plantas || []).map((p) => ({
            value: String(p.id),
            label: p.nombre,
          }))}
          value={filtros.plantaId ? String(filtros.plantaId) : null}
          onChange={onPlanta}
          clearable
        />
      )}

      <Select
        aria-label="Sector"
        placeholder="Sector"
        data={sectoresVisibles.map((s) => ({
          value: String(s.id),
          label: s.nombre,
        }))}
        value={filtros.sectorId ? String(filtros.sectorId) : null}
        onChange={onSector}
        clearable
      />

      <Select
        aria-label="Máquina"
        placeholder="Máquina"
        searchable
        data={maquinasFiltradas.map((m) => ({
          value: String(m.id),
          label: etiquetaMaquina(m),
        }))}
        filter={({ options, search }) => {
          if (!search) return options;
          return options.filter((opt) => {
            if ('value' in opt) {
              const maq = maquinas?.find((m) => String(m.id) === opt.value);
              return maq ? coincideMaquina(maq, search) : opt.label.toLowerCase().includes(search.toLowerCase());
            }
            return true;
          });
        }}
        value={filtros.maquinaId ? String(filtros.maquinaId) : null}
        onChange={onMaquina}
        clearable
      />

      <Select
        aria-label="Tipo"
        data={[
          { value: 'TODAS', label: 'Todas' },
          { value: 'CORRECTIVO', label: 'Correctivas' },
          { value: 'PREVENTIVO', label: 'Preventivas' },
        ]}
        value={filtros.tipo ?? 'TODAS'}
        allowDeselect={false}
        onChange={onTipo}
      />

      <DatePickerInput
        aria-label="Reportadas entre"
        type="range"
        allowSingleDateInRange
        placeholder="Reportadas entre"
        valueFormat="DD/MM/YYYY"
        clearable
        value={
          filtros.desde || filtros.hasta
            ? [
                filtros.desde ? new Date(`${filtros.desde}T00:00:00`) : null,
                filtros.hasta ? new Date(`${filtros.hasta}T00:00:00`) : null,
              ]
            : [null, null]
        }
        onChange={(dates) => {
          if (!dates) {
            onRangoFechas([null, null]);
          } else {
            onRangoFechas([
              dates[0] ? aYYYYMMDD(dates[0]) : null,
              dates[1] ? aYYYYMMDD(dates[1]) : null,
            ]);
          }
        }}
      />
    </SimpleGrid>
  );
}
