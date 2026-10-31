import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Stack,
  Group,
  Text,
  Badge,
  Button,
  Switch,
  ActionIcon,
  Loader,
  Center,
} from '@mantine/core';
import { IconCheck, IconChecks } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { clienteApi } from '../api/cliente';
import { formatHace } from '../lib/formato';
import { EncabezadoPagina } from '../componentes/EncabezadoPagina';
import { PantallaVacia } from '../componentes/PantallaVacia';
import type { Notificacion } from '../api/tipos';

const LIMITE_PAGINA = 30;

export function Notificaciones() {
  const [soloNoLeidas, setSoloNoLeidas] = useState(false);
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [hayMas, setHayMas] = useState(true);

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const cargarNotificaciones = useCallback(
    async (reiniciar = true) => {
      try {
        if (reiniciar) {
          setCargando(true);
        } else {
          setCargandoMas(true);
        }

        const params: Record<string, string | number | boolean> = {
          limite: LIMITE_PAGINA,
        };

        if (soloNoLeidas) {
          params.solo_no_leidas = true;
        }

        if (!reiniciar && notificaciones.length > 0) {
          const ultimoId = notificaciones[notificaciones.length - 1].id;
          params.antes_de = ultimoId;
        }

        const datos = await clienteApi.get<Notificacion[]>('/api/notificaciones', { params });

        if (reiniciar) {
          setNotificaciones(datos);
        } else {
          setNotificaciones((prev) => [...prev, ...datos]);
        }

        setHayMas(datos.length === LIMITE_PAGINA);
      } catch (err) {
        console.error('Error al cargar notificaciones:', err);
      } finally {
        setCargando(false);
        setCargandoMas(false);
      }
    },
    [soloNoLeidas, notificaciones]
  );

  // Recarga cuando cambia el filtro
  useEffect(() => {
    let montado = true;
    setCargando(true);

    const params: Record<string, string | number | boolean> = {
      limite: LIMITE_PAGINA,
    };
    if (soloNoLeidas) {
      params.solo_no_leidas = true;
    }

    clienteApi
      .get<Notificacion[]>('/api/notificaciones', { params })
      .then((datos) => {
        if (montado) {
          setNotificaciones(datos);
          setHayMas(datos.length === LIMITE_PAGINA);
        }
      })
      .catch((err) => console.error('Error cargando notificaciones:', err))
      .finally(() => {
        if (montado) setCargando(false);
      });

    return () => {
      montado = false;
    };
  }, [soloNoLeidas]);

  const handleMarcarLeida = async (e: React.MouseEvent, notif: Notificacion) => {
    e.stopPropagation();
    try {
      await clienteApi.post(`/api/notificaciones/${notif.id}/leer`);
      setNotificaciones((prev) =>
        prev.map((item) => (item.id === notif.id ? { ...item, leida: true } : item))
      );
      queryClient.invalidateQueries({ queryKey: ['notificaciones-contador'] });
    } catch (err) {
      console.error('Error al marcar notificación como leída:', err);
    }
  };

  const handleClickNotificacion = async (notif: Notificacion) => {
    if (!notif.leida) {
      try {
        await clienteApi.post(`/api/notificaciones/${notif.id}/leer`);
        setNotificaciones((prev) =>
          prev.map((item) => (item.id === notif.id ? { ...item, leida: true } : item))
        );
        queryClient.invalidateQueries({ queryKey: ['notificaciones-contador'] });
      } catch (err) {
        console.error('Error al marcar leída al hacer click:', err);
      }
    }

    if (notif.intervencion_id) {
      navigate(`/intervenciones/${notif.intervencion_id}`);
    }
  };

  const handleMarcarTodasLeidas = async () => {
    try {
      await clienteApi.post('/api/notificaciones/leer-todas');
      setNotificaciones((prev) => prev.map((item) => ({ ...item, leida: true })));
      queryClient.invalidateQueries({ queryKey: ['notificaciones-contador'] });
    } catch (err) {
      console.error('Error al marcar todas las notificaciones como leídas:', err);
    }
  };

  return (
    <>
      <EncabezadoPagina
        titulo="Avisos"
        subtitulo="Notificaciones y novedades del sistema"
        acciones={
          <Group gap="md">
            <Switch
              label="Solo no leídos"
              checked={soloNoLeidas}
              onChange={(e) => setSoloNoLeidas(e.currentTarget.checked)}
              size="sm"
            />
            <Button
              variant="default"
              size="sm"
              leftSection={<IconChecks size={16} />}
              onClick={handleMarcarTodasLeidas}
              disabled={notificaciones.every((n) => n.leida)}
            >
              Marcar todos como leídos
            </Button>
          </Group>
        }
      />

      {cargando ? (
        <Center py="xl">
          <Loader color="marca" />
        </Center>
      ) : notificaciones.length === 0 ? (
        <Card withBorder radius="sm" padding="xl">
          <PantallaVacia
            titulo="No tenés avisos."
            mensaje={soloNoLeidas ? 'No hay avisos pendientes de lectura.' : 'Cuando surjan novedades las vas a ver acá.'}
          />
        </Card>
      ) : (
        <Stack gap="xs">
          {notificaciones.map((notif) => {
            const esAlta = notif.prioridad === 'ALTA';
            const noLeida = !notif.leida;

            return (
              <Card
                key={notif.id}
                withBorder
                radius="sm"
                padding="md"
                onClick={() => handleClickNotificacion(notif)}
                style={{
                  cursor: notif.intervencion_id ? 'pointer' : 'default',
                  backgroundColor: noLeida ? '#f0fdf4' : '#ffffff',
                  borderColor: noLeida ? '#bbf7d0' : 'rgba(0, 0, 0, 0.08)',
                  transition: 'background-color 150ms ease',
                }}
              >
                <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
                  <Stack gap={4} style={{ flex: 1 }}>
                    <Group gap="xs" wrap="wrap">
                      {esAlta && (
                        <Badge color="red" size="xs" variant="filled">
                          Alta
                        </Badge>
                      )}
                      <Text
                        size="sm"
                        fw={noLeida ? 600 : 500}
                        c={noLeida ? '#0f172a' : '#334155'}
                      >
                        {notif.titulo}
                      </Text>
                      <Text size="xs" c="#64748b">
                        • {formatHace(notif.creada_en)}
                      </Text>
                    </Group>
                    <Text size="sm" c="#475569">
                      {notif.mensaje}
                    </Text>
                  </Stack>

                  {noLeida && (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      title="Marcar como leído"
                      onClick={(e) => handleMarcarLeida(e, notif)}
                    >
                      <IconCheck size={16} />
                    </ActionIcon>
                  )}
                </Group>
              </Card>
            );
          })}

          {hayMas && (
            <Center mt="md">
              <Button
                variant="default"
                size="sm"
                loading={cargandoMas}
                onClick={() => cargarNotificaciones(false)}
              >
                Ver más
              </Button>
            </Center>
          )}
        </Stack>
      )}
    </>
  );
}
