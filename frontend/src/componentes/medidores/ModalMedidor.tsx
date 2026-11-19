import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Stack, TextInput, Autocomplete, Group, Button, Alert, Text, Select } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import type { MedidorDetalle, MedidorLista, PeriodoUso } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import {
  BorradorMedidor,
  ErroresMedidor,
  UNIDADES_MEDIDOR,
  borradorMedidorVacio,
  cuerpoMedidor,
  validarMedidor,
} from '../../lib/medidores';
import { LEER_CADA_POR_OMISION, errorLeerCada, leerCadaDias } from '../../lib/lecturas';
import { AYUDA_USO_ESTIMADO, OPCIONES_PERIODO, cambioUso, usoDelFormulario } from '../../lib/estimacion';
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

/** LE1, 4.5: "Leer cada", 7 en uno nuevo; vacío, sin aviso de atraso. */
function leerCadaDe(m: MedidorLista | null): number | string {
  if (!m) return LEER_CADA_POR_OMISION;
  return m.lectura_cada_dias ?? '';
}

/** HE1, 6: el uso estimado; vacío es null. */
function usoValorDe(m: MedidorLista | null): number | string {
  return m?.uso_estimado?.valor ?? '';
}
function usoPeriodoDe(m: MedidorLista | null): PeriodoUso {
  return m?.uso_estimado?.periodo ?? 'SEMANA';
}

/** 3.2 Nuevo medidor y editar medidor. */
export function ModalMedidor({ abierto, maquinaId, medidor, onCerrar }: Props) {
  const queryClient = useQueryClient();
  const [b, setB] = useState<BorradorMedidor>(borradorDe(medidor));
  const [errores, setErrores] = useState<ErroresMedidor>({});
  const [leerCada, setLeerCada] = useState<number | string>(leerCadaDe(medidor));
  const [errorCada, setErrorCada] = useState<string | null>(null);
  const [usoValor, setUsoValor] = useState<number | string>(usoValorDe(medidor));
  const [usoPeriodo, setUsoPeriodo] = useState<PeriodoUso>(usoPeriodoDe(medidor));
  const [errorUso, setErrorUso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setB(borradorDe(medidor));
    setLeerCada(leerCadaDe(medidor));
    setErrorCada(null);
    setUsoValor(usoValorDe(medidor));
    setUsoPeriodo(usoPeriodoDe(medidor));
    setErrorUso(null);
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
    const malCada = errorLeerCada(leerCada);
    setErrorCada(malCada);
    const uso = usoDelFormulario(usoValor, usoPeriodo);
    setErrorUso(uso.error);
    if (Object.keys(encontrados).length > 0 || malCada || uso.error) return;
    const cada = leerCadaDias(leerCada) as number | null;

    setGuardando(true);
    try {
      if (medidor) {
        const cambios: Record<string, unknown> = { ...cuerpoMedidor(b, borradorDe(medidor)) };
        if (cada !== medidor.lectura_cada_dias) cambios.lectura_cada_dias = cada;
        if (cambioUso(medidor.uso_estimado, uso.uso)) cambios.uso_estimado = uso.uso;
        if (Object.keys(cambios).length > 0) {
          await clienteApi.patch<MedidorDetalle>(`/api/medidores/${medidor.id}`, cambios);
        }
      } else {
        await clienteApi.post<MedidorDetalle>('/api/medidores', {
          maquina_id: maquinaId,
          ...cuerpoMedidor(b),
          lectura_cada_dias: cada,
          uso_estimado: uso.uso,
        });
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
        <CampoNumero
          label="Leer cada"
          description="Vacío: sin aviso de atraso"
          placeholder="Sin aviso"
          allowDecimal={false}
          allowNegative={false}
          rightSection={
            <Text size="xs" c="dimmed" pr="xs">
              días
            </Text>
          }
          rightSectionWidth={50}
          value={leerCada}
          onChange={(v) => {
            setLeerCada(v);
            setErrorCada(null);
          }}
          error={errorCada}
        />

        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Uso estimado (opcional)
          </Text>
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <CampoNumero
              aria-label="Uso estimado"
              placeholder="Sin declarar"
              decimalScale={2}
              allowNegative={false}
              rightSection={
                b.unidad.trim() ? (
                  <Text size="xs" c="dimmed" pr="xs">
                    {b.unidad.trim()}
                  </Text>
                ) : undefined
              }
              rightSectionWidth={b.unidad.trim() ? 70 : undefined}
              value={usoValor}
              onChange={(v) => {
                setUsoValor(v);
                setErrorUso(null);
              }}
              error={errorUso}
              style={{ flex: 1, minWidth: 0 }}
            />
            <Select
              aria-label="Período del uso estimado"
              data={OPCIONES_PERIODO}
              value={usoPeriodo}
              onChange={(v) => v && setUsoPeriodo(v as PeriodoUso)}
              allowDeselect={false}
              w={130}
            />
          </Group>
          <Text size="xs" c="dimmed">
            {AYUDA_USO_ESTIMADO}.
          </Text>
        </Stack>

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
