# Modelo de datos inicial

Este modelo traduce los requerimientos de la tesis a una primera estructura relacional para PostgreSQL.

## Criterios

- Se mantiene una separación entre usuarios, perfiles y permisos.
- El legajo identifica al usuario que opera el sistema.
- Una máquina pertenece a un sector, y cada sector puede pertenecer a una planta.
- Cada máquina tiene criticidad y tipo de equipo provenientes de catálogos configurables con valor por omisión, además de marca y modelo (`modelo`).
- Toda intervención queda asociada a una máquina, a un plan preventivo (si corresponde), a un tipo y al usuario que la registró.
- Los estados de una intervención se conservan también en un historial para trazabilidad.
- Los repuestos utilizados quedan vinculados a la intervención con cantidad y costo aplicado.
- Se registran movimientos de stock para poder reconstruir ingresos, egresos y ajustes.
- Los planes preventivos admiten criterios por tiempo, horas de uso, kilómetros u otro criterio.
- Los documentos almacenan metadatos y una clave de almacenamiento; la estrategia física de archivos se definirá por separado.
- Los reportes no requieren tablas propias en esta etapa: se obtendrán mediante consultas sobre el modelo operacional.

## Entidades principales

### perfiles
Define los perfiles funcionales del sistema.

Valores iniciales:
- ADMINISTRADOR
- RESPONSABLE_MANTENIMIENTO
- OPERARIO
- CONSULTA

### permisos
Catálogo de acciones autorizables. Incluye `usa_alcance` (`BOOLEAN NOT NULL DEFAULT FALSE`), que indica si el permiso admite alcance sectorial (`PROPIAS`, `SECTORES`, `TODAS`).

### perfil_permiso
Relación muchos-a-muchos entre perfiles y permisos.

### usuario_permiso
Excepciones individuales de permisos por usuario (`CONCEDER` o `DENEGAR`, `alcance`, `motivo`, `otorgado_por_usuario_id`). Prevalece sobre el perfil; `DENEGAR` tiene estricta prevalencia.

### auditoria_permisos
Registro inmutable de cambios sobre perfiles, roles y permisos de usuarios. Acciones admitidas: `USUARIO_CREADO`, `USUARIO_MODIFICADO`, `USUARIO_DESACTIVADO`, `USUARIO_REACTIVADO`, `PASSWORD_RESTABLECIDA`, `PASSWORD_CAMBIADA`, `PERFIL_CAMBIADO`, `SECTORES_CAMBIADOS`, `EXCEPCION_CREADA`, `EXCEPCION_MODIFICADA` y `EXCEPCION_ELIMINADA`.

### usuarios
Usuarios del sistema. El `legajo` es único. Incluye datos opcionales de contacto: `email` (validado por formato) y `telefono_whatsapp` (formato internacional E.164).

### notificacion_canales
Canales de salida configurables (`EMAIL`, `WHATSAPP`, `PUSH`). Registra si está activo y quién lo actualizó (`actualizado_por_usuario_id`).

### notificacion_envios
Bandeja de salida de avisos. Registra el canal, estado (`PENDIENTE`, `ENVIADO`, `DESCARTADO`, `ERROR`), `destino`, intentos, error, `proximo_intento_en` e índices parciales para procesamiento por lotes.

### notificacion_reglas
Matriz de reglas de aviso por canal y tipo de evento (`FALLA_REGISTRADA`, `INTERVENCION_ASIGNADA`, etc.). Define el modo de envío: `NUNCA`, `SOLO_ALTA` o `SIEMPRE`, junto con quién lo actualizó.

### plantas
Plantas o naves físicas de la empresa. Sin datos iniciales por omisión (una instalación con una sola planta no necesita cargar ninguna).

### sectores
Sectores físicos o funcionales donde se ubican las máquinas. Pueden asociarse opcionalmente a una planta (`planta_id`).

### criticidades
Catálogo configurable de niveles de criticidad de las máquinas (`codigo`, `nombre`, `orden`, `prioridad_alta`, `por_omision`, `activo`), con a lo sumo un nivel activo por omisión. Valores iniciales: `ALTA` (prioridad alta), `MEDIA` (por omisión) y `BAJA`. Siempre hay un valor por omisión activo; se cambia marcando otro (D-015).

### tipos_equipo
Catálogo configurable de tipos de equipo (`codigo`, `nombre`, `orden`, `por_omision`, `activo`), con a lo sumo un tipo activo por omisión. Valores iniciales: `MAQUINA` (por omisión), `VEHICULO`, `INSTALACION` y `HERRAMIENTA`. Siempre hay un valor por omisión activo; se cambia marcando otro (D-015).

### maquinas
Equipos industriales administrados por el sistema. Incluye sector (`sector_id`), criticidad (`criticidad_id`), tipo de equipo (`tipo_equipo_id`), código único opcional (`codigo`) y marca/modelo en texto libre (`modelo`).

### tipos_intervencion
Clasificación configurable de las intervenciones. Se cargan inicialmente CORRECTIVO y PREVENTIVO.

### intervenciones
Núcleo del sistema. Registra falla/necesidad, máquina, sector, responsable, estado, fechas, tiempos, costos y observaciones.

### historial_estados_intervencion
Registra los cambios de estado de una intervención.

### proveedores
Catálogo unificado de proveedores para compra de repuestos y servicios externos.

### repuestos
Catálogo y disponibilidad de repuestos, con control de stock opcional y proveedor habitual.

### repuesto_costos
Historial de costos unitarios de cada repuesto según alta, edición, ingreso o consumo.

### intervencion_repuestos
Detalle de repuestos consumidos en una intervención, con soporte para anulación y devolución.

### intervencion_costos
Renglones de costo de una intervención que no son repuestos: mano de obra, servicio externo, transporte, otro y ajuste (D-019). No se editan: se anulan con motivo.

- `usuario_id`: la persona interna de un renglón `MANO_OBRA` (FK a `usuarios`, nulo).
- `proveedor_id`: el externo (FK a `proveedores`, nulo).
- `horas` (`numeric(8,2)`, nulo): solo en `MANO_OBRA`, mayores que 0.
- `valor_hora` (`numeric(14,2)`, nulo): solo con horas, desde 0; entonces `importe = round(horas * valor_hora, 2)`.

Un `MANO_OBRA` tiene horas y exactamente uno de `usuario_id` o `proveedor_id`. Un `AJUSTE` tiene importe distinto de 0 y motivo.

### pedidos_repuesto
Seguimiento de pedidos de repuestos asociados a una intervención, con estados de compra y recepción.

### movimientos_stock
Trazabilidad de ingresos, egresos, ajustes y devoluciones de stock, historizando el delta y el stock resultante.

### planes_mantenimiento
Planificación preventiva configurable por tiempo, horas de uso, kilómetros u otros criterios.

### documentos
Metadatos de documentación asociada a máquinas o intervenciones.

## Relaciones principales

```text
PERFILES ──< USUARIOS
   │
   └──< PERFIL_PERMISO >── PERMISOS

PROVEEDORES ──< REPUESTOS ──< REPUESTO_COSTOS
     │              │
     │              ├──< MOVIMIENTOS_STOCK
     │              └──< INTERVENCION_REPUESTOS >── INTERVENCIONES
     │                                                    │
     └──< PEDIDOS_REPUESTO >──────────────────────────────┘

PLANTAS ──< SECTORES ──< MAQUINAS >── CRITICIDADES
                            │     └── TIPOS_EQUIPO
                            └──< INTERVENCIONES >── USUARIOS
                                        │
                                        ├──< HISTORIAL_ESTADOS_INTERVENCION
                                        ├──< INTERVENCION_REPUESTOS
                                        ├──< INTERVENCION_COSTOS
                                        ├──< PEDIDOS_REPUESTO
                                        └──< DOCUMENTOS

MAQUINAS ──< PLANES_MANTENIMIENTO ──< INTERVENCIONES
MAQUINAS ──< DOCUMENTOS
```

## Decisiones que quedan abiertas

- Estrategia definitiva de autenticación.
- Almacenamiento físico de archivos.
