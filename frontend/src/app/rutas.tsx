import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { Center, Loader } from '@mantine/core';
import { Layout } from './Layout';
import { RutaProtegida } from './RutaProtegida';
import { useAuth } from '../auth/AuthContext';
import { destinoInicio } from '../lib/inicio';

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
  const destino = destinoInicio(usuario?.permisos);
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
          path="/maquinas"
          element={<MaquinasLista />}
        />
        <Route
          path="/maquinas/:id"
          element={<DetalleMaquina />}
        />
        <Route
          path="/reportes"
          element={
            <RutaProtegida permiso="REPORTES_CONSULTAR">
              <EnConstruccion titulo="Reportes" etapa="F5" />
            </RutaProtegida>
          }
        />
        <Route
          path="/usuarios"
          element={
            <RutaProtegida permiso="USUARIOS_GESTIONAR">
              <EnConstruccion titulo="Usuarios" etapa="F4" />
            </RutaProtegida>
          }
        />
        <Route
          path="/sectores"
          element={
            <RutaProtegida permiso="MAQUINAS_GESTIONAR">
              <EnConstruccion titulo="Sectores" etapa="F4" />
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
