import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Center, Group, Loader, Paper, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconCircleCheck } from '@tabler/icons-react';
import { clienteApi } from '../api/cliente';
import type { CuerpoRonda, MedidorRonda, Planta, RespuestaRonda, SectorLista } from '../api/tipos';
import { useAuth } from '../auth/AuthContext';
import { registrarGuardiaSalida } from '../app/salida';
import { mensajeError } from '../lib/errores';
import { useEsCelular } from '../lib/useEsCelular';
import {
  type Consecuencia,
  type FiltrosLecturas,
  type ValoresRonda,
  camposCompletos,
  camposConError,
  consecuenciasLectura,
  errorValorRonda,
  lecturasAMandar,
  leerFiltrosLecturas,
  parametrosFiltrosLecturas,
  resumenRonda,
  textoBotonGuardar,
  textoSalirSinGuardar,
} from '../lib/lecturas';
import { EncabezadoPagina } from '../componentes/EncabezadoPagina';
import { PantallaVacia } from '../componentes/PantallaVacia';
import { SinPermiso } from '../componentes/SinPermiso';
import { refrescarMedidores } from '../componentes/medidores/refrescar';
import { FiltrosRonda } from '../componentes/lecturas/FiltrosRonda';
import { TablaRonda } from '../componentes/lecturas/TablaRonda';
import { TarjetasRonda } from '../componentes/lecturas/TarjetasRonda';

/**
 * LE1, 4: la ronda de lecturas (D-030). Con MAQUINAS_REGISTRAR_LECTURAS se cargan; con solo
 * PLANES_GESTIONAR se mira, sin los campos ni el botón (4.4).
 */
export function Lecturas() {
  const { tienePermiso } = useAuth();
  const puedeCargar = tienePermiso('MAQUINAS_REGISTRAR_LECTURAS');
  if (!puedeCargar && !tienePermiso('PLANES_GESTIONAR')) {
    return <SinPermiso permisoRequerido="MAQUINAS_REGISTRAR_LECTURAS" />;
  }
  return <RondaLecturas puedeCargar={puedeCargar} />;
}

function RondaLecturas({ puedeCargar }: { puedeCargar: boolean }) {
  const esCelular = useEsCelular();
  const queryClient = useQueryClient();

  // 4.5: los filtros van en la URL, para compartir el enlace y volver con Atrás
  const [searchParams, setSearchParams] = useSearchParams();
  const filtros = leerFiltrosLecturas(searchParams);
  const params = parametrosFiltrosLecturas(filtros);
  const cambiarFiltros = (cambios: Partial<FiltrosLecturas>) =>
    setSearchParams(parametrosFiltrosLecturas({ ...filtros, ...cambios }));

  const { data, isPending, isError, refetch } = useQuery<MedidorRonda[]>({
    queryKey: ['medidores', 'ronda', params],
    queryFn: () => clienteApi.get<MedidorRonda[]>('/api/medidores/ronda', { params }),
  });
  // Las máquinas del filtro: las de la planta y el sector elegidos, atrasadas o no
  const paramsMaquinas = parametrosFiltrosLecturas({ ...filtros, maquina_id: null, solo_atrasados: false });
  const { data: paraMaquinas } = useQuery<MedidorRonda[]>({
    queryKey: ['medidores', 'ronda', paramsMaquinas],
    queryFn: () => clienteApi.get<MedidorRonda[]>('/api/medidores/ronda', { params: paramsMaquinas }),
    enabled: !esCelular,
  });
  const { data: plantas } = useQuery<Planta[]>({
    queryKey: ['plantas'],
    queryFn: () => clienteApi.get<Planta[]>('/api/plantas'),
    enabled: !esCelular,
  });
  const { data: sectores } = useQuery<SectorLista[]>({
    queryKey: ['sectores'],
    queryFn: () => clienteApi.get<SectorLista[]>('/api/sectores'),
  });

  const maquinas = useMemo(() => {
    const vistas = new Map<number, MedidorRonda['maquina']>();
    for (const m of paraMaquinas ?? []) vistas.set(m.maquina.id, m.maquina);
    return [...vistas.values()];
  }, [paraMaquinas]);

  const lista = data ?? [];
  const [valores, setValores] = useState<ValoresRonda>({});
  const [erroresApi, setErroresApi] = useState<Record<number, string>>({});
  const [guardados, setGuardados] = useState<Record<number, Consecuencia[]>>({});
  const [resumen, setResumen] = useState<{ texto: string; conErrores: boolean } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cambiarValor = (medidorId: number, valor: string | number) => {
    setValores((v) => ({ ...v, [medidorId]: valor }));
    // Al corregir, el error de la API y el resultado anterior de esa fila ya no valen
    setErroresApi(({ [medidorId]: _e, ...resto }) => resto);
    setGuardados(({ [medidorId]: _g, ...resto }) => resto);
  };

  const errores: Record<number, string | null> = {};
  for (const m of lista) errores[m.id] = erroresApi[m.id] ?? errorValorRonda(valores[m.id], m);
  const aMandar = lecturasAMandar(lista, valores);
  const conError = camposConError(lista, valores);

  // 4.2: salir con valores sin guardar pide confirmación
  const pendientes = camposCompletos(valores);
  const pendientesRef = useRef(pendientes);
  pendientesRef.current = pendientes;
  useEffect(
    () => registrarGuardiaSalida(() => (pendientesRef.current > 0 ? textoSalirSinGuardar(pendientesRef.current) : null)),
    []
  );
  const hayPendientes = pendientes > 0;
  useEffect(() => {
    if (!hayPendientes) return;
    const alSalir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', alSalir);
    return () => window.removeEventListener('beforeunload', alSalir);
  }, [hayPendientes]);

  const guardar = async () => {
    if (aMandar.length === 0 || conError > 0) return;
    const antes = lista;
    setGuardando(true);
    try {
      const cuerpo: CuerpoRonda = { lecturas: aMandar };
      const r = await clienteApi.post<RespuestaRonda>('/api/medidores/ronda', cuerpo);
      const nuevos: Record<number, Consecuencia[]> = {};
      const fallidos: Record<number, string> = {};
      for (const res of r.resultados) {
        const m = antes.find((x) => x.id === res.medidor_id);
        if (res.ok) nuevos[res.medidor_id] = consecuenciasLectura(m?.tareas ?? [], res.tareas, m?.unidad ?? '', r.generadas);
        else fallidos[res.medidor_id] = res.error;
      }
      // Las guardadas se vacían; las que fallaron conservan el valor para corregir
      setValores((v) => {
        const quedan = { ...v };
        for (const id of Object.keys(nuevos)) delete quedan[Number(id)];
        return quedan;
      });
      setGuardados((g) => ({ ...g, ...nuevos }));
      setErroresApi(fallidos);
      setResumen({ texto: resumenRonda(antes, r.resultados), conErrores: Object.keys(fallidos).length > 0 });
      // La ronda, la ficha, los planes y, si se generó alguna, las intervenciones
      await refrescarMedidores(queryClient);
      await queryClient.invalidateQueries({ queryKey: ['intervenciones'] });
    } catch (err) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  const vista = {
    medidores: lista,
    valores,
    onCambiarValor: cambiarValor,
    errores,
    guardados,
    puedeCargar,
    guardando,
  };

  return (
    <>
      <EncabezadoPagina titulo="Lecturas" subtitulo="La ronda de los medidores de las máquinas" />
      <Stack gap="md">
        {resumen && (
          <Alert
            color={resumen.conErrores ? 'yellow' : 'green'}
            icon={resumen.conErrores ? <IconAlertCircle size={16} /> : <IconCircleCheck size={16} />}
            withCloseButton
            onClose={() => setResumen(null)}
          >
            {resumen.texto}
          </Alert>
        )}

        <Paper withBorder p="md">
          <FiltrosRonda
            filtros={filtros}
            onCambiar={cambiarFiltros}
            plantas={plantas ?? []}
            sectores={sectores ?? []}
            maquinas={maquinas}
            enCelular={esCelular}
            puedeCargar={puedeCargar}
          />
        </Paper>

        {isPending ? (
          <Center py="xl">
            <Loader color="marca" />
          </Center>
        ) : isError ? (
          <Alert color="red" icon={<IconAlertCircle size={16} />} title="No se pudieron cargar los medidores">
            <Button size="xs" variant="light" color="red" onClick={() => refetch()}>
              Reintentar
            </Button>
          </Alert>
        ) : lista.length === 0 ? (
          <Paper withBorder p="xl">
            <PantallaVacia
              titulo={filtros.solo_atrasados ? 'No hay medidores atrasados.' : 'No hay medidores para mostrar.'}
              mensaje="Probá con otros filtros."
            />
          </Paper>
        ) : esCelular ? (
          <TarjetasRonda {...vista} />
        ) : (
          <Paper withBorder p="md">
            <TablaRonda {...vista} />
          </Paper>
        )}
      </Stack>

      {/* 4.1 y 4.3: el botón, fijo abajo, con la cantidad de campos completos */}
      {puedeCargar && lista.length > 0 && (
        <Paper withBorder shadow="md" p="sm" mt="md" style={{ position: 'sticky', bottom: 0, zIndex: 10 }}>
          <Group justify={esCelular ? 'center' : 'flex-end'} gap="sm" wrap="wrap">
            {conError > 0 && (
              <Text size="sm" c="red">
                Corregí los valores marcados para poder guardar.
              </Text>
            )}
            <Button
              color="marca"
              size={esCelular ? 'lg' : 'sm'}
              fullWidth={esCelular}
              onClick={guardar}
              loading={guardando}
              disabled={aMandar.length === 0 || conError > 0}
            >
              {textoBotonGuardar(aMandar.length, esCelular)}
            </Button>
          </Group>
        </Paper>
      )}
    </>
  );
}
