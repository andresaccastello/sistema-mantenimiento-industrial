import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Anchor, Badge, Loader, Modal, Popover, Stack, Text, UnstyledButton } from '@mantine/core';
import { clienteApi } from '../../api/cliente';
import type { FichaProveedorDatos } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { mensajeError } from '../../lib/errores';
import { useEsCelular } from '../../lib/useEsCelular';

/** Los permisos de /api/proveedores/opciones, que también dan la ficha (MQ1, 3). */
const PERMISOS_FICHA = ['REPUESTOS_GESTIONAR', 'INTERVENCIONES_CAMBIAR_ESTADO', 'COSTOS_REGISTRAR', 'PLANES_GESTIONAR'];

interface Props {
  proveedor: { id: number; nombre: string };
  size?: 'xs' | 'sm';
  fw?: number;
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="var(--sm-tenue)">
        {etiqueta}
      </Text>
      <Text size="sm" c="var(--sm-texto)" style={{ overflowWrap: 'anywhere' }}>
        {children}
      </Text>
    </Stack>
  );
}

function Contenido({ id }: { id: number }) {
  const { data, isPending, isError, error } = useQuery<FichaProveedorDatos>({
    queryKey: ['proveedores', id, 'ficha'],
    queryFn: () => clienteApi.get<FichaProveedorDatos>(`/api/proveedores/${id}/ficha`),
  });
  if (isPending) return <Loader size="sm" color="marca" />;
  if (isError || !data) {
    return (
      <Text size="sm" c="var(--sm-peligro)">
        {mensajeError(error)}
      </Text>
    );
  }
  return (
    <Stack gap="xs">
      <Text fw={600} c="var(--sm-titulo)" style={{ overflowWrap: 'anywhere' }}>
        {data.nombre}
      </Text>
      {!data.activo && (
        <Badge variant="outline" color="gray" size="sm">
          Inactivo
        </Badge>
      )}
      <Dato etiqueta="Código en SAE">{data.codigo_externo || '—'}</Dato>
      <Dato etiqueta="Contacto">{data.contacto || '—'}</Dato>
      <Dato etiqueta="Teléfono">
        {data.telefono ? <Anchor href={`tel:${data.telefono.replace(/[^\d+]/g, '')}`}>{data.telefono}</Anchor> : '—'}
      </Dato>
      <Dato etiqueta="Email">{data.email ? <Anchor href={`mailto:${data.email}`}>{data.email}</Anchor> : '—'}</Dato>
      {data.notas && <Dato etiqueta="Notas">{data.notas}</Dato>}
    </Stack>
  );
}

/**
 * MQ1, 4.4: el nombre de un proveedor que abre su ficha: un Popover, o un modal en el celular.
 * Sin ninguno de los permisos de la ficha, el nombre solo.
 */
export function FichaProveedor({ proveedor, size = 'sm', fw }: Props) {
  const { tienePermiso } = useAuth();
  const esCelular = useEsCelular();
  const [abierta, setAbierta] = useState(false);
  const puede = PERMISOS_FICHA.some((p) => tienePermiso(p));

  if (!puede) {
    return (
      <Text component="span" size={size} fw={fw} inherit={false}>
        {proveedor.nombre}
      </Text>
    );
  }

  const disparador = (
    <UnstyledButton
      onClick={(e) => {
        e.stopPropagation();
        setAbierta((v) => !v);
      }}
      aria-label={`Ver la ficha de ${proveedor.nombre}`}
      style={{ display: 'inline', textAlign: 'left' }}
    >
      <Text component="span" size={size} fw={fw} c="var(--sm-info)" td="underline" style={{ overflowWrap: 'anywhere' }}>
        {proveedor.nombre}
      </Text>
    </UnstyledButton>
  );

  if (esCelular) {
    return (
      <>
        {disparador}
        <Modal opened={abierta} onClose={() => setAbierta(false)} title="Proveedor" centered>
          {abierta && <Contenido id={proveedor.id} />}
        </Modal>
      </>
    );
  }

  return (
    <Popover opened={abierta} onChange={setAbierta} width={300} position="bottom-start" withArrow shadow="md">
      <Popover.Target>{disparador}</Popover.Target>
      <Popover.Dropdown onClick={(e) => e.stopPropagation()}>{abierta && <Contenido id={proveedor.id} />}</Popover.Dropdown>
    </Popover>
  );
}
