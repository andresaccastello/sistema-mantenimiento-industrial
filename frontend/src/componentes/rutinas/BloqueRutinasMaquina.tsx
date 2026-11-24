import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Group, Modal, Paper, Skeleton, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBan, IconEdit, IconPlus, IconRotateClockwise } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { Rutina, RutinaMaquina } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { mensajeError } from '../../lib/errores';
import { estadoVisual, textoFrecuencia, textoPeriodo, textoUltimaVez } from '../../lib/rutinas';
import { ModalRutina } from './ModalRutina';
import { PuntoPeriodo } from './PuntoPeriodo';

interface Props {
  maquinaId: number;
  maquinaActiva: boolean;
}

/**
 * RT1, 5.1: las tareas de rutina de la máquina, con PLANES_GESTIONAR o REPORTES_CONSULTAR.
 * Con PLANES_GESTIONAR, también el alta, la edición y la baja. Las dadas de baja, ocultas.
 */
export function BloqueRutinasMaquina({ maquinaId, maquinaActiva }: Props) {
  const { tienePermiso } = useAuth();
  const gestiona = tienePermiso('PLANES_GESTIONAR');
  const puede = gestiona || tienePermiso('REPORTES_CONSULTAR');
  const queryClient = useQueryClient();

  const [verBajas, setVerBajas] = useState(false);
  const [enEdicion, setEnEdicion] = useState<null | 'nueva' | RutinaMaquina>(null);
  const [cambiando, setCambiando] = useState<RutinaMaquina | null>(null);
  const [guardando, setGuardando] = useState(false);

  const { data, isPending } = useQuery<RutinaMaquina[]>({
    queryKey: ['rutinas', 'maquina', maquinaId],
    queryFn: () =>
      clienteApi.get<RutinaMaquina[]>(`/api/maquinas/${maquinaId}/rutinas`, { params: { incluir_inactivas: 'true' } }),
    enabled: puede,
  });

  if (!puede) return null;
  const lista = data ?? [];
  const activas = lista.filter((r) => r.activa);
  const bajas = lista.filter((r) => !r.activa);
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['rutinas'] });

  const cambiarActiva = async () => {
    if (!cambiando) return;
    setGuardando(true);
    try {
      await clienteApi.patch<Rutina>(`/api/rutinas/${cambiando.id}`, { activa: !cambiando.activa });
      notifications.show({
        message: cambiando.activa ? 'Tarea dada de baja' : 'Tarea reactivada',
        color: 'green',
        autoClose: 2000,
      });
      setCambiando(null);
      await refrescar();
    } catch (err) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  const fila = (r: RutinaMaquina) => (
    <Group
      key={r.id}
      justify="space-between"
      align="center"
      gap="sm"
      wrap="wrap"
      py="xs"
      style={{ borderTop: '1px solid var(--sm-separador)' }}
    >
      <Stack gap={4} style={{ flex: '1 1 220px', minWidth: 0 }}>
        <Group gap="xs" wrap="wrap">
          <Text fw={500} c="var(--sm-titulo)" style={{ overflowWrap: 'anywhere' }}>
            {r.descripcion}
          </Text>
          <Badge variant="light" color="gray" size="sm">
            {textoFrecuencia(r)}
          </Badge>
          {!r.activa && (
            <Badge variant="outline" color="gray" size="sm">
              Dada de baja
            </Badge>
          )}
        </Group>
        <Text size="sm" c="var(--sm-tenue)">
          {textoUltimaVez(r.ultima)}
        </Text>
        {r.recientes.length > 0 && (
          <Group gap={6} wrap="wrap" aria-label="Períodos recientes">
            {r.recientes.map((p) => (
              <PuntoPeriodo
                key={p.periodo}
                estado={p.estado}
                tooltip={`${textoPeriodo(p.periodo, r.frecuencia)}: ${estadoVisual(p.estado).rotulo}`}
              />
            ))}
          </Group>
        )}
      </Stack>
      {gestiona && (
        <Group gap="xs" wrap="wrap">
          {r.activa && (
            <Button size="xs" variant="subtle" leftSection={<IconEdit size={14} />} onClick={() => setEnEdicion(r)}>
              Editar
            </Button>
          )}
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            leftSection={r.activa ? <IconBan size={14} /> : <IconRotateClockwise size={14} />}
            onClick={() => setCambiando(r)}
          >
            {r.activa ? 'Dar de baja' : 'Reactivar'}
          </Button>
        </Group>
      )}
    </Group>
  );

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Title order={4}>Tareas de rutina</Title>
          {gestiona && maquinaActiva && (
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEnEdicion('nueva')}>
              Nueva tarea de rutina
            </Button>
          )}
        </Group>

        {isPending ? (
          <Skeleton height={60} radius="sm" />
        ) : activas.length === 0 ? (
          <Text size="sm" c="var(--sm-tenue)">
            La máquina no tiene tareas de rutina.
          </Text>
        ) : (
          <Stack gap={0}>{activas.map(fila)}</Stack>
        )}

        {bajas.length > 0 && (
          <>
            <Group>
              <Button size="xs" variant="subtle" color="gray" onClick={() => setVerBajas((v) => !v)}>
                {verBajas ? 'Ocultar dadas de baja' : `Ver dadas de baja (${bajas.length})`}
              </Button>
            </Group>
            {verBajas && <Stack gap={0}>{bajas.map(fila)}</Stack>}
          </>
        )}
      </Stack>

      <ModalRutina
        maquinaId={maquinaId}
        rutina={enEdicion}
        onCerrar={() => setEnEdicion(null)}
        onGuardada={() => {
          setEnEdicion(null);
          void refrescar();
        }}
      />

      <Modal
        opened={cambiando !== null}
        onClose={() => setCambiando(null)}
        title={cambiando?.activa ? 'Dar de baja la tarea' : 'Reactivar la tarea'}
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="var(--sm-texto)">
            {cambiando?.activa
              ? `"${cambiando.descripcion}" deja de aparecer en las tareas de hoy. Lo que ya se hizo queda registrado.`
              : `"${cambiando?.descripcion}" vuelve a aparecer en las tareas de hoy desde hoy.`}
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setCambiando(null)}>
              Cancelar
            </Button>
            <Button color={cambiando?.activa ? 'red' : undefined} onClick={cambiarActiva} loading={guardando}>
              {cambiando?.activa ? 'Dar de baja' : 'Reactivar'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
