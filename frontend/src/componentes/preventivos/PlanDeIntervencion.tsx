import { Link } from 'react-router';
import { Anchor, Text } from '@mantine/core';
import type { PlanResumen } from '../../api/tipos';
import { useAuth } from '../../auth/AuthContext';

/** R3: "Plan: <nombre>", con enlace a P2 si el usuario tiene PLANES_GESTIONAR; si no, como texto. */
export function PlanDeIntervencion({ plan }: { plan: PlanResumen | null }) {
  const { tienePermiso } = useAuth();
  if (!plan) return null;
  return (
    <Text size="sm" c="dimmed">
      Plan:{' '}
      {tienePermiso('PLANES_GESTIONAR') ? (
        <Anchor component={Link} to={`/preventivos/planes/${plan.id}`} size="sm">
          {plan.nombre}
        </Anchor>
      ) : (
        plan.nombre
      )}
    </Text>
  );
}
