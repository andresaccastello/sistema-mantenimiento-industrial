import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  TextInput,
  Textarea,
  NumberInput,
  Select,
  Group,
  Button,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { PedidoRepuestoItem } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import { hoyLocal } from '../../lib/repuestos';

export interface ModalPedidoProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  pedido?: PedidoRepuestoItem | null;
  onExito?: () => void;
}

function parseYMD(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function aYYYYMMDD(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const val = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(val.getTime())) return null;
  const year = val.getFullYear();
  const month = String(val.getMonth() + 1).padStart(2, '0');
  const day = String(val.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ModalPedido({
  abierto,
  onCerrar,
  intervencionId,
  pedido,
  onExito,
}: ModalPedidoProps) {
  const queryClient = useQueryClient();
  const esEdicion = Boolean(pedido);

  const [repuestoId, setRepuestoId] = useState<string | null>(null);
  const [descripcion, setDescripcion] = useState('');
  const [cantidad, setCantidad] = useState<number | string>(1);
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [pedidoEn, setPedidoEn] = useState<Date | null>(null);
  const [esperadoPara, setEsperadoPara] = useState<Date | null>(null);
  const [observacion, setObservacion] = useState('');

  const [errorDescripcion, setErrorDescripcion] = useState<string | null>(null);
  const [errorCantidad, setErrorCantidad] = useState<string | null>(null);
  const [errorFechas, setErrorFechas] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Opciones de repuestos
  const { data: opcionesRepuestos } = useQuery<
    Array<{ id: number; codigo: string | null; nombre: string; unidad: string; lleva_stock: boolean; proveedor_id?: number | null }>
  >({
    queryKey: ['repuestos', 'opciones'],
    queryFn: () => clienteApi.get('/api/repuestos/opciones'),
    enabled: abierto,
  });

  // Opciones de proveedores
  const { data: opcionesProveedores } = useQuery<Array<{ id: number; nombre: string }>>({
    queryKey: ['proveedores', 'opciones'],
    queryFn: () => clienteApi.get('/api/proveedores/opciones'),
    enabled: abierto,
  });

  const selectRepuestos = (opcionesRepuestos || []).map((r) => ({
    value: String(r.id),
    label: r.codigo ? `${r.codigo} · ${r.nombre}` : r.nombre,
  }));

  const selectProveedores = (opcionesProveedores || []).map((p) => ({
    value: String(p.id),
    label: p.nombre,
  }));

  useEffect(() => {
    if (abierto) {
      setErrorDescripcion(null);
      setErrorCantidad(null);
      setErrorFechas(null);
      if (pedido) {
        setRepuestoId(pedido.repuesto ? String(pedido.repuesto.id) : null);
        setDescripcion(pedido.descripcion || '');
        setCantidad(pedido.cantidad);
        setProveedorId(pedido.proveedor ? String(pedido.proveedor.id) : null);
        setPedidoEn(parseYMD(pedido.pedido_en));
        setEsperadoPara(parseYMD(pedido.esperado_para));
        setObservacion(pedido.observacion || '');
      } else {
        setRepuestoId(null);
        setDescripcion('');
        setCantidad(1);
        setProveedorId(null);
        setPedidoEn(null);
        setEsperadoPara(null);
        setObservacion('');
      }
    }
  }, [abierto, pedido]);

  // Al elegir un repuesto, proponer su proveedor habitual si tiene y aún no se eligió proveedor
  const handleRepuestoChange = (val: string | null) => {
    setRepuestoId(val);
    if (val && opcionesRepuestos) {
      const rep = opcionesRepuestos.find((r) => String(r.id) === val);
      if (rep?.proveedor_id) {
        setProveedorId(String(rep.proveedor_id));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorDescripcion(null);
    setErrorCantidad(null);
    setErrorFechas(null);

    if (!repuestoId && (!descripcion.trim() || descripcion.trim().length < 3)) {
      setErrorDescripcion('Indicá una descripción de al menos 3 caracteres si no elegís un repuesto.');
      return;
    }

    const cantNum = Number(cantidad);
    if (isNaN(cantNum) || cantNum <= 0) {
      setErrorCantidad('La cantidad debe ser mayor a cero.');
      return;
    }

    const pedidoEnStr = aYYYYMMDD(pedidoEn);
    const esperadoParaStr = aYYYYMMDD(esperadoPara);

    const hoy = hoyLocal();
    if (pedidoEnStr && pedidoEnStr > hoy) {
      setErrorFechas('La fecha del pedido no puede ser futura.');
      return;
    }

    if (pedidoEnStr && esperadoParaStr && esperadoParaStr < pedidoEnStr) {
      setErrorFechas('La fecha prevista no puede ser anterior a la del pedido.');
      return;
    }

    setGuardando(true);

    try {
      const payload: Record<string, any> = {
        repuesto_id: repuestoId ? Number(repuestoId) : null,
        descripcion: descripcion.trim() ? descripcion.trim() : null,
        cantidad: cantNum,
        proveedor_id: proveedorId ? Number(proveedorId) : null,
        pedido_en: pedidoEnStr,
        esperado_para: esperadoParaStr,
        observacion: observacion.trim() ? observacion.trim() : null,
      };

      if (esEdicion && pedido) {
        await clienteApi.patch(`/api/intervenciones/${intervencionId}/pedidos/${pedido.id}`, payload);
        notifications.show({ message: 'Pedido actualizado.', color: 'green' });
      } else {
        await clienteApi.post(`/api/intervenciones/${intervencionId}/pedidos`, payload);
        notifications.show({ message: 'Pedido creado.', color: 'green' });
      }

      queryClient.invalidateQueries({ queryKey: ['intervencion', intervencionId, 'pedidos'] });
      queryClient.invalidateQueries({ queryKey: ['pedidos-repuesto'] });
      queryClient.invalidateQueries({ queryKey: ['repuestos'] });
      onCerrar();
      if (onExito) onExito();
    } catch (err: any) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title={esEdicion ? 'Editar pedido de repuesto' : 'Agregar pedido de repuesto'}
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <Select
            label="Repuesto del catálogo"
            placeholder="Elegir repuesto (opcional)"
            data={selectRepuestos}
            value={repuestoId}
            onChange={handleRepuestoChange}
            clearable
            searchable
          />

          {!repuestoId && (
            <TextInput
              label="Descripción de lo que se pide"
              placeholder="Ej. Correa dentada 150 XL 037"
              required
              value={descripcion}
              onChange={(e) => {
                setDescripcion(e.currentTarget.value);
                if (errorDescripcion) setErrorDescripcion(null);
              }}
              error={errorDescripcion}
            />
          )}

          <Group grow align="flex-start">
            <NumberInput
              label="Cantidad"
              required
              decimalSeparator=","
              thousandSeparator="."
              decimalScale={3}
              min={0.001}
              value={cantidad}
              onChange={setCantidad}
              error={errorCantidad}
            />
            <Select
              label="Proveedor"
              placeholder="Opcional"
              data={selectProveedores}
              value={proveedorId}
              onChange={setProveedorId}
              clearable
              searchable
            />
          </Group>

          <Group grow align="flex-start">
            <DatePickerInput
              label="Fecha del pedido"
              placeholder="Hoy o fecha pasada"
              value={pedidoEn}
              onChange={(d: any) => {
                setPedidoEn(d ? (typeof d === 'string' ? new Date(d) : d) : null);
                if (errorFechas) setErrorFechas(null);
              }}
              maxDate={new Date()}
              clearable
            />
            <DatePickerInput
              label="Se espera para"
              placeholder="Fecha estimada"
              value={esperadoPara}
              onChange={(d: any) => {
                setEsperadoPara(d ? (typeof d === 'string' ? new Date(d) : d) : null);
                if (errorFechas) setErrorFechas(null);
              }}
              minDate={pedidoEn || undefined}
              clearable
            />
          </Group>
          {errorFechas && (
            <TextInput
              style={{ display: 'none' }}
              error={errorFechas}
            />
          )}

          <Textarea
            label="Observación"
            placeholder="N.º de cotización, contacto de urgencia, etc."
            rows={2}
            value={observacion}
            onChange={(e) => setObservacion(e.currentTarget.value)}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" color="marca" loading={guardando}>
              {esEdicion ? 'Guardar cambios' : 'Crear pedido'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
