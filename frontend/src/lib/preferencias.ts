/**
 * D1, 4 y 5: las preferencias de cada usuario (D-031).
 */
import type { TemaUsuario } from '../api/tipos';

/** El esquema de Mantine de cada tema: SISTEMA sigue al dispositivo ("auto"). */
export function esquemaDeTema(tema: TemaUsuario | null | undefined): 'light' | 'dark' | 'auto' {
  if (tema === 'OSCURO') return 'dark';
  if (tema === 'SISTEMA') return 'auto';
  return 'light';
}

/** Las opciones del SegmentedControl de "Preferencias", en orden. */
export const OPCIONES_TEMA: Array<{ value: TemaUsuario; label: string }> = [
  { value: 'CLARO', label: 'Claro' },
  { value: 'OSCURO', label: 'Oscuro' },
  { value: 'SISTEMA', label: 'Como el dispositivo' },
];

/** La ayuda del interruptor "Modo simple en el celular" (D1, 4). */
export const AYUDA_MODO_SIMPLE =
  'En el celular muestra solo lo esencial: reportar fallas, tus reportes, la ronda de lecturas y un resumen de reportes. Apagado, en el celular ves lo mismo que en la computadora, según tu perfil.';
