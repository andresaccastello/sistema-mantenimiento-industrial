import { Link } from 'react-router';
import { Table, Text, Menu, ActionIcon, Stack } from '@mantine/core';
import { IconDotsVertical, IconEdit, IconBan, IconRotateClockwise, IconExternalLink } from '@tabler/icons-react';
import type { TareaPlan } from '../../api/tipos';
import { formatFechaDia, textoFrecuencia, textoVencimiento } from '../../lib/preventivos';
import { EstadoBadge } from '../EstadoBadge';
import { TextoPrevistos } from './TextoPrevistos';

interface Props {
  tareas: TareaPlan[];
  onEditar: (tarea: TareaPlan) => void;
  onCambiarActivo: (tarea: TareaPlan) => void;
}

/** P2: las tareas del plan, en su orden. */
export function TablaTareasPlan({ tareas, onEditar, onCambiarActivo }: Props) {
  return (
    <Table.ScrollContainer minWidth={900}>
      <Table verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ minWidth: 130 }}>Estado</Table.Th>
            <Table.Th style={{ minWidth: 200 }}>Tarea</Table.Th>
            <Table.Th style={{ minWidth: 120 }}>Frecuencia</Table.Th>
            <Table.Th style={{ minWidth: 110 }}>Última vez</Table.Th>
            <Table.Th style={{ minWidth: 120 }}>Próxima</Table.Th>
            <Table.Th style={{ minWidth: 150 }}>Sugerido</Table.Th>
            <Table.Th style={{ width: 48 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {tareas.map((t) => (
            <Table.Tr key={t.id}>
              <Table.Td>
                <EstadoBadge entidad="tarea_preventiva" estado={t.estado} />
              </Table.Td>
              <Table.Td style={{ maxWidth: 280 }}>
                <Text size="sm" fw={500}>
                  {t.accion}
                </Text>
                {t.detalle && (
                  <Text size="xs" c="dimmed" lineClamp={2}>
                    {t.detalle}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <Text size="sm">{textoFrecuencia(t.frecuencia_valor, t.frecuencia_unidad)}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{t.ultima_ejecucion ? formatFechaDia(t.ultima_ejecucion) : 'Nunca'}</Text>
              </Table.Td>
              <Table.Td>
                {t.activo ? (
                  <>
                    <Text size="sm">{formatFechaDia(t.proxima_fecha)}</Text>
                    <Text size="xs" c="dimmed">
                      {textoVencimiento(t.dias)}
                    </Text>
                  </>
                ) : (
                  <Text size="sm">—</Text>
                )}
              </Table.Td>
              <Table.Td>
                <Stack gap={0}>
                  <TextoPrevistos repuestos={t.repuestos} />
                  {t.proveedor && (
                    <Text size="xs" c="dimmed">
                      {t.proveedor.nombre}
                    </Text>
                  )}
                  {t.repuestos.length === 0 && !t.proveedor && (
                    <Text size="sm" c="dimmed">
                      —
                    </Text>
                  )}
                </Stack>
              </Table.Td>
              <Table.Td>
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" aria-label={`Acciones de ${t.accion}`}>
                      <IconDotsVertical size={16} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => onEditar(t)}>
                      Editar
                    </Menu.Item>
                    <Menu.Item
                      leftSection={t.activo ? <IconBan size={14} /> : <IconRotateClockwise size={14} />}
                      onClick={() => onCambiarActivo(t)}
                    >
                      {t.activo ? 'Desactivar' : 'Reactivar'}
                    </Menu.Item>
                    {t.intervencion_en_curso && (
                      <Menu.Item
                        leftSection={<IconExternalLink size={14} />}
                        component={Link}
                        to={`/intervenciones/${t.intervencion_en_curso.id}`}
                      >
                        Ver intervención N.º {t.intervencion_en_curso.id}
                      </Menu.Item>
                    )}
                  </Menu.Dropdown>
                </Menu>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
