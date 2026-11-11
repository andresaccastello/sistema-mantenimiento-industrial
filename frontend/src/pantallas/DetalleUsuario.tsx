import { useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Stack,
  Group,
  Title,
  Text,
  Button,
  Paper,
  Table,
  Badge,
  Skeleton,
  Alert,
  Menu,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconDotsVertical,
  IconChevronDown,
  IconEdit,
  IconKey,
  IconUserOff,
  IconUserCheck,
  IconAlertCircle,
  IconInfoCircle,
} from '@tabler/icons-react';
import { clienteApi } from '../api/cliente';
import {
  PerfilDetalle,
  PermisoCatalogo,
  SectorLista,
  UsuarioAuditoriaResponse,
  UsuarioDetalleAdmin,
} from '../api/tipos';
import { useAuth } from '../auth/AuthContext';
import { nombreCompleto } from '../lib/personas';
import { nombrePerfil } from '../lib/perfiles';
import { formatFechaHora } from '../lib/formato';
import { filasPermisos } from '../lib/permisos';
import { mensajeError } from '../lib/errores';
import { ModalUsuario } from '../componentes/admin/ModalUsuario';
import { ModalRestablecerPassword } from '../componentes/admin/ModalRestablecerPassword';
import { ModalDesactivarUsuario } from '../componentes/admin/ModalDesactivarUsuario';
import { ModalReactivarUsuario } from '../componentes/admin/ModalReactivarUsuario';
import { ModalExcepcion } from '../componentes/admin/ModalExcepcion';
import { ModalEliminarExcepcion } from '../componentes/admin/ModalEliminarExcepcion';
import { BloquePermisosUsuario } from '../componentes/admin/BloquePermisosUsuario';
import { BloqueHistorialUsuario } from '../componentes/admin/BloqueHistorialUsuario';

export function DetalleUsuario() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { usuario: actor } = useAuth();

  const usuarioId = Number(id);
  const volverA = (location.state as any)?.volverA || '/usuarios';

  // Modales
  const [modalEditarAbierto, setModalEditarAbierto] = useState(false);
  const [modalPassAbierto, setModalPassAbierto] = useState(false);
  const [modalDesactivarAbierto, setModalDesactivarAbierto] = useState(false);
  const [modalReactivarAbierto, setModalReactivarAbierto] = useState(false);

  // Excepciones
  const [permisoParaExcepcion, setPermisoParaExcepcion] = useState<PermisoCatalogo | null>(null);
  const [modalExcepcionAbierto, setModalExcepcionAbierto] = useState(false);
  const [modalEliminarExcepcionAbierto, setModalEliminarExcepcionAbierto] = useState(false);

  // Historial limit
  const [limiteAuditoria, setLimiteAuditoria] = useState(20);

  // Consultas
  const usuarioQuery = useQuery({
    queryKey: ['usuario', usuarioId],
    queryFn: () => clienteApi.get<UsuarioDetalleAdmin>(`/api/usuarios/${usuarioId}`),
    enabled: !isNaN(usuarioId) && usuarioId > 0,
  });

  const perfilesQuery = useQuery({
    queryKey: ['perfiles'],
    queryFn: () => clienteApi.get<PerfilDetalle[]>('/api/perfiles'),
  });

  const permisosQuery = useQuery({
    queryKey: ['permisos'],
    queryFn: () => clienteApi.get<PermisoCatalogo[]>('/api/permisos'),
  });

  const sectoresQuery = useQuery({
    queryKey: ['sectores'],
    queryFn: () => clienteApi.get<SectorLista[]>('/api/sectores'),
  });

  const auditoriaQuery = useQuery({
    queryKey: ['usuario', usuarioId, 'auditoria', limiteAuditoria],
    queryFn: () =>
      clienteApi.get<UsuarioAuditoriaResponse>(`/api/usuarios/${usuarioId}/auditoria?limit=${limiteAuditoria}`),
    enabled: !isNaN(usuarioId) && usuarioId > 0,
  });

  if (usuarioQuery.isLoading) {
    return (
      <Stack gap="md">
        <Skeleton height={30} width={120} />
        <Skeleton height={50} />
        <Skeleton height={150} />
        <Skeleton height={200} />
      </Stack>
    );
  }

  if (usuarioQuery.isError || !usuarioQuery.data) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={16} />}>
        {usuarioQuery.error ? mensajeError(usuarioQuery.error) : 'No encontramos ese usuario.'}
      </Alert>
    );
  }

  const usuario = usuarioQuery.data;
  const esElPropioUsuario = actor?.id === usuario.id;

  // Perfil completo del usuario
  const perfilDetalle = (perfilesQuery.data || []).find((p) => p.id === usuario.perfil?.id);
  const permisosPerfil = perfilDetalle?.permisos || [];

  // Filas de permisos
  const catalogoPermisos = permisosQuery.data || [];
  const filas = filasPermisos(
    catalogoPermisos,
    permisosPerfil,
    usuario.excepciones || [],
    usuario.permisos || {}
  );

  // Referencias para auditoría
  const referenciasAuditoria = {
    perfiles: (perfilesQuery.data || []).reduce<Record<string, string>>((acc, p) => {
      acc[String(p.id)] = p.nombre;
      return acc;
    }, {}),
    sectores: (sectoresQuery.data || []).reduce<Record<string, string>>((acc, s) => {
      acc[String(s.id)] = s.nombre;
      return acc;
    }, {}),
  };

  const auditoriaData = auditoriaQuery.data;
  const totalAuditoria = auditoriaData?.total ?? 0;
  const registrosAuditoria = auditoriaData?.registros ?? [];

  return (
    <Stack gap="lg">
      {/* Botón volver */}
      <div>
        <Button
          variant="subtle"
          color="gray"
          leftSection={<IconArrowLeft size={16} />}
          onClick={() => navigate(volverA)}
        >
          Usuarios
        </Button>
      </div>

      {/* Alerta si es sobre uno mismo */}
      {esElPropioUsuario && (
        <Alert color="blue" icon={<IconInfoCircle size={16} />}>
          Este es tu usuario. Tus datos y permisos los cambia otro administrador. Tu contraseña, desde{' '}
          <Link to="/mi-cuenta" style={{ fontWeight: 600, color: 'inherit' }}>
            Mi cuenta
          </Link>
          .
        </Alert>
      )}

      {/* Cabecera */}
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{nombreCompleto(usuario)}</Title>
          <Group gap="xs" mt={4}>
            <Text size="sm" c="dimmed">
              {usuario.legajo} · {nombrePerfil(usuario.perfil.nombre)}
            </Text>
            {!usuario.activo && (
              <Badge color="gray" size="sm" variant="outline">
                Inactivo
              </Badge>
            )}
            {usuario.debe_cambiar_password && (
              <Badge color="yellow" size="sm" variant="light">
                Debe cambiar la contraseña
              </Badge>
            )}
          </Group>
        </div>

        {/* Acciones si no es uno mismo */}
        {!esElPropioUsuario && (
          <Group gap="xs">
            <Button
              leftSection={<IconEdit size={16} />}
              onClick={() => setModalEditarAbierto(true)}
            >
              Editar
            </Button>

            <Menu shadow="md" width={200} position="bottom-end">
              <Menu.Target>
                <Button
                  variant="default"
                  rightSection={<IconChevronDown size={16} />}
                >
                  Más acciones
                </Button>
              </Menu.Target>

              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconKey size={14} />}
                  onClick={() => setModalPassAbierto(true)}
                >
                  Restablecer contraseña
                </Menu.Item>
                {usuario.activo ? (
                  <Menu.Item
                    color="red"
                    leftSection={<IconUserOff size={14} />}
                    onClick={() => setModalDesactivarAbierto(true)}
                  >
                    Desactivar
                  </Menu.Item>
                ) : (
                  <Menu.Item
                    leftSection={<IconUserCheck size={14} />}
                    onClick={() => setModalReactivarAbierto(true)}
                  >
                    Reactivar
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          </Group>
        )}
      </Group>

      {/* Bloque Datos */}
      <Paper withBorder p="md" radius="sm">
        <Title order={4} mb="md">
          Datos
        </Title>
        <Table verticalSpacing="xs">
          <Table.Tbody>
            <Table.Tr>
              <Table.Td w={180} c="dimmed">
                Nombre y apellido
              </Table.Td>
              <Table.Td>{nombreCompleto(usuario)}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td c="dimmed">Legajo</Table.Td>
              <Table.Td>{usuario.legajo}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td c="dimmed">Email</Table.Td>
              <Table.Td>{usuario.email || '—'}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td c="dimmed">WhatsApp</Table.Td>
              <Table.Td>{usuario.telefono_whatsapp || '—'}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td c="dimmed">Perfil</Table.Td>
              <Table.Td>{nombrePerfil(usuario.perfil.nombre)}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td c="dimmed">Sectores</Table.Td>
              <Table.Td>
                {Array.isArray(usuario.sectores) && usuario.sectores.length > 0
                  ? usuario.sectores.map((s) => s.nombre).join(', ')
                  : '—'}
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td c="dimmed">Último acceso</Table.Td>
              <Table.Td>
                {usuario.ultimo_acceso_en ? formatFechaHora(usuario.ultimo_acceso_en) : 'Nunca'}
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td c="dimmed">Alta</Table.Td>
              <Table.Td>{formatFechaHora(usuario.creado_en)}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td c="dimmed">Última modificación</Table.Td>
              <Table.Td>
                {usuario.actualizado_en ? formatFechaHora(usuario.actualizado_en) : '—'}
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Paper>

      {/* Bloque Permisos */}
      <BloquePermisosUsuario
        filas={filas}
        usuario={usuario}
        onEditarExcepcion={(permiso) => {
          setPermisoParaExcepcion(permiso);
          setModalExcepcionAbierto(true);
        }}
        onEliminarExcepcion={(permiso) => {
          setPermisoParaExcepcion(permiso);
          setModalEliminarExcepcionAbierto(true);
        }}
      />

      {/* Bloque Historial */}
      <BloqueHistorialUsuario
        registros={registrosAuditoria}
        total={totalAuditoria}
        limite={limiteAuditoria}
        onVerMas={() => setLimiteAuditoria((l) => Math.min(l + 20, 200))}
        referencias={referenciasAuditoria}
        catalogo={catalogoPermisos}
      />

      {/* Modales */}
      <ModalUsuario
        abierto={modalEditarAbierto}
        onCerrar={() => setModalEditarAbierto(false)}
        usuario={usuario}
      />

      <ModalRestablecerPassword
        abierto={modalPassAbierto}
        onCerrar={() => setModalPassAbierto(false)}
        usuario={usuario}
      />

      <ModalDesactivarUsuario
        abierto={modalDesactivarAbierto}
        onCerrar={() => setModalDesactivarAbierto(false)}
        usuario={usuario}
      />

      <ModalReactivarUsuario
        abierto={modalReactivarAbierto}
        onCerrar={() => setModalReactivarAbierto(false)}
        usuario={usuario}
      />

      <ModalExcepcion
        abierto={modalExcepcionAbierto}
        onCerrar={() => {
          setModalExcepcionAbierto(false);
          setPermisoParaExcepcion(null);
        }}
        usuario={usuario}
        permiso={permisoParaExcepcion}
        excepcionExistente={
          permisoParaExcepcion
            ? (usuario.excepciones || []).find((e) => e.codigo === permisoParaExcepcion.codigo)
            : null
        }
      />

      <ModalEliminarExcepcion
        abierto={modalEliminarExcepcionAbierto}
        onCerrar={() => {
          setModalEliminarExcepcionAbierto(false);
          setPermisoParaExcepcion(null);
        }}
        usuario={usuario}
        permiso={permisoParaExcepcion}
      />
    </Stack>
  );
}
