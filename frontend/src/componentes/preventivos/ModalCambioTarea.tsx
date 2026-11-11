import { useEffect, useState } from 'react';
import { Modal, Stack, Text, Textarea, Group, Button, Alert } from '@mantine/core';
import { IconAlertCircle, IconInfoCircle } from '@tabler/icons-react';
import type { TareaIntervencion } from '../../api/tipos';
import { mensajeError } from '../../lib/errores';

/** Lo que se quiere cambiar: marcar o desmarcar, o la observación. */
export type CambioTarea = { tipo: 'hecha'; hecha: boolean } | { tipo: 'observacion' };

interface Props {
  tarea: TareaIntervencion | null;
  cambio: CambioTarea | null;
  finalizada: boolean;
  /** Manda el PATCH; si lanza, el error se muestra en el diálogo. */
  onConfirmar: (cuerpo: { hecha: boolean; observacion?: string | null; motivo?: string }) => Promise<void>;
  onCerrar: () => void;
}

/**
 * 5.3 El diálogo chico de una tarea: la observación, y con la intervención finalizada,
 * cualquier cambio, que pide el motivo.
 */
export function ModalCambioTarea({ tarea, cambio, finalizada, onConfirmar, onCerrar }: Props) {
  const abierto = tarea !== null && cambio !== null;
  const [observacion, setObservacion] = useState('');
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setObservacion(tarea?.observacion ?? '');
    setMotivo('');
    setErrorMotivo(null);
    setError(null);
  }, [abierto, tarea]);

  if (!tarea || !cambio) return null;
  const esObservacion = cambio.tipo === 'observacion';
  const desmarca = cambio.tipo === 'hecha' && !cambio.hecha;
  const anulaRepuestos = desmarca && tarea.repuestos_previstos.some((p) => p.estado === 'USADO');

  const confirmar = async () => {
    if (finalizada && motivo.trim().length < 5) {
      setErrorMotivo('Indicá el motivo (al menos 5 caracteres).');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await onConfirmar({
        hecha: cambio.tipo === 'hecha' ? cambio.hecha : tarea.hecha,
        ...(esObservacion ? { observacion: observacion.trim() || null } : {}),
        ...(finalizada ? { motivo: motivo.trim() } : {}),
      });
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  };

  const titulo = finalizada
    ? 'Corregir una tarea de una intervención finalizada'
    : desmarca
      ? 'Desmarcar la tarea'
      : tarea.observacion
      ? 'Editar observación'
      : 'Agregar observación';

  return (
    <Modal opened={abierto} onClose={() => !guardando && onCerrar()} title={titulo} size="md">
      <Stack gap="md">
        <Text size="sm" fw={500}>
          {tarea.accion}
        </Text>
        {cambio.tipo === 'hecha' && (
          <Text size="sm">{cambio.hecha ? 'Se marca como hecha.' : 'Se desmarca.'}</Text>
        )}
        {anulaRepuestos && (
          <Alert color="yellow" variant="light" icon={<IconInfoCircle size={16} />}>
            Se anulan los repuestos registrados de esta tarea y vuelven al stock.
          </Alert>
        )}
        {esObservacion && (
          <Textarea
            label="Observación"
            autosize
            minRows={2}
            maxLength={500}
            value={observacion}
            onChange={(e) => setObservacion(e.currentTarget.value)}
          />
        )}
        {finalizada && (
          <>
            <Textarea
              label="Motivo"
              maxLength={500}
              required
              autosize
              minRows={2}
              value={motivo}
              onChange={(e) => {
                setMotivo(e.currentTarget.value);
                setErrorMotivo(null);
              }}
              error={errorMotivo}
            />
            <Alert color="yellow" variant="light" icon={<IconInfoCircle size={16} />}>
              La próxima fecha del plan se va a recalcular.
            </Alert>
          </>
        )}
        {error && (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button color="marca" onClick={confirmar} loading={guardando}>
            {desmarca && !finalizada ? 'Desmarcar' : 'Guardar'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
