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

- **Frontend:** React.
- **Backend:** Node.js.
- **Base de datos:** PostgreSQL.

**Motivo:** el stack permite desarrollar una aplicación web desacoplada, con una API para centralizar la lógica de negocio y una base de datos relacional adecuada para usuarios, máquinas, intervenciones, repuestos, costos e historial.

---

## D-005 — Despliegue de infraestructura

**Estado:** Pendiente de cerrar la arquitectura exacta

La intención inicial es utilizar servicios cloud para la base de datos y el backend. Antes de fijar la infraestructura definitiva se documentará qué servicio alojará PostgreSQL y qué servicio ejecutará el backend Node.js, junto con las variables de entorno y la estrategia de conexión segura.
