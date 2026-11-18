import { useAuth } from '../auth/AuthContext';
import { useEsCelular } from './useEsCelular';

/**
 * D1, 4 (D-031): el modo simple, en el celular y solo si el usuario lo tiene prendido. Decide el
 * menú del celular, las rutas permitidas, el destino al entrar, el aviso "Esta sección se usa
 * desde la computadora" y el resumen de Reportes. Lo que es solo adaptarse a la pantalla sigue
 * con `useEsCelular()`.
 *
 * Sin preferencia (todavía sin /me), prendido: es el valor por omisión, el de siempre.
 */
export function useModoSimple(): boolean {
  const esCelular = useEsCelular();
  const { usuario } = useAuth();
  return esCelular && (usuario?.preferencias?.modo_simple_celular ?? true);
}
