import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Stack, TextInput, Switch, Group, Button, Checkbox, Select, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { CuerpoRecepcion, PedidoBase, RecepcionPedidoRespuesta, RepuestoOpcion } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { mensajeError } from '../../lib/errores';
import { formatCantidad } from '../../lib/formato';
import { Momento, momentoAIso } from '../../lib/fechas';
import { validarCantidad, validarCosto } from '../../lib/repuestos';
import { permiteUsarAlRecibir, textoResumenRecepcion } from '../../lib/compras';
import { SelectorMomento } from '../SelectorMomento';
import { CampoNumero } from '../CampoNumero';
import { ModalRepuesto } from './ModalRepuesto';

export interface ModalRecibirPedidoProps {
  abierto: boolean;
  onCerrar: () => void;
  pedido: PedidoBase | null;
  onExito?: () => void;
  /**
   * PC1, 6.2: solo desde la intervención. Con la intervención en proceso o esperando
   * repuestos, y si el usuario puede cargar usos, se ofrece "Usar en esta intervención".
   */
  usoEnIntervencion?: { estado: string; puedeRegistrar: boolean };
  /** PC1, 6.3: la respuesta de la recepción, para ofrecer "Reanudar". */
  onRecibido?: (respuesta: RecepcionPedidoRespuesta) => void;
}

export function ModalRecibirPedido({
  abierto,
  onCerrar,
  pedido,
  onExito,
  usoEnIntervencion,
  onRecibido,
}: ModalRecibirPedidoProps) {
  const queryClient = useQueryClient();
  const { tienePermiso } = useAuth();
  const puedeCargarCostos = tienePermiso('COSTOS_REGISTRAR') || tienePermiso('REPUESTOS_GESTIONAR');
  const puedeCrearRepuesto = tienePermiso('REPUESTOS_GESTIONAR');

  const ofreceUsar = Boolean(
    usoEnIntervencion && usoEnIntervencion.puedeRegistrar && permiteUsarAlRecibir(usoEnIntervencion.estado)
  );

  const [momento, setMomento] = useState<Momento>({ modo: 'ahora', fecha: null });
  const [ingresarStock, setIngresarStock] = useState(false);
  const [costoUnitario, setCostoUnitario] = useState<number | string>('');
  const [costoTocado, setCostoTocado] = useState(false);
  const [comprobante, setComprobante] = useState('');
  const [usar, setUsar] = useState(false);
  const [cantidadUso, setCantidadUso] = useState<number | string>('');
  const [repuestoElegido, setRepuestoElegido] = useState<string | null>(null);
  const [nuevoRepuestoAbierto, setNuevoRepuestoAbierto] = useState(false);
  const [errorCosto, setErrorCosto] = useState<string | null>(null);
  const [errorUso, setErrorUso] = useState<string | null>(null);
  const [errorRepuesto, setErrorRepuesto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Las opciones del catálogo: el costo actual para precargar y el Select de un pedido de texto libre
  const { data: opciones } = useQuery<RepuestoOpcion[]>({
    queryKey: ['repuestos', 'opciones'],
    queryFn: () => clienteApi.get<RepuestoOpcion[]>('/api/repuestos/opciones'),
    enabled: abierto,
  });

  const textoLibre = !pedido?.repuesto;
  const elegido = textoLibre && repuestoElegido ? opciones?.find((o) => String(o.id) === repuestoElegido) ?? null : null;
  // El repuesto con el que se recibe: el del pedido o, para usarlo, el elegido del catálogo (D2)
  const repuesto: { id: number; lleva_stock: boolean } | null = pedido?.repuesto ?? (usar ? elegido : null);
  const llevaStock = Boolean(repuesto?.lleva_stock);
  const usarMarcado = ofreceUsar && usar;
  const stockObligatorio = usarMarcado && llevaStock;
  const ingresarEfectivo = llevaStock && (ingresarStock || stockObligatorio);

  useEffect(() => {
    if (abierto) {
      setMomento({ modo: 'ahora', fecha: null });
      setIngresarStock(Boolean(pedido?.repuesto && pedido.repuesto.lleva_stock));
      setCostoUnitario('');
      setCostoTocado(false);
      setComprobante('');
      setUsar(ofreceUsar);
      setCantidadUso(pedido?.cantidad ?? '');
      setRepuestoElegido(null);
      setErrorCosto(null);
      setErrorUso(null);
      setErrorRepuesto(null);
    }
  }, [abierto, pedido, ofreceUsar]);

  // Precarga el costo actual del repuesto, mientras el usuario no lo haya tocado
  const idParaCosto = repuesto?.id ?? null;
  useEffect(() => {
    if (!abierto || costoTocado || idParaCosto === null) return;
    const costo = opciones?.find((o) => o.id === idParaCosto)?.costo_unitario;
    setCostoUnitario(costo !== null && costo !== undefined ? costo : '');
  }, [abierto, costoTocado, idParaCosto, opciones]);

  if (!pedido) return null;

  const cantidadPedido = pedido.cantidad;
  const costoNumero = puedeCargarCostos && costoUnitario !== '' && !isNaN(Number(costoUnitario)) ? Number(costoUnitario) : null;
  const usoListo = usarMarcado && repuesto !== null;
  // LE1, 7.2: el stock de antes, para el total que queda
  const opcionRepuesto = repuesto ? opciones?.find((o) => o.id === repuesto.id) : undefined;
  const resumen = textoResumenRecepcion({
    stockAntes: opcionRepuesto ? opcionRepuesto.cantidad_disponible : null,
    cantidad: cantidadPedido,
    llevaStock,
    ingresarStock: ingresarEfectivo,
    usar: usoListo,
    cantidadUso: llevaStock ? Number(cantidadUso) || 0 : cantidadPedido,
    costoUnitario: costoNumero,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorCosto(null);
    setErrorUso(null);
    setErrorRepuesto(null);

    if (puedeCargarCostos) {
      const errC = validarCosto(costoUnitario);
      if (errC) {
        setErrorCosto(errC);
        return;
      }
    }
    if (usarMarcado && textoLibre && !elegido) {
      setErrorRepuesto('Elegí el repuesto del catálogo para usarlo.');
      return;
    }
    if (usoListo && llevaStock) {
      const errU = validarCantidad(cantidadUso);
      if (errU) {
        setErrorUso(errU);
        return;
      }
      if (Number(cantidadUso) > cantidadPedido) {
        setErrorUso(`Como mucho, lo recibido: ${formatCantidad(cantidadPedido)}.`);
        return;
      }
    }

    setGuardando(true);
    try {
      const payload: CuerpoRecepcion = {
        ingresar_stock: ingresarEfectivo,
        comprobante: comprobante.trim() ? comprobante.trim() : null,
      };
      const iso = momentoAIso(momento);
      if (iso) payload.recibido_en = iso;
      if (costoNumero !== null) payload.costo_unitario = costoNumero;
      if (usoListo) {
        payload.usar = { cantidad: llevaStock ? Number(cantidadUso) : cantidadPedido };
        if (textoLibre && elegido) payload.repuesto_id = elegido.id;
      }

      const respuesta = await clienteApi.post<RecepcionPedidoRespuesta>(
        `/api/intervenciones/${pedido.intervencion_id}/pedidos/${pedido.id}/recibir`,
        payload
      );

      notifications.show({ message: 'Pedido marcado como recibido.', color: 'green' });
      queryClient.invalidateQueries({ queryKey: ['pedidos-repuesto'] });
      queryClient.invalidateQueries({ queryKey: ['intervencion', pedido.intervencion_id] });
      queryClient.invalidateQueries({ queryKey: ['repuestos'] });
      queryClient.invalidateQueries({ queryKey: ['reportes'] });
      const repuestoId = respuesta.repuesto?.id ?? pedido.repuesto?.id;
      if (repuestoId) {
        queryClient.invalidateQueries({ queryKey: ['repuesto', repuestoId] });
      }
      onCerrar();
      if (onExito) onExito();
      if (onRecibido) onRecibido(respuesta);
    } catch (err: unknown) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  const selectRepuestos = (opciones ?? []).map((r) => ({
    value: String(r.id),
    label: r.codigo ? `${r.codigo} · ${r.nombre}` : r.nombre,
  }));

  return (
    <Modal opened={abierto} onClose={onCerrar} title="Recibir pedido de repuesto">
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <SelectorMomento label="¿Cuándo llegó el repuesto?" value={momento} onChange={setMomento} />

          <TextInput
            label="Comprobante (factura o remito)"
            placeholder="Ej. A-0001-00012345"
            maxLength={60}
            value={comprobante}
            onChange={(e) => setComprobante(e.currentTarget.value)}
          />

          {puedeCargarCostos && (
            <CampoNumero
              label="Costo unitario"
              placeholder="0,00"
              prefix="$ "
              decimalScale={2}
              value={costoUnitario}
              onChange={(v) => {
                setCostoTocado(true);
                setCostoUnitario(v);
              }}
              error={errorCosto}
            />
          )}

          {ofreceUsar && (
            <Checkbox
              label="Usar en esta intervención"
              checked={usar}
              onChange={(e) => setUsar(e.currentTarget.checked)}
            />
          )}

          {usarMarcado && textoLibre && (
            <Group align="flex-end" gap="xs" wrap="nowrap">
              <Select
                label="Repuesto del catálogo"
                placeholder="Elegí el repuesto"
                data={selectRepuestos}
                value={repuestoElegido}
                onChange={setRepuestoElegido}
                searchable
                required
                error={errorRepuesto}
                style={{ flex: 1 }}
              />
              {puedeCrearRepuesto && (
                <Button variant="default" leftSection={<IconPlus size={14} />} onClick={() => setNuevoRepuestoAbierto(true)}>
                  Nuevo repuesto
                </Button>
              )}
            </Group>
          )}

          {llevaStock && (
            <Switch
              label="Ingresar al stock"
              description={
                stockObligatorio
                  ? 'Para usarlo, primero entra al stock'
                  : 'Suma la cantidad recibida a las existencias del catálogo'
              }
              checked={ingresarEfectivo}
              disabled={stockObligatorio}
              onChange={(e) => setIngresarStock(e.currentTarget.checked)}
            />
          )}

          {usoListo && (
            <CampoNumero
              label="Cantidad a usar"
              description={llevaStock ? `Hasta lo recibido: ${formatCantidad(cantidadPedido)}` : 'Sin stock, se usa todo lo recibido'}
              decimalScale={3}
              value={llevaStock ? cantidadUso : cantidadPedido}
              onChange={setCantidadUso}
              disabled={!llevaStock}
              error={errorUso}
            />
          )}

          <Text size="sm" c="dimmed">
            {resumen}
          </Text>

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

      {puedeCrearRepuesto && (
        <ModalRepuesto
          abierto={nuevoRepuestoAbierto}
          onCerrar={() => setNuevoRepuestoAbierto(false)}
          onExito={(id) => setRepuestoElegido(String(id))}
        />
      )}
    </Modal>
  );
}
