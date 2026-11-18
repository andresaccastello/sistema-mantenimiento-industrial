import { useState } from 'react';
import { Card, SegmentedControl, Stack, Switch, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import type { PreferenciasUsuario, TemaUsuario } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { mensajeError } from '../../lib/errores';
import { AYUDA_MODO_SIMPLE, OPCIONES_TEMA } from '../../lib/preferencias';

/**
 * D1, 4 y 5: "Preferencias" de Mi cuenta. Cada cambio se guarda al momento y se aplica sin
 * recargar.
 */
export function PreferenciasCuenta() {
  const { usuario, actualizarPreferencias } = useAuth();
  const [guardando, setGuardando] = useState(false);
  const preferencias = usuario?.preferencias ?? { modo_simple_celular: true, tema: 'CLARO' as TemaUsuario };

  const guardar = async (cambio: Partial<PreferenciasUsuario>) => {
    setGuardando(true);
    try {
      const r = await clienteApi.patch<PreferenciasUsuario>('/api/auth/preferencias', cambio);
      actualizarPreferencias(r);
      notifications.show({ message: 'Preferencia guardada', color: 'green', autoClose: 2000 });
    } catch (err) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Card withBorder radius="sm" padding="xl" maw={600} mt="md">
      <Stack gap="lg">
        <Title order={4}>Preferencias</Title>

        <Stack gap={4}>
          <Switch
            label="Modo simple en el celular"
            checked={preferencias.modo_simple_celular}
            disabled={guardando}
            onChange={(e) => guardar({ modo_simple_celular: e.currentTarget.checked })}
          />
          <Text size="xs" c="dimmed">
            {AYUDA_MODO_SIMPLE}
          </Text>
        </Stack>

        <Stack gap={6}>
          <Text size="sm" fw={500}>
            Tema
          </Text>
          <SegmentedControl
            data={OPCIONES_TEMA}
            value={preferencias.tema}
            disabled={guardando}
            onChange={(v) => guardar({ tema: v as TemaUsuario })}
            fullWidth
          />
        </Stack>
      </Stack>
    </Card>
  );
}
