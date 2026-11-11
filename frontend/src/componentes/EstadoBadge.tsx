import React from 'react';
import { Badge } from '@mantine/core';
import {
  IconClock,
  IconTool,
  IconPackage,
  IconCircleCheck,
  IconCircleX,
  IconAlertTriangle,
  IconBan,
  IconGaugeOff,
  IconQuestionMark,
} from '@tabler/icons-react';
import { obtenerInfoEstado, EntidadEstado } from '../lib/estados';

const ICONOS: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  IconClock,
  IconTool,
  IconPackage,
  IconCircleCheck,
  IconCircleX,
  IconAlertTriangle,
  IconBan,
  IconGaugeOff,
  IconQuestionMark,
};

interface EstadoBadgeProps {
  entidad: EntidadEstado;
  estado: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export function EstadoBadge({ entidad, estado, size = 'sm' }: EstadoBadgeProps) {
  const info = obtenerInfoEstado(entidad, estado);
  const IconoComponente = ICONOS[info.icono] || IconQuestionMark;

  return (
    <Badge
      color={info.color}
      variant="light"
      size={size}
      leftSection={<IconoComponente size={14} style={{ display: 'block' }} />}
      styles={{
        root: { textTransform: 'none', fontWeight: 500 },
      }}
    >
      {info.texto}
    </Badge>
  );
}
