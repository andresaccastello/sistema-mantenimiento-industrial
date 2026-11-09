import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Stack, Checkbox, Group, Text, Button, Alert, Loader, Center } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { GeneracionRespuesta, PlanDetalle } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import { nombreCompleto } from '../../lib/personas';
import { tareasParaGenerar, textoVencimiento } from '../../lib/preventivos';
import { EstadoBadge } from '../EstadoBadge';

interface Props {
  planId: number | null;
  onCerrar: () => void;
}

/** Las consultas que cambian al generar: se invalidan por prefijo. */
export const CONSULTAS_PREVENTIVOS = [['planes'], ['plan'], ['vencimientos'], ['tablero'], ['intervenciones']];

/**
 * 3.4 "Generar intervención preventiva": una casilla por tarea, quién la recibe y el botón.
 * Abierto cuando planId no es null.
 */
export function ModalGenerar({ planId, onCerrar }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const abierto = planId !== null;

  const { data: plan, isLoading, refetch } = useQuery<PlanDetalle>({
    queryKey: ['plan', planId],
    queryFn: () => clienteApi.get<PlanDetalle>(`/api/planes/${planId}`),
    enabled: abierto,
  });

  const [elegidas, setElegidas] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);

  const filas = plan ? tareasParaGenerar(plan.tareas) : [];

  // Al abrir, o al refrescar las tareas: las tildadas por omisión
  useEffect(() => {
    if (plan && abierto) {
      setElegidas(tareasParaGenerar(plan.tareas).filter((f) => f.tildada).map((f) => f.tarea.id));
    }
  }, [plan, abierto]);

  useEffect(() => {
    if (abierto) setError(null);
  }, [abierto]);

  const alternar = (id: number, tildada: boolean) =>
    setElegidas((actual) => (tildada ? [...actual, id] : actual.filter((x) => x !== id)));

  const generar = async () => {
    if (!plan || elegidas.length === 0) return;
    setGenerando(true);
    setError(null);
    try {
      const r = await clienteApi.post<GeneracionRespuesta>(`/api/planes/${plan.id}/generar`, { tarea_ids: elegidas });
      for (const clave of CONSULTAS_PREVENTIVOS) {
        await queryClient.invalidateQueries({ queryKey: clave });
      }
      notifications.show({ message: `Se generó la intervención N.º ${r.intervencion.id}.`, color: 'green' });
      if (r.responsable_omitido) {
        notifications.show({
          message: 'El responsable del plan ya no puede recibir intervenciones: quedó sin asignar.',
          color: 'yellow',
        });
      }
      onCerrar();
      navigate(`/intervenciones/${r.intervencion.id}`);
    } catch (err) {
      if (err instanceof ApiError && (err.codigo === 'TAREA_EN_CURSO' || err.codigo === 'SIN_TAREAS_PARA_GENERAR')) {
        setError(err.message);
        await refetch();
      } else {
        setError(mensajeError(err));
      }
    } finally {
      setGenerando(false);
    }
  };

  const textoBoton = elegidas.length > 1 ? `Generar con ${elegidas.length} tareas` : 'Generar';

  return (
    <Modal opened={abierto} onClose={onCerrar} title="Generar intervención preventiva" size="lg">
      {isLoading || !plan ? (
        <Center py="lg">
          <Loader color="marca" />
        </Center>
      ) : (
        <Stack gap="md">
          <Text fw={600}>{plan.nombre}</Text>

          <Stack gap="xs">
            {filas.map((f) => (
              <Checkbox
                key={f.tarea.id}
                checked={elegidas.includes(f.tarea.id)}
                disabled={!f.habilitada}
                onChange={(e) => alternar(f.tarea.id, e.currentTarget.checked)}
                label={
                  <Stack gap={2}>
                    <Group gap="xs" wrap="wrap">
                      <Text size="sm" fw={500}>
                        {f.tarea.accion}
                      </Text>
                      <EstadoBadge entidad="tarea_preventiva" estado={f.tarea.estado} size="xs" />
                    </Group>
                    <Text size="xs" c="dimmed">
                      {f.motivo ?? (f.tarea.activo ? textoVencimiento(f.tarea.dias) : '')}
                    </Text>
                  </Stack>
                }
              />
            ))}
          </Stack>

          <Text size="sm" c="dimmed">
            {plan.responsable
              ? `Se asigna a ${nombreCompleto(plan.responsable)}.`
              : 'El plan no tiene responsable: la intervención queda sin asignar.'}
          </Text>

          {error && (
            <Alert color="red" icon={<IconAlertCircle size={16} />}>
              {error}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={onCerrar} disabled={generando}>
              Cancelar
            </Button>
            <Button color="marca" onClick={generar} loading={generando} disabled={elegidas.length === 0}>
              {textoBoton}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
