import { useState } from 'react';
import { Card, Stack, Switch, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import type { ConfiguracionAvisos } from '../../api/tipos';
import { mensajeError } from '../../lib/errores';
import { AYUDA_PARADAS_CRITICAS, ETIQUETA_DETENCION_POSTERIOR } from '../../lib/avisos';

interface Props {
  criticoPorDetencionPosterior: boolean;
  onActualizado: () => void;
}

/** AV1, 5: la tarjeta "Paradas críticas" del bloque de avisos. */
export function TarjetaParadasCriticas({ criticoPorDetencionPosterior, onActualizado }: Props) {
  const [guardando, setGuardando] = useState(false);

  const cambiar = async (valor: boolean) => {
    setGuardando(true);
    try {
      await clienteApi.put<ConfiguracionAvisos>('/api/configuracion/avisos', { critico_por_detencion_posterior: valor });
      notifications.show({ message: 'Configuración guardada', color: 'green', autoClose: 2000 });
      onActualizado();
    } catch (err) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Card withBorder radius="sm" padding="lg" bg="var(--sm-superficie)">
      <Stack gap="sm">
        <Title order={4} c="var(--sm-titulo)">
          Paradas críticas
        </Title>
        <Switch
          label={ETIQUETA_DETENCION_POSTERIOR}
          checked={criticoPorDetencionPosterior}
          disabled={guardando}
          onChange={(e) => cambiar(e.currentTarget.checked)}
        />
        <Text size="sm" c="var(--sm-tenue)">
          {AYUDA_PARADAS_CRITICAS}
        </Text>
      </Stack>
    </Card>
  );
}
