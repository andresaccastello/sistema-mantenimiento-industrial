# Arquitectura inicial

## Enfoque

La solución se plantea como una aplicación web para GI-RE S.A., con frontend desacoplado, API y base de datos centralizada.

## Componentes

### Frontend

Aplicación desarrollada con React, Vite y TypeScript.

Será utilizada por:

- operarios;
- responsables de mantenimiento;
- administradores;
- usuarios de consulta de Dirección / I+D.

El frontend consumirá la API mediante HTTP.

### Backend / API

El backend se desarrollará en Node.js y se ejecutará mediante Neon Functions.

Se utilizará Hono como framework HTTP para exponer una API REST.

Responsabilidades principales:

- autenticación y autorización;
- validaciones;
- lógica de negocio;
- gestión de máquinas;
- intervenciones;
- mantenimiento preventivo y correctivo;
- repuestos;
- costos;
- documentación;
- consultas y reportes.

### Base de datos

Se utilizará PostgreSQL alojado en Neon.

El backend accederá inicialmente mediante `pg` y un pool de conexiones. La cadena de conexión se obtendrá desde `DATABASE_URL`.

La base almacenará, entre otros:

- usuarios;
- perfiles y permisos;
- máquinas;
- sectores;
- intervenciones;
- tipos de mantenimiento;
- planes preventivos;
- repuestos;
- movimientos de stock;
- costos;
- tiempos;
- referencias de documentación;
- historial y estados.

### Almacenamiento documental

La estrategia definitiva para facturas, remitos, fotografías, manuales y demás archivos adjuntos se definirá en una etapa posterior.

### SAE

SAE se considera un sistema externo utilizado como referencia documental. No forma parte del núcleo funcional del nuevo sistema y no será reemplazado.

## Flujo general

```text
Usuario
   ↓
React
   ↓ HTTP / REST
Neon Function - Node.js + Hono
   ↓
PostgreSQL en Neon
```

## Variables de entorno

Nunca deberán subirse secretos al repositorio.

Variables previstas:

```text
DATABASE_URL=
VITE_API_URL=
```

En Neon Functions, `DATABASE_URL` será inyectada por la plataforma durante el despliegue.

## Decisiones pendientes

- autenticación y autorización definitiva;
- almacenamiento de archivos adjuntos;
- hosting del frontend;
- modelo de datos definitivo;
- estrategia de backups y recuperación.
