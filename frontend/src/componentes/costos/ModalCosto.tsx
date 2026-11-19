import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  SegmentedControl,
  Textarea,
  Text,
  Group,
  Button,
  Box,
  VisuallyHidden,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import {
  CuerpoLoteCostos,
  LoteCostosRespuesta,
  PersonaCostoOpcion,
  ProveedorOpcion,
  TipoCosto,
} from '../../api/tipos';
import { ApiError, mensajeError } from '../../lib/errores';
import {
  BorradorCosto,
  CampoBorradorCosto,
  ErroresBorradorCosto,
  TIPOS_COSTO,
  borradorEmpezado,
  borradorVacio,
  cuerposLote,
  etiquetaTipoCosto,
  conValorHora,
  llevaProveedor,
  textoBotonAgregar,
  textoCostosAgregados,
  textoTotalNegativo,
  validarBorrador,
  validarMotivoCosto,
} from '../../lib/costos';
import { CamposBorradorCosto } from './CamposBorradorCosto';

export interface ModalCostoProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  estadoIntervencion: string;
}

type Borradores = Record<TipoCosto, BorradorCosto>;
type Errores = Record<TipoCosto, ErroresBorradorCosto>;

function borradoresVacios(): Borradores {
  return {
    MANO_OBRA: borradorVacio(),
    SERVICIO_EXTERNO: borradorVacio(),
    TRANSPORTE: borradorVacio(),
    OTRO: borradorVacio(),
    AJUSTE: borradorVacio(),
  };
}

function erroresVacios(): Errores {
  return { MANO_OBRA: {}, SERVICIO_EXTERNO: {}, TRANSPORTE: {}, OTRO: {}, AJUSTE: {} };
}

function conErrores(e: ErroresBorradorCosto): boolean {
  return Object.values(e).some((m) => m);
}

/**
 * Los errores de los campos que la pestaña muestra (C1.2.1, sección 2): un error
 * guardado en un campo oculto no marca la pestaña.
 */
function erroresVisibles(
  tipo: TipoCosto,
  b: BorradorCosto,
  e: ErroresBorradorCosto,
  finalizada: boolean
): ErroresBorradorCosto {
  const esManoObra = tipo === 'MANO_OBRA';
  const visible: Record<CampoBorradorCosto, boolean> = {
    persona: esManoObra && !b.externa,
    proveedor: llevaProveedor(tipo, b),
    horas: esManoObra,
    valorHora: esManoObra,
    importe: !conValorHora(tipo, b),
    descripcion: true,
    motivo: tipo === 'AJUSTE' && !finalizada,
  };
  const r: ErroresBorradorCosto = {};
  for (const campo of Object.keys(e) as CampoBorradorCosto[]) {
    if (visible[campo] && e[campo]) r[campo] = e[campo];
  }
  return r;
}

/** Etiqueta de la pestaña, con su marca: punto rojo con errores, de la marca con datos. */
function EtiquetaPestana({ tipo, empezada, errores }: { tipo: TipoCosto; empezada: boolean; errores: boolean }) {
  const marca = errores ? 'con errores' : empezada ? 'con datos' : null;
  return (
    <Group gap={6} wrap="nowrap" justify="center">
      <span>{etiquetaTipoCosto(tipo)}</span>
      {marca && (
        <>
          <Box
            aria-hidden
            w={8}
            h={8}
            style={{
              borderRadius: '50%',
              flexShrink: 0,
              background: errores ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-marca-6)',
            }}
          />
          <VisuallyHidden>{marca}</VisuallyHidden>
        </>
      )}
    </Group>
  );
}

/**
 * Diálogo "Agregar costos" (C1.2): una pestaña por tipo, cada una con su borrador,
 * y un solo guardado para todas las empezadas.
 */
export function ModalCosto({ abierto, onCerrar, intervencionId, estadoIntervencion }: ModalCostoProps) {
  const queryClient = useQueryClient();
  const angosto = useMediaQuery('(max-width: 48em)');
  const finalizada = estadoIntervencion === 'FINALIZADA';

  const [tipo, setTipo] = useState<TipoCosto>('MANO_OBRA');
  const [borradores, setBorradores] = useState<Borradores>(borradoresVacios);
  const [errores, setErrores] = useState<Errores>(erroresVacios);
  const [motivoCorreccion, setMotivoCorreccion] = useState('');
  const [errorMotivoCorreccion, setErrorMotivoCorreccion] = useState<string | null>(null);
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const borrador = borradores[tipo];
  const empezadas = TIPOS_COSTO.filter((t) => borradorEmpezado(borradores[t]));
  const hayDatos = empezadas.length > 0 || (finalizada && motivoCorreccion.trim() !== '');

  // La confirmación se ve solo mientras haya datos sin guardar: si se van
  // (por ejemplo, con "Vaciar pestaña"), vuelven Cancelar y Agregar
  useEffect(() => {
    if (!hayDatos) setConfirmandoCierre(false);
  }, [hayDatos]);

  const { data: personas } = useQuery<PersonaCostoOpcion[]>({
    queryKey: ['costos', 'personas'],
    queryFn: () => clienteApi.get<PersonaCostoOpcion[]>('/api/costos/personas'),
    enabled: abierto && tipo === 'MANO_OBRA' && !borrador.externa,
  });

  const { data: proveedores } = useQuery<ProveedorOpcion[]>({
    queryKey: ['proveedores', 'opciones'],
    queryFn: () => clienteApi.get<ProveedorOpcion[]>('/api/proveedores/opciones'),
    enabled: abierto && llevaProveedor(tipo, borrador),
  });

  // Al abrir, todo vacío
  useEffect(() => {
    if (abierto) {
      setTipo('MANO_OBRA');
      setBorradores(borradoresVacios());
      setErrores(erroresVacios());
      setMotivoCorreccion('');
      setErrorMotivoCorreccion(null);
      setConfirmandoCierre(false);
    }
  }, [abierto]);

  const cambiar = (cambios: Partial<BorradorCosto>, limpiar: CampoBorradorCosto[]) => {
    setBorradores((prev) => ({ ...prev, [tipo]: { ...prev[tipo], ...cambios } }));
    setErrores((prev) => {
      const e = { ...prev[tipo] };
      for (const campo of limpiar) delete e[campo];
      return { ...prev, [tipo]: e };
    });
    setConfirmandoCierre(false);
  };

  const cambiarExterna = (externa: boolean) => {
    setBorradores((prev) => ({ ...prev, [tipo]: { ...prev[tipo], externa } }));
    setErrores((prev) => ({ ...prev, [tipo]: {} }));
  };

  const vaciarPestana = () => {
    setBorradores((prev) => ({ ...prev, [tipo]: borradorVacio() }));
    setErrores((prev) => ({ ...prev, [tipo]: {} }));
  };

  // Cancelar, la X, Escape y el clic afuera: con datos, piden confirmación
  const intentarCerrar = () => {
    if (guardando) return;
    if (hayDatos) {
      setConfirmandoCierre(true);
      return;
    }
    onCerrar();
  };

  const errorDeApi = (err: unknown, tiposEnviados: TipoCosto[]) => {
    if (err instanceof ApiError) {
      if (err.codigo === 'TOTAL_NEGATIVO') {
        setTipo('AJUSTE');
        setErrores((prev) => ({
          ...prev,
          AJUSTE: { ...prev.AJUSTE, importe: textoTotalNegativo(err.datos?.total_resultante) },
        }));
        return;
      }
      const indice = err.datos?.indice;
      const tipoError = typeof indice === 'number' ? tiposEnviados[indice] : undefined;
      if (tipoError) {
        setTipo(tipoError);
        const enCampo = (campo: CampoBorradorCosto, mensaje: string) =>
          setErrores((prev) => ({ ...prev, [tipoError]: { ...prev[tipoError], [campo]: mensaje } }));
        if (err.codigo === 'PERSONA_INVALIDA') {
          enCampo('persona', 'Esa persona ya no está activa.');
          queryClient.invalidateQueries({ queryKey: ['costos', 'personas'] });
          return;
        }
        if (err.codigo === 'PROVEEDOR_INVALIDO') {
          enCampo('proveedor', 'Ese proveedor ya no está activo.');
          queryClient.invalidateQueries({ queryKey: ['proveedores', 'opciones'] });
          return;
        }
        if (err.codigo === 'MOTIVO_REQUERIDO') {
          if (finalizada) {
            setErrorMotivoCorreccion('Ingresá un motivo de al menos 5 caracteres.');
          } else {
            enCampo('motivo', 'Ingresá un motivo de al menos 5 caracteres.');
          }
          return;
        }
      }
    }
    notifications.show({ message: mensajeError(err), color: 'red' });
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setConfirmandoCierre(false);

    // Sin pestañas empezadas, se valida la visible; si no, todas las empezadas
    const aValidar = empezadas.length === 0 ? [tipo] : empezadas;
    const nuevos = { ...errores };
    for (const t of aValidar) nuevos[t] = validarBorrador(t, borradores[t], { finalizada });
    const errMotivo = finalizada ? validarMotivoCosto(motivoCorreccion) : null;
    setErrores(nuevos);
    setErrorMotivoCorreccion(errMotivo);

    const conProblemas = aValidar.filter((t) => conErrores(erroresVisibles(t, borradores[t], nuevos[t], finalizada)));
    if (conProblemas.length > 0 || errMotivo) {
      if (conProblemas.length > 0 && !conProblemas.includes(tipo)) setTipo(conProblemas[0]);
      return;
    }
    if (empezadas.length === 0) return;

    const cuerpo: CuerpoLoteCostos = { renglones: cuerposLote(borradores, { finalizada, motivoCorreccion }) };
    const tiposEnviados = cuerpo.renglones.map((r) => r.tipo);

    setGuardando(true);
    try {
      const res = await clienteApi.post<LoteCostosRespuesta>(
        `/api/intervenciones/${intervencionId}/costos/lote`,
        cuerpo
      );
      notifications.show({ message: textoCostosAgregados(res.renglones.length), color: 'green' });
      // Costos, repuestos y detalle (por el historial): todo cuelga de este prefijo
      queryClient.invalidateQueries({ queryKey: ['intervencion', intervencionId] });
      onCerrar();
    } catch (err: unknown) {
      errorDeApi(err, tiposEnviados);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal opened={abierto} onClose={intentarCerrar} title="Agregar costos" size="lg">
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <SegmentedControl
            fullWidth
            orientation={angosto ? 'vertical' : 'horizontal'}
            value={tipo}
            onChange={(v) => {
              const t = TIPOS_COSTO.find((x) => x === v);
              if (t) setTipo(t);
            }}
            data={TIPOS_COSTO.map((t) => ({
              value: t,
              label: (
                <EtiquetaPestana
                  tipo={t}
                  empezada={empezadas.includes(t)}
                  errores={conErrores(erroresVisibles(t, borradores[t], errores[t], finalizada))}
                />
              ),
            }))}
          />

          {borradorEmpezado(borrador) && (
            <Group justify="flex-end">
              <Button size="compact-xs" variant="subtle" color="gray" onClick={vaciarPestana}>
                Vaciar pestaña
              </Button>
            </Group>
          )}

          <CamposBorradorCosto
            tipo={tipo}
            borrador={borrador}
            errores={errores[tipo]}
            finalizada={finalizada}
            personas={personas}
            proveedores={proveedores}
            onCambio={cambiar}
            onCambiarExterna={cambiarExterna}
          />

          {finalizada && (
            <Textarea
              label="Motivo de la corrección"
              description="Va en todos los costos que se agregan."
              placeholder="Mínimo 5 caracteres"
              required
              rows={2}
              maxLength={500}
              value={motivoCorreccion}
              onChange={(e) => {
                setMotivoCorreccion(e.currentTarget.value);
                setErrorMotivoCorreccion(null);
                setConfirmandoCierre(false);
              }}
              error={errorMotivoCorreccion}
            />
          )}

          {confirmandoCierre && hayDatos ? (
            <Stack gap="xs" mt="md">
              <Text size="sm" fw={500}>
                Hay costos sin guardar. ¿Descartarlos?
              </Text>
              <Group justify="flex-end" wrap="wrap">
                <Button variant="default" onClick={() => setConfirmandoCierre(false)}>
                  Seguir cargando
                </Button>
                <Button color="red" onClick={onCerrar}>
                  Descartar
                </Button>
              </Group>
            </Stack>
          ) : (
            <Group justify="flex-end" mt="md" wrap="wrap">
              <Button variant="default" onClick={intentarCerrar} disabled={guardando}>
                Cancelar
              </Button>
              <Button type="submit" color="marca" loading={guardando}>
                {textoBotonAgregar(empezadas.length)}
              </Button>
            </Group>
          )}
        </Stack>
      </form>
    </Modal>
  );
}
