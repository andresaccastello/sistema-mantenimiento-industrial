import { Routes, Route, Navigate } from 'react-router';
import { Layout } from './Layout';
import { RutaProtegida } from './RutaProtegida';
import { pantallaPerezosa } from './carga';
import { useAuth } from '../auth/AuthContext';
import { destinoInicio } from '../lib/inicio';
import { useModoSimple } from '../lib/useModoSimple';
import { vistaDetalle } from '../lib/intervenciones';

// L1, 4: se cargan de entrada el ingreso, el Layout, la redirección de inicio y las dos
// pantallas del operario en el celular
import { Ingreso } from '../pantallas/Ingreso';
import { MisReportes } from '../pantallas/MisReportes';
import { ReportarFalla } from '../pantallas/ReportarFalla';
import { NoEncontrada } from '../componentes/NoEncontrada';

// Las demás, cuando se abren
const CambiarPassword = pantallaPerezosa(() => import('../pantallas/CambiarPassword'), 'CambiarPassword');
const Notificaciones = pantallaPerezosa(() => import('../pantallas/Notificaciones'), 'Notificaciones');
const MiCuenta = pantallaPerezosa(() => import('../pantallas/MiCuenta'), 'MiCuenta');
const Muestra = pantallaPerezosa(() => import('../pantallas/Muestra'), 'Muestra');
const DetalleReporteOperario = pantallaPerezosa(() => import('../pantallas/DetalleReporteOperario'), 'DetalleReporteOperario');
const IntervencionesLista = pantallaPerezosa(() => import('../pantallas/IntervencionesLista'), 'IntervencionesLista');
const DetalleIntervencion = pantallaPerezosa(() => import('../pantallas/DetalleIntervencion'), 'DetalleIntervencion');
const Tablero = pantallaPerezosa(() => import('../pantallas/Tablero'), 'Tablero');
const MaquinasLista = pantallaPerezosa(() => import('../pantallas/MaquinasLista'), 'MaquinasLista');
const DetalleMaquina = pantallaPerezosa(() => import('../pantallas/DetalleMaquina'), 'DetalleMaquina');
const Usuarios = pantallaPerezosa(() => import('../pantallas/Usuarios'), 'Usuarios');
const DetalleUsuario = pantallaPerezosa(() => import('../pantallas/DetalleUsuario'), 'DetalleUsuario');
const SectoresCatalogos = pantallaPerezosa(() => import('../pantallas/SectoresCatalogos'), 'SectoresCatalogos');
const Perfiles = pantallaPerezosa(() => import('../pantallas/Perfiles'), 'Perfiles');
const Configuracion = pantallaPerezosa(() => import('../pantallas/Configuracion'), 'Configuracion');
const Reportes = pantallaPerezosa(() => import('../pantallas/Reportes'), 'Reportes');
const Repuestos = pantallaPerezosa(() => import('../pantallas/Repuestos'), 'Repuestos');
const DetalleRepuesto = pantallaPerezosa(() => import('../pantallas/DetalleRepuesto'), 'DetalleRepuesto');
const Preventivos = pantallaPerezosa(() => import('../pantallas/Preventivos'), 'Preventivos');
const DetallePlan = pantallaPerezosa(() => import('../pantallas/DetallePlan'), 'DetallePlan');
const NuevoPlan = pantallaPerezosa(() => import('../pantallas/NuevoPlan'), 'NuevoPlan');
const Lecturas = pantallaPerezosa(() => import('../pantallas/Lecturas'), 'Lecturas');
const TareasDeHoy = pantallaPerezosa(() => import('../pantallas/TareasDeHoy'), 'TareasDeHoy');


function RedireccionInicio() {
  const { usuario } = useAuth();
  // Se lee en el primer render (useEsCelular, dentro de useModoSimple): el destino no puede
  // cambiar a mitad de camino. D1, 4: depende del modo simple, no del ancho
  const modoSimple = useModoSimple();
  const destino = destinoInicio(usuario?.permisos, modoSimple);
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

      {/* 2. Rutas protegidas bajo el Layout principal */}
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
        {/* LE1, 4.4: con MAQUINAS_REGISTRAR_LECTURAS o PLANES_GESTIONAR; lo controla la pantalla */}
        <Route path="/lecturas" element={<Lecturas />} />
        {/* RT1, 4: con RUTINAS_REALIZAR; lo controla la pantalla */}
        <Route path="/rutinas" element={<TareasDeHoy />} />
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

      {/* 3. Ruta 404 No encontrada */}
      <Route path="*" element={<NoEncontrada />} />
    </Routes>
  );
}
