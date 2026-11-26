import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ESTADOS_PROXIMA_PLAN, proximasPorUso } from './proximaPlan';
import type { UsoTareaPlan, VencimientoTarea } from '../api/tipos';

function uso(proximo: number, cambios: Partial<UsoTareaPlan> = {}): UsoTareaPlan {
  return {
    medidor: { id: 1, nombre: 'Horómetro', unidad: 'horas', activo: true },
    cada: 250,
    primera: 250,
    anticipacion: 20,
    lectura_actual: { valor: 400, registrada_en: '2026-11-20T10:00:00Z' },
    ultimo: null,
    proximo,
    faltan: proximo - 400,
    estado: 'AL_DIA',
    estimacion: null,
    ...cambios,
  };
}

function tarea(id: number, planId: number, u: UsoTareaPlan | null, cambios: Partial<VencimientoTarea> = {}): VencimientoTarea {
  return {
    tarea_id: id,
    accion: `Tarea ${id}`,
    frecuencia_valor: null,
    frecuencia_unidad: null,
    ultima_ejecucion: null,
    proxima_fecha: null,
    dias: null,
    estado_fecha: null,
    uso: u,
    estado: u?.estado ?? 'AL_DIA',
    intervencion_en_curso: null,
    plan: { id: planId, nombre: `Plan ${planId}` },
    maquina: { id: 1, codigo: 'T-1', nombre: 'Torno', criticidad: { nombre: 'Alta', prioridad_alta: true } },
    sector: { id: 1, nombre: 'Mecanizado' },
    responsable: null,
    ...cambios,
  } as VencimientoTarea;
}

const estimada = (fecha: string) => ({ fecha, fecha_aviso: null, pasada: false, ritmo_por_dia: 8, fuente: 'DECLARADO' as const });

describe('FE-185: la próxima por uso de cada plan, en la tabla de planes de la máquina', () => {
  it('por plan, la tarea por uso que apura: el estado, después la estimada más cercana, después lo que falta', () => {
    const r = proximasPorUso([
      tarea(1, 10, uso(750, { estimacion: estimada('2026-12-20') })),
      tarea(2, 10, uso(500, { estimacion: estimada('2026-12-06') })),
      tarea(3, 10, uso(600)),
      tarea(4, 20, uso(900)),
      tarea(5, 20, uso(800)),
      tarea(6, 30, uso(380, { estado: 'VENCIDA', faltan: -20 })),
      tarea(7, 30, uso(410, { estado: 'PROXIMA', faltan: 10, estimacion: estimada('2026-11-27') })),
    ]);
    assert.deepEqual(
      [...r].map(([plan, u]) => [plan, u.proximo]),
      [
        [10, 500],
        [20, 800],
        [30, 380],
      ]
    );
  });

  it('sin lectura va después de vencida y próxima, y antes de al día', () => {
    const r = proximasPorUso([
      tarea(1, 10, uso(500, { estimacion: estimada('2026-11-30') })),
      tarea(2, 10, uso(700, { estado: 'SIN_LECTURA', faltan: null, lectura_actual: null })),
    ]);
    assert.equal(r.get(10)?.proximo, 700);
  });

  it('las tareas en curso y las que son solo por fecha no cuentan; un plan sin ninguna no está', () => {
    const r = proximasPorUso([
      tarea(1, 10, uso(450), { estado: 'EN_CURSO', intervencion_en_curso: { id: 99, estado: 'PENDIENTE' } }),
      tarea(2, 10, uso(700)),
      tarea(3, 20, null, { proxima_fecha: '2026-12-01', dias: 5, frecuencia_valor: 1, frecuencia_unidad: 'MESES' }),
      tarea(4, 30, uso(450), { estado: 'EN_CURSO', intervencion_en_curso: { id: 98, estado: 'EN_PROCESO' } }),
    ]);
    assert.equal(r.get(10)?.proximo, 700);
    assert.equal(r.has(20), false);
    assert.equal(r.has(30), false);
    assert.equal(proximasPorUso([]).size, 0);
  });

  it('a la API se le piden todos los estados menos EN_CURSO', () => {
    assert.equal(ESTADOS_PROXIMA_PLAN, 'VENCIDA,PROXIMA,SIN_LECTURA,AL_DIA');
  });
});
