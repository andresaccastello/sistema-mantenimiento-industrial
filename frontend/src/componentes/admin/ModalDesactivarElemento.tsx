import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  Text,
  Alert,
  Group,
  Button,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { mensajeError } from '../../lib/errores';

export interface ModalDesactivarElementoProps {
  abierto: boolean;
  onCerrar: () => void;
  tipo: 'sector' | 'planta' | 'criticidad' | 'tipo_equipo' | 'proveedor' | 'repuesto';
  id: number | null;
  nombre: string;
  motivoBloqueo: string | null;
}

export function ModalDesactivarElemento({
  abierto,
  onCerrar,
  tipo,
  id,
  nombre,
  motivoBloqueo,
}: ModalDesactivarElementoProps) {
  const queryClient = useQueryClient();
  const esCelular = useMediaQuery('(max-width: 48em)');
  const [guardando, setGuardando] = useState(false);
  const [errorAlerta, setErrorAlerta] = useState<string | null>(null);

  useEffect(() => {
    if (abierto) {
      setErrorAlerta(null);
    }
  }, [abierto]);

  if (!id) return null;

  const handleDesactivar = async () => {
    setErrorAlerta(null);
    setGuardando(true);

    try {
      if (tipo === 'sector') {
        await clienteApi.put(`/api/sectores/${id}`, { activo: false });
        await queryClient.invalidateQueries({ queryKey: ['sectores'] });
        await queryClient.invalidateQueries({ queryKey: ['plantas'] });
      } else if (tipo === 'planta') {
        await clienteApi.put(`/api/plantas/${id}`, { activo: false });
        await queryClient.invalidateQueries({ queryKey: ['plantas'] });
        await queryClient.invalidateQueries({ queryKey: ['sectores'] });
      } else if (tipo === 'criticidad') {
        await clienteApi.delete(`/api/criticidades/${id}`);
        await queryClient.invalidateQueries({ queryKey: ['criticidades'] });
        await queryClient.invalidateQueries({ queryKey: ['maquinas'] });
      } else if (tipo === 'tipo_equipo') {
        await clienteApi.delete(`/api/tipos-equipo/${id}`);
        await queryClient.invalidateQueries({ queryKey: ['tipos-equipo'] });
        await queryClient.invalidateQueries({ queryKey: ['maquinas'] });
      } else if (tipo === 'proveedor') {
        await clienteApi.delete(`/api/proveedores/${id}`);
        await queryClient.invalidateQueries({ queryKey: ['proveedores'] });
        await queryClient.invalidateQueries({ queryKey: ['proveedores', 'opciones'] });
      } else if (tipo === 'repuesto') {
        await clienteApi.delete(`/api/repuestos/${id}`);
        await queryClient.invalidateQueries({ queryKey: ['repuestos'] });
        await queryClient.invalidateQueries({ queryKey: ['repuesto', id] });
      }

      notifications.show({
        message: `${nombre} fue desactivado.`,
        color: 'green',
      });
      onCerrar();
    } catch (err: any) {
      if (err?.codigo === 'EN_USO' || err?.datos?.codigo === 'EN_USO') {
        const datos = err.datos || err;
        const rep = datos.repuestos_activos ?? 0;
        const ped = datos.pedidos_abiertos ?? 0;
        const partes: string[] = [];
        if (rep > 0) partes.push(`${rep} ${rep === 1 ? 'repuesto activo' : 'repuestos activos'}`);
        if (ped > 0) partes.push(`${ped} ${ped === 1 ? 'pedido abierto' : 'pedidos abiertos'}`);
        const detalle = partes.length > 0 ? ` Lo usan ${partes.join(' y ')}.` : '';
        const msg = `No se puede desactivar.${detalle}`;
        setErrorAlerta(msg);
        return;
      }
      setErrorAlerta(mensajeError(err));
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  const getTitulo = () => {
    if (tipo === 'sector') return 'Desactivar sector';
    if (tipo === 'planta') return 'Desactivar planta';
    if (tipo === 'criticidad') return 'Desactivar criticidad';
    if (tipo === 'tipo_equipo') return 'Desactivar tipo de equipo';
    if (tipo === 'proveedor') return 'Desactivar proveedor';
    return 'Desactivar repuesto';
  };

  const getTextoConfirmacion = () => {
    if (tipo === 'sector') {
      return 'El sector deja de aparecer en las listas. Su historial se conserva.';
    }
    if (tipo === 'planta') {
      return 'La planta deja de aparecer en las listas. Su historial se conserva.';
    }
    if (tipo === 'criticidad') {
      return 'La criticidad deja de aparecer para máquinas nuevas. Su historial se conserva.';
    }
    if (tipo === 'tipo_equipo') {
      return 'El tipo de equipo deja de aparecer para máquinas nuevas. Su historial se conserva.';
    }
    if (tipo === 'proveedor') {
      return 'El proveedor deja de aparecer en las listas de opciones. Su historial se conserva.';
    }
    return 'El repuesto deja de aparecer para nuevas intervenciones. Su historial se conserva.';
  };

  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title={getTitulo()}
      fullScreen={esCelular}
      size="md"
    >
      <Stack gap="md">
        {errorAlerta && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {errorAlerta}
          </Alert>
        )}

        {motivoBloqueo ? (
          <>
            <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
              {motivoBloqueo}
            </Alert>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={onCerrar}>
                Volver
              </Button>
            </Group>
          </>
        ) : (
          <>
            <Text size="sm">
              ¿Estás seguro de que querés desactivar <b>{nombre}</b>?
            </Text>
            <Text size="sm" c="dimmed">
              {getTextoConfirmacion()}
            </Text>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={onCerrar} disabled={guardando}>
                Cancelar
              </Button>
              <Button color="red" onClick={handleDesactivar} loading={guardando}>
                Desactivar
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

