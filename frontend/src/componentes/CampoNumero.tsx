import { NumberInput, NumberInputProps } from '@mantine/core';

/**
 * Campo numérico de los diálogos (repuestos y costos).
 *
 * Nunca cambia lo que escribe el usuario: sin `min` ni `max`, y con
 * `clampBehavior="none"`, el valor no se lleva a ningún límite al salir del
 * campo. Los límites los controlan `validarCantidad` y `validarCosto` al
 * confirmar, con el error en el campo.
 */
export type CampoNumeroProps = Omit<NumberInputProps, 'min' | 'max' | 'clampBehavior'>;

export function CampoNumero(props: CampoNumeroProps) {
  return (
    <NumberInput
      decimalSeparator=","
      thousandSeparator="."
      {...props}
      clampBehavior="none"
    />
  );
}
