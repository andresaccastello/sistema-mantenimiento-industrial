import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  TextInput,
  Textarea,
  Select,
  Group,
  Button,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { Planta, SectorAdmin } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';

export interface ModalSectorProps {
  abierto: boolean;
  onCerrar: () => void;
  sector?: SectorAdmin | null;
}

export function ModalSector({ abierto, onCerrar, sector }: ModalSectorProps) {
  const esEdicion = Boolean(sector);
  const queryClient = useQueryClient();
  const esCelular = useMediaQuery('(max-width: 48em)');

  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [plantaId, setPlantaId] = useState<string | null>(null);

  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const plantasQuery = useQuery({
    queryKey: ['plantas'],
    queryFn: () => clienteApi.get<Planta[]>('/api/plantas'),
    enabled: abierto,
  });

  useEffect(() => {
    if (abierto) {
      if (sector) {
        setNombre(sector.nombre);
        setDescripcion(sector.descripcion || '');
        setPlantaId(sector.planta ? String(sector.planta.id) : null);
      } else {
        setNombre('');
        setDescripcion('');
        setPlantaId(null);
      }
      setErrorNombre(null);
    }
  }, [abierto, sector]);

  // Options para plantas: activas + inactiva del sector si ya tiene una
  const opcionesPlanta = (() => {
    const activas = plantasQuery.data || [];
    const idsActivas = new Set(activas.map((p) => p.id));
    const items = activas.map((p) => ({
      value: String(p.id),
      label: p.nombre,
    }));

    if (sector?.planta && !idsActivas.has(sector.planta.id)) {
      items.push({
        value: String(sector.planta.id),
        label: `${sector.planta.nombre} (inactiva)`,
      });
    }

    return items;
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorNombre(null);

    const nomTrim = nombre.trim();
    if (!nomTrim) {
      setErrorNombre('El nombre del sector es obligatorio.');
      return;
    }

    const descTrim = descripcion.trim();
    const pid = plantaId ? Number(plantaId) : null;

    setGuardando(true);
    try {
      if (esEdicion && sector) {
        // Enviar solo lo que cambió
        const patchBody: Record<string, any> = {};

        if (nomTrim !== sector.nombre) {
          patchBody.nombre = nomTrim;
        }

        const antDesc = (sector.descripcion || '').trim();
        if (descTrim !== antDesc) {
          patchBody.descripcion = descTrim || null;
        }

        const antPid = sector.planta ? sector.planta.id : null;
        if (pid !== antPid) {
          patchBody.planta_id = pid;
        }

        if (Object.keys(patchBody).length === 0) {
          notifications.show({ message: 'No hay cambios para guardar.', color: 'gray' });
          onCerrar();
          return;
        }

        await clienteApi.put(`/api/sectores/${sector.id}`, patchBody);
        notifications.show({ message: 'Sector guardado.', color: 'green' });
      } else {
        await clienteApi.post('/api/sectores', {
          nombre: nomTrim,
          descripcion: descTrim || null,
          planta_id: pid,
        });
        notifications.show({ message: 'Sector creado.', color: 'green' });
      }

      await queryClient.invalidateQueries({ queryKey: ['sectores'] });
      await queryClient.invalidateQueries({ queryKey: ['plantas'] });
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
      title={esEdicion ? 'Editar sector' : 'Nuevo sector'}
      fullScreen={esCelular}
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Nombre"
            placeholder="Ej: Mecánica"
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

          <Select
            label="Planta"
            placeholder="Seleccionar planta"
            data={opcionesPlanta}
            value={plantaId}
            onChange={setPlantaId}
            clearable
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

