import { useState } from 'react';
import { Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload } from '@tabler/icons-react';
import { clienteApi } from '../../api/cliente';
import { mensajeError } from '../../lib/errores';
import { mensajeErrorExportacion, nombreArchivoExportacion, urlExportacion } from '../../lib/exportacion';

interface Props {
  /** Los filtros, como los manda el listado (sin la paginación). */
  params: Record<string, string | number | boolean | null | undefined>;
  size?: 'xs' | 'sm';
}

/** El archivo tal cual llega (con su BOM), con el nombre que manda el servidor. */
function guardarArchivo(nombre: string, archivo: Blob) {
  const url = URL.createObjectURL(archivo);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.setAttribute('download', nombre);
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

/** MQ1, 4.3: baja el CSV del historial con los filtros que estén puestos. */
export function BotonExportar({ params, size = 'sm' }: Props) {
  const [bajando, setBajando] = useState(false);

  const exportar = async () => {
    setBajando(true);
    try {
      const { archivo, disposicion } = await clienteApi.descargar(urlExportacion(params));
      guardarArchivo(nombreArchivoExportacion(disposicion, new Date()), archivo);
    } catch (err) {
      notifications.show({ message: mensajeErrorExportacion(err) ?? mensajeError(err), color: 'red' });
    } finally {
      setBajando(false);
    }
  };

  return (
    <Button
      size={size}
      variant="default"
      leftSection={<IconDownload size={16} />}
      onClick={exportar}
      loading={bajando}
    >
      Exportar
    </Button>
  );
}
