import { useNavigate } from 'react-router';
import { Box, Button, Card, Center, Group, Stack, Text, Title } from '@mantine/core';
import { IconCircleCheck } from '@tabler/icons-react';
import type { IntervencionCreada } from '../../api/tipos';
import { EstadoBadge } from '../EstadoBadge';

interface Props {
  reporteCreado: IntervencionCreada;
  /** La máquina como se eligió en el formulario, o el nombre que devolvió la API. */
  etiquetaMaquina: string;
  esCelular: boolean;
  onReportarOtra: () => void;
}

/** La confirmación después de reportar una falla. */
export function ConfirmacionReporte({ reporteCreado, etiquetaMaquina, esCelular, onReportarOtra }: Props) {
  const navigate = useNavigate();
  const maqResp = reporteCreado.maquina;

  return (
    <Center py="xl">
      <Card
        withBorder
        radius="md"
        p="xl"
        maw={560}
        w="100%"
        style={{ textAlign: 'center' }}
      >
        <Stack align="center" gap="md">
          <Box c="#16a34a">
            <IconCircleCheck size={64} stroke={1.5} />
          </Box>

          <Title order={2} size="h3" c="#0f172a">
            Reporte N.º {reporteCreado.id} registrado
          </Title>

          <Text size="lg" fw={500} c="#334155">
            {etiquetaMaquina}
          </Text>

          <Group gap="xs" justify="center">
            <Text size="sm" c="#64748b">
              Estado de la máquina:
            </Text>
            <EstadoBadge entidad="maquina" estado={maqResp.estado_actual} size="md" />
          </Group>

          <Stack gap="sm" w="100%" mt="lg">
            <Button
              size="lg"
              color="marca"
              onClick={() => navigate(`/intervenciones/${reporteCreado.id}`)}
            >
              Ver el reporte
            </Button>

            <Button
              size="lg"
              variant="light"
              color="marca"
              onClick={onReportarOtra}
            >
              Reportar otra falla
            </Button>

            <Button
              size="lg"
              variant="subtle"
              color="gray"
              onClick={() => navigate(esCelular ? '/mis-reportes' : '/')}
            >
              {esCelular ? 'Ver mis reportes' : 'Ir al inicio'}
            </Button>
          </Stack>
        </Stack>
      </Card>
    </Center>
  );
}
