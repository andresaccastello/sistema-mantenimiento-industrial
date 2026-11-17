import { Link } from 'react-router';
import { Anchor, Badge, Button, Group, Menu, Stack, Text, Title } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import type { MaquinaLista } from '../../api/tipos';
import { etiquetaAccionMaquina, etiquetaMaquina, type CodigoAccionMaquina } from '../../lib/maquinas';
import { formatFechaHora, formatHace } from '../../lib/formato';
import { CriticidadBadge } from '../CriticidadBadge';
import { EstadoBadge } from '../EstadoBadge';

interface Props {
  maquina: MaquinaLista;
  volverA: string;
  ahora: Date;
  principal: CodigoAccionMaquina | null;
  botones: CodigoAccionMaquina[];
  menu: CodigoAccionMaquina[];
  onAccion: (codigo: CodigoAccionMaquina) => void;
}

/** 6.2: la cabecera del detalle, con la barra de acciones debajo del título. */
export function CabeceraMaquina({ maquina, volverA, ahora, principal, botones, menu, onAccion }: Props) {
  const tieneAcciones =
    principal !== null || botones.length > 0 || menu.length > 0;

  return (
    <Stack gap="xs">
      <Anchor
        component={Link}
        to={volverA}
        size="sm"
        c="dimmed"
        style={{ textDecoration: 'none' }}
      >
        ← Máquinas
      </Anchor>

      <Group gap="sm" align="center" wrap="wrap">
        <Title order={2}>{etiquetaMaquina(maquina)}</Title>
        <CriticidadBadge criticidad={maquina.criticidad} size="md" />
        <EstadoBadge entidad="maquina" estado={maquina.estado} size="md" />
        <Text size="sm" c="dimmed">
          desde {formatFechaHora(maquina.estado_desde)} ·{' '}
          {formatHace(maquina.estado_desde, ahora)}
        </Text>
        {!maquina.activo && (
          <Badge
            color="gray"
            variant="light"
            size="md"
            styles={{ root: { textTransform: 'none' } }}
          >
            Desactivada
          </Badge>
        )}
      </Group>

      {/* Barra de acciones siempre debajo del título */}
      {tieneAcciones && (
        <Group gap="xs" wrap="wrap" mt={4}>
          {principal && (
            <Button
              color={
                principal === 'CONFIRMAR_RECUPERACION' ? 'green' : 'marca'
              }
              onClick={() => onAccion(principal)}
            >
              {etiquetaAccionMaquina(principal)}
            </Button>
          )}

          {botones.map((cod) => (
            <Button
              key={cod}
              variant="default"
              onClick={() => onAccion(cod)}
            >
              {etiquetaAccionMaquina(cod)}
            </Button>
          ))}

          {menu.length > 0 && (
            <Menu position="bottom-start" withinPortal>
              <Menu.Target>
                <Button
                  variant="default"
                  rightSection={<IconChevronDown size={16} />}
                >
                  Más acciones
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {menu.map((cod) => (
                  <Menu.Item
                    key={cod}
                    color={cod === 'DESACTIVAR' ? 'red' : undefined}
                    onClick={() => onAccion(cod)}
                  >
                    {etiquetaAccionMaquina(cod)}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      )}
    </Stack>
  );
}
