import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  Textarea,
  Text,
  Group,
  Button,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { PedidoIntervencionItem } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';

export interface ModalCancelarPedidoProps {
  abierto: boolean;
  onCerrar: () => void;
  pedido: PedidoIntervencionItem | null;
  onExito?: () => void;
}

export function ModalCancelarPedido({
  abierto,
  onCerrar,
  pedido,
  onExito,
}: ModalCancelarPedidoProps) {
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

  if (!pedido) return null;

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
        `/api/intervenciones/${pedido.intervencion_id}/pedidos/${pedido.id}/cancelar`,
        { motivo: m }
      );

      notifications.show({ message: 'Pedido cancelado.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['pedidos-repuesto'] });
      queryClient.invalidateQueries({ queryKey: ['intervencion', pedido.intervencion_id] });
      queryClient.invalidateQueries({ queryKey: ['repuestos'] });
      if (pedido.repuesto?.id) {
        queryClient.invalidateQueries({ queryKey: ['repuesto', pedido.repuesto.id] });
      }
      onCerrar();
      if (onExito) onExito();
    } catch (err: unknown) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal opened={abierto} onClose={onCerrar} title="Cancelar pedido de repuesto">
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <Text size="sm">
            Vas a cancelar el pedido de{' '}
            <strong>{pedido.repuesto?.nombre || pedido.descripcion}</strong>. Esta acción no se
            puede deshacer.
          </Text>

          <Textarea
            label="Motivo de la cancelación"
            placeholder="Indicá por qué se cancela el pedido (mínimo 5 caracteres)"
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
              Cancelar pedido
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
