# Sistema de Mantenimiento Industrial

Proyecto de tesis orientado al desarrollo de un sistema web para **GI-RE S.A.**, destinado a centralizar y gestionar la información relacionada con el mantenimiento de máquinas y equipos industriales.

## Objetivo

Mejorar la trazabilidad del mantenimiento, reducir la pérdida de información y disponer de datos confiables sobre fallas, intervenciones, repuestos, costos, tiempos de inactividad e historial por máquina.

## Stack tecnológico

- **Frontend:** React + Vite + TypeScript
- **Backend:** Node.js + Hono
- **Backend cloud:** Neon Functions
- **Base de datos:** PostgreSQL en Neon
- **API:** REST
- **Acceso inicial a datos:** `pg`

## Arquitectura

```text
React
  ↓
API REST
  ↓
Node.js + Hono
Neon Functions
  ↓
PostgreSQL
Neon
```

El frontend se desplegará por separado. Neon concentrará la base PostgreSQL y la ejecución del backend.

## Alcance inicial

El sistema contempla:

- Gestión de usuarios, perfiles y permisos.
- Gestión de máquinas y sectores.
- Registro de fallas y necesidades de mantenimiento.
- Seguimiento de intervenciones.
- Mantenimientos correctivos y preventivos.
- Criterios de mantenimiento configurables según tiempo, utilización, kilometraje u otros criterios.
- Gestión básica de repuestos y stock.
- Registro de costos.
- Documentación respaldatoria.
- Historial por máquina.
- Consultas y reportes para seguimiento y toma de decisiones.

Los operarios podrán registrar fallas o necesidades de mantenimiento desde un celular o una terminal disponible en planta, con una identificación asociada a su número de legajo.

## Fuera de alcance inicial

- Gestión contable integral.
- Facturación, pagos e impuestos.
- Gestión completa de producción, ventas y clientes.
- Control automático de máquinas.
- Integración directa con sensores o IoT.
- Automatización física de equipos.

## Estructura del repositorio

```text
sistema-mantenimiento-industrial/
├── frontend/
├── backend/
├── database/
├── docs/
├── neon.ts
├── .env.example
├── .gitignore
└── README.md
```

## Estrategia de ramas

- `main`: versión estable.
- `feat/*`: nuevas funcionalidades.
- `fix/*`: correcciones.
- `docs/*`: documentación.

## Estado del proyecto

**Etapa actual:** inicialización técnica.

El relevamiento, requerimientos, alcance y modelo ambiental ya fueron desarrollados. El stack y la infraestructura principal quedaron definidos y el siguiente paso es inicializar el proyecto y diseñar el modelo de datos.
