# Etapa U — Usuarios, perfiles y contraseñas

> **Estado:** requerimiento para implementar.
> **Requisito previo:** Etapa 7.1 cerrada.
> **Por qué ahora:** hoy no existe ningún endpoint para crear usuarios ni asignarles perfil y sectores; solo existe el login. Sin esto no se puede usar el sistema con personas reales. Es la parte básica de la Etapa 11 del plan original; la administración completa de permisos (excepciones por usuario, edición de perfiles) sigue postergada.

---

## 0. Reglas de trabajo

Las mismas de las etapas anteriores:

1. Rama `feat/base-neon`; nada en `main`.
2. Migraciones y tests **solo** en la rama aislada de Neon.
3. Nada fuera del alcance de la sección 2. Ante ambigüedad o contradicción con el código, **detenerse y preguntar**.
4. SQL visible con `pg`, sin ORM; migraciones idempotentes; tests con `node:test` + `app.request(...)`.
5. Fechas con `NOW()` de PostgreSQL. Contraseñas siempre con `bcryptjs` (como hoy), nunca en texto plano ni en logs ni en respuestas.
6. Formato de error `{ error, codigo }` en todos los endpoints nuevos y modificados.
7. El informe (sección 9) describe **solo lo que está en el código** y declara todo desvío.

---

## 1. Paso previo: documentación

### 1.1 `docs/decisiones.md`

Agregar:

> **D-008 — Orden de etapas hasta la entrega**
> **Estado:** Aceptada
> El plan original (sección 12 del análisis de intervenciones) cubría solo ese módulo. Para llegar a un sistema usable se reordena lo que falta: 7 Notificaciones → U Usuarios y perfiles → 8 Tiempos e inactividad → Repuestos y stock (incluye la ex Etapa 12) → 9 Costos → Preventivos básicos → Reportes de la tesis. El frontend definitivo avanza en paralelo desde la Etapa 8. Se postergan: Etapa 10 (correcciones de finalizadas), administración completa de permisos (resto de la Etapa 11) y documentos adjuntos.
> **Motivo:** priorizar lo que el sistema necesita para funcionar de punta a punta y para la defensa.

### 1.2 `docs/analisis-intervenciones.md`, sección 11

Completar la fila **D-17** con la resolución y agregar:

| ID | Decisión | Resolución |
| :-: | :--- | :--- |
| D-17 | Perfiles de I+D y Dirección | **Aprobada:** se crean los perfiles `I_D` y `DIRECCION` con permisos por defecto modificables (D-40). Los perfiles existentes se mantienen. El formulario del operario sigue creando solo `CORRECTIVO`. |
| D-40 | Permisos por defecto de los perfiles nuevos | **Aprobada:** `I_D` arranca con los mismos permisos que `RESPONSABLE_MANTENIMIENTO` (coordina reparaciones, proceso 3.2). `DIRECCION` arranca con los de `CONSULTA` más `NOTIFICACIONES_FALLAS_RECIBIR` con alcance `TODAS`. Ambos se ajustan después según cómo trabaje GI-RE. |
| D-41 | Contraseña inicial | **Aprobada:** el administrador define una contraseña **temporal**; el usuario debe cambiarla en su primer ingreso. Mientras no la cambie, solo puede consultar sus datos y cambiar la contraseña. |
| D-42 | Quién administra usuarios | **Aprobada:** solo quien tenga `USUARIOS_GESTIONAR` (por defecto, el administrador). Nadie se modifica a sí mismo (perfil, sectores, estado); nadie asigna un perfil con permisos que él no tiene; siempre queda al menos un administrador activo. |
| D-43 | Cambio de contraseña propio | **Aprobada:** cada usuario cambia su contraseña indicando la actual. Si la olvida, el administrador le asigna una temporal nueva. Al cambiar o restablecer una contraseña, las sesiones anteriores de ese usuario dejan de valer. |

### 1.3 Guardar este archivo

Como `docs/etapas/etapa-u-usuarios.md`.

---

## 2. Alcance

### Incluido

- Migración `009_usuarios.sql` (sección 3).
- Cambios en login, nuevo `GET /api/auth/me` y cambio de contraseña (sección 4).
- Cambios en el middleware: contraseña temporal y sesiones invalidadas (sección 4.4).
- ABM de usuarios y consulta de perfiles (sección 5).
- Protecciones contra auto-otorgamiento y pérdida del último administrador (sección 5.3).
- Auditoría de la gestión de usuarios en `auditoria_permisos` (sección 5.4).
- Dev-ui mínima (sección 6).
- Pruebas (sección 7).

### Excluido

- Alta, baja o edición de excepciones por usuario (`usuario_permiso`) y edición de los permisos de un perfil → administración completa de permisos, postergada.
- Recuperación de contraseña por correo.
- Bloqueo por intentos fallidos o límite de pedidos.
- Borrado físico de usuarios (nunca: se desactivan).

---

## 3. Migración `database/migrations/009_usuarios.sql`

Idempotente y en una transacción.

1. `usuarios.debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE`.
2. `usuarios.password_actualizado_en TIMESTAMPTZ` (nulo = nunca se cambió desde que existe esta columna).
3. Perfiles nuevos (`ON CONFLICT (nombre) DO NOTHING`):
   - `I_D` — "I+D: coordina y gestiona intervenciones".
   - `DIRECCION` — "Dirección: consulta, reportes y avisos de fallas".
4. Permisos por defecto (D-40), con `INSERT ... SELECT ... ON CONFLICT DO NOTHING` para no pisar cambios del administrador:
   - `I_D`: copiar **todas** las filas de `perfil_permiso` de `RESPONSABLE_MANTENIMIENTO`, con su alcance.
   - `DIRECCION`: copiar las de `CONSULTA` y agregar `NOTIFICACIONES_FALLAS_RECIBIR` con alcance `TODAS`.
5. `CHECK` en `auditoria_permisos.accion` con los valores de la sección 5.4 (verificar antes que no haya filas con otros valores; si las hay, la migración falla y se informa).

Test `backend/tests/migration_009.test.ts`: columnas nuevas, perfiles nuevos con los permisos esperados (comparando contra los perfiles de origen), y que la migración se puede correr dos veces.

---

## 4. Autenticación

### 4.1 `POST /api/auth/login` (cambios)

- Los permisos de la respuesta pasan a ser los **efectivos**: usar `resolverPermisosEfectivos` (perfil + excepciones), con el alcance de cada uno y los sectores del usuario. Hoy se calculan solo con el perfil.
- El JWT lleva solo `sub`, `legajo`, `iat` y `exp` (24 h, como hoy). Se quitan `perfil` y `permisos` del token: el middleware ya no los usa y podían quedar desactualizados.
- La respuesta agrega `debe_cambiar_password` (boolean).
- Un usuario cuyo perfil está inactivo no puede ingresar: 401, igual que credenciales inválidas.
- Errores con `{ error, codigo }`: `400 DATOS_INVALIDOS` si faltan legajo o contraseña; `401 CREDENCIALES_INVALIDAS` en cualquier otro caso (sin decir si el legajo existe).

### 4.2 `GET /api/auth/me`

Usuario autenticado. Devuelve `id`, `legajo`, `nombre`, `apellido`, `perfil` (id y nombre), `sectores` (id y nombre), `permisos` efectivos con alcance y `debe_cambiar_password`. Es lo que usará el frontend para decidir qué mostrar.

### 4.3 `POST /api/auth/cambiar-password`

Body: `{ "password_actual": "...", "password_nueva": "..." }`.

- `password_actual` incorrecta → `401 CREDENCIALES_INVALIDAS`.
- Política mínima de `password_nueva`: al menos 8 caracteres, distinta del legajo y distinta de la actual → si no, `422 PASSWORD_INVALIDA` (el mensaje dice qué regla falló).
- Guarda el hash nuevo, `debe_cambiar_password = FALSE`, `password_actualizado_en = NOW()`.
- Auditoría `PASSWORD_CAMBIADA` (sin la contraseña).
- Responde un **token nuevo**: el que usó para el pedido deja de valer (4.4).

### 4.4 Middleware (`dbVerify`)

`resolverPermisosEfectivos` agrega a su resultado `debe_cambiar_password` y `password_actualizado_en`. Con eso, el middleware:

1. **Sesión invalidada:** si el token tiene `iat` anterior a `password_actualizado_en` → `401 SESION_INVALIDADA`.
2. **Contraseña temporal:** si `debe_cambiar_password` es `TRUE`, solo se permiten `GET /api/auth/me` y `POST /api/auth/cambiar-password`; cualquier otro endpoint → `403 CAMBIO_PASSWORD_REQUERIDO`.

El resto del middleware no cambia. `test:permisos` debe seguir verde sin modificaciones.

---

## 5. Usuarios y perfiles

Todos requieren `USUARIOS_GESTIONAR`, salvo que se diga otra cosa.

### 5.1 Endpoints

| Método y ruta | Qué hace |
| :--- | :--- |
| `GET /api/perfiles` | Lista los perfiles activos con sus permisos y alcances (solo lectura), para el selector. |
| `GET /api/usuarios?activo=true&perfil_id=&texto=` | Lista con `id`, `legajo`, `nombre`, `apellido`, perfil, sectores, `activo`, `ultimo_acceso_en`, `debe_cambiar_password`. `texto` busca en legajo, nombre y apellido sin distinguir mayúsculas. Orden: apellido, nombre. |
| `GET /api/usuarios/:id` | Lo anterior + permisos efectivos (con alcance) + las excepciones por usuario existentes (solo lectura) + cantidad de intervenciones abiertas de las que es responsable. |
| `POST /api/usuarios` | Alta. Body: `legajo`, `nombre`, `apellido?`, `perfil_id`, `sectores` (array de ids, puede ser vacío), `password_temporal`. Queda `activo = TRUE` y `debe_cambiar_password = TRUE` (D-41). |
| `PATCH /api/usuarios/:id` | Modifica `nombre`, `apellido`, `perfil_id` y/o `sectores` (reemplaza la lista completa). El `legajo` **no** se modifica: es el identificador. |
| `POST /api/usuarios/:id/desactivar` | Body `{ motivo }`. `activo = FALSE`. |
| `POST /api/usuarios/:id/reactivar` | Body `{ motivo }`. `activo = TRUE`. |
| `POST /api/usuarios/:id/restablecer-password` | Body `{ password_temporal }`. Guarda el hash, `debe_cambiar_password = TRUE`, `password_actualizado_en = NOW()` (sus sesiones abiertas dejan de valer). |

### 5.2 Validaciones

- `legajo`: obligatorio, 1 a 40 caracteres, sin espacios al inicio ni al final; repetido → `409 LEGAJO_DUPLICADO`.
- `nombre`: 1 a 100. `apellido`: hasta 100.
- `perfil_id`: debe existir y estar activo → si no, `422 DATOS_INVALIDOS`.
- `sectores`: cada id debe existir y estar activo; sin repetidos → si no, `422 DATOS_INVALIDOS`.
- `password_temporal`: misma política que 4.3 (8 caracteres, distinta del legajo) → `422 PASSWORD_INVALIDA`.
- `motivo` en desactivar/reactivar: obligatorio, mínimo 5 → `422 MOTIVO_REQUERIDO`.
- Desactivar un inactivo o reactivar un activo → `422 SIN_CAMBIOS`. `PATCH` sin cambios reales → `422 SIN_CAMBIOS`.
- Usuario inexistente → 404.

### 5.3 Protecciones (D-42, RN-57, sección 8.5 del análisis)

Se verifican en el servidor, dentro de una transacción, bloqueando la fila del usuario afectado:

1. **Nadie se modifica a sí mismo** con estos endpoints: `PATCH`, desactivar, reactivar y restablecer sobre el propio id → `403 AUTOGESTION_NO_PERMITIDA`. (Su contraseña la cambia con 4.3.)
2. **Nadie asigna un perfil con permisos que no tiene:** al crear o cambiar el perfil, cada permiso del perfil destino debe estar entre los permisos efectivos de quien hace el cambio, con un alcance igual o mayor (PROPIAS < SECTORES < TODAS) → si no, `403 PERFIL_NO_ASIGNABLE`.
3. **Siempre queda un administrador activo:** desactivar a un usuario con perfil `ADMINISTRADOR`, o cambiarle el perfil, cuando es el único administrador activo → `409 ULTIMO_ADMINISTRADOR`. Para que dos operaciones simultáneas no lo dejen en cero, el conteo se hace con los usuarios administradores bloqueados (`FOR UPDATE`).
4. **Desactivar a un responsable con trabajo abierto** está permitido (D-32 cubre ese caso), pero la respuesta informa `intervenciones_abiertas_como_responsable: n` para que la pantalla sugiera reasignarlas.

### 5.4 Auditoría

Cada operación inserta una fila en `auditoria_permisos` (que hoy no se usa) en la misma transacción: `realizado_por_usuario_id`, `sobre_usuario_id`, `accion` y `detalle` en JSON con los valores anterior y nuevo (nunca contraseñas ni hashes).

Acciones: `USUARIO_CREADO`, `USUARIO_MODIFICADO`, `PERFIL_CAMBIADO`, `SECTORES_CAMBIADOS`, `USUARIO_DESACTIVADO`, `USUARIO_REACTIVADO`, `PASSWORD_RESTABLECIDA`, `PASSWORD_CAMBIADA`.

Un `PATCH` que cambia el perfil y los sectores deja una fila por cada acción.

---

## 6. Dev-ui (mínimo, provisional)

- Si el login responde `debe_cambiar_password: true`, mostrar solo la pantalla "Cambiar contraseña" hasta que se cambie.
- Opción "Cambiar mi contraseña" en el encabezado.
- Pestaña **Usuarios** (visible si `/api/auth/me` incluye `USUARIOS_GESTIONAR`): listado con búsqueda, alta, edición de nombre/perfil/sectores, desactivar/reactivar con motivo, restablecer contraseña. Al desactivar, si la respuesta informa intervenciones abiertas, mostrar el aviso.
- Tomar los permisos para mostrar u ocultar botones de `/api/auth/me` (los efectivos), no del login viejo.

---

## 7. Pruebas de aceptación

Archivo `backend/tests/usuarios.test.ts`, script `test:usuarios`. Mismas reglas de siempre.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| U-01 | Admin crea un operario con dos sectores | 201. `debe_cambiar_password = TRUE`, hash guardado (nunca el texto), sectores en `usuario_sector`, auditoría `USUARIO_CREADO` sin la contraseña. |
| U-02 | Legajo repetido; perfil inexistente; sector inactivo; contraseña de 5 caracteres o igual al legajo | 409 `LEGAJO_DUPLICADO`; 422 `DATOS_INVALIDOS` (dos casos); 422 `PASSWORD_INVALIDA`. |
| U-03 | El operario nuevo ingresa | Login 200 con `debe_cambiar_password: true`. `GET /api/intervenciones` → 403 `CAMBIO_PASSWORD_REQUERIDO`. `GET /api/auth/me` → 200. |
| U-04 | Cambia su contraseña: (a) actual incorrecta, (b) nueva de 6 caracteres, (c) nueva igual a la actual, (d) válida | (a) 401; (b) y (c) 422 `PASSWORD_INVALIDA`; (d) 200 con token nuevo, el flag queda en FALSE, y con el token **viejo** cualquier pedido → 401 `SESION_INVALIDADA`. Con el nuevo, `GET /api/intervenciones` → 200. |
| U-05 | Permisos efectivos en login y `/me` | Un usuario con una excepción `CONCEDER` y otra `DENEGAR` ve exactamente sus permisos efectivos (igual que `resolverPermisosEfectivos`), con alcance y sectores. El JWT ya no trae `permisos` ni `perfil`. |
| U-06 | `PATCH`: cambiar perfil y sectores | 200. Dos filas de auditoría (`PERFIL_CAMBIADO`, `SECTORES_CAMBIADOS`) con anterior y nuevo. Desde el pedido siguiente, el middleware aplica los permisos del perfil nuevo. Enviar `legajo` → 422 `DATOS_INVALIDOS`. |
| U-07 | Admin intenta modificarse, desactivarse o restablecerse a sí mismo | 403 `AUTOGESTION_NO_PERMITIDA` en los tres. |
| U-08 | Un responsable con `USUARIOS_GESTIONAR` concedido por excepción intenta crear un usuario `ADMINISTRADOR`, y otro `OPERARIO` | 403 `PERFIL_NO_ASIGNABLE`; 201. |
| U-09 | Único administrador activo: un segundo usuario con `USUARIOS_GESTIONAR` intenta desactivarlo o cambiarle el perfil | 409 `ULTIMO_ADMINISTRADOR`. Con dos administradores, desactivar uno → 200. |
| U-10 | **Concurrencia:** dos administradores, A1 y A2, se desactivan mutuamente a la vez (`Promise.all`) | Exactamente uno 200 y otro 409 `ULTIMO_ADMINISTRADOR`; queda un administrador activo. |
| U-11 | Desactivar a un responsable con 2 intervenciones abiertas | 200 con `intervenciones_abiertas_como_responsable: 2`. Ese usuario ya no puede ingresar (401) y un pedido con su token anterior → 401. |
| U-12 | Reactivar; reactivar un activo; desactivar sin motivo | 200; 422 `SIN_CAMBIOS`; 422 `MOTIVO_REQUERIDO`. |
| U-13 | Restablecer contraseña | 200. El usuario no entra con la vieja; entra con la temporal y queda obligado a cambiarla; su token anterior → 401 `SESION_INVALIDADA`. |
| U-14 | Sin `USUARIOS_GESTIONAR` (responsable, operario) en cada endpoint de la sección 5 | 403. |
| U-15 | `GET /api/usuarios` con `texto`, `activo` y `perfil_id`; `GET /api/usuarios/:id` | Filtros correctos; el detalle trae permisos efectivos, excepciones y la cantidad de intervenciones abiertas; **ninguna** respuesta incluye `password_hash`. |
| U-16 | Perfiles `I_D` y `DIRECCION` | Un usuario `I_D` puede tomar e iniciar una intervención; uno `DIRECCION` la ve y recibe el aviso de una falla nueva, pero no puede iniciarla (403). |
| U-17 | Fallo forzado (trigger) al insertar la auditoría de un alta | 500; el usuario no existe y no hay filas en `usuario_sector`. |
| U-18 | Regresión: todas las suites + `test:migration-009` + `test:usuarios` + typecheck | Todo verde. Listar cualquier test anterior modificado y por qué. |

---

## 8. Criterios de cierre

1. Migración 009 aplicada **solo** en la rama de pruebas y su test pasa.
2. U-01 a U-18 pasan.
3. Documentación de la sección 1 actualizada.
4. Commit y push en `feat/base-neon`.

---

## 9. Informe a entregar

1. Archivos creados y modificados.
2. Salida completa de **todas** las suites y del typecheck.
3. Tests anteriores modificados y motivo.
4. **Todos** los desvíos, incluidos cambios no pedidos.
5. Dudas o decisiones abiertas.
