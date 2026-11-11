import React, { useState, useEffect, useMemo } from 'react';
import {
  Stack,
  Group,
  Select,
  Textarea,
  Button,
  Text,
  Alert,
  Card,
  Box,
  Title,
  Center,
  SimpleGrid,
  ComboboxParsedItem,
  OptionsFilter,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
} from '@tabler/icons-react';
import { useMediaQuery } from '@mantine/hooks';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { useAuth } from '../auth/AuthContext';
import { clienteApi } from '../api/cliente';
import { EncabezadoPagina } from '../componentes/EncabezadoPagina';
import { EstadoBadge } from '../componentes/EstadoBadge';
import { CORTE_CELULAR } from '../lib/celular';
import {
  etiquetaMaquina,
  agruparMaquinas,
  coincideMaquina,
  textoFallasAbiertas,
  normalizarTexto,
} from '../lib/maquinas';
import { nombreCompleto } from '../lib/personas';
import { formatFechaHora } from '../lib/formato';
import { mensajeError } from '../lib/errores';
import type { MaquinaLista, IntervencionCreada } from '../api/tipos';

export function ReportarFalla() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const esCelular = Boolean(useMediaQuery(CORTE_CELULAR));

  // Estados del formulario
  const [maquinaId, setMaquinaId] = useState<string | null>(null);
  const [detieneMaquina, setDetieneMaquina] = useState<boolean | null>(null);
  const [descripcion, setDescripcion] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Errores de validación
  const [errores, setErrores] = useState<{
    maquina?: string;
    detieneMaquina?: string;
    descripcion?: string;
    observaciones?: string;
  }>({});

  // Resultado de confirmación
  const [reporteCreado, setReporteCreado] = useState<IntervencionCreada | null>(null);

  // Hora actual para dato de control (actualiza cada minuto)
  const [ahora, setAhora] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setAhora(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Máquinas de la API
  const { data: maquinas = [], isLoading: cargandoMaquinas } = useQuery<MaquinaLista[]>({
    queryKey: ['maquinas'],
    queryFn: () => clienteApi.get<MaquinaLista[]>('/api/maquinas'),
    staleTime: 1000 * 60 * 5,
  });

  // Mapa de máquinas por ID para búsqueda rápida
  const maquinasMap = useMemo(() => {
    const map = new Map<string, MaquinaLista>();
    for (const m of maquinas) {
      map.set(String(m.id), m);
    }
    return map;
  }, [maquinas]);

  // Selección predeterminada según parámetro ?maquina=
  useEffect(() => {
    const preId = searchParams.get('maquina');
    if (preId && maquinasMap.has(preId)) {
      setMaquinaId(preId);
    }
  }, [searchParams, maquinasMap]);

  // Opciones agrupadas o planas para Select
  const selectData = useMemo(() => {
    if (maquinas.length === 0) return [];
    const sectoresIds = usuario?.sectores?.map((s) => s.id) || [];
    const { propias, otras } = agruparMaquinas(maquinas, sectoresIds);

    if (propias.length > 0 && otras.length > 0) {
      return [
        {
          group: 'Máquinas de mis sectores',
          items: propias.map((m) => ({
            value: String(m.id),
            label: etiquetaMaquina(m),
          })),
        },
        {
          group: 'Otras máquinas',
          items: otras.map((m) => ({
            value: String(m.id),
            label: etiquetaMaquina(m),
          })),
        },
      ];
    }

    const listaOrdenada = [...propias, ...otras];
    return listaOrdenada.map((m) => ({
      value: String(m.id),
      label: etiquetaMaquina(m),
    }));
  }, [maquinas, usuario]);

  // Filtro personalizado con coincideMaquina
  const selectFilter: OptionsFilter = useMemo(() => {
    return ({ options, search }) => {
      const normSearch = normalizarTexto(search);
      if (!normSearch) return options;

      const result: ComboboxParsedItem[] = [];

      for (const opt of options) {
        if ('group' in opt) {
          const filteredItems = opt.items.filter((item) => {
            const maq = maquinasMap.get(item.value);
            return maq
              ? coincideMaquina(maq, search)
              : normalizarTexto(item.label).includes(normSearch);
          });
          if (filteredItems.length > 0) {
            result.push({ ...opt, items: filteredItems });
          }
        } else {
          const maq = maquinasMap.get(opt.value);
          if (
            maq
              ? coincideMaquina(maq, search)
              : normalizarTexto(opt.label).includes(normSearch)
          ) {
            result.push(opt);
          }
        }
      }

      return result;
    };
  }, [maquinasMap]);

  // Máquina actualmente seleccionada
  const maquinaElegida = maquinaId ? maquinasMap.get(maquinaId) : null;
  const avisoFallas = maquinaElegida
    ? textoFallasAbiertas(maquinaElegida.intervenciones_abiertas)
    : null;

  // Validación
  const validar = (): boolean => {
    const nuevosErrores: typeof errores = {};

    if (!maquinaId) {
      nuevosErrores.maquina = 'Elegí la máquina.';
    }

    if (detieneMaquina === null) {
      nuevosErrores.detieneMaquina = 'Indicá si la máquina quedó detenida.';
    }

    const descLimpia = descripcion.trim();
    if (descLimpia.length < 5) {
      nuevosErrores.descripcion = 'Describí la falla (al menos 5 caracteres).';
    } else if (descLimpia.length > 2000) {
      nuevosErrores.descripcion = 'La descripción no puede superar los 2000 caracteres.';
    }

    const obsLimpia = observaciones.trim();
    if (obsLimpia.length > 2000) {
      nuevosErrores.observaciones = 'Las observaciones no pueden superar los 2000 caracteres.';
    }

    setErrores(nuevosErrores);
    return Object.keys(nuevosErrores).length === 0;
  };

  // Enviar formulario
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validar()) return;

    setEnviando(true);
    try {
      const res = await clienteApi.post<IntervencionCreada>('/api/intervenciones', {
        maquina_id: Number(maquinaId),
        detiene_maquina: detieneMaquina,
        descripcion: descripcion.trim(),
        observaciones: observaciones.trim() || undefined,
      });

      // Invalidar claves de React Query
      queryClient.invalidateQueries({ queryKey: ['intervenciones'] });
      queryClient.invalidateQueries({ queryKey: ['maquinas'] });
      queryClient.invalidateQueries({ queryKey: ['notificaciones-contador'] });

      setReporteCreado(res);
    } catch (err) {
      notifications.show({
        color: 'red',
        message: mensajeError(err),
      });
    } finally {
      setEnviando(false);
    }
  };

  // Reiniciar formulario para reportar otra falla
  const handleReportarOtra = () => {
    setMaquinaId(null);
    setDetieneMaquina(null);
    setDescripcion('');
    setObservaciones('');
    setErrores({});
    setReporteCreado(null);
  };

  // Pantalla de Confirmación
  if (reporteCreado) {
    const maqResp = reporteCreado.maquina;
    const etiquetaConfirmacion = maquinaElegida
      ? etiquetaMaquina(maquinaElegida)
      : maqResp.nombre;

    return (
      <Center py="xl">
        <Card
          withBorder
          radius="md"
          p="xl"
          maw={560}
          w="100%"
          style={{ textAlign: 'center' }}
        >
          <Stack align="center" gap="md">
            <Box c="#16a34a">
              <IconCircleCheck size={64} stroke={1.5} />
            </Box>

            <Title order={2} size="h3" c="#0f172a">
              Reporte N.º {reporteCreado.id} registrado
            </Title>

            <Text size="lg" fw={500} c="#334155">
              {etiquetaConfirmacion}
            </Text>

            <Group gap="xs" justify="center">
              <Text size="sm" c="#64748b">
                Estado de la máquina:
              </Text>
              <EstadoBadge entidad="maquina" estado={maqResp.estado_actual} size="md" />
            </Group>

            <Stack gap="sm" w="100%" mt="lg">
              <Button
                size="lg"
                color="marca"
                onClick={() => navigate(`/intervenciones/${reporteCreado.id}`)}
              >
                Ver el reporte
              </Button>

              <Button
                size="lg"
                variant="light"
                color="marca"
                onClick={handleReportarOtra}
              >
                Reportar otra falla
              </Button>

              <Button
                size="lg"
                variant="subtle"
                color="gray"
                onClick={() => navigate(esCelular ? '/mis-reportes' : '/')}
              >
                {esCelular ? 'Ver mis reportes' : 'Ir al inicio'}
              </Button>
            </Stack>
          </Stack>
        </Card>
      </Center>
    );
  }

  // Pantalla de Formulario
  return (
    <Stack gap="lg" maw={720}>
      <EncabezadoPagina
        titulo="Reportar falla"
        subtitulo="Cargá los datos del problema para que mantenimiento pueda atenderlo"
      />

      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="lg">
          {/* 1. Máquina */}
          <Stack gap="xs">
            <Select
              size="lg"
              label="¿En qué máquina?"
              placeholder={cargandoMaquinas ? 'Cargando máquinas...' : 'Buscá por nombre o código'}
              data={selectData}
              value={maquinaId}
              onChange={(val) => {
                setMaquinaId(val);
                if (errores.maquina) {
                  setErrores((prev) => ({ ...prev, maquina: undefined }));
                }
              }}
              searchable
              filter={selectFilter}
              nothingFoundMessage="No hay máquinas que coincidan"
              error={errores.maquina}
              disabled={cargandoMaquinas}
              renderOption={({ option }) => {
                const maq = maquinasMap.get(option.value);
                return (
                  <Stack gap={2}>
                    <Text size="sm" fw={500}>
                      {option.label}
                    </Text>
                    {maq?.sector?.nombre && (
                      <Text size="xs" c="#64748b">
                        {maq.sector.nombre}
                      </Text>
                    )}
                  </Stack>
                );
              }}
            />

            {/* 2. Datos de la máquina elegida */}
            {maquinaElegida && (
              <Stack gap="xs" mt="xs">
                <Group gap="xs">
                  <Text size="sm" c="#64748b">
                    Estado actual:
                  </Text>
                  <EstadoBadge entidad="maquina" estado={maquinaElegida.estado} size="sm" />
                </Group>

                {avisoFallas && (
                  <Alert
                    color="yellow"
                    variant="light"
                    icon={<IconAlertTriangle size={20} />}
                    title={avisoFallas}
                  >
                    Si es la misma falla, no hace falta reportarla de nuevo. Si es otra, podés seguir.
                  </Alert>
                )}
              </Stack>
            )}
          </Stack>

          {/* 3. ¿La máquina quedó detenida? */}
          <Stack gap="xs">
            <Text id="label-maquina-detenida" fw={500} size="md" c="#0f172a">
              ¿La máquina quedó detenida?
            </Text>
            <SimpleGrid
              cols={{ base: 1, xs: 2 }}
              role="group"
              aria-labelledby="label-maquina-detenida"
            >
              <Button
                size="lg"
                variant={detieneMaquina === true ? 'filled' : 'default'}
                color={detieneMaquina === true ? 'red' : undefined}
                aria-pressed={detieneMaquina === true}
                onClick={() => {
                  setDetieneMaquina(true);
                  if (errores.detieneMaquina) {
                    setErrores((prev) => ({ ...prev, detieneMaquina: undefined }));
                  }
                }}
              >
                Sí, está parada
              </Button>

              <Button
                size="lg"
                variant={detieneMaquina === false ? 'filled' : 'default'}
                color={detieneMaquina === false ? 'marca' : undefined}
                aria-pressed={detieneMaquina === false}
                onClick={() => {
                  setDetieneMaquina(false);
                  if (errores.detieneMaquina) {
                    setErrores((prev) => ({ ...prev, detieneMaquina: undefined }));
                  }
                }}
              >
                No, sigue funcionando
              </Button>
            </SimpleGrid>
            {errores.detieneMaquina && (
              <Text size="sm" c="red">
                {errores.detieneMaquina}
              </Text>
            )}
          </Stack>

          {/* 4. Descripción */}
          <Stack gap={4}>
            <Textarea
              size="lg"
              label="¿Qué pasa?"
              placeholder="Ej.: hace ruido fuerte al arrancar y se apaga sola"
              minRows={3}
              maxRows={6}
              value={descripcion}
              onChange={(e) => {
                setDescripcion(e.currentTarget.value);
                if (errores.descripcion) {
                  setErrores((prev) => ({ ...prev, descripcion: undefined }));
                }
              }}
              error={errores.descripcion}
            />
            <Group justify="flex-end">
              <Text size="xs" c={descripcion.length > 2000 ? 'red' : '#94a3b8'}>
                {descripcion.length}/2000
              </Text>
            </Group>
          </Stack>

          {/* 5. Observaciones */}
          <Stack gap={4}>
            <Textarea
              size="lg"
              label="Observaciones (opcional)"
              placeholder="Cualquier otro dato que ayude a ubicar o entender el problema"
              minRows={2}
              maxRows={4}
              value={observaciones}
              onChange={(e) => {
                setObservaciones(e.currentTarget.value);
                if (errores.observaciones) {
                  setErrores((prev) => ({ ...prev, observaciones: undefined }));
                }
              }}
              error={errores.observaciones}
            />
            <Group justify="flex-end">
              <Text size="xs" c={observaciones.length > 2000 ? 'red' : '#94a3b8'}>
                {observaciones.length}/2000
              </Text>
            </Group>
          </Stack>

          {/* 6. Dato de control */}
          <Box p="xs" style={{ backgroundColor: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <Group gap="xs">
              <IconInfoCircle size={16} color="#64748b" />
              <Text size="xs" c="#64748b">
                Reporta: {nombreCompleto(usuario)} · legajo {usuario?.legajo || '—'} · {formatFechaHora(ahora)}
              </Text>
            </Group>
          </Box>

          {/* Botones de acción */}
          <Box className="botones-formulario-reporte">
            <Button
              type="submit"
              size="lg"
              color="marca"
              loading={enviando}
            >
              Enviar reporte
            </Button>
            <Button
              type="button"
              variant="default"
              size="lg"
              onClick={() => navigate('/')}
              disabled={enviando}
            >
              Cancelar
            </Button>
          </Box>
        </Stack>
      </form>
    </Stack>
  );
}
export default ReportarFalla;
