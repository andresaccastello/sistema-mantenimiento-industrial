import { Fragment } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Stack,
  Title,
  Text,
  Button,
  Paper,
  Table,
  Tooltip,
  Skeleton,
  Alert,
} from '@mantine/core';
import { IconArrowLeft, IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../api/cliente';
import { PerfilDetalle, PermisoCatalogo } from '../api/tipos';
import { nombrePerfil } from '../lib/perfiles';
import { matrizPerfiles } from '../lib/permisos';
import { mensajeError } from '../lib/errores';

export function Perfiles() {
  const navigate = useNavigate();

  const perfilesQuery = useQuery({
    queryKey: ['perfiles'],
    queryFn: () => clienteApi.get<PerfilDetalle[]>('/api/perfiles'),
  });

  const permisosQuery = useQuery({
    queryKey: ['permisos'],
    queryFn: () => clienteApi.get<PermisoCatalogo[]>('/api/permisos'),
  });

  const isLoading = perfilesQuery.isLoading || permisosQuery.isLoading;
  const isError = perfilesQuery.isError || permisosQuery.isError;
  const error = perfilesQuery.error || permisosQuery.error;

  const perfiles = perfilesQuery.data || [];
  const catalogo = permisosQuery.data || [];
  const filas = matrizPerfiles(perfiles, catalogo);

  return (
    <Stack gap="lg">
      {/* Botón volver */}
      <div>
        <Button
          variant="subtle"
          color="gray"
          leftSection={<IconArrowLeft size={16} />}
          onClick={() => navigate('/usuarios')}
        >
          Usuarios
        </Button>
      </div>

      {/* Encabezado */}
      <div>
        <Title order={2}>Perfiles</Title>
        <Text size="sm" c="dimmed" mt={4}>
          Qué permite cada perfil. Para cambiarle algo a una persona, usá las excepciones en su usuario.
        </Text>
      </div>

      {isLoading ? (
        <Stack gap="xs">
          <Skeleton height={40} />
          <Skeleton height={200} />
        </Stack>
      ) : isError ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {mensajeError(error)}
        </Alert>
      ) : (
        <Paper withBorder radius="sm">
          <Table.ScrollContainer minWidth={700}>
            <Table withTableBorder withColumnBorders verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={260}>Permiso</Table.Th>
                  {perfiles.map((p) => {
                    const cant = p.usuarios_activos ?? 0;
                    const textoCant = `${cant} ${cant === 1 ? 'usuario activo' : 'usuarios activos'}`;
                    return (
                      <Table.Th key={p.id} ta="center">
                        <Text fw={600} size="sm">
                          {nombrePerfil(p.nombre)}
                        </Text>
                        <Text size="xs" c="dimmed" fw={400}>
                          {textoCant}
                        </Text>
                      </Table.Th>
                    );
                  })}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(() => {
                  let ultimoGrupo = '';
                  return filas.map((fila) => {
                    const esNuevoGrupo = fila.grupo !== ultimoGrupo;
                    if (esNuevoGrupo) ultimoGrupo = fila.grupo;

                    const permisoTooltip = fila.permiso.descripcion
                      ? `${fila.permiso.nombre}\n${fila.permiso.descripcion}`
                      : fila.permiso.nombre;

                    return (
                      <Fragment key={fila.permiso.codigo}>
                        {esNuevoGrupo && (
                          <Table.Tr key={`grupo-${fila.grupo}`} bg="var(--mantine-color-gray-1)">
                            <Table.Td colSpan={1 + perfiles.length}>
                              <Text fw={700} size="sm">
                                {fila.grupo}
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        )}
                        <Table.Tr key={fila.permiso.codigo}>
                          <Table.Td>
                            <Tooltip label={permisoTooltip} multiline style={{ whiteSpace: 'pre-line' }}>
                              <Text size="sm" style={{ cursor: 'help' }}>
                                {fila.permiso.nombre}
                              </Text>
                            </Tooltip>
                          </Table.Td>
                          {perfiles.map((p) => {
                            const valor = fila.celdas[p.id] || '—';
                            return (
                              <Table.Td key={p.id} ta="center">
                                <Text
                                  size="sm"
                                  c={valor === '—' ? 'dimmed' : undefined}
                                  fw={valor !== '—' ? 500 : 400}
                                >
                                  {valor}
                                </Text>
                              </Table.Td>
                            );
                          })}
                        </Table.Tr>
                      </Fragment>
                    );
                  });
                })()}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
    </Stack>
  );
}

