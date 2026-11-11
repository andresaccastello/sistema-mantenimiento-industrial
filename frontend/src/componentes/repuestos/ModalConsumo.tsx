import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  Select,
  Textarea,
  Text,
  Group,
  Button,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { CuerpoConsumo, RepuestoOpcion } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, mensajeError } from '../../lib/errores';
import { formatCantidad } from '../../lib/formato';
import { validarCantidad, validarCosto } from '../../lib/repuestos';
import { CampoNumero } from '../CampoNumero';

export interface ModalConsumoProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  estadoIntervencion: string;
  onExito?: () => void;
}

export function ModalConsumo({
  abierto,
  onCerrar,
  intervencionId,
  estadoIntervencion,
  onExito,
}: ModalConsumoProps) {
  const queryClient = useQueryClient();
  const { usuario } = useAuth();

  const puedeCargarCostos = Boolean(
    usuario?.permisos &&
      (Array.isArray(usuario.permisos)
        ? usuario.permisos.includes('COSTOS_REGISTRAR')
        : (usuario.permisos as Record<string, unknown>)['COSTOS_REGISTRAR'])
  );

  const esFinalizada = estadoIntervencion === 'FINALIZADA';

  const [repuestoId, setRepuestoId] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState<number | string>(1);
  const [costoUnitario, setCostoUnitario] = useState<number | string>('');
  const [observacion, setObservacion] = useState('');
  const [motivo, setMotivo] = useState('');

  const [errorRepuesto, setErrorRepuesto] = useState<string | null>(null);
  const [errorCantidad, setErrorCantidad] = useState<string | null>(null);
  const [errorCosto, setErrorCosto] = useState<string | null>(null);
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Opciones de repuestos
  const { data: opcionesRepuestos } = useQuery<RepuestoOpcion[]>({
    queryKey: ['repuestos', 'opciones'],
    queryFn: () => clienteApi.get<RepuestoOpcion[]>('/api/repuestos/opciones'),
    enabled: abierto,
  });

  const repuestoElegido = opcionesRepuestos?.find((r) => String(r.id) === repuestoId);

  const selectRepuestos = (opcionesRepuestos || []).map((r) => {
    const prefijo = r.codigo ? `${r.codigo} · ${r.nombre}` : r.nombre;
    const sufijo = r.lleva_stock
      ? ` — stock: ${formatCantidad(r.cantidad_disponible)} (${r.unidad})`
      : ' — sin control de stock';
    return {
      value: String(r.id),
      label: `${prefijo}${sufijo}`,
    };
  });

  useEffect(() => {
    if (abierto) {
      setRepuestoId(null);
      setCantidad(1);
      setCostoUnitario('');
      setObservacion('');
      setMotivo('');
      setErrorRepuesto(null);
      setErrorCantidad(null);
      setErrorCosto(null);
      setErrorMotivo(null);
    }
  }, [abierto]);

  const handleRepuestoChange = (val: string | null) => {
    setRepuestoId(val);
    setErrorRepuesto(null);
    if (val && opcionesRepuestos) {
      const rep = opcionesRepuestos.find((r) => String(r.id) === val);
      if (rep && !rep.lleva_stock && rep.costo_unitario !== null && rep.costo_unitario !== undefined) {
        setCostoUnitario(rep.costo_unitario);
      } else {
        setCostoUnitario('');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorRepuesto(null);
    setErrorCantidad(null);
    setErrorCosto(null);
    setErrorMotivo(null);

    if (!repuestoId || !repuestoElegido) {
      setErrorRepuesto('Elegí un repuesto.');
      return;
    }

    const errCant = repuestoElegido.lleva_stock
      ? validarCantidad(cantidad, repuestoElegido.cantidad_disponible)
      : validarCantidad(cantidad);

    if (errCant) {
      setErrorCantidad(errCant);
      return;
    }

    if (!repuestoElegido.lleva_stock && puedeCargarCostos) {
      const errC = validarCosto(costoUnitario);
      if (errC) {
        setErrorCosto(errC);
        return;
      }
    }

    if (esFinalizada) {
      const mTrim = motivo.trim();
      if (!mTrim || mTrim.length < 5) {
        setErrorMotivo('Ingresá un motivo de corrección de al menos 5 caracteres.');
        return;
      }
    }

    setGuardando(true);

    try {
      const payload: CuerpoConsumo = {
        repuesto_id: Number(repuestoId),
        cantidad: Number(cantidad),
        observacion: observacion.trim() ? observacion.trim() : null,
      };

      if (!repuestoElegido.lleva_stock && puedeCargarCostos && costoUnitario !== '' && costoUnitario !== null) {
        payload.costo_unitario = Number(costoUnitario);
      }

      if (esFinalizada) {
        payload.motivo = motivo.trim();
      }

      await clienteApi.post(`/api/intervenciones/${intervencionId}/repuestos`, payload);

      notifications.show({ message: 'Repuesto registrado en la intervención.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['intervencion', intervencionId, 'repuestos'] });
      queryClient.invalidateQueries({ queryKey: ['intervencion', intervencionId] });
      queryClient.invalidateQueries({ queryKey: ['repuestos'] });
      queryClient.invalidateQueries({ queryKey: ['repuesto'] });
      onCerrar();
      if (onExito) onExito();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.codigo === 'STOCK_INSUFICIENTE') {
        const disponible = err.datos?.disponible;
        const disp =
          typeof disponible === 'number' ? disponible : repuestoElegido.cantidad_disponible;
        setErrorCantidad(`Ya no alcanza: hay ${formatCantidad(disp)} en stock.`);
        queryClient.invalidateQueries({ queryKey: ['repuestos', 'opciones'] });
        return;
      }
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal opened={abierto} onClose={onCerrar} title="Agregar repuesto usado" size="md">
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <Select
            label="Repuesto"
            placeholder="Buscar por código o nombre..."
            data={selectRepuestos}
            value={repuestoId}
            onChange={handleRepuestoChange}
            error={errorRepuesto}
            searchable
            required
          />

          {repuestoElegido && (
            <CampoNumero
              label={`Cantidad utilizada (${repuestoElegido.unidad})`}
              required
              decimalScale={3}
              value={cantidad}
              onChange={setCantidad}
              error={errorCantidad}
            />
          )}

          {repuestoElegido && !repuestoElegido.lleva_stock && puedeCargarCostos && (
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

          <Textarea
            label="Observación"
            placeholder="Opcional"
            rows={2}
            value={observacion}
            onChange={(e) => setObservacion(e.currentTarget.value)}
          />

          {esFinalizada && (
            <Textarea
              label="Motivo de la corrección"
              maxLength={500}
              placeholder="Indicá el motivo por el cual se agrega repuesto a una intervención finalizada (mínimo 5 caracteres)"
              required
              rows={2}
              value={motivo}
              onChange={(e) => {
                setMotivo(e.currentTarget.value);
                if (errorMotivo) setErrorMotivo(null);
              }}
              error={errorMotivo}
            />
          )}

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" color="marca" loading={guardando}>
              Registrar consumo
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
