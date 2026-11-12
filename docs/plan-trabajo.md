# Orden de trabajo — tesis de mantenimiento industrial

El sistema cuenta con las etapas funcionales implementadas y probadas contra la rama aislada de Neon. A continuación se detalla lo hecho (con la etapa en que se implementó) y el plan de cierre de la tesis.

## Etapa 0 — Base técnica (hecha)

- [x] Repositorio privado y documentación inicial.
- [x] Stack React 19 + TypeScript / Node.js 22 + Hono / PostgreSQL en Neon.
- [x] Base de frontend y diseño del sistema (Etapa F0 / F0.1).
- [x] Migraciones SQL versionadas (001 a 019) y probadas en rama aislada de Neon.
- [x] Ejecución de `npm install`, TypeScript (`npm run typecheck`) y build (`npm run build:frontend`).
- [x] Tolerancia a cortes de conexión y detalles de pulido (Etapas P, C2 y C3).

## Etapa 1 — Identidad, administración y máquinas (hecha)

- [x] Autenticación con legajo como identificador, contraseña segura y versión de sesión (Etapas U, API-Front y F0).
- [x] Perfiles, permisos granulares con alcance y excepciones por usuario (Etapas API-05, F4a y F4b / F4b.1).
- [x] Administración de usuarios y auditoría de usuarios (Etapas F4a y F4b / F4b.1).
- [x] CRUD de plantas, sectores y catálogos de criticidad y tipos de equipo (Etapas F3a / F3a.1, F4a y F4b).
- [x] CRUD de máquinas, estado operativo y detalle de máquina (Etapas F3a / F3a.1 y F3b / F3b.1).

## Etapa 2 — Flujo central de intervenciones (hecha)

- [x] Operario registra falla, consulta sus reportes y recibe notificaciones (Etapas F1 / F1.1 y 7).
- [x] Motor de estados, asignaciones, cierres, reapertura y baja lógica con auditoría (Etapas 4a, 4b y 6).
- [x] Lista y detalle completo de intervenciones para responsables (Etapas F2 / F2.1 / F2.2).
- [x] Registro de tiempos de intervención y períodos de detención / inactividad (Etapas 8 / 8.1 / 8.2).
- [x] Tablero operativo por planta y sector (Etapa F3b / F3b.1).
- [x] Historial de intervenciones y detenciones por máquina (Etapa F3b / F3b.1).
- [x] Campana de notificaciones y avisos por email configurables (Etapas 7, N1a, N1b y N1.1; WhatsApp fuera de la interfaz por D-027).

## Etapa 3 — Módulos complementarios (hecha)

- [x] Repuestos, proveedores, movimientos de stock y seguimiento de pedidos en espera (Etapas R1 — Repuestos y stock, R1.1, R1.2 y C1.2.2).
- [x] Registro y corrección de costos de intervención y reporte de costos por máquina (Etapas C1, C1.1, C1.2 y C1.2.1).
- [x] Mantenimiento preventivo por calendario, por uso (medidores y lecturas) o por ambos, con repuestos previstos, generación automática y avisos de vencimiento (Etapas PV1, PV2 / PV2.1 / PV2.2, PV3 / PV3.1, PV4 / PV4.1 y PV5; revisiones de rutina descartadas por D-024).
- [x] Reportes e indicadores: disponibilidad, MTBF, MTTR, inactividad, tiempos, repuestos, cumplimiento de preventivos y costos, con exportación CSV (Etapas F5 / F5.1, R1 — Repuestos, C1 y R1 — Cumplimiento de preventivos).
- [x] Documentos adjuntos: descartados para esta versión (D-027).
- [x] Cierre de alcance y uso acotado en el celular (Etapa A1, D-027).

## Diseño en paralelo (cerrado)

- [x] Cerrado: el estilo actual queda como definitivo.

## Plan de cierre (lo que falta)

1. [ ] Recorrido de punta a punta.
2. [ ] Limpieza técnica.
3. [ ] Experiencia de uso.
4. [x] Calendario (calendario de preventivos, Etapa CAL1).
5. [ ] SAE (archivo para SAE, a la espera del formato).
6. [ ] Datos de demostración.
7. [ ] Publicación.
8. [ ] Prueba con la empresa.
9. [ ] Tesis.
