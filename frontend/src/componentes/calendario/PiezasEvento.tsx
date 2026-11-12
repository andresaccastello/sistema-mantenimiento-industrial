import type { CSSProperties } from 'react';
import { Badge } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import type { EventoCalendario } from '../../api/tipos';
import { colorEvento } from '../../lib/calendario';
import { EstadoBadge } from '../EstadoBadge';

/**
 * El estilo de un evento en la grilla y en la semana (CAL1, 3.2): pendiente con el color de
 * su estado, hecha en teal y prevista en gris, con borde punteado y texto más claro.
 */
export function estiloEvento(e: EventoCalendario): CSSProperties {
  const color = colorEvento(e);
  if (e.tipo === 'PREVISTA') {
    return {
      border: '1px dashed var(--mantine-color-gray-5)',
      background: 'transparent',
      color: 'var(--mantine-color-dimmed)',
    };
  }
  return {
    border: '1px solid transparent',
    borderLeft: `3px solid var(--mantine-color-${color}-6)`,
    background: `var(--mantine-color-${color}-light)`,
    color: `var(--mantine-color-${color}-light-color)`,
  };
}

/** "PIN-01 · Cambiar filtros", con un ✓ delante si está hecha. */
export function textoLineaEvento(e: EventoCalendario): string {
  const maquina = (e.maquina.codigo || '').trim() || e.maquina.nombre;
  return `${e.tipo === 'HECHA' ? '✓ ' : ''}${maquina} · ${e.accion}`;
}

/** El estado con su Badge, o "Hecha" o "Prevista". */
export function BadgeEvento({ evento, size = 'sm' }: { evento: EventoCalendario; size?: 'xs' | 'sm' }) {
  if (evento.tipo === 'PENDIENTE') {
    return <EstadoBadge entidad="tarea_preventiva" estado={evento.estado ?? ''} size={size} />;
  }
  const hecha = evento.tipo === 'HECHA';
  return (
    <Badge
      color={hecha ? 'teal' : 'gray'}
      variant={hecha ? 'light' : 'outline'}
      size={size}
      leftSection={hecha ? <IconCheck size={14} style={{ display: 'block' }} /> : undefined}
      styles={{ root: { textTransform: 'none', fontWeight: 500, borderStyle: hecha ? undefined : 'dashed' } }}
    >
      {hecha ? 'Hecha' : 'Prevista'}
    </Badge>
  );
}
