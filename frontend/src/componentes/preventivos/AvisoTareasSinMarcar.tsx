import { useQuery } from '@tanstack/react-query';
import { Alert } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { IntervencionTareasRespuesta } from '../../api/tipos';
import { avisoTareasSinMarcar } from '../../lib/preventivos';

interface Props {
  intervencionId: number;
  /** Solo con el diálogo abierto y una intervención con plan. */
  activo: boolean;
}

/** Finalizar y Resolver ahora: el aviso amarillo de tareas sin marcar. No impide finalizar. */
export function AvisoTareasSinMarcar({ intervencionId, activo }: Props) {
  const { data } = useQuery<IntervencionTareasRespuesta>({
    queryKey: ['intervencion', intervencionId, 'tareas'],
    queryFn: () => clienteApi.get<IntervencionTareasRespuesta>(`/api/intervenciones/${intervencionId}/tareas`),
    enabled: activo,
  });
  const aviso = activo && data ? avisoTareasSinMarcar(data.resumen) : null;
  if (!aviso) return null;
  return (
    <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
      {aviso}
    </Alert>
  );
}
