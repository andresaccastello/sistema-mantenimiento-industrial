import { Link } from 'react-router';
import { Badge, Group, Table, Text } from '@mantine/core';
import type { IntervencionLista } from '../../api/tipos';
import { tiempoLista } from '../../lib/intervenciones';
import { etiquetaMaquina } from '../../lib/maquinas';
import { nombreCompleto } from '../../lib/personas';
import { formatFechaHora, formatHace } from '../../lib/formato';
import { EstadoBadge } from '../EstadoBadge';

interface Props {
  items: IntervencionLista[];
  /** Adónde vuelve el detalle: la lista con sus filtros. */
  volverA: string;
  onFilaClick: (id: number) => void;
}

/** 5.3: la tabla de la lista de intervenciones. */
export function TablaIntervenciones({ items, volverA, onFilaClick }: Props) {
  return (
    <Table.ScrollContainer minWidth={900}>
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 80 }}>N.º</Table.Th>
            <Table.Th>Máquina</Table.Th>
            <Table.Th style={{ minWidth: 180 }}>Estado</Table.Th>
            <Table.Th style={{ minWidth: 160 }}>Responsable</Table.Th>
            <Table.Th style={{ minWidth: 130 }}>Reportada</Table.Th>
            <Table.Th style={{ minWidth: 210, whiteSpace: 'nowrap' }}>Tiempo</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((item) => {
            const t = tiempoLista(item);
            return (
              <Table.Tr
                key={item.id}
                onClick={() => onFilaClick(item.id)}
                style={{ cursor: 'pointer' }}
              >
                <Table.Td onClick={(e) => e.stopPropagation()}>
                  <Link
                    to={`/intervenciones/${item.id}`}
                    state={{ volverA }}
                    style={{
                      textDecoration: 'none',
                      color: 'inherit',
                      fontWeight: 600,
                    }}
                  >
                    #{item.id}
                  </Link>
                </Table.Td>

                <Table.Td>
                  <Text fw={600} size="sm">
                    {etiquetaMaquina(item.maquina)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {item.maquina.sector.nombre}
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    {item.tipo === 'PREVENTIVO' && (
                      <Badge color="teal" variant="light" size="xs" style={{ flexShrink: 0 }}>
                        Preventivo
                      </Badge>
                    )}
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {item.descripcion}
                    </Text>
                  </Group>
                </Table.Td>

                <Table.Td>
                  <Group gap="xs" align="center" wrap="wrap">
                    <EstadoBadge entidad="intervencion" estado={item.estado} />
                    {item.detiene_maquina_actualmente && (
                      <Badge color="red" variant="filled" size="sm">
                        Máquina detenida
                      </Badge>
                    )}
                  </Group>
                </Table.Td>

                <Table.Td>
                  {item.responsable ? (
                    <Text size="sm">{nombreCompleto(item.responsable)}</Text>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Sin asignar
                    </Text>
                  )}
                </Table.Td>

                <Table.Td>
                  <Text size="sm" title={formatFechaHora(item.fecha_creacion)}>
                    {formatHace(item.fecha_creacion)}
                  </Text>
                </Table.Td>

                <Table.Td style={{ minWidth: 210, whiteSpace: 'nowrap' }}>
                  <Group gap={6} align="center" wrap="nowrap">
                    <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
                      {t.etiqueta ? `${t.etiqueta} ${t.texto}` : t.texto}
                    </Text>
                    {t.enCurso && (
                      <Badge color="yellow" variant="light" size="xs">
                        en curso
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
