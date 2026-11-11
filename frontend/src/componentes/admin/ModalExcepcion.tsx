import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  Text,
  Textarea,
  SegmentedControl,
  InputLabel,
  Group,
  Button,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import {
  AlcancePermiso,
  ExcepcionPermisoDetalle,
  PermisoCatalogo,
  UsuarioDetalleAdmin,
} from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { etiquetaAlcance, opcionesExcepcion } from '../../lib/permisos';
import { validarMotivo } from '../../lib/usuarios';
import { mensajeError } from '../../lib/errores';

export interface ModalExcepcionProps {
  abierto: boolean;
  onCerrar: () => void;
  usuario: UsuarioDetalleAdmin | null;
  permiso: PermisoCatalogo | null;
  excepcionExistente?: ExcepcionPermisoDetalle | null;
}

export function ModalExcepcion({
  abierto,
  onCerrar,
  usuario,
  permiso,
  excepcionExistente,
}: ModalExcepcionProps) {
  const queryClient = useQueryClient();
  const { usuario: actor } = useAuth();
  const esCelular = useMediaQuery('(max-width: 48em)');

  const [efecto, setEfecto] = useState<'CONCEDER' | 'DENEGAR'>('CONCEDER');
  const [alcance, setAlcance] = useState<AlcancePermiso | null>(null);
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const opciones = permiso ? opcionesExcepcion(permiso, actor?.permisos) : { gestionable: false, alcances: [] };

  useEffect(() => {
    if (abierto && permiso) {
      if (excepcionExistente) {
        setEfecto(excepcionExistente.efecto);
        setAlcance(excepcionExistente.alcance || (opciones.alcances[0] ?? null));
        setMotivo('');
      } else {
        setEfecto('CONCEDER');
        setAlcance(opciones.alcances[0] ?? null);
        setMotivo('');
      }
      setErrorMotivo(null);
    }
  }, [abierto, permiso, excepcionExistente]);

  if (!usuario || !permiso) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMotivo(null);

    const errMot = validarMotivo(motivo);
    if (errMot) {
      setErrorMotivo(errMot);
      return;
    }

    setGuardando(true);
    try {
      const payload: Record<string, any> = {
        efecto,
        motivo: motivo.trim(),
      };

      if (efecto === 'CONCEDER' && permiso.usa_alcance && alcance) {
        payload.alcance = alcance;
      }

      await clienteApi.put(
        `/api/usuarios/${usuario.id}/excepciones/${permiso.codigo}`,
        payload
      );

      notifications.show({
        message: 'Excepción guardada. Vale desde su próximo pedido, sin volver a entrar.',
        color: 'green',
      });

      await queryClient.invalidateQueries({ queryKey: ['usuario', usuario.id] });
      onCerrar();
    } catch (err: any) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  const opcionesAlcance = opciones.alcances.map((a) => ({
    value: a,
    label: etiquetaAlcance(a, true),
  }));

  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title={excepcionExistente ? 'Cambiar excepción' : 'Agregar excepción'}
      fullScreen={esCelular}
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <div>
            <Text fw={600} size="sm">
              Permiso
            </Text>
            <Text size="sm">{permiso.nombre}</Text>
            {permiso.descripcion && (
              <Text size="xs" c="dimmed">
                {permiso.descripcion}
              </Text>
            )}
          </div>

          <div>
            <InputLabel size="sm" mb={4}>
              Efecto
            </InputLabel>
            <SegmentedControl
              fullWidth
              value={efecto}
              onChange={(val) => setEfecto(val as 'CONCEDER' | 'DENEGAR')}
              data={[
                { value: 'CONCEDER', label: 'Conceder' },
                { value: 'DENEGAR', label: 'Denegar' },
              ]}
            />
          </div>

          {efecto === 'CONCEDER' && permiso.usa_alcance && opcionesAlcance.length > 0 && (
            <div>
              <InputLabel size="sm" mb={4}>
                Alcance
              </InputLabel>
              <SegmentedControl
                fullWidth
                value={alcance || opcionesAlcance[0].value}
                onChange={(val) => setAlcance(val as AlcancePermiso)}
                data={opcionesAlcance}
              />
            </div>
          )}

          <Textarea
            label="Motivo"
            maxLength={500}
            placeholder="Indicá el motivo (al menos 5 caracteres)"
            value={motivo}
            onChange={(e) => setMotivo(e.currentTarget.value)}
            required
            error={errorMotivo}
            minRows={3}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" loading={guardando}>
              Guardar
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

