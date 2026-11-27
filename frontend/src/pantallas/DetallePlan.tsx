import { useState } from 'react';
import { useParams, Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, Group, Title, Text, Badge, Button, Paper, Table, Skeleton, Alert, Anchor } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconPlus, IconEdit, IconBan, IconRotateClockwise, IconAlertCircle, IconPlayerPlay } from '@tabler/icons-react';
import { clienteApi } from '../api/cliente';
import type { PlanDetalle, TareaPlan } from '../api/tipos';
import { NoEncontrada } from '../componentes/NoEncontrada';
import { EstadoBadge } from '../componentes/EstadoBadge';
import { ModalGenerar } from '../componentes/preventivos/ModalGenerar';
import { ModalTareaPlan } from '../componentes/preventivos/ModalTareaPlan';
import { ModalEditarPlan } from '../componentes/preventivos/ModalEditarPlan';
import { ModalActivoPlan } from '../componentes/preventivos/ModalActivoPlan';
import { TablaTareasPlan } from '../componentes/preventivos/TablaTareasPlan';
import { ApiError, mensajeError } from '../lib/errores';
import { formatFechaHora, parsearId } from '../lib/formato';
import { etiquetaMaquina } from '../lib/maquinas';
import { nombreCompleto } from '../lib/personas';
import { BorradorTarea, borradorDeTarea, borradorTareaVacio, cuerpoTarea } from '../lib/preventivos';

/** La tarea que se edita en el diálogo: null cerrado, 'nueva' para agregar. */
type TareaEnDialogo = null | 'nueva' | TareaPlan;

/** P2 — Detalle de un plan preventivo. */
export function DetallePlan() {
  const { id } = useParams<{ id: string }>();
  const planId = parsearId(id);
  const queryClient = useQueryClient();

  const [generarAbierto, setGenerarAbierto] = useState(false);
  const [editarAbierto, setEditarAbierto] = useState(false);
  const [activoAbierto, setActivoAbierto] = useState(false);
  const [tareaEnDialogo, setTareaEnDialogo] = useState<TareaEnDialogo>(null);

  const { data: plan, isLoading, error } = useQuery<PlanDetalle>({
    queryKey: ['plan', planId],
    queryFn: () => clienteApi.get<PlanDetalle>(`/api/planes/${planId}`),
    enabled: planId !== null,
    retry: false,
  });

  if (planId === null) return <NoEncontrada />;
  if (isLoading) {
    return (
      <Stack gap="md">
        <Skeleton height={30} width={240} />
        <Skeleton height={120} />
        <Skeleton height={300} />
      </Stack>
    );
  }
  if (error || !plan) {
    if (error instanceof ApiError && error.status === 404) return <NoEncontrada />;
    return (
      <Alert color="red" icon={<IconAlertCircle size={16} />}>
        {mensajeError(error)}
      </Alert>
    );
  }

  const refrescar = async () => {
    for (const clave of [['plan'], ['planes'], ['vencimientos'], ['tablero']]) {
      await queryClient.invalidateQueries({ queryKey: clave });
    }
  };

  const guardarTarea = async (b: BorradorTarea) => {
    if (tareaEnDialogo === 'nueva') {
      await clienteApi.post<PlanDetalle>(`/api/planes/${plan.id}/tareas`, cuerpoTarea(b));
      notifications.show({ message: 'Tarea agregada.', color: 'green' });
    } else if (tareaEnDialogo) {
      const cambios = cuerpoTarea(b, borradorDeTarea(tareaEnDialogo));
      if (Object.keys(cambios).length > 0) {
        await clienteApi.patch<PlanDetalle>(`/api/planes/${plan.id}/tareas/${tareaEnDialogo.id}`, cambios);
        notifications.show({ message: 'Tarea guardada.', color: 'green' });
      }
    }
    await refrescar();
    setTareaEnDialogo(null);
  };

  const cambiarActivoTarea = async (t: TareaPlan) => {
    try {
      await clienteApi.post<PlanDetalle>(`/api/planes/${plan.id}/tareas/${t.id}/${t.activo ? 'desactivar' : 'reactivar'}`, {});
      notifications.show({ message: t.activo ? 'Tarea desactivada.' : 'Tarea reactivada.', color: 'green' });
      await refrescar();
    } catch (err) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    }
  };

  return (
    <Stack gap="lg">
      <Group>
        <Button component={Link} to="/preventivos" variant="subtle" color="gray" leftSection={<IconArrowLeft size={16} />}>
          Preventivos
        </Button>
      </Group>

      <Paper p="lg" withBorder>
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
          <Stack gap={4}>
            <Group gap="xs" align="center">
              <Title order={2}>{plan.nombre}</Title>
              {!plan.activo && (
                <Badge color="gray" variant="outline" size="md">
                  Inactivo
                </Badge>
              )}
            </Group>
            <Text size="sm">
              <Anchor component={Link} to={`/maquinas/${plan.maquina.id}`}>
                {etiquetaMaquina(plan.maquina)}
              </Anchor>
              {' · '}
              {plan.responsable ? nombreCompleto(plan.responsable) : 'Sin responsable'}
              {plan.generacion_automatica && ' · Generación automática'}
              {' · '}
              {`Avisa ${plan.anticipacion_dias} ${plan.anticipacion_dias === 1 ? 'día' : 'días'} antes`}
            </Text>
            {plan.descripcion && (
              <Text size="sm" c="dimmed">
                {plan.descripcion}
              </Text>
            )}
          </Stack>

          <Group gap="xs">
            {plan.activo && (
              <Button color="marca" leftSection={<IconPlayerPlay size={16} />} onClick={() => setGenerarAbierto(true)}>
                Generar intervención
              </Button>
            )}
            <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setTareaEnDialogo('nueva')}>
              Agregar tarea
            </Button>
            <Button variant="default" leftSection={<IconEdit size={16} />} onClick={() => setEditarAbierto(true)}>
              Editar
            </Button>
            <Button
              variant="default"
              color={plan.activo ? 'red' : undefined}
              leftSection={plan.activo ? <IconBan size={16} /> : <IconRotateClockwise size={16} />}
              onClick={() => setActivoAbierto(true)}
            >
              {plan.activo ? 'Desactivar' : 'Reactivar'}
            </Button>
          </Group>
        </Group>
      </Paper>

      <Stack gap="xs">
        <Title order={4}>Tareas</Title>
        <TablaTareasPlan tareas={plan.tareas} onEditar={(t) => setTareaEnDialogo(t)} onCambiarActivo={cambiarActivoTarea} />
      </Stack>

      <Stack gap="xs">
        <Title order={4}>Intervenciones de este plan</Title>
        {plan.intervenciones.length === 0 ? (
          <Text size="sm" c="dimmed">
            Todavía no se generó ninguna intervención de este plan.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 80 }}>N.º</Table.Th>
                  <Table.Th style={{ minWidth: 180 }}>Estado</Table.Th>
                  <Table.Th style={{ minWidth: 150 }}>Generada</Table.Th>
                  <Table.Th style={{ minWidth: 150 }}>Finalizada</Table.Th>
                  <Table.Th style={{ minWidth: 150 }}>Responsable</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {plan.intervenciones.map((i) => (
                  <Table.Tr key={i.id}>
                    <Table.Td>
                      <Anchor component={Link} to={`/intervenciones/${i.id}`} fw={600}>
                        #{i.id}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      <EstadoBadge entidad="intervencion" estado={i.estado} />
                    </Table.Td>
                    <Table.Td>{formatFechaHora(i.fecha_creacion)}</Table.Td>
                    <Table.Td>{formatFechaHora(i.fecha_finalizacion)}</Table.Td>
                    <Table.Td>{i.responsable ? nombreCompleto(i.responsable) : 'Sin asignar'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>

      <ModalGenerar planId={generarAbierto ? plan.id : null} onCerrar={() => setGenerarAbierto(false)} />
      <ModalEditarPlan plan={plan} abierto={editarAbierto} onCerrar={() => setEditarAbierto(false)} />
      <ModalActivoPlan plan={plan} abierto={activoAbierto} onCerrar={() => setActivoAbierto(false)} />
      <ModalTareaPlan
        abierto={tareaEnDialogo !== null}
        titulo={tareaEnDialogo === 'nueva' ? 'Agregar tarea' : 'Editar tarea'}
        inicial={tareaEnDialogo && tareaEnDialogo !== 'nueva' ? borradorDeTarea(tareaEnDialogo) : borradorTareaVacio()}
        maquinaId={plan.maquina.id}
        yaSeHizo={Boolean(tareaEnDialogo && tareaEnDialogo !== 'nueva' && tareaEnDialogo.ultima_ejecucion)}
        usoTarea={tareaEnDialogo && tareaEnDialogo !== 'nueva' ? tareaEnDialogo.uso : null}
        onGuardar={guardarTarea}
        onCerrar={() => setTareaEnDialogo(null)}
      />
    </Stack>
  );
}
