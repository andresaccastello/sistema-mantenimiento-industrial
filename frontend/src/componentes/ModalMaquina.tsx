import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Stack,
  TextInput,
  Textarea,
  Select,
  Group,
  Button,
  Alert,
  SimpleGrid,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle } from '@tabler/icons-react';
import { clienteApi } from '../api/cliente';
import {
  Criticidad,
  MaquinaLista,
  Planta,
  SectorLista,
  TipoEquipo,
} from '../api/tipos';
import { ApiError, mensajeError, requiereRecargar } from '../lib/errores';

export interface ModalMaquinaProps {
  abierto: boolean;
  onCerrar: () => void;
  maquina?: MaquinaLista | null;
}

export function ModalMaquina({ abierto, onCerrar, maquina }: ModalMaquinaProps) {
  const esEdicion = Boolean(maquina);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const esCelular = useMediaQuery('(max-width: 48em)');

  const sectoresQuery = useQuery({
    queryKey: ['sectores'],
    queryFn: () => clienteApi.get<SectorLista[]>('/api/sectores'),
    enabled: abierto,
  });

  const plantasQuery = useQuery({
    queryKey: ['plantas'],
    queryFn: () => clienteApi.get<Planta[]>('/api/plantas'),
    enabled: abierto,
  });

  const criticidadesQuery = useQuery({
    queryKey: ['criticidades'],
    queryFn: () => clienteApi.get<Criticidad[]>('/api/criticidades'),
    enabled: abierto,
  });

  const tiposQuery = useQuery({
    queryKey: ['tipos-equipo'],
    queryFn: () => clienteApi.get<TipoEquipo[]>('/api/tipos-equipo'),
    enabled: abierto,
  });

  const [nombre, setNombre] = useState('');
  const [codigo, setCodigo] = useState('');
  const [sectorId, setSectorId] = useState<string | null>(null);
  const [criticidadId, setCriticidadId] = useState<string | null>(null);
  const [tipoEquipoId, setTipoEquipoId] = useState<string | null>(null);
  const [modelo, setModelo] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [observaciones, setObservaciones] = useState('');

  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);
  const [errorSector, setErrorSector] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const criticidades = criticidadesQuery.data || [];
  const tiposEquipo = tiposQuery.data || [];
  const sectores = sectoresQuery.data || [];
  const plantas = plantasQuery.data || [];

  const criticidadPorOmision = criticidades.find((c) => c.por_omision);
  const tipoPorOmision = tiposEquipo.find((t) => t.por_omision);

  // Inicializar valores cuando se abre el modal
  useEffect(() => {
    if (!abierto) return;

    setErrorNombre(null);
    setErrorCodigo(null);
    setErrorSector(null);
    setErrorModal(null);
    setGuardando(false);

    if (maquina) {
      setNombre(maquina.nombre);
      setCodigo(maquina.codigo || '');
      setSectorId(String(maquina.sector.id));
      setCriticidadId(String(maquina.criticidad.id));
      setTipoEquipoId(String(maquina.tipo_equipo.id));
      setModelo(maquina.modelo || '');
      setUbicacion(maquina.ubicacion || '');
      setObservaciones(maquina.observaciones || '');
    } else {
      setNombre('');
      setCodigo('');
      setSectorId(null);
      setCriticidadId(criticidadPorOmision ? String(criticidadPorOmision.id) : null);
      setTipoEquipoId(tipoPorOmision ? String(tipoPorOmision.id) : null);
      setModelo('');
      setUbicacion('');
      setObservaciones('');
    }
  }, [abierto, maquina?.id]);

  // En alta, cuando llegan los catálogos, poblar el valor por omisión si aún no estaba seteado
  useEffect(() => {
    if (abierto && !maquina) {
      if (criticidadId === null && criticidadPorOmision) {
        setCriticidadId(String(criticidadPorOmision.id));
      }
      if (tipoEquipoId === null && tipoPorOmision) {
        setTipoEquipoId(String(tipoPorOmision.id));
      }
    }
  }, [abierto, maquina, criticidadPorOmision?.id, tipoPorOmision?.id]);

  const dosOMasPlantas = plantas.length >= 2;

  const opcionesSector = sectores.map((s) => ({
    value: String(s.id),
    label:
      dosOMasPlantas && s.planta ? `${s.nombre} · ${s.planta.nombre}` : s.nombre,
  }));
  if (
    maquina &&
    !opcionesSector.some((o) => o.value === String(maquina.sector.id))
  ) {
    opcionesSector.push({
      value: String(maquina.sector.id),
      label: `${maquina.sector.nombre} (inactivo)`,
    });
  }

  const opcionesCriticidad = criticidades.map((c) => ({
    value: String(c.id),
    label: c.nombre,
  }));
  if (
    maquina &&
    !opcionesCriticidad.some((o) => o.value === String(maquina.criticidad.id))
  ) {
    opcionesCriticidad.push({
      value: String(maquina.criticidad.id),
      label: `${maquina.criticidad.nombre} (inactivo)`,
    });
  }

  const opcionesTipo = tiposEquipo.map((t) => ({
    value: String(t.id),
    label: t.nombre,
  }));
  if (
    maquina &&
    !opcionesTipo.some((o) => o.value === String(maquina.tipo_equipo.id))
  ) {
    opcionesTipo.push({
      value: String(maquina.tipo_equipo.id),
      label: `${maquina.tipo_equipo.nombre} (inactivo)`,
    });
  }

  const construirDiffEdicion = (): Record<string, unknown> => {
    if (!maquina) return {};
    const diff: Record<string, unknown> = {};

    const nombreTrim = nombre.trim();
    if (nombreTrim !== maquina.nombre.trim()) {
      diff.nombre = nombreTrim;
    }

    if (sectorId && Number(sectorId) !== maquina.sector.id) {
      diff.sector_id = Number(sectorId);
    }

    if (criticidadId && Number(criticidadId) !== maquina.criticidad.id) {
      diff.criticidad_id = Number(criticidadId);
    }

    if (tipoEquipoId && Number(tipoEquipoId) !== maquina.tipo_equipo.id) {
      diff.tipo_equipo_id = Number(tipoEquipoId);
    }

    const codigoTrim = codigo.trim();
    if (codigoTrim !== (maquina.codigo || '').trim()) {
      diff.codigo = codigoTrim;
    }

    const modeloTrim = modelo.trim();
    if (modeloTrim !== (maquina.modelo || '').trim()) {
      diff.modelo = modeloTrim;
    }

    const ubicacionTrim = ubicacion.trim();
    if (ubicacionTrim !== (maquina.ubicacion || '').trim()) {
      diff.ubicacion = ubicacionTrim;
    }

    const obsTrim = observaciones.trim();
    if (obsTrim !== (maquina.observaciones || '').trim()) {
      diff.observaciones = obsTrim;
    }

    return diff;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorNombre(null);
    setErrorCodigo(null);
    setErrorSector(null);
    setErrorModal(null);

    const nombreTrim = nombre.trim();
    let invalido = false;
    if (!nombreTrim) {
      setErrorNombre('Indicá el nombre de la máquina.');
      invalido = true;
    }
    if (!sectorId) {
      setErrorSector('Elegí el sector.');
      invalido = true;
    }
    if (invalido) return;

    if (esEdicion && maquina) {
      const diff = construirDiffEdicion();
      if (Object.keys(diff).length === 0) {
        setErrorModal('No hay cambios para guardar.');
        return;
      }

      setGuardando(true);
      try {
        await clienteApi.put<MaquinaLista>(`/api/maquinas/${maquina.id}`, diff);
        notifications.show({
          color: 'green',
          message: 'Cambios guardados.',
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['maquina', maquina.id] }),
          queryClient.invalidateQueries({ queryKey: ['maquinas'] }),
          queryClient.invalidateQueries({ queryKey: ['tablero'] }),
        ]);
        onCerrar();
      } catch (err: unknown) {
        const cod =
          err instanceof ApiError
            ? err.codigo
            : (err as { codigo?: string })?.codigo;
        if (cod === 'CODIGO_MAQUINA_DUPLICADO') {
          setErrorCodigo(mensajeError(err));
        } else if (requiereRecargar(err)) {
          onCerrar();
          notifications.show({ color: 'red', message: mensajeError(err) });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['maquina', maquina.id] }),
            queryClient.invalidateQueries({ queryKey: ['maquinas'] }),
          ]);
        } else {
          setErrorModal(mensajeError(err));
        }
      } finally {
        setGuardando(false);
      }
      return;
    }

    // Alta
    const payload: Record<string, unknown> = {
      nombre: nombreTrim,
      sector_id: Number(sectorId),
    };

    if (
      criticidadId &&
      (!criticidadPorOmision || Number(criticidadId) !== criticidadPorOmision.id)
    ) {
      payload.criticidad_id = Number(criticidadId);
    }

    if (
      tipoEquipoId &&
      (!tipoPorOmision || Number(tipoEquipoId) !== tipoPorOmision.id)
    ) {
      payload.tipo_equipo_id = Number(tipoEquipoId);
    }

    if (codigo.trim()) payload.codigo = codigo.trim();
    if (modelo.trim()) payload.modelo = modelo.trim();
    if (ubicacion.trim()) payload.ubicacion = ubicacion.trim();
    if (observaciones.trim()) payload.observaciones = observaciones.trim();

    setGuardando(true);
    try {
      const creada = await clienteApi.post<MaquinaLista>('/api/maquinas', payload);
      notifications.show({
        color: 'green',
        message: 'Máquina creada.',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['maquinas'] }),
        queryClient.invalidateQueries({ queryKey: ['tablero'] }),
      ]);
      onCerrar();
      navigate(`/maquinas/${creada.id}`);
    } catch (err: unknown) {
      const cod =
        err instanceof ApiError
          ? err.codigo
          : (err as { codigo?: string })?.codigo;
      if (cod === 'CODIGO_MAQUINA_DUPLICADO') {
        setErrorCodigo(mensajeError(err));
      } else {
        setErrorModal(mensajeError(err));
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      opened={abierto}
      onClose={() => !guardando && onCerrar()}
      title={esEdicion ? 'Editar máquina' : 'Nueva máquina'}
      size="lg"
      centered
      fullScreen={Boolean(esCelular)}
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          {errorModal && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />}>
              {errorModal}
            </Alert>
          )}

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput
              label="Nombre"
              placeholder="Ej: Torno CNC"
              required
              value={nombre}
              onChange={(e) => {
                setNombre(e.currentTarget.value);
                if (errorNombre) setErrorNombre(null);
              }}
              error={errorNombre}
              disabled={guardando}
            />

            <TextInput
              label="Código"
              placeholder="Ej: M-012 (opcional)"
              value={codigo}
              onChange={(e) => {
                setCodigo(e.currentTarget.value);
                if (errorCodigo) setErrorCodigo(null);
              }}
              error={errorCodigo}
              disabled={guardando}
            />
          </SimpleGrid>

          <Select
            label="Sector"
            placeholder="Seleccionar sector"
            required
            searchable
            data={opcionesSector}
            value={sectorId}
            onChange={(val) => {
              setSectorId(val);
              if (errorSector) setErrorSector(null);
            }}
            error={errorSector}
            disabled={guardando}
          />

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Select
              label="Criticidad"
              data={opcionesCriticidad}
              value={criticidadId}
              onChange={(val) => setCriticidadId(val)}
              disabled={guardando}
            />

            <Select
              label="Tipo de equipo"
              data={opcionesTipo}
              value={tipoEquipoId}
              onChange={(val) => setTipoEquipoId(val)}
              disabled={guardando}
            />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput
              label="Marca y modelo"
              placeholder="Opcional"
              value={modelo}
              onChange={(e) => setModelo(e.currentTarget.value)}
              disabled={guardando}
            />

            <TextInput
              label="Ubicación"
              placeholder="Opcional"
              value={ubicacion}
              onChange={(e) => setUbicacion(e.currentTarget.value)}
              disabled={guardando}
            />
          </SimpleGrid>

          <Textarea
            label="Notas de mantenimiento"
            placeholder="Opcional"
            minRows={3}
            maxRows={6}
            value={observaciones}
            onChange={(e) => setObservaciones(e.currentTarget.value)}
            disabled={guardando}
          />

          <Group justify="flex-end" gap="sm" mt="xs">
            <Button variant="default" onClick={onCerrar} disabled={guardando}>
              Volver
            </Button>
            <Button type="submit" loading={guardando}>
              {esEdicion ? 'Guardar cambios' : 'Crear máquina'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
