import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Stack, Text, TextInput, Group, Button, Alert } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconAlertTriangle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { LecturaMedidor, MedidorLista } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import { avisoSalto, leerValorMedidor, textoUltimaLectura, ultimaDeError, validarLectura } from '../../lib/medidores';
import { CampoNumero } from '../CampoNumero';
import { refrescarMedidores } from './refrescar';

interface Props {
  /** El medidor al que se le carga la lectura, o null con el diálogo cerrado. */
  medidor: MedidorLista | null;
  onCerrar: () => void;
}

/**
 * 3.2 Cargar una lectura. Si sube a más del doble de la última, el primer "Guardar" solo
 * muestra el aviso, y el botón pasa a "Guardar igual".
 */
export function ModalLectura({ medidor, onCerrar }: Props) {
  const queryClient = useQueryClient();
  const [valor, setValor] = useState<number | string>('');
  const [observacion, setObservacion] = useState('');
  const [errorValor, setErrorValor] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!medidor) return;
    setValor('');
    setObservacion('');
    setErrorValor(null);
    setAviso(null);
    setError(null);
  }, [medidor?.id]);

  if (!medidor) return null;
  const ultima = medidor.ultima_lectura?.valor ?? null;

  const guardar = async () => {
    const encontrado = validarLectura(valor, ultima, 'NUEVA', medidor.unidad);
    setErrorValor(encontrado);
    setError(null);
    if (encontrado) return;
    // El aviso de salto se muestra una vez; el segundo clic guarda igual
    const salto = avisoSalto(valor, ultima, medidor.unidad);
    if (salto && !aviso) {
      setAviso(salto);
      return;
    }

    setGuardando(true);
    try {
      await clienteApi.post<LecturaMedidor>(`/api/medidores/${medidor.id}/lecturas`, {
        valor: leerValorMedidor(valor),
        observacion: observacion.trim() || null,
      });
      await refrescarMedidores(queryClient);
      notifications.show({ message: 'Lectura cargada.', color: 'green' });
      onCerrar();
    } catch (err) {
      if (err instanceof ApiError && err.codigo === 'LECTURA_MENOR') {
        const ultimaApi = ultimaDeError(err.datos);
        setErrorValor((ultimaApi !== null && validarLectura(valor, ultimaApi, 'NUEVA', medidor.unidad)) || mensajeError(err));
        setAviso(null);
      } else if (err instanceof ApiError && err.codigo === 'MEDIDOR_INACTIVO') {
        setErrorValor('El medidor está inactivo: no se pueden cargar lecturas.');
      } else {
        setError(mensajeError(err));
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal opened onClose={() => !guardando && onCerrar()} title={`Cargar lectura: ${medidor.nombre}`}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {textoUltimaLectura(medidor.ultima_lectura, medidor.unidad) ?? 'Todavía no tiene lecturas.'}
        </Text>
        <CampoNumero
          label="Lectura"
          required
          decimalScale={2}
          rightSection={
            <Text size="xs" c="dimmed" pr="xs">
              {medidor.unidad}
            </Text>
          }
          rightSectionWidth={70}
          value={valor}
          onChange={(v) => {
            setValor(v);
            setErrorValor(null);
            setAviso(null);
          }}
          error={errorValor}
          data-autofocus
        />
        <TextInput
          label="Observación"
          placeholder="Opcional"
          maxLength={200}
          value={observacion}
          onChange={(e) => setObservacion(e.currentTarget.value)}
        />

        {aviso && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
            {aviso}
          </Alert>
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
            {aviso ? 'Guardar igual' : 'Guardar'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
