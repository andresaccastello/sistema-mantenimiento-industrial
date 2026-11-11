import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { Center, Loader } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Layout } from './Layout';
import { RutaProtegida } from './RutaProtegida';
import { useAuth } from '../auth/AuthContext';
import { destinoInicio } from '../lib/inicio';
import { CORTE_CELULAR } from '../lib/celular';

// Pantallas completas
import { Ingreso } from '../pantallas/Ingreso';
import { CambiarPassword } from '../pantallas/CambiarPassword';
import { Notificaciones } from '../pantallas/Notificaciones';
import { MiCuenta } from '../pantallas/MiCuenta';
import { Muestra } from '../pantallas/Muestra';
import { MisReportes } from '../pantallas/MisReportes';
import { ReportarFalla } from '../pantallas/ReportarFalla';
import { DetalleReporteOperario } from '../pantallas/DetalleReporteOperario';
import { IntervencionesLista } from '../pantallas/IntervencionesLista';
import { DetalleIntervencion } from '../pantallas/DetalleIntervencion';
import { Tablero } from '../pantallas/Tablero';
import { MaquinasLista } from '../pantallas/MaquinasLista';
import { DetalleMaquina } from '../pantallas/DetalleMaquina';
import { Usuarios } from '../pantallas/Usuarios';
import { DetalleUsuario } from '../pantallas/DetalleUsuario';
import { SectoresCatalogos } from '../pantallas/SectoresCatalogos';
import { Perfiles } from '../pantallas/Perfiles';
import { Configuracion } from '../pantallas/Configuracion';
import { Reportes } from '../pantallas/Reportes';
import { Repuestos } from '../pantallas/Repuestos';
import { DetalleRepuesto } from '../pantallas/DetalleRepuesto';
import { Preventivos } from '../pantallas/Preventivos';
import { DetallePlan } from '../pantallas/DetallePlan';
import { NuevoPlan } from '../pantallas/NuevoPlan';
import { vistaDetalle } from '../lib/intervenciones';

// Componentes generales
import { EnConstruccion } from '../componentes/EnConstruccion';
import { NoEncontrada } from '../componentes/NoEncontrada';

// Carga perezosa de DevUI provisional (solo en desarrollo)
const DevAppLazy = import.meta.env.DEV
  ? React.lazy(() =>
      import('../dev-ui/DevApp').then((module) => ({
        default: module.DevApp,
      }))
    )
  : null;

function RedireccionInicio() {
  const { usuario } = useAuth();
  const esCelular = Boolean(useMediaQuery(CORTE_CELULAR));
  const destino = destinoInicio(usuario?.permisos, esCelular);
  return <Navigate to={destino} replace />;
}

function DetalleIntervencionRuta() {
  const { usuario } = useAuth();
  const vista = vistaDetalle(usuario?.permisos);

  if (vista === 'completa') {
    return <DetalleIntervencion />;
  }

  return <DetalleReporteOperario />;
}

export function RutasApp() {
  return (
    <Routes>
      {/* 1. Ruta pública de ingreso */}
      <Route path="/ingreso" element={<Ingreso />} />

      {/* 2. Dev UI provisional (solo en desarrollo) */}
      {import.meta.env.DEV && DevAppLazy && (
        <Route
          path="/dev-ui/*"
          element={
            <Suspense
              fallback={
                <Center style={{ minHeight: '100vh' }}>
                  <Loader color="marca" />
                </Center>
              }
            >
              <DevAppLazy />
            </Suspense>
          }
        />
      )}

      {/* 3. Rutas protegidas bajo el Layout principal */}
      <Route
        element={
          <RutaProtegida>
            <Layout />
          </RutaProtegida>
        }
      >
        <Route path="/" element={<RedireccionInicio />} />
        <Route path="/cambiar-password" element={<CambiarPassword />} />
        <Route path="/notificaciones" element={<Notificaciones />} />
        <Route path="/mi-cuenta" element={<MiCuenta />} />

        <Route
          path="/tablero"
          element={
            <RutaProtegida permiso="INTERVENCIONES_VER">
              <Tablero />
            </RutaProtegida>
          }
        />
        <Route
          path="/mis-reportes"
          element={<MisReportes />}
        />
        <Route
          path="/reportar"
          element={
            <RutaProtegida permiso="INTERVENCIONES_CREAR">
              <ReportarFalla />
            </RutaProtegida>
          }
        />
        <Route
          path="/intervenciones"
          element={
            <RutaProtegida permiso="INTERVENCIONES_VER">
              <IntervencionesLista />
            </RutaProtegida>
          }
        />
        <Route
          path="/intervenciones/:id"
          element={
            <RutaProtegida permiso="INTERVENCIONES_VER">
              <DetalleIntervencionRuta />
            </RutaProtegida>
          }
        />
        <Route
          path="/preventivos"
          element={
            <RutaProtegida permiso="PLANES_GESTIONAR">
              <Preventivos />
            </RutaProtegida>
          }
        />
        <Route
          path="/preventivos/planes/nuevo"
          element={
            <RutaProtegida permiso="PLANES_GESTIONAR">
              <NuevoPlan />
            </RutaProtegida>
          }
        />
        <Route
          path="/preventivos/planes/:id"
          element={
            <RutaProtegida permiso="PLANES_GESTIONAR">
              <DetallePlan />
            </RutaProtegida>
          }
        />
        <Route
          path="/maquinas"
          element={<MaquinasLista />}
        />
        <Route
          path="/maquinas/:id"
          element={<DetalleMaquina />}
        />
        <Route
          path="/repuestos"
          element={
            <RutaProtegida permiso="REPUESTOS_GESTIONAR">
              <Repuestos />
            </RutaProtegida>
          }
        />
        <Route
          path="/repuestos/:id"
          element={
            <RutaProtegida permiso="REPUESTOS_GESTIONAR">
              <DetalleRepuesto />
            </RutaProtegida>
          }
        />
        <Route
          path="/reportes"
          element={
            <RutaProtegida permiso="REPORTES_CONSULTAR">
              <Reportes />
            </RutaProtegida>
          }
        />
        <Route
          path="/usuarios"
          element={
            <RutaProtegida permiso="USUARIOS_GESTIONAR">
              <Usuarios />
            </RutaProtegida>
          }
        />
        <Route
          path="/usuarios/:id"
          element={
            <RutaProtegida permiso="USUARIOS_GESTIONAR">
              <DetalleUsuario />
            </RutaProtegida>
          }
        />
        <Route
          path="/perfiles"
          element={
            <RutaProtegida permiso="USUARIOS_GESTIONAR">
              <Perfiles />
            </RutaProtegida>
          }
        />
        <Route
          path="/sectores"
          element={
            <RutaProtegida permiso="MAQUINAS_GESTIONAR">
              <SectoresCatalogos />
            </RutaProtegida>
          }
        />
        <Route
          path="/configuracion"
          element={
            <RutaProtegida permiso="CONFIGURACION_GESTIONAR">
              <Configuracion />
            </RutaProtegida>
          }
        />

        {/* Muestra de componentes (solo en desarrollo) */}
        {import.meta.env.DEV && (
          <Route path="/muestra" element={<Muestra />} />
        )}
      </Route>

      {/* 4. Ruta 404 No encontrada */}
      <Route path="*" element={<NoEncontrada />} />
    </Routes>
  );
}
