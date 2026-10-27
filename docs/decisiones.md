# Registro de decisiones técnicas

Este archivo documenta las decisiones relevantes del proyecto para evitar cambios sin justificación y mantener trazabilidad durante la tesis.

## D-001 — Aplicación web

**Estado:** Aceptada

Se desarrollará una aplicación web de uso interno, accesible desde navegador.

**Motivo:** permite utilizar los equipos existentes y facilita el acceso desde distintos sectores sin instalar una aplicación de escritorio en cada dispositivo.

---

## D-002 — Base de datos centralizada

**Estado:** Aceptada

La información del sistema se almacenará en una base de datos centralizada.

**Motivo:** se requiere consultar desde distintos equipos la misma información de máquinas, intervenciones, repuestos, costos e historial.

---

## D-003 — SAE fuera del núcleo del sistema

**Estado:** Aceptada

SAE continuará siendo un sistema externo. En la primera versión no habrá integración contable directa.

**Motivo:** la tesis está enfocada en mantenimiento industrial, no en reemplazar la gestión administrativa o contable.

---

## D-004 — Stack tecnológico

**Estado:** Aceptada

Se utilizará:

- **Frontend:** React + Vite + TypeScript.
- **Backend:** Node.js ejecutado mediante Neon Functions.
- **Framework HTTP:** Hono.
- **Base de datos:** PostgreSQL alojado en Neon.
- **Acceso a datos inicial:** `pg` con pool de conexiones.
- **API:** REST.

**Motivo:** el stack permite desarrollar una aplicación web desacoplada y mantener el backend próximo a la base de datos. Para la primera versión se prioriza una solución simple, con pocas capas y fácil de explicar y mantener durante la tesis.

---

## D-005 — Infraestructura Neon

**Estado:** Aceptada

Neon alojará:

- PostgreSQL.
- Backend Node.js mediante Neon Functions.

La configuración se mantendrá como código mediante `neon.ts`. En producción, Neon inyectará la variable `DATABASE_URL` al backend.

El frontend React se desplegará por separado, ya que Neon Functions se utilizará para la API y no como hosting del cliente web.

---

## D-006 — ORM

**Estado:** Pendiente

No se incorporará un ORM al inicio. Primero se diseñará el modelo relacional y se crearán las migraciones SQL. Si más adelante aporta valor real, se evaluará incorporar una herramienta de acceso a datos.

**Motivo:** evitar complejidad innecesaria durante la primera etapa y mantener visible el diseño de PostgreSQL para la tesis.

---

## D-007 — Sistema independiente de SolGest

**Estado:** Aceptada

El sistema es una aplicación aislada, con autenticación y permisos propios. `docs/InfromeSobreFront/FRONTEND_HANDOFF.md` se usa solo como referencia visual para el frontend definitivo. La integración con SolGest queda como posible evolución futura, fuera del alcance de la tesis.

---

## D-008 — Orden de etapas hasta la entrega

**Estado:** Aceptada

El plan original (sección 12 del análisis de intervenciones) cubría solo ese módulo. Para llegar a un sistema usable se reordena lo que falta: 7 Notificaciones → U Usuarios y perfiles → 8 Tiempos e inactividad → Repuestos y stock (incluye la ex Etapa 12) → 9 Costos → Preventivos básicos → Reportes de la tesis. El frontend definitivo avanza en paralelo desde la Etapa 8. Se postergan: Etapa 10 (correcciones de finalizadas), administración completa de permisos (resto de la Etapa 11) y documentos adjuntos.

**Motivo:** priorizar lo que el sistema necesita para funcionar de punta a punta y para la defensa.

