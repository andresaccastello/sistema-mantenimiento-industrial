# Backend

API del Sistema de Mantenimiento Industrial.

## Tecnología

- Node.js
- Hono
- Neon Functions
- PostgreSQL
- `pg` con `Pool`

## Endpoints iniciales

- `GET /health`: confirma que la API responde.
- `GET /health/db`: confirma la conexión con PostgreSQL.

## Variables

En Neon Functions, `DATABASE_URL` es inyectada por Neon. Para desarrollo local puede definirse en un archivo `.env` que nunca debe subirse al repositorio.
