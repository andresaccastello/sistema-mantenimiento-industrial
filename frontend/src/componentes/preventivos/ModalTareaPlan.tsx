import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Stack, TextInput, Textarea, Group, Select, Button, Alert, Text } from '@mantine/core';
import { DatePickerInput, DateStringValue } from '@mantine/dates';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { FrecuenciaUnidad, ProveedorOpcion, RepuestoOpcion } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import {
  BorradorTarea,
  CampoTarea,
  ErroresTarea,
  UNIDADES_FRECUENCIA,
  errorTareaDeApi,
  hayErrores,
  validarTareaBorrador,
} from '../../lib/preventivos';
import { CampoNumero } from '../CampoNumero';

export interface ErrorTareaExterno {
  campo: CampoTarea | null;
  mensaje: string;
}

interface Props {
  abierto: boolean;
  titulo: string;
  /** La tarea vacía, o la que se edita. */
  inicial: BorradorTarea;
  /** Al editar una tarea que ya se hizo: cambia la ayuda de la primera fecha. */
  yaSeHizo?: boolean;
  /** P3: el error que la API devolvió para esta tarea, con su indice. */
  errorInicial?: ErrorTareaExterno | null;
  /** Guarda en la API, o devuelve la tarea al formulario. Si lanza un ApiError, se muestra. */
  onGuardar: (borrador: BorradorTarea) => Promise<void>;
  onCerrar: () => void;
}

/**
 * 3.5 El diálogo de una tarea, para agregar y para editar. Valida con validarTareaBorrador
 * antes de mandar, y pone los errores de la API en su campo cuando se puede.
 */
export function ModalTareaPlan({ abierto, titulo, inicial, yaSeHizo, errorInicial, onGuardar, onCerrar }: Props) {
  const [b, setB] = useState<BorradorTarea>(inicial);
  const [errores, setErrores] = useState<ErroresTarea>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setB(inicial);
    setErrorGeneral(null);
    if (errorInicial?.campo) {
      setErrores({ [errorInicial.campo]: errorInicial.mensaje });
    } else {
      setErrores({});
      if (errorInicial) setErrorGeneral(errorInicial.mensaje);
    }
    // Solo al abrir: `inicial` cambia de identidad en cada render del padre
  }, [abierto]);

  const { data: repuestos } = useQuery<RepuestoOpcion[]>({
    queryKey: ['repuestos', 'opciones'],
    queryFn: () => clienteApi.get<RepuestoOpcion[]>('/api/repuestos/opciones'),
    enabled: abierto,
  });
  const { data: proveedores } = useQuery<ProveedorOpcion[]>({
    queryKey: ['proveedores', 'opciones'],
    queryFn: () => clienteApi.get<ProveedorOpcion[]>('/api/proveedores/opciones'),
    enabled: abierto,
  });
  const repuesto = repuestos?.find((r) => String(r.id) === b.repuestoId);

  const cambiar = (cambios: Partial<BorradorTarea>, limpiar: CampoTarea[]) => {
    setB((actual) => ({ ...actual, ...cambios }));
    setErrores((actual) => {
      const nuevos = { ...actual };
      for (const campo of limpiar) delete nuevos[campo];
      return nuevos;
    });
  };

  const guardar = async () => {
    const encontrados = validarTareaBorrador(b);
    setErrores(encontrados);
    setErrorGeneral(null);
    if (hayErrores(encontrados)) return;

    setGuardando(true);
    try {
      await onGuardar(b);
    } catch (err) {
      const enCampo = err instanceof ApiError ? errorTareaDeApi(err.codigo, err.message) : null;
      if (enCampo) {
        setErrores({ [enCampo.campo]: enCampo.mensaje });
      } else {
        setErrorGeneral(mensajeError(err));
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal opened={abierto} onClose={onCerrar} title={titulo} size="lg">
      <Stack gap="md">
        <TextInput
          label="Acción"
          placeholder="Qué hay que hacer"
          required
          maxLength={200}
          value={b.accion}
          onChange={(e) => cambiar({ accion: e.currentTarget.value }, ['accion'])}
          error={errores.accion}
        />
        <Textarea
          label="Detalle"
          placeholder="Instrucciones (opcional)"
          autosize
          minRows={2}
          maxLength={2000}
          value={b.detalle}
          onChange={(e) => cambiar({ detalle: e.currentTarget.value }, [])}
        />

        <Group grow align="flex-start">
          <CampoNumero
            label="Cada"
            required
            allowDecimal={false}
            value={b.frecuenciaValor}
            onChange={(v) => cambiar({ frecuenciaValor: v }, ['frecuencia'])}
            error={errores.frecuencia}
          />
          <Select
            label="Unidad"
            aria-label="Unidad de la frecuencia"
            data={UNIDADES_FRECUENCIA}
            allowDeselect={false}
            value={b.frecuenciaUnidad}
            onChange={(v) => v && cambiar({ frecuenciaUnidad: v as FrecuenciaUnidad }, ['frecuencia'])}
          />
        </Group>

        <DatePickerInput
          label="Primera fecha"
          required
          valueFormat="DD/MM/YYYY"
          placeholder="Elegí la fecha"
          description={
            yaSeHizo
              ? 'Ya se hizo: la próxima fecha se cuenta desde la última vez.'
              : 'Cuándo vence por primera vez.'
          }
          value={b.primeraFecha}
          onChange={(v: DateStringValue | null) => cambiar({ primeraFecha: v }, ['primeraFecha'])}
          error={errores.primeraFecha}
        />

        <Group grow align="flex-start">
          <Select
            label="Repuesto sugerido"
            placeholder="Opcional"
            searchable
            clearable
            data={(repuestos || []).map((r) => ({
              value: String(r.id),
              label: r.codigo ? `${r.codigo} · ${r.nombre}` : r.nombre,
            }))}
            value={b.repuestoId}
            onChange={(v) => cambiar(v ? { repuestoId: v } : { repuestoId: null, cantidad: '' }, ['repuesto', 'cantidad'])}
            error={errores.repuesto}
          />
          {b.repuestoId && (
            <CampoNumero
              label="Cantidad"
              required
              decimalScale={3}
              rightSection={
                repuesto ? (
                  <Text size="xs" c="dimmed" pr="xs">
                    {repuesto.unidad}
                  </Text>
                ) : undefined
              }
              rightSectionWidth={repuesto ? 70 : undefined}
              value={b.cantidad}
              onChange={(v) => cambiar({ cantidad: v }, ['cantidad', 'repuesto'])}
              error={errores.cantidad}
            />
          )}
        </Group>

        <Select
          label="Proveedor sugerido"
          placeholder="Opcional"
          searchable
          clearable
          data={(proveedores || []).map((p) => ({ value: String(p.id), label: p.nombre }))}
          value={b.proveedorId}
          onChange={(v) => cambiar({ proveedorId: v }, ['proveedor'])}
          error={errores.proveedor}
        />

        {errorGeneral && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {errorGeneral}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button color="marca" onClick={guardar} loading={guardando}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
