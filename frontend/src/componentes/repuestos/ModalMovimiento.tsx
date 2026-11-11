import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  TextInput,
  Textarea,
  Select,
  Text,
  Group,
  Button,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import {
  CuerpoMovimiento,
  RepuestoDetalle,
  RespuestaMovimientoManual,
  ProveedorOpcion,
} from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, mensajeError } from '../../lib/errores';
import { formatCantidad, formatMoneda } from '../../lib/formato';
import { validarCantidad, validarCosto, cuerpoMovimiento } from '../../lib/repuestos';
import { CampoNumero } from '../CampoNumero';

export type TipoMovimientoModal = 'ingreso' | 'egreso' | 'ajuste';

export interface ModalMovimientoProps {
  abierto: boolean;
  onCerrar: () => void;
  tipo: TipoMovimientoModal;
  repuesto: RepuestoDetalle | null;
  onExito?: () => void;
}

export function ModalMovimiento({
  abierto,
  onCerrar,
  tipo,
  repuesto,
  onExito,
}: ModalMovimientoProps) {
  const queryClient = useQueryClient();
  const { usuario } = useAuth();

  const puedeCargarCostos = Boolean(
    usuario?.permisos &&
      (Array.isArray(usuario.permisos)
        ? usuario.permisos.includes('COSTOS_REGISTRAR')
        : (usuario.permisos as Record<string, unknown>)['COSTOS_REGISTRAR'])
  );

  const [cantidad, setCantidad] = useState<number | string>(1);
  const [costoUnitario, setCostoUnitario] = useState<number | string>('');
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [comprobante, setComprobante] = useState('');
  const [observacion, setObservacion] = useState('');
  const [motivo, setMotivo] = useState('');
  const [cantidadContada, setCantidadContada] = useState<number | string>(0);

  const [errorCantidad, setErrorCantidad] = useState<string | null>(null);
  const [errorCosto, setErrorCosto] = useState<string | null>(null);
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Opciones de proveedores (solo para ingreso)
  const { data: opcionesProveedores } = useQuery<ProveedorOpcion[]>({
    queryKey: ['proveedores', 'opciones'],
    queryFn: () => clienteApi.get<ProveedorOpcion[]>('/api/proveedores/opciones'),
    enabled: abierto && tipo === 'ingreso',
  });

  const selectProveedores = (opcionesProveedores || []).map((p) => ({
    value: String(p.id),
    label: p.nombre,
  }));

  useEffect(() => {
    if (abierto && repuesto) {
      setErrorCantidad(null);
      setErrorCosto(null);
      setErrorMotivo(null);
      setCantidad(1);
      setCostoUnitario(
        repuesto.costo_unitario !== null && repuesto.costo_unitario !== undefined
          ? repuesto.costo_unitario
          : ''
      );
      setProveedorId(repuesto.proveedor ? String(repuesto.proveedor.id) : null);
      setComprobante('');
      setObservacion('');
      setMotivo('');
      setCantidadContada(repuesto.cantidad_disponible ?? 0);
    }
  }, [abierto, tipo, repuesto]);

  if (!repuesto) return null;

  const stockActual = repuesto.cantidad_disponible ?? 0;
  const contadaNum = Number(cantidadContada);
  const diferencia = isNaN(contadaNum) ? 0 : contadaNum - stockActual;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorCantidad(null);
    setErrorCosto(null);
    setErrorMotivo(null);

    setGuardando(true);

    try {
      let payload: CuerpoMovimiento;

      if (tipo === 'ingreso') {
        const errCant = validarCantidad(cantidad);
        if (errCant) {
          setErrorCantidad(errCant);
          setGuardando(false);
          return;
        }

        const errCosto = validarCosto(costoUnitario);
        if (errCosto) {
          setErrorCosto(errCosto);
          setGuardando(false);
          return;
        }

        payload = cuerpoMovimiento('INGRESO', {
          cantidad: Number(cantidad),
          costo_unitario:
            puedeCargarCostos && costoUnitario !== '' && costoUnitario !== null
              ? Number(costoUnitario)
              : undefined,
          proveedor_id: proveedorId ? Number(proveedorId) : undefined,
          comprobante: comprobante.trim() ? comprobante.trim() : undefined,
          observacion: observacion.trim() ? observacion.trim() : undefined,
        });
      } else if (tipo === 'egreso') {
        const errCant = validarCantidad(cantidad, stockActual);
        if (errCant) {
          setErrorCantidad(errCant);
          setGuardando(false);
          return;
        }

        const motTrim = motivo.trim();
        if (!motTrim || motTrim.length < 5) {
          setErrorMotivo('Ingresá un motivo de al menos 5 caracteres.');
          setGuardando(false);
          return;
        }

        payload = cuerpoMovimiento('EGRESO', {
          cantidad: Number(cantidad),
          observacion: motTrim,
        });
      } else {
        if (String(cantidadContada).trim() === '') {
          setErrorCantidad('Ingresá una cantidad.');
          setGuardando(false);
          return;
        }

        if (isNaN(contadaNum) || contadaNum < 0) {
          setErrorCantidad('La cantidad contada no puede ser negativa.');
          setGuardando(false);
          return;
        }

        const motTrim = motivo.trim();
        if (!motTrim || motTrim.length < 5) {
          setErrorMotivo('Ingresá un motivo de al menos 5 caracteres.');
          setGuardando(false);
          return;
        }

        payload = cuerpoMovimiento('AJUSTE', {
          cantidad_contada: contadaNum,
          observacion: motTrim,
        });
      }

      await clienteApi.post<RespuestaMovimientoManual>(
        `/api/repuestos/${repuesto.id}/movimientos`,
        payload
      );

      const mensajeExito =
        tipo === 'ingreso'
          ? 'Ingreso de stock registrado.'
          : tipo === 'egreso'
            ? 'Egreso de stock registrado.'
            : 'Ajuste de inventario registrado.';
      notifications.show({ message: mensajeExito, color: 'green' });

      queryClient.invalidateQueries({ queryKey: ['repuesto', repuesto.id] });
      queryClient.invalidateQueries({ queryKey: ['repuestos'] });
      onCerrar();
      if (onExito) onExito();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.codigo === 'STOCK_INSUFICIENTE') {
        const disponible = err.datos?.disponible;
        const disp = typeof disponible === 'number' ? disponible : stockActual;
        setErrorCantidad(`Ya no alcanza: hay ${formatCantidad(disp)} en stock.`);
        queryClient.invalidateQueries({ queryKey: ['repuesto', repuesto.id] });
        return;
      }
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  const titulo =
    tipo === 'ingreso'
      ? `Ingreso de stock: ${repuesto.nombre}`
      : tipo === 'egreso'
        ? `Egreso manual de stock: ${repuesto.nombre}`
        : `Ajuste de inventario: ${repuesto.nombre}`;

  return (
    <Modal opened={abierto} onClose={onCerrar} title={titulo}>
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          {tipo === 'ingreso' && (
            <>
              <Group grow align="flex-start">
                <CampoNumero
                  label={`Cantidad a ingresar (${repuesto.unidad})`}
                  required
                  decimalScale={3}
                  value={cantidad}
                  onChange={setCantidad}
                  error={errorCantidad}
                />
                {puedeCargarCostos && (
                  <CampoNumero
                    label="Costo unitario"
                    prefix="$ "
                    decimalScale={2}
                    value={costoUnitario}
                    onChange={setCostoUnitario}
                    error={errorCosto}
                  />
                )}
              </Group>

              <Group grow align="flex-start">
                <Select
                  label="Proveedor"
                  placeholder="Opcional"
                  data={selectProveedores}
                  value={proveedorId}
                  onChange={setProveedorId}
                  clearable
                  searchable
                />
                <TextInput
                  label="Comprobante / Remito"
                  placeholder="Ej. R-0001-00012345"
                  value={comprobante}
                  onChange={(e) => setComprobante(e.currentTarget.value)}
                />
              </Group>

              <Textarea
                label="Observación"
                placeholder="Opcional"
                rows={2}
                value={observacion}
                onChange={(e) => setObservacion(e.currentTarget.value)}
              />
            </>
          )}

          {tipo === 'egreso' && (
            <>
              <Text size="sm" c="dimmed">
                Stock actual en depósito: <strong>{formatCantidad(stockActual)} {repuesto.unidad}</strong>
              </Text>

              <CampoNumero
                label={`Cantidad a egresar (${repuesto.unidad})`}
                required
                decimalScale={3}
                value={cantidad}
                onChange={setCantidad}
                error={errorCantidad}
              />

              <Textarea
                label="Motivo del egreso"
                placeholder="Indicá el motivo (mínimo 3 caracteres)"
                required
                rows={2}
                value={motivo}
                onChange={(e) => {
                  setMotivo(e.currentTarget.value);
                  if (errorMotivo) setErrorMotivo(null);
                }}
                error={errorMotivo}
              />
            </>
          )}

          {tipo === 'ajuste' && (
            <>
              <Text size="sm" c="dimmed">
                Stock actual según sistema: <strong>{formatCantidad(stockActual)} {repuesto.unidad}</strong>
              </Text>

              <CampoNumero
                label={`Cantidad contada en depósito (${repuesto.unidad})`}
                required
                decimalScale={3}
                value={cantidadContada}
                onChange={setCantidadContada}
                error={errorCantidad}
              />

              <Text size="sm" fw={500} c={diferencia === 0 ? 'dimmed' : diferencia < 0 ? 'red' : 'green'}>
                Diferencia:{' '}
                {diferencia > 0
                  ? `+${formatCantidad(diferencia)}`
                  : diferencia < 0
                    ? `\u2212${formatCantidad(Math.abs(diferencia))}`
                    : '0'}{' '}
                {repuesto.unidad}
              </Text>

              <Textarea
                label="Motivo del ajuste"
                placeholder="Recuento físico, descarte, rotura, etc. (mínimo 3 caracteres)"
                required
                rows={2}
                value={motivo}
                onChange={(e) => {
                  setMotivo(e.currentTarget.value);
                  if (errorMotivo) setErrorMotivo(null);
                }}
                error={errorMotivo}
              />
            </>
          )}

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" color="marca" loading={guardando}>
              Confirmar
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
