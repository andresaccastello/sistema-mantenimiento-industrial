import React from 'react';
import {
  AppShell,
  Burger,
  Group,
  Text,
  NavLink,
  Button,
  Image,
  Stack,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconHome,
  IconAlertTriangle,
  IconTool,
  IconCpu,
  IconReportAnalytics,
  IconUsers,
  IconBuildingFactory2,
  IconLogout,
  IconQuestionMark,
} from '@tabler/icons-react';
import { useLocation, useNavigate, Outlet } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { clienteApi } from '../api/cliente';
import { itemsMenu } from '../lib/menu';
import { Campana } from '../componentes/Campana';
import type { ConfiguracionPublica } from '../api/tipos';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000';

const ICONOS_MENU: Record<string, React.ComponentType<{ size?: number }>> = {
  IconHome,
  IconAlertTriangle,
  IconTool,
  IconCpu,
  IconReportAnalytics,
  IconUsers,
  IconBuildingFactory2,
};

export function Layout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { usuario, salir } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const esObligatorio = Boolean(usuario?.debe_cambiar_password);

  const { data: config } = useQuery<ConfiguracionPublica>({
    queryKey: ['configuracion-publica'],
    queryFn: () => clienteApi.get<ConfiguracionPublica>('/api/configuracion/publica'),
    staleTime: 1000 * 60 * 10,
  });

  const nombreSistema = config?.nombre_sistema || 'Sistema de Mantenimiento Industrial';
  const nombreEmpresa = config?.nombre_empresa;
  const tieneLogo = config?.tiene_logo;

  const menu = itemsMenu(usuario?.permisos || {});

  const handleNavegar = (ruta: string) => {
    navigate(ruta);
    close();
  };

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={
        esObligatorio
          ? undefined
          : {
              width: 260,
              breakpoint: 'sm',
              collapsed: { mobile: !opened },
            }
      }
      padding="lg"
      styles={{
        main: {
          backgroundColor: '#f8fafc',
          minHeight: 'calc(100vh - 56px)',
        },
      }}
    >
      <AppShell.Header
        style={{
          borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
          backgroundColor: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          padding: '0 1rem',
        }}
      >
        <Group justify="space-between" style={{ width: '100%' }} wrap="nowrap">
          {/* Lado izquierdo */}
          <Group gap="sm" wrap="nowrap">
            {!esObligatorio && (
              <Burger
                opened={opened}
                onClick={toggle}
                hiddenFrom="sm"
                size="sm"
                aria-label="Abrir navegación"
              />
            )}

            {tieneLogo && (
              <Image
                src={`${BASE_URL}/api/configuracion/logo`}
                alt="Logo"
                h={32}
                w="auto"
                fit="contain"
              />
            )}

            <Stack gap={0} justify="center">
              <Text fw={600} size="sm" c="#0f172a" lineClamp={1}>
                {nombreSistema}
              </Text>
              {nombreEmpresa && (
                <Text size="xs" c="#64748b" lineClamp={1}>
                  {nombreEmpresa}
                </Text>
              )}
            </Stack>
          </Group>

          {/* Lado derecho */}
          <Group gap="sm" wrap="nowrap">
            {!esObligatorio && <Campana />}

            {usuario && (
              <UnstyledButton
                onClick={() => handleNavegar('/mi-cuenta')}
                style={{
                  padding: '4px 8px',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Stack gap={0} align="flex-end">
                  <Text size="sm" fw={500} c="#1e293b" lineClamp={1}>
                    {usuario.nombre} {usuario.apellido}
                  </Text>
                  <Text size="xs" c="#64748b" lineClamp={1}>
                    {usuario.perfil?.nombre || 'Usuario'}
                  </Text>
                </Stack>
              </UnstyledButton>
            )}

            <Button
              variant="subtle"
              color="red"
              size="xs"
              onClick={salir}
              leftSection={<IconLogout size={14} />}
            >
              Salir
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      {!esObligatorio && (
        <AppShell.Navbar
          p="xs"
          style={{
            borderRight: '1px solid rgba(0, 0, 0, 0.08)',
            backgroundColor: '#ffffff',
          }}
        >
          <Stack gap={2}>
            {menu.map((item) => {
              const Icono = ICONOS_MENU[item.icono] || IconQuestionMark;
              const activo =
                item.ruta === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(item.ruta);

              return (
                <NavLink
                  key={item.ruta}
                  label={item.etiqueta}
                  leftSection={<Icono size={18} />}
                  active={activo}
                  onClick={() => handleNavegar(item.ruta)}
                  style={{
                    borderRadius: 4,
                    fontWeight: activo ? 600 : 400,
                  }}
                  color="marca"
                />
              );
            })}
          </Stack>
        </AppShell.Navbar>
      )}

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
