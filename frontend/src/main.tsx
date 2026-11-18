import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { Notifications, notifications } from '@mantine/notifications';
import 'dayjs/locale/es';
import { tema, variablesTema } from './tema/tema';
import { AuthProvider } from './auth/AuthContext';
import { SincronizarTema } from './app/SincronizarTema';
import { ApiError, mensajeError } from './lib/errores';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry(failureCount, error: unknown) {
        if (error instanceof ApiError) {
          if (error.status >= 400 && error.status < 500) {
            return false;
          }
          if (error.codigo === 'SIN_CONEXION' || error.status >= 500) {
            return failureCount < 1;
          }
        }
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      onError(error: unknown) {
        notifications.show({
          color: 'red',
          title: 'Error',
          message: mensajeError(error),
        });
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* D1, 5: el esquema sale de la preferencia del usuario (SincronizarTema). Antes de entrar,
        Mantine usa el último que se usó en este navegador; sin ninguno, claro. */}
    <MantineProvider theme={tema} cssVariablesResolver={variablesTema} defaultColorScheme="light">
      <DatesProvider settings={{ locale: 'es', firstDayOfWeek: 1 }}>
        <Notifications position="top-right" zIndex={1000} />
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <SincronizarTema />
              <App />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </DatesProvider>
    </MantineProvider>
  </React.StrictMode>
);
