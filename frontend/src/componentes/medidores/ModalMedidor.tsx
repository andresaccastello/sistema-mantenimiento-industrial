import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Stack, TextInput, Autocomplete, Group, Button, Alert, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { MedidorDetalle, MedidorLista } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import {
  BorradorMedidor,
  ErroresMedidor,
  UNIDADES_MEDIDOR,
  borradorMedidorVacio,
  cuerpoMedidor,
  validarMedidor,
} from '../../lib/medidores';
import { CampoNumero } from '../CampoNumero';
import { refrescarMedidores } from './refrescar';

interface Props {
  abierto: boolean;
  maquinaId: number;
  /** El que se edita, o null para uno nuevo. */
  medidor: MedidorLista | null;
  onCerrar: () => void;
}

function borradorDe(m: MedidorLista | null): BorradorMedidor {
  return m ? { nombre: m.nombre, unidad: m.unidad, lecturaInicial: '' } : borradorMedidorVacio();
}

/** 3.2 Nuevo medidor y editar medidor. */
export function ModalMedidor({ abierto, maquinaId, medidor, onCerrar }: Props) {
  const queryClient = useQueryClient();
  const [b, setB] = useState<BorradorMedidor>(borradorDe(medidor));
  const [errores, setErrores] = useState<ErroresMedidor>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setB(borradorDe(medidor));
    setErrores({});
    setError(null);
    // Solo al abrir
  }, [abierto]);

  const cambiar = (cambios: Partial<BorradorMedidor>, campo: keyof ErroresMedidor) => {
    setB((actual) => ({ ...actual, ...cambios }));
    setErrores((actual) => ({ ...actual, [campo]: undefined }));
  };

  const guardar = async () => {
    const encontrados = validarMedidor(b);
    setErrores(encontrados);
    setError(null);
    if (Object.keys(encontrados).length > 0) return;

    setGuardando(true);
    try {
      if (medidor) {
        const cambios = cuerpoMedidor(b, borradorDe(medidor));
        if (Object.keys(cambios).length > 0) {
          await clienteApi.patch<MedidorDetalle>(`/api/medidores/${medidor.id}`, cambios);
        }
      } else {
        await clienteApi.post<MedidorDetalle>('/api/medidores', { maquina_id: maquinaId, ...cuerpoMedidor(b) });
      }
      await refrescarMedidores(queryClient);
      notifications.show({ message: medidor ? 'Medidor guardado.' : 'Se creó el medidor.', color: 'green' });
      onCerrar();
    } catch (err) {
      if (err instanceof ApiError && err.codigo === 'MEDIDOR_DUPLICADO') {
        setErrores({ nombre: 'Ya hay un medidor con ese nombre en esta máquina.' });
      } else {
        setError(mensajeError(err));
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal opened={abierto} onClose={() => !guardando && onCerrar()} title={medidor ? 'Editar medidor' : 'Nuevo medidor'}>
      <Stack gap="md">
        <TextInput
          label="Nombre"
          placeholder="Por ejemplo, Horómetro"
          required
          maxLength={60}
          value={b.nombre}
          onChange={(e) => cambiar({ nombre: e.currentTarget.value }, 'nombre')}
          error={errores.nombre}
        />
        <Autocomplete
          label="Unidad"
          placeholder="Elegí o escribí la unidad"
          required
          maxLength={20}
          data={UNIDADES_MEDIDOR}
          value={b.unidad}
          onChange={(v) => cambiar({ unidad: v }, 'unidad')}
          error={errores.unidad}
        />
        {!medidor && (
          <CampoNumero
            label="Lectura inicial"
            placeholder="Opcional"
            decimalScale={2}
            rightSection={
              b.unidad.trim() ? (
                <Text size="xs" c="dimmed" pr="xs">
                  {b.unidad.trim()}
                </Text>
              ) : undefined
            }
            rightSectionWidth={b.unidad.trim() ? 70 : undefined}
            value={b.lecturaInicial}
            onChange={(v) => cambiar({ lecturaInicial: v }, 'lecturaInicial')}
            error={errores.lecturaInicial}
          />
        )}

        {error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button color="marca" onClick={guardar} loading={guardando}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
