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
  tipo: TipoIntervencion;
  plan: PlanResumen | null;
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
  tipo: TipoIntervencion;
  plan: PlanResumen | null;
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

// =============================================================================
// Reportes e Indicadores (Etapa F5)
// =============================================================================

export interface IndicadoresReporte {
  desde: string;
  hasta: string;
  maquinas: number;
  minutos_periodo: number;
  inactividad_minutos: number;
  inactividad_correctiva_minutos: number;
  inactividad_preventiva_minutos: number;
  disponibilidad: number | null;
  fallas: number;
  correctivas_finalizadas: number;
  preventivas_finalizadas: number;
  mttr_minutos: number | null;
  respuesta_promedio_minutos: number | null;
  mtbf_horas: number | null;
}

export interface InactividadMaquinaFila {
  maquina: {
    id: number;
    nombre: string;
    codigo: string;
    sector: {
      id: number;
      nombre: string;
    };
  };
  inactividad_minutos: number;
  por_tipo: {
    CORRECTIVO: number;
    PREVENTIVO: number;
  };
  intervenciones_con_detencion: number;
}

export interface TiemposAgrupadosFila {
  grupo: string;
  cantidad: number;
  espera_promedio_minutos: number | null;
  duracion_neta_promedio_minutos: number | null;
  duracion_bruta_promedio_minutos: number | null;
  duracion_neta_total_minutos: number | null;
  duracion_bruta_total_minutos?: number | null;
  ejecucion?: string | null;
  tipo?: { id: number; codigo: string; nombre: string } | null;
  sector?: { id: number; nombre: string } | null;
}

// =============================================================================
// Repuestos, Proveedores y Pedidos (Etapa R1)
// =============================================================================

export interface ProveedorOpcion {
  id: number;
  nombre: string;
}
export type ProveedorSimple = ProveedorOpcion;

export interface ProveedorRepuesto {
  id: number;
  nombre: string;
  activo: boolean;
}

export interface ProveedorItem {
  id: number;
  nombre: string;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  activo: boolean;
  repuestos_activos: number;
}
export type ProveedorFila = ProveedorItem;

export type EstadoStockRepuesto = 'OK' | 'BAJO' | 'SIN_STOCK' | 'SIN_CONTROL';

export interface RepuestoListaItem {
  id: number;
  codigo: string | null;
  nombre: string;
  unidad: string;
  lleva_stock: boolean;
  cantidad_disponible: number;
  stock_minimo: number | null;
  estado_stock: EstadoStockRepuesto;
  costo_unitario: number | null;
  proveedor: ProveedorRepuesto | null;
  ubicacion: string | null;
  activo: boolean;
}
export type RepuestoFila = RepuestoListaItem;

export interface RepuestoOpcion {
  id: number;
  codigo: string | null;
  nombre: string;
  unidad: string;
  lleva_stock: boolean;
  cantidad_disponible: number;
  costo_unitario: number | null;
}

export interface RepuestoDetalle {
  id: number;
  codigo: string | null;
  nombre: string;
  unidad: string;
  lleva_stock: boolean;
  cantidad_disponible: number;
  stock_minimo: number | null;
  estado_stock: EstadoStockRepuesto;
  costo_unitario: number | null;
  proveedor: ProveedorRepuesto | null;
  ubicacion: string | null;
  activo: boolean;
  descripcion: string | null;
  creado_en: string;
  actualizado_en: string;
  pedidos_abiertos: number;
  consumos_vigentes: number;
}

export type TipoMovimientoStock = 'INGRESO' | 'EGRESO' | 'AJUSTE' | 'DEVOLUCION';

export interface MovimientoStockItem {
  id: number;
  tipo: TipoMovimientoStock;
  cantidad: number;
  delta: number | null;
  stock_resultante: number | null;
  costo_unitario: number | null;
  proveedor: ProveedorOpcion | null;
  comprobante: string | null;
  observacion: string | null;
  intervencion_id: number | null;
  realizado_por: { id: number; nombre: string; apellido: string | null } | null;
  realizado_en: string;
}

export interface RespuestaMovimientoManual {
  movimiento: MovimientoStockItem;
  repuesto: RepuestoDetalle;
}

export interface UsoRepuestoItem {
  consumo_id: number;
  intervencion: {
    id: number;
    estado: string;
  };
  maquina: {
    id: number;
    codigo: string | null;
    nombre: string;
  };
  cantidad: number;
  costo_unitario_aplicado: number | null;
  importe: number | null;
  registrado_en: string;
  anulado: boolean;
}

export interface CostoHistorialItem {
  id: number;
  costo_unitario: number;
  origen: string;
  registrado_por: { id: number; nombre: string; apellido: string | null } | null;
  registrado_en: string;
}

export interface ConsumoIntervencionItem {
  id: number;
  repuesto: {
    id: number;
    codigo: string | null;
    nombre: string;
    unidad: string;
  };
  cantidad: number;
  costo_unitario_aplicado: number | null;
  importe: number | null;
  observacion: string | null;
  registrado_por: { id: number; nombre: string; apellido: string | null } | null;
  registrado_en: string;
  movimiento_id: number | null;
  movio_stock: boolean;
  anulado: boolean;
  anulado_por: { id: number; nombre: string; apellido: string | null } | null;
  anulado_en: string | null;
  motivo_anulacion: string | null;
}

export interface IntervencionRepuestosRespuesta {
  consumos: ConsumoIntervencionItem[];
  total_repuestos: number | null;
  ve_costos: boolean;
  puede_registrar: boolean;
  puede_anular: boolean;
}

export type EstadoPedidoRepuesto = 'PENDIENTE' | 'PEDIDO' | 'RECIBIDO' | 'CANCELADO';

export interface PedidoIntervencionItem {
  id: number;
  intervencion_id: number;
  repuesto: {
    id: number;
    codigo: string | null;
    nombre: string;
    unidad: string;
    lleva_stock: boolean;
  } | null;
  descripcion: string | null;
  cantidad: number;
  proveedor: ProveedorOpcion | null;
  estado: EstadoPedidoRepuesto;
  pedido_en: string | null;
  esperado_para: string | null;
  recibido_en: string | null;
  observacion: string | null;
  motivo_cancelacion: string | null;
  ingreso_stock: boolean;
  creado_por: { id: number; nombre: string; apellido: string | null } | null;
  creado_en: string;
  actualizado_en: string;
}

export interface IntervencionPedidosRespuesta {
  pedidos: PedidoIntervencionItem[];
  puede_crear: boolean;
  puede_gestionar: boolean;
}

export interface PedidoRepuestoItem extends PedidoIntervencionItem {
  intervencion: {
    id: number;
    estado: string;
    descripcion: string;
  };
  maquina: {
    id: number;
    codigo: string | null;
    nombre: string;
  };
  sector: {
    id: number;
    nombre: string;
  };
}

// Cuerpos que manda el frontend (secciones 4 y 5 de la R1)

/** `POST /api/repuestos` y `PUT /api/repuestos/:id` (4.3). */
export interface CuerpoRepuesto {
  codigo?: string | null;
  nombre: string;
  unidad?: string;
  lleva_stock?: boolean;
  /** Solo en el alta. */
  stock_inicial?: number;
  stock_minimo?: number | null;
  costo_unitario?: number | null;
  proveedor_id?: number | null;
  ubicacion?: string | null;
  descripcion?: string | null;
  activo?: boolean;
}

/** `POST /api/repuestos/:id/movimientos` (4.4). */
export type CuerpoMovimiento =
  | {
      tipo: 'INGRESO';
      cantidad: number;
      costo_unitario?: number;
      proveedor_id?: number;
      comprobante?: string;
      observacion?: string;
    }
  | { tipo: 'EGRESO'; cantidad: number; observacion: string }
  | { tipo: 'AJUSTE'; cantidad_contada: number; observacion: string };

/** `POST /api/intervenciones/:id/repuestos` (5.1). */
export interface CuerpoConsumo {
  repuesto_id: number;
  cantidad: number;
  observacion?: string | null;
  /** Solo para un repuesto sin control de stock. */
  costo_unitario?: number;
  /** Obligatorio en una intervención finalizada. */
  motivo?: string;
}

/** `POST /api/intervenciones/:id/pedidos` y `PATCH …/pedidos/:pedidoId` (5.2). */
export interface CuerpoPedido {
  repuesto_id?: number | null;
  descripcion?: string | null;
  cantidad: number;
  proveedor_id?: number | null;
  /** `YYYY-MM-DD`. */
  pedido_en?: string | null;
  /** `YYYY-MM-DD`. */
  esperado_para?: string | null;
  observacion?: string | null;
}

/** `POST /api/intervenciones/:id/pedidos/:pedidoId/recibir` (5.2). */
export interface CuerpoRecepcion {
  recibido_en?: string;
  ingresar_stock?: boolean;
  costo_unitario?: number;
  comprobante?: string | null;
}

export interface ReporteRepuestosRespuesta {
  desde: string;
  hasta: string;
  ve_costos: boolean;
  consumos: number;
  intervenciones: number;
  importe_total: number | null;
  por_repuesto: Array<{
    repuesto: {
      id: number;
      codigo: string | null;
      nombre: string;
      unidad: string;
    };
    cantidad: number;
    consumos: number;
    intervenciones: number;
    importe: number | null;
  }>;
  por_maquina: Array<{
    maquina: {
      id: number;
      codigo: string | null;
      nombre: string;
    };
    sector: {
      id: number;
      nombre: string;
    };
    consumos: number;
    importe: number | null;
  }>;
}

// =============================================================================
// Costos de la intervención (Etapa C1)
// =============================================================================

export type TipoCosto = 'MANO_OBRA' | 'SERVICIO_EXTERNO' | 'TRANSPORTE' | 'OTRO' | 'AJUSTE';

/** Una persona dentro de una respuesta: sin legajo. */
export interface PersonaResumen {
  id: number;
  nombre: string;
  apellido: string | null;
}

/** Un renglón de `GET /api/intervenciones/:id/costos`, y la respuesta del `POST` y de la anulación. */
export interface RenglonCosto {
  id: number;
  tipo: TipoCosto;
  descripcion: string;
  /** `null` sin `COSTOS_VER`. */
  importe: number | null;
  /** `null` sin `COSTOS_VER`, o si no se cargó. */
  valor_hora: number | null;
  /** `null` si no es `MANO_OBRA`. */
  horas: number | null;
  persona: PersonaResumen | null;
  proveedor: ProveedorOpcion | null;
  motivo: string | null;
  registrado_por: PersonaResumen | null;
  registrado_en: string;
  anulado: boolean;
  anulado_por: PersonaResumen | null;
  anulado_en: string | null;
  motivo_anulacion: string | null;
}

export interface ResumenCostos {
  repuestos: number;
  mano_obra: number;
  servicio_externo: number;
  transporte: number;
  otro: number;
  ajuste: number;
  total: number;
}

/** `GET /api/intervenciones/:id/costos`. */
export interface IntervencionCostosRespuesta {
  renglones: RenglonCosto[];
  /** `null` sin `COSTOS_VER`. */
  resumen: ResumenCostos | null;
  horas_mano_obra: number;
  ve_costos: boolean;
  puede_registrar: boolean;
  puede_anular: boolean;
}

/** `GET /api/costos/personas`. */
export type PersonaCostoOpcion = Persona;

/** `GET /api/reportes/costos`. */
export interface ReporteCostosRespuesta {
  desde: string;
  hasta: string;
  total: number;
  intervenciones: number;
  por_tipo: {
    repuestos: number;
    mano_obra: number;
    servicio_externo: number;
    transporte: number;
    otro: number;
    ajuste: number;
  };
  por_maquina: Array<{
    maquina: {
      id: number;
      codigo: string | null;
      nombre: string;
    };
    sector: {
      id: number;
      nombre: string;
    };
    repuestos: number;
    mano_obra: number;
    otros: number;
    total: number;
  }>;
  horas_por_persona: Array<{
    persona: PersonaResumen | null;
    proveedor: ProveedorOpcion | null;
    horas: number;
    importe: number;
  }>;
}

/** `POST /api/intervenciones/:id/costos` (sección 4.3 de la C1). */
export type CuerpoCosto =
  | {
      tipo: 'MANO_OBRA';
      descripcion?: string;
      /** Interna: va `usuario_id`. Externa: va `proveedor_id`. Nunca los dos. */
      usuario_id?: number;
      proveedor_id?: number;
      horas: number;
      /** Con valor hora, la API calcula el importe: no va `importe`. */
      valor_hora?: number;
      importe?: number;
      /** Con la intervención finalizada. */
      motivo?: string;
    }
  | {
      tipo: 'SERVICIO_EXTERNO' | 'TRANSPORTE' | 'OTRO';
      descripcion: string;
      proveedor_id?: number;
      importe: number;
      motivo?: string;
    }
  | {
      tipo: 'AJUSTE';
      descripcion: string;
      importe: number;
      motivo: string;
    };

/** `POST /api/intervenciones/:id/costos/lote` (Etapa C1.2): de 1 a 5 renglones. */
export interface CuerpoLoteCostos {
  renglones: CuerpoCosto[];
}

/** Respuesta 201 del lote: cada renglón como el `POST` de uno, en el orden del pedido. */
export interface LoteCostosRespuesta {
  renglones: RenglonCosto[];
}

// ---------------------------------------------------------------------------
// Preventivos por calendario (Etapa PV1, D-021)
// ---------------------------------------------------------------------------

/** El tipo de una intervención, de `tipos_intervencion`. */
export type TipoIntervencion = 'CORRECTIVO' | 'PREVENTIVO';

/** El plan de una intervención preventiva, en la lista y el detalle. */
export interface PlanResumen {
  id: number;
  nombre: string;
}

export type FrecuenciaUnidad = 'DIAS' | 'SEMANAS' | 'MESES' | 'ANIOS';

/** El estado por fecha de una tarea; null si no vence por fecha (PV3). */
export type EstadoFechaTarea = 'VENCIDA' | 'PROXIMA' | 'AL_DIA';

/** `uso` de una tarea del plan y de un vencimiento: null si no vence por uso (PV3, 4.2). */
export interface UsoTareaPlan {
  medidor: { id: number; nombre: string; unidad: string; activo: boolean };
  cada: number;
  primera: number;
  anticipacion: number;
  lectura_actual: { valor: number; registrada_en: string } | null;
  /** El mayor valor registrado al hacer la tarea, o null. */
  ultimo: number | null;
  proximo: number;
  /** Negativo si está vencida; null sin lectura. */
  faltan: number | null;
  estado: 'VENCIDA' | 'PROXIMA' | 'AL_DIA' | 'SIN_LECTURA';
}

/** `uso` de una tarea en la intervención: null si la fila no tiene medidor (PV3, 4.4). */
export interface UsoTareaIntervencion {
  medidor: {
    id: number;
    nombre: string;
    unidad: string;
    activo: boolean;
    ultima_lectura: { valor: number; registrada_en: string } | null;
  };
  programado: number;
  /** El valor al hacer la tarea: null mientras no está hecha. */
  valor: number | null;
}

/** El estado de una tarea, calculado por la vista `v_plan_tareas_estado`. */
export type EstadoTareaPlan = 'INACTIVA' | 'EN_CURSO' | 'VENCIDA' | 'PROXIMA' | 'SIN_LECTURA' | 'AL_DIA';

/** Los estados que se piden en `GET /api/planes/vencimientos`. */
export type EstadoVencimiento = Exclude<EstadoTareaPlan, 'INACTIVA'>;

export interface RepuestoSugerido {
  id: number;
  codigo: string | null;
  nombre: string;
  unidad: string;
}

/** Un repuesto previsto de una tarea del plan. */
export interface RepuestoPrevistoPlan {
  repuesto: RepuestoSugerido;
  cantidad: number;
}

export type EstadoPrevisto = 'PREVISTO' | 'USADO' | 'NO_USADO';

/** Un repuesto previsto de una tarea en la intervención. */
export interface RepuestoPrevistoIntervencion {
  id: number;
  repuesto: RepuestoSugerido & {
    lleva_stock: boolean;
    /** null si el usuario no puede ver el stock. */
    cantidad_disponible: number | null;
  };
  cantidad_prevista: number;
  estado: EstadoPrevisto;
  /** El consumo que se registró al confirmar, o null. */
  consumo: { id: number; cantidad: number; anulado: boolean } | null;
}

export interface ProveedorSugerido {
  id: number;
  nombre: string;
}

export interface IntervencionEnCurso {
  id: number;
  estado: string;
}

export interface PlanMaquina {
  id: number;
  codigo: string | null;
  nombre: string;
  activo: boolean;
  sector: SectorSimple;
}

/** Una tarea del plan con su estado (sección 4.3). Las fechas, `YYYY-MM-DD`. */
export interface TareaPlan {
  id: number;
  orden: number;
  accion: string;
  detalle: string | null;
  /** Sin fecha (solo por uso), la frecuencia y las fechas van en null (PV3). */
  frecuencia_valor: number | null;
  frecuencia_unidad: FrecuenciaUnidad | null;
  primera_fecha: string | null;
  /** Los repuestos previstos, hasta 10 (D-022). */
  repuestos: RepuestoPrevistoPlan[];
  proveedor: ProveedorSugerido | null;
  activo: boolean;
  ultima_ejecucion: string | null;
  proxima_fecha: string | null;
  /** Negativo si está vencida. */
  dias: number | null;
  estado_fecha: EstadoFechaTarea | null;
  uso: UsoTareaPlan | null;
  estado: EstadoTareaPlan;
  intervencion_en_curso: IntervencionEnCurso | null;
}

/** Las últimas 20 intervenciones del plan, no eliminadas. */
export interface PlanIntervencion {
  id: number;
  estado: string;
  fecha_creacion: string;
  fecha_finalizacion: string | null;
  responsable: Persona | null;
}

/** `GET /api/planes/:id`, y la respuesta de los cambios del plan y de sus tareas. */
export interface PlanDetalle {
  id: number;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  anticipacion_dias: number;
  /** PV5: genera la intervención sola cuando una tarea vence o está por vencer. */
  generacion_automatica: boolean;
  hoy: string;
  maquina: PlanMaquina;
  responsable: Persona | null;
  creado_por: Persona;
  creado_en: string;
  actualizado_en: string;
  tareas: TareaPlan[];
  intervenciones: PlanIntervencion[];
}

/** Un elemento de `GET /api/planes`. */
export interface PlanLista {
  id: number;
  nombre: string;
  activo: boolean;
  anticipacion_dias: number;
  /** PV5: genera la intervención sola cuando una tarea vence o está por vencer. */
  generacion_automatica: boolean;
  maquina: PlanMaquina;
  responsable: Persona | null;
  tareas_activas: number;
  vencidas: number;
  proximas: number;
  en_curso: number;
  sin_lectura: number;
  /** La menor de sus tareas activas que no están en curso. */
  proxima_fecha: string | null;
}

/** Una tarea de `GET /api/planes/vencimientos`. */
export interface VencimientoTarea {
  tarea_id: number;
  accion: string;
  /** Sin fecha (solo por uso), la frecuencia y las fechas van en null (PV3). */
  frecuencia_valor: number | null;
  frecuencia_unidad: FrecuenciaUnidad | null;
  ultima_ejecucion: string | null;
  proxima_fecha: string | null;
  dias: number | null;
  estado_fecha: EstadoFechaTarea | null;
  uso: UsoTareaPlan | null;
  estado: EstadoVencimiento;
  intervencion_en_curso: IntervencionEnCurso | null;
  plan: PlanResumen;
  maquina: {
    id: number;
    codigo: string | null;
    nombre: string;
    criticidad: { nombre: string; prioridad_alta: boolean };
  };
  sector: SectorSimple;
  /** El responsable del plan. */
  responsable: Persona | null;
}

/** `GET /api/planes/vencimientos`, con `X-Total-Count`. */
export interface VencimientosRespuesta {
  hoy: string;
  /** Con los mismos filtros, salvo `estado`. */
  resumen: { vencidas: number; proximas: number; en_curso: number; sin_lectura: number; al_dia: number };
  tareas: VencimientoTarea[];
}

/** `POST /api/planes/:id/generar` (201). */
export interface GeneracionRespuesta {
  intervencion: { id: number; estado: string; responsable: Persona | null };
  /** El plan tenía un responsable que ya no está habilitado: quedó sin asignar. */
  responsable_omitido: boolean;
  tareas: Array<{
    id: number;
    plan_tarea_id: number;
    orden: number;
    accion: string;
    /** null en una tarea solo por uso. */
    fecha_programada: string | null;
  }>;
}

/**
 * `POST /api/planes/procesar-vencimientos` (PV5, 3.3). Forzada, siempre revisa; sin forzar
 * (el programado), `{ revisado: false }` si ya se revisó hoy.
 */
export type ProcesarVencimientosRespuesta =
  | { revisado: false }
  | {
      revisado: true;
      planes: number;
      generadas: Array<{ plan_id: number; intervencion_id: number }>;
      /** Las notificaciones creadas. */
      avisos: number;
      errores: Array<{ plan_id: number; codigo: string }>;
    };

/**
 * Una tarea de una intervención preventiva. El proveedor es la sugerencia de la tarea del
 * plan de hoy; los repuestos previstos se copiaron al generarla.
 */
export interface TareaIntervencion {
  id: number;
  plan_tarea_id: number;
  orden: number;
  accion: string;
  detalle: string | null;
  /** null en una tarea solo por uso. */
  fecha_programada: string | null;
  repuestos_previstos: RepuestoPrevistoIntervencion[];
  uso: UsoTareaIntervencion | null;
  proveedor: ProveedorSugerido | null;
  hecha: boolean;
  hecha_por: Persona | null;
  hecha_en: string | null;
  observacion: string | null;
}

/** `GET /api/intervenciones/:id/tareas`. Sin plan: sin tareas y `puede_marcar` en false. */
export interface IntervencionTareasRespuesta {
  tareas: TareaIntervencion[];
  resumen: { total: number; hechas: number; previstos_sin_confirmar: number };
  puede_marcar: boolean;
}

/** `PATCH /api/intervenciones/:id/tareas/:tareaId`: la tarea, con la próxima fecha de la del plan. */
export interface TareaIntervencionMarcada extends TareaIntervencion {
  /** null si la tarea del plan no vence por fecha. */
  proxima_fecha: string | null;
  /** La próxima por uso de la tarea del plan, o null. */
  proximo_uso: number | null;
}

// ---------------------------------------------------------------------------
// Medidores y lecturas (Etapa PV3, D-023)
// ---------------------------------------------------------------------------

/** La última lectura vigente de un medidor: la de mayor valor. */
export interface UltimaLecturaMedidor {
  id: number;
  valor: number;
  registrada_en: string;
  registrada_por: Persona;
}

/** Un elemento de `GET /api/medidores`. */
export interface MedidorLista {
  id: number;
  nombre: string;
  unidad: string;
  activo: boolean;
  maquina: PlanMaquina;
  ultima_lectura: UltimaLecturaMedidor | null;
  /** Las tareas activas que lo usan, de cualquier plan. */
  tareas_activas: number;
  creado_en: string;
  actualizado_en: string;
}

/** `GET /api/medidores/:id`, y la respuesta del alta, la edición, la baja y el alta de nuevo. */
export interface MedidorDetalle extends MedidorLista {
  tareas: Array<{ id: number; accion: string; plan: { id: number; nombre: string; activo: boolean } }>;
}

export type OrigenLectura = 'MANUAL' | 'TAREA';

/** Una lectura de `GET /api/medidores/:id/lecturas`, también la respuesta de cargarla y de anularla. */
export interface LecturaMedidor {
  id: number;
  valor: number;
  registrada_en: string;
  registrada_por: Persona;
  origen: OrigenLectura;
  /** La intervención de la tarea, con origen `TAREA`. */
  intervencion_id: number | null;
  observacion: string | null;
  anulada: boolean;
  anulada_en: string | null;
  anulada_por: Persona | null;
  motivo_anulacion: string | null;
}

// ---------------------------------------------------------------------------
// Cumplimiento de los preventivos en los reportes (Etapa R1, D-026)
// ---------------------------------------------------------------------------

export type AgrupacionPreventivos = 'sector' | 'maquina' | 'plan';

export interface ResumenCumplimientoPreventivos {
  hechas: number;
  a_tiempo: number;
  tarde: number;
  vencidas_sin_hacer: number;
  cumplimiento: number | null;
  atraso_promedio_dias: number | null;
}

export interface GrupoCumplimientoBase {
  hechas: number;
  a_tiempo: number;
  tarde: number;
  vencidas_sin_hacer: number;
  cumplimiento: number | null;
  atraso_promedio_dias: number | null;
}

export interface GrupoCumplimientoSector extends GrupoCumplimientoBase {
  sector: { id: number; nombre: string };
}

export interface GrupoCumplimientoMaquina extends GrupoCumplimientoBase {
  maquina: { id: number; codigo: string | null; nombre: string };
}

export interface GrupoCumplimientoPlan extends GrupoCumplimientoBase {
  plan: { id: number; nombre: string };
  maquina: { id: number; codigo: string | null; nombre: string };
}

export type GrupoCumplimientoPreventivos =
  | GrupoCumplimientoSector
  | GrupoCumplimientoMaquina
  | GrupoCumplimientoPlan;

/** `GET /api/reportes/preventivos`. */
export interface ReportePreventivosRespuesta<G = GrupoCumplimientoPreventivos> {
  resumen: ResumenCumplimientoPreventivos;
  grupos: G[];
}
