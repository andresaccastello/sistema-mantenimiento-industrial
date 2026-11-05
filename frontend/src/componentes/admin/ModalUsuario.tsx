import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  TextInput,
  PasswordInput,
  Select,
  MultiSelect,
  Group,
  Button,
  Text,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import {
  PerfilDetalle,
  SectorLista,
  UsuarioDetalleAdmin,
} from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { nombrePerfil } from '../../lib/perfiles';
import { perfilAsignable } from '../../lib/permisos';
import { validarPasswordTemporal } from '../../lib/usuarios';
import { ApiError, mensajeError } from '../../lib/errores';
import {
  normalizarEmail,
  validarEmail,
  normalizarTelefono,
  validarTelefono,
} from '../../lib/contacto';

export interface ModalUsuarioProps {
  abierto: boolean;
  onCerrar: () => void;
  usuario?: UsuarioDetalleAdmin | null;
}

export function ModalUsuario({ abierto, onCerrar, usuario }: ModalUsuarioProps) {
  const esEdicion = Boolean(usuario);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { usuario: actor } = useAuth();
  const esCelular = useMediaQuery('(max-width: 48em)');

  // Form states
  const [legajo, setLegajo] = useState('');
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [perfilId, setPerfilId] = useState<string | null>(null);
  const [sectoresIds, setSectoresIds] = useState<string[]>([]);
  const [passwordTemporal, setPasswordTemporal] = useState('');

  // Error states
  const [errorLegajo, setErrorLegajo] = useState<string | null>(null);
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [errorEmail, setErrorEmail] = useState<string | null>(null);
  const [errorTelefono, setErrorTelefono] = useState<string | null>(null);
  const [errorPerfil, setErrorPerfil] = useState<string | null>(null);
  const [errorPassword, setErrorPassword] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Queries
  const perfilesQuery = useQuery({
    queryKey: ['perfiles'],
    queryFn: () => clienteApi.get<PerfilDetalle[]>('/api/perfiles'),
    enabled: abierto,
  });

  const sectoresQuery = useQuery({
    queryKey: ['sectores'],
    queryFn: () => clienteApi.get<SectorLista[]>('/api/sectores'),
    enabled: abierto,
  });

  useEffect(() => {
    if (abierto) {
      if (usuario) {
        setLegajo(usuario.legajo);
        setNombre(usuario.nombre);
        setApellido(usuario.apellido || '');
        setEmail(usuario.email || '');
        setTelefono(usuario.telefono_whatsapp || '');
        setPerfilId(usuario.perfil ? String(usuario.perfil.id) : null);
        setSectoresIds(Array.isArray(usuario.sectores) ? usuario.sectores.map((s) => String(s.id)) : []);
        setPasswordTemporal('');
      } else {
        setLegajo('');
        setNombre('');
        setApellido('');
        setEmail('');
        setTelefono('');
        setPerfilId(null);
        setSectoresIds([]);
        setPasswordTemporal('');
      }
      setErrorLegajo(null);
      setErrorNombre(null);
      setErrorEmail(null);
      setErrorTelefono(null);
      setErrorPerfil(null);
      setErrorPassword(null);
    }
  }, [abierto, usuario]);

  // Options para Perfiles
  const opcionesPerfil = (perfilesQuery.data || []).map((p) => {
    const asignable = perfilAsignable(p.permisos || [], actor?.permisos);
    const esElActual = usuario && usuario.perfil && usuario.perfil.id === p.id;
    const disabled = !asignable && !esElActual;

    return {
      value: String(p.id),
      label: nombrePerfil(p.nombre),
      disabled,
      description: disabled ? 'Tiene permisos que vos no tenés.' : undefined,
    };
  });

  // Options para Sectores (activos + inactivos que el usuario ya tenga)
  const opcionesSector = (() => {
    const activos = sectoresQuery.data || [];
    const idsActivos = new Set(activos.map((s) => s.id));
    const items = activos.map((s) => ({
      value: String(s.id),
      label: s.nombre,
    }));

    // Si en edición el usuario tiene un sector inactivo, lo incluimos con "(inactivo)"
    if (usuario && Array.isArray(usuario.sectores)) {
      for (const s of usuario.sectores) {
        if (!idsActivos.has(s.id)) {
          items.push({
            value: String(s.id),
            label: `${s.nombre} (inactivo)`,
          });
        }
      }
    }

    return items;
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorLegajo(null);
    setErrorNombre(null);
    setErrorEmail(null);
    setErrorTelefono(null);
    setErrorPerfil(null);
    setErrorPassword(null);

    const legajoTrim = legajo.trim();
    const nombreTrim = nombre.trim();
    const apellidoTrim = apellido.trim();
    const emailNorm = normalizarEmail(email);
    const telNorm = normalizarTelefono(telefono);

    if (!esEdicion && !legajoTrim) {
      setErrorLegajo('El legajo es obligatorio.');
      return;
    }

    if (!nombreTrim) {
      setErrorNombre('El nombre es obligatorio.');
      return;
    }

    if (!perfilId) {
      setErrorPerfil('El perfil es obligatorio.');
      return;
    }

    const errEmail = validarEmail(emailNorm);
    if (errEmail) {
      setErrorEmail(errEmail);
      return;
    }

    const errTel = validarTelefono(telNorm);
    if (errTel) {
      setErrorTelefono(errTel);
      return;
    }

    if (!esEdicion) {
      const errPass = validarPasswordTemporal(passwordTemporal, legajoTrim);
      if (errPass) {
        setErrorPassword(errPass);
        return;
      }
    }

    setGuardando(true);

    try {
      if (esEdicion && usuario) {
        // PATCH solo con lo que cambió
        const patchBody: Record<string, any> = {};

        if (nombreTrim !== usuario.nombre) {
          patchBody.nombre = nombreTrim;
        }

        const antApellido = (usuario.apellido || '').trim();
        if (apellidoTrim !== antApellido) {
          patchBody.apellido = apellidoTrim || null;
        }

        const antEmail = normalizarEmail(usuario.email);
        if (emailNorm !== antEmail) {
          patchBody.email = emailNorm ?? '';
        }

        const antTel = normalizarTelefono(usuario.telefono_whatsapp);
        if (telNorm !== antTel) {
          patchBody.telefono_whatsapp = telNorm ?? '';
        }

        const nuevoPerfilNum = Number(perfilId);
        if (usuario.perfil.id !== nuevoPerfilNum) {
          patchBody.perfil_id = nuevoPerfilNum;
        }

        const antSecIds = (usuario.sectores || []).map((s) => s.id).sort();
        const nuevosSecIds = sectoresIds.map(Number).sort();
        const sectoresCambiaron =
          antSecIds.length !== nuevosSecIds.length ||
          antSecIds.some((id, idx) => id !== nuevosSecIds[idx]);

        if (sectoresCambiaron) {
          patchBody.sectores = nuevosSecIds;
        }

        if (Object.keys(patchBody).length === 0) {
          notifications.show({ message: 'No hay cambios para guardar.', color: 'gray' });
          onCerrar();
          return;
        }

        await clienteApi.patch(`/api/usuarios/${usuario.id}`, patchBody);

        notifications.show({ message: 'Cambios guardados.', color: 'green' });
        await queryClient.invalidateQueries({ queryKey: ['usuarios'] });
        await queryClient.invalidateQueries({ queryKey: ['usuario', usuario.id] });
        await queryClient.invalidateQueries({ queryKey: ['perfiles'] });
        onCerrar();
      } else {
        // Alta POST
        const res = await clienteApi.post<UsuarioDetalleAdmin>('/api/usuarios', {
          legajo: legajoTrim,
          nombre: nombreTrim,
          apellido: apellidoTrim || null,
          email: emailNorm,
          telefono_whatsapp: telNorm,
          perfil_id: Number(perfilId),
          sectores: sectoresIds.map(Number),
          password_temporal: passwordTemporal,
        });

        notifications.show({
          message: 'Usuario creado. Pasale la contraseña temporal.',
          color: 'green',
        });

        await queryClient.invalidateQueries({ queryKey: ['usuarios'] });
        await queryClient.invalidateQueries({ queryKey: ['perfiles'] });
        onCerrar();
        navigate(`/usuarios/${res.id}`);
      }
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.codigo === 'LEGAJO_DUPLICADO') {
          setErrorLegajo(mensajeError(err));
          return;
        }
        if (err.codigo === 'PASSWORD_INVALIDA') {
          setErrorPassword(mensajeError(err));
          return;
        }
        if (err.codigo === 'EMAIL_INVALIDO') {
          setErrorEmail(mensajeError(err));
          return;
        }
        if (err.codigo === 'TELEFONO_INVALIDO') {
          setErrorTelefono(mensajeError(err));
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
      title={esEdicion ? 'Editar usuario' : 'Nuevo usuario'}
      fullScreen={esCelular}
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Legajo"
            placeholder="Ej: LEG-001"
            value={legajo}
            onChange={(e) => setLegajo(e.currentTarget.value)}
            disabled={esEdicion}
            required={!esEdicion}
            error={errorLegajo}
          />

          <TextInput
            label="Nombre"
            placeholder="Ej: Juan"
            value={nombre}
            onChange={(e) => setNombre(e.currentTarget.value)}
            required
            error={errorNombre}
          />

          <TextInput
            label="Apellido"
            placeholder="Ej: Pérez"
            value={apellido}
            onChange={(e) => setApellido(e.currentTarget.value)}
          />

          <TextInput
            label="Email"
            placeholder="ejemplo@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            error={errorEmail}
          />

          <div>
            <TextInput
              label="WhatsApp"
              placeholder="+54 9 11 1234-5678"
              value={telefono}
              onChange={(e) => setTelefono(e.currentTarget.value)}
              error={errorTelefono}
            />
            <Text size="xs" c="dimmed" mt={4}>
              Con código de país, por ejemplo +54 9 11 1234-5678.
            </Text>
          </div>

          <Select
            label="Perfil"
            placeholder="Seleccionar perfil"
            data={opcionesPerfil}
            value={perfilId}
            onChange={setPerfilId}
            required
            error={errorPerfil}
          />

          <MultiSelect
            label="Sectores"
            placeholder="Seleccionar sectores"
            data={opcionesSector}
            value={sectoresIds}
            onChange={setSectoresIds}
            clearable
            searchable
          />

          {!esEdicion && (
            <div>
              <PasswordInput
                label="Contraseña temporal"
                placeholder="Al menos 8 caracteres"
                value={passwordTemporal}
                onChange={(e) => setPasswordTemporal(e.currentTarget.value)}
                required
                error={errorPassword}
              />
              <Text size="xs" c="dimmed" mt={4}>
                La persona la cambia la primera vez que entra.
              </Text>
            </div>
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

