import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Stack, TextInput, Textarea, Group, Button, Alert } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { PlanDetalle } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import { CampoNumero } from '../CampoNumero';
import { SelectResponsablePlan } from './SelectResponsablePlan';
import { SwitchGeneracionAutomatica } from './SwitchGeneracionAutomatica';

interface Props {
  plan: PlanDetalle;
  abierto: boolean;
  onCerrar: () => void;
}

/** P2 "Editar": nombre, descripción, responsable, anticipación y generación automática. Manda solo lo que cambió. */
export function ModalEditarPlan({ plan, abierto, onCerrar }: Props) {
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState(plan.nombre);
  const [descripcion, setDescripcion] = useState(plan.descripcion ?? '');
  const [responsableId, setResponsableId] = useState<string | null>(plan.responsable ? String(plan.responsable.id) : null);
  const [anticipacion, setAnticipacion] = useState<number | string>(plan.anticipacion_dias);
  const [automatica, setAutomatica] = useState(plan.generacion_automatica);
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [errorAnticipacion, setErrorAnticipacion] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setNombre(plan.nombre);
    setDescripcion(plan.descripcion ?? '');
    setResponsableId(plan.responsable ? String(plan.responsable.id) : null);
    setAnticipacion(plan.anticipacion_dias);
    setAutomatica(plan.generacion_automatica);
    setErrorNombre(null);
    setErrorAnticipacion(null);
    setErrorGeneral(null);
  }, [abierto, plan]);

  const guardar = async () => {
    setErrorGeneral(null);
    const nombreLimpio = nombre.trim();
    const dias = Number(anticipacion);
    let hayError = false;
    if (nombreLimpio.length < 3 || nombreLimpio.length > 150) {
      setErrorNombre('Escribí el nombre (de 3 a 150 caracteres).');
      hayError = true;
    }
    if (String(anticipacion).trim() === '' || !Number.isInteger(dias) || dias < 0 || dias > 90) {
      setErrorAnticipacion('Ingresá un número entero de 0 a 90.');
      hayError = true;
    }
    if (hayError) return;

    const cambios: Record<string, unknown> = {};
    if (nombreLimpio !== plan.nombre) cambios.nombre = nombreLimpio;
    const descripcionLimpia = descripcion.trim() || null;
    if (descripcionLimpia !== plan.descripcion) cambios.descripcion = descripcionLimpia;
    const responsable = responsableId ? Number(responsableId) : null;
    if (responsable !== (plan.responsable?.id ?? null)) cambios.responsable_usuario_id = responsable;
    if (dias !== plan.anticipacion_dias) cambios.anticipacion_dias = dias;
    if (automatica !== plan.generacion_automatica) cambios.generacion_automatica = automatica;

    if (Object.keys(cambios).length === 0) {
      onCerrar();
      return;
    }

    setGuardando(true);
    try {
      await clienteApi.patch<PlanDetalle>(`/api/planes/${plan.id}`, cambios);
      await queryClient.invalidateQueries({ queryKey: ['plan'] });
      await queryClient.invalidateQueries({ queryKey: ['planes'] });
      await queryClient.invalidateQueries({ queryKey: ['vencimientos'] });
      notifications.show({ message: 'Plan guardado.', color: 'green' });
      onCerrar();
    } catch (err) {
      if (err instanceof ApiError && err.codigo === 'PLAN_DUPLICADO') {
        setErrorNombre('Ya hay un plan con ese nombre en esta máquina.');
      } else {
        setErrorGeneral(mensajeError(err));
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal opened={abierto} onClose={onCerrar} title="Editar plan" size="lg">
      <Stack gap="md">
        <TextInput
          label="Nombre"
          required
          maxLength={150}
          value={nombre}
          onChange={(e) => {
            setNombre(e.currentTarget.value);
            setErrorNombre(null);
          }}
          error={errorNombre}
        />
        <Textarea
          label="Descripción"
          placeholder="Opcional"
          autosize
          minRows={2}
          maxLength={2000}
          value={descripcion}
          onChange={(e) => setDescripcion(e.currentTarget.value)}
        />
        <SelectResponsablePlan
          maquinaId={plan.maquina.id}
          value={responsableId}
          onChange={setResponsableId}
          actual={plan.responsable}
        />
        <CampoNumero
          label="Avisar antes"
          description="Cuántos días antes una tarea pasa a «Próxima»."
          allowDecimal={false}
          suffix=" días"
          value={anticipacion}
          onChange={(v) => {
            setAnticipacion(v);
            setErrorAnticipacion(null);
          }}
          error={errorAnticipacion}
        />
        <SwitchGeneracionAutomatica checked={automatica} onChange={setAutomatica} />

        {errorGeneral && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {errorGeneral}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button color="marca" onClick={guardar} loading={guardando}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
