# Orden de trabajo — tesis de mantenimiento industrial

La meta inicial es un MVP que demuestre de extremo a extremo el flujo de mantenimiento y pueda probarse con GI-RE S.A. El frontend definitivo se ajustará cuando esté disponible el handoff visual del sistema principal.

## Etapa 0 — Base técnica (en curso)

- [x] Repositorio privado y documentación inicial.
- [x] Stack React + TypeScript / Node.js + Hono / PostgreSQL en Neon.
- [x] Archivos iniciales de frontend y Neon Functions en rama de trabajo.
- [x] Migración SQL inicial versionada y probada en una rama temporal.
- [ ] Ejecutar `npm install`, TypeScript y build.
- [ ] Desplegar API de prueba en entorno no productivo.
- [ ] Revisar y aprobar migración inicial antes de aplicarla a producción.

## Etapa 1 — Identidad y datos básicos

- [ ] Autenticación con legajo como identificador y contraseña segura.
- [ ] Perfiles y permisos.
- [ ] CRUD de sectores.
- [ ] CRUD de máquinas.

## Etapa 2 — Flujo central

- [ ] Operario registra falla.
- [ ] Responsable asigna y gestiona intervención.
- [ ] Cambios de estado y trazabilidad.
- [ ] Finalización con fechas, tiempo y costos.
- [ ] Historial por máquina.

## Etapa 3 — Módulos complementarios

- [ ] Mantenimiento preventivo configurable.
- [ ] Repuestos y movimientos de stock.
- [ ] Documentos adjuntos.
- [ ] Reportes e indicadores.

## Etapa 4 — Calidad y entrega

- [ ] Pruebas funcionales y de permisos.
- [ ] Pruebas con celular.
- [ ] Prueba con usuarios de GI-RE.
- [ ] Ajustes y documentación para defensa.

## Diseño en paralelo

- [ ] Obtener informe de Antigravity sobre frontend existente.
- [ ] Probar Stitch con un boceto descartable o revisable.
- [ ] Convertir el informe visual en tokens y componentes reutilizables.
- [ ] Implementar diseño definitivo sin acoplarlo al backend.
