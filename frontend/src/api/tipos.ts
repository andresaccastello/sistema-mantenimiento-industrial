/**
 * Tipos de datos para la API del frontend
 */

export interface SectorUsuario {
  id: number;
  nombre: string;
}

export interface PerfilUsuario {
  id: number;
  nombre: string;
}

export type AlcancePermiso = 'PROPIAS' | 'SECTORES' | 'TODAS';

export interface Persona {
  id: number;
  legajo: string;
  nombre: string;
  apellido: string | null;
}

export interface SectorSimple {
  id: number;
  nombre: string;
}

export interface Usuario {
  id: number;
  legajo: string;
  nombre: string;
  apellido: string | null;
  perfil: PerfilUsuario;
  sectores: SectorUsuario[];
  permisos: Record<string, AlcancePermiso | string>;
  debe_cambiar_password: boolean;
}

export interface LoginResponse {
  token: string;
  debe_cambiar_password: boolean;
  usuario?: Usuario;
}

export interface CambiarPasswordResponse {
  mensaje: string;
  token?: string;
}

export interface ConfiguracionPublica {
  nombre_sistema: string;
  nombre_empresa: string | null;
  tiene_logo: boolean;
  actualizado_en?: string;
}

export type PrioridadNotificacion = 'ALTA' | 'NORMAL' | 'BAJA' | string;

export interface Notificacion {
  id: number;
  tipo_evento?: string;
  prioridad: PrioridadNotificacion;
  titulo: string;
  mensaje: string;
  intervencion_id: number | null;
  maquina_id?: number | null;
  creada_en: string;
  leida: boolean;
  leida_en: string | null;
}

export interface ContadorNotificaciones {
  no_leidas: number;
  no_leidas_alta?: number;
}

export interface ListaResultado<T> {
  items: T[];
  total: number;
}

export interface MaquinaLista {
  id: number;
  codigo: string | null;
  nombre: string;
  tipo: string;
  estado: string;
  ubicacion: string | null;
  observaciones: string | null;
  activo: boolean;
  creado_en: string;
  sector: SectorSimple;
  intervenciones_abiertas: number;
}

export interface TiemposIntervencion {
  espera_minutos: number | null;
  espera_en_curso: boolean;
  duracion_bruta_minutos: number | null;
  duracion_neta_minutos: number | null;
  tiempo_total_minutos: number | null;
  trabajo_en_curso: boolean;
  inactividad_minutos: number;
  inactividad_en_curso: boolean;
}

export interface IntervencionLista {
  id: number;
  descripcion: string;
  estado: string;
  ejecucion: string | null;
  fecha_creacion: string;
  fecha_inicio: string | null;
  fecha_finalizacion: string | null;
  tiempo_inactividad_minutos: number | null;
  detiene_maquina_actualmente: boolean;
  eliminada: boolean;
  eliminado_en: string | null;
  eliminado_por: Persona | null;
  motivo_eliminacion: string | null;
  maquina: {
    id: number;
    nombre: string;
    codigo: string | null;
    estado: string;
    sector: SectorSimple;
  };
  creado_por: Persona;
  responsable: Persona | null;
  tiempos: TiemposIntervencion;
}

export interface HistorialEstado {
  id: number;
  estado_anterior: string | null;
  estado_nuevo: string;
  observacion: string | null;
  cambiado_en: string;
  fecha_efectiva: string | null;
  cambiado_por: Persona;
}

export interface PeriodoDetencion {
  id: number;
  desde: string;
  hasta: string | null;
  esta_abierto: boolean;
  observacion: string | null;
  observacion_confirmacion: string | null;
  abierto_por: { id: number; nombre: string; apellido: string | null };
  confirmado_por: { id: number; nombre: string; apellido: string | null } | null;
}

export interface AuditoriaItem {
  id: number;
  tipo_evento: string;
  campo_modificado: string | null;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  motivo: string | null;
  creado_en: string;
  realizado_por: Persona;
  responsable_anterior: Persona | null;
  responsable_nuevo: Persona | null;
}

export interface SectorLista {
  id: number;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  creado_en: string;
}

export interface IntervencionDetalle {
  id: number;
  descripcion: string;
  estado: string;
  ejecucion: string | null;
  observaciones: string | null;
  trabajo_realizado: string | null;
  fecha_creacion: string;
  fecha_inicio: string | null;
  fecha_finalizacion: string | null;
  tiempo_inactividad_minutos: number | null;
  acciones_disponibles: string[];
  tiempos: TiemposIntervencion;
  maquina: {
    id: number;
    nombre: string;
    codigo: string | null;
    estado: string;
    sector: SectorSimple;
  };
  creado_por: Persona;
  responsable: Persona | null;
  historial_estados: HistorialEstado[];
  periodos_detencion: PeriodoDetencion[];
  auditoria: AuditoriaItem[];
}

export interface IntervencionCreada {
  id: number;
  estado: string;
  descripcion: string;
  observaciones: string | null;
  fecha_creacion: string;
  detiene_maquina: boolean;
  periodo_detencion_id: number | null;
  maquina: {
    id: number;
    nombre: string;
    estado_actual: string;
    sector: SectorSimple;
  };
}
