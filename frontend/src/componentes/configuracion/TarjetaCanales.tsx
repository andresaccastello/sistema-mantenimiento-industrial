import React, { useState } from 'react';
import {
  Card,
  Stack,
  Group,
  Text,
  Switch,
  Button,
  Tooltip,
  Alert,
  Box,
} from '@mantine/core';
import { IconMail, IconAlertTriangle, IconAlertCircle } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { CanalAviso, ConfiguracionAvisos } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { formatFechaHora } from '../../lib/formato';
import { nombreCompleto } from '../../lib/personas';
import { ApiError, mensajeError } from '../../lib/errores';
import { ConfirmarApagarEmailModal } from './ConfirmarApagarEmailModal';

export interface TarjetaCanalesProps {
  canales: CanalAviso[];
  pendientes: number;
  onActualizado: () => void;
}

export function TarjetaCanales({ canales, pendientes, onActualizado }: TarjetaCanalesProps) {
  const { usuario } = useAuth();

  const canalEmail = canales.find((c) => c.canal === 'EMAIL');

  const [modalConfirmarApagar, setModalConfirmarApagar] = useState(false);
  const [actualizandoCanal, setActualizandoCanal] = useState(false);
  const [enviandoPrueba, setEnviandoPrueba] = useState(false);
  const [errorPrueba, setErrorPrueba] = useState<{ mensaje: string; detalle?: string } | null>(null);

  const cambiarEstadoEmail = async (nuevoActivo: boolean) => {
    if (!nuevoActivo && pendientes > 0) {
      setModalConfirmarApagar(true);
      return;
    }

    await ejecutarCambioEmail(nuevoActivo);
  };

  const ejecutarCambioEmail = async (activo: boolean) => {
    setActualizandoCanal(true);
    try {
      await clienteApi.put<ConfiguracionAvisos>('/api/configuracion/avisos/canales/EMAIL', {
        activo,
      });
      notifications.show({
        message: activo ? 'Avisos por email activados.' : 'Avisos por email desactivados.',
        color: 'green',
      });
      onActualizado();
    } catch (err) {
      notifications.show({
        message: mensajeError(err),
        color: 'red',
      });
    } finally {
      setActualizandoCanal(false);
      setModalConfirmarApagar(false);
    }
  };

  const handleEnviarPrueba = async () => {
    setErrorPrueba(null);
    setEnviandoPrueba(true);
    try {
      const res = await clienteApi.post<{ enviado_a: string }>('/api/configuracion/avisos/prueba', {
        canal: 'EMAIL',
      });
      notifications.show({
        message: `Email de prueba enviado a ${res.enviado_a}. Revisá también la carpeta de spam.`,
        color: 'green',
      });
    } catch (err: any) {
      if (err instanceof ApiError && err.codigo === 'ENVIO_FALLIDO') {
        const detalle = typeof err.datos?.detalle === 'string' ? err.datos.detalle : undefined;
        setErrorPrueba({
          mensaje: mensajeError(err),
          detalle,
        });
      } else {
        notifications.show({
          message: mensajeError(err),
          color: 'red',
        });
      }
    } finally {
      setEnviandoPrueba(false);
    }
  };

  const tieneEmailPropio = Boolean(usuario?.email && usuario.email.trim());

  return (
    <>
      <Card withBorder radius="sm" padding="lg">
        <Stack gap="md" justify="space-between" style={{ height: '100%' }}>
          <Stack gap="xs">
            <Group justify="space-between" align="center">
              <Group gap="xs">
                <IconMail size={20} color="#0284c7" />
                <Text fw={600} size="md">
                  Email
                </Text>
              </Group>
              <Switch
                label="Activo"
                checked={Boolean(canalEmail?.activo)}
                disabled={!canalEmail?.configurado || actualizandoCanal}
                onChange={(e) => cambiarEstadoEmail(e.currentTarget.checked)}
              />
            </Group>

            {canalEmail?.configurado ? (
              <>
                <Text size="sm" c="dimmed">
                  Envía desde {canalEmail.remitente}
                </Text>
                <Box mt="xs">
                  {tieneEmailPropio ? (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleEnviarPrueba}
                      loading={enviandoPrueba}
                    >
                      Enviar prueba
                    </Button>
                  ) : (
                    <Tooltip label="Cargá tu email en tu usuario para recibir la prueba.">
                      <span>
                        <Button variant="default" size="sm" disabled>
                          Enviar prueba
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                </Box>
                {errorPrueba && (
                  <Alert
                    color="red"
                    icon={<IconAlertCircle size={16} />}
                    title={errorPrueba.mensaje}
                    mt="xs"
                  >
                    {errorPrueba.detalle && (
                      <Text size="xs" c="dimmed">
                        {errorPrueba.detalle}
                      </Text>
                    )}
                  </Alert>
                )}
              </>
            ) : (
              <Alert
                color="yellow"
                icon={<IconAlertTriangle size={16} />}
                title="Configuración pendiente"
                mt="xs"
              >
                Falta configurar el servidor de correo. Lo hace quien instala el sistema (ver{' '}
                <code>docs/desarrollo-local.md</code>).
              </Alert>
            )}
          </Stack>

          {canalEmail?.actualizado_en && (
            <Text size="xs" c="dimmed" mt="md">
              Último cambio: {formatFechaHora(canalEmail.actualizado_en)}
              {canalEmail.actualizado_por &&
                ` por ${nombreCompleto(canalEmail.actualizado_por)}`}
            </Text>
          )}
        </Stack>
      </Card>

      <ConfirmarApagarEmailModal
        abierto={modalConfirmarApagar}
        pendientes={pendientes}
        onConfirmar={() => ejecutarCambioEmail(false)}
        onCancelar={() => setModalConfirmarApagar(false)}
        cargando={actualizandoCanal}
      />
    </>
  );
}
