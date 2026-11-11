import { useEffect, useState } from 'react';
import { Modal, Stack, Text, Textarea, Group, Button, Alert, Checkbox } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import type { TareaIntervencion } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import { avisoSalto, ultimaDeError, validarLectura } from '../../lib/medidores';
import {
  CuerpoConfirmar,
  ERRORES_DE_LECTURA,
  FilaConfirmar,
  avisoDisponible,
  campoLecturaConfirmar,
  cuerpoConfirmar,
  filasConfirmar,
  textoBotonConfirmar,
  validarConfirmar,
} from '../../lib/preventivos';
import { CampoNumero } from '../CampoNumero';

interface Props {
  /** La tarea con previstos o con uso que se marca, o null con el diálogo cerrado. */
  tarea: TareaIntervencion | null;
  finalizada: boolean;
  /** Manda el PATCH; si lanza, el error se muestra en el diálogo. */
  onConfirmar: (cuerpo: CuerpoConfirmar) => Promise<void>;
  onCerrar: () => void;
}

/** Estos errores son de un repuesto: van a su fila, por el `previsto_id` que manda la API. */
const ERRORES_DE_FILA = ['STOCK_INSUFICIENTE', 'REPUESTO_INACTIVO'];

/**
 * 5.2 Marcar una tarea como hecha: qué repuestos previstos se usaron (PV2.2) y, con una
 * tarea por uso, la lectura del medidor (PV4, 6).
 */
export function ModalConfirmarTarea({ tarea, finalizada, onConfirmar, onCerrar }: Props) {
  const abierto = tarea !== null;
  const [filas, setFilas] = useState<FilaConfirmar[]>([]);
  const [observacion, setObservacion] = useState('');
  const [motivo, setMotivo] = useState('');
  const [lectura, setLectura] = useState<number | string>('');
  const [errores, setErrores] = useState<Record<number, string>>({});
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [errorLectura, setErrorLectura] = useState<string | null>(null);
  /** El aviso de salto ya mostrado: el próximo clic guarda igual. */
  const [avisoLectura, setAvisoLectura] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!tarea) return;
    setFilas(filasConfirmar(tarea.repuestos_previstos));
    setObservacion(tarea.observacion ?? '');
    setMotivo('');
    setLectura(tarea.uso ? campoLecturaConfirmar(tarea.uso, finalizada).inicial : '');
    setErrores({});
    setErrorMotivo(null);
    setErrorLectura(null);
    setAvisoLectura(null);
    setError(null);
    // Solo al abrir: la tarea cambia de identidad cuando se refresca la lista
  }, [tarea?.id, abierto]);

  if (!tarea) return null;
  const uso = tarea.uso;
  const campo = uso ? campoLecturaConfirmar(uso, finalizada) : null;
  const unidad = uso?.medidor.unidad ?? '';
  const ultima = uso?.medidor.ultima_lectura?.valor ?? null;

  /** El error de la lectura, de la API, en el campo. */
  const errorDeLectura = (err: ApiError): string => {
    if (err.codigo === 'LECTURA_REQUERIDA') return 'Ingresá la lectura.';
    if (err.codigo === 'MEDIDOR_INACTIVO') return 'El medidor está inactivo: no se pueden cargar lecturas.';
    const ultimaApi = ultimaDeError(err.datos);
    const modo = err.codigo === 'LECTURA_MAYOR' ? 'PASADA' : 'NUEVA';
    return (ultimaApi !== null && validarLectura(lectura, ultimaApi, modo, unidad)) || mensajeError(err);
  };

  const cambiarFila = (previstoId: number, cambios: Partial<FilaConfirmar>) => {
    setFilas((actual) => actual.map((f) => (f.previstoId === previstoId ? { ...f, ...cambios } : f)));
    setErrores((actual) => {
      const nuevos = { ...actual };
      delete nuevos[previstoId];
      return nuevos;
    });
  };

  const confirmar = async () => {
    const encontrados = validarConfirmar(filas);
    const motivoCorto = finalizada && motivo.trim().length < 5;
    const enLectura = campo ? validarLectura(lectura, ultima, campo.modo, unidad) : null;
    setErrores(encontrados);
    setErrorMotivo(motivoCorto ? 'Indicá el motivo (al menos 5 caracteres).' : null);
    setErrorLectura(enLectura);
    setError(null);
    if (Object.keys(encontrados).length > 0 || motivoCorto || enLectura) return;
    // Una lectura que sube a más del doble: el primer clic solo avisa, como al cargarla
    const salto = campo?.modo === 'NUEVA' ? avisoSalto(lectura, ultima, unidad) : null;
    if (salto && !avisoLectura) {
      setAvisoLectura(salto);
      return;
    }

    setGuardando(true);
    try {
      await onConfirmar(cuerpoConfirmar(filas, observacion, finalizada ? motivo : '', campo ? lectura : undefined));
    } catch (err) {
      const previstoId = err instanceof ApiError ? err.datos?.previsto_id : undefined;
      if (err instanceof ApiError && ERRORES_DE_FILA.includes(err.codigo) && typeof previstoId === 'number') {
        setErrores({ [previstoId]: mensajeError(err) });
      } else if (err instanceof ApiError && campo && ERRORES_DE_LECTURA.includes(err.codigo)) {
        setErrorLectura(errorDeLectura(err));
        setAvisoLectura(null);
      } else {
        setError(mensajeError(err));
      }
    } finally {
      setGuardando(false);
    }
  };

  const usados = filas.filter((f) => f.usado).length;

  return (
    <Modal opened={abierto} onClose={() => !guardando && onCerrar()} title="Marcar como hecha" size="lg">
      <Stack gap="md">
        <Text size="sm" fw={500}>
          {tarea.accion}
        </Text>

        {campo && (
          <CampoNumero
            label={campo.etiqueta}
            required
            description={campo.descripcion ?? undefined}
            decimalScale={2}
            rightSection={
              <Text size="xs" c="dimmed" pr="xs">
                {unidad}
              </Text>
            }
            rightSectionWidth={70}
            value={lectura}
            onChange={(v) => {
              setLectura(v);
              setErrorLectura(null);
              setAvisoLectura(null);
            }}
            error={errorLectura}
          />
        )}
        {avisoLectura && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
            {avisoLectura}
          </Alert>
        )}

        {filas.length > 0 && (
          <Stack gap="sm">
            <Text size="sm" fw={500}>
              ¿Qué repuestos usaste?
            </Text>
            {filas.map((f) => {
              const aviso = avisoDisponible(f);
              const errorFila = errores[f.previstoId];
              const texto = errorFila ?? aviso?.texto;
              return (
                <Stack key={f.previstoId} gap={2}>
                  <Group gap="xs" wrap="nowrap" align="center">
                    <Checkbox
                      checked={f.usado}
                      onChange={(e) => cambiarFila(f.previstoId, { usado: e.currentTarget.checked })}
                      label={f.nombre}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <CampoNumero
                      aria-label={`Cantidad de ${f.nombre}`}
                      decimalScale={3}
                      w={140}
                      disabled={!f.usado}
                      rightSection={
                        <Text size="xs" c="dimmed" pr="xs">
                          {f.unidad}
                        </Text>
                      }
                      rightSectionWidth={70}
                      value={f.cantidad}
                      onChange={(v) => cambiarFila(f.previstoId, { cantidad: v })}
                    />
                  </Group>
                  {texto && (
                    <Text size="xs" pl={32} c={errorFila || aviso?.alcanza === false ? 'red' : 'dimmed'}>
                      {texto}
                    </Text>
                  )}
                </Stack>
              );
            })}
          </Stack>
        )}

        <Textarea
          label="Observación"
          placeholder="Opcional"
          autosize
          minRows={2}
          maxLength={500}
          value={observacion}
          onChange={(e) => setObservacion(e.currentTarget.value)}
        />

        {finalizada && (
          <>
            <Textarea
              label="Motivo"
              maxLength={500}
              required
              autosize
              minRows={2}
              value={motivo}
              onChange={(e) => {
                setMotivo(e.currentTarget.value);
                setErrorMotivo(null);
              }}
              error={errorMotivo}
            />
            <Alert color="yellow" variant="light" icon={<IconInfoCircle size={16} />}>
              La próxima fecha del plan se va a recalcular.
            </Alert>
          </>
        )}

        {error && (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button color="marca" onClick={confirmar} loading={guardando}>
            {avisoLectura ? 'Guardar igual' : filas.length > 0 ? textoBotonConfirmar(usados) : 'Marcar como hecha'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
