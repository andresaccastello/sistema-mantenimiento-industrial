import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Stack, TextInput, Textarea, Group, Select, Button, Alert, Text, ActionIcon } from '@mantine/core';
import { DatePickerInput, DateStringValue } from '@mantine/dates';
import { IconAlertCircle, IconPlus, IconTrash } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { FrecuenciaUnidad, ProveedorOpcion, RepuestoOpcion } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import {
  BorradorTarea,
  CampoTarea,
  ErroresTarea,
  FilaPrevisto,
  MAXIMO_PREVISTOS,
  UNIDADES_FRECUENCIA,
  errorTareaDeApi,
  erroresDeApi,
  hayErrores,
  sinErrorDeFila,
  validarTareaBorrador,
} from '../../lib/preventivos';
import { CampoNumero } from '../CampoNumero';

export interface ErrorTareaExterno {
  campo: CampoTarea | null;
  mensaje: string;
  indiceRepuesto?: number;
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
      setErrores(erroresDeApi({ ...errorInicial, campo: errorInicial.campo }));
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
  const opcionesRepuesto = (repuestos || []).map((r) => ({
    value: String(r.id),
    label: r.codigo ? `${r.codigo} · ${r.nombre}` : r.nombre,
  }));

  const cambiar = (cambios: Partial<BorradorTarea>, limpiar: CampoTarea[]) => {
    setB((actual) => ({ ...actual, ...cambios }));
    setErrores((actual) => {
      const nuevos = { ...actual };
      for (const campo of limpiar) delete nuevos[campo];
      return nuevos;
    });
  };

  const cambiarFila = (i: number, cambios: Partial<FilaPrevisto>, campo: 'repuesto' | 'cantidad') => {
    setB((actual) => ({ ...actual, repuestos: actual.repuestos.map((f, j) => (j === i ? { ...f, ...cambios } : f)) }));
    setErrores((actual) => sinErrorDeFila(actual, i, campo));
  };

  const elegirRepuesto = (i: number, valor: string | null) => {
    const elegido = repuestos?.find((r) => String(r.id) === valor);
    cambiarFila(i, { repuestoId: valor, nombre: elegido?.nombre, unidad: elegido?.unidad }, 'repuesto');
  };

  const agregarFila = () =>
    setB((actual) => ({ ...actual, repuestos: [...actual.repuestos, { repuestoId: null, cantidad: '' }] }));

  const quitarFila = (i: number) => {
    setB((actual) => ({ ...actual, repuestos: actual.repuestos.filter((_, j) => j !== i) }));
    // Las filas se corren: los errores por posición ya no valen
    setErrores(({ filas: _filas, ...resto }) => resto);
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
      const indiceRepuesto = err instanceof ApiError ? err.datos?.indice_repuesto : undefined;
      const enCampo =
        err instanceof ApiError
          ? errorTareaDeApi(err.codigo, err.message, typeof indiceRepuesto === 'number' ? indiceRepuesto : undefined)
          : null;
      if (enCampo) {
        setErrores(erroresDeApi(enCampo));
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

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Repuestos previstos
          </Text>
          {b.repuestos.map((f, i) => {
            const enOpciones = opcionesRepuesto.some((o) => o.value === f.repuestoId);
            // Un repuesto que se desactivó después sigue en la fila, con su nombre
            const data = f.repuestoId && f.nombre && !enOpciones ? [{ value: f.repuestoId, label: f.nombre }, ...opcionesRepuesto] : opcionesRepuesto;
            return (
              <Group key={i} gap="xs" align="flex-start" wrap="nowrap">
                <Select
                  aria-label={`Repuesto ${i + 1}`}
                  placeholder="Buscá el repuesto"
                  searchable
                  clearable
                  data={data}
                  value={f.repuestoId}
                  onChange={(v) => elegirRepuesto(i, v)}
                  error={errores.filas?.[i]?.repuesto}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <CampoNumero
                  aria-label={`Cantidad del repuesto ${i + 1}`}
                  placeholder="Cantidad"
                  decimalScale={3}
                  w={140}
                  rightSection={
                    f.unidad ? (
                      <Text size="xs" c="dimmed" pr="xs">
                        {f.unidad}
                      </Text>
                    ) : undefined
                  }
                  rightSectionWidth={f.unidad ? 70 : undefined}
                  value={f.cantidad}
                  onChange={(v) => cambiarFila(i, { cantidad: v }, 'cantidad')}
                  error={errores.filas?.[i]?.cantidad}
                />
                <ActionIcon variant="subtle" color="gray" size={36} aria-label={`Quitar el repuesto ${i + 1}`} onClick={() => quitarFila(i)}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            );
          })}
          {(errores.repuesto || errores.cantidad) && (
            <Text size="xs" c="red">
              {errores.repuesto ?? errores.cantidad}
            </Text>
          )}
          {b.repuestos.length < MAXIMO_PREVISTOS && (
            <Button size="xs" variant="subtle" color="marca" leftSection={<IconPlus size={14} />} onClick={agregarFila} style={{ alignSelf: 'flex-start' }}>
              Agregar repuesto
            </Button>
          )}
        </Stack>

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
