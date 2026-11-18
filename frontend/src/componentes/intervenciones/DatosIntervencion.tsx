import { Link } from 'react-router';
import { Card, Group, Stack, Text } from '@mantine/core';
import type { IntervencionDetalle } from '../../api/tipos';
import { etiquetaMaquina } from '../../lib/maquinas';
import { formatFechaHora } from '../../lib/formato';
import { nombreCompleto, textoAutor } from '../../lib/personas';
import { EstadoBadge } from '../EstadoBadge';

/** La columna lateral del detalle: los datos de la intervención y su máquina. */
export function DatosIntervencion({ reporte }: { reporte: IntervencionDetalle }) {
  const esPreventivo = reporte.tipo === 'PREVENTIVO';
  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="xs">
        <Text fw={700} size="sm" tt="uppercase" c="var(--sm-tenue)">Datos</Text>
        <Group justify="space-between" align="flex-start">
          <Text size="sm" c="dimmed">Máquina</Text>
          <Text
            component={Link}
            to={`/maquinas/${reporte.maquina.id}`}
            size="sm"
            fw={600}
            c="blue"
            ta="right"
            style={{ textDecoration: 'none' }}
          >
            {etiquetaMaquina(reporte.maquina)}
          </Text>
        </Group>
        <Group justify="space-between" align="flex-start">
          <Text size="sm" c="dimmed">Sector</Text>
          <Text size="sm">{reporte.maquina.sector.nombre}</Text>
        </Group>
        <Group justify="space-between" align="flex-start">
          <Text size="sm" c="dimmed">Estado de la máquina</Text>
          <EstadoBadge entidad="maquina" estado={reporte.maquina.estado} />
        </Group>
        <Group justify="space-between" align="flex-start">
          <Text size="sm" c="dimmed">{esPreventivo ? 'Generada por' : 'Reportada por'}</Text>
          <Text size="sm">{textoAutor(reporte.creado_por)}</Text>
        </Group>
        <Group justify="space-between" align="flex-start">
          <Text size="sm" c="dimmed">{esPreventivo ? 'Generada' : 'Reportada'}</Text>
          <Text size="sm">{formatFechaHora(reporte.fecha_creacion)}</Text>
        </Group>
        <Group justify="space-between" align="flex-start">
          <Text size="sm" c="dimmed">Responsable</Text>
          <Text size="sm">{reporte.responsable ? nombreCompleto(reporte.responsable) : 'Sin asignar'}</Text>
        </Group>
        <Group justify="space-between" align="flex-start">
          <Text size="sm" c="dimmed">Inicio del trabajo</Text>
          <Text size="sm">{reporte.fecha_inicio ? formatFechaHora(reporte.fecha_inicio) : '—'}</Text>
        </Group>
        {reporte.fecha_finalizacion && (
          <Group justify="space-between" align="flex-start">
            <Text size="sm" c="dimmed">Finalización</Text>
            <Text size="sm">{formatFechaHora(reporte.fecha_finalizacion)}</Text>
          </Group>
        )}
      </Stack>
    </Card>
  );
}
