import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { tema } from './tema/tema';
import { AuthProvider } from './auth/AuthContext';
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
    <MantineProvider theme={tema} forceColorScheme="light">
      <Notifications position="top-right" zIndex={1000} />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>
);
