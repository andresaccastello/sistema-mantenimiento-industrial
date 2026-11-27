# Publicación

Los pasos para dejar el sistema en internet (parte B de la Etapa PUB1). Se siguen en orden y desde la raíz del proyecto. Si un paso no sale como dice, **frená ahí** y no sigas con el siguiente.

**Cómo queda:**
- la API, en **Neon Functions**, sobre la rama `main`;
- el front, en **Vercel**;
- Vercel manda `/api/*` a la función, así el navegador ve un solo origen.

**Ningún secreto va en un archivo del repositorio ni en un chat.** Los dos archivos de este instructivo con secretos (`.env.produccion` y `.env.funcion`) ya están ignorados por git: no los subas ni los copies a ningún lado.

---

## 1. Antes de empezar

1. **La región.** En la consola de Neon, abrí el proyecto y fijate la región. Tiene que ser una de estas:
   - `aws-us-east-1`
   - `aws-us-east-2`
   - `aws-eu-central-1`
   - `aws-ap-southeast-1`

   **Si es otra, frená:** Neon Functions no está en esa región, hace falta otro lugar para la API y se decide aparte.
2. **La CLI de Neon**, instalada y con la sesión iniciada:
   ```
   neon auth
   ```
3. **Una cuenta en Vercel**, conectada al repositorio de GitHub.

## 2. El respaldo

En la consola de Neon, creá una rama desde `main` con el nombre `respaldo-AAAA-MM-DD` (la fecha de hoy). Si algo sale mal, se vuelve a ella.

## 3. La conexión

1. En la consola de Neon, copiá la cadena de conexión de la rama **`main`**.
2. Creá el archivo `.env.produccion` en la raíz del proyecto, **solo con** esa línea:
   ```
   DATABASE_URL=<la cadena de conexión de main>
   ```

## 4. La migración

1. Corré:
   ```
   node --env-file=.env.produccion scripts/migrar.mjs --desde 005
   ```
2. El script lista los archivos que va a aplicar y muestra **Base** y **Usuario**. Revisá que sea la base principal.
   > La rama de pruebas y la principal pueden tener el mismo nombre de base y de usuario (por ejemplo, `neondb` y `neondb_owner`). Lo que asegura que es la principal es que la cadena de `.env.produccion` sea la de `main`, del paso 3.
3. Escribí `MIGRAR` y Enter.
4. Tiene que salir una línea `✔` por archivo, y al final:
   - **Usuarios:** la cantidad;
   - **ADMIN001:** `existe` o `NO existe`;
   - **Usuario del sistema:** `existe`.

   **Si sale `✖`, frená:** el script muestra el archivo y el error de Postgres. Los archivos siguientes no se aplicaron.

## 5. El administrador

**Solo si el paso 4 dijo `ADMIN001: NO existe`.** Elegí una contraseña inicial fuerte y, en PowerShell, corré estas tres líneas (la contraseña queda solo en esa terminal, no en un archivo):

```
$env:ADMIN_INITIAL_PASSWORD = '<contraseña inicial fuerte>'
npx tsx --env-file=.env.produccion backend/functions/seed_admin.ts
Remove-Item Env:ADMIN_INITIAL_PASSWORD
```

Tiene que decir "Usuario administrador procesado con éxito."

## 6. La API

1. **Un `JWT_SECRET` nuevo**, distinto del de desarrollo:
   ```
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
2. **Las variables de la función.** Creá el archivo `.env.funcion` en la raíz del proyecto con estas líneas:
   ```
   JWT_SECRET=<el del punto 1>
   EMAIL_TRANSPORTE=smtp
   SMTP_HOST=<servidor de correo>
   SMTP_PORT=<puerto>
   SMTP_SEGURO=<true o false, según el puerto>
   SMTP_USUARIO=<usuario del correo>
   SMTP_PASSWORD=<contraseña del correo>
   EMAIL_REMITENTE=<dirección que figura como remitente>
   APP_URL_PUBLICA=https://provisorio.invalid
   CORS_ORIGIN=https://provisorio.invalid
   ```
   - `APP_URL_PUBLICA` y `CORS_ORIGIN` van provisorias: se corrigen en el paso 8.
   - `DATABASE_URL` **no va**: Neon le pasa a la función la de la rama donde se despliega.
3. **Desplegar en la rama `main`:**
   ```
   neon deploy --branch main --env .env.funcion
   ```
   `neon.ts` toma esas variables por su nombre: el archivo no se sube.
4. **Controlar las variables.** Corré:
   ```
   neon functions get api -E
   ```
   Tienen que figurar los 10 nombres del punto 2. **Si falta alguno, frená:** revisá que la línea esté en `.env.funcion` y desplegá de nuevo.
5. **Anotar la URL de la función.** Sale al desplegar y también con `neon functions get api`. Tiene esta forma:
   ```
   https://br-xxxx-api.compute.c-1.us-east-2.aws.neon.tech/
   ```
6. **Una primera prueba:** abrí en el navegador `<URL de la función>/health`. Tiene que responder `{"status":"ok", …}`. Si no, frená y anotá el error de los logs de Neon.

## 7. El front

1. En `frontend/vercel.json`, reemplazá `URL-DE-LA-FUNCION` por la URL de la función, **sin** `https://` adelante ni `/` al final. Por ejemplo:
   ```
   "destination": "https://br-xxxx-api.compute.c-1.us-east-2.aws.neon.tech/api/:path*"
   ```
   Hacé un commit con ese cambio y subilo.
2. En Vercel, importá el repositorio con:
   - **Root Directory:** `frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **sin** la variable `VITE_API_URL`.
3. Desplegá y **anotá la URL de Vercel**.

## 8. Las URL definitivas

1. En `.env.funcion`, cambiá `APP_URL_PUBLICA` y `CORS_ORIGIN` por la URL de Vercel, sin `/` al final.
2. Desplegá la API de nuevo:
   ```
   neon deploy --branch main --env .env.funcion
   ```
3. Repetí el control del paso 6.4.

## 9. Primer ingreso

1. Entrá a la URL de Vercel con `ADMIN001` y **cambiá la contraseña** por una fuerte.
2. En **Configuración**:
   - el nombre del sistema, la empresa y el logo;
   - el canal de email, activo;
   - "Enviar prueba".
3. Creá los usuarios de Laura y Ángel, como **administradores** y con su email.

## 10. La prueba de humo

Anotá el resultado de cada punto (bien o mal, y qué se vio):

1. `<URL de la función>/health` y `<URL de la función>/health/db` responden `ok`. Van contra la URL de la función: Vercel solo pasa `/api/*`.
2. El ingreso funciona, y al recargar una ruta interna (por ejemplo `/maquinas`) la página sigue ahí.
3. Cargar una máquina, reportar una falla y ver el tablero.
4. El mail de prueba del paso 9 llega.
5. Pasado un minuto, el disparador `avisos-envios` figura en los logs de Neon.

## 11. Si algo falla

- **El front:** en Vercel, volvé a una versión anterior desde la lista de despliegues.
- **La base:** volvé a la rama `respaldo-AAAA-MM-DD` del paso 2.
