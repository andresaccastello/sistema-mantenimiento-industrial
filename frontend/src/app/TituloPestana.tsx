import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clienteApi } from '../api/cliente';
import type { ConfiguracionPublica } from '../api/tipos';
import { tituloPestana } from '../lib/identidad';

/**
 * D1, 6: el título de la pestaña del navegador, con el nombre del sistema. Es la misma consulta
 * que leen el encabezado y el ingreso: al guardar en Configuración, cambia sin recargar.
 */
export function TituloPestana() {
  const { data: config } = useQuery<ConfiguracionPublica>({
    queryKey: ['configuracion-publica'],
    queryFn: () => clienteApi.get<ConfiguracionPublica>('/api/configuracion/publica'),
    staleTime: 1000 * 60 * 10,
  });

  useEffect(() => {
    document.title = tituloPestana(config?.nombre_sistema);
  }, [config?.nombre_sistema]);

  return null;
}
