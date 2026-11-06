import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Stack, Title, Tabs } from '@mantine/core';
import { clienteApi } from '../api/cliente';
import {
  CriticidadAdmin,
  PlantaAdmin,
  SectorAdmin,
  TipoEquipoAdmin,
} from '../api/tipos';
import { useAuth } from '../auth/AuthContext';
import { ModalSector } from '../componentes/admin/ModalSector';
import { ModalPlanta } from '../componentes/admin/ModalPlanta';
import { ModalCatalogo } from '../componentes/admin/ModalCatalogo';
import { ModalDesactivarElemento } from '../componentes/admin/ModalDesactivarElemento';
import { ModalReactivarElemento } from '../componentes/admin/ModalReactivarElemento';
import { ModalMarcarPorOmision } from '../componentes/admin/ModalMarcarPorOmision';
import { TabSectores } from '../componentes/admin/TabSectores';
import { TabPlantas } from '../componentes/admin/TabPlantas';
import { TabCatalogo } from '../componentes/admin/TabCatalogo';

const PESTANAS_VALIDAS = new Set([
  'sectores',
  'plantas',
  'criticidades',
  'tipos_equipo',
  'tipos-equipo',
]);

export function SectoresCatalogos() {
  const { tienePermiso } = useAuth();
  const puedeGestionarUsuarios = tienePermiso('USUARIOS_GESTIONAR');

  const [searchParams, setSearchParams] = useSearchParams();
  const pestanaParam = searchParams.get('pestana');
  const pestanaValida =
    pestanaParam && PESTANAS_VALIDAS.has(pestanaParam)
      ? pestanaParam
      : 'sectores';
  const pestana =
    pestanaValida === 'tipos-equipo' ? 'tipos_equipo' : pestanaValida;

  const setPestana = (val: string | null) => {
    if (val && val !== 'sectores') {
      setSearchParams({ pestana: val });
    } else {
      setSearchParams({});
    }
  };

  // Consultas
  const qSectores = useQuery({
    queryKey: ['sectores', 'admin'],
    queryFn: () =>
      clienteApi
        .listar<SectorAdmin>('/api/sectores', { params: { all: true } })
        .then((r) => r.items),
  });

  const qPlantas = useQuery({
    queryKey: ['plantas', 'admin'],
    queryFn: () =>
      clienteApi
        .listar<PlantaAdmin>('/api/plantas', { params: { all: true } })
        .then((r) => r.items),
  });

  const qCriticidades = useQuery({
    queryKey: ['criticidades', 'admin'],
    queryFn: () =>
      clienteApi
        .listar<CriticidadAdmin>('/api/criticidades', { params: { all: true } })
        .then((r) => r.items),
  });

  const qTiposEquipo = useQuery({
    queryKey: ['tipos-equipo', 'admin'],
    queryFn: () =>
      clienteApi
        .listar<TipoEquipoAdmin>('/api/tipos-equipo', { params: { all: true } })
        .then((r) => r.items),
  });

  // Modales
  const [modalSector, setModalSector] = useState<{
    abierto: boolean;
    sector: SectorAdmin | null;
  }>({ abierto: false, sector: null });

  const [modalPlanta, setModalPlanta] = useState<{
    abierto: boolean;
    planta: PlantaAdmin | null;
  }>({ abierto: false, planta: null });

  const [modalCatalogo, setModalCatalogo] = useState<{
    abierto: boolean;
    entidad: 'criticidad' | 'tipo';
    item: CriticidadAdmin | TipoEquipoAdmin | null;
  }>({ abierto: false, entidad: 'criticidad', item: null });

  const [modalDesactivar, setModalDesactivar] = useState<{
    abierto: boolean;
    tipo: 'sector' | 'planta' | 'criticidad' | 'tipo_equipo';
    id: number | null;
    nombre: string;
    motivoBloqueo: string | null;
  }>({
    abierto: false,
    tipo: 'sector',
    id: null,
    nombre: '',
    motivoBloqueo: null,
  });

  const [modalReactivar, setModalReactivar] = useState<{
    abierto: boolean;
    tipo: 'sector' | 'planta' | 'criticidad' | 'tipo_equipo';
    id: number | null;
    nombre: string;
  }>({
    abierto: false,
    tipo: 'sector',
    id: null,
    nombre: '',
  });

  const [modalOmision, setModalOmision] = useState<{
    abierto: boolean;
    entidad: 'criticidad' | 'tipo';
    id: number | null;
    nombre: string;
  }>({
    abierto: false,
    entidad: 'criticidad',
    id: null,
    nombre: '',
  });

  return (
    <Stack gap="lg">
      <Title order={2}>Sectores y catálogos</Title>

        <Tabs value={pestana} onChange={setPestana}>
          <Tabs.List mb="md">
            <Tabs.Tab value="sectores">Sectores</Tabs.Tab>
            <Tabs.Tab value="plantas">Plantas</Tabs.Tab>
            <Tabs.Tab value="criticidades">Criticidades</Tabs.Tab>
            <Tabs.Tab value="tipos_equipo">Tipos de equipo</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="sectores">
            <TabSectores
              sectores={qSectores.data || []}
              isLoading={qSectores.isLoading}
              isError={qSectores.isError}
              error={qSectores.error}
              puedeGestionarUsuarios={puedeGestionarUsuarios}
              onNuevoSector={() => setModalSector({ abierto: true, sector: null })}
              onEditarSector={(s) => setModalSector({ abierto: true, sector: s })}
              onDesactivarSector={(id, nombre, motivo) =>
                setModalDesactivar({
                  abierto: true,
                  tipo: 'sector',
                  id,
                  nombre,
                  motivoBloqueo: motivo,
                })
              }
              onReactivarSector={(id, nombre) =>
                setModalReactivar({ abierto: true, tipo: 'sector', id, nombre })
              }
            />
          </Tabs.Panel>

          <Tabs.Panel value="plantas">
            <TabPlantas
              plantas={qPlantas.data || []}
              isLoading={qPlantas.isLoading}
              isError={qPlantas.isError}
              error={qPlantas.error}
              onNuevaPlanta={() => setModalPlanta({ abierto: true, planta: null })}
              onEditarPlanta={(p) => setModalPlanta({ abierto: true, planta: p })}
              onDesactivarPlanta={(id, nombre, motivo) =>
                setModalDesactivar({
                  abierto: true,
                  tipo: 'planta',
                  id,
                  nombre,
                  motivoBloqueo: motivo,
                })
              }
              onReactivarPlanta={(id, nombre) =>
                setModalReactivar({ abierto: true, tipo: 'planta', id, nombre })
              }
            />
          </Tabs.Panel>

          <Tabs.Panel value="criticidades">
            <TabCatalogo
              tipo="criticidad"
              items={qCriticidades.data || []}
              isLoading={qCriticidades.isLoading}
              isError={qCriticidades.isError}
              error={qCriticidades.error}
              onNuevo={() =>
                setModalCatalogo({
                  abierto: true,
                  entidad: 'criticidad',
                  item: null,
                })
              }
              onEditar={(c) =>
                setModalCatalogo({
                  abierto: true,
                  entidad: 'criticidad',
                  item: c,
                })
              }
              onMarcarPorOmision={(id, nombre) =>
                setModalOmision({
                  abierto: true,
                  entidad: 'criticidad',
                  id,
                  nombre,
                })
              }
              onDesactivar={(id, nombre, motivo) =>
                setModalDesactivar({
                  abierto: true,
                  tipo: 'criticidad',
                  id,
                  nombre,
                  motivoBloqueo: motivo,
                })
              }
              onReactivar={(id, nombre) =>
                setModalReactivar({
                  abierto: true,
                  tipo: 'criticidad',
                  id,
                  nombre,
                })
              }
            />
          </Tabs.Panel>

          <Tabs.Panel value="tipos_equipo">
            <TabCatalogo
              tipo="tipo_equipo"
              items={qTiposEquipo.data || []}
              isLoading={qTiposEquipo.isLoading}
              isError={qTiposEquipo.isError}
              error={qTiposEquipo.error}
              onNuevo={() =>
                setModalCatalogo({
                  abierto: true,
                  entidad: 'tipo',
                  item: null,
                })
              }
              onEditar={(t) =>
                setModalCatalogo({
                  abierto: true,
                  entidad: 'tipo',
                  item: t,
                })
              }
              onMarcarPorOmision={(id, nombre) =>
                setModalOmision({
                  abierto: true,
                  entidad: 'tipo',
                  id,
                  nombre,
                })
              }
              onDesactivar={(id, nombre, motivo) =>
                setModalDesactivar({
                  abierto: true,
                  tipo: 'tipo_equipo',
                  id,
                  nombre,
                  motivoBloqueo: motivo,
                })
              }
              onReactivar={(id, nombre) =>
                setModalReactivar({
                  abierto: true,
                  tipo: 'tipo_equipo',
                  id,
                  nombre,
                })
              }
            />
          </Tabs.Panel>
        </Tabs>

        <ModalSector
        abierto={modalSector.abierto}
        onCerrar={() => setModalSector({ abierto: false, sector: null })}
        sector={modalSector.sector}
      />

      <ModalPlanta
        abierto={modalPlanta.abierto}
        onCerrar={() => setModalPlanta({ abierto: false, planta: null })}
        planta={modalPlanta.planta}
      />

      <ModalCatalogo
        abierto={modalCatalogo.abierto}
        onCerrar={() =>
          setModalCatalogo({ abierto: false, entidad: 'criticidad', item: null })
        }
        entidad={modalCatalogo.entidad}
        item={modalCatalogo.item}
      />

      <ModalDesactivarElemento
        abierto={modalDesactivar.abierto}
        onCerrar={() =>
          setModalDesactivar({
            abierto: false,
            tipo: 'sector',
            id: null,
            nombre: '',
            motivoBloqueo: null,
          })
        }
        tipo={modalDesactivar.tipo}
        id={modalDesactivar.id}
        nombre={modalDesactivar.nombre}
        motivoBloqueo={modalDesactivar.motivoBloqueo}
      />

      <ModalReactivarElemento
        abierto={modalReactivar.abierto}
        onCerrar={() =>
          setModalReactivar({
            abierto: false,
            tipo: 'sector',
            id: null,
            nombre: '',
          })
        }
        tipo={modalReactivar.tipo}
        id={modalReactivar.id}
        nombre={modalReactivar.nombre}
      />

      <ModalMarcarPorOmision
        abierto={modalOmision.abierto}
        onCerrar={() =>
          setModalOmision({
            abierto: false,
            entidad: 'criticidad',
            id: null,
            nombre: '',
          })
        }
        entidad={modalOmision.entidad}
        id={modalOmision.id}
        nombre={modalOmision.nombre}
      />
    </Stack>
  );
}
