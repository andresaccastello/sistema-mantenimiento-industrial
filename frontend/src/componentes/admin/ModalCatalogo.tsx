import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  TextInput,
  Switch,
  Group,
  Button,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { CriticidadAdmin, TipoEquipoAdmin } from '../../api/tipos';
import { codigoDesdeNombre, codigoValido } from '../../lib/catalogos';
import { ApiError, mensajeError } from '../../lib/errores';

export interface ModalCatalogoProps {
  abierto: boolean;
  onCerrar: () => void;
  entidad: 'criticidad' | 'tipo';
  item?: CriticidadAdmin | TipoEquipoAdmin | null;
}

export function ModalCatalogo({
  abierto,
  onCerrar,
  entidad,
  item,
}: ModalCatalogoProps) {
  const esEdicion = Boolean(item);
  const queryClient = useQueryClient();
  const esCelular = useMediaQuery('(max-width: 48em)');

  const esCriticidad = entidad === 'criticidad';
  const basePath = esCriticidad ? '/api/criticidades' : '/api/tipos-equipo';
  const cacheKey = esCriticidad ? 'criticidades' : 'tipos-equipo';

  const [nombre, setNombre] = useState('');
  const [codigo, setCodigo] = useState('');
  const [codigoEditadoManualmente, setCodigoEditadoManualmente] = useState(false);
  const [prioridadAlta, setPrioridadAlta] = useState(false);

  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (abierto) {
      if (item) {
        setNombre(item.nombre);
        setCodigo(item.codigo);
        setCodigoEditadoManualmente(true);
        if (esCriticidad && 'prioridad_alta' in item) {
          setPrioridadAlta(Boolean(item.prioridad_alta));
        } else {
          setPrioridadAlta(false);
        }
      } else {
        setNombre('');
        setCodigo('');
        setCodigoEditadoManualmente(false);
        setPrioridadAlta(false);
      }
      setErrorNombre(null);
      setErrorCodigo(null);
    }
  }, [abierto, item, esCriticidad]);

  const handleNombreChange = (val: string) => {
    setNombre(val);
    if (!esEdicion && !codigoEditadoManualmente) {
      setCodigo(codigoDesdeNombre(val));
    }
  };

  const handleCodigoChange = (val: string) => {
    setCodigo(val);
    setCodigoEditadoManualmente(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorNombre(null);
    setErrorCodigo(null);

    const nomTrim = nombre.trim();
    if (!nomTrim) {
      setErrorNombre('El nombre es obligatorio.');
      return;
    }

    const codTrim = codigo.trim();
    if (!esEdicion) {
      if (!codTrim) {
        setErrorCodigo('El código es obligatorio.');
        return;
      }
      if (!codigoValido(codTrim)) {
        setErrorCodigo('El código debe empezar con letra mayúscula y tener hasta 30 caracteres alfanuméricos en mayúsculas o guión bajo.');
        return;
      }
    }

    setGuardando(true);
    try {
      if (esEdicion && item) {
        const patchBody: Record<string, any> = {};

        if (nomTrim !== item.nombre) {
          patchBody.nombre = nomTrim;
        }

        if (esCriticidad && 'prioridad_alta' in item) {
          if (prioridadAlta !== Boolean(item.prioridad_alta)) {
            patchBody.prioridad_alta = prioridadAlta;
          }
        }

        if (Object.keys(patchBody).length === 0) {
          notifications.show({ message: 'No hay cambios para guardar.', color: 'gray' });
          onCerrar();
          return;
        }

        await clienteApi.put(`${basePath}/${item.id}`, patchBody);
        notifications.show({
          message: `${esCriticidad ? 'Criticidad' : 'Tipo de equipo'} guardado.`,
          color: 'green',
        });
      } else {
        const payload: Record<string, any> = {
          codigo: codTrim,
          nombre: nomTrim,
        };
        if (esCriticidad) {
          payload.prioridad_alta = prioridadAlta;
        }

        await clienteApi.post(basePath, payload);
        notifications.show({
          message: `${esCriticidad ? 'Criticidad' : 'Tipo de equipo'} creado.`,
          color: 'green',
        });
      }

      await queryClient.invalidateQueries({ queryKey: [cacheKey] });
      await queryClient.invalidateQueries({ queryKey: ['maquinas'] });
      onCerrar();
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.codigo === 'CODIGO_DUPLICADO') {
          setErrorCodigo(mensajeError(err));
          return;
        }
        if (err.codigo === 'NOMBRE_DUPLICADO') {
          setErrorNombre(mensajeError(err));
          return;
        }
      }
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  const tituloModal = esEdicion
    ? `Editar ${esCriticidad ? 'criticidad' : 'tipo de equipo'}`
    : `Nueva ${esCriticidad ? 'criticidad' : 'tipo de equipo'}`;

  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title={tituloModal}
      fullScreen={esCelular}
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Nombre"
            placeholder={esCriticidad ? 'Ej: Alta' : 'Ej: Torno'}
            value={nombre}
            onChange={(e) => handleNombreChange(e.currentTarget.value)}
            required
            error={errorNombre}
          />

          <TextInput
            label="Código"
            placeholder="Ej: ALTA"
            value={codigo}
            onChange={(e) => handleCodigoChange(e.currentTarget.value)}
            disabled={esEdicion}
            required={!esEdicion}
            error={errorCodigo}
          />

          {esCriticidad && (
            <Switch
              label="Prioridad alta"
              description="Una falla en una máquina con esta criticidad avisa con prioridad alta, aunque no la haya detenido."
              checked={prioridadAlta}
              onChange={(e) => setPrioridadAlta(e.currentTarget.checked)}
            />
          )}

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

