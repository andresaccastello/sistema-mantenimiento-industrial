import { Badge } from '@mantine/core';

interface CriticidadBadgeProps {
  criticidad: {
    nombre: string;
    prioridad_alta?: boolean;
  };
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export function CriticidadBadge({ criticidad, size = 'sm' }: CriticidadBadgeProps) {
  return (
    <Badge
      color={criticidad.prioridad_alta ? 'red' : 'gray'}
      variant="light"
      size={size}
      styles={{
        root: { textTransform: 'none', fontWeight: 500 },
      }}
    >
      {criticidad.nombre}
    </Badge>
  );
}

