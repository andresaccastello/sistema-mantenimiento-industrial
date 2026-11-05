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
  email?: string | null;
  telefono_whatsapp?: string | null;
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

export interface Criticidad {
  id: number;
  codigo: string;
  nombre: string;
  orden: number;
  prioridad_alta: boolean;
  por_omision?: boolean;
  activo?: boolean;
  maquinas_activas?: number;
}

export interface TipoEquipo {
  id: number;
  codigo: string;
  nombre: string;
  orden?: number;
  por_omision?: boolean;
  activo?: boolean;
  maquinas_activas?: number;
}

export interface Planta {
  id: number;
  nombre: string;
  descripcion?: string | null;
  activo?: boolean;
  creado_en?: string;
  sectores_activos?: number;
}

export interface MaquinaLista {
  id: number;
  codigo: string | null;
  nombre: string;
  modelo: string | null;
  estado: string;
  estado_desde: string;
  ubicacion: string | null;
  observaciones: string | null;
  activo: boolean;
  creado_en: string;
  criticidad: Criticidad;
  tipo_equipo: TipoEquipo;
  sector: {
    id: number;
    nombre: string;
    planta: { id: number; nombre: string } | null;
  };
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
  planta: { id: number; nombre: string } | null;
  maquinas_activas?: number;
  usuarios_activos?: number;
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

export interface TableroDetenidaAhora {
  maquina: {
    id: number;
    nombre: string;
    codigo: string | null;
    criticidad: {
      id: number;
      codigo: string;
      nombre: string;
      orden: number;
      prioridad_alta?: boolean;
    };
    sector: {
      id: number;
      nombre: string;
      planta: { id: number; nombre: string } | null;
    };
  };
  estado: string;
  detenida_desde: string;
  inactividad_en_curso_minutos: number;
  intervenciones_abiertas: number;
}

export interface TableroResumen {
  maquinas: {
    OPERATIVA: number;
    DETENIDA: number;
    EN_MANTENIMIENTO: number;
    FUERA_DE_SERVICIO: number;
    [key: string]: number;
  };
  intervenciones: {
    PENDIENTE: number;
    EN_PROCESO: number;
    EN_ESPERA_REPUESTOS: number;
    sin_asignar: number;
    mias_abiertas: number;
  };
  detenidas_ahora: TableroDetenidaAhora[];
}

export interface DetencionAbiertaMaquina {
  periodo: {
    id: number;
    desde: string;
    observacion: string | null;
    abierto_por_usuario_id: number | null;
    abierto_por_nombre: string | null;
  };
  intervencion: {
    id: number;
    descripcion: string;
    estado: string;
    responsable_usuario_id: number | null;
    responsable_nombre: string | null;
  };
}

export interface InactividadMaquina {
  maquina: {
    id: number;
    nombre: string;
    codigo: string | null;
    sector: {
      id: number;
      nombre: string;
    };
  };
  intervalo: {
    desde: string;
    hasta: string;
  };
  inactividad_minutos: number;
  por_tipo: {
    CORRECTIVO: number;
    PREVENTIVO: number;
  };
  fuera_de_servicio_descontado_minutos: number;
  periodos: {
    id: number;
    intervencion_id: number;
    tipo: string;
    desde: string;
    hasta: string | null;
    abierto: boolean;
  }[];
}

/* =====================================================================
 * Tipos para la API de administración (sección 6 - Etapa F4a)
 * ===================================================================== */

export interface SectorAdmin extends SectorLista {
  maquinas_activas: number;
  usuarios_activos: number;
}

export interface PlantaAdmin extends Planta {
  activo: boolean;
  sectores_activos: number;
}

export interface CriticidadAdmin extends Criticidad {
  por_omision: boolean;
  activo: boolean;
  maquinas_activas: number;
}

export interface TipoEquipoAdmin extends TipoEquipo {
  orden: number;
  por_omision: boolean;
  activo: boolean;
  maquinas_activas: number;
}

export interface PerfilDetalle {
  id: number;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  usuarios_activos: number;
  permisos: {
    codigo: string;
    nombre: string;
    alcance: AlcancePermiso | null;
  }[];
}

export interface PermisoCatalogo {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  usa_alcance: boolean;
}

export interface UsuarioListaItem {
  id: number;
  legajo: string;
  nombre: string;
  apellido: string | null;
  email?: string | null;
  telefono_whatsapp?: string | null;
  activo: boolean;
  ultimo_acceso_en: string | null;
  debe_cambiar_password: boolean;
  perfil: PerfilUsuario;
  sectores: SectorUsuario[];
}

export interface ExcepcionPermisoDetalle {
  id: number;
  codigo: string;
  nombre: string;
  efecto: 'CONCEDER' | 'DENEGAR';
  alcance: AlcancePermiso | null;
  motivo: string;
  creado_en: string;
  usa_alcance: boolean;
  otorgado_por: {
    id: number;
    nombre: string;
    apellido: string | null;
  } | null;
}

export interface UsuarioDetalleAdmin {
  id: number;
  legajo: string;
  nombre: string;
  apellido: string | null;
  email?: string | null;
  telefono_whatsapp?: string | null;
  activo: boolean;
  ultimo_acceso_en: string | null;
  debe_cambiar_password: boolean;
  creado_en: string;
  actualizado_en: string | null;
  perfil: PerfilUsuario;
  sectores: SectorUsuario[];
  permisos: Record<string, AlcancePermiso | string>;
  excepciones: ExcepcionPermisoDetalle[];
  intervenciones_abiertas_como_responsable: number;
}

export interface UsuarioAuditoriaRegistro {
  id: number;
  accion: string;
  creado_en: string;
  realizado_por: {
    id: number;
    nombre: string;
    apellido: string | null;
  } | null;
  detalle: any;
}

export interface UsuarioAuditoriaResponse {
  total: number;
  registros: UsuarioAuditoriaRegistro[];
  referencias: {
    perfiles: Record<string, string>;
    sectores: Record<string, string>;
  };
}

// =============================================================================
// Avisos por email y WhatsApp (Etapa N1b)
// =============================================================================

export type ModoAviso = 'NUNCA' | 'SOLO_ALTA' | 'SIEMPRE';

export interface CanalAviso {
  canal: 'EMAIL' | 'WHATSAPP';
  activo: boolean;
  disponible: boolean;
  configurado: boolean;
  transporte: string | null;
  remitente: string | null;
  actualizado_en: string | null;
  actualizado_por: {
    id: number;
    nombre: string;
    apellido: string | null;
  } | null;
}

export interface ReglaAviso {
  tipo_evento: string;
  EMAIL: ModoAviso;
  WHATSAPP: ModoAviso;
}

export interface ConfiguracionAvisos {
  canales: CanalAviso[];
  reglas: ReglaAviso[];
  pendientes: number;
}

export interface EnvioAviso {
  id: number;
  canal: string;
  estado: 'PENDIENTE' | 'ENVIADO' | 'ERROR' | 'DESCARTADO';
  intentos: number;
  ultimo_error: string | null;
  destino: string | null;
  creado_en: string;
  enviado_en: string | null;
  proximo_intento_en: string | null;
  notificacion: {
    id: number;
    tipo_evento: string;
    prioridad: 'ALTA' | 'NORMAL';
    titulo: string;
    intervencion_id: number | null;
  };
  usuario: {
    id: number;
    nombre: string;
    apellido: string | null;
  };
}

export interface EnviosAvisos {
  total: number;
  envios: EnvioAviso[];
}
