import { useMemo } from 'react';
import { Select } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { clienteApi } from '../../api/cliente';
import type { MaquinaLista, Planta, SectorLista } from '../../api/tipos';
import { etiquetaMaquina, coincideMaquina } from '../../lib/maquinas';
import type { FiltrosPreventivos } from '../../lib/preventivos';

interface Props {
  filtros: FiltrosPreventivos;
  onCambiar: (parcial: Partial<FiltrosPreventivos>) => void;
}

/**
 * Planta, sector y máquina de Preventivos (P1). Cambiar uno limpia los que dejan de encajar,
 * como en Intervenciones. La planta se muestra solo si hay más de una.
 */
export function FiltrosMaquinaPreventivos({ filtros, onCambiar }: Props) {
  const { data: plantas } = useQuery<Planta[]>({
    queryKey: ['plantas'],
    queryFn: () => clienteApi.get<Planta[]>('/api/plantas'),
    staleTime: 300000,
  });
  const { data: sectores } = useQuery<SectorLista[]>({
    queryKey: ['sectores'],
    queryFn: () => clienteApi.get<SectorLista[]>('/api/sectores'),
    staleTime: 300000,
  });
  const { data: maquinas } = useQuery<MaquinaLista[]>({
    queryKey: ['maquinas'],
    queryFn: () => clienteApi.get<MaquinaLista[]>('/api/maquinas'),
    staleTime: 300000,
  });

  const mostrarPlanta = (plantas?.length ?? 0) >= 2 || filtros.plantaId !== null;

  const sectoresVisibles = useMemo(
    () => (sectores || []).filter((s) => filtros.plantaId === null || s.planta?.id === filtros.plantaId),
    [sectores, filtros.plantaId]
  );
  const maquinasVisibles = useMemo(
    () =>
      (maquinas || []).filter(
        (m) =>
          (filtros.sectorId === null || m.sector.id === filtros.sectorId) &&
          (filtros.plantaId === null || m.sector.planta?.id === filtros.plantaId)
      ),
    [maquinas, filtros.sectorId, filtros.plantaId]
  );

  const cambiarPlanta = (val: string | null) => {
    const plantaId = val ? Number(val) : null;
    const sector = sectores?.find((s) => s.id === filtros.sectorId);
    const sectorId = plantaId !== null && sector && sector.planta?.id !== plantaId ? null : filtros.sectorId;
    const maquina = maquinas?.find((m) => m.id === filtros.maquinaId);
    const maquinaId =
      maquina && ((sectorId !== null && maquina.sector.id !== sectorId) || (plantaId !== null && maquina.sector.planta?.id !== plantaId))
        ? null
        : filtros.maquinaId;
    onCambiar({ plantaId, sectorId, maquinaId, pagina: 1 });
  };

  const cambiarSector = (val: string | null) => {
    const sectorId = val ? Number(val) : null;
    const maquina = maquinas?.find((m) => m.id === filtros.maquinaId);
    const maquinaId = sectorId !== null && maquina && maquina.sector.id !== sectorId ? null : filtros.maquinaId;
    onCambiar({ sectorId, maquinaId, pagina: 1 });
  };

  return (
    <>
      {mostrarPlanta && (
        <Select
          aria-label="Planta"
          placeholder="Planta"
          data={(plantas || []).map((p) => ({ value: String(p.id), label: p.nombre }))}
          value={filtros.plantaId ? String(filtros.plantaId) : null}
          onChange={cambiarPlanta}
          clearable
        />
      )}
      <Select
        aria-label="Sector"
        placeholder="Sector"
        data={sectoresVisibles.map((s) => ({ value: String(s.id), label: s.nombre }))}
        value={filtros.sectorId ? String(filtros.sectorId) : null}
        onChange={cambiarSector}
        clearable
      />
      <Select
        aria-label="Máquina"
        placeholder="Máquina"
        searchable
        data={maquinasVisibles.map((m) => ({ value: String(m.id), label: etiquetaMaquina(m) }))}
        filter={({ options, search }) => {
          if (!search) return options;
          return options.filter((opt) => {
            if (!('value' in opt)) return true;
            const maq = maquinas?.find((m) => String(m.id) === opt.value);
            return maq ? coincideMaquina(maq, search) : opt.label.toLowerCase().includes(search.toLowerCase());
          });
        }}
        value={filtros.maquinaId ? String(filtros.maquinaId) : null}
        onChange={(val) => onCambiar({ maquinaId: val ? Number(val) : null, pagina: 1 })}
        clearable
      />
    </>
  );
}
