import { Select } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { clienteApi } from '../../api/cliente';
import type { Persona } from '../../api/tipos';
import { nombreCompleto } from '../../lib/personas';

interface Props {
  maquinaId: number | null;
  value: string | null;
  onChange: (value: string | null) => void;
  /** El responsable actual, por si ya no está entre los habilitados. */
  actual?: Persona | null;
  error?: string | null;
}

const SIN_RESPONSABLE = 'sin';

/**
 * El responsable de un plan (PV2, 1.1): los habilitados para el sector de la máquina,
 * con la opción "Sin responsable". Se carga al elegir la máquina.
 */
export function SelectResponsablePlan({ maquinaId, value, onChange, actual, error }: Props) {
  const { data: personas, isLoading } = useQuery<Persona[]>({
    queryKey: ['planes', 'responsables', maquinaId],
    queryFn: () =>
      clienteApi.get<Persona[]>('/api/planes/responsables-habilitados', { params: { maquina_id: maquinaId } }),
    enabled: maquinaId !== null,
  });

  const opciones = (personas || []).map((p) => ({ value: String(p.id), label: `${nombreCompleto(p)} (${p.legajo})` }));
  if (actual && !opciones.some((o) => o.value === String(actual.id))) {
    opciones.push({ value: String(actual.id), label: `${nombreCompleto(actual)} (${actual.legajo})` });
  }

  return (
    <Select
      label="Responsable"
      description="Quién recibe las intervenciones que se generan desde el plan."
      placeholder={maquinaId === null ? 'Elegí primero la máquina' : 'Sin responsable'}
      disabled={maquinaId === null || isLoading}
      searchable
      data={[{ value: SIN_RESPONSABLE, label: 'Sin responsable' }, ...opciones]}
      value={value ?? SIN_RESPONSABLE}
      onChange={(v) => onChange(v && v !== SIN_RESPONSABLE ? v : null)}
      allowDeselect={false}
      error={error}
    />
  );
}
