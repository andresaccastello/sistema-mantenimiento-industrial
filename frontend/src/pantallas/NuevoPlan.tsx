import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, Group, Title, Paper, Select, TextInput, Textarea, Button, Text, Alert, SimpleGrid } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconPlus } from '@tabler/icons-react';
import { clienteApi } from '../api/cliente';
import type { MaquinaLista, PlanDetalle } from '../api/tipos';
import { useAuth } from '../auth/AuthContext';
import { CampoNumero } from '../componentes/CampoNumero';
import { ListaTareasBorrador } from '../componentes/preventivos/ListaTareasBorrador';
import { ModalTareaPlan, ErrorTareaExterno } from '../componentes/preventivos/ModalTareaPlan';
import { SelectResponsablePlan } from '../componentes/preventivos/SelectResponsablePlan';
import { ApiError, mensajeError } from '../lib/errores';
import { parsearId } from '../lib/formato';
import { etiquetaMaquina, coincideMaquina } from '../lib/maquinas';
import { BorradorTarea, borradorTareaVacio, cuerpoPlan, errorTareaDeApi } from '../lib/preventivos';

interface Errores {
  maquina?: string;
  nombre?: string;
  responsable?: string;
  anticipacion?: string;
  tareas?: string;
}

/** El diálogo de una tarea: índice null para una nueva. */
interface Dialogo {
  indice: number | null;
  errorInicial?: ErrorTareaExterno | null;
}

/** P3 — Nuevo plan. Con `?maquina=ID`, la máquina viene elegida. */
export function NuevoPlan() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { usuario, alcance } = useAuth();
  const [searchParams] = useSearchParams();
  const maquinaInicial = parsearId(searchParams.get('maquina'));
  const volverA = maquinaInicial ? `/maquinas/${maquinaInicial}` : '/preventivos';

  const [maquinaId, setMaquinaId] = useState<string | null>(maquinaInicial ? String(maquinaInicial) : null);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [responsableId, setResponsableId] = useState<string | null>(null);
  const [anticipacion, setAnticipacion] = useState<number | string>(7);
  const [tareas, setTareas] = useState<BorradorTarea[]>([]);
  const [errores, setErrores] = useState<Errores>({});
  const [erroresTareas, setErroresTareas] = useState<Record<number, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [confirmandoSalida, setConfirmandoSalida] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Las máquinas activas; con un alcance que no es TODAS, solo las de sus sectores
  const { data: maquinas } = useQuery<MaquinaLista[]>({
    queryKey: ['maquinas'],
    queryFn: () => clienteApi.get<MaquinaLista[]>('/api/maquinas'),
    staleTime: 300000,
  });
  const maquinasVisibles = useMemo(() => {
    const sectores = (usuario?.sectores ?? []).map((s) => s.id);
    const todas = alcance('PLANES_GESTIONAR') === 'TODAS';
    return (maquinas ?? []).filter((m) => m.activo && (todas || sectores.includes(m.sector.id)));
  }, [maquinas, usuario, alcance]);

  const hayDatos =
    nombre.trim() !== '' || descripcion.trim() !== '' || responsableId !== null || tareas.length > 0 ||
    (maquinaId !== null && maquinaId !== String(maquinaInicial));

  const limpiarError = (campo: keyof Errores) => setErrores((e) => ({ ...e, [campo]: undefined }));

  const guardarTarea = async (b: BorradorTarea) => {
    const indice = dialogo?.indice ?? null;
    setTareas((actual) => (indice === null ? [...actual, b] : actual.map((t, i) => (i === indice ? b : t))));
    if (indice !== null) {
      setErroresTareas((e) => {
        const nuevos = { ...e };
        delete nuevos[indice];
        return nuevos;
      });
    }
    limpiarError('tareas');
    setDialogo(null);
  };

  const quitarTarea = (indice: number) => {
    setTareas((actual) => actual.filter((_, i) => i !== indice));
    setErroresTareas({});
  };

  const guardar = async () => {
    setErrorGeneral(null);
    const nuevos: Errores = {};
    if (!maquinaId) nuevos.maquina = 'Elegí la máquina.';
    const n = nombre.trim();
    if (n.length < 3 || n.length > 150) nuevos.nombre = 'Escribí el nombre (de 3 a 150 caracteres).';
    const dias = Number(anticipacion);
    if (String(anticipacion).trim() === '' || !Number.isInteger(dias) || dias < 0 || dias > 90) {
      nuevos.anticipacion = 'Ingresá un número entero de 0 a 90.';
    }
    if (tareas.length === 0) nuevos.tareas = 'Agregá al menos una tarea.';
    setErrores(nuevos);
    if (Object.values(nuevos).some(Boolean)) return;

    setGuardando(true);
    try {
      const plan = await clienteApi.post<PlanDetalle>(
        '/api/planes',
        cuerpoPlan({ maquinaId, nombre, descripcion, responsableId, anticipacionDias: anticipacion, tareas })
      );
      for (const clave of [['planes'], ['vencimientos'], ['tablero']]) {
        await queryClient.invalidateQueries({ queryKey: clave });
      }
      notifications.show({ message: 'Se creó el plan.', color: 'green' });
      navigate(`/preventivos/planes/${plan.id}`);
    } catch (err) {
      const indice = err instanceof ApiError ? err.datos?.indice : undefined;
      if (err instanceof ApiError && typeof indice === 'number' && tareas[indice]) {
        // El error de una tarea: en rojo, con el mensaje, y su diálogo abierto
        const indiceRepuesto = err.datos?.indice_repuesto;
        const enCampo = errorTareaDeApi(err.codigo, err.message, typeof indiceRepuesto === 'number' ? indiceRepuesto : undefined);
        const mensaje = enCampo?.mensaje ?? mensajeError(err);
        setErroresTareas({ [indice]: mensaje });
        setDialogo({ indice, errorInicial: enCampo ?? { campo: null, mensaje } });
      } else if (err instanceof ApiError && err.codigo === 'PLAN_DUPLICADO') {
        setErrores({ nombre: 'Ya hay un plan con ese nombre en esta máquina.' });
      } else if (err instanceof ApiError && err.codigo.startsWith('RESPONSABLE_')) {
        setErrores({ responsable: mensajeError(err) });
      } else if (err instanceof ApiError && ['MAQUINA_INACTIVA', 'MAQUINA_NO_ENCONTRADA', 'PERMISO_INSUFICIENTE'].includes(err.codigo)) {
        setErrores({ maquina: mensajeError(err) });
      } else {
        setErrorGeneral(mensajeError(err));
      }
    } finally {
      setGuardando(false);
    }
  };

  const cancelar = () => (hayDatos ? setConfirmandoSalida(true) : navigate(volverA));

  return (
    <Stack gap="lg">
      <Title order={2} c="#0f172a">
        Nuevo plan
      </Title>

      <Paper withBorder p="lg">
        <Stack gap="md">
          <Title order={4}>Datos</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Select
              label="Máquina"
              required
              searchable
              placeholder="Buscá por código o nombre"
              data={maquinasVisibles.map((m) => ({ value: String(m.id), label: etiquetaMaquina(m) }))}
              filter={({ options, search }) =>
                !search
                  ? options
                  : options.filter((opt) => {
                      if (!('value' in opt)) return true;
                      const maq = maquinasVisibles.find((m) => String(m.id) === opt.value);
                      return maq ? coincideMaquina(maq, search) : true;
                    })
              }
              value={maquinaId}
              onChange={(v) => {
                setMaquinaId(v);
                setResponsableId(null);
                limpiarError('maquina');
                limpiarError('responsable');
              }}
              error={errores.maquina}
            />
            <TextInput
              label="Nombre"
              required
              placeholder="Por ejemplo, Mecánico"
              maxLength={150}
              value={nombre}
              onChange={(e) => {
                setNombre(e.currentTarget.value);
                limpiarError('nombre');
              }}
              error={errores.nombre}
            />
            <SelectResponsablePlan
              maquinaId={parsearId(maquinaId)}
              value={responsableId}
              onChange={(v) => {
                setResponsableId(v);
                limpiarError('responsable');
              }}
              error={errores.responsable}
            />
            <CampoNumero
              label="Avisar antes"
              description="Cuántos días antes una tarea pasa a «Próxima»."
              allowDecimal={false}
              suffix=" días"
              value={anticipacion}
              onChange={(v) => {
                setAnticipacion(v);
                limpiarError('anticipacion');
              }}
              error={errores.anticipacion}
            />
          </SimpleGrid>
          <Textarea
            label="Descripción"
            placeholder="Opcional"
            autosize
            minRows={2}
            maxLength={2000}
            value={descripcion}
            onChange={(e) => setDescripcion(e.currentTarget.value)}
          />
        </Stack>
      </Paper>

      <Paper withBorder p="lg">
        <Stack gap="md">
          <Group justify="space-between">
            <Title order={4}>Tareas</Title>
            <Button variant="light" color="marca" leftSection={<IconPlus size={16} />} onClick={() => setDialogo({ indice: null })}>
              Agregar tarea
            </Button>
          </Group>
          {tareas.length === 0 ? (
            <Text size="sm" c={errores.tareas ? 'red' : 'dimmed'}>
              {errores.tareas ?? 'Todavía no hay tareas. Cada tarea tiene su frecuencia.'}
            </Text>
          ) : (
            <ListaTareasBorrador
              tareas={tareas}
              errores={erroresTareas}
              onEditar={(i) => setDialogo({ indice: i })}
              onQuitar={quitarTarea}
            />
          )}
        </Stack>
      </Paper>

      {errorGeneral && (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {errorGeneral}
        </Alert>
      )}

      {confirmandoSalida ? (
        <Group justify="flex-end" gap="sm">
          <Text size="sm" fw={500}>
            Hay datos sin guardar. ¿Descartarlos?
          </Text>
          <Button variant="default" onClick={() => setConfirmandoSalida(false)}>
            Seguir cargando
          </Button>
          <Button color="red" onClick={() => navigate(volverA)}>
            Descartar
          </Button>
        </Group>
      ) : (
        <Group justify="flex-end">
          <Button variant="default" onClick={cancelar} disabled={guardando}>
            Cancelar
          </Button>
          <Button color="marca" onClick={guardar} loading={guardando}>
            Guardar plan
          </Button>
        </Group>
      )}

      <ModalTareaPlan
        abierto={dialogo !== null}
        titulo={dialogo?.indice === null ? 'Agregar tarea' : 'Editar tarea'}
        inicial={dialogo && dialogo.indice !== null ? tareas[dialogo.indice] : borradorTareaVacio()}
        errorInicial={dialogo?.errorInicial ?? null}
        onGuardar={guardarTarea}
        onCerrar={() => setDialogo(null)}
      />
    </Stack>
  );
}
