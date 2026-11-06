import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  TextInput,
  Switch,
  Group,
  Button,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { CuerpoRecepcion, PedidoIntervencionItem } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { mensajeError } from '../../lib/errores';
import { Momento, momentoAIso } from '../../lib/fechas';
import { validarCosto } from '../../lib/repuestos';
import { SelectorMomento } from '../SelectorMomento';
import { CampoNumero } from './CampoNumero';

export interface ModalRecibirPedidoProps {
  abierto: boolean;
  onCerrar: () => void;
  pedido: PedidoIntervencionItem | null;
  onExito?: () => void;
}

export function ModalRecibirPedido({
  abierto,
  onCerrar,
  pedido,
  onExito,
}: ModalRecibirPedidoProps) {
  const queryClient = useQueryClient();
  const { usuario } = useAuth();

  const puedeCargarCostos = Boolean(
    usuario?.permisos &&
      (Array.isArray(usuario.permisos)
        ? usuario.permisos.includes('COSTOS_REGISTRAR')
        : (usuario.permisos as Record<string, unknown>)['COSTOS_REGISTRAR'])
  );

  const admiteStock = Boolean(pedido?.repuesto && pedido.repuesto.lleva_stock);

  const [momento, setMomento] = useState<Momento>({ modo: 'ahora', fecha: null });
  const [ingresarStock, setIngresarStock] = useState(admiteStock);
  const [costoUnitario, setCostoUnitario] = useState<number | string>('');
  const [comprobante, setComprobante] = useState('');
  const [errorCosto, setErrorCosto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (abierto) {
      setMomento({ modo: 'ahora', fecha: null });
      setIngresarStock(Boolean(pedido?.repuesto && pedido.repuesto.lleva_stock));
      setCostoUnitario('');
      setComprobante('');
      setErrorCosto(null);
    }
  }, [abierto, pedido]);

  if (!pedido) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorCosto(null);

    const mandaCosto = admiteStock && ingresarStock && puedeCargarCostos;
    if (mandaCosto) {
      const errC = validarCosto(costoUnitario);
      if (errC) {
        setErrorCosto(errC);
        return;
      }
    }

    setGuardando(true);

    try {
      const payload: CuerpoRecepcion = {
        ingresar_stock: ingresarStock,
        comprobante: comprobante.trim() ? comprobante.trim() : null,
      };

      const iso = momentoAIso(momento);
      if (iso) {
        payload.recibido_en = iso;
      }

      if (mandaCosto && costoUnitario !== '' && costoUnitario !== null) {
        payload.costo_unitario = Number(costoUnitario);
      }

      await clienteApi.post(
        `/api/intervenciones/${pedido.intervencion_id}/pedidos/${pedido.id}/recibir`,
        payload
      );

      notifications.show({ message: 'Pedido marcado como recibido.', color: 'green' });
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
    <Modal opened={abierto} onClose={onCerrar} title="Recibir pedido de repuesto">
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <SelectorMomento
            label="¿Cuándo llegó el repuesto?"
            value={momento}
            onChange={setMomento}
          />

          {admiteStock && (
            <Switch
              label="Ingresar al stock"
              description="Suma la cantidad recibida a las existencias del catálogo"
              checked={ingresarStock}
              onChange={(e) => setIngresarStock(e.currentTarget.checked)}
            />
          )}

          {admiteStock && ingresarStock && puedeCargarCostos && (
            <CampoNumero
              label="Costo unitario"
              placeholder="0,00"
              prefix="$ "
              decimalScale={2}
              value={costoUnitario}
              onChange={setCostoUnitario}
              error={errorCosto}
            />
          )}

          <TextInput
            label="Comprobante / Remito"
            placeholder="Ej. R-0001-00012345"
            maxLength={60}
            value={comprobante}
            onChange={(e) => setComprobante(e.currentTarget.value)}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" color="marca" loading={guardando}>
              Confirmar recepción
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
