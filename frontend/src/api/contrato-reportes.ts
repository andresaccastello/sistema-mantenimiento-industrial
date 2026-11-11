/**
 * Contrato del reporte de cumplimiento de preventivos (Etapa R1, sección 2.4).
 *
 * Un ejemplo por cada valor de `agrupar` (`sector`, `maquina`, `plan`), con su tipo de
 * `api/tipos.ts`:
 * - del lado del frontend, el typecheck controla que respeten los tipos;
 * - del lado del backend, RPV-09 compara cada respuesta real con su ejemplo (`mismaForma`).
 */
import type {
  GrupoCumplimientoMaquina,
  GrupoCumplimientoPlan,
  GrupoCumplimientoSector,
  ReportePreventivosRespuesta,
} from './tipos';

/** `GET /api/reportes/preventivos?agrupar=sector`. */
export const reportePreventivosSectorEjemplo: ReportePreventivosRespuesta<GrupoCumplimientoSector> = {
  resumen: {
    hechas: 40,
    a_tiempo: 34,
    tarde: 6,
    vencidas_sin_hacer: 2,
    cumplimiento: 81.0,
    atraso_promedio_dias: 3.5,
  },
  grupos: [
    {
      sector: { id: 3, nombre: 'Pintura' },
      hechas: 12,
      a_tiempo: 11,
      tarde: 1,
      vencidas_sin_hacer: 0,
      cumplimiento: 91.7,
      atraso_promedio_dias: 2.0,
    },
  ],
};

/** `GET /api/reportes/preventivos?agrupar=maquina`. */
export const reportePreventivosMaquinaEjemplo: ReportePreventivosRespuesta<GrupoCumplimientoMaquina> = {
  resumen: {
    hechas: 40,
    a_tiempo: 34,
    tarde: 6,
    vencidas_sin_hacer: 2,
    cumplimiento: 81.0,
    atraso_promedio_dias: 3.5,
  },
  grupos: [
    {
      maquina: { id: 10, codigo: 'PIN-01', nombre: 'Cámara de pintura' },
      hechas: 12,
      a_tiempo: 11,
      tarde: 1,
      vencidas_sin_hacer: 0,
      cumplimiento: 91.7,
      atraso_promedio_dias: 2.0,
    },
  ],
};

/** `GET /api/reportes/preventivos?agrupar=plan`. */
export const reportePreventivosPlanEjemplo: ReportePreventivosRespuesta<GrupoCumplimientoPlan> = {
  resumen: {
    hechas: 40,
    a_tiempo: 34,
    tarde: 6,
    vencidas_sin_hacer: 2,
    cumplimiento: 81.0,
    atraso_promedio_dias: 3.5,
  },
  grupos: [
    {
      plan: { id: 25, nombre: 'Plan mensual' },
      maquina: { id: 10, codigo: 'PIN-01', nombre: 'Cámara de pintura' },
      hechas: 12,
      a_tiempo: 11,
      tarde: 1,
      vencidas_sin_hacer: 0,
      cumplimiento: 91.7,
      atraso_promedio_dias: 2.0,
    },
  ],
};

