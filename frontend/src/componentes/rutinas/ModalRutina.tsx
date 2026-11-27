import { useEffect, useState } from 'react';
import { Button, Checkbox, Group, Modal, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import type { FrecuenciaRutina, Rutina, RutinaMaquina } from '../../api/tipos';
import { mensajeError } from '../../lib/errores';

interface Props {
  maquinaId: number;
  /** null: cerrado; 'nueva': alta; una rutina: edición. */
  rutina: null | 'nueva' | RutinaMaquina;
  onCerrar: () => void;
  onGuardada: () => void;
}

const OPCIONES_FRECUENCIA = [
  { value: 'DIARIA', label: 'Diaria' },
  { value: 'SEMANAL', label: 'Semanal' },
];

/**
 * RT1, 5.1: alta y edición de una tarea de rutina. La frecuencia no se cambia al editar;
 * "incluye sábado", solo en las diarias.
 */
export function ModalRutina({ maquinaId, rutina, onCerrar, onGuardada }: Props) {
  const actual = rutina !== null && rutina !== 'nueva' ? rutina : null;
  const editando = actual !== null;
  const [descripcion, setDescripcion] = useState('');
  const [frecuencia, setFrecuencia] = useState<FrecuenciaRutina>('DIARIA');
  const [incluyeSabado, setIncluyeSabado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (rutina === null) return;
    setError(null);
    if (rutina === 'nueva') {
      setDescripcion('');
      setFrecuencia('DIARIA');
      setIncluyeSabado(false);
    } else {
      setDescripcion(rutina.descripcion);
      setFrecuencia(rutina.frecuencia);
      setIncluyeSabado(rutina.incluye_sabado);
    }
  }, [rutina]);

  const guardar = async () => {
    if (descripcion.trim() === '') {
      setError('Cargá la descripción');
      return;
    }
    setGuardando(true);
    try {
      const sabado = frecuencia === 'DIARIA' ? incluyeSabado : false;
      if (actual) {
        await clienteApi.patch<Rutina>(`/api/rutinas/${actual.id}`, { descripcion, incluye_sabado: sabado });
      } else {
        await clienteApi.post<Rutina>(`/api/maquinas/${maquinaId}/rutinas`, { descripcion, frecuencia, incluye_sabado: sabado });
      }
      notifications.show({ message: editando ? 'Tarea guardada' : 'Tarea creada', color: 'green', autoClose: 2000 });
      onGuardada();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      opened={rutina !== null}
      onClose={onCerrar}
      title={editando ? 'Editar tarea de rutina' : 'Nueva tarea de rutina'}
      centered
    >
      <Stack gap="md">
        <TextInput
          label="Descripción"
          placeholder="Por ejemplo, cambiar el agua del refrigerante"
          maxLength={200}
          value={descripcion}
          onChange={(e) => {
            setDescripcion(e.currentTarget.value);
            setError(null);
          }}
          error={error}
          data-autofocus
        />
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Frecuencia
          </Text>
          <SegmentedControl
            data={OPCIONES_FRECUENCIA}
            value={frecuencia}
            onChange={(v) => setFrecuencia(v as FrecuenciaRutina)}
            disabled={editando}
            fullWidth
          />
          {editando && (
            <Text size="xs" c="dimmed">
              La frecuencia no se cambia. Para otra, dá de baja esta tarea y creá una nueva.
            </Text>
          )}
        </Stack>
        {frecuencia === 'DIARIA' && (
          <Checkbox
            label="Incluye sábado"
            checked={incluyeSabado}
            onChange={(e) => setIncluyeSabado(e.currentTarget.checked)}
          />
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button onClick={guardar} loading={guardando}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
