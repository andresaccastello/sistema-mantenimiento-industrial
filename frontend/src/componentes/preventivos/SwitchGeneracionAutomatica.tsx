import { Switch } from '@mantine/core';

interface Props {
  checked: boolean;
  onChange: (valor: boolean) => void;
}

/** PV5, 5: "Generar la intervención sola", en el alta y la edición del plan. */
export function SwitchGeneracionAutomatica({ checked, onChange }: Props) {
  return (
    <Switch
      color="marca"
      label="Generar la intervención sola"
      description="Cuando una tarea vence o está por vencer, el sistema genera la intervención. Apagado, solo avisa."
      checked={checked}
      onChange={(e) => onChange(e.currentTarget.checked)}
    />
  );
}
