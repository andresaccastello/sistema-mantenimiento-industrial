import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  SegmentedControl,
  Select,
  TextInput,
  Textarea,
  Text,
  Group,
  Button,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { PersonaCostoOpcion, ProveedorOpcion, RenglonCosto, TipoCosto } from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import { formatMoneda } from '../../lib/formato';
import { nombreCompleto } from '../../lib/personas';
import {
  cuerpoCosto,
  etiquetaTipoCosto,
  importeManoObra,
  textoTotalNegativo,
  validarHoras,
  validarImporteCosto,
} from '../../lib/costos';
import { CampoNumero } from '../CampoNumero';

export interface ModalCostoProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  estadoIntervencion: string;
}

const TIPOS: TipoCosto[] = ['MANO_OBRA', 'SERVICIO_EXTERNO', 'TRANSPORTE', 'OTRO', 'AJUSTE'];

function vacio(valor: number | string): boolean {
  return String(valor).trim() === '';
}

export function ModalCosto({ abierto, onCerrar, intervencionId, estadoIntervencion }: ModalCostoProps) {
  const queryClient = useQueryClient();
  const angosto = useMediaQuery('(max-width: 48em)');
  const esFinalizada = estadoIntervencion === 'FINALIZADA';

  const [tipo, setTipo] = useState<TipoCosto>('MANO_OBRA');
  const [externa, setExterna] = useState(false);
  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [horas, setHoras] = useState<number | string>('');
  const [valorHora, setValorHora] = useState<number | string>('');
  const [importe, setImporte] = useState<number | string>('');
  const [descripcion, setDescripcion] = useState('');
  const [motivo, setMotivo] = useState('');

  const [errores, setErrores] = useState<Record<string, string | null>>({});
  const [guardando, setGuardando] = useState(false);

  const esManoObra = tipo === 'MANO_OBRA';
  const llevaProveedor = (esManoObra && externa) || tipo === 'SERVICIO_EXTERNO' || tipo === 'TRANSPORTE' || tipo === 'OTRO';
  const llevaMotivo = esFinalizada || tipo === 'AJUSTE';
  const conValorHora = esManoObra && !vacio(valorHora);

  const { data: personas } = useQuery<PersonaCostoOpcion[]>({
    queryKey: ['costos', 'personas'],
    queryFn: () => clienteApi.get<PersonaCostoOpcion[]>('/api/costos/personas'),
    enabled: abierto && esManoObra && !externa,
  });

  const { data: proveedores } = useQuery<ProveedorOpcion[]>({
    queryKey: ['proveedores', 'opciones'],
    queryFn: () => clienteApi.get<ProveedorOpcion[]>('/api/proveedores/opciones'),
    enabled: abierto && llevaProveedor,
  });

  useEffect(() => {
    if (abierto) {
      setTipo('MANO_OBRA');
      setExterna(false);
      setUsuarioId(null);
      setProveedorId(null);
      setHoras('');
      setValorHora('');
      setImporte('');
      setDescripcion('');
      setMotivo('');
      setErrores({});
    }
  }, [abierto]);

  const error = (campo: string) => errores[campo] ?? null;
  const limpiar = (campo: string) => {
    if (errores[campo]) setErrores({ ...errores, [campo]: null });
  };

  // Importe calculado, como lo calcula la API
  const importeCalculado =
    conValorHora && !validarHoras(horas) && !validarImporteCosto('MANO_OBRA', valorHora)
      ? importeManoObra(Number(horas), Number(valorHora))
      : null;

  const validar = (): Record<string, string | null> => {
    const e: Record<string, string | null> = {};
    const desc = descripcion.trim();

    if (esManoObra) {
      if (externa && !proveedorId) e.proveedor = 'Elegí el proveedor.';
      if (!externa && !usuarioId) e.persona = 'Elegí la persona.';
      e.horas = validarHoras(horas);
      if (conValorHora) {
        e.valorHora = validarImporteCosto('MANO_OBRA', valorHora);
      } else {
        e.importe = validarImporteCosto('MANO_OBRA', importe);
      }
      if (desc !== '' && (desc.length < 3 || desc.length > 200)) {
        e.descripcion = 'Entre 3 y 200 caracteres.';
      }
    } else {
      if (desc.length < 3 || desc.length > 200) {
        e.descripcion = 'Ingresá una descripción de 3 a 200 caracteres.';
      }
      e.importe = validarImporteCosto(tipo, importe);
    }

    if (llevaMotivo && motivo.trim().length < 5) {
      e.motivo = 'Ingresá un motivo de al menos 5 caracteres.';
    }
    return e;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validar();
    setErrores(e);
    if (Object.values(e).some((m) => m)) return;

    const cuerpo = cuerpoCosto({
      tipo,
      externa,
      descripcion,
      usuarioId: usuarioId ? Number(usuarioId) : null,
      proveedorId: proveedorId ? Number(proveedorId) : null,
      horas: esManoObra ? Number(horas) : null,
      valorHora: conValorHora ? Number(valorHora) : null,
      importe: conValorHora ? null : Number(importe),
      motivo: llevaMotivo ? motivo : null,
    });

    setGuardando(true);
    try {
      await clienteApi.post<RenglonCosto>(`/api/intervenciones/${intervencionId}/costos`, cuerpo);
      notifications.show({ message: 'Costo agregado.', color: 'green' });
      // Costos, repuestos y detalle (por el historial): todo cuelga de este prefijo
      queryClient.invalidateQueries({ queryKey: ['intervencion', intervencionId] });
      onCerrar();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.codigo === 'TOTAL_NEGATIVO') {
          setErrores({ importe: textoTotalNegativo(err.datos?.total_resultante) });
          return;
        }
        if (err.codigo === 'PERSONA_INVALIDA') {
          setErrores({ persona: 'Esa persona ya no está activa.' });
          queryClient.invalidateQueries({ queryKey: ['costos', 'personas'] });
          return;
        }
        if (err.codigo === 'PROVEEDOR_INVALIDO') {
          setErrores({ proveedor: 'Ese proveedor ya no está activo.' });
          queryClient.invalidateQueries({ queryKey: ['proveedores', 'opciones'] });
          return;
        }
        if (err.codigo === 'MOTIVO_REQUERIDO') {
          setErrores({ motivo: 'Ingresá un motivo de al menos 5 caracteres.' });
          return;
        }
      }
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal opened={abierto} onClose={onCerrar} title="Agregar costo" size="lg">
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <SegmentedControl
            fullWidth
            orientation={angosto ? 'vertical' : 'horizontal'}
            value={tipo}
            onChange={(v) => {
              const t = TIPOS.find((x) => x === v);
              if (t) {
                setTipo(t);
                setErrores({});
              }
            }}
            data={TIPOS.map((t) => ({ value: t, label: etiquetaTipoCosto(t) }))}
          />

          {esManoObra && (
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Quién trabajó
              </Text>
              <SegmentedControl
                value={externa ? 'externa' : 'interna'}
                onChange={(v) => {
                  setExterna(v === 'externa');
                  setErrores({});
                }}
                data={[
                  { value: 'interna', label: 'Interna' },
                  { value: 'externa', label: 'Externa' },
                ]}
              />
            </Stack>
          )}

          {esManoObra && !externa && (
            <Select
              label="Persona"
              placeholder="Elegí quién trabajó"
              required
              searchable
              data={(personas || []).map((p) => ({ value: String(p.id), label: `${nombreCompleto(p)} (${p.legajo})` }))}
              value={usuarioId}
              onChange={(v) => {
                setUsuarioId(v);
                limpiar('persona');
              }}
              error={error('persona')}
            />
          )}

          {llevaProveedor && (
            <Select
              label="Proveedor"
              placeholder={esManoObra ? 'Elegí el proveedor' : 'Opcional'}
              required={esManoObra}
              clearable={!esManoObra}
              searchable
              data={(proveedores || []).map((p) => ({ value: String(p.id), label: p.nombre }))}
              value={proveedorId}
              onChange={(v) => {
                setProveedorId(v);
                limpiar('proveedor');
              }}
              error={error('proveedor')}
            />
          )}

          {esManoObra && (
            <Group grow align="flex-start">
              <CampoNumero
                label="Horas"
                required
                decimalScale={2}
                value={horas}
                onChange={(v) => {
                  setHoras(v);
                  limpiar('horas');
                }}
                error={error('horas')}
              />
              <CampoNumero
                label="Valor hora"
                placeholder="Opcional"
                prefix="$ "
                decimalScale={2}
                value={valorHora}
                onChange={(v) => {
                  setValorHora(v);
                  limpiar('valorHora');
                }}
                error={error('valorHora')}
              />
            </Group>
          )}

          {conValorHora && (
            <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
              Importe: <strong>{formatMoneda(importeCalculado)}</strong>
            </Text>
          )}

          {!conValorHora && (
            <CampoNumero
              label={esManoObra ? 'Importe total' : 'Importe'}
              description={tipo === 'AJUSTE' ? 'Puede ser negativo, por ejemplo un descuento.' : undefined}
              required
              prefix="$ "
              decimalScale={2}
              value={importe}
              onChange={(v) => {
                setImporte(v);
                limpiar('importe');
              }}
              error={error('importe')}
            />
          )}

          <TextInput
            label="Descripción"
            placeholder={esManoObra ? 'Opcional' : 'Qué se pagó'}
            required={!esManoObra}
            maxLength={200}
            value={descripcion}
            onChange={(e) => {
              setDescripcion(e.currentTarget.value);
              limpiar('descripcion');
            }}
            error={error('descripcion')}
          />

          {llevaMotivo && (
            <Textarea
              label={esFinalizada ? 'Motivo de la corrección' : 'Motivo'}
              placeholder="Mínimo 5 caracteres"
              required
              rows={2}
              maxLength={500}
              value={motivo}
              onChange={(e) => {
                setMotivo(e.currentTarget.value);
                limpiar('motivo');
              }}
              error={error('motivo')}
            />
          )}

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" color="marca" loading={guardando}>
              Agregar costo
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
