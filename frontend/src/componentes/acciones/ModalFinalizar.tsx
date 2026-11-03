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
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { SelectorMomento } from '../SelectorMomento';
import { SeccionRecuperacionMaquina } from '../SeccionRecuperacionMaquina';
import { validarMomento, momentoAIso, Momento } from '../../lib/fechas';
import type { PeriodoDetencion } from '../../api/tipos';
import { useAccionIntervencion } from './useAccionIntervencion';

export interface ModalFinalizarProps {
  abierto: boolean;
  onCerrar: () => void;
  intervencionId: number;
  estadoAlAbrir: string;
  fechaInicio?: string | null;
  fechaCreacion: string;
  periodoAbierto?: PeriodoDetencion | null;
  puedeConfirmarRecuperacion: boolean;
}

export function ModalFinalizar({
  abierto,
  onCerrar,
  intervencionId,
  estadoAlAbrir,
  fechaInicio,
  fechaCreacion,
  periodoAbierto,
  puedeConfirmarRecuperacion,
}: ModalFinalizarProps) {
  const isMobile = useMediaQuery('(max-width: 48em)');

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
    avisoExito: 'Intervención finalizada.',
  });

  useEffect(() => {
    if (abierto) {
      setTrabajoRealizadoTexto('');
      setEjecucionValor('');
      setMomentoAccion({ modo: 'ahora', fecha: null });
      setObservacionTexto('');
      setMaquinaRecuperada(null);
      setMomentoRecuperacion({ modo: 'ahora', fecha: null });
      setObservacionRecuperacion('');
      setErrorModal(null);
    }
  }, [abierto, setErrorModal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ahora = new Date();

    const trabTrim = trabajoRealizadoTexto.trim();
    if (trabTrim.length < 5) {
      setErrorModal('Describí el trabajo realizado (al menos 5 caracteres).');
      return;
    }
    if (!ejecucionValor) {
      setErrorModal('Indicá si lo hizo personal propio o un servicio externo.');
      return;
    }

    const minimoFin = fechaInicio || fechaCreacion;
    const errMom = validarMomento(momentoAccion, minimoFin, ahora);
    if (errMom) {
      setErrorModal(errMom);
      return;
    }
    const fFinIso = momentoAIso(momentoAccion, minimoFin);

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
      clienteApi.post(`/api/intervenciones/${intervencionId}/finalizar`, {
        estado_esperado: estadoAlAbrir,
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
      title="Finalizar intervención"
      size="lg"
      centered
      fullScreen={isMobile}
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          {errorModal && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              {errorModal}
            </Alert>
          )}

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
            minimo={fechaInicio || fechaCreacion}
            value={momentoAccion}
            onChange={setMomentoAccion}
            disabled={guardando}
          />

          <Textarea
            label="Observación (opcional)"
            placeholder="Detalles adicionales del cierre"
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
              Finalizar
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
