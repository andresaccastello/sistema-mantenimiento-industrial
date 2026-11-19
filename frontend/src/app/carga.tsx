import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { Alert, Button, Center, Loader, Stack, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';

/**
 * L1, 4: las pantallas se cargan cuando se abren. Mientras tanto, un indicador dentro del
 * Layout; si el archivo no llega (por ejemplo, se publicó una versión nueva y el viejo ya no
 * existe), "No se pudo cargar la pantalla" con "Reintentar", nunca una pantalla en blanco.
 */

/** El archivo de una pantalla no se pudo descargar. */
class ErrorCargaPantalla extends Error {
  constructor(causa: unknown) {
    super(causa instanceof Error ? causa.message : String(causa));
    this.name = 'ErrorCargaPantalla';
  }
}

/** Una pantalla exportada con nombre, cargada al abrirse. */
export function pantallaPerezosa<M extends Record<string, unknown>, K extends keyof M & string>(
  importar: () => Promise<M>,
  nombre: K
) {
  return lazy(() =>
    importar().then(
      (modulo) => ({ default: modulo[nombre] as ComponentType }),
      (error: unknown) => {
        throw new ErrorCargaPantalla(error);
      }
    )
  );
}

/** El indicador mientras llega la pantalla: el menú queda y la página no salta. */
function CargandoPantalla() {
  return (
    <Center py="xl" mih={240}>
      <Loader color="marca" />
    </Center>
  );
}

function FallaCarga() {
  return (
    <Alert color="red" icon={<IconAlertCircle size={18} />} title="No se pudo cargar la pantalla">
      <Stack gap="sm" align="flex-start">
        <Text size="sm">Puede ser la conexión, o que se haya publicado una versión nueva del sistema.</Text>
        <Button size="xs" variant="light" color="red" onClick={() => window.location.reload()}>
          Reintentar
        </Button>
      </Stack>
    </Alert>
  );
}

interface LimiteProps {
  /** Al cambiar de ruta, se vuelve a intentar. */
  ruta: string;
  children: ReactNode;
}

/**
 * Atrapa solo las fallas de carga. Cualquier otro error sigue como hasta ahora: se vuelve a
 * lanzar, para que lo que el usuario ve no cambie.
 */
class LimiteCarga extends Component<LimiteProps, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidUpdate(previas: LimiteProps) {
    if (previas.ruta !== this.props.ruta && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (error instanceof ErrorCargaPantalla) return <FallaCarga />;
    if (error) throw error;
    return this.props.children;
  }
}

/** Donde el Layout pone la pantalla de la ruta. */
export function ZonaPantalla({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <LimiteCarga ruta={pathname}>
      <Suspense fallback={<CargandoPantalla />}>{children}</Suspense>
    </LimiteCarga>
  );
}
