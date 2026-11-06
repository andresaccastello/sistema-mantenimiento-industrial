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
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { ProveedorItem } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';

export interface ModalProveedorProps {
  abierto: boolean;
  onCerrar: () => void;
  proveedor?: ProveedorItem | null;
  onExito?: () => void;
}

export function ModalProveedor({
  abierto,
  onCerrar,
  proveedor,
  onExito,
}: ModalProveedorProps) {
  const queryClient = useQueryClient();
  const esEdicion = Boolean(proveedor);

  const [nombre, setNombre] = useState('');
  const [contacto, setContacto] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [notas, setNotas] = useState('');

  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [errorEmail, setErrorEmail] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (abierto) {
      setErrorNombre(null);
      setErrorEmail(null);
      if (proveedor) {
        setNombre(proveedor.nombre);
        setContacto(proveedor.contacto || '');
        setTelefono(proveedor.telefono || '');
        setEmail(proveedor.email || '');
        setNotas(proveedor.notas || '');
      } else {
        setNombre('');
        setContacto('');
        setTelefono('');
        setEmail('');
        setNotas('');
      }
    }
  }, [abierto, proveedor]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorNombre(null);
    setErrorEmail(null);

    const nomTrim = nombre.trim();
    if (!nomTrim) {
      setErrorNombre('El nombre es obligatorio.');
      return;
    }

    setGuardando(true);

    try {
      const payload = {
        nombre: nomTrim,
        contacto: contacto.trim() ? contacto.trim() : null,
        telefono: telefono.trim() ? telefono.trim() : null,
        email: email.trim() ? email.trim() : null,
        notas: notas.trim() ? notas.trim() : null,
      };

      if (esEdicion && proveedor) {
        await clienteApi.put(`/api/proveedores/${proveedor.id}`, payload);
        notifications.show({ message: 'Proveedor actualizado.', color: 'green' });
      } else {
        await clienteApi.post('/api/proveedores', payload);
        notifications.show({ message: 'Proveedor creado.', color: 'green' });
      }

      queryClient.invalidateQueries({ queryKey: ['proveedores'] });
      queryClient.invalidateQueries({ queryKey: ['proveedores', 'opciones'] });
      onCerrar();
      if (onExito) onExito();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.codigo === 'NOMBRE_DUPLICADO') {
          setErrorNombre('Ya existe un proveedor con este nombre.');
          return;
        }
        if (err.codigo === 'EMAIL_INVALIDO') {
          setErrorEmail('Ingresá un correo electrónico válido.');
          return;
        }
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
      title={esEdicion ? 'Editar proveedor' : 'Nuevo proveedor'}
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <TextInput
            label="Nombre"
            placeholder="Ej. Rodamientos Industriales S.A."
            required
            value={nombre}
            onChange={(e) => {
              setNombre(e.currentTarget.value);
              if (errorNombre) setErrorNombre(null);
            }}
            error={errorNombre}
          />

          <TextInput
            label="Persona de contacto"
            placeholder="Ej. Juan Pérez"
            value={contacto}
            onChange={(e) => setContacto(e.currentTarget.value)}
          />

          <Group grow align="flex-start">
            <TextInput
              label="Teléfono"
              placeholder="Ej. +54 11 1234-5678"
              value={telefono}
              onChange={(e) => setTelefono(e.currentTarget.value)}
            />
            <TextInput
              label="Email"
              placeholder="contacto@proveedor.com"
              value={email}
              onChange={(e) => {
                setEmail(e.currentTarget.value);
                if (errorEmail) setErrorEmail(null);
              }}
              error={errorEmail}
            />
          </Group>

          <Textarea
            label="Notas"
            placeholder="Condiciones de entrega, número de cliente, etc."
            rows={3}
            value={notas}
            onChange={(e) => setNotas(e.currentTarget.value)}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" color="marca" loading={guardando}>
              {esEdicion ? 'Guardar cambios' : 'Crear proveedor'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
