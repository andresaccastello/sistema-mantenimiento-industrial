import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Stack, Group, Text, Checkbox, Anchor, Collapse, Loader, Divider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import type { IntervencionTareasRespuesta, TareaIntervencion, TareaIntervencionMarcada } from '../../api/tipos';
import { mensajeError } from '../../lib/errores';
import { formatCantidad, formatFechaHora } from '../../lib/formato';
import { nombreCompleto } from '../../lib/personas';
import { formatFechaDia } from '../../lib/preventivos';
import { CambioTarea, ModalCambioTarea } from './ModalCambioTarea';

interface Props {
  intervencionId: number;
  estadoIntervencion: string;
}

/** "Sugerido: Aceite ISO 68 × 2,5 litro · Proveedor X", o null sin nada sugerido. */
function textoSugerido(t: TareaIntervencion): string | null {
  const partes: string[] = [];
  if (t.repuesto) partes.push(`${t.repuesto.nombre} × ${formatCantidad(t.cantidad)} ${t.repuesto.unidad}`);
  if (t.proveedor) partes.push(t.proveedor.nombre);
  return partes.length > 0 ? `Sugerido: ${partes.join(' · ')}` : null;
}

/** R3: las tareas del plan de una intervención preventiva (PV2, 5.3). */
export function BloqueTareasIntervencion({ intervencionId, estadoIntervencion }: Props) {
  const queryClient = useQueryClient();
  const finalizada = estadoIntervencion === 'FINALIZADA';
  const [abiertas, setAbiertas] = useState<number[]>([]);
  const [enDialogo, setEnDialogo] = useState<{ tarea: TareaIntervencion; cambio: CambioTarea } | null>(null);
  const [marcando, setMarcando] = useState<number | null>(null);

  const { data, isLoading } = useQuery<IntervencionTareasRespuesta>({
    queryKey: ['intervencion', intervencionId, 'tareas'],
    queryFn: () => clienteApi.get<IntervencionTareasRespuesta>(`/api/intervenciones/${intervencionId}/tareas`),
  });

  const refrescar = async () => {
    for (const clave of [['intervencion', intervencionId], ['planes'], ['plan'], ['vencimientos'], ['tablero']]) {
      await queryClient.invalidateQueries({ queryKey: clave });
    }
  };

  const patch = async (tareaId: number, cuerpo: { hecha: boolean; observacion?: string | null; motivo?: string }) => {
    await clienteApi.patch<TareaIntervencionMarcada>(`/api/intervenciones/${intervencionId}/tareas/${tareaId}`, cuerpo);
    await refrescar();
  };

  const marcar = async (t: TareaIntervencion, hecha: boolean) => {
    if (finalizada) {
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
            const sugerido = textoSugerido(t);
            return (
              <Stack key={t.id} gap={4}>
                {i > 0 && <Divider />}
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
                <Stack gap={2} pl={32}>
                  <Text size="xs" c="dimmed">
                    Programada para {formatFechaDia(t.fecha_programada)}
                  </Text>
                  {sugerido && (
                    <Text size="xs" c="dimmed">
                      {sugerido}
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
    </Card>
  );
}
