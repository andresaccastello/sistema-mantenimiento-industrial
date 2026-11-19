# Etapa N1a — Avisos por email: backend

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `1fa5583` (Etapa F4b.1).
> **Base:**
>
> - D-10 y D-36 del análisis: la campana es el aviso principal; la bandeja de salida (`notificacion_envios`) y los canales activables (`notificacion_canales`) quedaron listos para un envío futuro;
> - decisiones del usuario para esta etapa:
>   - el **administrador** decide, por tipo de aviso, qué sale por cada canal;
>   - **email real ahora**; WhatsApp queda preparado para más adelante;
>   - todo se configura desde una pantalla de **Configuración general**, no desde un módulo aparte.
>
> **Para qué:** que los avisos importantes lleguen por email a quien no está mirando el sistema, con el envío configurable por el administrador.

**Etapas de esta tanda:**

- **N1a (esta):** la corrida de pruebas sin cuelgues, la migración 015, el envío de emails y la API.
- **N1b (la siguiente):** la pantalla de Configuración y los datos de contacto en usuarios.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`.
2. **Tres commits**, para revisarlos por separado (sección 9).
3. **Una dependencia nueva:** `nodemailer` y, para desarrollo, `@types/nodemailer`. Van con la versión exacta, como el resto del `package.json`. No se agrega ninguna otra.
4. **Nada de contraseñas en el código, en la base ni en las respuestas.** La contraseña del correo va solo en variables de entorno. La API dice si el correo está configurado, nunca con qué.
5. **Las pruebas nunca mandan emails reales.** El transporte simulado de la sección 4.1 es obligatorio en toda prueba.
6. **Pruebas de la etapa:** corren contra la rama de pruebas de Neon. Rige la regla de la F2.2: una prueba no borra ni modifica datos que no creó.

   **Excepción, como con los catálogos en la F4a:** las pruebas que activan el canal EMAIL o cambian reglas:
   - guardan el estado al empezar;
   - lo devuelven en un `finally`, por SQL;
   - y verifican al final que quedó igual.
7. **Esta etapa no corre `test:todo`.** Va en la corrida de la noche, junto con las demás etapas del día. Durante el trabajo se corren solo las pruebas de la sección 9.
8. Ante cualquier duda o diferencia con este documento, **frenar y preguntar**.

Guardar este archivo como `docs/etapas/etapa-n1a-avisos-email.md`.

---

## 1. Corrida completa sin cuelgues (primer commit)

Las pruebas de la noche corren sin nadie mirando. Una prueba que se cuelga no puede frenar la corrida.

### 1.1 El problema

Revisando la F4a, una prueba de la migración 003 falló en una base nueva, y `test:todo` quedó esperando para siempre sin terminar. Hoy cada grupo de suites (migraciones y negocio) corre en un solo proceso, y nada lo corta.

### 1.2 Corrección en `scripts/run-all-tests.mjs`

1. **Opciones de `node --test`:**
   - `--test-timeout=1800000`: una prueba que pasa los 30 minutos falla y la corrida sigue. Es largo a propósito, porque en Neon una suite entera puede tardar varios minutos.
   - `--test-force-exit`: el proceso termina al acabar las pruebas, aunque quede una conexión abierta.
2. **Vigía por grupo:**
   - si un grupo pasa **20 minutos sin escribir nada**, se mata el proceso con sus hijos y el grupo cuenta como fallido;
   - en la salida y en el registro queda: `[test:todo] CORTADO: 20 minutos sin salida. Último archivo: <archivo>`;
   - para matar los hijos:
     - en Linux y macOS: `detached: true` al lanzar y `process.kill(-pid)`;
     - en Windows: `taskkill /pid <pid> /T /F`.
3. **Variables para las suites:** al lanzar cada grupo, el entorno lleva `EMAIL_TRANSPORTE=simulado`, aunque el `.env` diga otra cosa. `--env-file` no pisa una variable que ya está definida, así que alcanza con pasarla en `env` al lanzar.
4. **Código de salida:** distinto de 0 si un grupo falló o se cortó.

**Verificación:** con una suite temporal que se cuelga a propósito, la corrida termina con el mensaje de corte. La suite **no se sube**. En el informe va la salida.

### 1.3 Pruebas que fallan con un canal activo

Si alguien activa el email en la rama de pruebas, cada intervención genera envíos en `notificacion_envios`. Algunas limpiezas borran notificaciones sin borrar antes sus envíos, y fallan por la clave foránea.

**Corrección:**

- en `tiempos.test.ts`, `pendientes.test.ts` y `migration_003.test.ts`, borrar los envíos de esas notificaciones antes de borrar las notificaciones;
- en `migration_008.test.ts`, la prueba 2 pasa a verificar que los tres canales existen y que el valor por omisión de la columna `activo` es `false` (en `information_schema.columns`), no el valor actual de cada fila.

Son los **únicos cambios permitidos en pruebas existentes** de esta etapa.

---

## 2. Migración `015_avisos_email.sql` (segundo commit)

Idempotente, como las anteriores: `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, y restricciones que se agregan solo si no existen.

### 2.1 Datos de contacto en `usuarios`

| Columna | Tipo | Restricción |
| :--- | :--- | :--- |
| `email` | `VARCHAR(254) NULL` | `ck_usuarios_email`: `email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'` |
| `telefono_whatsapp` | `VARCHAR(16) NULL` | `ck_usuarios_telefono_whatsapp`: formato internacional, `^\+[1-9][0-9]{7,14}$` |

No son únicos: dos personas pueden compartir un correo de sector.

### 2.2 Nueva tabla `notificacion_reglas`

Qué tipos de aviso salen por cada canal.

| Columna | Tipo |
| :--- | :--- |
| `tipo_evento` | `VARCHAR(60) NOT NULL`. `CHECK` con los 8 tipos de `REGLAS_EVENTOS_NOTIFICACION`. |
| `canal` | `VARCHAR(20) NOT NULL REFERENCES notificacion_canales(canal)`. `CHECK (canal IN ('EMAIL', 'WHATSAPP'))`. |
| `modo` | `VARCHAR(10) NOT NULL DEFAULT 'NUNCA'`. `CHECK (modo IN ('NUNCA', 'SOLO_ALTA', 'SIEMPRE'))`. |
| `actualizado_en` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |
| `actualizado_por_usuario_id` | `BIGINT NULL REFERENCES usuarios(id)` |

La clave primaria es `(tipo_evento, canal)`.

**Valores iniciales:** 16 filas. WhatsApp va en `NUNCA` en todas. Para EMAIL:

| Tipo de aviso | Modo inicial | Por qué |
| :--- | :--- | :--- |
| `FALLA_REGISTRADA` | `SOLO_ALTA` | Las fallas comunes las ve quien está en el sistema; las críticas tienen que llegar igual. |
| `INTERVENCION_ASIGNADA` | `SIEMPRE` | La persona tiene trabajo nuevo. |
| `INTERVENCION_REASIGNADA` | `SIEMPRE` | Ídem. |
| `DETENCION_PENDIENTE_CONFIRMACION` | `SIEMPRE` | Una máquina espera confirmación para volver a producir. |
| los otros cuatro | `NUNCA` | |

Como el canal EMAIL arranca apagado, estos valores no mandan nada hasta que el administrador lo prende.

### 2.3 Cambios en tablas existentes

- **`notificacion_canales`:** agregar `actualizado_por_usuario_id BIGINT NULL REFERENCES usuarios(id)`.
- **`notificacion_envios`:**
  - agregar `proximo_intento_en TIMESTAMPTZ NULL` y `destino VARCHAR(254) NULL`;
  - índice parcial para los pendientes: `(canal, proximo_intento_en) WHERE estado = 'PENDIENTE'`.

### 2.4 Permiso nuevo

- **`CONFIGURACION_GESTIONAR`:**
  - nombre: "Gestionar la configuración";
  - descripción: "Permite cambiar la configuración general del sistema, como los avisos por email y WhatsApp";
  - `usa_alcance = false`.
- Se asigna al perfil **ADMINISTRADOR**, y solo a ese.

### 2.5 Prueba `migration_015.test.ts`

Script `test:migration-015`. Mismo estilo que `migration_014`:

| ID | Esperado |
| :-: | :--- |
| M15-01 | Se aplica dos veces sin error. |
| M15-02 | `email` y `telefono_whatsapp` existen y aceptan `NULL`. Las restricciones rechazan `sin-arroba`, `+12` y `5491112345678` (sin el "+"). Aceptan `a@b.co` y `+5491112345678`. |
| M15-03 | `notificacion_reglas` tiene las 16 filas, con los modos de la tabla 2.2. Las restricciones rechazan un tipo, un canal y un modo inventados. |
| M15-04 | Las columnas nuevas de `notificacion_canales` y `notificacion_envios` existen. |
| M15-05 | `CONFIGURACION_GESTIONAR` existe, con `usa_alcance = false`, y lo tiene solo el perfil ADMINISTRADOR. |
| M15-06 | Aplicarla de nuevo no cambia un modo ni un canal que se cambiaron después. Se prueba dentro de una transacción con `ROLLBACK`. |

---

## 3. Qué genera un envío (tercer commit, con las secciones 4 a 8)

En `registrarNotificaciones` (`intervenciones/notificaciones.ts`), hoy se crea un envío `PENDIENTE` por cada canal activo. Pasa a crearse solo si se cumplen las tres cosas:

1. el canal está activo;
2. la regla del tipo de aviso para ese canal está en `SIEMPRE`, o en `SOLO_ALTA` con la notificación en prioridad `ALTA`;
3. el canal es `EMAIL`. WhatsApp no genera envíos hasta tener su transporte.

Sigue siendo **un solo `INSERT … SELECT`**, que ahora une `notificacion_reglas` por tipo de evento y prioridad.

La campana no cambia: la notificación interna se crea siempre, como hoy.

---

## 4. Envío de emails (`backend/functions/avisos/`)

### 4.1 Transporte

`transporteEmail.ts`:

```ts
interface MensajeEmail { para: string; asunto: string; texto: string; html: string }
interface TransporteEmail { enviar(m: MensajeEmail): Promise<void> }
```

El transporte se elige con la variable `EMAIL_TRANSPORTE`:

| Valor | Qué hace |
| :--- | :--- |
| `smtp` | `nodemailer`, con `SMTP_HOST`, `SMTP_PORT`, `SMTP_SEGURO` (`true` para el puerto 465), `SMTP_USUARIO`, `SMTP_PASSWORD` y `EMAIL_REMITENTE`. Si falta alguna, el correo cuenta como no configurado. |
| `simulado` | No sale nada. Guarda cada mensaje en una lista en memoria. Exporta `mensajesSimulados()`, `limpiarMensajesSimulados()` y `simularFallaEmail(activa: boolean)`, para las pruebas. |
| sin definir | Correo no configurado. |

**`estadoEmail()`** devuelve `{ configurado, transporte, remitente }`. Nunca devuelve el usuario ni la contraseña.

**Errores:** el texto que se guarda o se muestra se recorta a 500 caracteres. Antes, se le saca cualquier aparición de `SMTP_USUARIO` o de `SMTP_PASSWORD`.

**Para el futuro:** si en el despliegue la plataforma no deja abrir conexiones SMTP, se agrega otro transporte por HTTP detrás de la misma interfaz. Por eso nada fuera de `transporteEmail.ts` conoce a `nodemailer`.

### 4.2 Contenido del email

| Parte | Contenido |
| :--- | :--- |
| Asunto | `[Urgente] ` si la notificación es de prioridad `ALTA`, más el título de la notificación. |
| Texto | El mensaje de la notificación.<br>Si hay `APP_URL_PUBLICA` y la notificación tiene intervención: una línea en blanco y "Ver en el sistema: {APP_URL_PUBLICA}/intervenciones/{id}".<br>Al final, la firma: "— {nombre_empresa}". Si `nombre_empresa` no está cargado, va `nombre_sistema`. Los dos salen de `configuracion_sistema`. |
| HTML | El mismo contenido, con el texto escapado y el enlace como `<a>`. Sin imágenes ni estilos externos. |

### 4.3 Procesar la bandeja: `procesarEnvios(opciones)`

**Opciones:**

- `limite`: por omisión, 50;
- `presupuestoMs`: por omisión, 50 000;
- `ids`: opcional, para que las pruebas procesen solo sus envíos.

**Si el correo no está configurado:** no toca nada y devuelve `{ sin_transporte: true }`.

**Cada envío va en su propia transacción:**

1. `BEGIN`.
2. Tomar un pendiente:

   ```sql
   SELECT … FROM notificacion_envios e
   JOIN notificaciones n ON n.id = e.notificacion_id
   JOIN usuarios u ON u.id = n.usuario_id
   WHERE e.estado = 'PENDIENTE' AND e.canal = 'EMAIL'
     AND (e.proximo_intento_en IS NULL OR e.proximo_intento_en <= NOW())
   ORDER BY e.creado_en, e.id
   LIMIT 1
   FOR UPDATE OF e SKIP LOCKED
   ```

3. Decidir:

   | Caso | Resultado |
   | :--- | :--- |
   | El canal EMAIL está apagado | `DESCARTADO`, con "Canal desactivado" |
   | El usuario está inactivo | `DESCARTADO`, con "Usuario inactivo" |
   | El usuario no tiene email | `DESCARTADO`, con "Sin email cargado" |
   | La notificación tiene más de 24 horas | `DESCARTADO`, con "Vencido" |
   | El envío sale bien | `ENVIADO`, con `enviado_en = NOW()` y `destino` = el email |
   | El envío falla | `intentos + 1` y `ultimo_error`. Si `intentos` llega a 5: `ERROR`. Si no, sigue `PENDIENTE` con `proximo_intento_en = NOW()` más 1, 5, 15 o 60 minutos, según sea el primer, segundo, tercer o cuarto intento. |

4. `COMMIT`.
5. Repetir hasta que no haya pendientes, se llegue al `limite` o se pase el `presupuestoMs`.

**Por qué una transacción por envío:**

- el bloqueo dura lo que tarda un solo email;
- `SKIP LOCKED` hace que dos procesos a la vez nunca manden el mismo email.

**Devuelve:** `{ procesados, enviados, descartados, con_error, reintentar }`.

### 4.4 Cuándo se procesa

| Quién | Cómo |
| :--- | :--- |
| Neon, cada minuto | Disparador programado (sección 7) que llama a `POST /api/avisos/procesar`. |
| El administrador | El botón "Procesar ahora" de la pantalla (`POST /api/configuracion/avisos/procesar`). |
| El servidor local (`backend/server.ts`) | Cada 60 segundos, `procesarEnvios()`, solo si `EMAIL_TRANSPORTE` está definido. Es solo para desarrollo: la función de Neon no lo usa. |

**No se manda dentro del pedido que generó el aviso.** Un servidor de correo lento no puede demorar a quien reporta una falla. El email puede tardar hasta un minuto en salir.

---

## 5. API

### 5.1 Disparador: `POST /api/avisos/procesar`

- **Sin sesión.** Según la documentación de Neon, las llamadas programadas no traen credenciales.
- **Solo si viene el encabezado `X-Neon-Trigger-Invocation-Id`.** Si no, 403 `PERMISO_INSUFICIENTE`. Neon borra ese encabezado cuando lo manda otro, así que en producción solo puede venir de Neon.
- **Respuesta:** el resultado de `procesarEnvios()`.

### 5.2 Configuración: `/api/configuracion/avisos`

Todas las rutas piden `CONFIGURACION_GESTIONAR`.

**`GET /`:**

```json
{
  "canales": [
    { "canal": "EMAIL", "activo": false, "disponible": true, "configurado": true, "transporte": "smtp", "remitente": "Mantenimiento <avisos@empresa.com>", "actualizado_en": "…", "actualizado_por": { "id": 1, "nombre": "…", "apellido": "…" } },
    { "canal": "WHATSAPP", "activo": false, "disponible": false, "configurado": false, "transporte": null, "remitente": null, "actualizado_en": "…", "actualizado_por": null }
  ],
  "reglas": [
    { "tipo_evento": "FALLA_REGISTRADA", "EMAIL": "SOLO_ALTA", "WHATSAPP": "NUNCA" }
  ],
  "pendientes": 0
}
```

- `reglas` lleva los 8 tipos, en el orden de `REGLAS_EVENTOS_NOTIFICACION`.
- `pendientes`: envíos `PENDIENTE` de EMAIL.
- `PUSH` no aparece.

**`PUT /canales/:canal`**, con `{ "activo": true | false }`:

| Caso | Respuesta |
| :--- | :--- |
| `WHATSAPP` | 409 `CANAL_NO_DISPONIBLE`. "WhatsApp todavía no está disponible." |
| `EMAIL` en `true`, sin correo configurado | 409 `CANAL_SIN_CONFIGURAR`. "Falta configurar el servidor de correo." |
| Canal inexistente, o `PUSH` | 404 `CANAL_NO_ENCONTRADO` |
| `activo` que no es booleano | 400 `DATOS_INVALIDOS` |
| `EMAIL` en `false` | En la misma transacción, los envíos `PENDIENTE` de EMAIL pasan a `DESCARTADO` con "Canal desactivado". Así, si se vuelve a prender, no salen avisos viejos. |
| Correcto | 200 con el `GET /` actualizado. Guarda `actualizado_en` y `actualizado_por_usuario_id`. |

**`PUT /reglas`**, con `{ "tipo_evento", "canal", "modo" }`:

- un tipo, un canal o un modo inválidos: 400 `DATOS_INVALIDOS`;
- las reglas de WhatsApp **sí** se pueden guardar, para dejarlo preparado;
- correcto: 200 con el `GET /` actualizado.

**`POST /prueba`**, con `{ "canal": "EMAIL" }`. Manda un email de prueba **ahora**, sin pasar por la bandeja, al email de quien lo pide. No hace falta que el canal esté activo, así se prueba antes de prenderlo.

| Caso | Respuesta |
| :--- | :--- |
| Quien lo pide no tiene email | 409 `SIN_EMAIL`. "Cargá tu email en tu usuario para recibir la prueba." |
| Correo no configurado | 409 `CANAL_SIN_CONFIGURAR` |
| Falla el envío | 502 `ENVIO_FALLIDO`, con `detalle`: el error recortado de la sección 4.1 |
| Correcto | 200 con `{ "enviado_a": "…" }` |

- **Asunto:** "Prueba de avisos".
- **Texto:** "Si recibiste este email, los avisos por email de {nombre_sistema} funcionan."

**`POST /procesar`:** corre `procesarEnvios()` y devuelve su resultado.

**`GET /envios?limit=20&offset=0&estado=`:**

- `limit` de 1 a 100 y `offset` de 0 en adelante; `estado`, opcional, uno de los cuatro. Si no: 400.
- Orden: `creado_en` descendente, después `id` descendente.
- Respuesta:

  ```json
  {
    "total": 31,
    "envios": [
      {
        "id": 9, "canal": "EMAIL", "estado": "ENVIADO", "intentos": 1, "ultimo_error": null,
        "destino": "…", "creado_en": "…", "enviado_en": "…", "proximo_intento_en": null,
        "notificacion": { "id": 120, "tipo_evento": "INTERVENCION_ASIGNADA", "prioridad": "NORMAL", "titulo": "…", "intervencion_id": 77 },
        "usuario": { "id": 551, "nombre": "…", "apellido": "…" }
      }
    ]
  }
  ```

### 5.3 Usuarios: datos de contacto

- **Alta y edición:**
  - `POST /api/usuarios` y `PATCH /api/usuarios/:id` aceptan `email` y `telefono_whatsapp`;
  - se recortan los espacios; el email se guarda en minúsculas;
  - `null` o `""` lo borra.
- **Errores, con mensajes para mostrar en el campo:**
  - 422 `EMAIL_INVALIDO`: "El email no tiene un formato válido.";
  - 422 `TELEFONO_INVALIDO`: "El número tiene que estar en formato internacional, por ejemplo +5491112345678.".
- **Respuestas:** `GET /api/usuarios`, `GET /api/usuarios/:id` y `GET /api/auth/me` los traen. En `/auth/me` son los propios, para mostrarlos en Mi cuenta.
- **Auditoría:** desde esta etapa, `USUARIO_MODIFICADO` lleva en `anterior` y `nuevo` los cuatro campos: `nombre`, `apellido`, `email` y `telefono_whatsapp`. Se registra cuando cambia cualquiera de ellos. Los registros viejos, con dos campos, quedan como están.

---

## 6. Variables de entorno

Agregar a `.env.example`, sin valores reales, y a `docs/desarrollo-local.md`:

| Variable | Para qué |
| :--- | :--- |
| `EMAIL_TRANSPORTE` | `smtp` o `simulado`. Sin definir: correo no configurado. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SEGURO` | Servidor de correo. Con Gmail: `smtp.gmail.com`, `465`, `true`. |
| `SMTP_USUARIO`, `SMTP_PASSWORD` | Cuenta que envía. Con Gmail, `SMTP_PASSWORD` es una **contraseña de aplicación**: requiere la verificación en dos pasos y se crea en la cuenta de Google. Nunca la contraseña normal. |
| `EMAIL_REMITENTE` | Lo que ve quien recibe, por ejemplo `Mantenimiento <avisos@empresa.com>`. |
| `APP_URL_PUBLICA` | Dirección pública del sistema, para el enlace del email. Opcional. |

En `docs/desarrollo-local.md`, explicar en pasos cortos cómo crear la contraseña de aplicación de Gmail. Agregar el aviso de que **ninguna** de estas variables con valores reales se sube al repositorio.

---

## 7. `neon.ts`: disparador programado

Agregar:

```ts
triggers: {
  'avisos-envios': {
    type: 'schedule',
    function: 'api',
    cron: '* * * * *',
    functionPath: '/api/avisos/procesar',
  },
},
```

**No se despliega en esta etapa.** Desplegar es una decisión aparte. Así queda escrito para cuando se haga.

---

## 8. Documentación

1. **`docs/decisiones.md`:** agregar al final:

   > ## D-016 — Avisos por email configurables
   >
   > **Estado:** Aceptada
   >
   > La campana sigue siendo el aviso principal. El email es una copia para quien no está mirando el sistema.
   >
   > - El administrador prende o apaga cada canal y decide, por tipo de aviso, si sale nunca, solo con prioridad alta o siempre.
   > - Los envíos pasan por la bandeja de salida y se procesan cada minuto. No se mandan dentro del pedido que generó el aviso, para que un servidor de correo lento no demore a nadie.
   > - Cada envío se reintenta hasta 5 veces. Se descarta si el usuario no tiene email, está inactivo, el aviso tiene más de 24 horas o el canal se apagó.
   > - Las contraseñas del correo van solo en variables de entorno.
   > - WhatsApp queda preparado (datos de contacto y reglas) hasta tener su transporte.
   >
   > **Motivo:** decisión del usuario. Que cada instalación elija cuánto avisar, sin tocar el código.

2. **`docs/modelo-datos.md`:** las columnas y la tabla nuevas.

---

## 9. Pruebas y cierre

### 9.1 Archivo nuevo `backend/tests/avisos.test.ts`

Script `test:avisos`.

**Antes de importar la app,** pone `process.env.EMAIL_TRANSPORTE = 'simulado'`. Así funciona igual corrido solo o dentro de `test:todo`.

**Datos:**

- crea sus propios usuarios, sector y máquinas: una de criticidad con prioridad alta y otra sin;
- procesa con `procesarEnvios({ ids })`, solo con los envíos de la prueba;
- al final verifica que los canales y las reglas quedaron como al principio (regla 6 de la sección 0).

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| AV-01 | Permisos | Un operario recibe 403 en las seis rutas de `/api/configuracion/avisos`. La administradora de la prueba, 200 en `GET /`. |
| AV-02 | Lectura | La forma de 5.2. WhatsApp con `disponible: false`; los 8 tipos en orden. El texto de la respuesta no contiene el valor de `SMTP_PASSWORD` ni de `SMTP_USUARIO`, si están definidos. |
| AV-03 | Canales | (a) EMAIL en `true` con el transporte simulado: 200.<br>(b) WHATSAPP en `true`: 409 `CANAL_NO_DISPONIBLE`.<br>(c) Sin `EMAIL_TRANSPORTE`: 409 `CANAL_SIN_CONFIGURAR`. Se borra la variable en la prueba y se repone.<br>(d) `PUSH`: 404.<br>(e) EMAIL en `false` con envíos pendientes de la prueba: quedan `DESCARTADO` con "Canal desactivado". |
| AV-04 | Reglas | (a) Cambiar un modo: 200; se guarda con `actualizado_por_usuario_id`.<br>(b) Tipo, canal o modo inválidos: 400.<br>(c) Una regla de WhatsApp se guarda. |
| AV-05 | Qué genera un envío | Con EMAIL activo y `FALLA_REGISTRADA` en `SOLO_ALTA`, reportando fallas **sin detener** la máquina (una detención también vuelve alta la prioridad):<br>• una falla en la máquina crítica genera envíos;<br>• en la otra, no.<br>En `SIEMPRE`, la otra también genera. En `NUNCA`, ninguna. Con el canal apagado, ninguna. |
| AV-06 | Envío correcto | Un envío de un usuario con email: `ENVIADO`, con `destino` y `enviado_en`. El mensaje simulado tiene `[Urgente]` en el asunto cuando la prioridad es alta, el texto de la notificación, el enlace (con `APP_URL_PUBLICA` definida en la prueba) y la firma. |
| AV-07 | Descartes | Sin email: "Sin email cargado". Usuario inactivo: "Usuario inactivo". Notificación de hace 25 horas (`creada_en` cambiado por SQL en una notificación de la prueba): "Vencido". |
| AV-08 | Reintentos | Con `simularFallaEmail(true)`:<br>• primer intento: sigue `PENDIENTE`, con `intentos` 1, `ultimo_error` y `proximo_intento_en` a 1 minuto (±10 s);<br>• procesar enseguida no lo toca;<br>• llevando `proximo_intento_en` al pasado por SQL cuatro veces más: queda `ERROR` con `intentos` 5. |
| AV-09 | Dos procesos a la vez | Con 6 envíos de la prueba, dos `procesarEnvios({ ids })` simultáneos: cada email sale **una sola vez** (6 mensajes simulados) y los 6 quedan `ENVIADO`. |
| AV-10 | Email de prueba | (a) Quien pide no tiene email: 409 `SIN_EMAIL`.<br>(b) Con email: 200 y un mensaje simulado a esa dirección.<br>(c) Con la falla simulada: 502 `ENVIO_FALLIDO`, sin la contraseña en el `detalle`. |
| AV-11 | Envíos recientes | `GET /envios` trae los de la prueba, con usuario y notificación. `estado=ERROR` filtra. `limit` 0 o 101: 400. |
| AV-12 | Disparador | Sin el encabezado: 403. Con el encabezado no se prueba, porque procesaría envíos ajenos. |
| AV-13 | Contacto | (a) Alta con `Ana@Empresa.COM`: se guarda `ana@empresa.com`.<br>(b) Teléfono válido; `"11 1234-5678"`: 422 `TELEFONO_INVALIDO`; email sin arroba: 422 `EMAIL_INVALIDO`.<br>(c) `""` lo borra.<br>(d) La lista, el detalle y el `/auth/me` del propio usuario los traen.<br>(e) `USUARIO_MODIFICADO` lleva los cuatro campos. |
| AV-14 | Estado final | Los canales y las 16 reglas, como al principio. |

### 9.2 Commits

1. Sección 1: `fix(test): corrida completa sin cuelgues y con canales activos`.
2. Sección 2: `feat(db): migracion 015 de avisos por email`.
3. Secciones 3 a 9.1: `feat(api): avisos por email configurables`.

### 9.3 Criterios de cierre

1. Las secciones 1 a 9 están hechas, en esos tres commits.
2. En verde, en Neon:
   - `test:migration-015`, `test:avisos` y `test:notificaciones`;
   - `test:tiempos` y `test:pendientes`, por la limpieza nueva;
   - `test:usuarios` y `test:administracion`, por los datos de contacto.
3. La verificación de la sección 1.2, con la suite que se cuelga, hecha y **sin subir** esa suite.
4. `npm run typecheck` sin errores.
5. **No correr `test:todo`:** va en la corrida de la noche.
6. Push en `feat/base-neon`.

### 9.4 Informe corto

1. Los tres hashes.
2. La salida final de cada suite de 9.3.
3. La salida de la verificación del corte por tiempo.
4. La versión de `nodemailer` instalada.
5. Las pruebas existentes que se modificaron: solo las de 1.3.
6. Desvíos.
7. Dudas.
