/**
 * Contrato de las respuestas de medidores (sección 5.1 de la Etapa PV3).
 *
 * Un ejemplo de cada respuesta, copiado de una respuesta real de la rama de pruebas
 * (la de ME-06), con su tipo de `api/tipos.ts`:
 * - del lado del frontend, el typecheck controla que respeten los tipos;
 * - del lado del backend, ME-06 compara cada respuesta real con su ejemplo (`mismaForma`).
 *
 * Solo importa tipos: el backend lo importa desde sus pruebas.
 */
import type { LecturaMedidor, MedidorDetalle, MedidorLista } from './tipos';

/** Un elemento de `GET /api/medidores`. */
export const medidorListaEjemplo: MedidorLista = {
  id: 695,
  nombre: 'Horómetro 30',
  unidad: 'horas',
  activo: true,
  maquina: {
    id: 5187,
    codigo: 'ME_M1_1794876463114',
    nombre: 'Maquina ME M1',
    activo: true,
    sector: {
      id: 1987,
      nombre: 'ME_S1_1794876463114',
    },
  },
  ultima_lectura: {
    id: 723,
    valor: 512.5,
    registrada_en: '2026-11-17T00:47:49.050Z',
    registrada_por: {
      id: 5407,
      legajo: 'ME_A_1794876463114',
      nombre: 'Admin',
      apellido: 'ME',
    },
  },
  tareas_activas: 1,
  lectura_cada_dias: 7,
  dias_sin_lectura: 0,
  atrasado: false,
  creado_en: '2026-11-17T00:47:45.677Z',
  actualizado_en: '2026-11-17T00:47:45.677Z',
};

/** `GET /api/medidores/:id`, con una tarea activa que lo usa. */
export const medidorDetalleEjemplo: MedidorDetalle = {
  id: 695,
  nombre: 'Horómetro 30',
  unidad: 'horas',
  activo: true,
  maquina: {
    id: 5187,
    codigo: 'ME_M1_1794876463114',
    nombre: 'Maquina ME M1',
    activo: true,
    sector: {
      id: 1987,
      nombre: 'ME_S1_1794876463114',
    },
  },
  ultima_lectura: {
    id: 723,
    valor: 512.5,
    registrada_en: '2026-11-17T00:47:49.050Z',
    registrada_por: {
      id: 5407,
      legajo: 'ME_A_1794876463114',
      nombre: 'Admin',
      apellido: 'ME',
    },
  },
  tareas_activas: 1,
  lectura_cada_dias: 7,
  dias_sin_lectura: 0,
  atrasado: false,
  creado_en: '2026-11-17T00:47:45.677Z',
  actualizado_en: '2026-11-17T00:47:45.677Z',
  tareas: [
    {
      id: 2626,
      accion: 'Cambiar el aceite',
      plan: {
        id: 1893,
        nombre: 'Plan ME 1794876463114',
        activo: true,
      },
    },
  ],
};

/** `GET /api/medidores/:id/lecturas`. */
export const lecturasEjemplo: LecturaMedidor[] = [
  {
    id: 64,
    valor: 512.5,
    registrada_en: '2026-11-10T06:50:08.190Z',
    registrada_por: {
      id: 4965,
      legajo: 'ME_A_1794293172292',
      nombre: 'Admin',
      apellido: 'ME',
    },
    origen: 'MANUAL',
    intervencion_id: null,
    observacion: null,
    anulada: false,
    anulada_en: null,
    anulada_por: null,
    motivo_anulacion: null,
  },
  {
    id: 63,
    valor: 500,
    registrada_en: '2026-11-10T06:50:05.016Z',
    registrada_por: {
      id: 4965,
      legajo: 'ME_A_1794293172292',
      nombre: 'Admin',
      apellido: 'ME',
    },
    origen: 'MANUAL',
    intervencion_id: null,
    observacion: null,
    anulada: false,
    anulada_en: null,
    anulada_por: null,
    motivo_anulacion: null,
  },
];

/** `POST /api/medidores/:id/lecturas`. */
export const lecturaCargadaEjemplo: LecturaMedidor = {
  id: 64,
  valor: 512.5,
  registrada_en: '2026-11-10T06:50:08.190Z',
  registrada_por: {
    id: 4965,
    legajo: 'ME_A_1794293172292',
    nombre: 'Admin',
    apellido: 'ME',
  },
  origen: 'MANUAL',
  intervencion_id: null,
  observacion: null,
  anulada: false,
  anulada_en: null,
  anulada_por: null,
  motivo_anulacion: null,
};
