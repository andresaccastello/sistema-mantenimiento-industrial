import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Stack, Group, Text, Checkbox, Anchor, Collapse, Loader, Divider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import type { IntervencionTareasRespuesta, TareaIntervencion, TareaIntervencionMarcada } from '../../api/tipos';
import { mensajeError } from '../../lib/errores';
import { formatFechaHora } from '../../lib/formato';
import { nombreCompleto } from '../../lib/personas';
import { textoEstadoPrevisto, textoProgramada, textoUnPrevisto, textoValorAlHacer } from '../../lib/preventivos';
import { CambioTarea, ModalCambioTarea } from './ModalCambioTarea';
import { ModalConfirmarTarea } from './ModalConfirmarTarea';

interface Props {
  intervencionId: number;
  estadoIntervencion: string;
}

interface CuerpoPatch {
  hecha: boolean;
  observacion?: string | null;
  motivo?: string;
  repuestos?: Array<{ id: number; cantidad: number }>;
  lectura?: number;
}

/** "Previsto: Aceite ISO 68 × 2,5 litro · Filtro × 1 unidad". */
function textoPrevisto(t: TareaIntervencion): string {
  return `Previsto: ${t.repuestos_previstos.map((p) => textoUnPrevisto(p.repuesto, p.cantidad_prevista)).join(' · ')}`;
}

/** R3: las tareas del plan de una intervención preventiva (PV2, 5.3). */
export function BloqueTareasIntervencion({ intervencionId, estadoIntervencion }: Props) {
  const queryClient = useQueryClient();
  const finalizada = estadoIntervencion === 'FINALIZADA';
  const [abiertas, setAbiertas] = useState<number[]>([]);
  const [enDialogo, setEnDialogo] = useState<{ tarea: TareaIntervencion; cambio: CambioTarea } | null>(null);
  const [confirmando, setConfirmando] = useState<TareaIntervencion | null>(null);
  const [marcando, setMarcando] = useState<number | null>(null);
  /** La tarea con previstos que se quiso tildar en PENDIENTE. */
  const [avisoPendiente, setAvisoPendiente] = useState<number | null>(null);

  const { data, isLoading } = useQuery<IntervencionTareasRespuesta>({
    queryKey: ['intervencion', intervencionId, 'tareas'],
    queryFn: () => clienteApi.get<IntervencionTareasRespuesta>(`/api/intervenciones/${intervencionId}/tareas`),
  });

  const refrescar = async () => {
    // ['medidores']: marcar una tarea por uso puede registrar una lectura
    for (const clave of [['intervencion', intervencionId], ['repuestos'], ['medidores'], ['planes'], ['plan'], ['vencimientos'], ['tablero']]) {
      await queryClient.invalidateQueries({ queryKey: clave });
    }
  };

  const patch = async (tareaId: number, cuerpo: CuerpoPatch) => {
    await clienteApi.patch<TareaIntervencionMarcada>(`/api/intervenciones/${intervencionId}/tareas/${tareaId}`, cuerpo);
    await refrescar();
  };

  const marcar = async (t: TareaIntervencion, hecha: boolean) => {
    setAvisoPendiente(null);
    if (hecha && t.repuestos_previstos.length > 0) {
      if (estadoIntervencion === 'PENDIENTE') setAvisoPendiente(t.id);
      else setConfirmando(t);
      return;
    }
    // Solo con uso: el diálogo pide la lectura, en cualquier estado (PV4, 6)
    if (hecha && t.uso) {
      setConfirmando(t);
      return;
    }
    const anulaRepuestos = !hecha && t.repuestos_previstos.some((p) => p.estado === 'USADO');
    if (finalizada || anulaRepuestos) {
      setEnDialogo({ tarea: t, cambio: { tipo: 'hecha', hecha } });
      return;
    }
    setMarcando(t.id);
    try {
      await patch(t.id, { hecha });
    } catch (err) {
      notifications.show({ color: 'red', message: mensajeError(err) });
    } finally {
      setMarcando(null);
    }
  };

  const alternarDetalle = (id: number) =>
    setAbiertas((actual) => (actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id]));

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Text fw={700} size="sm" tt="uppercase" c="#64748b">
            Tareas del plan
          </Text>
          {data && (
            <Text size="sm" c="dimmed">
              {data.resumen.hechas} de {data.resumen.total} hechas
            </Text>
          )}
        </Group>

        {isLoading || !data ? (
          <Loader size="sm" color="marca" />
        ) : (
          data.tareas.map((t, i) => {
            const programada = textoProgramada(t.fecha_programada, t.uso);
            const valorAlHacer = t.hecha ? textoValorAlHacer(t.uso) : null;
            return (
              <Stack key={t.id} gap={4}>
                {i > 0 && <Divider />}
                <Group gap="xs" wrap="wrap">
                  <Checkbox
                    checked={t.hecha}
                    disabled={!data.puede_marcar || marcando === t.id}
                    onChange={(e) => marcar(t, e.currentTarget.checked)}
                    label={
                      <Text size="sm" fw={500}>
                        {t.accion}
                      </Text>
                    }
                  />
                  {avisoPendiente === t.id && (
                    <Text size="xs" c="orange.8">
                      Iniciá el trabajo para confirmar los repuestos.
                    </Text>
                  )}
                </Group>
                <Stack gap={2} pl={32}>
                  {programada && (
                    <Text size="xs" c="dimmed">
                      {programada}
                    </Text>
                  )}
                  {valorAlHacer && (
                    <Text size="xs" c="dimmed">
                      {valorAlHacer}
                    </Text>
                  )}
                  {!t.hecha && t.repuestos_previstos.length > 0 && (
                    <Text size="xs" c="dimmed">
                      {textoPrevisto(t)}
                    </Text>
                  )}
                  {t.hecha &&
                    t.repuestos_previstos.map((p) => (
                      <Text key={p.id} size="xs">
                        <Text span inherit c="dimmed">
                          {p.repuesto.nombre} ·{' '}
                        </Text>
                        <Text span inherit c={p.estado === 'USADO' ? 'green.8' : 'dimmed'}>
                          {textoEstadoPrevisto(p)}
                        </Text>
                      </Text>
                    ))}
                  {t.proveedor && (
                    <Text size="xs" c="dimmed">
                      Sugerido: {t.proveedor.nombre}
                    </Text>
                  )}
                  {t.hecha && t.hecha_por && (
                    <Text size="xs" c="dimmed">
                      Hecha por {nombreCompleto(t.hecha_por)} el {formatFechaHora(t.hecha_en)}
                    </Text>
                  )}
                  {t.detalle && (
                    <>
                      <Anchor component="button" type="button" size="xs" onClick={() => alternarDetalle(t.id)} ta="left">
                        {abiertas.includes(t.id) ? 'Ocultar detalle' : 'Ver detalle'}
                      </Anchor>
                      <Collapse expanded={abiertas.includes(t.id)}>
                        <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
                          {t.detalle}
                        </Text>
                      </Collapse>
                    </>
                  )}
                  {t.observacion && (
                    <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                      {t.observacion}
                    </Text>
                  )}
                  {data.puede_marcar && (
                    <Anchor
                      component="button"
                      type="button"
                      size="xs"
                      ta="left"
                      onClick={() => setEnDialogo({ tarea: t, cambio: { tipo: 'observacion' } })}
                    >
                      {t.observacion ? 'Editar observación' : 'Agregar observación'}
                    </Anchor>
                  )}
                </Stack>
              </Stack>
            );
          })
        )}
      </Stack>

      <ModalCambioTarea
        tarea={enDialogo?.tarea ?? null}
        cambio={enDialogo?.cambio ?? null}
        finalizada={finalizada}
        onConfirmar={async (cuerpo) => {
          if (!enDialogo) return;
          await patch(enDialogo.tarea.id, cuerpo);
          notifications.show({ color: 'green', message: 'Tarea guardada.' });
          setEnDialogo(null);
        }}
        onCerrar={() => setEnDialogo(null)}
      />

      <ModalConfirmarTarea
        tarea={confirmando}
        finalizada={finalizada}
        onConfirmar={async (cuerpo) => {
          if (!confirmando) return;
          await patch(confirmando.id, cuerpo);
          notifications.show({ color: 'green', message: 'Tarea guardada.' });
          setConfirmando(null);
        }}
        onCerrar={() => setConfirmando(null)}
      />
    </Card>
  );
}
