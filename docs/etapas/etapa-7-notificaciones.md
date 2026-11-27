# Etapa 7 — Notificaciones internas

> **Estado:** requerimiento para implementar.
> **Requisito previo:** Etapa 6 cerrada (commit `c5a2cdf` o posterior).
> **Base:** `docs/analisis-intervenciones.md` (sección 8.6, D-10, RN-59, RN-60) y el motor actual. Hoy cada operación del motor junta eventos de dominio y llama a `registrarNotificaciones(client, eventos)` antes del `COMMIT`; esa función está vacía. Esta etapa la completa.

---

## 0. Reglas de trabajo

Las mismas de las etapas anteriores:

1. Rama `feat/base-neon`; nada en `main`.
2. Migraciones y tests **solo** en la rama aislada de Neon.
3. Nada fuera del alcance de la sección 2. Ante ambigüedad o contradicción con el código, **detenerse y preguntar**.
4. SQL visible con `pg`, sin ORM; migraciones idempotentes; tests con `node:test` + `app.request(...)`.
5. Fechas siempre con `NOW()` de PostgreSQL, nunca con `new Date()` de Node.
6. El informe (sección 9) describe **solo lo que está en el código** y declara todo desvío.

---

## 1. Paso previo: documentación

### 1.1 `docs/analisis-intervenciones.md`, sección 11

Agregar:

| ID | Decisión | Resolución |
| :-: | :--- | :--- |
| D-36 | Canales externos (correo, WhatsApp) — comentario del usuario en D-10 | **Aprobada:** en esta versión solo la bandeja interna. El diseño queda listo para otros canales con una **bandeja de salida** (`notificacion_envios`) y una tabla de canales activables (`notificacion_canales`). Con un canal activo, cada notificación genera un envío `PENDIENTE`; un proceso futuro los enviará. Hoy todos los canales están inactivos y nadie envía nada. |
| D-37 | Aviso al responsable anterior | **Aprobada:** al reasignar o quitar el responsable, el responsable anterior recibe un aviso (pierde el trabajo y tiene que enterarse). |
| D-38 | Reglas generales de destinatarios | **Aprobada:** (a) quien hace la acción nunca se notifica a sí mismo; (b) solo usuarios activos; (c) el destinatario debe poder **ver** la intervención con su propio `INTERVENCIONES_VER`, para no revelar su existencia; (d) una sola notificación por persona y evento, aunque cumpla varias condiciones. |
| D-39 | Eventos sin aviso en esta versión | **Aprobada:** iniciar, pasar a espera, reanudar, confirmar recuperación, registrar detención, eliminar y los cambios de estado de la máquina se siguen registrando como eventos, pero no generan notificación. Se pueden agregar después sin tocar el motor (una fila más en la tabla de reglas, sección 4.2). |

### 1.2 Guardar este archivo

Como `docs/etapas/etapa-7-notificaciones.md`.

---

## 2. Alcance

### Incluido

- Migración `008_notificaciones.sql` (sección 3).
- Implementación de `registrarNotificaciones` con una tabla declarativa de reglas (sección 4).
- Función SQL de destinatarios por permiso efectivo (sección 4.4).
- Endpoints de la bandeja (sección 5).
- Ajustes mínimos en los eventos que emite el motor (sección 4.6).
- Dev-ui: campana con contador y lista (sección 6).
- Pruebas (sección 7).

### Excluido

- Envío real por correo, WhatsApp o push (solo la bandeja de salida preparada, D-36).
- Datos de contacto de los usuarios (correo, teléfono): se agregan cuando se implemente un canal.
- Preferencias por usuario ("no quiero recibir X").
- Recordatorios por tiempo y vencimientos de preventivos (sección 8.6 del análisis: hacen falta umbrales).
- Notificaciones en tiempo real (WebSocket); la bandeja se consulta periódicamente.

---

## 3. Migración `database/migrations/008_notificaciones.sql`

Idempotente y en una transacción.

### 3.1 `notificaciones`

| Columna | Tipo | Notas |
| :--- | :--- | :--- |
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PK |
| `usuario_id` | `BIGINT NOT NULL` | FK `usuarios`, el destinatario |
| `tipo_evento` | `VARCHAR(60) NOT NULL` | el evento que la originó (`FALLA_REGISTRADA`, …) |
| `prioridad` | `VARCHAR(10) NOT NULL` | `CHECK IN ('ALTA','NORMAL')` |
| `titulo` | `VARCHAR(200) NOT NULL` | |
| `mensaje` | `TEXT NOT NULL` | |
| `intervencion_id` | `BIGINT` | FK `intervenciones`, `ON DELETE RESTRICT`, nulo permitido |
| `maquina_id` | `BIGINT` | FK `maquinas`, `ON DELETE RESTRICT`, nulo permitido |
| `generada_por_usuario_id` | `BIGINT NOT NULL` | FK `usuarios`, quien hizo la acción |
| `creada_en` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |
| `leida_en` | `TIMESTAMPTZ` | nulo = no leída |

Índices: `(usuario_id, creada_en DESC, id DESC)` y parcial `(usuario_id) WHERE leida_en IS NULL`.
`CHECK (generada_por_usuario_id <> usuario_id)` (nadie se notifica a sí mismo, D-38 a).

### 3.2 `notificacion_canales`

| Columna | Tipo | Notas |
| :--- | :--- | :--- |
| `canal` | `VARCHAR(20) PRIMARY KEY` | `CHECK IN ('EMAIL','WHATSAPP','PUSH')` |
| `activo` | `BOOLEAN NOT NULL DEFAULT FALSE` | |
| `actualizado_en` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |

Carga inicial: las tres filas con `activo = FALSE` (`ON CONFLICT DO NOTHING`).

### 3.3 `notificacion_envios` (bandeja de salida, D-36)

| Columna | Tipo | Notas |
| :--- | :--- | :--- |
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PK |
| `notificacion_id` | `BIGINT NOT NULL` | FK `notificaciones`, `ON DELETE RESTRICT` |
| `canal` | `VARCHAR(20) NOT NULL` | FK `notificacion_canales(canal)` |
| `estado` | `VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'` | `CHECK IN ('PENDIENTE','ENVIADO','ERROR','DESCARTADO')` |
| `intentos` | `INTEGER NOT NULL DEFAULT 0` | `CHECK (intentos >= 0)` |
| `ultimo_error` | `TEXT` | |
| `creado_en` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |
| `enviado_en` | `TIMESTAMPTZ` | |

`UNIQUE (notificacion_id, canal)`. Índice parcial `(canal, creado_en) WHERE estado = 'PENDIENTE'`.

Test `backend/tests/migration_008.test.ts`: las restricciones rechazan prioridad inválida, autonotificación, canal inexistente y envío duplicado; los tres canales existen inactivos.

---

## 4. Generación de notificaciones

Ubicación sugerida: `backend/functions/intervenciones/notificaciones.ts` (reemplaza el cuerpo vacío actual de `registrarNotificaciones` en `auditoria.ts`, que pasa a delegar en este módulo).

### 4.1 Firma

`registrarNotificaciones(client, eventos, { actorId })`. Se agrega `actorId` a **todas** las llamadas existentes (hoy no se pasa). Corre **dentro de la misma transacción** que el evento (RN-59): si falla, falla toda la operación.

### 4.2 Tabla declarativa de reglas

Una constante en TypeScript, del mismo estilo que `TRANSICIONES`. Un evento sin fila no notifica (D-39).

| Evento | Destinatarios | Prioridad | Título |
| :--- | :--- | :--- | :--- |
| `FALLA_REGISTRADA` | Usuarios con `NOTIFICACIONES_FALLAS_RECIBIR` cuyo alcance incluya la intervención | `ALTA` si la intervención tiene un período de detención abierto; si no, `NORMAL` | "Nueva falla en {máquina}" (+ " — máquina detenida" si es ALTA) |
| `INTERVENCION_ASIGNADA` | El nuevo responsable | `NORMAL` | "Te asignaron una intervención en {máquina}" |
| `INTERVENCION_REASIGNADA` | El nuevo responsable; y el anterior (D-37) con otro título | `NORMAL` | nuevo: igual que asignada · anterior: "Te quitaron una intervención en {máquina}" |
| `INTERVENCION_DESASIGNADA` | El responsable anterior (D-37) | `NORMAL` | "Te quitaron una intervención en {máquina}" |
| `INTERVENCION_FINALIZADA` | Creador y responsable | `NORMAL` | "Se finalizó la intervención en {máquina}" |
| `INTERVENCION_CANCELADA` | Creador y responsable | `NORMAL` | "Se canceló la intervención en {máquina}" |
| `INTERVENCION_REABIERTA` | Creador y responsable | `NORMAL` | "Se reabrió la intervención en {máquina}" |
| `DETENCION_PENDIENTE_CONFIRMACION` | Usuarios con `INTERVENCIONES_CONFIRMAR_RECUPERACION` | `ALTA` | "{máquina} sigue detenida: falta confirmar que funciona" |

`mensaje`: una o dos oraciones con el sector, los primeros 120 caracteres de la descripción y, cuando corresponde, el motivo (cancelación, reapertura, reasignación). Textos en castellano, sin emojis.

### 4.3 Reglas generales (D-38)

Después de calcular los candidatos de una regla:

1. Quitar al actor (`actorId`).
2. Quitar a los usuarios inactivos.
3. Quitar a quien **no pueda ver** la intervención según su propio `INTERVENCIONES_VER` y alcance (misma lógica que `puedeVerIntervencion`). Para `PROPIAS`, la asignación vuelve "propia" la intervención, así que el nuevo responsable siempre la ve.
4. Si un mismo usuario resulta destinatario dos veces del mismo evento (por ejemplo, es creador y responsable), crear **una** notificación.
5. Por cada notificación creada, y por cada canal con `activo = TRUE`, insertar un envío `PENDIENTE` en `notificacion_envios` (D-36).

### 4.4 Destinatarios por permiso efectivo, en SQL

Para "usuarios con el permiso X" no se puede llamar a `resolverPermisosEfectivos` usuario por usuario (sería una consulta por usuario de la empresa). Crear `usuariosConPermiso(client, codigo)`: **una** consulta que devuelve `{ usuario_id, alcance, sectores[] }` de los usuarios **activos** que tienen el permiso **efectivo**, con la misma regla que el middleware:

- lo tiene por perfil y no tiene una excepción `DENEGAR` de ese permiso, **o**
- tiene una excepción `CONCEDER` de ese permiso;
- el alcance es el de la excepción `CONCEDER` si existe; si no, el del perfil.

Filtro de alcance para `NOTIFICACIONES_FALLAS_RECIBIR` sobre una intervención: `TODAS` → sí; `SECTORES` → si el sector de la máquina está en sus sectores; `PROPIAS` → solo si es creador o responsable.

Un test compara esta función con `resolverPermisosEfectivos` para usuarios con perfil, con `CONCEDER`, con `DENEGAR` e inactivos (N-14).

### 4.5 Datos de la intervención

Para armar destinatarios y textos, `registrarNotificaciones` lee en la misma transacción (con el `client` recibido) la intervención y su máquina: creador, responsable, sector, nombre y código de máquina, descripción y si tiene período abierto. No vuelve a bloquear filas: el llamador ya tiene la máquina y la intervención bloqueadas.

### 4.6 Ajustes en los eventos del motor

- `INTERVENCION_REASIGNADA`: agregar `responsableAnteriorId` al `payload`.
- `INTERVENCION_CANCELADA` e `INTERVENCION_REABIERTA`: agregar `motivo` al `payload`.
- Verificar que **todos** los eventos de la tabla 4.2 lleven `intervencionId`.
- No cambiar ningún otro comportamiento del motor.

---

## 5. Bandeja — `/api/notificaciones`

Requiere solo autenticación: cada usuario ve **únicamente las suyas**. Nadie puede leer ni marcar las de otro (la de otro responde 404).

| Método y ruta | Qué hace |
| :--- | :--- |
| `GET /api/notificaciones?solo_no_leidas=true&limite=50&antes_de=<id>` | Lista las propias, más nuevas primero (`creada_en DESC, id DESC`). `limite` de 1 a 100, por defecto 50. `antes_de` = paginado: las de `id` menor. Cada una con `id`, `tipo_evento`, `prioridad`, `titulo`, `mensaje`, `intervencion_id`, `maquina_id`, `creada_en`, `leida` (bool), `leida_en`. |
| `GET /api/notificaciones/contador` | `{ "no_leidas": n, "no_leidas_alta": m }`. Pensado para consultarse cada 30 s; debe ser **una** consulta liviana sobre el índice parcial. |
| `POST /api/notificaciones/:id/leer` | Marca como leída (`leida_en = NOW()`). Si ya estaba leída, 200 sin cambios. De otro usuario o inexistente → 404. |
| `POST /api/notificaciones/leer-todas` | Marca todas las propias no leídas. Devuelve `{ "marcadas": n }`. |

Validaciones con el formato de error de siempre (`{ error, codigo }`, `422 DATOS_INVALIDOS` para parámetros inválidos).

Una notificación de una intervención que después se eliminó lógicamente sigue en la bandeja; al abrirla, el detalle responde 404 como cualquier eliminada.

---

## 6. Dev-ui (mínimo, provisional)

- Campana en el encabezado con el contador (destacar si hay de prioridad ALTA). Consulta `/contador` cada 30 s mientras la pestaña está visible.
- Al hacer clic: lista de las últimas 50, las no leídas resaltadas, botón "Marcar todas como leídas".
- Clic en una notificación: la marca como leída y abre el detalle de la intervención.

---

## 7. Pruebas de aceptación

Archivo `backend/tests/notificaciones.test.ts`, script `test:notificaciones`. Mismas reglas de siempre: resultados escritos a mano, y verificación de las filas de `notificaciones` (destinatario, tipo, prioridad) además del HTTP.

Usuarios de prueba: operario O (crea fallas), responsables R1 y R2, administrador A, usuario de consulta C, y un responsable R3 con `INTERVENCIONES_VER` y `NOTIFICACIONES_FALLAS_RECIBIR` con alcance `SECTORES` (solo el sector 1).

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| N-01 | O registra una falla **con** detención en el sector 1 | R1, R2, A y R3 reciben `FALLA_REGISTRADA` `ALTA`. O y C no reciben nada. |
| N-02 | O registra una falla **sin** detención | Los mismos destinatarios, prioridad `NORMAL`. |
| N-03 | Falla en una máquina del sector 2 | R3 no recibe nada; R1, R2 y A sí. |
| N-04 | R1 con `NOTIFICACIONES_FALLAS_RECIBIR` denegado por excepción; O con ese permiso concedido con alcance `SECTORES` (sector 1); R2 desactivado | R1 no recibe; O recibe solo de las fallas del sector 1 que no creó él; R2 no recibe. |
| N-05 | A asigna a R1 | R1 recibe `INTERVENCION_ASIGNADA`; A no. R1 se asigna solo (tomar o iniciar sin responsable): nadie recibe nada. |
| N-06 | A reasigna de R1 a R2, con motivo | R2 recibe la de asignación y R1 la de "te quitaron" (D-37), ambas con el motivo en el mensaje. |
| N-07 | A quita el responsable R1 (en `PENDIENTE`) | R1 recibe "te quitaron". |
| N-08 | R1 finaliza su intervención creada por O, con recuperación | O recibe `INTERVENCION_FINALIZADA`; R1 no. Ninguna `DETENCION_PENDIENTE_CONFIRMACION`. |
| N-09 | R1 finaliza **sin** recuperación (período abierto) | O recibe `INTERVENCION_FINALIZADA` `NORMAL`; R2 y A reciben `DETENCION_PENDIENTE_CONFIRMACION` `ALTA`; R1 no recibe ninguna. Un usuario con `CONFIRMAR_RECUPERACION` cuyo `VER` no alcanza esa máquina no recibe (D-38 c). |
| N-10 | Cancelar y reabrir | Creador y responsable reciben, salvo el actor, con el motivo en el mensaje. |
| N-11 | Creador = responsable (R1 crea la falla y la toma), y A la cancela | R1 recibe **una** notificación, no dos. |
| N-12 | Iniciar, pasar a espera, reanudar, confirmar recuperación, registrar detención, eliminar | Ninguna notificación (D-39). |
| N-13 | **Atomicidad**: trigger temporal que falla al insertar en `notificaciones` durante el alta de una falla | 500. No existe la intervención, ni su historial, ni su período, y la máquina no cambió. Además: una operación rechazada por validación (por ejemplo, finalizar sin trabajo realizado) no deja notificaciones. |
| N-14 | `usuariosConPermiso` contra `resolverPermisosEfectivos` | Mismo resultado para perfil, `CONCEDER` (con su alcance), `DENEGAR` e inactivo. |
| N-15 | Bandeja: listar, contador, leer, leer-todas, paginado con `antes_de` | Solo aparecen las propias; leer una ajena → 404; leer una ya leída → 200 sin cambios; el contador baja; `leer-todas` devuelve la cantidad correcta; el paginado no repite ni saltea. |
| N-16 | Canales: activar `EMAIL` por SQL y registrar una falla | Un envío `PENDIENTE` por cada notificación creada, canal `EMAIL`. Con todos inactivos, ningún envío. |
| N-17 | Regresión: todas las suites anteriores + `test:migration-008` + `test:notificaciones` + typecheck | Todo verde. Listar cualquier test anterior modificado y por qué. |

---

## 8. Criterios de cierre

1. Migración 008 aplicada **solo** en la rama de pruebas y su test pasa.
2. N-01 a N-17 pasan.
3. Documentación de la sección 1 actualizada.
4. Commit y push en `feat/base-neon`.

---

## 9. Informe a entregar

1. Archivos creados y modificados.
2. Salida completa de **todas** las suites y del typecheck.
3. Tests anteriores modificados y motivo.
4. **Todos** los desvíos, incluidos cambios no pedidos.
5. Dudas o decisiones abiertas.
