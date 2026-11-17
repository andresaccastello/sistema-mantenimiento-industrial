import { Fragment } from 'react';
import { Group, Stack, Table, Text } from '@mantine/core';
import type { MedidorRonda } from '../../api/tipos';
import type { Consecuencia, ValoresRonda } from '../../lib/lecturas';
import { textoDiasSinLectura } from '../../lib/lecturas';
import { textoValorMedidor } from '../../lib/medidores';
import { CampoLectura, InsigniaAtrasado, LineaTarea, ResultadoGuardado } from './PiezasRonda';

export interface VistaRondaProps {
  medidores: MedidorRonda[];
  valores: ValoresRonda;
  onCambiarValor: (medidorId: number, valor: string | number) => void;
  /** El error de cada campo: el del valor escrito o el de la API. */
  errores: Record<number, string | null>;
  /** Lo que cambió en cada medidor guardado. */
  guardados: Record<number, Consecuencia[]>;
  /** Sin MAQUINAS_REGISTRAR_LECTURAS, sin campos (4.4). */
  puedeCargar: boolean;
  guardando: boolean;
}

/** Los medidores agrupados por máquina, en el orden en que vinieron. */
export function porMaquina(medidores: MedidorRonda[]): Array<{ maquina: MedidorRonda['maquina']; sector: string; medidores: MedidorRonda[] }> {
  const grupos: Array<{ maquina: MedidorRonda['maquina']; sector: string; medidores: MedidorRonda[] }> = [];
  for (const m of medidores) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.maquina.id === m.maquina.id) ultimo.medidores.push(m);
    else grupos.push({ maquina: m.maquina, sector: m.sector.nombre, medidores: [m] });
  }
  return grupos;
}

/** LE1, 4.1: la ronda en la computadora, una tabla agrupada por máquina. */
export function TablaRonda({ medidores, valores, onCambiarValor, errores, guardados, puedeCargar, guardando }: VistaRondaProps) {
  const columnas = puedeCargar ? 4 : 3;
  return (
    <Table.ScrollContainer minWidth={puedeCargar ? 860 : 640}>
      <Table verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: '22%' }}>Medidor</Table.Th>
            <Table.Th style={{ width: '20%' }}>Última lectura</Table.Th>
            <Table.Th>Tareas</Table.Th>
            {puedeCargar && <Table.Th style={{ width: 240 }}>Nueva lectura</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {porMaquina(medidores).map((g) => (
            <Fragment key={g.maquina.id}>
              <Table.Tr bg="var(--mantine-color-gray-0)">
                <Table.Td colSpan={columnas}>
                  <Text size="sm" fw={700}>
                    {g.maquina.codigo ? `${g.maquina.codigo} · ${g.maquina.nombre}` : g.maquina.nombre}
                    <Text span size="xs" c="dimmed" fw={400}>
                      {' '}
                      · {g.sector}
                    </Text>
                  </Text>
                </Table.Td>
              </Table.Tr>
              {g.medidores.map((m) => (
                <Table.Tr key={m.id}>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {m.nombre}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {m.unidad}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {m.ultima ? (
                      <Stack gap={2}>
                        <Group gap="xs" wrap="nowrap">
                          <Text size="sm">{textoValorMedidor(m.ultima.valor, m.unidad)}</Text>
                          {m.atrasado && <InsigniaAtrasado />}
                        </Group>
                        <Text size="xs" c="dimmed">
                          {textoDiasSinLectura(m.dias_sin_lectura)}
                        </Text>
                      </Stack>
                    ) : (
                      <Group gap="xs" wrap="nowrap">
                        <Text size="sm" c="dimmed">
                          Sin lecturas
                        </Text>
                        {m.atrasado && <InsigniaAtrasado />}
                      </Group>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {m.tareas.length === 0 ? (
                      <Text size="sm" c="dimmed">
                        Sin tareas que lo usen
                      </Text>
                    ) : (
                      <Stack gap={4}>
                        {m.tareas.map((t) => (
                          <LineaTarea key={t.tarea_id} tarea={t} unidad={m.unidad} />
                        ))}
                      </Stack>
                    )}
                  </Table.Td>
                  {puedeCargar && (
                    <Table.Td>
                      <Stack gap={4}>
                        <CampoLectura
                          medidor={m}
                          valor={valores[m.id] ?? undefined}
                          onCambiar={(v) => onCambiarValor(m.id, v)}
                          error={errores[m.id] ?? null}
                          deshabilitado={guardando}
                        />
                        {guardados[m.id] && <ResultadoGuardado consecuencias={guardados[m.id]} />}
                      </Stack>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Fragment>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
