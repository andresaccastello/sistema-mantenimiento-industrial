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

        {/* Pantallas en construcción */}
        <Route
          path="/tablero"
          element={
            <RutaProtegida permiso="INTERVENCIONES_VER">
              <EnConstruccion titulo="Tablero" etapa="F3" />
            </RutaProtegida>
          }
        />
        <Route
          path="/mis-reportes"
          element={<EnConstruccion titulo="Inicio del operario" etapa="F1" />}
        />
        <Route
          path="/reportar"
          element={
            <RutaProtegida permiso="INTERVENCIONES_CREAR">
              <EnConstruccion titulo="Reportar falla" etapa="F1" />
            </RutaProtegida>
          }
        />
        <Route
          path="/intervenciones"
          element={
            <RutaProtegida permiso="INTERVENCIONES_VER">
              <EnConstruccion titulo="Intervenciones" etapa="F2" />
            </RutaProtegida>
          }
        />
        <Route
          path="/intervenciones/:id"
          element={
            <RutaProtegida permiso="INTERVENCIONES_VER">
              <EnConstruccion titulo="Detalle de intervención" etapa="F2" />
            </RutaProtegida>
          }
        />
        <Route
          path="/maquinas"
          element={<EnConstruccion titulo="Máquinas" etapa="F3" />}
        />
        <Route
          path="/maquinas/:id"
          element={<EnConstruccion titulo="Detalle de máquina" etapa="F3" />}
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
