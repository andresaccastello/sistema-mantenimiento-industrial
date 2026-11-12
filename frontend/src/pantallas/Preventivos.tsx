import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, Group, Title, Tabs, Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconRefresh } from '@tabler/icons-react';
import { clienteApi } from '../api/cliente';
import type { ProcesarVencimientosRespuesta } from '../api/tipos';
import { useAuth } from '../auth/AuthContext';
import { mensajeError } from '../lib/errores';
import {
  FiltrosPreventivos,
  escribirFiltrosPreventivos,
  leerFiltrosPreventivos,
  textoResultadoVencimientos,
  VistaPreventivos,
} from '../lib/preventivos';
import { escribirParamsCalendario, hoyLocal, leerParamsCalendario } from '../lib/calendario';
import { TabVencimientos } from '../componentes/preventivos/TabVencimientos';
import { TabPlanes } from '../componentes/preventivos/TabPlanes';
import { TabCalendario } from '../componentes/calendario/TabCalendario';

/** P1 — Preventivos: Vencimientos, Planes y Calendario, con la pestaña y los filtros en la dirección. */
export function Preventivos() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { tienePermiso } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const filtros = useMemo(() => leerFiltrosPreventivos(searchParams), [searchParams]);
  const [revisando, setRevisando] = useState(false);

  /** Cambia los filtros. En el calendario conserva su período (cal y fecha), como el resto. */
  const cambiar = (parcial: Partial<FiltrosPreventivos>) => {
    const nuevos = { ...filtros, ...parcial };
    const params = escribirFiltrosPreventivos(nuevos);
    const enCalendario = nuevos.vista === 'calendario' && filtros.vista === 'calendario';
    setSearchParams(enCalendario ? escribirParamsCalendario(params, leerParamsCalendario(searchParams, hoyLocal())) : params);
  };

  /** PV5, 5: la revisión diaria, pedida a mano. */
  const revisar = async () => {
    setRevisando(true);
    try {
      const r = await clienteApi.post<ProcesarVencimientosRespuesta>('/api/planes/procesar-vencimientos', {});
      for (const clave of [['vencimientos'], ['planes'], ['tablero']]) {
        await queryClient.invalidateQueries({ queryKey: clave });
      }
      const conErrores = r.revisado && r.errores.length > 0;
      notifications.show({ color: conErrores ? 'yellow' : 'green', message: textoResultadoVencimientos(r) });
    } catch (err) {
      notifications.show({ color: 'red', message: mensajeError(err) });
    } finally {
      setRevisando(false);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={2} c="#0f172a">
          Preventivos
        </Title>
        <Group gap="xs" wrap="wrap">
          {tienePermiso('PLANES_GESTIONAR') && (
            <Button variant="default" leftSection={<IconRefresh size={18} />} loading={revisando} onClick={revisar}>
              Revisar vencimientos ahora
            </Button>
          )}
          <Button color="marca" leftSection={<IconPlus size={18} />} onClick={() => navigate('/preventivos/planes/nuevo')}>
            Nuevo plan
          </Button>
        </Group>
      </Group>

      <Tabs
        value={filtros.vista}
        onChange={(v) => cambiar({ vista: (v ?? 'vencimientos') as VistaPreventivos, pagina: 1 })}
      >
        <Tabs.List mb="md">
          <Tabs.Tab value="vencimientos">Vencimientos</Tabs.Tab>
          <Tabs.Tab value="planes">Planes</Tabs.Tab>
          <Tabs.Tab value="calendario">Calendario</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="vencimientos">
          {filtros.vista === 'vencimientos' && <TabVencimientos filtros={filtros} onCambiarFiltros={cambiar} />}
        </Tabs.Panel>
        <Tabs.Panel value="planes">
          {filtros.vista === 'planes' && <TabPlanes filtros={filtros} onCambiarFiltros={cambiar} />}
        </Tabs.Panel>
        <Tabs.Panel value="calendario">
          {filtros.vista === 'calendario' && (
            <TabCalendario
              filtros={filtros}
              onCambiarFiltros={cambiar}
              params={searchParams}
              onCambiarParams={(p) => setSearchParams(p)}
            />
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
