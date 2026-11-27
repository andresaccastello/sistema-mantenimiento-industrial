import { useEffect } from 'react';
import { useMantineColorScheme } from '@mantine/core';
import { useAuth } from '../auth/AuthContext';
import { esquemaDeTema } from '../lib/preferencias';

/**
 * D1, 5: aplica el tema que el usuario eligió en "Preferencias". Mantine guarda el último esquema
 * en el navegador, así que la pantalla de ingreso usa ese y no parpadea.
 */
export function SincronizarTema() {
  const { usuario } = useAuth();
  const { setColorScheme } = useMantineColorScheme();
  const tema = usuario?.preferencias?.tema;

  useEffect(() => {
    if (tema) setColorScheme(esquemaDeTema(tema));
  }, [tema, setColorScheme]);

  return null;
}
