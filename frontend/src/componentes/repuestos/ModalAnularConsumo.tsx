import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  Text,
  Textarea,
  Alert,
  Group,
  Button,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { ApiError, mensajeError } from '../../lib/errores';
import { formatCantidad } from '../../lib/formato';

export interface ConsumoParaAnular {
  id: number;
  repuesto: { id: number; codigo?: string | null; nombre: string; unidad: string };
  cantidad: number;
  movio_stock: boolean;
}

export interface ModalAnularConsumoProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  consumo: ConsumoParaAnular | null;
  onExito?: () => void;
}

export function ModalAnularConsumo({
  abierto,
  onCerrar,
  intervencionId,
  consumo,
  onExito,
}: ModalAnularConsumoProps) {
  const queryClient = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (abierto) {
      setMotivo('');
      setErrorMotivo(null);
    }
  }, [abierto]);

  if (!consumo) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMotivo(null);

    const m = motivo.trim();
    if (!m || m.length < 5) {
      setErrorMotivo('Ingresá un motivo de al menos 5 caracteres.');
      return;
    }

    setGuardando(true);

    try {
      await clienteApi.post(
        `/api/intervenciones/${intervencionId}/repuestos/${consumo.id}/anular`,
        { motivo: m }
      );

      notifications.show({ message: 'Consumo anulado.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['intervencion', intervencionId, 'repuestos'] });
      queryClient.invalidateQueries({ queryKey: ['intervencion', intervencionId] });
      queryClient.invalidateQueries({ queryKey: ['repuestos'] });
      queryClient.invalidateQueries({ queryKey: ['repuesto'] });
      onCerrar();
      if (onExito) onExito();
    } catch (err: unknown) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal opened={abierto} onClose={onCerrar} title="Anular consumo de repuesto">
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <Text size="sm">
            Vas a anular el consumo de{' '}
            <strong>
              {consumo.repuesto.nombre} × {formatCantidad(consumo.cantidad)} {consumo.repuesto.unidad}
            </strong>
            .
          </Text>

          {consumo.movio_stock && (
            <Alert color="blue" icon={<IconInfoCircle size={16} />}>
              Vuelven {formatCantidad(consumo.cantidad)} al stock.
            </Alert>
          )}

          <Textarea
            label="Motivo de la anulación"
            placeholder="Indicá por qué se anula el consumo (mínimo 5 caracteres)"
            required
            rows={3}
            value={motivo}
            onChange={(e) => {
              setMotivo(e.currentTarget.value);
              if (errorMotivo) setErrorMotivo(null);
            }}
            error={errorMotivo}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Volver
            </Button>
            <Button type="submit" color="red" loading={guardando}>
              Anular consumo
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
