/**
 * Contrato de las respuestas de preventivos (sección 7 de la Etapa PV1).
 *
 * Un ejemplo de cada respuesta, copiado de una respuesta real de la rama de pruebas
 * (la de PV-12), con su tipo de `api/tipos.ts`:
 * - del lado del frontend, el typecheck controla que respeten los tipos;
 * - del lado del backend, PV-12 compara cada respuesta real con su ejemplo (`mismaForma`).
 *
 * Solo importa tipos: el backend lo importa desde sus pruebas.
 */
import type {
  PlanDetalle,
  PlanLista,
  VencimientosRespuesta,
  GeneracionRespuesta,
  IntervencionTareasRespuesta,
} from './tipos';

/** `GET /api/planes/:id`: una tarea con repuesto y proveedor, en curso. */
export const planDetalleEjemplo: PlanDetalle = {
  id: 366,
  nombre: 'Plan PV 38',
  descripcion: 'Plan del contrato',
  activo: true,
  anticipacion_dias: 7,
  hoy: '2026-11-09',
  maquina: {
    id: 4629,
    codigo: 'PV_M1_1794278518823',
    nombre: 'Maquina PV M1',
    activo: true,
    sector: {
      id: 1750,
      nombre: 'PV_S1_1794278518823',
    },
  },
  responsable: {
    id: 4899,
    legajo: 'PV_R_1794278518823',
    nombre: 'Resp',
    apellido: 'PV',
  },
  creado_por: {
    id: 4898,
    legajo: 'PV_A_1794278518823',
    nombre: 'Admin',
    apellido: 'PV',
  },
  creado_en: '2026-11-10T02:49:55.788Z',
  actualizado_en: '2026-11-10T02:49:55.788Z',
  tareas: [
    {
      id: 544,
      orden: 1,
      accion: 'Cambiar el aceite',
      detalle: 'Con el equipo frío',
      frecuencia_valor: 1,
      frecuencia_unidad: 'MESES',
      primera_fecha: '2026-11-06',
      repuestos: [
        {
          repuesto: {
            id: 706,
            codigo: 'PV_R1_1794278518823',
            nombre: 'PV Aceite 1794278518823',
            unidad: 'litro',
          },
          cantidad: 2.5,
        },
      ],
      proveedor: {
        id: 195,
        nombre: 'PV Proveedor 1794278518823',
      },
      activo: true,
      ultima_ejecucion: null,
      proxima_fecha: '2026-11-06',
      dias: -3,
      estado: 'EN_CURSO',
      intervencion_en_curso: {
        id: 18259,
        estado: 'EN_PROCESO',
      },
    },
  ],
  intervenciones: [
    {
      id: 18259,
      estado: 'EN_PROCESO',
      fecha_creacion: '2026-11-10T02:50:01.162Z',
      fecha_finalizacion: null,
      responsable: {
        id: 4899,
        legajo: 'PV_R_1794278518823',
        nombre: 'Resp',
        apellido: 'PV',
      },
    },
  ],
};

/** Un elemento de `GET /api/planes`. */
export const planListaEjemplo: PlanLista = {
  id: 78,
  nombre: 'Plan PV 38',
  activo: true,
  anticipacion_dias: 7,
  maquina: {
    id: 4553,
    codigo: 'PV_M1_1794200445308',
    nombre: 'Maquina PV M1',
    activo: true,
    sector: {
      id: 1719,
      nombre: 'PV_S1_1794200445308',
    },
  },
  responsable: {
    id: 4836,
    legajo: 'PV_R_1794200445308',
    nombre: 'Resp',
    apellido: 'PV',
  },
  tareas_activas: 1,
  vencidas: 0,
  proximas: 0,
  en_curso: 1,
  proxima_fecha: null,
};

/** `GET /api/planes/vencimientos?maquina_id=…&estado=EN_CURSO`, con la tarea del plan de PV-12. */
export const vencimientosEjemplo: VencimientosRespuesta = {
  hoy: '2026-11-09',
  resumen: {
    vencidas: 5,
    proximas: 12,
    en_curso: 29,
    al_dia: 3,
  },
  tareas: [
    {
      tarea_id: 118,
      accion: 'Cambiar el aceite',
      frecuencia_valor: 1,
      frecuencia_unidad: 'MESES',
      ultima_ejecucion: null,
      proxima_fecha: '2026-11-06',
      dias: -3,
      estado: 'EN_CURSO',
      intervencion_en_curso: {
        id: 18081,
        estado: 'PENDIENTE',
      },
      plan: {
        id: 78,
        nombre: 'Plan PV 38',
      },
      maquina: {
        id: 4553,
        codigo: 'PV_M1_1794200445308',
        nombre: 'Maquina PV M1',
        criticidad: {
          nombre: 'Media',
          prioridad_alta: false,
        },
      },
      sector: {
        id: 1719,
        nombre: 'PV_S1_1794200445308',
      },
      responsable: {
        id: 4836,
        legajo: 'PV_R_1794200445308',
        nombre: 'Resp',
        apellido: 'PV',
      },
    },
  ],
};

/** `POST /api/planes/:id/generar`, con el responsable del plan asignado. */
export const generacionEjemplo: GeneracionRespuesta = {
  intervencion: {
    id: 18081,
    estado: 'PENDIENTE',
    responsable: {
      id: 4836,
      legajo: 'PV_R_1794200445308',
      nombre: 'Resp',
      apellido: 'PV',
    },
  },
  responsable_omitido: false,
  tareas: [
    {
      id: 55,
      plan_tarea_id: 118,
      orden: 1,
      accion: 'Cambiar el aceite',
      fecha_programada: '2026-11-06',
    },
  ],
};

/** `GET /api/intervenciones/:id/tareas`, con la tarea marcada. */
export const tareasIntervencionEjemplo: IntervencionTareasRespuesta = {
  tareas: [
    {
      id: 288,
      plan_tarea_id: 544,
      orden: 1,
      accion: 'Cambiar el aceite',
      detalle: 'Con el equipo frío',
      fecha_programada: '2026-11-06',
      repuestos_previstos: [
        {
          id: 5,
          repuesto: {
            id: 706,
            codigo: 'PV_R1_1794278518823',
            nombre: 'PV Aceite 1794278518823',
            unidad: 'litro',
            lleva_stock: false,
            cantidad_disponible: 0,
          },
          cantidad_prevista: 2.5,
          estado: 'USADO',
          consumo: {
            id: 320,
            cantidad: 2,
            anulado: false,
          },
        },
      ],
      proveedor: {
        id: 195,
        nombre: 'PV Proveedor 1794278518823',
      },
      hecha: true,
      hecha_por: {
        id: 4899,
        legajo: 'PV_R_1794278518823',
        nombre: 'Resp',
        apellido: 'PV',
      },
      hecha_en: '2026-11-10T02:50:10.497Z',
      observacion: 'Sin novedades',
    },
  ],
  resumen: {
    total: 1,
    hechas: 1,
    previstos_sin_confirmar: 0,
  },
  puede_marcar: true,
};
