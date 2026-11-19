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


---

## Configuración de Avisos por Email

El sistema soporta envío de avisos por correo electrónico mediante transporte SMTP o simulado (en memoria para pruebas).

### Variables de entorno

| Variable | Descripción |
| :--- | :--- |
| `EMAIL_TRANSPORTE` | `smtp` o `simulado`. Si no está definida, el correo cuenta como no configurado. |
| `SMTP_HOST` | Host del servidor SMTP (para Gmail: `smtp.gmail.com`). |
| `SMTP_PORT` | Puerto SMTP (para Gmail: `465`). |
| `SMTP_SEGURO` | `true` para conexiones SSL/TLS seguras (puerto 465). |
| `SMTP_USUARIO` | Cuenta de correo que envía (ej. `tu-cuenta@gmail.com`). |
| `SMTP_PASSWORD` | Contraseña de aplicación (ver instrucciones abajo). Nunca la contraseña habitual. |
| `EMAIL_REMITENTE` | Nombre y dirección de origen visible (ej. `Mantenimiento <avisos@empresa.com>`). |
| `APP_URL_PUBLICA` | URL pública del sistema para armar los enlaces en los correos (opcional). |

> [!WARNING]
> **Seguridad de credenciales:** Ninguna de estas variables con valores reales debe subirse al repositorio Git. Mantenerlas únicamente en `.env` local.

### Cómo crear una Contraseña de Aplicación en Gmail

1. Ingresar a la **Cuenta de Google** (`myaccount.google.com`).
2. Ir a la pestaña **Seguridad**.
3. Asegurarse de tener activada la **Verificación en dos pasos**.
4. En el buscador de la cuenta, escribir **"Contraseñas de aplicaciones"** (o ingresar en la sección de verificación en dos pasos).
5. Crear un nombre identificatorio (ej. "Sistema Mantenimiento").
6. Google generará una contraseña de 16 caracteres. Copiarla y pegarla en la variable `SMTP_PASSWORD` de tu archivo `.env` local (sin espacios).
