import { useMediaQuery } from '@mantine/hooks';
import { CORTE_CELULAR } from './celular';

/**
 * Si la pantalla es de celular (LE1, 7.5). Es el único lugar que lee CORTE_CELULAR.
 *
 * El ancho se lee en el primer render (`getInitialValueInEffect: false`). Si arrancara en
 * false, el primer render en el celular sería de computadora: una pantalla podría redirigir
 * o pedir datos que no corresponden, y cambiar recién en el segundo.
 */
export function useEsCelular(): boolean {
  return Boolean(useMediaQuery(CORTE_CELULAR, undefined, { getInitialValueInEffect: false }));
}
