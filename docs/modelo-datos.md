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
- Los planes preventivos se arman con tareas que vencen por calendario: cada N días, semanas, meses o años (D-021). Los disparadores por uso (horas, kilómetros, ciclos) quedan para la PV3.
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
Planes preventivos de una máquina, armados con tareas (D-021). Una máquina puede tener varios.

- `maquina_id`: no cambia una vez creado el plan; la FK compuesta de las intervenciones (`fk_intervenciones_plan_maquina`) obliga a que el plan sea de la misma máquina.
- `responsable_usuario_id` (nulo): quien queda asignado a las intervenciones que se generan desde el plan.
- `nombre`, único en la máquina sin importar mayúsculas; `descripcion`, `activo`.
- `anticipacion_dias` (`integer`, de 0 a 90, por omisión 7): cuántos días antes una tarea pasa a "próxima".
- `creado_por_usuario_id`, `creado_en` y `actualizado_en`.

### plan_tareas
Las tareas de un plan, en su `orden` (único en el plan). Cada una tiene su `accion` y su `detalle`, un proveedor sugerido (`proveedor_id`, nulo) y al menos un criterio de vencimiento (D-023). No se borran: se desactivan.

- **Por fecha:** `frecuencia_valor` y `frecuencia_unidad` (`DIAS`, `SEMANAS`, `MESES` o `ANIOS`), hasta 10 años, y `primera_fecha`, cuándo vence por primera vez. Van los tres o ninguno.
- **Por uso:** `medidor_id`, un medidor de la misma máquina; `uso_cada` (mayor que 0), cada cuántas unidades; `uso_primera` (mayor o igual que 0), en qué valor vence la primera vez; y `uso_anticipacion` (de 0 a `uso_cada`), cuántas unidades antes pasa a "próxima". Van los cuatro o ninguno. `anticipacion_dias`, del plan, es solo para la fecha.

El estado de cada tarea no se guarda: lo calcula la vista `v_plan_tareas_estado`, con el "hoy" de la zona horaria de la instalación (`configuracion_sistema.zona_horaria`). Por fecha: última ejecución, próxima fecha, días que faltan y `estado_fecha`. Por uso: `lectura_actual` y `lectura_actual_en`, `ultimo_uso`, `proximo_uso`, `faltan_uso` y `estado_uso`, que también puede ser `SIN_LECTURA`. El `estado` es el más urgente de los dos: `INACTIVA`, `EN_CURSO`, `VENCIDA`, `PROXIMA`, `SIN_LECTURA` o `AL_DIA`, en ese orden.

### plan_tarea_repuestos
Los repuestos previstos de una tarea del plan, hasta 10 (D-022): `plan_tarea_id`, `repuesto_id` (único en la tarea), `cantidad` (`numeric(14,3)`, mayor que 0) y `orden`. No mueven stock.

### intervencion_tareas
Las tareas de una intervención preventiva, copiadas del plan al generarla (`orden`, `accion`, `detalle`, `fecha_programada`, `medidor_id` y `uso_programado`, la próxima fecha y la próxima por uso en ese momento), para que cambiar el plan después no cambie lo que se hizo. Tiene `fecha_programada`, `medidor_id` o los dos, y `uso_programado` va si y solo si va `medidor_id`. Una tarea del plan va una sola vez por intervención. `hecha` lleva quién (`hecha_por_usuario_id`) y cuándo (`hecha_en`); sin `hecha`, ninguno de los dos. `valor_medidor` es el valor del medidor al hacer la tarea: va si y solo si la tarea está hecha y tiene medidor. `observacion`, hasta 500 caracteres.

### intervencion_tarea_repuestos
Los repuestos previstos de una tarea en la intervención, copiados del plan al generarla (D-022): `intervencion_tarea_id`, `repuesto_id` (único en la tarea), `cantidad_prevista` (mayor que 0), `orden` y `consumo_id` (nulo, único), el consumo que se registró al confirmar.

### medidores
Los medidores de una máquina (D-023): `maquina_id`, `nombre` (hasta 60, único en la máquina sin importar mayúsculas), `unidad` (hasta 20, se escribe libre), `activo`, `creado_por_usuario_id`, `creado_en` y `actualizado_en`. No se borran: se desactivan.

### lecturas_medidor
Las lecturas acumuladas de un medidor: `medidor_id`, `valor` (`numeric(14,2)`, mayor o igual que 0), `registrada_en`, `registrada_por_usuario_id`, `origen` (`MANUAL` o `TAREA`), `intervencion_tarea_id` (va si y solo si el origen es `TAREA`) y `observacion` (hasta 200). Una lectura mal cargada se anula: `anulada_en`, `anulada_por_usuario_id` y `motivo_anulacion` van los tres o ninguno. La última vigente es la de mayor valor; a igual valor, la de mayor id.

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
                                        ├──< INTERVENCION_TAREAS
                                        └──< DOCUMENTOS

MAQUINAS ──< PLANES_MANTENIMIENTO ──< INTERVENCIONES
                    │
                    └──< PLAN_TAREAS ──< INTERVENCION_TAREAS
                              │                  │
                              │                  └──< INTERVENCION_TAREA_REPUESTOS >── REPUESTOS
                              └──< PLAN_TAREA_REPUESTOS >── REPUESTOS
MAQUINAS ──< MEDIDORES ──< LECTURAS_MEDIDOR
                 ├──< PLAN_TAREAS
                 └──< INTERVENCION_TAREAS
MAQUINAS ──< DOCUMENTOS
```

## Decisiones que quedan abiertas

- Estrategia definitiva de autenticación.
- Almacenamiento físico de archivos.
