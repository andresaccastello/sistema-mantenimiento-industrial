import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Stack, Text, Textarea, Alert, Group, Button } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { RenglonCosto } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import { etiquetaTipoCosto, textoTotalNegativo } from '../../lib/costos';

export interface ModalAnularCostoProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  renglon: RenglonCosto | null;
}

export function ModalAnularCosto({ abierto, onCerrar, intervencionId, renglon }: ModalAnularCostoProps) {
  const queryClient = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [errorTotal, setErrorTotal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (abierto) {
      setMotivo('');
      setErrorMotivo(null);
      setErrorTotal(null);
    }
  }, [abierto]);

  if (!renglon) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMotivo(null);
    setErrorTotal(null);

    const m = motivo.trim();
    if (m.length < 5) {
      setErrorMotivo('Ingresá un motivo de al menos 5 caracteres.');
      return;
    }

    setGuardando(true);
    try {
      await clienteApi.post<RenglonCosto>(
        `/api/intervenciones/${intervencionId}/costos/${renglon.id}/anular`,
        { motivo: m }
      );
      notifications.show({ message: 'Costo anulado.', color: 'green' });
      // Costos, repuestos y detalle (por el historial): todo cuelga de este prefijo
      queryClient.invalidateQueries({ queryKey: ['intervencion', intervencionId] });
      onCerrar();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.codigo === 'TOTAL_NEGATIVO') {
        setErrorTotal(textoTotalNegativo(err.datos?.total_resultante));
        return;
      }
      if (err instanceof ApiError && err.codigo === 'MOTIVO_REQUERIDO') {
        setErrorMotivo('Ingresá un motivo de al menos 5 caracteres.');
        return;
      }
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal opened={abierto} onClose={onCerrar} title="Anular costo">
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <Text size="sm">
            Vas a anular{' '}
            <strong>
              {etiquetaTipoCosto(renglon.tipo)} — {renglon.descripcion}
            </strong>
            . El renglón queda en la lista, tachado.
          </Text>

          {errorTotal && (
            <Alert color="red" icon={<IconAlertCircle size={16} />}>
              {errorTotal} No se anuló el renglón.
            </Alert>
          )}

          <Textarea
            label="Motivo de la anulación"
            placeholder="Indicá por qué se anula (mínimo 5 caracteres)"
            required
            rows={3}
            maxLength={500}
            value={motivo}
            onChange={(e) => {
              setMotivo(e.currentTarget.value);
              if (errorMotivo) setErrorMotivo(null);
            }}
            error={errorMotivo}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" color="red" loading={guardando}>
              Anular costo
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
