import React, { useState, useEffect } from 'react';
import {
  Modal,
  Stack,
  Text,
  Textarea,
  SegmentedControl,
  Group,
  Button,
  Alert,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { SelectorMomento } from '../SelectorMomento';
import { SeccionRecuperacionMaquina } from '../SeccionRecuperacionMaquina';
import {
  validarMomento,
  momentoAIso,
  fechaLocalTexto,
  fechaLocalAIso,
  Momento,
} from '../../lib/fechas';
import type { PeriodoDetencion } from '../../api/tipos';
import { useAccionIntervencion } from './useAccionIntervencion';
import { AvisoTareasSinMarcar } from '../preventivos/AvisoTareasSinMarcar';

export interface ModalResolverAhoraProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  estadoAlAbrir: string;
  fechaCreacion: string;
  periodoAbierto?: PeriodoDetencion | null;
  puedeConfirmarRecuperacion: boolean;
  /** PV2: una preventiva, para avisar de las tareas sin marcar. */
  conTareas?: boolean;
}

export function ModalResolverAhora({
  abierto,
  onCerrar,
  intervencionId,
  estadoAlAbrir,
  fechaCreacion,
  periodoAbierto,
  puedeConfirmarRecuperacion,
  conTareas = false,
}: ModalResolverAhoraProps) {
  const isMobile = useMediaQuery('(max-width: 48em)');

  const [fechaInicioResolver, setFechaInicioResolver] = useState('');
  const [trabajoRealizadoTexto, setTrabajoRealizadoTexto] = useState('');
  const [ejecucionValor, setEjecucionValor] = useState<string>('');
  const [momentoAccion, setMomentoAccion] = useState<Momento>({ modo: 'ahora', fecha: null });
  const [observacionTexto, setObservacionTexto] = useState('');

  // Recuperación de máquina
  const [maquinaRecuperada, setMaquinaRecuperada] = useState<boolean | null>(null);
  const [momentoRecuperacion, setMomentoRecuperacion] = useState<Momento>({ modo: 'ahora', fecha: null });
  const [observacionRecuperacion, setObservacionRecuperacion] = useState('');

  const { guardando, errorModal, setErrorModal, ejecutar } = useAccionIntervencion({
    intervencionId,
    onCerrar,
    avisoExito: 'Intervención registrada como resuelta.',
  });

  useEffect(() => {
    if (abierto) {
      setFechaInicioResolver(fechaLocalTexto(new Date(fechaCreacion)));
      setTrabajoRealizadoTexto('');
      setEjecucionValor('');
      setMomentoAccion({ modo: 'ahora', fecha: null });
      setObservacionTexto('');
      setMaquinaRecuperada(null);
      setMomentoRecuperacion({ modo: 'ahora', fecha: null });
      setObservacionRecuperacion('');
      setErrorModal(null);
    }
  }, [abierto, fechaCreacion, setErrorModal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ahora = new Date();

    const isoInicio = fechaLocalAIso(fechaInicioResolver);
    if (!isoInicio) {
      setErrorModal('Indicá una fecha y hora de inicio válida.');
      return;
    }
    const errIni = validarMomento({ modo: 'otra', fecha: fechaInicioResolver }, fechaCreacion, ahora);
    if (errIni) {
      setErrorModal(errIni);
      return;
    }

    const trabTrim = trabajoRealizadoTexto.trim();
    if (trabTrim.length < 5) {
      setErrorModal('Describí el trabajo realizado (al menos 5 caracteres).');
      return;
    }
    if (!ejecucionValor) {
      setErrorModal('Indicá si lo hizo personal propio o un servicio externo.');
      return;
    }

    const errMomFin = validarMomento(momentoAccion, isoInicio, ahora);
    if (errMomFin) {
      setErrorModal(errMomFin);
      return;
    }
    const fFinIso = momentoAIso(momentoAccion, isoInicio);

    // Recuperación
    let reqRecuperada: boolean | undefined = undefined;
    let reqFechaRec: string | undefined = undefined;
    let reqObsRec: string | undefined = undefined;

    if (periodoAbierto) {
      if (!puedeConfirmarRecuperacion) {
        reqRecuperada = false;
      } else {
        if (maquinaRecuperada === null) {
          setErrorModal('Indicá si la máquina volvió a funcionar.');
          return;
        }
        reqRecuperada = maquinaRecuperada;
        if (maquinaRecuperada) {
          const errMomRec = validarMomento(momentoRecuperacion, periodoAbierto.desde, ahora);
          if (errMomRec) {
            setErrorModal(errMomRec);
            return;
          }
          reqFechaRec = momentoAIso(momentoRecuperacion, periodoAbierto.desde);
          reqObsRec = observacionRecuperacion.trim() || undefined;
        }
      }
    }

    const obsTrim = observacionTexto.trim();

    ejecutar(() =>
      clienteApi.post(`/api/intervenciones/${intervencionId}/resolver-ahora`, {
        estado_esperado: estadoAlAbrir,
        fecha_inicio: isoInicio,
        trabajo_realizado: trabTrim,
        ejecucion: ejecucionValor,
        fecha_finalizacion: fFinIso,
        observacion: obsTrim.length > 0 ? obsTrim : undefined,
        maquina_recuperada: reqRecuperada,
        fecha_recuperacion: reqFechaRec,
        observacion_recuperacion: reqObsRec,
      })
    );
  };

  return (
    <Modal
      opened={abierto}
      onClose={() => !guardando && onCerrar()}
      title="Registrar como resuelta"
      size="lg"
      centered
      fullScreen={isMobile}
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <AvisoTareasSinMarcar intervencionId={intervencionId} activo={abierto && conTareas} />
          {errorModal && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              {errorModal}
            </Alert>
          )}

          <Text size="sm" c="dimmed">
            {conTareas
              ? 'Para trabajos que ya se hicieron sin pasar por «Iniciar trabajo».'
              : "Para fallas que ya se arreglaron sin pasar por 'Iniciar trabajo'."}
          </Text>

          <DateTimePicker
            label="¿Cuándo empezó el arreglo?"
            valueFormat="DD/MM/YYYY HH:mm"
            value={fechaInicioResolver}
            onChange={(val: unknown) => {
              const str = typeof val === 'string' ? val : (val as any) instanceof Date ? fechaLocalTexto(val as Date) : '';
              setFechaInicioResolver(str);
            }}
            minDate={fechaLocalTexto(new Date(fechaCreacion))}
            maxDate={fechaLocalTexto(new Date())}
            disabled={guardando}
            required
          />

          <Textarea
            label="Trabajo realizado"
            placeholder="Describí las tareas que se hicieron (al menos 5 caracteres)"
            value={trabajoRealizadoTexto}
            onChange={(e) => setTrabajoRealizadoTexto(e.currentTarget.value)}
            disabled={guardando}
            minRows={3}
            required
          />

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              ¿Quién lo hizo?
            </Text>
            <SegmentedControl
              value={ejecucionValor}
              onChange={setEjecucionValor}
              data={[
                { label: 'Personal propio', value: 'INTERNA' },
                { label: 'Servicio externo', value: 'EXTERNA' },
              ]}
              disabled={guardando}
            />
          </Stack>

          <SelectorMomento
            label="¿Cuándo terminó?"
            opcionAhoraLabel="Ahora"
            minimo={fechaInicioResolver ? fechaLocalAIso(fechaInicioResolver) : fechaCreacion}
            value={momentoAccion}
            onChange={setMomentoAccion}
            disabled={guardando}
          />

          <Textarea
            label="Observación (opcional)"
            placeholder="Detalles adicionales del arreglo"
            value={observacionTexto}
            onChange={(e) => setObservacionTexto(e.currentTarget.value)}
            disabled={guardando}
          />

          {periodoAbierto && (
            <SeccionRecuperacionMaquina
              puedeConfirmar={puedeConfirmarRecuperacion}
              minimoDesde={periodoAbierto.desde}
              primeraOpcionFechaLabel="Al terminar el trabajo"
              maquinaRecuperada={maquinaRecuperada}
              onMaquinaRecuperadaChange={setMaquinaRecuperada}
              momentoRecuperacion={momentoRecuperacion}
              onMomentoRecuperacionChange={setMomentoRecuperacion}
              observacionRecuperacion={observacionRecuperacion}
              onObservacionRecuperacionChange={setObservacionRecuperacion}
              disabled={guardando}
            />
          )}

          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Volver
            </Button>
            <Button type="submit" color="marca" loading={guardando}>
              Registrar como resuelta
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
