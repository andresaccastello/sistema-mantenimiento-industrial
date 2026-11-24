import React from 'react';
import {
  AppShell,
  Burger,
  Group,
  Text,
  NavLink,
  Button,
  ActionIcon,
  Tooltip,
  Image,
  Stack,
  Box,
  Divider,
  UnstyledButton,
  Card,
  ThemeIcon,
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
  IconUser,
  IconQuestionMark,
  IconSettings,
  IconPackage,
  IconCalendarCheck,
  IconDeviceDesktop,
  IconGauge,
  IconChecklist,
} from '@tabler/icons-react';
import { useLocation, useNavigate, Outlet } from 'react-router';
import { ZonaPantalla } from './carga';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { clienteApi } from '../api/cliente';
import { itemsMenu } from '../lib/menu';
import { permitidaEnCelular } from '../lib/celular';
import { useModoSimple } from '../lib/useModoSimple';
import { confirmarSalida } from './salida';
import { esRutaInicio } from '../lib/inicio';
import { nombrePerfil } from '../lib/perfiles';
import { nombreCompleto } from '../lib/personas';
import { urlLogo } from '../lib/identidad';
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
  IconSettings,
  IconPackage,
  IconCalendarCheck,
  IconGauge,
  IconChecklist,
};

export function Layout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { usuario, salir } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const esObligatorio = Boolean(usuario?.debe_cambiar_password);
  // D1, 4: el menú y el aviso de la computadora dependen del modo simple, no del ancho
  const modoSimple = useModoSimple();

  const { data: config } = useQuery<ConfiguracionPublica>({
    queryKey: ['configuracion-publica'],
    queryFn: () => clienteApi.get<ConfiguracionPublica>('/api/configuracion/publica'),
    staleTime: 1000 * 60 * 10,
  });

  const nombreSistema = config?.nombre_sistema || 'Sistema de Mantenimiento Industrial';
  const nombreEmpresa = config?.nombre_empresa;
  const tieneLogo = config?.tiene_logo;

  const menu = itemsMenu(usuario?.permisos || {}, modoSimple);
  const bloquearEnCelular =
    modoSimple &&
    !esObligatorio &&
    location.pathname !== '/' &&
    !permitidaEnCelular(location.pathname, usuario?.permisos);

  // LE1, 4.2: con lecturas sin guardar, se confirma antes de salir de la pantalla
  const handleNavegar = (ruta: string) => {
    if (!confirmarSalida()) return;
    navigate(ruta);
    close();
  };

  const handleSalir = () => {
    if (confirmarSalida()) salir();
  };

  const perfilLegible = nombrePerfil(usuario?.perfil?.nombre) || 'Usuario';

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
          backgroundColor: 'var(--sm-fondo)',
          minHeight: 'calc(100vh - 56px)',
        },
      }}
    >
      <AppShell.Header
        style={{
          borderBottom: '1px solid var(--sm-borde-suave)',
          backgroundColor: 'var(--sm-superficie)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 1rem',
        }}
      >
        <Group justify="space-between" style={{ width: '100%', minWidth: 0 }} wrap="nowrap">
          {/* Lado izquierdo */}
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flexShrink: 1, overflow: 'hidden' }}>
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
                src={urlLogo(BASE_URL, config?.actualizado_en)}
                alt="Logo"
                h={32}
                w="auto"
                fit="contain"
                style={{ flexShrink: 0 }}
              />
            )}

            <Stack gap={0} justify="center" style={{ minWidth: 0, overflow: 'hidden' }}>
              <Text fw={600} size="sm" c="var(--sm-titulo)" lineClamp={1}>
                {nombreSistema}
              </Text>
              {nombreEmpresa && (
                <Text size="xs" c="var(--sm-tenue)" lineClamp={1}>
                  {nombreEmpresa}
                </Text>
              )}
            </Stack>
          </Group>

          {/* Lado derecho */}
          <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
            {!esObligatorio && <Campana />}

            {usuario && (
              <UnstyledButton
                visibleFrom="sm"
                onClick={() => handleNavegar('/mi-cuenta')}
                style={{
                  padding: '4px 8px',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Stack gap={0} align="flex-end">
                  <Text size="sm" fw={500} c="var(--sm-texto-fuerte)" lineClamp={1}>
                    {nombreCompleto(usuario)}
                  </Text>
                  <Text size="xs" c="var(--sm-tenue)" lineClamp={1}>
                    {perfilLegible}
                  </Text>
                </Stack>
              </UnstyledButton>
            )}

            {/* Salir en escritorio */}
            <Button
              visibleFrom="sm"
              variant="subtle"
              color="red"
              size="xs"
              onClick={handleSalir}
              leftSection={<IconLogout size={14} />}
            >
              Salir
            </Button>

            {/* Salir en celular como botón de ícono con aria-label y tooltip */}
            <Tooltip label="Salir" withArrow>
              <ActionIcon
                hiddenFrom="sm"
                variant="subtle"
                color="red"
                size="md"
                onClick={handleSalir}
                aria-label="Salir"
              >
                <IconLogout size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      {!esObligatorio && (
        <AppShell.Navbar
          p="xs"
          style={{
            borderRight: '1px solid var(--sm-borde-suave)',
            backgroundColor: 'var(--sm-superficie)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <Stack gap={2} style={{ flex: 1 }}>
            {menu.map((item) => {
              const Icono = ICONOS_MENU[item.icono] || IconQuestionMark;
              const activo =
                item.ruta === '/'
                  ? esRutaInicio(location.pathname, usuario?.permisos)
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

          {/* En celular: separados por una línea, se agregan Mi cuenta y Salir */}
          <Box hiddenFrom="sm">
            <Divider my="xs" />
            <NavLink
              label="Mi cuenta"
              leftSection={<IconUser size={18} />}
              active={location.pathname === '/mi-cuenta'}
              onClick={() => handleNavegar('/mi-cuenta')}
              style={{ borderRadius: 4 }}
            />
            <NavLink
              label="Salir"
              leftSection={<IconLogout size={18} />}
              color="red"
              c="red"
              onClick={() => {
                close();
                handleSalir();
              }}
              style={{ borderRadius: 4 }}
            />
          </Box>
        </AppShell.Navbar>
      )}

      <AppShell.Main>
        {bloquearEnCelular ? (
          <Card padding="xl" radius="sm" withBorder>
            <Stack align="center" gap="md" py="xl">
              <ThemeIcon size={56} radius="xl" color="marca" variant="light">
                <IconDeviceDesktop size={28} />
              </ThemeIcon>
              <Text size="lg" fw={600} c="var(--sm-texto-fuerte)" ta="center">
                Esta sección se usa desde la computadora
              </Text>
              <Text size="sm" c="var(--sm-tenue)" ta="center" maw={450}>
                En el celular podés reportar fallas y consultar el tablero y los reportes.
              </Text>
              {menu.length > 0 && (
                <Group justify="center" gap="sm" wrap="wrap" mt="xs">
                  {menu.map((item) => (
                    <Button
                      key={item.ruta}
                      variant="default"
                      onClick={() => handleNavegar(item.ruta)}
                    >
                      {item.etiqueta}
                    </Button>
                  ))}
                </Group>
              )}
            </Stack>
          </Card>
        ) : (
          <ZonaPantalla>
            <Outlet />
          </ZonaPantalla>
        )}
      </AppShell.Main>
    </AppShell>
  );
}
