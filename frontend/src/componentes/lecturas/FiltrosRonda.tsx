import { Group, Select, SimpleGrid, Stack, Switch, Text } from '@mantine/core';
import type { Planta, SectorLista } from '../../api/tipos';
import type { FiltrosLecturas } from '../../lib/lecturas';

interface Props {
  filtros: FiltrosLecturas;
  onCambiar: (cambios: Partial<FiltrosLecturas>) => void;
  plantas: Planta[];
  sectores: SectorLista[];
  /** Las máquinas con medidores, de la planta y el sector elegidos. */
  maquinas: Array<{ id: number; codigo: string | null; nombre: string }>;
  /** En el celular, solo el sector y "Solo atrasados" (4.3). */
  enCelular: boolean;
  /** Sin MAQUINAS_REGISTRAR_LECTURAS no hay campos: sin la ayuda de cómo cargar. */
  puedeCargar: boolean;
}

const aId = (v: string | null) => (v === null ? null : Number(v));

/** LE1, 4.1: los filtros de la ronda, con el interruptor "Solo atrasados" y la ayuda. */
export function FiltrosRonda({ filtros, onCambiar, plantas, sectores, maquinas, enCelular, puedeCargar }: Props) {
  const sectoresDePlanta = filtros.planta_id ? sectores.filter((s) => s.planta?.id === filtros.planta_id) : sectores;
  const opcionesSector = sectoresDePlanta.map((s) => ({ value: String(s.id), label: s.nombre }));

  const selectSector = (
    <Select
      label="Sector"
      placeholder="Todos los sectores"
      data={opcionesSector}
      value={filtros.sector_id === null ? null : String(filtros.sector_id)}
      onChange={(v) => onCambiar({ sector_id: aId(v), maquina_id: null })}
      searchable
      clearable
    />
  );
  const soloAtrasados = (
    <Switch
      label="Solo atrasados"
      checked={filtros.solo_atrasados}
      onChange={(e) => onCambiar({ solo_atrasados: e.currentTarget.checked })}
    />
  );

  return (
    <Stack gap="sm">
      {enCelular ? (
        <Stack gap="sm">
          {selectSector}
          {soloAtrasados}
        </Stack>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm" verticalSpacing="sm">
          <Select
            label="Planta"
            placeholder="Todas las plantas"
            data={plantas.map((p) => ({ value: String(p.id), label: p.nombre }))}
            value={filtros.planta_id === null ? null : String(filtros.planta_id)}
            onChange={(v) => onCambiar({ planta_id: aId(v), sector_id: null, maquina_id: null })}
            searchable
            clearable
          />
          {selectSector}
          <Select
            label="Máquina"
            placeholder="Todas las máquinas"
            data={maquinas.map((m) => ({ value: String(m.id), label: m.codigo ? `${m.codigo} · ${m.nombre}` : m.nombre }))}
            value={filtros.maquina_id === null ? null : String(filtros.maquina_id)}
            onChange={(v) => onCambiar({ maquina_id: aId(v) })}
            searchable
            clearable
          />
          <Group align="flex-end" pb={6}>
            {soloAtrasados}
          </Group>
        </SimpleGrid>
      )}
      {puedeCargar && (
        <Text size="sm" c="dimmed">
          Cargá la lectura de cada medidor que recorras. Los que dejes vacíos no se guardan.
        </Text>
      )}
    </Stack>
  );
}
