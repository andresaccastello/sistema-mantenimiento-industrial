import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Paper, Stack, Group, Title, Button, Divider, Table, Text, Badge, Skeleton, Menu, ActionIcon, Tooltip } from '@mantine/core';
import { IconPlus, IconDotsVertical, IconList, IconEdit, IconBan, IconRotateClockwise, IconGauge } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { MedidorLista } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { fechaDeMomento, textoValorMedidor } from '../../lib/medidores';
import { nombreCompleto } from '../../lib/personas';
import { ModalActivoMedidor } from './ModalActivoMedidor';
import { ModalLectura } from './ModalLectura';
import { ModalLecturasMedidor } from './ModalLecturasMedidor';
import { ModalMedidor } from './ModalMedidor';

interface Props {
  maquinaId: number;
  maquinaActiva: boolean;
}

/** El diálogo de alta o edición: null cerrado, 'nuevo' para uno nuevo. */
type EnEdicion = null | 'nuevo' | MedidorLista;

/** PV4, 3: los medidores de la máquina, con PLANES_GESTIONAR o MAQUINAS_REGISTRAR_LECTURAS. */
export function BloqueMedidoresMaquina({ maquinaId, maquinaActiva }: Props) {
  const { tienePermiso } = useAuth();
  const gestiona = tienePermiso('PLANES_GESTIONAR');
  const cargaLecturas = tienePermiso('MAQUINAS_REGISTRAR_LECTURAS');
  const puede = gestiona || cargaLecturas;

  const [enEdicion, setEnEdicion] = useState<EnEdicion>(null);
  const [cambiandoActivo, setCambiandoActivo] = useState<MedidorLista | null>(null);
  const [cargando, setCargando] = useState<MedidorLista | null>(null);
  const [viendo, setViendo] = useState<MedidorLista | null>(null);

  // Con PLANES_GESTIONAR, también los inactivos
  const params: Record<string, string | number> = { maquina_id: maquinaId };
  if (gestiona) params.all = 'true';
  const { data: medidores, isPending } = useQuery<MedidorLista[]>({
    queryKey: ['medidores', 'maquina', maquinaId, params],
    queryFn: () => clienteApi.get<MedidorLista[]>('/api/medidores', { params }),
    enabled: puede,
  });

  if (!puede) return null;
  const lista = medidores ?? [];

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Title order={4}>Medidores</Title>
          {gestiona && (
            <Button size="xs" variant="light" color="marca" leftSection={<IconPlus size={14} />} onClick={() => setEnEdicion('nuevo')}>
              Nuevo medidor
            </Button>
          )}
        </Group>
        <Divider />

        {isPending ? (
          <Skeleton height={36} />
        ) : lista.length === 0 ? (
          <Text size="sm" c="dimmed">
            Esta máquina no tiene medidores.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ minWidth: 150 }}>Medidor</Table.Th>
                  <Table.Th style={{ minWidth: 80 }}>Unidad</Table.Th>
                  <Table.Th style={{ minWidth: 190 }}>Última lectura</Table.Th>
                  <Table.Th style={{ minWidth: 90 }}>Tareas</Table.Th>
                  <Table.Th style={{ minWidth: 170 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lista.map((m) => (
                  <Table.Tr key={m.id}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Text size="sm" fw={600}>
                          {m.nombre}
                        </Text>
                        {!m.activo && (
                          <Badge color="gray" variant="outline" size="sm" style={{ flexShrink: 0 }}>
                            Inactivo
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{m.unidad}</Text>
                    </Table.Td>
                    <Table.Td>
                      {m.ultima_lectura ? (
                        <>
                          <Text size="sm">{textoValorMedidor(m.ultima_lectura.valor, m.unidad)}</Text>
                          <Text size="xs" c="dimmed">
                            el {fechaDeMomento(m.ultima_lectura.registrada_en)} por {nombreCompleto(m.ultima_lectura.registrada_por)}
                          </Text>
                        </>
                      ) : (
                        <Text size="sm" c="dimmed">
                          Sin lecturas
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {m.tareas_activas} {m.tareas_activas === 1 ? 'tarea' : 'tareas'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end" wrap="nowrap">
                        {cargaLecturas && m.activo && (
                          <Tooltip label="La máquina está inactiva." disabled={maquinaActiva}>
                            {/* data-disabled y no disabled: un botón deshabilitado no muestra el tooltip */}
                            <Button
                              size="xs"
                              variant="light"
                              color="marca"
                              leftSection={<IconGauge size={14} />}
                              data-disabled={maquinaActiva ? undefined : true}
                              aria-disabled={!maquinaActiva}
                              onClick={(e) => (maquinaActiva ? setCargando(m) : e.preventDefault())}
                            >
                              Cargar lectura
                            </Button>
                          </Tooltip>
                        )}
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" aria-label={`Acciones de ${m.nombre}`}>
                              <IconDotsVertical size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item leftSection={<IconList size={14} />} onClick={() => setViendo(m)}>
                              Ver lecturas
                            </Menu.Item>
                            {gestiona && (
                              <>
                                <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setEnEdicion(m)}>
                                  Editar
                                </Menu.Item>
                                <Menu.Item
                                  leftSection={m.activo ? <IconBan size={14} /> : <IconRotateClockwise size={14} />}
                                  onClick={() => setCambiandoActivo(m)}
                                >
                                  {m.activo ? 'Desactivar' : 'Reactivar'}
                                </Menu.Item>
                              </>
                            )}
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>

      <ModalMedidor
        abierto={enEdicion !== null}
        maquinaId={maquinaId}
        medidor={enEdicion === 'nuevo' ? null : enEdicion}
        onCerrar={() => setEnEdicion(null)}
      />
      <ModalActivoMedidor medidor={cambiandoActivo} onCerrar={() => setCambiandoActivo(null)} />
      <ModalLectura medidor={cargando} onCerrar={() => setCargando(null)} />
      <ModalLecturasMedidor medidor={viendo} onCerrar={() => setViendo(null)} />
    </Paper>
  );
}
