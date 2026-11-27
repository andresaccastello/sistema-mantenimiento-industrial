# Publicación

Los pasos para dejar el sistema en internet (parte B de la Etapa PUB1). Se siguen en orden y desde la raíz del proyecto. Si un paso no sale como dice, **frená ahí** y no sigas con el siguiente.

**Cómo queda:**
- la API, en **Neon Functions**, sobre la rama `main`;
- el front, en **Vercel**;
- Vercel manda `/api/*` a la función, así el navegador ve un solo origen.

**Ningún secreto va en un archivo del repositorio ni en un chat.** Los archivos de este instructivo con secretos (`.env.produccion`, `.env.preprod` y `.env.funcion`) ya están ignorados por git: no los subas ni los copies a ningún lado.

> **Todo `neon deploy` de este instructivo lleva `--no-env-pull`. Sin eso, la CLI escribe en un `.env` local las variables de la rama, incluida la `DATABASE_URL` de `main`: el `.env` de desarrollo pasaría a apuntar a la base principal, y las pruebas correrían contra ella.**

---

## 1. Antes de empezar

1. **La región.** En la consola de Neon, abrí el proyecto y fijate la región. Tiene que ser una de estas:
   - `aws-us-east-1`
   - `aws-us-east-2`
   - `aws-eu-central-1`
   - `aws-ap-southeast-1`

   **Si es otra, frená:** Neon Functions no está en esa región, hace falta otro lugar para la API y se decide aparte.
2. **La CLI de Neon, versión 9.2.0 o mayor.** Revisala con:
   ```
   neon --version
   ```
   Si es menor, actualizala antes de seguir. Después, iniciá la sesión:
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
2. El script lista los archivos que va a aplicar y muestra **Base**, **Usuario** y **Endpoint**.
   - **Base** y **Usuario** pueden ser iguales en todas las ramas (por ejemplo, `neondb` y `neondb_owner`): no alcanzan para saber cuál es.
   - **El Endpoint (`ep-…`) es el que dice la rama.** En la consola de Neon, entrá a **Branches → `main`** y mirá el id de su cómputo en la sección **Computes**. También es el principio del host que muestra el botón **Connect** de `main`. Tienen que ser iguales.

   **Si el Endpoint no es el de `main`, no escribas nada:** cortá con Ctrl+C y revisá `.env.produccion`.
3. Escribí `MIGRAR` y Enter.
4. Tiene que salir una línea `✔` por archivo, y al final:
   - **Usuarios:** la cantidad;
   - **ADMIN001:** `existe` o `NO existe`;
   - **Usuario del sistema:** `existe`.

   **Si sale `✖`, frená:** el script muestra el archivo y el error de Postgres. Los archivos siguientes no se aplicaron.

## 5. El administrador

**Solo si el paso 4 dijo `ADMIN001: NO existe`.** En PowerShell, corré estas tres líneas. La primera te pide la contraseña inicial: escribí una fuerte. Queda solo en esa terminal, no en un archivo ni en el historial.

```
$env:ADMIN_INITIAL_PASSWORD = Read-Host 'Contraseña inicial de ADMIN001'
npx tsx --env-file=.env.produccion backend/functions/seed_admin.ts
Remove-Item Env:ADMIN_INITIAL_PASSWORD
```

Tiene que decir "Usuario administrador procesado con éxito."

## 6. La prueba en preprod

Antes de desplegar en `main`, se despliega en una rama de prueba con el correo simulado. **Recién si todo esto anda se sigue con el paso 7.**

1. **La rama.** En la consola de Neon, creá una rama `preprod` **desde `main`** (ya migrada, con el paso 4 hecho).
2. **Un `JWT_SECRET` para preprod:**
   ```
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
3. **Las variables.** Creá el archivo `.env.preprod` en la raíz del proyecto con estas líneas:
   ```
   JWT_SECRET=<el del punto 2>
   EMAIL_TRANSPORTE=simulado
   APP_URL_PUBLICA=https://provisorio.invalid
   ```
   Con `simulado` no se manda ningún mail, y no hacen falta las `SMTP_*`.
4. **Desplegar en preprod:**
   ```
   neon deploy --branch preprod --env .env.preprod --no-env-pull
   ```
   > **`--no-env-pull` no se saca: sin eso, la CLI escribe en un `.env` local las variables de la rama.**

   Si falta `JWT_SECRET`, `EMAIL_TRANSPORTE` o `APP_URL_PUBLICA`, el despliegue frena antes de cambiar nada: completá `.env.preprod` y repetilo.
5. **Anotar la URL de la función de preprod.** Sale al desplegar y también con:
   ```
   neon functions get api --branch preprod
   ```
6. **Las pruebas,** con el resultado anotado:
   1. `<URL de preprod>/health` responde `{"status":"ok", …}`.
   2. `<URL de preprod>/health/db` responde `{"status":"ok","database":"connected"}`.
   3. **El ingreso de ADMIN001.** En PowerShell (la contraseña se pide y no queda en el historial):
      ```
      $clave = Read-Host 'Contraseña de ADMIN001'
      $cuerpo = @{ legajo = 'ADMIN001'; password = $clave } | ConvertTo-Json
      (Invoke-RestMethod -Method Post -Uri '<URL de preprod>/api/auth/login' -ContentType 'application/json' -Body $cuerpo).user.legajo
      Remove-Variable clave, cuerpo
      ```
      Tiene que imprimir `ADMIN001`.
   4. **El disparador.** Pasado un minuto, en la consola de Neon, en los logs de la función `api` de la rama `preprod`, figura la llamada de `avisos-envios` a `/api/avisos/procesar`.

   **Si algo de esto falla, frená:** no se despliega en `main`. Anotá el error de los logs.

## 7. La API en main

1. **Un `JWT_SECRET` nuevo**, distinto del de desarrollo y del de preprod:
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
   - `JWT_SECRET`, `EMAIL_TRANSPORTE` y `APP_URL_PUBLICA` son **obligatorias**: sin alguna, el despliegue frena antes de cambiar nada.
   - Las otras son opcionales: si una falta, la función se queda con el valor que ya tenía.
   - `APP_URL_PUBLICA` y `CORS_ORIGIN` van provisorias: se corrigen en el paso 9.
   - `DATABASE_URL` **no va**: Neon le pasa a la función la de la rama donde se despliega.
3. **Desplegar en la rama `main`:**
   ```
   neon deploy --branch main --env .env.funcion --no-env-pull
   ```
   > **`--no-env-pull` no se saca: sin eso, la CLI escribe en un `.env` local las variables de la rama, incluida la `DATABASE_URL` de `main`.**

   `neon.ts` toma esas variables por su nombre: el archivo no se sube.
4. **Controlar las variables.** Corré:
   ```
   neon functions get api --branch main -E
   ```
   Tienen que figurar los 10 nombres del punto 2. **Si falta alguno, frená:** revisá que la línea esté en `.env.funcion` y desplegá de nuevo.
5. **Anotar la URL de la función.** Sale al desplegar y también con `neon functions get api --branch main`. Tiene una forma parecida a esta:
   ```
   https://br-xxxx-api.compute.c-1.us-east-2.aws.neon.tech/
   ```
6. **Una primera prueba:** abrí en el navegador `<URL de la función>/health`. Tiene que responder `{"status":"ok", …}`. Si no, frená y anotá el error de los logs de Neon.

## 8. El front

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

**Si con `frontend` no instala** (por ejemplo, falla `npm install` porque el `package-lock.json` está en la raíz), usá esta alternativa:
1. Mové el archivo a la raíz, hacé un commit y subilo:
   ```
   git mv frontend/vercel.json vercel.json
   ```
2. En Vercel, en la configuración del proyecto:
   - **Root Directory:** la raíz del repositorio (vacío);
   - **Build Command:** `npm run build:frontend`
   - **Output Directory:** `frontend/dist`
   - **sin** la variable `VITE_API_URL`.
3. Desplegá de nuevo y anotá la URL de Vercel.

## 9. Las URL definitivas

1. En `.env.funcion`, cambiá `APP_URL_PUBLICA` y `CORS_ORIGIN` por la URL de Vercel, sin `/` al final.
2. Desplegá la API de nuevo:
   ```
   neon deploy --branch main --env .env.funcion --no-env-pull
   ```
   > **Con `--no-env-pull`, como siempre: sin eso, la CLI escribe en un `.env` local las variables de la rama, incluida la `DATABASE_URL` de `main`.**
3. Repetí el control del paso 7.4.

## 10. Primer ingreso

1. Entrá a la URL de Vercel con `ADMIN001` y **cambiá la contraseña** por una fuerte.
2. En **Configuración**:
   - el nombre del sistema, la empresa y el logo;
   - el canal de email, activo;
   - "Enviar prueba".
3. Creá los usuarios de Laura y Ángel, como **administradores** y con su email.

## 11. La prueba de humo

Anotá el resultado de cada punto (bien o mal, y qué se vio):

1. `<URL de la función>/health` y `<URL de la función>/health/db` responden `ok`. Van contra la URL de la función: Vercel solo pasa `/api/*`.
2. El ingreso funciona, y al recargar una ruta interna (por ejemplo `/maquinas`) la página sigue ahí.
3. Cargar una máquina, reportar una falla y ver el tablero.
4. El mail de prueba del paso 10 llega.
5. Pasado un minuto, el disparador `avisos-envios` figura en los logs de Neon de la rama `main`.

## 12. Borrar preprod

Con la prueba de humo bien:
1. En la consola de Neon, borrá la rama `preprod`. Se lleva con ella su función y su disparador.
2. Borrá el archivo `.env.preprod`.

## 13. Si algo falla

- **El front:** en Vercel, volvé a una versión anterior desde la lista de despliegues.
- **La base:** volvé a la rama `respaldo-AAAA-MM-DD` del paso 2.
