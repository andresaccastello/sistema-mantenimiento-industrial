import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import type { MedidorDetalle, MedidorLista } from '../../api/tipos';
import { mensajeError } from '../../lib/errores';
import { mostrarDesvio, propuestaDeclarado, textoRitmo, textoUsoDeclarado, textoValorEstimado } from '../../lib/estimacion';
import { refrescarMedidores } from './refrescar';

interface Props {
  medidor: MedidorLista;
  /** Con PLANES_GESTIONAR: ofrece actualizar el declarado. */
  gestiona: boolean;
}

/**
 * HE1, 6: el ritmo de uso del medidor, el valor estimado de hoy y, con un desvío de más del
 * 25 %, el aviso y "Actualizar declarado".
 */
export function RitmoMedidor({ medidor: m, gestiona }: Props) {
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const conDesvio = m.ritmo !== null && m.ritmo.fuente === 'LECTURAS' && mostrarDesvio(m.ritmo.desvio_pct);
  const propuesta = m.ritmo ? propuestaDeclarado(m.ritmo.por_dia, m.uso_estimado?.periodo ?? null) : null;

  const actualizar = async () => {
    if (!propuesta) return;
    setGuardando(true);
    try {
      await clienteApi.patch<MedidorDetalle>(`/api/medidores/${m.id}`, { uso_estimado: propuesta });
      await refrescarMedidores(queryClient);
      notifications.show({ message: 'Uso declarado actualizado.', color: 'green' });
      setConfirmando(false);
    } catch (err) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Stack gap={2}>
      <Text size="xs" c="var(--sm-texto-medio)">
        {textoRitmo(m.ritmo, m.uso_estimado, m.unidad)}
      </Text>
      {m.valor_estimado_hoy !== null && (
        <Text size="xs" c="dimmed">
          {textoValorEstimado(m.valor_estimado_hoy, m.unidad)}
        </Text>
      )}
      {conDesvio && (
        <Group gap="xs" wrap="wrap" mt={2}>
          <Badge color="orange" variant="light" size="sm" styles={{ root: { textTransform: 'none' } }}>
            El uso real difiere del declarado
          </Badge>
          {gestiona && m.activo && (
            <Button size="compact-xs" variant="subtle" color="marca" onClick={() => setConfirmando(true)}>
              Actualizar declarado
            </Button>
          )}
        </Group>
      )}

      <Modal opened={confirmando} onClose={() => !guardando && setConfirmando(false)} title="Actualizar uso declarado" centered>
        {propuesta && (
          <Stack gap="md">
            <Text size="sm">
              El uso declarado de {m.nombre} pasa a {textoUsoDeclarado(propuesta, m.unidad)}, según las lecturas
              {m.uso_estimado ? ` (hoy: ${textoUsoDeclarado(m.uso_estimado, m.unidad)})` : ''}.
            </Text>
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={() => setConfirmando(false)} disabled={guardando}>
                Volver
              </Button>
              <Button color="marca" onClick={actualizar} loading={guardando}>
                Actualizar
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
