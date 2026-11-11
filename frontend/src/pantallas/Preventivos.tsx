import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Stack, Group, Title, Tabs, Button } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { FiltrosPreventivos, escribirFiltrosPreventivos, leerFiltrosPreventivos } from '../lib/preventivos';
import { TabVencimientos } from '../componentes/preventivos/TabVencimientos';
import { TabPlanes } from '../componentes/preventivos/TabPlanes';

/** P1 — Preventivos: Vencimientos y Planes, con la pestaña y los filtros en la dirección. */
export function Preventivos() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filtros = useMemo(() => leerFiltrosPreventivos(searchParams), [searchParams]);

  const cambiar = (parcial: Partial<FiltrosPreventivos>) =>
    setSearchParams(escribirFiltrosPreventivos({ ...filtros, ...parcial }));

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={2} c="#0f172a">
          Preventivos
        </Title>
        <Button color="marca" leftSection={<IconPlus size={18} />} onClick={() => navigate('/preventivos/planes/nuevo')}>
          Nuevo plan
        </Button>
      </Group>

      <Tabs
        value={filtros.vista}
        onChange={(v) => cambiar({ vista: v === 'planes' ? 'planes' : 'vencimientos', pagina: 1 })}
      >
        <Tabs.List mb="md">
          <Tabs.Tab value="vencimientos">Vencimientos</Tabs.Tab>
          <Tabs.Tab value="planes">Planes</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="vencimientos">
          {filtros.vista === 'vencimientos' && <TabVencimientos filtros={filtros} onCambiarFiltros={cambiar} />}
        </Tabs.Panel>
        <Tabs.Panel value="planes">
          {filtros.vista === 'planes' && <TabPlanes filtros={filtros} onCambiarFiltros={cambiar} />}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
