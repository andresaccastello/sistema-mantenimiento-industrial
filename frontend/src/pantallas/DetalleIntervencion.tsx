import React, { useState, useMemo } from 'react';
import {
  Stack,
  Group,
  Card,
  Text,
  Badge,
  Button,
  Box,
  Title,
  Timeline,
  Modal,
  Textarea,
  TextInput,
  Select,
  SegmentedControl,
  Loader,
  Center,
  Anchor,
  Alert,
  Menu,
  Grid,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import {
  IconAlertCircle,
  IconDotsVertical,
  IconCheck,
} from '@tabler/icons-react';
import { useParams, useNavigate, useLocation, Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { useMediaQuery } from '@mantine/hooks';

import { clienteApi } from '../api/cliente';
import { EstadoBadge } from '../componentes/EstadoBadge';
import { PantallaVacia } from '../componentes/PantallaVacia';
import { ModalEditarReporte } from '../componentes/ModalEditarReporte';
import { SelectorMomento } from '../componentes/SelectorMomento';
import { SeccionRecuperacionMaquina } from '../componentes/SeccionRecuperacionMaquina';

import { useAuth } from '../auth/AuthContext';
import { etiquetaMaquina } from '../lib/maquinas';
import { formatFechaHora, formatDuracion, parsearId } from '../lib/formato';
import { nombreCompleto } from '../lib/personas';
import {
  eventosHistorial,
  minimoNuevaDetencion,
} from '../lib/intervenciones';
import {
  ordenarAcciones,
  etiquetaAccion,
  ACCIONES,
  CodigoAccion,
} from '../lib/acciones';
import {
  fechaLocalTexto,
  fechaLocalAIso,
  validarMomento,
  momentoAIso,
  minutosEntre,
  Momento,
} from '../lib/fechas';
import { obtenerInfoEstado } from '../lib/estados';
import { mensajeError, requiereRecargar, ApiError } from '../lib/errores';
import type {
  IntervencionDetalle,
  PeriodoDetencion,
  Persona,
} from '../api/tipos';

export function DetalleIntervencion() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { usuario } = useAuth();
  const isMobile = useMediaQuery('(max-width: 48em)');

  const idValido = parsearId(id);

  // Destino del botón "Volver"
  const volverA = (location.state as any)?.volverA;
  const destinoVolver =
    volverA && typeof volverA === 'string' && volverA.startsWith('/intervenciones')
      ? volverA
      : '/intervenciones';

  // Consulta de la intervención
  const {
    data: reporte,
    isLoading,
    isError,
    error,
  } = useQuery<IntervencionDetalle, ApiError>({
    queryKey: ['intervencion', idValido],
    queryFn: () => clienteApi.get<IntervencionDetalle>(`/api/intervenciones/${idValido}`),
    enabled: idValido !== null,
    refetchInterval: 60000,
    retry: false,
  });

  // Estados para acciones y modales
  const [modalActivo, setModalActivo] = useState<CodigoAccion | 'CONFIRMAR_RECUPERACION' | null>(null);
  const [estadoAlAbrir, setEstadoAlAbrir] = useState<string>('');
  const [guardandoAccion, setGuardandoAccion] = useState(false);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [tomandoDirecto, setTomandoDirecto] = useState(false);

  // Campos de formulario para modales
  const [motivoTexto, setMotivoTexto] = useState('');
  const [observacionTexto, setObservacionTexto] = useState('');
  const [trabajoRealizadoTexto, setTrabajoRealizadoTexto] = useState('');
  const [ejecucionValor, setEjecucionValor] = useState<string>('');
  const [destinatarioUsuarioId, setDestinatarioUsuarioId] = useState<string | null>(null);

  // Momentos de fecha
  const [momentoAccion, setMomentoAccion] = useState<Momento>({ modo: 'ahora', fecha: null });
  const [fechaInicioResolver, setFechaInicioResolver] = useState<string>('');
  const [maquinaDetenidaReabrir, setMaquinaDetenidaReabrir] = useState<boolean | null>(null);

  // Recuperación de máquina en Finalizar/Resolver/Cancelar/Eliminar
  const [maquinaRecuperada, setMaquinaRecuperada] = useState<boolean | null>(null);
  const [momentoRecuperacion, setMomentoRecuperacion] = useState<Momento>({ modo: 'ahora', fecha: null });
  const [observacionRecuperacion, setObservacionRecuperacion] = useState('');

  // Período para confirmar recuperación individual (Sección 7.4)
  const [periodoParaRecuperar, setPeriodoParaRecuperar] = useState<PeriodoDetencion | null>(null);

  // Consulta de responsables habilitados (al abrir Asignar)
  const debeCargarResponsables = modalActivo === 'ASIGNAR';
  const { data: responsablesHabilitados, isLoading: cargandoResponsables } = useQuery<Persona[]>({
    queryKey: ['responsables-habilitados', idValido],
    queryFn: () => clienteApi.get<Persona[]>(`/api/intervenciones/${idValido}/responsables-habilitados`),
    enabled: debeCargarResponsables && idValido !== null,
  });

  // Período de detención abierto
  const periodoAbierto = useMemo(() => {
    return reporte?.periodos_detencion?.find((p) => p.esta_abierto || p.hasta === null) || null;
  }, [reporte?.periodos_detencion]);

  const puedeConfirmarRecuperacion = Boolean(usuario?.permisos?.['INTERVENCIONES_CONFIRMAR_RECUPERACION']);

  // Reset y apertura de modal
  const abrirModal = (accion: CodigoAccion) => {
    if (!reporte) return;
    setEstadoAlAbrir(reporte.estado);
    setModalActivo(accion);
    setErrorModal(null);
    setMotivoTexto('');
    setObservacionTexto('');
    setTrabajoRealizadoTexto('');
    setEjecucionValor('');
    setDestinatarioUsuarioId(null);
    setMomentoAccion({ modo: 'ahora', fecha: null });
    setMaquinaDetenidaReabrir(null);
    setMaquinaRecuperada(null);
    setMomentoRecuperacion({ modo: 'ahora', fecha: null });
    setObservacionRecuperacion('');

    if (accion === 'RESOLVER_AHORA') {
      setFechaInicioResolver(fechaLocalTexto(new Date(reporte.fecha_creacion)));
    }
  };

  const cerrarModal = () => {
    if (!guardandoAccion) {
      setModalActivo(null);
      setErrorModal(null);
      setPeriodoParaRecuperar(null);
    }
  };

  // Invalidar caché tras éxito
  const invalidarConsultas = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['intervencion', idValido] }),
      queryClient.invalidateQueries({ queryKey: ['intervenciones'] }),
      queryClient.invalidateQueries({ queryKey: ['maquinas'] }),
      queryClient.invalidateQueries({ queryKey: ['notificaciones-contador'] }),
    ]);
  };

  // 7.2.1 Acción TOMAR directa
  const handleTomarDirecto = async () => {
    if (!reporte || idValido === null) return;
    setTomandoDirecto(true);
    try {
      await clienteApi.post(`/api/intervenciones/${idValido}/tomar`, {
        estado_esperado: reporte.estado,
      });
      notifications.show({
        color: 'green',
        message: 'Tomaste la intervención.',
      });
      await invalidarConsultas();
    } catch (err: unknown) {
      const mensaje =
        err instanceof ApiError && err.codigo === 'RESPONSABLE_SIN_CAMBIOS'
          ? 'Ya sos el responsable de esta intervención.'
          : mensajeError(err);
      notifications.show({
        color: 'red',
        message: mensaje,
      });
      if (requiereRecargar(err)) {
        await queryClient.invalidateQueries({ queryKey: ['intervencion', idValido] });
      }
    } finally {
      setTomandoDirecto(false);
    }
  };

  // Manejo de envío de las acciones
  const handleEjecutarAccion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reporte || idValido === null || !modalActivo) return;

    setErrorModal(null);
    const ahora = new Date();

    try {
      // 1. ASIGNAR / REASIGNAR
      if (modalActivo === 'ASIGNAR') {
        if (!destinatarioUsuarioId) {
          setErrorModal('Seleccioná a la persona responsable.');
          return;
        }
        const tieneRespActual = Boolean(reporte.responsable);
        const motivoTrim = motivoTexto.trim();
        if (tieneRespActual && motivoTrim.length === 0) {
          setErrorModal('Indicá el motivo.');
          return;
        }

        setGuardandoAccion(true);
        await clienteApi.put(`/api/intervenciones/${idValido}/responsable`, {
          usuario_id: Number(destinatarioUsuarioId),
          motivo: motivoTrim.length > 0 ? motivoTrim : undefined,
          estado_esperado: estadoAlAbrir,
        });

        notifications.show({ color: 'green', message: 'Responsable asignado.' });
        cerrarModal();
        await invalidarConsultas();
        return;
      }

      // 2. DESASIGNAR
      if (modalActivo === 'DESASIGNAR') {
        const motivoTrim = motivoTexto.trim();
        if (motivoTrim.length === 0) {
          setErrorModal('Indicá el motivo.');
          return;
        }

        setGuardandoAccion(true);
        await clienteApi.delete(`/api/intervenciones/${idValido}/responsable`, {
          motivo: motivoTrim,
          estado_esperado: estadoAlAbrir,
        });

        notifications.show({ color: 'green', message: 'Se quitó el responsable.' });
        cerrarModal();
        await invalidarConsultas();
        return;
      }

      // 3. INICIAR
      if (modalActivo === 'INICIAR') {
        const errMom = validarMomento(momentoAccion, reporte.fecha_creacion, ahora);
        if (errMom) {
          setErrorModal(errMom);
          return;
        }

        const fIniIso = momentoAIso(momentoAccion, reporte.fecha_creacion);
        const obsTrim = observacionTexto.trim();

        setGuardandoAccion(true);
        await clienteApi.post(`/api/intervenciones/${idValido}/iniciar`, {
          estado_esperado: estadoAlAbrir,
          fecha_inicio: fIniIso,
          observacion: obsTrim.length > 0 ? obsTrim : undefined,
        });

        notifications.show({ color: 'green', message: 'Trabajo iniciado.' });
        cerrarModal();
        await invalidarConsultas();
        return;
      }

      // 4. ESPERAR_REPUESTOS
      if (modalActivo === 'ESPERAR_REPUESTOS') {
        const obsTrim = observacionTexto.trim();
        if (obsTrim.length < 5) {
          setErrorModal('Completá la observación (al menos 5 caracteres).');
          return;
        }

        setGuardandoAccion(true);
        await clienteApi.post(`/api/intervenciones/${idValido}/espera-repuestos`, {
          estado_esperado: estadoAlAbrir,
          observacion: obsTrim,
        });

        notifications.show({ color: 'green', message: 'Quedó esperando repuestos.' });
        cerrarModal();
        await invalidarConsultas();
        return;
      }

      // 5. REANUDAR
      if (modalActivo === 'REANUDAR') {
        const obsTrim = observacionTexto.trim();

        setGuardandoAccion(true);
        await clienteApi.post(`/api/intervenciones/${idValido}/reanudar`, {
          estado_esperado: estadoAlAbrir,
          observacion: obsTrim.length > 0 ? obsTrim : undefined,
        });

        notifications.show({ color: 'green', message: 'Trabajo reanudado.' });
        cerrarModal();
        await invalidarConsultas();
        return;
      }

      // 6. FINALIZAR
      if (modalActivo === 'FINALIZAR') {
        const trabTrim = trabajoRealizadoTexto.trim();
        if (trabTrim.length < 5) {
          setErrorModal('Describí el trabajo realizado (al menos 5 caracteres).');
          return;
        }
        if (!ejecucionValor) {
          setErrorModal('Indicá si lo hizo personal propio o un servicio externo.');
          return;
        }

        const minimoFin = reporte.fecha_inicio || reporte.fecha_creacion;
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

        setGuardandoAccion(true);
        await clienteApi.post(`/api/intervenciones/${idValido}/finalizar`, {
          estado_esperado: estadoAlAbrir,
          trabajo_realizado: trabTrim,
          ejecucion: ejecucionValor,
          fecha_finalizacion: fFinIso,
          observacion: obsTrim.length > 0 ? obsTrim : undefined,
          maquina_recuperada: reqRecuperada,
          fecha_recuperacion: reqFechaRec,
          observacion_recuperacion: reqObsRec,
        });

        notifications.show({ color: 'green', message: 'Intervención finalizada.' });
        cerrarModal();
        await invalidarConsultas();
        return;
      }

      // 7. RESOLVER_AHORA
      if (modalActivo === 'RESOLVER_AHORA') {
        const isoInicio = fechaLocalAIso(fechaInicioResolver);
        if (!isoInicio) {
          setErrorModal('Indicá una fecha y hora de inicio válida.');
          return;
        }
        const errIni = validarMomento({ modo: 'otra', fecha: fechaInicioResolver }, reporte.fecha_creacion, ahora);
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

        setGuardandoAccion(true);
        await clienteApi.post(`/api/intervenciones/${idValido}/resolver-ahora`, {
          estado_esperado: estadoAlAbrir,
          fecha_inicio: isoInicio,
          trabajo_realizado: trabTrim,
          ejecucion: ejecucionValor,
          fecha_finalizacion: fFinIso,
          observacion: obsTrim.length > 0 ? obsTrim : undefined,
          maquina_recuperada: reqRecuperada,
          fecha_recuperacion: reqFechaRec,
          observacion_recuperacion: reqObsRec,
        });

        notifications.show({ color: 'green', message: 'Intervención registrada como resuelta.' });
        cerrarModal();
        await invalidarConsultas();
        return;
      }

      // 8. CANCELAR
      if (modalActivo === 'CANCELAR') {
        const motTrim = motivoTexto.trim();
        if (motTrim.length < 5) {
          setErrorModal('Indicá el motivo (al menos 5 caracteres).');
          return;
        }

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

        setGuardandoAccion(true);
        await clienteApi.post(`/api/intervenciones/${idValido}/cancelar`, {
          estado_esperado: estadoAlAbrir,
          motivo: motTrim,
          maquina_recuperada: reqRecuperada,
          fecha_recuperacion: reqFechaRec,
          observacion_recuperacion: reqObsRec,
        });

        notifications.show({ color: 'green', message: 'Intervención cancelada.' });
        cerrarModal();
        await invalidarConsultas();
        return;
      }

      // 9. REABRIR
      if (modalActivo === 'REABRIR') {
        const motTrim = motivoTexto.trim();
        if (motTrim.length < 5) {
          setErrorModal('Indicá el motivo (al menos 5 caracteres).');
          return;
        }

        let maqDet: boolean | undefined = undefined;
        let desdeIso: string | undefined = undefined;
        let obsDetTrim: string | undefined = undefined;

        if (!periodoAbierto) {
          if (maquinaDetenidaReabrir === null) {
            setErrorModal('Indicá si la máquina volvió a detenerse.');
            return;
          }
          maqDet = maquinaDetenidaReabrir;
          if (maquinaDetenidaReabrir) {
            const minDet = minimoNuevaDetencion(reporte);
            const errMom = validarMomento(momentoAccion, minDet, ahora);
            if (errMom) {
              setErrorModal(errMom);
              return;
            }
            desdeIso = momentoAIso(momentoAccion, minDet);
            obsDetTrim = observacionTexto.trim() || undefined;
          }
        }

        setGuardandoAccion(true);
        await clienteApi.post(`/api/intervenciones/${idValido}/reabrir`, {
          estado_esperado: estadoAlAbrir,
          motivo: motTrim,
          maquina_detenida: maqDet,
          desde: desdeIso,
          observacion_detencion: obsDetTrim,
        });

        notifications.show({ color: 'green', message: 'Intervención reabierta.' });
        cerrarModal();
        await invalidarConsultas();
        return;
      }

      // 10. REGISTRAR_DETENCION
      if (modalActivo === 'REGISTRAR_DETENCION') {
        const errMom = validarMomento(momentoAccion, reporte.fecha_creacion, ahora);
        if (errMom) {
          setErrorModal(errMom);
          return;
        }
        const desdeIso = momentoAIso(momentoAccion, reporte.fecha_creacion);

        const obsTrim = observacionTexto.trim();
        if (obsTrim.length < 5) {
          setErrorModal('Completá qué pasó (al menos 5 caracteres).');
          return;
        }

        setGuardandoAccion(true);
        await clienteApi.post(`/api/intervenciones/${idValido}/registrar-detencion`, {
          estado_esperado: estadoAlAbrir,
          desde: desdeIso,
          observacion: obsTrim,
        });

        notifications.show({ color: 'green', message: 'Detención registrada.' });
        cerrarModal();
        await invalidarConsultas();
        return;
      }

      // 11. ELIMINAR
      if (modalActivo === 'ELIMINAR') {
        const motTrim = motivoTexto.trim();
        if (motTrim.length < 5) {
          setErrorModal('Indicá el motivo (al menos 5 caracteres).');
          return;
        }

        let reqRecuperada: boolean | undefined = undefined;
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
              reqObsRec = observacionRecuperacion.trim() || undefined;
            }
          }
        }

        setGuardandoAccion(true);
        await clienteApi.post(`/api/intervenciones/${idValido}/eliminar`, {
          motivo: motTrim,
          maquina_recuperada: reqRecuperada,
          observacion_recuperacion: reqObsRec,
        });

        notifications.show({
          color: 'green',
          message: `Intervención N.º ${idValido} eliminada.`,
        });
        cerrarModal();
        navigate(destinoVolver);
        queryClient.removeQueries({ queryKey: ['intervencion', idValido] });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['intervenciones'] }),
          queryClient.invalidateQueries({ queryKey: ['maquinas'] }),
          queryClient.invalidateQueries({ queryKey: ['notificaciones-contador'] }),
        ]);
        return;
      }

      // 12. CONFIRMAR RECUPERACIÓN (Sección 7.4)
      if (modalActivo === 'CONFIRMAR_RECUPERACION' && periodoParaRecuperar) {
        const errMom = validarMomento(momentoAccion, periodoParaRecuperar.desde, ahora);
        if (errMom) {
          setErrorModal(errMom);
          return;
        }
        const fRecIso = momentoAIso(momentoAccion, periodoParaRecuperar.desde);
        const obsTrim = observacionTexto.trim();

        setGuardandoAccion(true);
        await clienteApi.post(`/api/maquinas/${reporte.maquina.id}/confirmar-recuperacion`, {
          periodo_ids: [periodoParaRecuperar.id],
          fecha_recuperacion: fRecIso,
          observacion: obsTrim.length > 0 ? obsTrim : undefined,
        });

        notifications.show({ color: 'green', message: 'Listo: la máquina volvió a funcionar.' });
        cerrarModal();
        await invalidarConsultas();
        return;
      }
    } catch (err: unknown) {
      if (requiereRecargar(err)) {
        cerrarModal();
        notifications.show({
          color: 'red',
          message: mensajeError(err),
        });
        await queryClient.invalidateQueries({ queryKey: ['intervencion', idValido] });
      } else {
        setErrorModal(mensajeError(err));
      }
    } finally {
      setGuardandoAccion(false);
    }
  };

  // Manejo de carga
  if (isLoading) {
    return (
      <Center py="xl">
        <Loader color="marca" />
      </Center>
    );
  }

  // Manejo de 404 o no encontrado
  if (idValido === null || isError || !reporte) {
    return (
      <PantallaVacia
        titulo="No encontramos esta intervención."
        accion={
          <Button variant="default" onClick={() => navigate(destinoVolver)}>
            Volver a Intervenciones
          </Button>
        }
      />
    );
  }

  // Clasificación de acciones disponibles
  const tieneResponsable = Boolean(reporte.responsable);
  const { principal, visibles, menu } = ordenarAcciones(reporte.acciones_disponibles);
  const menuNormales = menu.filter((a) => a !== 'CANCELAR' && a !== 'ELIMINAR');
  const menuPeligrosas = menu.filter((a) => a === 'CANCELAR' || a === 'ELIMINAR');

  const tieneDetencionAbierta = Boolean(periodoAbierto);
  const eventos = eventosHistorial(reporte);

  return (
    <Stack gap="lg">
      {/* 6.2 Cabecera */}
      <Stack gap="xs">
        <Anchor
          component={Link}
          to={destinoVolver}
          size="sm"
          c="dimmed"
          style={{ textDecoration: 'none' }}
        >
          ← Intervenciones
        </Anchor>

        <Group gap="sm" align="center" wrap="wrap">
          <Title order={2} c="#0f172a">
            Intervención N.º {reporte.id}
          </Title>
          <EstadoBadge entidad="intervencion" estado={reporte.estado} size="lg" />
          {tieneDetencionAbierta && (
            <Badge color="red" variant="filled" size="md">
              Máquina detenida
            </Badge>
          )}
        </Group>

          {/* 7.1 Barra de acciones */}
          {reporte.acciones_disponibles.length > 0 && (
            <Group gap="xs" wrap="wrap">
              {principal && (
                <Button
                  color="marca"
                  onClick={() => abrirModal(principal as CodigoAccion)}
                >
                  {etiquetaAccion(principal, tieneResponsable)}
                </Button>
              )}

              {visibles.map((a) => {
                if (a === 'TOMAR') {
                  return (
                    <Button
                      key={a}
                      variant="default"
                      loading={tomandoDirecto}
                      onClick={handleTomarDirecto}
                    >
                      Tomar
                    </Button>
                  );
                }
                return (
                  <Button
                    key={a}
                    variant="default"
                    onClick={() => abrirModal(a as CodigoAccion)}
                  >
                    {etiquetaAccion(a, tieneResponsable)}
                  </Button>
                );
              })}

              {menu.length > 0 && (
                <Menu position="bottom-end" shadow="md" withinPortal>
                  <Menu.Target>
                    <Button
                      variant="default"
                      rightSection={<IconDotsVertical size={16} />}
                    >
                      Más acciones
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {menuNormales.map((a) => (
                      <Menu.Item
                        key={a}
                        onClick={() => abrirModal(a as CodigoAccion)}
                      >
                        {etiquetaAccion(a, tieneResponsable)}
                      </Menu.Item>
                    ))}
                    {menuPeligrosas.length > 0 && menuNormales.length > 0 && (
                      <Menu.Divider />
                    )}
                    {menuPeligrosas.map((a) => (
                      <Menu.Item
                        key={a}
                        color="red"
                        onClick={() => abrirModal(a as CodigoAccion)}
                      >
                        {etiquetaAccion(a, tieneResponsable)}
                      </Menu.Item>
                    ))}
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
          )}
      </Stack>

      {/* 6.3 Distribución */}
      <Grid gap="md">
        {/* Columna principal */}
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="md">
            {/* 1. Falla reportada */}
            <Card withBorder radius="md" p="md">
              <Stack gap="xs">
                <Text fw={700} size="sm" tt="uppercase" c="#64748b">
                  Falla reportada
                </Text>
                <Text fw={600} size="md" c="#0f172a">
                  {reporte.descripcion}
                </Text>
                {reporte.observaciones && (
                  <Text size="sm" c="#475569" style={{ whiteSpace: 'pre-wrap' }}>
                    {reporte.observaciones}
                  </Text>
                )}
              </Stack>
            </Card>

            {/* 2. Trabajo realizado */}
            {reporte.trabajo_realizado && (
              <Card withBorder radius="md" p="md">
                <Stack gap="xs">
                  <Text fw={700} size="sm" tt="uppercase" c="#64748b">
                    Trabajo realizado
                  </Text>
                  <Text size="sm" c="#0f172a" style={{ whiteSpace: 'pre-wrap' }}>
                    {reporte.trabajo_realizado}
                  </Text>
                  <Group justify="space-between" mt="xs" wrap="wrap">
                    <Text size="xs" c="dimmed">
                      Lo hizo:{' '}
                      {reporte.ejecucion === 'EXTERNA'
                        ? 'Servicio externo'
                        : 'Personal propio'}
                    </Text>
                    {reporte.fecha_finalizacion && (
                      <Text size="xs" c="dimmed">
                        Finalizado: {formatFechaHora(reporte.fecha_finalizacion)}
                      </Text>
                    )}
                  </Group>
                </Stack>
              </Card>
            )}

            {/* 3. Historial */}
            <Card withBorder radius="md" p="md">
              <Stack gap="md">
                <Text fw={700} size="sm" tt="uppercase" c="#64748b">
                  Historial
                </Text>
                {eventos.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    Sin eventos registrados.
                  </Text>
                ) : (
                  <Timeline active={eventos.length} bulletSize={20} lineWidth={2}>
                    {eventos.map((ev) => {
                      const colorPunto = ev.estado
                        ? obtenerInfoEstado('intervencion', ev.estado).color
                        : 'gray';
                      return (
                        <Timeline.Item
                          key={ev.clave}
                          color={colorPunto}
                          title={<Text fw={600} size="sm">{ev.titulo}</Text>}
                        >
                          <Text size="xs" c="dimmed">
                            {formatFechaHora(ev.fecha)} · por {nombreCompleto(ev.persona)}
                          </Text>
                          {ev.mostrarRegistrado && (
                            <Text size="xs" c="dimmed">
                              cargado el {formatFechaHora(ev.registrado)}
                            </Text>
                          )}
                          {ev.detalle && (
                            <Text size="xs" c="#64748b" lineClamp={3} mt={2}>
                              {ev.detalle}
                            </Text>
                          )}
                        </Timeline.Item>
                      );
                    })}
                  </Timeline>
                )}
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>

        {/* Columna lateral */}
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="md">
            {/* 1. Datos */}
            <Card withBorder radius="md" p="md">
              <Stack gap="xs">
                <Text fw={700} size="sm" tt="uppercase" c="#64748b">
                  Datos
                </Text>

                <Group justify="space-between" align="flex-start">
                  <Text size="sm" c="dimmed">Máquina</Text>
                  <Text size="sm" fw={600} ta="right">
                    {etiquetaMaquina(reporte.maquina)}
                  </Text>
                </Group>

                <Group justify="space-between" align="flex-start">
                  <Text size="sm" c="dimmed">Sector</Text>
                  <Text size="sm">{reporte.maquina.sector.nombre}</Text>
                </Group>

                <Group justify="space-between" align="flex-start">
                  <Text size="sm" c="dimmed">Estado de la máquina</Text>
                  <EstadoBadge entidad="maquina" estado={reporte.maquina.estado} />
                </Group>

                <Group justify="space-between" align="flex-start">
                  <Text size="sm" c="dimmed">Reportada por</Text>
                  <Text size="sm">
                    {nombreCompleto(reporte.creado_por)} · {reporte.creado_por.legajo || '—'}
                  </Text>
                </Group>

                <Group justify="space-between" align="flex-start">
                  <Text size="sm" c="dimmed">Reportada</Text>
                  <Text size="sm">{formatFechaHora(reporte.fecha_creacion)}</Text>
                </Group>

                <Group justify="space-between" align="flex-start">
                  <Text size="sm" c="dimmed">Responsable</Text>
                  <Text size="sm">
                    {reporte.responsable ? nombreCompleto(reporte.responsable) : 'Sin asignar'}
                  </Text>
                </Group>

                <Group justify="space-between" align="flex-start">
                  <Text size="sm" c="dimmed">Inicio del trabajo</Text>
                  <Text size="sm">
                    {reporte.fecha_inicio ? formatFechaHora(reporte.fecha_inicio) : '—'}
                  </Text>
                </Group>

                {reporte.fecha_finalizacion && (
                  <Group justify="space-between" align="flex-start">
                    <Text size="sm" c="dimmed">Finalización</Text>
                    <Text size="sm">{formatFechaHora(reporte.fecha_finalizacion)}</Text>
                  </Group>
                )}
              </Stack>
            </Card>

            {/* 2. Tiempos */}
            <Card withBorder radius="md" p="md">
              <Stack gap="xs">
                <Text fw={700} size="sm" tt="uppercase" c="#64748b">
                  Tiempos
                </Text>

                <Group justify="space-between" align="center">
                  <Text size="sm" c="dimmed">Espera hasta empezar</Text>
                  <Group gap={6}>
                    <Text size="sm" fw={600}>
                      {formatDuracion(reporte.tiempos.espera_minutos)}
                    </Text>
                    {reporte.tiempos.espera_en_curso && (
                      <Badge color="yellow" variant="light" size="xs">en curso</Badge>
                    )}
                  </Group>
                </Group>

                <Group justify="space-between" align="center">
                  <Text size="sm" c="dimmed">Duración del trabajo</Text>
                  <Group gap={6}>
                    <Text size="sm" fw={600}>
                      {formatDuracion(reporte.tiempos.duracion_bruta_minutos)}
                    </Text>
                    {reporte.tiempos.trabajo_en_curso && (
                      <Badge color="yellow" variant="light" size="xs">en curso</Badge>
                    )}
                  </Group>
                </Group>

                <Box>
                  <Group justify="space-between" align="center">
                    <Text size="sm" c="dimmed">Trabajo efectivo</Text>
                    <Group gap={6}>
                      <Text size="sm" fw={600}>
                        {formatDuracion(reporte.tiempos.duracion_neta_minutos)}
                      </Text>
                      {reporte.estado === 'EN_PROCESO' && (
                        <Badge color="yellow" variant="light" size="xs">en curso</Badge>
                      )}
                    </Group>
                  </Group>
                  <Text size="xs" c="dimmed">sin contar la espera de repuestos</Text>
                </Box>

                <Box>
                  <Group justify="space-between" align="center">
                    <Text size="sm" c="dimmed">Tiempo total</Text>
                    <Text size="sm" fw={600}>
                      {formatDuracion(reporte.tiempos.tiempo_total_minutos)}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">del reporte al cierre</Text>
                </Box>

                <Group justify="space-between" align="center">
                  <Text size="sm" c="dimmed">Máquina detenida</Text>
                  <Group gap={6}>
                    <Text size="sm" fw={600}>
                      {formatDuracion(reporte.tiempos.inactividad_minutos)}
                    </Text>
                    {reporte.tiempos.inactividad_en_curso && (
                      <Badge color="yellow" variant="light" size="xs">en curso</Badge>
                    )}
                  </Group>
                </Group>
              </Stack>
            </Card>

            {/* 3. Detenciones de la máquina */}
            <Card withBorder radius="md" p="md">
              <Stack gap="sm">
                <Text fw={700} size="sm" tt="uppercase" c="#64748b">
                  Detenciones de la máquina
                </Text>

                {!reporte.periodos_detencion || reporte.periodos_detencion.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    Esta falla no detuvo la máquina.
                  </Text>
                ) : (
                  reporte.periodos_detencion.map((p) => {
                    const estaAbierto = p.esta_abierto || p.hasta === null;
                    return (
                      <Card key={p.id} withBorder radius="sm" p="xs" bg="#f8fafc">
                        <Stack gap={4}>
                          <Group justify="space-between" align="center" wrap="wrap">
                            <Text size="sm" fw={600}>
                              {formatFechaHora(p.desde)} →{' '}
                              {estaAbierto ? (
                                <Text span c="red" fw={700}>
                                  sigue detenida
                                </Text>
                              ) : (
                                formatFechaHora(p.hasta)
                              )}
                            </Text>
                            <Group gap={6}>
                              <Text size="xs">
                                {formatDuracion(minutosEntre(p.desde, p.hasta, new Date()))}
                              </Text>
                              {estaAbierto && (
                                <Badge color="yellow" variant="light" size="xs">
                                  en curso
                                </Badge>
                              )}
                            </Group>
                          </Group>

                          <Text size="xs" c="dimmed">
                            Registrada por {nombreCompleto(p.abierto_por)}
                            {p.observacion ? `: ${p.observacion}` : ''}
                          </Text>

                          {!estaAbierto && p.confirmado_por && (
                            <Text size="xs" c="dimmed">
                              Volvió a funcionar, confirmado por {nombreCompleto(p.confirmado_por)}
                              {p.observacion_confirmacion ? ` (${p.observacion_confirmacion})` : ''}
                            </Text>
                          )}

                          {estaAbierto && puedeConfirmarRecuperacion && (
                            <Button
                              size="xs"
                              variant="light"
                              color="green"
                              mt={4}
                              leftSection={<IconCheck size={14} />}
                              onClick={() => {
                                setPeriodoParaRecuperar(p);
                                setModalActivo('CONFIRMAR_RECUPERACION');
                                setMomentoAccion({ modo: 'ahora', fecha: null });
                                setObservacionTexto('');
                                setErrorModal(null);
                              }}
                            >
                              Confirmar que volvió a funcionar
                            </Button>
                          )}
                        </Stack>
                      </Card>
                    );
                  })
                )}
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>

      {/* DIÁLOGOS DE ACCIONES */}

      {/* 1. Modal Editar */}
      <ModalEditarReporte
        abierto={modalActivo === 'EDITAR'}
        onCerrar={cerrarModal}
        intervencionId={idValido}
        estadoEsperado={estadoAlAbrir}
        descripcionInicial={reporte.descripcion}
        observacionesIniciales={reporte.observaciones}
      />

      {/* 2. Modal Asignar / Reasignar */}
      <Modal
        opened={modalActivo === 'ASIGNAR'}
        onClose={cerrarModal}
        title={tieneResponsable ? 'Reasignar responsable' : 'Asignar responsable'}
        size="md"
        centered
        fullScreen={isMobile}
      >
        <form onSubmit={handleEjecutarAccion} noValidate>
          <Stack gap="md">
            {errorModal && (
              <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                {errorModal}
              </Alert>
            )}

            <Select
              label="Responsable"
              placeholder={cargandoResponsables ? 'Cargando personas...' : 'Elegir responsable'}
              data={(responsablesHabilitados || [])
                .filter((u) => u.id !== reporte.responsable?.id)
                .map((u) => ({
                  value: String(u.id),
                  label: `${nombreCompleto(u)} · ${u.legajo}`,
                }))}
              value={destinatarioUsuarioId}
              onChange={setDestinatarioUsuarioId}
              disabled={guardandoAccion || cargandoResponsables}
              nothingFoundMessage="No hay personas habilitadas para esta máquina."
            />

            <Textarea
              label={`Motivo${tieneResponsable ? '' : ' (opcional)'}`}
              placeholder="Explicá el motivo de la asignación"
              value={motivoTexto}
              onChange={(e) => setMotivoTexto(e.currentTarget.value)}
              disabled={guardandoAccion}
            />

            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="default" onClick={cerrarModal} disabled={guardandoAccion}>
                Volver
              </Button>
              <Button
                type="submit"
                color="marca"
                loading={guardandoAccion}
                disabled={cargandoResponsables || !destinatarioUsuarioId}
              >
                {tieneResponsable ? 'Reasignar' : 'Asignar'}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* 3. Modal Quitar responsable */}
      <Modal
        opened={modalActivo === 'DESASIGNAR'}
        onClose={cerrarModal}
        title="Quitar responsable"
        size="md"
        centered
        fullScreen={isMobile}
      >
        <form onSubmit={handleEjecutarAccion} noValidate>
          <Stack gap="md">
            {errorModal && (
              <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                {errorModal}
              </Alert>
            )}

            <Text size="sm">
              ¿Querés quitar a {reporte.responsable ? nombreCompleto(reporte.responsable) : 'la persona responsable'} de esta intervención?
            </Text>

            <Textarea
              label="Motivo"
              placeholder="Indicá el motivo por el cual se quita la responsabilidad"
              value={motivoTexto}
              onChange={(e) => setMotivoTexto(e.currentTarget.value)}
              disabled={guardandoAccion}
              required
            />

            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="default" onClick={cerrarModal} disabled={guardandoAccion}>
                Volver
              </Button>
              <Button type="submit" color="marca" loading={guardandoAccion}>
                Quitar responsable
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* 4. Modal Iniciar trabajo */}
      <Modal
        opened={modalActivo === 'INICIAR'}
        onClose={cerrarModal}
        title="Iniciar trabajo"
        size="md"
        centered
        fullScreen={isMobile}
      >
        <form onSubmit={handleEjecutarAccion} noValidate>
          <Stack gap="md">
            {errorModal && (
              <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                {errorModal}
              </Alert>
            )}

            {!reporte.responsable && (
              <Text size="sm" c="dimmed">
                Vas a quedar como responsable.
              </Text>
            )}

            <SelectorMomento
              label="¿Cuándo empezó?"
              opcionAhoraLabel="Ahora"
              minimo={reporte.fecha_creacion}
              value={momentoAccion}
              onChange={setMomentoAccion}
              disabled={guardandoAccion}
            />

            <Textarea
              label="Observación (opcional)"
              placeholder="Detalle inicial del trabajo"
              value={observacionTexto}
              onChange={(e) => setObservacionTexto(e.currentTarget.value)}
              disabled={guardandoAccion}
            />

            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="default" onClick={cerrarModal} disabled={guardandoAccion}>
                Volver
              </Button>
              <Button type="submit" color="marca" loading={guardandoAccion}>
                Iniciar trabajo
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* 5. Modal Esperar repuestos */}
      <Modal
        opened={modalActivo === 'ESPERAR_REPUESTOS'}
        onClose={cerrarModal}
        title="Esperar repuestos"
        size="md"
        centered
        fullScreen={isMobile}
      >
        <form onSubmit={handleEjecutarAccion} noValidate>
          <Stack gap="md">
            {errorModal && (
              <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                {errorModal}
              </Alert>
            )}

            <Textarea
              label="¿Qué falta?"
              placeholder="Rodamiento 6204, pedido al proveedor"
              value={observacionTexto}
              onChange={(e) => setObservacionTexto(e.currentTarget.value)}
              disabled={guardandoAccion}
              required
            />

            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="default" onClick={cerrarModal} disabled={guardandoAccion}>
                Volver
              </Button>
              <Button type="submit" color="marca" loading={guardandoAccion}>
                Esperar repuestos
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* 6. Modal Reanudar */}
      <Modal
        opened={modalActivo === 'REANUDAR'}
        onClose={cerrarModal}
        title="Reanudar trabajo"
        size="md"
        centered
        fullScreen={isMobile}
      >
        <form onSubmit={handleEjecutarAccion} noValidate>
          <Stack gap="md">
            {errorModal && (
              <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                {errorModal}
              </Alert>
            )}

            <Textarea
              label="Observación (opcional)"
              placeholder="Llegó el rodamiento"
              value={observacionTexto}
              onChange={(e) => setObservacionTexto(e.currentTarget.value)}
              disabled={guardandoAccion}
            />

            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="default" onClick={cerrarModal} disabled={guardandoAccion}>
                Volver
              </Button>
              <Button type="submit" color="marca" loading={guardandoAccion}>
                Reanudar
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* 7. Modal Finalizar */}
      <Modal
        opened={modalActivo === 'FINALIZAR'}
        onClose={cerrarModal}
        title="Finalizar intervención"
        size="lg"
        centered
        fullScreen={isMobile}
      >
        <form onSubmit={handleEjecutarAccion} noValidate>
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
              disabled={guardandoAccion}
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
                disabled={guardandoAccion}
              />
            </Stack>

            <SelectorMomento
              label="¿Cuándo terminó?"
              opcionAhoraLabel="Ahora"
              minimo={reporte.fecha_inicio || reporte.fecha_creacion}
              value={momentoAccion}
              onChange={setMomentoAccion}
              disabled={guardandoAccion}
            />

            <Textarea
              label="Observación (opcional)"
              placeholder="Detalles adicionales del cierre"
              value={observacionTexto}
              onChange={(e) => setObservacionTexto(e.currentTarget.value)}
              disabled={guardandoAccion}
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
                disabled={guardandoAccion}
              />
            )}

            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="default" onClick={cerrarModal} disabled={guardandoAccion}>
                Volver
              </Button>
              <Button type="submit" color="marca" loading={guardandoAccion}>
                Finalizar
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* 8. Modal Registrar como resuelta */}
      <Modal
        opened={modalActivo === 'RESOLVER_AHORA'}
        onClose={cerrarModal}
        title="Registrar como resuelta"
        size="lg"
        centered
        fullScreen={isMobile}
      >
        <form onSubmit={handleEjecutarAccion} noValidate>
          <Stack gap="md">
            {errorModal && (
              <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                {errorModal}
              </Alert>
            )}

            <Text size="sm" c="dimmed">
              Para fallas que ya se arreglaron sin pasar por 'Iniciar trabajo'.
            </Text>

            <DateTimePicker
              label="¿Cuándo empezó el arreglo?"
              valueFormat="DD/MM/YYYY HH:mm"
              value={fechaInicioResolver}
              onChange={(val: unknown) => {
                const str = typeof val === 'string' ? val : (val as any) instanceof Date ? fechaLocalTexto(val as Date) : '';
                setFechaInicioResolver(str);
              }}
              minDate={fechaLocalTexto(new Date(reporte.fecha_creacion))}
              maxDate={fechaLocalTexto(new Date())}
              disabled={guardandoAccion}
              required
            />

            <Textarea
              label="Trabajo realizado"
              placeholder="Describí las tareas que se hicieron (al menos 5 caracteres)"
              value={trabajoRealizadoTexto}
              onChange={(e) => setTrabajoRealizadoTexto(e.currentTarget.value)}
              disabled={guardandoAccion}
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
                disabled={guardandoAccion}
              />
            </Stack>

            <SelectorMomento
              label="¿Cuándo terminó?"
              opcionAhoraLabel="Ahora"
              minimo={fechaInicioResolver ? fechaLocalAIso(fechaInicioResolver) : reporte.fecha_creacion}
              value={momentoAccion}
              onChange={setMomentoAccion}
              disabled={guardandoAccion}
            />

            <Textarea
              label="Observación (opcional)"
              placeholder="Detalles adicionales del arreglo"
              value={observacionTexto}
              onChange={(e) => setObservacionTexto(e.currentTarget.value)}
              disabled={guardandoAccion}
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
                disabled={guardandoAccion}
              />
            )}

            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="default" onClick={cerrarModal} disabled={guardandoAccion}>
                Volver
              </Button>
              <Button type="submit" color="marca" loading={guardandoAccion}>
                Registrar como resuelta
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* 9. Modal Cancelar intervención */}
      <Modal
        opened={modalActivo === 'CANCELAR'}
        onClose={cerrarModal}
        title="Cancelar intervención"
        size="md"
        centered
        fullScreen={isMobile}
      >
        <form onSubmit={handleEjecutarAccion} noValidate>
          <Stack gap="md">
            {errorModal && (
              <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                {errorModal}
              </Alert>
            )}

            <Textarea
              label="Motivo"
              placeholder="Indicá el motivo de la cancelación (al menos 5 caracteres)"
              value={motivoTexto}
              onChange={(e) => setMotivoTexto(e.currentTarget.value)}
              disabled={guardandoAccion}
              required
            />

            {periodoAbierto && (
              <SeccionRecuperacionMaquina
                puedeConfirmar={puedeConfirmarRecuperacion}
                minimoDesde={periodoAbierto.desde}
                primeraOpcionFechaLabel="Ahora"
                maquinaRecuperada={maquinaRecuperada}
                onMaquinaRecuperadaChange={setMaquinaRecuperada}
                momentoRecuperacion={momentoRecuperacion}
                onMomentoRecuperacionChange={setMomentoRecuperacion}
                observacionRecuperacion={observacionRecuperacion}
                onObservacionRecuperacionChange={setObservacionRecuperacion}
                disabled={guardandoAccion}
              />
            )}

            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="default" onClick={cerrarModal} disabled={guardandoAccion}>
                Volver
              </Button>
              <Button type="submit" color="red" loading={guardandoAccion}>
                Cancelar intervención
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* 10. Modal Reabrir */}
      <Modal
        opened={modalActivo === 'REABRIR'}
        onClose={cerrarModal}
        title="Reabrir intervención"
        size="md"
        centered
        fullScreen={isMobile}
      >
        <form onSubmit={handleEjecutarAccion} noValidate>
          <Stack gap="md">
            {errorModal && (
              <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                {errorModal}
              </Alert>
            )}

            <Textarea
              label="Motivo"
              placeholder="Indicá el motivo de la reapertura (al menos 5 caracteres)"
              value={motivoTexto}
              onChange={(e) => setMotivoTexto(e.currentTarget.value)}
              disabled={guardandoAccion}
              required
            />

            {!periodoAbierto && (
              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  ¿La máquina volvió a detenerse?
                </Text>
                <SegmentedControl
                  value={
                    maquinaDetenidaReabrir === true
                      ? 'si'
                      : maquinaDetenidaReabrir === false
                      ? 'no'
                      : ''
                  }
                  onChange={(val) => setMaquinaDetenidaReabrir(val === 'si')}
                  data={[
                    { label: 'Sí', value: 'si' },
                    { label: 'No', value: 'no' },
                  ]}
                  disabled={guardandoAccion}
                />

                {maquinaDetenidaReabrir === true && (
                  <Stack gap="xs" mt="xs">
                    <SelectorMomento
                      label="¿Desde cuándo?"
                      opcionAhoraLabel="Ahora"
                      minimo={minimoNuevaDetencion(reporte)}
                      value={momentoAccion}
                      onChange={setMomentoAccion}
                      disabled={guardandoAccion}
                    />
                    <Textarea
                      label="Observación de la detención (opcional)"
                      value={observacionTexto}
                      onChange={(e) => setObservacionTexto(e.currentTarget.value)}
                      disabled={guardandoAccion}
                    />
                  </Stack>
                )}
              </Stack>
            )}

            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="default" onClick={cerrarModal} disabled={guardandoAccion}>
                Volver
              </Button>
              <Button type="submit" color="marca" loading={guardandoAccion}>
                Reabrir
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* 11. Modal Registrar detención */}
      <Modal
        opened={modalActivo === 'REGISTRAR_DETENCION'}
        onClose={cerrarModal}
        title="Registrar detención"
        size="md"
        centered
        fullScreen={isMobile}
      >
        <form onSubmit={handleEjecutarAccion} noValidate>
          <Stack gap="md">
            {errorModal && (
              <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                {errorModal}
              </Alert>
            )}

            <SelectorMomento
              label="¿Desde cuándo está detenida?"
              opcionAhoraLabel="Ahora"
              minimo={reporte.fecha_creacion}
              value={momentoAccion}
              onChange={setMomentoAccion}
              disabled={guardandoAccion}
            />

            <Textarea
              label="Qué pasó"
              placeholder="Se paró al volver a arrancarla"
              value={observacionTexto}
              onChange={(e) => setObservacionTexto(e.currentTarget.value)}
              disabled={guardandoAccion}
              required
            />

            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="default" onClick={cerrarModal} disabled={guardandoAccion}>
                Volver
              </Button>
              <Button type="submit" color="marca" loading={guardandoAccion}>
                Registrar detención
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* 12. Modal Eliminar */}
      <Modal
        opened={modalActivo === 'ELIMINAR'}
        onClose={cerrarModal}
        title="Eliminar intervención"
        size="md"
        centered
        fullScreen={isMobile}
      >
        <form onSubmit={handleEjecutarAccion} noValidate>
          <Stack gap="md">
            <Alert color="yellow" variant="light">
              Se usa para reportes cargados por error. La intervención deja de aparecer en las listas.
            </Alert>

            {errorModal && (
              <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                {errorModal}
              </Alert>
            )}

            <Textarea
              label="Motivo"
              placeholder="Indicá el motivo de la eliminación (al menos 5 caracteres)"
              value={motivoTexto}
              onChange={(e) => setMotivoTexto(e.currentTarget.value)}
              disabled={guardandoAccion}
              required
            />

            {periodoAbierto && (
              <SeccionRecuperacionMaquina
                puedeConfirmar={puedeConfirmarRecuperacion}
                incluyeFecha={false}
                maquinaRecuperada={maquinaRecuperada}
                onMaquinaRecuperadaChange={setMaquinaRecuperada}
                momentoRecuperacion={momentoRecuperacion}
                onMomentoRecuperacionChange={setMomentoRecuperacion}
                observacionRecuperacion={observacionRecuperacion}
                onObservacionRecuperacionChange={setObservacionRecuperacion}
                disabled={guardandoAccion}
              />
            )}

            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="default" onClick={cerrarModal} disabled={guardandoAccion}>
                Volver
              </Button>
              <Button type="submit" color="red" loading={guardandoAccion}>
                Eliminar
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* 13. Modal Confirmar que la máquina volvió a funcionar (Sección 7.4) */}
      <Modal
        opened={modalActivo === 'CONFIRMAR_RECUPERACION'}
        onClose={cerrarModal}
        title="Confirmar que la máquina volvió a funcionar"
        size="md"
        centered
        fullScreen={isMobile}
      >
        <form onSubmit={handleEjecutarAccion} noValidate>
          <Stack gap="md">
            {errorModal && (
              <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                {errorModal}
              </Alert>
            )}

            {periodoParaRecuperar && (
              <SelectorMomento
                label="¿Desde cuándo funciona?"
                opcionAhoraLabel="Ahora"
                minimo={periodoParaRecuperar.desde}
                value={momentoAccion}
                onChange={setMomentoAccion}
                disabled={guardandoAccion}
              />
            )}

            <Textarea
              label="Observación (opcional)"
              placeholder="Detalle de la recuperación de la máquina"
              value={observacionTexto}
              onChange={(e) => setObservacionTexto(e.currentTarget.value)}
              disabled={guardandoAccion}
            />

            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="default" onClick={cerrarModal} disabled={guardandoAccion}>
                Volver
              </Button>
              <Button type="submit" color="green" loading={guardandoAccion}>
                Confirmar que volvió a funcionar
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}

export default DetalleIntervencion;
