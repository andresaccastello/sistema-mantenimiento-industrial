import {
  Paper,
  Title,
  Table,
  Text,
  Group,
  Button,
  Tooltip,
} from '@mantine/core';
import { PermisoCatalogo, UsuarioDetalleAdmin } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { nombreCompleto } from '../../lib/personas';
import { formatFechaHora } from '../../lib/formato';
import { FilaPermiso, etiquetaAlcance, opcionesExcepcion } from '../../lib/permisos';

export interface BloquePermisosUsuarioProps {
  filas: FilaPermiso[];
  usuario: UsuarioDetalleAdmin;
  onEditarExcepcion: (permiso: PermisoCatalogo) => void;
  onEliminarExcepcion: (permiso: PermisoCatalogo) => void;
}

export function BloquePermisosUsuario({
  filas,
  usuario,
  onEditarExcepcion,
  onEliminarExcepcion,
}: BloquePermisosUsuarioProps) {
  const { usuario: actor } = useAuth();
  const esElPropioUsuario = actor?.id === usuario.id;
  const puedeGestionarPermisos = Boolean(actor?.permisos?.['PERMISOS_GESTIONAR']);

  let ultimoGrupo = '';

  return (
    <Paper withBorder p="md" radius="sm">
      <Title order={4} mb="md">
        Permisos
      </Title>
      <Table.ScrollContainer minWidth={600}>
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Permiso</Table.Th>
              <Table.Th>Por su perfil</Table.Th>
              <Table.Th>Excepción</Table.Th>
              <Table.Th>Resultado</Table.Th>
              <Table.Th w={150}></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filas.map((fila) => {
              const esNuevoGrupo = fila.grupo !== ultimoGrupo;
              if (esNuevoGrupo) ultimoGrupo = fila.grupo;

              const opc = opcionesExcepcion(fila.permiso, actor?.permisos);
              const puedeGestionarFila =
                puedeGestionarPermisos && !esElPropioUsuario && opc.gestionable;

              const porPerfilTexto =
                fila.porPerfil !== null
                  ? etiquetaAlcance(fila.porPerfil, fila.permiso.usa_alcance)
                  : '—';

              const resultadoTexto =
                fila.resultado !== null
                  ? etiquetaAlcance(fila.resultado, fila.permiso.usa_alcance)
                  : 'No';

              const esDistinto = fila.resultado !== fila.porPerfil;

              let excepcionContenido = <Text size="sm">—</Text>;
              if (fila.excepcion) {
                const ex = fila.excepcion;
                const efectoTexto =
                  ex.efecto === 'DENEGAR'
                    ? 'Deniega'
                    : fila.permiso.usa_alcance && ex.alcance
                    ? `Concede, ${etiquetaAlcance(ex.alcance, true)}`
                    : 'Concede';

                const tooltipText = `Otorgado por: ${
                  ex.otorgado_por ? nombreCompleto(ex.otorgado_por) : 'Usuario eliminado'
                }\nFecha: ${formatFechaHora(ex.creado_en)}\nMotivo: ${ex.motivo}`;

                excepcionContenido = (
                  <Tooltip label={tooltipText} multiline style={{ whiteSpace: 'pre-line' }}>
                    <Text size="sm" style={{ cursor: 'help', textDecoration: 'underline dotted' }}>
                      {efectoTexto}
                    </Text>
                  </Tooltip>
                );
              }

              return (
                <>
                  {esNuevoGrupo && (
                    <Table.Tr key={`grupo-${fila.grupo}`} bg="var(--mantine-color-gray-1)">
                      <Table.Td colSpan={5}>
                        <Text fw={700} size="sm">
                          {fila.grupo}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                  <Table.Tr key={fila.permiso.codigo}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {fila.permiso.nombre}
                      </Text>
                      {fila.permiso.descripcion && (
                        <Text size="xs" c="dimmed">
                          {fila.permiso.descripcion}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{porPerfilTexto}</Text>
                    </Table.Td>
                    <Table.Td>{excepcionContenido}</Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={esDistinto ? 700 : 400}>
                        {resultadoTexto}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {puedeGestionarFila && (
                        <Group gap={6} justify="flex-end">
                          {!fila.excepcion ? (
                            <Button
                              variant="subtle"
                              size="xs"
                              onClick={() => onEditarExcepcion(fila.permiso)}
                            >
                              Agregar excepción
                            </Button>
                          ) : (
                            <>
                              <Button
                                variant="subtle"
                                size="xs"
                                onClick={() => onEditarExcepcion(fila.permiso)}
                              >
                                Cambiar
                              </Button>
                              <Button
                                variant="subtle"
                                color="red"
                                size="xs"
                                onClick={() => onEliminarExcepcion(fila.permiso)}
                              >
                                Quitar
                              </Button>
                            </>
                          )}
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                </>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Text size="xs" c="dimmed" mt="sm">
        Las excepciones cambian lo que da el perfil solo para esta persona. Denegar tiene prioridad.
      </Text>
    </Paper>
  );
}
