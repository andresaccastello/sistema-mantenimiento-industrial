import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { mensajeError, requiereRecargar } from '../../lib/errores';

export interface UseAccionIntervencionOptions {
  intervencionId?: number;
  onCerrar?: () => void;
  avisoExito?: string;
}

export function useAccionIntervencion(options?: UseAccionIntervencionOptions) {
  const queryClient = useQueryClient();
  const [guardando, setGuardando] = useState(false);
  const [errorModal, setErrorModal] = useState<string | null>(null);

  const ejecutar = async (
    peticion: () => Promise<unknown>,
    opcionesPersonalizadas?: {
      avisoExito?: string;
      onExito?: () => void;
      saltarInvalidacionIntervencion?: boolean;
    }
  ) => {
    setErrorModal(null);
    setGuardando(true);

    try {
      await peticion();

      const aviso = opcionesPersonalizadas?.avisoExito ?? options?.avisoExito;
      if (aviso) {
        notifications.show({
          color: 'green',
          message: aviso,
        });
      }

      const invalidaciones: Promise<unknown>[] = [
        queryClient.invalidateQueries({ queryKey: ['intervenciones'] }),
        queryClient.invalidateQueries({ queryKey: ['maquinas'] }),
        queryClient.invalidateQueries({ queryKey: ['maquina'] }),
        queryClient.invalidateQueries({ queryKey: ['tablero'] }),
        queryClient.invalidateQueries({ queryKey: ['notificaciones-contador'] }),
      ];

      if (!opcionesPersonalizadas?.saltarInvalidacionIntervencion) {
        invalidaciones.unshift(
          queryClient.invalidateQueries({
            queryKey: options?.intervencionId
              ? ['intervencion', options.intervencionId]
              : ['intervencion'],
          })
        );
      }

      await Promise.all(invalidaciones);

      if (opcionesPersonalizadas?.onExito) {
        opcionesPersonalizadas.onExito();
      } else {
        options?.onCerrar?.();
      }
    } catch (err: unknown) {
      if (requiereRecargar(err)) {
        options?.onCerrar?.();
        notifications.show({
          color: 'red',
          message: mensajeError(err),
        });
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: options?.intervencionId
              ? ['intervencion', options.intervencionId]
              : ['intervencion'],
          }),
          queryClient.invalidateQueries({ queryKey: ['maquina'] }),
          queryClient.invalidateQueries({ queryKey: ['tablero'] }),
        ]);
      } else {
        setErrorModal(mensajeError(err));
      }
    } finally {
      setGuardando(false);
    }
  };

  return {
    guardando,
    setGuardando,
    errorModal,
    setErrorModal,
    ejecutar,
  };
}
