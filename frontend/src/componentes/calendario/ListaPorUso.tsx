import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Paper, Stack, Table, Text, Title } from '@mantine/core';
import type { TareaPorUso } from '../../api/tipos';
import { etiquetaMaquina } from '../../lib/maquinas';
import { textoProximoUso } from '../../lib/preventivos';
import { EstadoBadge } from '../EstadoBadge';

/** Cuántas se ven antes de "Ver todas" (3.5). */
const VISIBLES = 5;

/** CAL1, 3.5: las tareas que vencen solo por uso, que no tienen fecha (D-028, 4). */
export function ListaPorUso({ tareas }: { tareas: TareaPorUso[] }) {
  const [todas, setTodas] = useState(false);
  if (tareas.length === 0) return null;
  const visibles = todas ? tareas : tareas.slice(0, VISIBLES);

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <div>
          <Title order={4} c="#0f172a">
            Vencen por uso
          </Title>
          <Text size="xs" c="dimmed">
            No tienen fecha: tocan según las lecturas del medidor.
          </Text>
        </div>
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="xs">
            <Table.Tbody>
              {visibles.map((t) => (
                <Table.Tr key={t.tarea_id}>
                  <Table.Td>
                    <Text size="sm">{etiquetaMaquina(t.maquina)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {t.accion}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <EstadoBadge entidad="tarea_preventiva" estado={t.estado} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {textoProximoUso(t.uso)}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Button component={Link} to={`/preventivos/planes/${t.plan.id}`} size="xs" variant="light" color="marca">
                      Ver plan
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {!todas && tareas.length > VISIBLES && (
          <Button variant="subtle" color="marca" size="xs" onClick={() => setTodas(true)} style={{ alignSelf: 'flex-start' }}>
            Ver todas ({tareas.length})
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
