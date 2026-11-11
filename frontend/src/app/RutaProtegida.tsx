import React from 'react';
import { Navigate, useLocation, Outlet } from 'react-router';
import { Center, Loader } from '@mantine/core';
import { useAuth } from '../auth/AuthContext';
import { SinPermiso } from '../componentes/SinPermiso';

interface RutaProtegidaProps {
  permiso?: string;
  children?: React.ReactNode;
}

export function RutaProtegida({ permiso, children }: RutaProtegidaProps) {
  const { token, usuario, cargando, tienePermiso } = useAuth();
  const location = useLocation();

  if (cargando) {
    return (
      <Center style={{ minHeight: '50vh' }}>
        <Loader color="marca" />
      </Center>
    );
  }

  // 1. Exige sesión
  if (!token || !usuario) {
    return <Navigate to="/ingreso" state={{ from: location }} replace />;
  }

  // 2. Si debe cambiar contraseña, obliga a ir a /cambiar-password
  if (usuario.debe_cambiar_password && location.pathname !== '/cambiar-password') {
    return <Navigate to="/cambiar-password" replace />;
  }

  // 3. Exige permiso específico si la ruta lo define
  if (permiso && !tienePermiso(permiso)) {
    return <SinPermiso permisoRequerido={permiso} />;
  }

  return <>{children || <Outlet />}</>;
}
