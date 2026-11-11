import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Stack, TextInput, Textarea, Group, Select, Button, Alert, Text, ActionIcon, SegmentedControl } from '@mantine/core';
import { DatePickerInput, DateStringValue } from '@mantine/dates';
import { IconAlertCircle, IconPlus, IconTrash } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { FrecuenciaUnidad, MedidorLista, ProveedorOpcion, RepuestoOpcion, UsoTareaPlan } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import { leerValorMedidor } from '../../lib/medidores';
import {
  BorradorTarea,
  CampoTarea,
  CriterioTarea,
  ErroresTarea,
  FilaPrevisto,
  MAXIMO_PREVISTOS,
  UNIDADES_FRECUENCIA,
  conFecha,
  conUso,
  descripcionAnticipacionUso,
  descripcionPrimeraUso,
  errorTareaDeApi,
  erroresDeApi,
  hayErrores,
  primeraUsoSugerida,
  sinErrorDeFila,
  validarTareaBorrador,
} from '../../lib/preventivos';
import { CampoNumero } from '../CampoNumero';

/** La unidad del medidor, a la derecha de un número. */
function unidadALaDerecha(unidad: string) {
  if (!unidad) return undefined;
  return (
    <Text size="xs" c="dimmed" pr="xs">
      {unidad}
    </Text>
  );
}

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
  /** La máquina del plan: sus medidores activos son los que se ofrecen. */
  maquinaId: number | null;
  /** Al editar una tarea que ya se hizo: cambia la ayuda de la primera fecha. */
  yaSeHizo?: boolean;
  /**
   * Al editar, el uso de la tarea: su medidor se muestra aunque esté inactivo, y si ya se
   * hizo, la ayuda de la primera vez lo dice.
   */
  usoTarea?: UsoTareaPlan | null;
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
export function ModalTareaPlan({
  abierto,
  titulo,
  inicial,
  maquinaId,
  yaSeHizo,
  usoTarea,
  errorInicial,
  onGuardar,
  onCerrar,
}: Props) {
  const [b, setB] = useState<BorradorTarea>(inicial);
  const [errores, setErrores] = useState<ErroresTarea>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  /** "Primera vez a los" escrita a mano: ya no se llena sola. */
  const [primeraTocada, setPrimeraTocada] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setB(inicial);
    setPrimeraTocada(String(inicial.usoPrimera).trim() !== '');
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

  // Los medidores activos de la máquina
  const { data: medidores } = useQuery<MedidorLista[]>({
    queryKey: ['medidores', 'maquina', maquinaId, { maquina_id: maquinaId }],
    queryFn: () => clienteApi.get<MedidorLista[]>('/api/medidores', { params: { maquina_id: maquinaId ?? 0 } }),
    enabled: abierto && maquinaId !== null,
  });
  const activos = medidores ?? [];
  // El medidor de la tarea que se edita, si ya no está activo, sigue en la lista
  const medidorTarea = usoTarea?.medidor ?? null;
  const tareaInactivo = medidorTarea !== null && !activos.some((m) => m.id === medidorTarea.id) ? medidorTarea : null;
  const opcionesMedidor = [
    ...activos.map((m) => ({ value: String(m.id), label: m.nombre })),
    ...(tareaInactivo ? [{ value: String(tareaInactivo.id), label: `${tareaInactivo.nombre} (inactivo)` }] : []),
  ];
  const elegido = activos.find((m) => String(m.id) === b.medidorId) ?? null;
  const esElDeLaTarea = medidorTarea !== null && String(medidorTarea.id) === b.medidorId;
  const unidad = elegido?.unidad ?? (esElDeLaTarea && medidorTarea ? medidorTarea.unidad : '');
  const ultimaLectura = elegido ? elegido.ultima_lectura : esElDeLaTarea && usoTarea ? usoTarea.lectura_actual : null;
  const sinMedidores = medidores !== undefined && activos.length === 0 && !usoTarea;

  // Con un solo medidor activo, viene elegido
  useEffect(() => {
    if (abierto && conUso(b.criterio) && b.medidorId === null && activos.length === 1) {
      setB((actual) => ({ ...actual, medidorId: String(activos[0].id) }));
    }
  }, [abierto, b.criterio, b.medidorId, medidores]);

  // "Primera vez a los", mientras no se toque: la última lectura más "Cada"
  const cadaValido = leerValorMedidor(b.usoCada);
  const sugerida = b.medidorId !== null && cadaValido !== null && cadaValido > 0 ? primeraUsoSugerida(ultimaLectura?.valor ?? null, cadaValido) : null;
  useEffect(() => {
    if (!abierto || primeraTocada || sugerida === null) return;
    setB((actual) => (actual.usoPrimera === sugerida ? actual : { ...actual, usoPrimera: sugerida }));
  }, [abierto, primeraTocada, sugerida]);

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

        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Vence por
          </Text>
          <SegmentedControl
            aria-label="Vence por"
            fullWidth
            color="marca"
            data={[
              { value: 'FECHA', label: 'Fecha' },
              { value: 'USO', label: 'Uso', disabled: sinMedidores },
              { value: 'AMBOS', label: 'Las dos', disabled: sinMedidores },
            ]}
            value={b.criterio}
            // Los campos del otro criterio se esconden, pero quedan en el borrador
            onChange={(v) => cambiar({ criterio: v as CriterioTarea }, [])}
          />
          {sinMedidores && (
            <Text size="xs" c="dimmed">
              La máquina no tiene medidores: se cargan en su ficha.
            </Text>
          )}
        </Stack>

        {conFecha(b.criterio) && (
          <>
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
          </>
        )}

        {conUso(b.criterio) && (
          <>
            <Select
              label="Medidor"
              required
              placeholder="Elegí el medidor"
              data={opcionesMedidor}
              allowDeselect={false}
              value={b.medidorId}
              onChange={(v) => cambiar({ medidorId: v }, ['medidor'])}
              error={errores.medidor}
            />
            <CampoNumero
              label="Cada"
              required
              decimalScale={2}
              rightSection={unidadALaDerecha(unidad)}
              rightSectionWidth={unidad ? 70 : undefined}
              value={b.usoCada}
              onChange={(v) => cambiar({ usoCada: v }, ['usoCada', 'usoAnticipacion'])}
              error={errores.usoCada}
            />
            <CampoNumero
              label="Primera vez a los"
              required
              description={
                b.medidorId !== null
                  ? descripcionPrimeraUso(ultimaLectura, esElDeLaTarea && usoTarea ? usoTarea.ultimo : null, unidad)
                  : undefined
              }
              decimalScale={2}
              rightSection={unidadALaDerecha(unidad)}
              rightSectionWidth={unidad ? 70 : undefined}
              value={b.usoPrimera}
              onChange={(v) => {
                setPrimeraTocada(true);
                cambiar({ usoPrimera: v }, ['usoPrimera']);
              }}
              error={errores.usoPrimera}
            />
            <CampoNumero
              label="Avisar antes"
              placeholder="Opcional"
              description={descripcionAnticipacionUso(unidad)}
              decimalScale={2}
              rightSection={unidadALaDerecha(unidad)}
              rightSectionWidth={unidad ? 70 : undefined}
              value={b.usoAnticipacion}
              onChange={(v) => cambiar({ usoAnticipacion: v }, ['usoAnticipacion'])}
              error={errores.usoAnticipacion}
            />
          </>
        )}

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
