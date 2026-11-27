import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, FileButton, Group, Image, Modal, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTrash, IconUpload } from '@tabler/icons-react';
import { BASE_URL, clienteApi } from '../../api/cliente';
import type { ConfiguracionPublica } from '../../api/tipos';
import { mensajeError } from '../../lib/errores';
import { AYUDA_LOGO, cuerpoIdentidad, errorArchivoLogo, erroresIdentidad, urlLogo } from '../../lib/identidad';

/** D1, 6: el nombre del sistema, el de la empresa y el logo, con CONFIGURACION_GESTIONAR. */
export function TarjetaIdentidad() {
  const queryClient = useQueryClient();
  const { data: config } = useQuery<ConfiguracionPublica>({
    queryKey: ['configuracion-publica'],
    queryFn: () => clienteApi.get<ConfiguracionPublica>('/api/configuracion/publica'),
    staleTime: 1000 * 60 * 10,
  });

  const [sistema, setSistema] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [intentoGuardar, setIntentoGuardar] = useState(false);

  // El logo nuevo, antes de confirmarlo
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [errorLogo, setErrorLogo] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);

  useEffect(() => {
    if (config) {
      setSistema(config.nombre_sistema);
      setEmpresa(config.nombre_empresa ?? '');
    }
  }, [config]);

  useEffect(() => () => {
    if (vistaPrevia) URL.revokeObjectURL(vistaPrevia);
  }, [vistaPrevia]);

  /** Al guardar, se ve sin recargar: el encabezado, el ingreso y la pestaña leen esta consulta. */
  const aplicar = (nueva: ConfiguracionPublica) => {
    queryClient.setQueryData(['configuracion-publica'], nueva);
  };

  const errores = erroresIdentidad(sistema, empresa);
  const guardarNombres = async () => {
    setIntentoGuardar(true);
    if (errores.sistema || errores.empresa) return;
    setGuardando(true);
    try {
      aplicar(await clienteApi.put<ConfiguracionPublica>('/api/configuracion/identidad', cuerpoIdentidad(sistema, empresa)));
      notifications.show({ message: 'Identidad guardada.', color: 'green' });
      setIntentoGuardar(false);
    } catch (err) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  const elegirArchivo = (f: File | null) => {
    if (vistaPrevia) URL.revokeObjectURL(vistaPrevia);
    setVistaPrevia(null);
    setArchivo(null);
    setErrorLogo(null);
    if (!f) return;
    const error = errorArchivoLogo(f);
    if (error) {
      setErrorLogo(error);
      return;
    }
    setArchivo(f);
    setVistaPrevia(URL.createObjectURL(f));
  };

  const subirLogo = async () => {
    if (!archivo) return;
    setSubiendo(true);
    try {
      const formulario = new FormData();
      formulario.append('archivo', archivo);
      aplicar(await clienteApi.putFormulario<ConfiguracionPublica>('/api/configuracion/logo', formulario));
      notifications.show({ message: 'Logo actualizado.', color: 'green' });
      elegirArchivo(null);
    } catch (err) {
      setErrorLogo(mensajeError(err));
    } finally {
      setSubiendo(false);
    }
  };

  const quitarLogo = async () => {
    setSubiendo(true);
    try {
      aplicar(await clienteApi.delete<ConfiguracionPublica>('/api/configuracion/logo'));
      notifications.show({ message: 'Logo quitado.', color: 'green' });
      setConfirmarQuitar(false);
    } catch (err) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <Card withBorder radius="md" padding="lg">
      <Stack gap="md">
        <Title order={3}>Identidad del sistema</Title>

        <TextInput
          label="Nombre del sistema"
          value={sistema}
          onChange={(e) => setSistema(e.currentTarget.value)}
          error={intentoGuardar ? errores.sistema : null}
          maxLength={80}
        />
        <TextInput
          label="Nombre de la empresa"
          value={empresa}
          onChange={(e) => setEmpresa(e.currentTarget.value)}
          error={intentoGuardar ? errores.empresa : null}
          maxLength={120}
        />
        <Group justify="flex-end">
          <Button color="marca" onClick={guardarNombres} loading={guardando}>
            Guardar
          </Button>
        </Group>

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Logo
          </Text>
          <Group gap="lg" align="center" wrap="wrap">
            {vistaPrevia ? (
              <Image src={vistaPrevia} alt="Vista previa del logo nuevo" h={64} w="auto" fit="contain" />
            ) : config?.tiene_logo ? (
              <Image src={urlLogo(BASE_URL, config.actualizado_en)} alt="Logo actual" h={64} w="auto" fit="contain" />
            ) : (
              <Text size="sm" c="dimmed">
                Sin logo
              </Text>
            )}
            <Group gap="xs" wrap="wrap">
              {archivo ? (
                <>
                  <Button color="marca" onClick={subirLogo} loading={subiendo}>
                    Confirmar logo
                  </Button>
                  <Button variant="default" onClick={() => elegirArchivo(null)} disabled={subiendo}>
                    Descartar
                  </Button>
                </>
              ) : (
                <>
                  <FileButton onChange={elegirArchivo} accept="image/png,image/jpeg,image/webp">
                    {(props) => (
                      <Button {...props} variant="default" leftSection={<IconUpload size={16} />}>
                        Subir logo
                      </Button>
                    )}
                  </FileButton>
                  {config?.tiene_logo && (
                    <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={() => setConfirmarQuitar(true)}>
                      Quitar logo
                    </Button>
                  )}
                </>
              )}
            </Group>
          </Group>
          {errorLogo && (
            <Text size="sm" c="red">
              {errorLogo}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            PNG, JPEG o WEBP, hasta 300 KB. {AYUDA_LOGO}
          </Text>
        </Stack>
      </Stack>

      <Modal opened={confirmarQuitar} onClose={() => !subiendo && setConfirmarQuitar(false)} title="Quitar logo" centered>
        <Stack gap="md">
          <Text size="sm">El sistema queda sin logo, arriba a la izquierda y en la pantalla de ingreso.</Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setConfirmarQuitar(false)} disabled={subiendo}>
              Volver
            </Button>
            <Button color="red" onClick={quitarLogo} loading={subiendo}>
              Quitar logo
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
