import { ActionIcon, Badge, Button, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconCircleCheck, IconNote } from '@tabler/icons-react';
import type { RutinaHoy } from '../../api/tipos';
import { puedeDeshacer, rotuloFrecuencia, textoHecha } from '../../lib/rutinas';

interface Props {
  rutina: RutinaHoy;
  hoy: string;
  usuarioId: number | null | undefined;
  ocupada: boolean;
  onHecha: () => void;
  onConNota: () => void;
  onDeshacer: () => void;
}

/** RT1, 4: una tarea de hoy, con "Hecha" de un toque, "Con nota" y, si la marcó uno, "Deshacer". */
export function TarjetaRutinaHoy({ rutina, hoy, usuarioId, ocupada, onHecha, onConNota, onDeshacer }: Props) {
  const registro = rutina.registro;
  return (
    <Group
      justify="space-between"
      align="center"
      gap="sm"
      wrap="wrap"
      py="xs"
      style={{ borderTop: '1px solid var(--sm-separador)' }}
    >
      <Stack gap={4} style={{ flex: '1 1 180px', minWidth: 0 }}>
        <Group gap="xs" wrap="wrap">
          {/* El tilde dentro del texto, en la misma línea que la descripción aunque sea larga */}
          <Text fw={500} c="var(--sm-titulo)" style={{ overflowWrap: 'anywhere' }}>
            {registro && (
              <IconCircleCheck
                size={18}
                color="var(--sm-exito)"
                aria-label="Hecha"
                style={{ verticalAlign: '-3px', marginRight: 6 }}
              />
            )}
            {rutina.descripcion}
          </Text>
          <Badge variant="light" color="gray" size="sm">
            {rotuloFrecuencia(rutina.frecuencia)}
          </Badge>
        </Group>
        {registro && (
          <>
            <Text size="sm" c="var(--sm-tenue)">
              {textoHecha(registro, hoy)}
            </Text>
            {registro.nota && (
              <Text size="sm" c="var(--sm-texto-medio)" style={{ overflowWrap: 'anywhere' }}>
                {registro.nota}
              </Text>
            )}
          </>
        )}
      </Stack>

      {registro === null ? (
        <Group gap="xs" wrap="nowrap">
          <Button leftSection={<IconCheck size={18} />} onClick={onHecha} loading={ocupada} mih={44} miw={110}>
            Hecha
          </Button>
          <Tooltip label="Con nota">
            <ActionIcon
              variant="default"
              size={44}
              onClick={onConNota}
              disabled={ocupada}
              aria-label="Con nota"
            >
              <IconNote size={20} />
            </ActionIcon>
          </Tooltip>
        </Group>
      ) : (
        puedeDeshacer(registro, usuarioId) && (
          <Button variant="subtle" color="gray" onClick={onDeshacer} loading={ocupada} mih={44}>
            Deshacer
          </Button>
        )
      )}
    </Group>
  );
}
