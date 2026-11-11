import {
  Paper,
  Title,
  Stack,
  Text,
  Group,
  Button,
} from '@mantine/core';
import { PermisoCatalogo, UsuarioAuditoriaRegistro } from '../../api/tipos';
import { nombreCompleto } from '../../lib/personas';
import { formatFechaHora } from '../../lib/formato';
import { AuditoriaReferencias, textoAuditoria } from '../../lib/auditoria';

export interface BloqueHistorialUsuarioProps {
  registros: UsuarioAuditoriaRegistro[];
  total: number;
  limite: number;
  onVerMas: () => void;
  referencias: AuditoriaReferencias;
  catalogo: PermisoCatalogo[];
}

export function BloqueHistorialUsuario({
  registros,
  total,
  limite,
  onVerMas,
  referencias,
  catalogo,
}: BloqueHistorialUsuarioProps) {
  return (
    <Paper withBorder p="md" radius="sm">
      <Title order={4} mb="md">
        Historial
      </Title>
      {registros.length === 0 ? (
        <Text size="sm" c="dimmed">
          Sin cambios registrados.
        </Text>
      ) : (
        <Stack gap="md">
          {registros.map((reg) => {
            const { titulo, detalle } = textoAuditoria(reg, referencias, catalogo);
            const autor = reg.realizado_por ? nombreCompleto(reg.realizado_por) : 'Usuario eliminado';

            return (
              <div key={reg.id} style={{ borderBottom: '1px solid var(--mantine-color-gray-2)', paddingBottom: 8 }}>
                <Text size="xs" c="dimmed">
                  {formatFechaHora(reg.creado_en)} · {autor}
                </Text>
                <Text size="sm" fw={600} mt={2}>
                  {titulo}
                </Text>
                {detalle && (
                  <Text size="sm" c="dimmed" mt={1}>
                    {detalle}
                  </Text>
                )}
              </div>
            );
          })}

          {registros.length < total && limite < 200 && (
            <Group justify="center" mt="sm">
              <Button variant="default" size="xs" onClick={onVerMas}>
                Ver más
              </Button>
            </Group>
          )}
        </Stack>
      )}
    </Paper>
  );
}

