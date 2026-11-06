import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  TextInput,
  Textarea,
  Select,
  Group,
  Button,
} from '@mantine/core';
import { DatePickerInput, DateStringValue } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import {
  CuerpoPedido,
  PedidoIntervencionItem,
  RepuestoOpcion,
  ProveedorOpcion,
} from '../../api/tipos';
import { mensajeError } from '../../lib/errores';
import { hoyLocal, validarCantidad } from '../../lib/repuestos';
import { CampoNumero } from './CampoNumero';

export interface ModalPedidoProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  pedido?: PedidoIntervencionItem | null;
  onExito?: () => void;
}

/**
 * Mantine 9 entrega y recibe los días como `YYYY-MM-DD`, igual que la API:
 * se usan tal cual, sin pasar por `Date`.
 */
function diaValido(s: string | null | undefined): DateStringValue | null {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
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
  const [pedidoEn, setPedidoEn] = useState<DateStringValue | null>(null);
  const [esperadoPara, setEsperadoPara] = useState<DateStringValue | null>(null);
  const [observacion, setObservacion] = useState('');

  const [errorDescripcion, setErrorDescripcion] = useState<string | null>(null);
  const [errorCantidad, setErrorCantidad] = useState<string | null>(null);
  const [errorFechas, setErrorFechas] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Opciones de repuestos
  const { data: opcionesRepuestos } = useQuery<RepuestoOpcion[]>({
    queryKey: ['repuestos', 'opciones'],
    queryFn: () => clienteApi.get<RepuestoOpcion[]>('/api/repuestos/opciones'),
    enabled: abierto,
  });

  // Opciones de proveedores
  const { data: opcionesProveedores } = useQuery<ProveedorOpcion[]>({
    queryKey: ['proveedores', 'opciones'],
    queryFn: () => clienteApi.get<ProveedorOpcion[]>('/api/proveedores/opciones'),
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
        setPedidoEn(diaValido(pedido.pedido_en));
        setEsperadoPara(diaValido(pedido.esperado_para));
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

  const handleRepuestoChange = (val: string | null) => {
    setRepuestoId(val);
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

    const errCant = validarCantidad(cantidad);
    if (errCant) {
      setErrorCantidad(errCant);
      return;
    }
    const cantNum = Number(cantidad);

    const pedidoEnStr = diaValido(pedidoEn);
    const esperadoParaStr = diaValido(esperadoPara);

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
      const payload: CuerpoPedido = {
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
    } catch (err: unknown) {
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
            <CampoNumero
              label="Cantidad"
              required
              decimalScale={3}
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
              onChange={(d: DateStringValue | null) => {
                setPedidoEn(d);
                if (errorFechas) setErrorFechas(null);
              }}
              maxDate={new Date()}
              clearable
            />
            <DatePickerInput
              label="Se espera para"
              placeholder="Fecha estimada"
              value={esperadoPara}
              onChange={(d: DateStringValue | null) => {
                setEsperadoPara(d);
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
