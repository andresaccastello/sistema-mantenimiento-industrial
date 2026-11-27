# Etapa PUB1 — Publicación

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** el arreglo de pantalla del 26/11, terminado.
> **Origen:** que GI-RE pueda entrar y empezar a cargar sus datos (Andrés, 26/11).

**La idea en una línea:** el sistema queda en internet, con HTTPS y con la base principal al día, para que GI-RE lo use con sus datos reales.

**Cómo se publica:**

| Parte | Dónde | Por qué |
| :--- | :--- | :--- |
| La API | **Neon Functions**, en la rama principal | Es lo que dice la arquitectura desde el principio. `neon.ts` y el disparador programado ya están. La base le pasa su `DATABASE_URL` sola. |
| El front | **Vercel** (plan gratis) | Neon Functions no aloja páginas. Vercel publica el `dist` de Vite con HTTPS. |
| La unión | Una regla de Vercel que manda `/api/*` a la función | El navegador ve un solo origen, así que no hace falta CORS. Es lo mismo que hace hoy el proxy de Vite. |

**Este trabajo está partido en dos:**
- **la parte A** la hace Claude Code: código, configuración y el instructivo. **No toca la base principal ni ningún secreto;**
- **la parte B** la hace Andrés: las cuentas, los secretos, la migración de la base principal y el despliegue, siguiendo el instructivo.

**Qué no entra:**
- la app instalable;
- las notificaciones push;
- el QR;
- un dominio propio: por ahora, la dirección que da Vercel;
- los datos de demostración, que siguen en la rama de pruebas.

---

## 0. Reglas de trabajo (parte A)

1. **Leé `CLAUDE.md` entero y seguí sus reglas.**
   - **Nunca abras, leas, muestres ni modifiques ningún `.env`**, tampoco `.env.produccion`.
   - **Nunca te conectes a la base principal ni corras nada contra ella.**
   - Rama `feat/base-neon`. **No se agregan dependencias.**
2. **Tres commits.** Cada uno tiene que pasar `npm run typecheck` solo:

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1 y 5.1 | `feat(api): límite de intentos de ingreso` |
   | 2 | 2 y 3 | `chore: configuración para publicar en Neon Functions y Vercel` |
   | 3 | 4 | `docs: instructivo de publicación` |

3. **Pruebas:**
   - **en Neon:** la migración nueva y `test:ingreso` (nueva, `backend/tests/ingreso.test.ts`), además de `test:usuarios` y `test:preferencias`;
   - **además:** `test:front`, `typecheck` y `build:frontend`;
   - **no correr `test:todo`.**
4. **Ante cualquier duda, frenar y preguntar.**
5. **Los números:** la decisión, la migración y las FE son las siguientes libres. Anotalos en el informe.

Guardar este archivo como `docs/etapas/etapa-pub1-publicacion.md`.

---

## 1. Límite de intentos de ingreso (primer commit)

En internet, el ingreso no puede aceptar contraseñas sin límite. Hoy no tiene ninguno.

**La tabla `intentos_ingreso`:**

| Columna | Tipo |
| :--- | :--- |
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `legajo` | `VARCHAR(50) NOT NULL`, normalizado con `upper(trim())` |
| `exitoso` | `BOOLEAN NOT NULL` |
| `creado_en` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |

- **Índice** `(legajo, creado_en DESC)`.
- **Sumarla a `TABLAS_CONTROL`,** y actualizar la cuenta de tablas en `CLAUDE.md`.

**La regla, en `POST /api/auth/login`:**

**Antes de mirar la contraseña,** se cuentan los intentos fallidos de ese legajo en los últimos 15 minutos que vinieron **después de su último ingreso exitoso**.
- **Con 5 o más:** responde **429 `DEMASIADOS_INTENTOS`** con el mensaje "Demasiados intentos. Probá de nuevo en unos minutos", y no compara la contraseña.
- **El legajo inexistente cuenta igual,** y la respuesta es la misma. Así no se puede averiguar qué legajos existen.

**Cada intento se registra:** el exitoso con `exitoso = TRUE` y el fallido con `FALSE`.

**Concurrencia:** se toma un `pg_advisory_xact_lock(hashtext('ingreso:' || legajo))` en la misma transacción que cuenta y registra. Así, cinco pedidos a la vez no se saltean el límite.

**Limpieza:** en cada ingreso exitoso se borran los intentos de más de 7 días, de todos los legajos.

**El front:** el 429 muestra el mensaje en la pantalla de ingreso, igual que los otros errores (`lib/errores.ts`, con una FE).

**La decisión (D-0xx):** el ingreso se bloquea 15 minutos después de 5 fallos seguidos de un legajo. Exista o no el legajo, la respuesta es la misma. **Motivo:** el sistema queda expuesto en internet.

## 2. Configuración para publicar (segundo commit)

**`frontend/vercel.json`:**

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://URL-DE-LA-FUNCION/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    { "source": "/(.*)", "headers": [
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
    ] }
  ]
}
```

- **`URL-DE-LA-FUNCION` queda así, literal.** Andrés la reemplaza en la parte B: no es un secreto, pero se conoce recién después del primer despliegue.
- **La primera regla manda la API a la función;** la segunda hace que las rutas del front (como `/maquinas/12`) no den 404 al recargar.

**El backend en Neon Functions:**
- **Que `backend/functions/api.ts` sirva como función tal cual.** Revisá con `neon.ts` que `source` y el disparador (`/api/avisos/procesar`, cada minuto) sigan bien.
- **Si algo del código solo anda con `server.ts`** (el `setInterval` y el puerto son solo de desarrollo), decilo en el informe y no lo cambies sin preguntar.
- **`/health` y `/health/db`** quedan como están: sirven para la prueba de humo.

**`.gitignore`:**
- tiene que ignorar **`.env.*`**, menos `.env.example`;
- **y `frontend/.env`.**

Si alguno ya está ignorado, decilo y no lo dupliques.

**`frontend/.env.example`:**
- la línea de `VITE_API_URL` pasa a estar comentada;
- con la explicación: "Sin definir, el front llama a la API por su mismo origen (proxy de Vite en desarrollo, regla de Vercel publicado)".

## 3. El script para migrar la base principal (segundo commit)

**`scripts/migrar.mjs`:** lo corre Andrés, no Claude Code.

**Uso:**

```
node --env-file=<archivo> scripts/migrar.mjs --desde 005 [--hasta 026] [--si]
```

**Qué hace:**
1. **Lista los archivos de `database/migrations/` dentro del rango,** en orden.
2. **Se conecta con `DATABASE_URL`** y muestra **solo** el nombre de la base y el usuario (`current_database()` y `current_user`), **nunca** la cadena de conexión ni el host completo.
3. **Pide confirmación** escribiendo `MIGRAR`, salvo que venga `--si`.
4. **Aplica cada archivo,** con una línea por archivo (`✔ 005_motor_estados.sql`).
   - **Al primer error,** frena y muestra el archivo y el mensaje de Postgres, sin la cadena de conexión.
   - Los archivos ya traen su propio `BEGIN` y `COMMIT`.
5. **Al final,** muestra `SELECT count(*) FROM usuarios` y si existen `ADMIN001` y el usuario del sistema (`es_sistema`).

**Lo que nunca hace:**
- tocar datos que no estén en las migraciones;
- borrar nada.

**La prueba de Claude Code:** corre el script **solo contra la rama de pruebas** (`--env-file=.env`, con `--desde 024 --si`) y pega la salida. Como las migraciones se pueden reaplicar, no rompe nada.

## 4. El instructivo (tercer commit)

**`docs/publicacion.md`:** los pasos de la parte B, numerados, para seguir sin pensar.

1. **Antes de empezar:**
   - **La región:** en la consola de Neon, revisá que el proyecto esté en una región con Functions: `aws-us-east-1`, `aws-us-east-2`, `aws-eu-central-1` o `aws-ap-southeast-1`. **Si no, frená:** hace falta otro lugar para la API, y se decide aparte.
   - **La CLI de Neon** instalada y con sesión iniciada (`neon auth`).
   - **Una cuenta en Vercel,** conectada al repositorio de GitHub.
2. **El respaldo:** en Neon, crear una rama `respaldo-AAAA-MM-DD` desde `main`. Si algo sale mal, se vuelve a ella.
3. **La conexión:** crear `.env.produccion` en la raíz del proyecto, **solo con** `DATABASE_URL` de la rama `main` (está ignorado por git).
4. **La migración:** correr `node --env-file=.env.produccion scripts/migrar.mjs --desde 005`, revisar que diga la base principal, y escribir `MIGRAR`.
5. **El administrador:** si el paso 4 dice que no existe `ADMIN001`, correr el alta del administrador con una contraseña inicial fuerte.
6. **La API:**
   - **Un `JWT_SECRET` nuevo,** distinto del de desarrollo:
     ```
     node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
     ```
   - **Desplegar en la rama `main`:**
     ```
     neon deploy --branch main
     ```
     con estas variables:
     - `JWT_SECRET`;
     - `EMAIL_TRANSPORTE=smtp` y las `SMTP_*`;
     - `EMAIL_REMITENTE`;
     - `APP_URL_PUBLICA` y `CORS_ORIGIN`, por ahora con un valor provisorio.
   - **Anotar la URL de la función.**
   - **Ningún secreto va en un archivo del repositorio ni en un chat.**
7. **El front:**
   - en `frontend/vercel.json`, reemplazar `URL-DE-LA-FUNCION` por esa URL y hacer un commit;
   - en Vercel, importar el repositorio con `Root Directory = frontend`, `Build Command = npm run build` y `Output Directory = dist`;
   - **sin `VITE_API_URL`;**
   - desplegar y anotar la URL de Vercel.
8. **Las URL definitivas:** volver a desplegar la API con `APP_URL_PUBLICA` y `CORS_ORIGIN` en la URL de Vercel.
9. **Primer ingreso:**
   - entrar con `ADMIN001` y **cambiar la contraseña** por una fuerte;
   - en Configuración: nombre, empresa, logo y canal de email activo, y "Enviar prueba";
   - crear los usuarios de Laura y Ángel, como administradores y con su email.
10. **La prueba de humo, con el resultado anotado:**
    - `/health` y `/health/db` responden `ok`;
    - el ingreso, y recargar una ruta interna;
    - cargar una máquina, reportar una falla, ver el tablero;
    - el mail de prueba llega;
    - al minuto, el disparador figura en los logs de Neon.
11. **Si algo falla:** el front se puede volver a una versión anterior en Vercel; la base, a la rama de respaldo.

## 5. Pruebas

### 5.1 `test:ingreso` (IN), y la migración

**De la migración:** la tabla, el índice, y que se pueda reaplicar.

| N.º | Qué se prueba |
| :-: | :--- |
| IN-01 | 4 fallos y después la contraseña correcta: entra. |
| IN-02 | 5 fallos: el sexto intento da 429, **aunque la contraseña sea la correcta**. |
| IN-03 | Los fallos de hace más de 15 minutos no cuentan (se corre `creado_en` por SQL). |
| IN-04 | Un ingreso exitoso pone la cuenta en cero. |
| IN-05 | Un legajo inexistente se bloquea igual, con la misma respuesta. |
| IN-06 | Concurrencia: 8 pedidos fallidos a la vez: exactamente 5 responden como contraseña incorrecta (el mismo código de hoy) y los otros 3 dan 429. Nunca 500. |
| IN-07 | Los legajos con distinto formato (`" admin001 "` y `ADMIN001`) son el mismo legajo. |

Cada prueba usa legajos propios y borra sus intentos al terminar.

---

## 6. Cierre e informe (parte A)

**Criterios de cierre:**
1. Las secciones 1 a 5 están hechas, en tres commits que compilan solos.
2. Las pruebas de la regla 3 están en verde, en Neon.
3. Se hizo push en `feat/base-neon`.

**El informe.** Las salidas van pegadas tal cual:
1. Los hashes y los números que se usaron.
2. La salida de cada suite, el typecheck y el build.
3. La salida de `scripts/migrar.mjs` contra la rama de pruebas.
4. Lo que encontraste en `neon.ts` y en `api.ts` (punto 2).
5. Los desvíos y las dudas.
