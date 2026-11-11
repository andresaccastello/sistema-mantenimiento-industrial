# Alcance del sistema

## Propósito

El Sistema de Mantenimiento Industrial está orientado a centralizar la información relacionada con máquinas, fallas, intervenciones, mantenimientos preventivos, repuestos, costos y reportes.

## Usuarios previstos

- Administrador.
- Responsable de mantenimiento.
- Operario.
- Usuarios de consulta para Dirección / I+D.

El sistema es de escritorio (D-027). En el celular solo se usa para:
- el operario: reportar una falla, ver sus reportes y sus notificaciones;
- quien gestiona o consulta: ver el tablero y los reportes, sin cargar nada.

## Funcionalidades principales y estado

| # | Funcionalidad | Estado |
| :-: | :--- | :--- |
| 1 | Gestión de usuarios, perfiles y permisos | Hecho |
| 2 | Gestión de máquinas, plantas, sectores y catálogos | Hecho |
| 3 | Registro de fallas y necesidades de mantenimiento | Hecho |
| 4 | Registro y seguimiento de intervenciones | Hecho |
| 5 | Mantenimiento correctivo | Hecho |
| 6 | Mantenimiento preventivo (planes, tareas, generación manual y automática) | Hecho |
| 7 | Criterios configurables de mantenimiento (calendario, uso por medidores o ambos) | Hecho |
| 8 | Gestión de repuestos, stock, movimientos y pedidos | Hecho |
| 9 | Registro de costos (mano de obra, servicio externo, transporte, otros y ajustes) | Hecho |
| 10 | Registro de tiempos de intervención e inactividad | Hecho |
| 11 | Documentación respaldatoria (manuales, facturas, remitos) | Descartado (D-027) |
| 12 | Historial por máquina | Hecho |
| 13 | Búsqueda y filtrado | Hecho |
| 14 | Reportes e indicadores (disponibilidad, MTBF, MTTR, inactividad, tiempos, repuestos, preventivos y costos) | Hecho |
| 15 | Notificaciones (campana del sistema y avisos por email) | Hecho |
| 16 | Avisos por WhatsApp | Descartado (D-027) |
| 17 | Revisiones de rutina del operario | Descartado (D-024) |
| 18 | Calendario de preventivos | Pendiente |
| 19 | Archivo para SAE | Pendiente, a la espera del formato |

## Límites

Quedan fuera del alcance:

- Documentación adjunta y canal WhatsApp en la interfaz (D-027; quedan como mejora futura).
- Revisiones de rutina diarias, semanales o mensuales del operario (D-024).
- Contabilidad integral.
- Facturación, pagos e impuestos.
- Gestión completa de producción, ventas y clientes.
- Control automático de máquinas.
- Integración directa con sensores.
- IoT.
- Automatización física de equipos.

## Relación con SAE

El sistema SAE continúa cumpliendo su función contable y administrativa (donde ya están los comprobantes, facturas y remitos, D-027). Queda pendiente la exportación de un archivo para SAE, a la espera del formato.
