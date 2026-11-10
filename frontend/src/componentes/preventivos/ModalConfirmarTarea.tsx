import { useEffect, useState } from 'react';
import { Modal, Stack, Text, Textarea, Group, Button, Alert, Checkbox } from '@mantine/core';
import { IconAlertCircle, IconInfoCircle } from '@tabler/icons-react';
import type { TareaIntervencion } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import {
  CuerpoConfirmar,
  FilaConfirmar,
  avisoDisponible,
  cuerpoConfirmar,
  filasConfirmar,
  textoBotonConfirmar,
  validarConfirmar,
} from '../../lib/preventivos';
import { CampoNumero } from '../CampoNumero';

interface Props {
  /** La tarea con previstos que se marca, o null con el diálogo cerrado. */
  tarea: TareaIntervencion | null;
  finalizada: boolean;
  /** Manda el PATCH; si lanza, el error se muestra en el diálogo. */
  onConfirmar: (cuerpo: CuerpoConfirmar) => Promise<void>;
  onCerrar: () => void;
}

/** Estos errores son de un repuesto: van a su fila, por el `previsto_id` que manda la API. */
const ERRORES_DE_FILA = ['STOCK_INSUFICIENTE', 'REPUESTO_INACTIVO'];

/** 5.2 Confirmar qué repuestos previstos se usaron al marcar una tarea como hecha. */
export function ModalConfirmarTarea({ tarea, finalizada, onConfirmar, onCerrar }: Props) {
  const abierto = tarea !== null;
  const [filas, setFilas] = useState<FilaConfirmar[]>([]);
  const [observacion, setObservacion] = useState('');
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Record<number, string>>({});
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!tarea) return;
    setFilas(filasConfirmar(tarea.repuestos_previstos));
    setObservacion(tarea.observacion ?? '');
    setMotivo('');
    setErrores({});
    setErrorMotivo(null);
    setError(null);
    // Solo al abrir: la tarea cambia de identidad cuando se refresca la lista
  }, [tarea?.id, abierto]);

  if (!tarea) return null;

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
    setErrores(encontrados);
    setErrorMotivo(motivoCorto ? 'Indicá el motivo (al menos 5 caracteres).' : null);
    setError(null);
    if (Object.keys(encontrados).length > 0 || motivoCorto) return;

    setGuardando(true);
    try {
      await onConfirmar(cuerpoConfirmar(filas, observacion, finalizada ? motivo : ''));
    } catch (err) {
      const previstoId = err instanceof ApiError ? err.datos?.previsto_id : undefined;
      if (err instanceof ApiError && ERRORES_DE_FILA.includes(err.codigo) && typeof previstoId === 'number') {
        setErrores({ [previstoId]: mensajeError(err) });
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
            {textoBotonConfirmar(usados)}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
