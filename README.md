# Sistema de Mantenimiento Industrial

Proyecto de tesis orientado al desarrollo de un sistema web interno para **GI-RE S.A.**, destinado a centralizar y gestionar la información relacionada con el mantenimiento de máquinas y equipos industriales.

## Objetivo

Mejorar la trazabilidad del mantenimiento, reducir la pérdida de información y disponer de datos confiables sobre fallas, intervenciones, repuestos, costos, tiempos de inactividad e historial por máquina.

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

El proyecto no busca reemplazar los sistemas administrativos o productivos existentes. Quedan fuera del alcance inicial:

- Gestión contable integral.
- Facturación, pagos e impuestos.
- Gestión completa de producción, ventas y clientes.
- Control automático de máquinas.
- Integración directa con sensores o IoT.
- Automatización física de equipos.

## Arquitectura general prevista

La solución se plantea como una aplicación web de uso interno, con:

- Frontend web.
- Backend / API.
- Base de datos centralizada.
- Almacenamiento de documentación respaldatoria.
- Acceso desde equipos conectados a la red interna de la empresa.
- Sistema SAE como referencia documental externa, sin reemplazarlo.

La tecnología concreta de frontend, backend y base de datos se definirá antes de comenzar la implementación.

## Estructura prevista del repositorio

```text
sistema-mantenimiento-industrial/
├── frontend/
├── backend/
├── database/
├── docs/
│   ├── alcance.md
│   ├── arquitectura.md
│   └── decisiones.md
├── .gitignore
└── README.md
```

Las carpetas de código se crearán cuando se defina el stack tecnológico, para evitar generar estructura innecesaria.

## Estrategia de ramas

- `main`: versión estable del proyecto.
- `feat/*`: nuevas funcionalidades.
- `fix/*`: correcciones.
- `docs/*`: cambios de documentación.

Ejemplos:

```text
feat/autenticacion
feat/maquinas
feat/mantenimiento
feat/repuestos
feat/reportes
```

## Estado del proyecto

**Etapa actual:** inicio de implementación.

El relevamiento, requerimientos, alcance y modelo ambiental ya fueron desarrollados en la documentación de tesis. El siguiente paso es definir el stack tecnológico y diseñar la base técnica del sistema.
