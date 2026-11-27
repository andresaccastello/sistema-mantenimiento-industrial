import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Stack,
  SimpleGrid,
  Paper,
  Text,
  Title,
  Table,
  Group,
  Button,
  Select,
  Alert,
  Skeleton,
  Anchor,
} from '@mantine/core';
import { IconAlertCircle, IconDownload, IconReceipt } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { ReporteComprasRespuesta } from '../../api/tipos';
import { formatCantidad, formatMoneda } from '../../lib/formato';
import { aCsv, descargarCsv, nombreArchivoReporte } from '../../lib/reportes';
import {
  fechaCompra,
  filasCsvCompras,
  nombreProveedor,
  proveedorPrincipal,
  textoArticuloCompra,
  textoIngresosSinProveedor,
  textoOrigenCompra,
  textoSinCosto,
} from '../../lib/compras';

export interface TabReporteComprasProps {
  /** El período de la barra de filtros, en ISO. */
  desde: string;
  hasta: string;
}

const sinCorte = { whiteSpace: 'nowrap' as const };

function Tarjeta({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <Paper p="md" withBorder>
      <Stack gap={4}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          {titulo}
        </Text>
        <Text size="xl" fw={700} lineClamp={1}>
          {valor}
        </Text>
        {detalle && (
          <Text size="xs" c="dimmed">
            {detalle}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

/** PC1, 7: lo que se compró en el período (D-029). Sin planta ni sector: una compra para stock no es de ningún sector. */
export function TabReporteCompras({ desde, hasta }: TabReporteComprasProps) {
  const [proveedorId, setProveedorId] = useState<string | null>(null);

  // El período entero: da los totales sin filtro y la lista de proveedores para elegir
  const base = useQuery<ReporteComprasRespuesta>({
    queryKey: ['reportes', 'compras', { desde, hasta }],
    queryFn: () => clienteApi.get<ReporteComprasRespuesta>('/api/reportes/compras', { params: { desde, hasta } }),
  });
  const filtrada = useQuery<ReporteComprasRespuesta>({
    queryKey: ['reportes', 'compras', { desde, hasta, proveedor_id: proveedorId }],
    queryFn: () =>
      clienteApi.get<ReporteComprasRespuesta>('/api/reportes/compras', {
        params: { desde, hasta, proveedor_id: proveedorId },
      }),
    enabled: proveedorId !== null,
  });
  const consulta = proveedorId !== null ? filtrada : base;
  const datos = consulta.data;

  const opcionesProveedor = useMemo(
    () =>
      (base.data?.por_proveedor ?? [])
        .filter((g) => g.proveedor !== null)
        .map((g) => ({ value: String(g.proveedor!.id), label: g.proveedor!.nombre })),
    [base.data]
  );
  const csv = useMemo(() => filasCsvCompras(datos), [datos]);

  const filtroProveedor = (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
      <Select
        label="Proveedor"
        placeholder="Todos los proveedores"
        data={opcionesProveedor}
        value={proveedorId}
        onChange={setProveedorId}
        searchable
        clearable
      />
    </SimpleGrid>
  );

  if (consulta.isLoading) {
    return (
      <Stack gap="md" mt="md">
        {filtroProveedor}
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={84} radius="md" />
          ))}
        </SimpleGrid>
        <Skeleton height={220} radius="md" />
      </Stack>
    );
  }

  if (consulta.isError || !datos) {
    return (
      <Alert icon={<IconAlertCircle size={18} />} title="Error al cargar las compras" color="red" my="md">
        <Group justify="space-between" align="center">
          <Text size="sm">No se pudieron obtener las compras del período.</Text>
          <Button size="xs" variant="light" color="red" onClick={() => consulta.refetch()}>
            Reintentar
          </Button>
        </Group>
      </Alert>
    );
  }

  const principal = proveedorPrincipal(datos);
  const avisoSinCosto = textoSinCosto(datos.sin_costo);
  const lineaSinProveedor = textoIngresosSinProveedor(datos.ingresos_sin_proveedor);

  const handleDescargarCsv = () => {
    descargarCsv(nombreArchivoReporte('compras', datos.desde, datos.hasta), aCsv(csv.columnas, csv.filas));
  };

  return (
    <Stack gap="lg" mt="md">
      {filtroProveedor}

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        <Tarjeta titulo="Total comprado" valor={formatMoneda(datos.total)} />
        <Tarjeta titulo="Compras" valor={formatCantidad(datos.compras)} />
        <Tarjeta
          titulo="Proveedor con más importe"
          valor={principal ? principal.nombre : '—'}
          detalle={principal ? formatMoneda(principal.importe) : undefined}
        />
      </SimpleGrid>

      {avisoSinCosto && (
        <Alert color="yellow" variant="light" icon={<IconAlertCircle size={16} />}>
          {avisoSinCosto}
        </Alert>
      )}
      {lineaSinProveedor && (
        <Text size="xs" c="dimmed" mt={-8}>
          {lineaSinProveedor}
        </Text>
      )}

      {datos.compras === 0 ? (
        <Paper p="xl" withBorder style={{ textAlign: 'center' }}>
          <IconReceipt size={48} color="gray" style={{ marginBottom: 12, opacity: 0.5 }} />
          <Text size="md" c="dimmed">
            No hay compras en este período.
          </Text>
        </Paper>
      ) : (
        <>
          <Paper p="md" withBorder>
            <Stack gap="md">
              <Title order={4}>Por proveedor</Title>
              <Table.ScrollContainer minWidth={420}>
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Proveedor</Table.Th>
                      <Table.Th style={sinCorte}>Compras</Table.Th>
                      <Table.Th style={sinCorte}>Importe</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {datos.por_proveedor.map((g) => (
                      <Table.Tr key={g.proveedor?.id ?? 'sin'}>
                        <Table.Td>
                          <Text size="sm" fw={500} c={g.proveedor ? undefined : 'dimmed'}>
                            {nombreProveedor(g.proveedor)}
                          </Text>
                        </Table.Td>
                        <Table.Td style={sinCorte}>
                          <Text size="sm">{formatCantidad(g.compras)}</Text>
                        </Table.Td>
                        <Table.Td style={sinCorte}>
                          <Text size="sm" fw={700}>
                            {formatMoneda(g.importe)}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Stack>
          </Paper>

          <Paper p="md" withBorder>
            <Stack gap="md">
              <Group justify="space-between" align="center" wrap="wrap">
                <Title order={4}>Detalle</Title>
                <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} onClick={handleDescargarCsv}>
                  Descargar CSV
                </Button>
              </Group>
              <Table.ScrollContainer minWidth={980}>
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={sinCorte}>Fecha</Table.Th>
                      <Table.Th>Proveedor</Table.Th>
                      <Table.Th style={sinCorte}>Comprobante</Table.Th>
                      <Table.Th>Repuesto o descripción</Table.Th>
                      <Table.Th style={sinCorte}>Cantidad</Table.Th>
                      <Table.Th style={sinCorte}>Costo unitario</Table.Th>
                      <Table.Th style={sinCorte}>Importe</Table.Th>
                      <Table.Th>Origen</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {datos.filas.map((f, i) => (
                      <Table.Tr key={i}>
                        <Table.Td style={sinCorte}>
                          <Text size="sm">{fechaCompra(f.fecha)}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c={f.proveedor ? undefined : 'dimmed'}>
                            {nombreProveedor(f.proveedor)}
                          </Text>
                        </Table.Td>
                        <Table.Td style={sinCorte}>
                          <Text size="sm" c={f.comprobante ? undefined : 'dimmed'}>
                            {f.comprobante ?? '—'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{textoArticuloCompra(f)}</Text>
                        </Table.Td>
                        <Table.Td style={sinCorte}>
                          <Text size="sm">
                            {formatCantidad(f.cantidad)} {f.unidad}
                          </Text>
                        </Table.Td>
                        <Table.Td style={sinCorte}>
                          <Text size="sm">{formatMoneda(f.costo_unitario)}</Text>
                        </Table.Td>
                        <Table.Td style={sinCorte}>
                          <Text size="sm" fw={700}>
                            {formatMoneda(f.importe)}
                          </Text>
                        </Table.Td>
                        <Table.Td style={sinCorte}>
                          {f.origen.tipo === 'INTERVENCION' && f.origen.intervencion ? (
                            <Anchor component={Link} to={`/intervenciones/${f.origen.intervencion.id}`} size="sm">
                              {textoOrigenCompra(f)}
                            </Anchor>
                          ) : (
                            <Text size="sm">{textoOrigenCompra(f)}</Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Stack>
          </Paper>
        </>
      )}
    </Stack>
  );
}
