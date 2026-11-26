import type { UsoTareaPlan, VencimientoTarea } from '../api/tipos';

/** Los estados que se piden a /api/planes/vencimientos para la próxima por uso: todos menos EN_CURSO. */
export const ESTADOS_PROXIMA_PLAN = 'VENCIDA,PROXIMA,SIN_LECTURA,AL_DIA';

const ORDEN_ESTADO: Record<UsoTareaPlan['estado'], number> = { VENCIDA: 1, PROXIMA: 2, SIN_LECTURA: 3, AL_DIA: 4 };

/**
 * La próxima por uso de cada plan, para la tabla de planes de la ficha de la máquina: entre sus
 * tareas por uso que no están en curso, la que apura más. Primero por el estado del uso (vencida,
 * próxima, sin lectura, al día), después la fecha estimada más cercana (sin estimación, al final),
 * después lo que falta y, al final, la tarea. Un plan sin tareas por uso no está en el mapa.
 */
export function proximasPorUso(tareas: VencimientoTarea[]): Map<number, UsoTareaPlan> {
  const elegidas = new Map<number, VencimientoTarea & { uso: UsoTareaPlan }>();
  for (const t of tareas) {
    if (t.uso === null || t.estado === 'EN_CURSO' || t.intervencion_en_curso !== null) continue;
    const conUso = t as VencimientoTarea & { uso: UsoTareaPlan };
    const actual = elegidas.get(t.plan.id);
    if (!actual || compararPorUso(conUso, actual) < 0) elegidas.set(t.plan.id, conUso);
  }
  return new Map([...elegidas].map(([planId, t]) => [planId, t.uso]));
}

function compararPorUso(a: VencimientoTarea & { uso: UsoTareaPlan }, b: VencimientoTarea & { uso: UsoTareaPlan }): number {
  const estado = ORDEN_ESTADO[a.uso.estado] - ORDEN_ESTADO[b.uso.estado];
  if (estado !== 0) return estado;
  const fa = a.uso.estimacion?.fecha ?? null;
  const fb = b.uso.estimacion?.fecha ?? null;
  if (fa !== fb) {
    if (fa === null) return 1;
    if (fb === null) return -1;
    return fa < fb ? -1 : 1;
  }
  const xa = a.uso.faltan;
  const xb = b.uso.faltan;
  if (xa !== xb) {
    if (xa === null) return 1;
    if (xb === null) return -1;
    return xa - xb;
  }
  return a.tarea_id - b.tarea_id;
}
