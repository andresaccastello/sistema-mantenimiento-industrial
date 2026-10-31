import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { clienteApi, registrarReaccionAuth } from '../api/cliente';
import { obtenerToken, guardarToken, eliminarToken } from './sesion';
import type { Usuario, AlcancePermiso } from '../api/tipos';

export interface AuthContextValue {
  token: string | null;
  usuario: Usuario | null;
  cargando: boolean;
  tienePermiso: (codigo: string) => boolean;
  alcance: (codigo: string) => AlcancePermiso | string | null;
  ingresar: (token: string, debeCambiarPassword?: boolean) => Promise<void>;
  salir: () => void;
  recargarUsuario: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(obtenerToken());
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cerrandoSesionRef = useRef(false);

  const salir = useCallback(() => {
    eliminarToken();
    setToken(null);
    setUsuario(null);
    queryClient.clear();
    navigate('/ingreso');
  }, [navigate, queryClient]);

  const recargarUsuario = useCallback(async (): Promise<void> => {
    const t = obtenerToken();
    if (!t) {
      setUsuario(null);
      setToken(null);
      return;
    }

    try {
      const u = await clienteApi.get<Usuario>('/api/auth/me');
      setUsuario(u);
      setToken(t);
      cerrandoSesionRef.current = false;
    } catch (err) {
      console.error('Error al obtener usuario actual:', err);
      eliminarToken();
      setToken(null);
      setUsuario(null);
      throw err;
    }
  }, []);

  const ingresar = useCallback(
    async (nuevoToken: string, debeCambiarPassword?: boolean): Promise<void> => {
      guardarToken(nuevoToken);
      setToken(nuevoToken);
      cerrandoSesionRef.current = false;
      try {
        const u = await clienteApi.get<Usuario>('/api/auth/me');
        setUsuario(u);
      } catch (_err) {
        if (debeCambiarPassword) {
          navigate('/cambiar-password');
        }
      }
    },
    [navigate]
  );

  useEffect(() => {
    const handleReaccion = (reaccion: 'cerrar_sesion' | 'cambiar_password') => {
      if (reaccion === 'cerrar_sesion') {
        if (cerrandoSesionRef.current) return;
        cerrandoSesionRef.current = true;

        eliminarToken();
        setToken(null);
        setUsuario(null);
        queryClient.clear();
        notifications.show({
          id: 'sesion-finalizada',
          color: 'yellow',
          title: 'Sesión finalizada',
          message: 'Tu sesión terminó. Volvé a ingresar.',
        });
        navigate('/ingreso');
      } else if (reaccion === 'cambiar_password') {
        navigate('/cambiar-password');
      }
    };

    registrarReaccionAuth(handleReaccion);

    const onCustomCerrar = () => handleReaccion('cerrar_sesion');
    const onCustomCambiar = () => handleReaccion('cambiar_password');
    window.addEventListener('auth:cerrar_sesion', onCustomCerrar);
    window.addEventListener('auth:cambiar_password', onCustomCambiar);

    return () => {
      registrarReaccionAuth(null);
      window.removeEventListener('auth:cerrar_sesion', onCustomCerrar);
      window.removeEventListener('auth:cambiar_password', onCustomCambiar);
    };
  }, [navigate, queryClient]);

  // Carga inicial
  useEffect(() => {
    const t = obtenerToken();
    if (t) {
      recargarUsuario()
        .catch(() => {
          eliminarToken();
          setToken(null);
          setUsuario(null);
        })
        .finally(() => {
          setCargando(false);
        });
    } else {
      setCargando(false);
    }
  }, [recargarUsuario]);

  const tienePermiso = useCallback(
    (codigo: string): boolean => {
      if (!usuario || !usuario.permisos) return false;
      return Boolean(usuario.permisos[codigo]);
    },
    [usuario]
  );

  const alcance = useCallback(
    (codigo: string): AlcancePermiso | string | null => {
      if (!usuario || !usuario.permisos) return null;
      return usuario.permisos[codigo] || null;
    },
    [usuario]
  );

  return (
    <AuthContext.Provider
      value={{
        token,
        usuario,
        cargando,
        tienePermiso,
        alcance,
        ingresar,
        salir,
        recargarUsuario,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider');
  }
  return context;
}
