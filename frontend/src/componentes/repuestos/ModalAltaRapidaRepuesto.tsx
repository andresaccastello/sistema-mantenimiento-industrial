import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Anchor, Button, Group, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import type { ProveedorOpcion, RepuestoDetalle } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';
import { mensajeError } from '../../lib/errores';
import { ENLACE_ALTA_RAPIDA, UNIDAD_POR_OMISION, cuerpoAltaRapida } from '../../lib/altaRapida';
import { CampoNumero } from '../CampoNumero';

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  /** Con el repuesto creado, después de refrescar las opciones de repuestos. */
  onCreado: (repuesto: RepuestoDetalle) => void;
}

/**
 * MQ1, 4.5: el alta rápida de un repuesto de una sola vez, desde la intervención. Nombre, unidad,
 * costo unitario y proveedor (opcionales); siempre sin control de stock. Usa POST /api/repuestos.
 */
export function ModalAltaRapidaRepuesto({ abierto, onCerrar, onCreado }: Props) {
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState('');
  const [unidad, setUnidad] = useState(UNIDAD_POR_OMISION);
  const [costo, setCosto] = useState<number | string>('');
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [errores, setErrores] = useState<Partial<Record<'nombre' | 'unidad' | 'costo', string>>>({});
  const [guardando, setGuardando] = useState(false);

  const { data: proveedores } = useQuery<ProveedorOpcion[]>({
    queryKey: ['proveedores', 'opciones'],
    queryFn: () => clienteApi.get<ProveedorOpcion[]>('/api/proveedores/opciones'),
    enabled: abierto,
  });

  useEffect(() => {
    if (!abierto) return;
    setNombre('');
    setUnidad(UNIDAD_POR_OMISION);
    setCosto('');
    setProveedorId(null);
    setErrores({});
  }, [abierto]);

  const guardar = async () => {
    const r = cuerpoAltaRapida({ nombre, unidad, costo, proveedorId });
    if (!r.ok) {
      setErrores({ [r.campo]: r.mensaje });
      return;
    }
    setGuardando(true);
    try {
      const creado = await clienteApi.post<RepuestoDetalle>('/api/repuestos', r.cuerpo);
      notifications.show({ message: 'Repuesto creado.', color: 'green', autoClose: 2000 });
      await queryClient.invalidateQueries({ queryKey: ['repuestos'] });
      onCreado(creado);
    } catch (err) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal opened={abierto} onClose={onCerrar} title="Crear repuesto" centered>
      <Stack gap="md">
        <Text size="sm" c="var(--sm-tenue)">
          Un repuesto de una sola vez, sin control de stock.
        </Text>
        <TextInput
          label="Nombre"
          placeholder="Por ejemplo, resorte del balancín"
          maxLength={150}
          required
          value={nombre}
          onChange={(e) => {
            setNombre(e.currentTarget.value);
            setErrores((x) => ({ ...x, nombre: undefined }));
          }}
          error={errores.nombre}
          data-autofocus
        />
        <Group grow align="flex-start">
          <TextInput
            label="Unidad"
            maxLength={20}
            required
            value={unidad}
            onChange={(e) => {
              setUnidad(e.currentTarget.value);
              setErrores((x) => ({ ...x, unidad: undefined }));
            }}
            error={errores.unidad}
          />
          <CampoNumero
            label="Costo unitario"
            placeholder="Opcional"
            prefix="$ "
            decimalScale={2}
            value={costo}
            onChange={(v) => {
              setCosto(v);
              setErrores((x) => ({ ...x, costo: undefined }));
            }}
            error={errores.costo}
          />
        </Group>
        <Select
          label="Proveedor"
          placeholder="Opcional"
          data={(proveedores ?? []).map((p) => ({ value: String(p.id), label: p.nombre }))}
          value={proveedorId}
          onChange={setProveedorId}
          clearable
          searchable
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button color="marca" onClick={guardar} loading={guardando}>
            Crear repuesto
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** MQ1, 4.5: el enlace debajo del selector de repuesto. Solo con REPUESTOS_GESTIONAR. */
export function EnlaceAltaRapida({ onClick }: { onClick: () => void }) {
  const { tienePermiso } = useAuth();
  if (!tienePermiso('REPUESTOS_GESTIONAR')) return null;
  return (
    <Anchor component="button" type="button" size="sm" onClick={onClick} style={{ alignSelf: 'flex-start' }}>
      {ENLACE_ALTA_RAPIDA}
    </Anchor>
  );
}
