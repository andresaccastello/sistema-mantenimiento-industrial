# Desarrollo local — base técnica

Este documento explica cómo ejecutar y verificar el frontend y la base de la API del sistema de mantenimiento industrial.

## Requisitos

- Node.js 24 recomendado (mínimo 20.19).
- npm.
- Acceso al repositorio.
- Acceso autorizado al proyecto Neon cuando llegue el momento de desplegar o probar la base de datos.

## Instalar dependencias

Desde la raíz del repositorio:

```bash
npm install
```

## Iniciar React

```bash
npm run dev:frontend
```

Vite mostrará en la terminal la URL de desarrollo local.

## Vincular el frontend con una API desplegada

Crear `frontend/.env.local` con:

```dotenv
VITE_API_URL=https://URL_BASE_DE_TU_API
```

La URL se completará después del primer despliegue de Neon Functions. No poner la URL en el código fuente.

La pantalla de inicio permite probar `GET /health` para comprobar conectividad HTTP.

## Chequeos de TypeScript

```bash
npm run typecheck
npm run build:frontend
```

Ambos comandos deben ejecutarse correctamente antes de aprobar el PR base.

## API

La función HTTP está en `backend/functions/api.ts` y se declara mediante `neon.ts`.

Endpoints de prueba:

- `GET /health`: verifica que la API responde.
- `GET /health/db`: consulta PostgreSQL para verificar la conexión (solo diagnóstico durante desarrollo).

No exponer información sensible ni abrir endpoints de negocio antes de implementar autorización.

## Estado de la base

La migración inicial está versionada en `database/migrations/001_initial_schema.sql`.

Fue preparada y probada en una rama temporal de Neon. **Aún no se aprobó su aplicación a la rama de producción.**

Antes de aplicar cualquier migración a producción, revisar el modelo y recibir autorización explícita.

## Seguridad

- No subir `.env` ni `frontend/.env.local`.
- No colocar secretos en variables Vite con prefijo `VITE_`, porque se publican en el navegador.
- Usar el legajo como identificador de usuario, nunca como contraseña.
- Restringir CORS y habilitar autenticación/autorización antes de exponer la API funcional.
- Utilizar datos ficticios o autorizados durante las pruebas.

## Próxima validación

1. Instalar dependencias.
2. Ejecutar los chequeos de tipos y compilación.
3. Desplegar una función de prueba en una rama no productiva de Neon.
4. Verificar `GET /health` y `GET /health/db`.
5. Recién entonces integrar módulos reales.
