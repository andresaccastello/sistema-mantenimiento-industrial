import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Anchor, Button, Group, Modal, Paper, Skeleton, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBook,
  IconEdit,
  IconExternalLink,
  IconFile,
  IconListCheck,
  IconPhoto,
  IconPlus,
  IconRuler2,
  IconTrash,
  IconVideo,
} from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { DocumentoMaquina } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { mensajeError } from '../../lib/errores';
import { agruparDocumentos, type IconoDocumento } from '../../lib/documentos';
import { ModalDocumento } from './ModalDocumento';

const ICONOS: Record<IconoDocumento, typeof IconBook> = {
  book: IconBook,
  photo: IconPhoto,
  video: IconVideo,
  list: IconListCheck,
  ruler: IconRuler2,
  file: IconFile,
};

interface Props {
  maquinaId: number;
  maquinaActiva: boolean;
}

/**
 * MQ1, 4.1: los documentos de la máquina, agrupados por tipo. Cada uno es un enlace que abre en
 * una pestaña nueva; nunca se incrusta. Con DOCUMENTOS_GESTIONAR, alta, edición y borrado.
 */
export function BloqueDocumentosMaquina({ maquinaId, maquinaActiva }: Props) {
  const { tienePermiso } = useAuth();
  const gestiona = tienePermiso('DOCUMENTOS_GESTIONAR');
  const queryClient = useQueryClient();
  const [enEdicion, setEnEdicion] = useState<null | 'nuevo' | DocumentoMaquina>(null);
  const [borrando, setBorrando] = useState<DocumentoMaquina | null>(null);
  const [guardando, setGuardando] = useState(false);

  const { data, isPending } = useQuery<DocumentoMaquina[]>({
    queryKey: ['maquina', maquinaId, 'documentos'],
    queryFn: () => clienteApi.get<DocumentoMaquina[]>(`/api/maquinas/${maquinaId}/documentos`),
  });
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['maquina', maquinaId, 'documentos'] });

  const borrar = async () => {
    if (!borrando) return;
    setGuardando(true);
    try {
      await clienteApi.delete(`/api/documentos/${borrando.id}`);
      notifications.show({ message: 'Documento borrado', color: 'green', autoClose: 2000 });
      setBorrando(null);
      await refrescar();
    } catch (err) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  const grupos = agruparDocumentos(data ?? []);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Title order={4}>Documentos</Title>
          {gestiona && maquinaActiva && (
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEnEdicion('nuevo')}>
              Agregar documento
            </Button>
          )}
        </Group>

        {isPending ? (
          <Skeleton height={40} radius="sm" />
        ) : grupos.length === 0 ? (
          <Text size="sm" c="var(--sm-tenue)">
            La máquina no tiene documentos.
          </Text>
        ) : (
          grupos.map(({ tipo, documentos }) => {
            const Icono = ICONOS[tipo.icono];
            return (
              <Stack key={tipo.codigo} gap={4}>
                <Group gap={6}>
                  <Icono size={16} color="var(--sm-tenue)" aria-hidden />
                  <Text size="xs" fw={700} tt="uppercase" c="var(--sm-tenue)">
                    {tipo.grupo}
                  </Text>
                </Group>
                {documentos.map((d) => (
                  <Group
                    key={d.id}
                    justify="space-between"
                    align="flex-start"
                    gap="xs"
                    wrap="nowrap"
                    py={4}
                    style={{ borderTop: '1px solid var(--sm-separador)' }}
                  >
                    <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                      <Anchor
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        size="sm"
                        fw={500}
                        style={{ overflowWrap: 'anywhere' }}
                      >
                        {d.titulo} <IconExternalLink size={12} style={{ verticalAlign: 'middle' }} aria-hidden />
                      </Anchor>
                      {d.notas && (
                        <Text size="xs" c="var(--sm-tenue)" style={{ overflowWrap: 'anywhere' }}>
                          {d.notas}
                        </Text>
                      )}
                    </Stack>
                    {gestiona && (
                      <Group gap={0} wrap="nowrap">
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          aria-label={`Editar ${d.titulo}`}
                          onClick={() => setEnEdicion(d)}
                        >
                          <IconEdit size={14} />
                        </Button>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="red"
                          aria-label={`Borrar ${d.titulo}`}
                          onClick={() => setBorrando(d)}
                        >
                          <IconTrash size={14} />
                        </Button>
                      </Group>
                    )}
                  </Group>
                ))}
              </Stack>
            );
          })
        )}
      </Stack>

      <ModalDocumento
        maquinaId={maquinaId}
        documento={enEdicion}
        onCerrar={() => setEnEdicion(null)}
        onGuardado={() => {
          setEnEdicion(null);
          void refrescar();
        }}
      />

      <Modal opened={borrando !== null} onClose={() => setBorrando(null)} title="Borrar el documento" centered>
        <Stack gap="md">
          <Text size="sm" c="var(--sm-texto)">
            Se borra el enlace a "{borrando?.titulo}". El archivo, donde esté guardado, no se toca.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setBorrando(null)}>
              Cancelar
            </Button>
            <Button color="red" onClick={borrar} loading={guardando}>
              Borrar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
