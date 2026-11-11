import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  TextInput,
  Textarea,
  Autocomplete,
  Switch,
  Select,
  Group,
  Button,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import {
  CuerpoRepuesto,
  RepuestoDetalle,
  RepuestoListaItem,
  ProveedorOpcion,
} from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import { validarCosto } from '../../lib/repuestos';
import { CampoNumero } from '../CampoNumero';

/** Stock inicial y mínimo: vacíos o desde 0. */
function errorDesdeCero(valor: number | string): string | null {
  if (String(valor).trim() === '') return null;
  const n = Number(valor);
  return isNaN(n) || n < 0 ? 'No puede ser negativo.' : null;
}

export interface ModalRepuestoProps {
  abierto: boolean;
  onCerrar: () => void;
  repuesto?: RepuestoListaItem | RepuestoDetalle | null;
  onExito?: (id: number) => void;
}

const UNIDADES_SUGERIDAS = ['unidad', 'metro', 'litro', 'kg', 'juego', 'caja'];

export function ModalRepuesto({ abierto, onCerrar, repuesto, onExito }: ModalRepuestoProps) {
  const queryClient = useQueryClient();
  const esEdicion = Boolean(repuesto);

  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [unidad, setUnidad] = useState('unidad');
  const [llevaStock, setLlevaStock] = useState(true);
  const [stockInicial, setStockInicial] = useState<number | string>(0);
  const [stockMinimo, setStockMinimo] = useState<number | string>('');
  const [costoUnitario, setCostoUnitario] = useState<number | string>('');
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [ubicacion, setUbicacion] = useState('');
  const [descripcion, setDescripcion] = useState('');

  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [errorStock, setErrorStock] = useState<string | null>(null);
  const [errorStockInicial, setErrorStockInicial] = useState<string | null>(null);
  const [errorStockMinimo, setErrorStockMinimo] = useState<string | null>(null);
  const [errorCosto, setErrorCosto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Opciones de proveedores (solo activos)
  const { data: opcionesProveedores } = useQuery<ProveedorOpcion[]>({
    queryKey: ['proveedores', 'opciones'],
    queryFn: () => clienteApi.get<ProveedorOpcion[]>('/api/proveedores/opciones'),
    enabled: abierto,
  });

  const selectProveedores = (opcionesProveedores || []).map((p) => ({
    value: String(p.id),
    label: p.nombre,
  }));

  useEffect(() => {
    if (abierto) {
      setErrorCodigo(null);
      setErrorNombre(null);
      setErrorStock(null);
      setErrorStockInicial(null);
      setErrorStockMinimo(null);
      setErrorCosto(null);
      if (repuesto) {
        setCodigo(repuesto.codigo || '');
        setNombre(repuesto.nombre);
        setUnidad(repuesto.unidad);
        setLlevaStock(repuesto.lleva_stock);
        setStockInicial(repuesto.cantidad_disponible ?? 0);
        setStockMinimo(repuesto.stock_minimo !== null && repuesto.stock_minimo !== undefined ? repuesto.stock_minimo : '');
        setCostoUnitario(repuesto.costo_unitario !== null && repuesto.costo_unitario !== undefined ? repuesto.costo_unitario : '');
        setProveedorId(repuesto.proveedor ? String(repuesto.proveedor.id) : null);
        setUbicacion(repuesto.ubicacion || '');
        setDescripcion((repuesto as RepuestoDetalle).descripcion || '');
      } else {
        setCodigo('');
        setNombre('');
        setUnidad('unidad');
        setLlevaStock(true);
        setStockInicial(0);
        setStockMinimo('');
        setCostoUnitario('');
        setProveedorId(null);
        setUbicacion('');
        setDescripcion('');
      }
    }
  }, [abierto, repuesto]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorCodigo(null);
    setErrorNombre(null);
    setErrorStock(null);
    setErrorStockInicial(null);
    setErrorStockMinimo(null);
    setErrorCosto(null);

    const nomTrim = nombre.trim();
    if (!nomTrim) {
      setErrorNombre('El nombre es obligatorio.');
      return;
    }

    if (llevaStock) {
      const errInicial = esEdicion ? null : errorDesdeCero(stockInicial);
      const errMinimo = errorDesdeCero(stockMinimo);
      if (errInicial || errMinimo) {
        setErrorStockInicial(errInicial);
        setErrorStockMinimo(errMinimo);
        return;
      }
    }

    const errC = validarCosto(costoUnitario);
    if (errC) {
      setErrorCosto(errC);
      return;
    }

    setGuardando(true);

    try {
      const payload: CuerpoRepuesto = {
        nombre: nomTrim,
        codigo: codigo.trim() ? codigo.trim() : null,
        unidad: unidad.trim() || 'unidad',
        lleva_stock: llevaStock,
        stock_minimo: llevaStock && stockMinimo !== '' && stockMinimo !== null ? Number(stockMinimo) : null,
        costo_unitario: costoUnitario !== '' && costoUnitario !== null ? Number(costoUnitario) : null,
        proveedor_id: proveedorId ? Number(proveedorId) : null,
        ubicacion: ubicacion.trim() ? ubicacion.trim() : null,
        descripcion: descripcion.trim() ? descripcion.trim() : null,
      };

      if (!esEdicion) {
        payload.stock_inicial = llevaStock && stockInicial !== '' && stockInicial !== null ? Number(stockInicial) : 0;
      }

      if (esEdicion && repuesto) {
        await clienteApi.put(`/api/repuestos/${repuesto.id}`, payload);
        notifications.show({ message: 'Repuesto actualizado.', color: 'green' });
        queryClient.invalidateQueries({ queryKey: ['repuestos'] });
        queryClient.invalidateQueries({ queryKey: ['repuesto', repuesto.id] });
        onCerrar();
        if (onExito) onExito(repuesto.id);
      } else {
        const creado = await clienteApi.post<RepuestoDetalle>('/api/repuestos', payload);
        notifications.show({ message: 'Repuesto creado.', color: 'green' });
        queryClient.invalidateQueries({ queryKey: ['repuestos'] });
        onCerrar();
        if (onExito) onExito(creado.id);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        const cod = err.codigo;
        if (cod === 'CODIGO_DUPLICADO') {
          setErrorCodigo('Ya existe un repuesto con este código.');
          return;
        }
        if (cod === 'TIENE_STOCK') {
          setErrorStock('No podés apagar el control de stock si el repuesto todavía tiene unidades en depósito.');
          return;
        }
      }
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title={esEdicion ? 'Editar repuesto' : 'Nuevo repuesto'}
      size="lg"
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <Group grow align="flex-start">
            <TextInput
              label="Código"
              placeholder="Ej. ROD-6204"
              value={codigo}
              onChange={(e) => {
                setCodigo(e.currentTarget.value);
                if (errorCodigo) setErrorCodigo(null);
              }}
              error={errorCodigo}
            />
            <TextInput
              label="Nombre"
              placeholder="Ej. Rodamiento rígido de bolas"
              required
              value={nombre}
              onChange={(e) => {
                setNombre(e.currentTarget.value);
                if (errorNombre) setErrorNombre(null);
              }}
              error={errorNombre}
            />
          </Group>

          <Group grow align="flex-start">
            <Autocomplete
              label="Unidad"
              data={UNIDADES_SUGERIDAS}
              value={unidad}
              onChange={setUnidad}
              required
            />
            <Select
              label="Proveedor habitual"
              placeholder="Seleccionar..."
              data={selectProveedores}
              value={proveedorId}
              onChange={setProveedorId}
              clearable
              searchable
            />
          </Group>

          <Switch
            label="Lleva control de stock"
            description="Lleva registro de existencias, ingresos, egresos y devoluciones"
            checked={llevaStock}
            onChange={(e) => {
              setLlevaStock(e.currentTarget.checked);
              if (errorStock) setErrorStock(null);
            }}
            error={errorStock}
          />

          {llevaStock && (
            <Group grow align="flex-start">
              {!esEdicion && (
                <CampoNumero
                  label="Stock inicial"
                  decimalScale={3}
                  value={stockInicial}
                  onChange={setStockInicial}
                  error={errorStockInicial}
                />
              )}
              <CampoNumero
                label="Stock mínimo"
                placeholder="Opcional"
                decimalScale={3}
                value={stockMinimo}
                onChange={setStockMinimo}
                error={errorStockMinimo}
              />
            </Group>
          )}

          <Group grow align="flex-start">
            <CampoNumero
              label="Costo unitario"
              placeholder="0,00"
              prefix="$ "
              decimalScale={2}
              value={costoUnitario}
              onChange={setCostoUnitario}
              error={errorCosto}
            />
            <TextInput
              label="Ubicación"
              placeholder="Ej. Estante A-3, Pañol 1"
              value={ubicacion}
              onChange={(e) => setUbicacion(e.currentTarget.value)}
            />
          </Group>

          <Textarea
            label="Descripción"
            placeholder="Detalles técnicos, especificaciones, etc."
            rows={3}
            value={descripcion}
            onChange={(e) => setDescripcion(e.currentTarget.value)}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" color="marca" loading={guardando}>
              {esEdicion ? 'Guardar cambios' : 'Crear repuesto'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
