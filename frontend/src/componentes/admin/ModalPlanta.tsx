import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  TextInput,
  Textarea,
  Group,
  Button,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { PlantaAdmin } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';

export interface ModalPlantaProps {
  abierto: boolean;
  onCerrar: () => void;
  planta?: PlantaAdmin | null;
}

export function ModalPlanta({ abierto, onCerrar, planta }: ModalPlantaProps) {
  const esEdicion = Boolean(planta);
  const queryClient = useQueryClient();
  const esCelular = useMediaQuery('(max-width: 48em)');

  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (abierto) {
      if (planta) {
        setNombre(planta.nombre);
        setDescripcion(planta.descripcion || '');
      } else {
        setNombre('');
        setDescripcion('');
      }
      setErrorNombre(null);
    }
  }, [abierto, planta]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorNombre(null);

    const nomTrim = nombre.trim();
    if (!nomTrim) {
      setErrorNombre('El nombre de la planta es obligatorio.');
      return;
    }

    const descTrim = descripcion.trim();

    setGuardando(true);
    try {
      if (esEdicion && planta) {
        const patchBody: Record<string, any> = {};
        if (nomTrim !== planta.nombre) {
          patchBody.nombre = nomTrim;
        }
        const antDesc = (planta.descripcion || '').trim();
        if (descTrim !== antDesc) {
          patchBody.descripcion = descTrim || null;
        }

        if (Object.keys(patchBody).length === 0) {
          notifications.show({ message: 'No hay cambios para guardar.', color: 'gray' });
          onCerrar();
          return;
        }

        await clienteApi.put(`/api/plantas/${planta.id}`, patchBody);
        notifications.show({ message: 'Planta guardada.', color: 'green' });
      } else {
        await clienteApi.post('/api/plantas', {
          nombre: nomTrim,
          descripcion: descTrim || null,
        });
        notifications.show({ message: 'Planta creada.', color: 'green' });
      }

      await queryClient.invalidateQueries({ queryKey: ['plantas'] });
      await queryClient.invalidateQueries({ queryKey: ['sectores'] });
      onCerrar();
    } catch (err: any) {
      if (err instanceof ApiError && err.codigo === 'NOMBRE_DUPLICADO') {
        setErrorNombre(mensajeError(err));
        return;
      }
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title={esEdicion ? 'Editar planta' : 'Nueva planta'}
      fullScreen={esCelular}
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Nombre"
            placeholder="Ej: Planta Principal"
            value={nombre}
            onChange={(e) => setNombre(e.currentTarget.value)}
            required
            error={errorNombre}
          />

          <Textarea
            label="Descripción"
            placeholder="Descripción opcional"
            value={descripcion}
            onChange={(e) => setDescripcion(e.currentTarget.value)}
            minRows={2}
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

