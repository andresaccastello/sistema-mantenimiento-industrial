import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Stack, Group, Title, Tabs, Button } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import {
  FiltrosPreventivos,
  escribirFiltrosPreventivos,
  leerFiltrosPreventivos,
  VistaPreventivos,
} from '../lib/preventivos';
import { escribirParamsCalendario, hoyLocal, leerParamsCalendario } from '../lib/calendario';
import { TabVencimientos } from '../componentes/preventivos/TabVencimientos';
import { TabPlanes } from '../componentes/preventivos/TabPlanes';
import { TabCalendario } from '../componentes/calendario/TabCalendario';

/** P1 — Preventivos: Vencimientos, Planes y Calendario, con la pestaña y los filtros en la dirección. */
export function Preventivos() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filtros = useMemo(() => leerFiltrosPreventivos(searchParams), [searchParams]);

  /** Cambia los filtros. En el calendario conserva su período (cal y fecha), como el resto. */
  const cambiar = (parcial: Partial<FiltrosPreventivos>) => {
    const nuevos = { ...filtros, ...parcial };
    const params = escribirFiltrosPreventivos(nuevos);
    const enCalendario = nuevos.vista === 'calendario' && filtros.vista === 'calendario';
    setSearchParams(enCalendario ? escribirParamsCalendario(params, leerParamsCalendario(searchParams, hoyLocal())) : params);
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={2} c="var(--sm-titulo)">
          Preventivos
        </Title>
        <Group gap="xs" wrap="wrap">
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
