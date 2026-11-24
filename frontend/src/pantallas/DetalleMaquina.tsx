import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Grid, Paper, Skeleton, Stack, Title } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../api/cliente';
import {
  DetencionAbiertaMaquina,
  InactividadMaquina,
  IntervencionLista,
  MaquinaLista,
} from '../api/tipos';
import { useAuth } from '../auth/AuthContext';
import {
  accionesMaquina,
  rangoUltimosDias,
  CodigoAccionMaquina,
} from '../lib/maquinas';
import { rangoDiasAIso } from '../lib/fechas';
import { parsearId } from '../lib/formato';
import { ApiError, mensajeError } from '../lib/errores';
import { useEsCelular } from '../lib/useEsCelular';
import { ModalConfirmarRecuperacion } from '../componentes/acciones/ModalConfirmarRecuperacion';
import { ModalMaquina } from '../componentes/ModalMaquina';
import { BloqueMedidoresMaquina } from '../componentes/medidores/BloqueMedidoresMaquina';
import { BloquePlanesMaquina } from '../componentes/preventivos/BloquePlanesMaquina';
import { BloqueRutinasMaquina } from '../componentes/rutinas/BloqueRutinasMaquina';
import { BloqueInactividadMaquina, type RangoInactividad } from '../componentes/maquinas/BloqueInactividadMaquina';
import { CabeceraMaquina } from '../componentes/maquinas/CabeceraMaquina';
import { DatosMaquina } from '../componentes/maquinas/DatosMaquina';
import { DetencionesAbiertasMaquina } from '../componentes/maquinas/DetencionesAbiertasMaquina';
import { DialogosEstadoMaquina } from '../componentes/maquinas/DialogosEstadoMaquina';
import { IntervencionesMaquina } from '../componentes/maquinas/IntervencionesMaquina';

export function DetalleMaquina() {
  const { id: idParam } = useParams<{ id: string }>();
  const maquinaId = parsearId(idParam);
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // L1, 3: el mismo corte del celular que el resto del sistema
  const esCelular = useEsCelular();

  const volverA =
    (location.state as { volverA?: string } | null)?.volverA || '/maquinas';

  const permisos = usuario?.permisos || {};
  const puedeVerIntervenciones = Boolean(permisos['INTERVENCIONES_VER']);
  const puedeConsultarReportes = Boolean(permisos['REPORTES_CONSULTAR']);

  // Las consultas y el período quedan acá: no se pierden al cambiar de distribución
  const [rangoInactividad, setRangoInactividad] = useState<RangoInactividad>(() =>
    rangoUltimosDias(30, new Date())
  );

  const [accionActiva, setAccionActiva] = useState<CodigoAccionMaquina | null>(
    null
  );

  const maquinaQuery = useQuery({
    queryKey: ['maquina', maquinaId],
    queryFn: () => clienteApi.get<MaquinaLista>(`/api/maquinas/${maquinaId}`),
    enabled: maquinaId !== null,
    refetchInterval: 60_000,
    retry: false,
  });

  const detencionesQuery = useQuery({
    queryKey: ['maquina', maquinaId, 'detenciones'],
    queryFn: () =>
      clienteApi.get<DetencionAbiertaMaquina[]>(
        `/api/maquinas/${maquinaId}/detenciones-abiertas`
      ),
    enabled:
      maquinaId !== null && puedeVerIntervenciones && Boolean(maquinaQuery.data),
    refetchInterval: 60_000,
  });

  const intervencionesQuery = useQuery({
    queryKey: ['intervenciones', { maquina: maquinaId }],
    queryFn: () =>
      clienteApi.listar<IntervencionLista>('/api/intervenciones', {
        params: {
          maquina_id: maquinaId!,
          limit: 10,
        },
      }),
    enabled:
      maquinaId !== null && puedeVerIntervenciones && Boolean(maquinaQuery.data),
    refetchInterval: 60_000,
  });

  const { desde: isoDesde, hasta: isoHasta } = rangoDiasAIso(
    rangoInactividad.desde,
    rangoInactividad.hasta
  );

  const inactividadQuery = useQuery({
    queryKey: [
      'maquina',
      maquinaId,
      'inactividad',
      rangoInactividad.desde,
      rangoInactividad.hasta,
    ],
    queryFn: () =>
      clienteApi.get<InactividadMaquina>(`/api/maquinas/${maquinaId}/inactividad`, {
        params: {
          desde: isoDesde,
          hasta: isoHasta,
        },
      }),
    enabled:
      maquinaId !== null &&
      puedeConsultarReportes &&
      Boolean(maquinaQuery.data) &&
      Boolean(isoDesde && isoHasta),
    refetchInterval: 60_000,
    retry: false,
  });

  if (
    maquinaId === null ||
    (maquinaQuery.isError &&
      maquinaQuery.error instanceof ApiError &&
      maquinaQuery.error.status === 404)
  ) {
    return (
      <Paper withBorder p="xl" radius="md">
        <Stack align="center" gap="sm">
          <Title order={3}>No encontramos esta máquina.</Title>
          <Button component={Link} to="/maquinas" variant="light">
            Volver a Máquinas
          </Button>
        </Stack>
      </Paper>
    );
  }

  if (maquinaQuery.isPending) {
    return (
      <Stack gap="md">
        <Skeleton height={28} width={160} />
        <Skeleton height={42} width="50%" />
        <Skeleton height={240} radius="md" />
      </Stack>
    );
  }

  if (maquinaQuery.isError || !maquinaQuery.data) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />}>
        {mensajeError(maquinaQuery.error)}
      </Alert>
    );
  }

  const maquina = maquinaQuery.data;
  const detencionesAbiertas = detencionesQuery.data || [];
  const intervencionesLista = intervencionesQuery.data?.items || [];
  const totalIntervenciones = intervencionesQuery.data?.total ?? 0;
  const ahora = new Date();

  const { principal, botones, menu } = accionesMaquina(
    maquina,
    permisos,
    detencionesAbiertas.length
  );

  const dispararAccion = (codigo: CodigoAccionMaquina) => {
    if (codigo === 'REPORTAR_FALLA') {
      navigate(`/reportar?maquina=${maquina.id}`);
      return;
    }
    setAccionActiva(codigo);
  };

  const bloqueDatos = <DatosMaquina maquina={maquina} />;

  const bloqueIzquierda = (
    <Stack gap="md">
      {/* 6.4 Detenciones abiertas */}
      {puedeVerIntervenciones && detencionesAbiertas.length > 0 && (
        <DetencionesAbiertasMaquina detenciones={detencionesAbiertas} ahora={ahora} />
      )}

      {/* 6.9 Intervenciones de esta máquina */}
      {puedeVerIntervenciones && (
        <IntervencionesMaquina
          maquinaId={maquina.id}
          cargando={intervencionesQuery.isPending}
          intervenciones={intervencionesLista}
          total={totalIntervenciones}
          ahora={ahora}
        />
      )}

      {/* PV4: Medidores, con PLANES_GESTIONAR o MAQUINAS_REGISTRAR_LECTURAS */}
      <BloqueMedidoresMaquina maquinaId={maquina.id} maquinaActiva={maquina.activo} />

      {/* PV2: Planes preventivos, solo con PLANES_GESTIONAR */}
      <BloquePlanesMaquina maquinaId={maquina.id} />

      {/* RT1, 5.1: Tareas de rutina, con PLANES_GESTIONAR o REPORTES_CONSULTAR */}
      <BloqueRutinasMaquina maquinaId={maquina.id} maquinaActiva={maquina.activo} />

      {/* 6.10 Inactividad */}
      {puedeConsultarReportes && (
        <BloqueInactividadMaquina
          rango={rangoInactividad}
          onCambiarRango={setRangoInactividad}
          cargando={inactividadQuery.isPending}
          error={inactividadQuery.isError ? inactividadQuery.error : null}
          datos={inactividadQuery.data}
        />
      )}
    </Stack>
  );

  return (
    <Stack gap="md">
      {/* Cabecera (6.2) */}
      <CabeceraMaquina
        maquina={maquina}
        volverA={volverA}
        ahora={ahora}
        principal={principal}
        botones={botones}
        menu={menu}
        onAccion={dispararAccion}
      />

      {/* Distribución (6.3): en celular una sola columna con Datos primero */}
      {esCelular ? (
        <Stack gap="md">
          {bloqueDatos}
          {bloqueIzquierda}
        </Stack>
      ) : (
        <Grid gap="md">
          <Grid.Col span={8}>{bloqueIzquierda}</Grid.Col>
          <Grid.Col span={4}>{bloqueDatos}</Grid.Col>
        </Grid>
      )}

      {/* 6.5 Confirmar que volvió a funcionar */}
      <ModalConfirmarRecuperacion
        abierto={accionActiva === 'CONFIRMAR_RECUPERACION'}
        onCerrar={() => setAccionActiva(null)}
        maquinaId={maquina.id}
        periodos={detencionesAbiertas.map((d) => ({
          id: d.periodo.id,
          desde: d.periodo.desde,
        }))}
      />

      {/* 6.6 y 6.7 Fuera de servicio, volver a servicio, desactivar y reactivar */}
      <DialogosEstadoMaquina
        maquina={maquina}
        accionActiva={accionActiva}
        onCerrar={() => setAccionActiva(null)}
        cantidadDetencionesAbiertas={detencionesAbiertas.length}
        esCelular={esCelular}
      />

      {/* 6.8 Edición */}
      <ModalMaquina
        abierto={accionActiva === 'EDITAR'}
        onCerrar={() => setAccionActiva(null)}
        maquina={maquina}
      />
    </Stack>
  );
}
