import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Stack, Title, Tabs } from '@mantine/core';
import {
  FiltrosRepuestos,
  VistaRepuestos,
  leerFiltrosRepuestos,
  escribirFiltrosRepuestos,
} from '../lib/repuestos';
import { TabRepuestos } from '../componentes/repuestos/TabRepuestos';
import { TabPedidos } from '../componentes/repuestos/TabPedidos';
import { TabProveedores } from '../componentes/repuestos/TabProveedores';

export function Repuestos() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Filtros desde la URL
  const filtros = useMemo(() => leerFiltrosRepuestos(searchParams), [searchParams]);

  const handleCambiarFiltros = (parcial: Partial<FiltrosRepuestos>) => {
    const nuevos: FiltrosRepuestos = {
      ...filtros,
      ...parcial,
    };
    setSearchParams(escribirFiltrosRepuestos(nuevos));
  };

  const handleCambiarVista = (val: string | null) => {
    const vista: VistaRepuestos =
      val === 'pedidos' || val === 'proveedores' ? val : 'repuestos';
    handleCambiarFiltros({ vista });
  };

  return (
    <Stack gap="lg">
      <Title order={2}>Repuestos</Title>

      <Tabs value={filtros.vista} onChange={handleCambiarVista}>
        <Tabs.List mb="md">
          <Tabs.Tab value="repuestos">Repuestos</Tabs.Tab>
          <Tabs.Tab value="pedidos">Pedidos</Tabs.Tab>
          <Tabs.Tab value="proveedores">Proveedores</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="repuestos">
          <TabRepuestos filtros={filtros} onCambiarFiltros={handleCambiarFiltros} />
        </Tabs.Panel>

        <Tabs.Panel value="pedidos">
          <TabPedidos filtros={filtros} onCambiarFiltros={handleCambiarFiltros} />
        </Tabs.Panel>

        <Tabs.Panel value="proveedores">
          <TabProveedores filtros={filtros} onCambiarFiltros={handleCambiarFiltros} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
