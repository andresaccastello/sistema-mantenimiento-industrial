import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Modal, Stack, Table, Text, Anchor, Button, Group, Pagination, Center, Loader, Alert } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { LecturaMedidor, MedidorLista } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { mensajeError } from '../../lib/errores';
import { formatFechaHora } from '../../lib/formato';
import { fechaDeMomento, textoOrigenLectura, textoValorMedidor } from '../../lib/medidores';
import { nombreCompleto } from '../../lib/personas';
import { ModalAnularLectura } from './ModalAnularLectura';

const POR_PAGINA = 20;

interface Props {
  /** El medidor cuyas lecturas se ven, o null con el diálogo cerrado. */
  medidor: MedidorLista | null;
  onCerrar: () => void;
}

/** 3.2 Las lecturas de un medidor, de la más nueva a la más vieja, de a 20. */
export function ModalLecturasMedidor({ medidor, onCerrar }: Props) {
  const { tienePermiso } = useAuth();
  const gestiona = tienePermiso('PLANES_GESTIONAR');
  const [pagina, setPagina] = useState(1);
  const [anulando, setAnulando] = useState<LecturaMedidor | null>(null);

  useEffect(() => {
    setPagina(1);
  }, [medidor?.id]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['medidores', medidor?.id, 'lecturas', pagina],
    queryFn: async () => {
      const { datos, total } = await clienteApi.getConTotal<LecturaMedidor[]>(`/api/medidores/${medidor?.id}/lecturas`, {
        params: { limit: POR_PAGINA, offset: (pagina - 1) * POR_PAGINA },
      });
      return { lecturas: datos, total: total ?? datos.length };
    },
    enabled: medidor !== null,
    placeholderData: keepPreviousData,
  });

  if (!medidor) return null;
  const totalPaginas = Math.ceil((data?.total ?? 0) / POR_PAGINA);
  const lecturas = data?.lecturas ?? [];

  return (
    <Modal opened onClose={onCerrar} title={`Lecturas: ${medidor.nombre}`} size="xl">
      <Stack gap="md">
        {isError && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {mensajeError(error)}
          </Alert>
        )}

        {isLoading && !data ? (
          <Center py="lg">
            <Loader color="marca" />
          </Center>
        ) : lecturas.length === 0 ? (
          <Text size="sm" c="dimmed">
            Todavía no tiene lecturas.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={720}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ minWidth: 130 }}>Fecha y hora</Table.Th>
                  <Table.Th style={{ minWidth: 150 }}>Valor</Table.Th>
                  <Table.Th style={{ minWidth: 130 }}>Quién</Table.Th>
                  <Table.Th style={{ minWidth: 150 }}>Origen</Table.Th>
                  <Table.Th style={{ minWidth: 140 }}>Observación</Table.Th>
                  {gestiona && <Table.Th style={{ width: 90 }} />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lecturas.map((l) => (
                  <Table.Tr key={l.id}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatFechaHora(l.registrada_en)}</Table.Td>
                    <Table.Td>
                      <Text size="sm" td={l.anulada ? 'line-through' : undefined} c={l.anulada ? 'dimmed' : undefined}>
                        {textoValorMedidor(l.valor, medidor.unidad)}
                      </Text>
                      {l.anulada && (
                        <Text size="xs" c="dimmed">
                          Anulada{l.anulada_por ? ` por ${nombreCompleto(l.anulada_por)}` : ''} el {fechaDeMomento(l.anulada_en)}:{' '}
                          {l.motivo_anulacion}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{nombreCompleto(l.registrada_por)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{textoOrigenLectura(l)}</Text>
                      {l.origen === 'TAREA' && l.intervencion_id !== null && (
                        <Anchor component={Link} to={`/intervenciones/${l.intervencion_id}`} size="xs">
                          Intervención N.º {l.intervencion_id}
                        </Anchor>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c={l.observacion ? undefined : 'dimmed'}>
                        {l.observacion ?? '—'}
                      </Text>
                    </Table.Td>
                    {gestiona && (
                      <Table.Td>
                        {!l.anulada && (
                          <Button size="xs" variant="subtle" color="red" onClick={() => setAnulando(l)}>
                            Anular
                          </Button>
                        )}
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        {totalPaginas > 1 && (
          <Group justify="center">
            <Pagination total={totalPaginas} value={pagina} onChange={setPagina} size="sm" />
          </Group>
        )}
      </Stack>

      <ModalAnularLectura medidorId={medidor.id} unidad={medidor.unidad} lectura={anulando} onCerrar={() => setAnulando(null)} />
    </Modal>
  );
}
