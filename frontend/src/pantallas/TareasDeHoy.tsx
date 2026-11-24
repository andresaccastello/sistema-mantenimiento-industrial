import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Center, Group, Loader, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconChecklist } from '@tabler/icons-react';
import { clienteApi } from '../api/cliente';
import type { RegistroRutinaCreado, RespuestaRutinasHoy, RutinaHoy } from '../api/tipos';
import { useAuth } from '../auth/AuthContext';
import { ApiError, mensajeError } from '../lib/errores';
import { agruparPorMaquina, tituloTareasDeHoy } from '../lib/rutinas';
import { EncabezadoPagina } from '../componentes/EncabezadoPagina';
import { PantallaVacia } from '../componentes/PantallaVacia';
import { SinPermiso } from '../componentes/SinPermiso';
import { ModalNotaRutina } from '../componentes/rutinas/ModalNotaRutina';
import { TarjetaRutinaHoy } from '../componentes/rutinas/TarjetaRutinaHoy';

/**
 * RT1, 4: las tareas de rutina de hoy (D-033). Un toque en "Hecha" la marca; "Con nota" abre
 * un modal chico; quien la marcó la puede deshacer.
 */
export function TareasDeHoy() {
  const { tienePermiso } = useAuth();
  if (!tienePermiso('RUTINAS_REALIZAR')) {
    return <SinPermiso permisoRequerido="RUTINAS_REALIZAR" />;
  }
  return <ListaTareasDeHoy />;
}

function ListaTareasDeHoy() {
  const { usuario } = useAuth();
  const queryClient = useQueryClient();
  const [conNota, setConNota] = useState<RutinaHoy | null>(null);
  const [aDeshacer, setADeshacer] = useState<RutinaHoy | null>(null);
  const [ocupada, setOcupada] = useState<number | null>(null);

  const { data, isPending, isError, refetch } = useQuery<RespuestaRutinasHoy>({
    queryKey: ['rutinas', 'hoy'],
    queryFn: () => clienteApi.get<RespuestaRutinasHoy>('/api/rutinas/hoy'),
  });

  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['rutinas'] });

  const marcar = useMutation({
    mutationFn: ({ rutina, nota }: { rutina: RutinaHoy; nota?: string }) =>
      clienteApi.post<RegistroRutinaCreado>(`/api/rutinas/${rutina.id}/hecha`, nota === undefined ? {} : { nota }),
    onMutate: ({ rutina }) => setOcupada(rutina.id),
    onSuccess: () => {
      setConNota(null);
      notifications.show({ message: 'Tarea marcada', color: 'green', autoClose: 2000 });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.codigo === 'RUTINA_YA_HECHA') {
        setConNota(null);
        notifications.show({ message: 'Ya la marcó otra persona', color: 'blue' });
      } else {
        notifications.show({ message: mensajeError(err), color: 'red' });
      }
    },
    onSettled: () => {
      setOcupada(null);
      return refrescar();
    },
  });

  const deshacer = useMutation({
    mutationFn: (rutina: RutinaHoy) => clienteApi.delete<unknown>(`/api/rutinas/${rutina.id}/hecha`),
    onMutate: (rutina) => setOcupada(rutina.id),
    onSuccess: () => {
      setADeshacer(null);
      notifications.show({ message: 'Marca deshecha', color: 'green', autoClose: 2000 });
    },
    onError: (err) => notifications.show({ message: mensajeError(err), color: 'red' }),
    onSettled: () => {
      setOcupada(null);
      return refrescar();
    },
  });

  if (isPending) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }
  if (isError || !data) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title="No se pudieron cargar las tareas">
        <Button variant="light" color="red" mt="sm" onClick={() => refetch()}>
          Reintentar
        </Button>
      </Alert>
    );
  }

  const grupos = agruparPorMaquina(data.rutinas);

  return (
    <>
      <EncabezadoPagina titulo={tituloTareasDeHoy(data.hoy)} />

      {data.sin_sectores ? (
        <PantallaVacia
          icono={<IconChecklist size={32} />}
          mensaje="No tenés sectores asignados. Pedile al administrador que te asigne los tuyos"
        />
      ) : grupos.length === 0 ? (
        <PantallaVacia icono={<IconChecklist size={32} />} mensaje="Hoy no hay tareas de rutina" />
      ) : (
        <Stack gap="md">
          {grupos.map((g) => (
            <Paper key={g.maquina.id} withBorder radius="sm" p="md" bg="var(--sm-superficie)">
              <Title order={5} c="var(--sm-titulo)" mb="xs" style={{ overflowWrap: 'anywhere' }}>
                {g.titulo}
              </Title>
              <Stack gap={0}>
                {g.rutinas.map((r) => (
                  <TarjetaRutinaHoy
                    key={r.id}
                    rutina={r}
                    hoy={data.hoy}
                    usuarioId={usuario?.id}
                    ocupada={ocupada === r.id}
                    onHecha={() => marcar.mutate({ rutina: r })}
                    onConNota={() => setConNota(r)}
                    onDeshacer={() => setADeshacer(r)}
                  />
                ))}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      <ModalNotaRutina
        descripcion={conNota?.descripcion ?? null}
        guardando={marcar.isPending}
        onCerrar={() => setConNota(null)}
        onMarcar={(nota) => conNota && marcar.mutate({ rutina: conNota, nota })}
      />

      <Modal opened={aDeshacer !== null} onClose={() => setADeshacer(null)} title="Deshacer la marca" centered>
        <Stack gap="md">
          <Text size="sm" c="var(--sm-texto)">
            ¿Deshacés la marca de "{aDeshacer?.descripcion}"? La tarea vuelve a quedar pendiente.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setADeshacer(null)} mih={44}>
              Cancelar
            </Button>
            <Button color="red" onClick={() => aDeshacer && deshacer.mutate(aDeshacer)} loading={deshacer.isPending} mih={44}>
              Deshacer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
