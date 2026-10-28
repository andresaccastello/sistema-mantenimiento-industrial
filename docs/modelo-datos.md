# Modelo de datos inicial

Este modelo traduce los requerimientos de la tesis a una primera estructura relacional para PostgreSQL.

## Criterios

- Se mantiene una separación entre usuarios, perfiles y permisos.
- El legajo identifica al usuario que opera el sistema.
- Una máquina pertenece a un sector.
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
Catálogo de acciones autorizables.

### perfil_permiso
Relación muchos-a-muchos entre perfiles y permisos.

### usuarios
Usuarios del sistema. El `legajo` es único.

### sectores
Sectores físicos o funcionales donde se ubican las máquinas.

### maquinas
Equipos industriales administrados por el sistema.

### tipos_intervencion
Clasificación configurable de las intervenciones. Se cargan inicialmente CORRECTIVO y PREVENTIVO.

### intervenciones
Núcleo del sistema. Registra falla/necesidad, máquina, sector, responsable, estado, fechas, tiempos, costos y observaciones.

### historial_estados_intervencion
Registra los cambios de estado de una intervención.

### repuestos
Catálogo y disponibilidad básica de repuestos.

### intervencion_repuestos
Detalle de repuestos utilizados en una intervención.

### movimientos_stock
Trazabilidad de ingresos, egresos y ajustes del stock, historizando el costo unitario.

### planes_mantenimiento
Planificación preventiva configurable por tiempo, horas de uso, kilómetros u otros criterios.

### documentos
Metadatos de documentación asociada a máquinas o intervenciones.

## Relaciones principales

```text
PERFILES ──< USUARIOS
   │
   └──< PERFIL_PERMISO >── PERMISOS

SECTORES ──< MAQUINAS
                │
                └──< INTERVENCIONES >── USUARIOS
                            │
                            ├──< HISTORIAL_ESTADOS_INTERVENCION
                            ├──< INTERVENCION_REPUESTOS >── REPUESTOS
                            └──< DOCUMENTOS

MAQUINAS ──< PLANES_MANTENIMIENTO ──< INTERVENCIONES
REPUESTOS ──< MOVIMIENTOS_STOCK
MAQUINAS ──< DOCUMENTOS
```

## Decisiones que quedan abiertas

- Estrategia definitiva de autenticación.
- Si los proveedores requieren una entidad propia.
- Almacenamiento físico de archivos.
- Automatización del descuento de stock mediante servicio de aplicación o transacción SQL.
- Indicadores específicos que terminarán formando el tablero de reportes.
