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

export interface Usuario {
  id: number;
  legajo: string;
  nombre: string;
  apellido: string;
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
