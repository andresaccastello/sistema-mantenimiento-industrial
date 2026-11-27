# Etapa API-05 — Excepciones de permisos por usuario

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `8185879` (Etapa F3b.1).
> **Base:**
>
> - `docs/analisis-intervenciones.md`, secciones 8.2 (capas de permisos) y 8.5 (protecciones contra el auto-otorgamiento);
> - mapa de pantallas, API-05;
> - la tabla `usuario_permiso`, que ya existe y ya se aplica en `resolverPermisosEfectivos`.
>
> **Para qué:** hoy las excepciones se leen en `GET /api/usuarios/:id`, pero no se pueden crear, cambiar ni quitar. Es la base de la pantalla A2 de la F4. Responde a un hallazgo del relevamiento: "una persona cumple varios roles".

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias.
2. **Dos commits:**
   1. la migración 014 y su prueba (sección 1);
   2. la API, sus pruebas y la documentación (secciones 2 a 6).
3. Solo backend. El frontend no cambia: la pantalla es de la F4.
4. **Pruebas:**
   - solo contra la rama de pruebas de Neon;
   - no borran ni modifican datos que no crearon;
   - mientras se desarrolla y en el corte del primer commit, se corren solo las de la etapa (`test:migration-014` y `test:excepciones`);
   - `test:todo` completo, **una sola vez**, al cierre.
5. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-api-05-excepciones.md`.

---

## 1. Migración `014_excepciones_permisos.sql` (primer commit)

Idempotente, como las anteriores.

1. **`permisos.usa_alcance`**, `BOOLEAN NOT NULL DEFAULT FALSE`.
   - Va en `TRUE` en los cinco permisos cuyo alcance el sistema usa hoy: `INTERVENCIONES_VER`, `INTERVENCIONES_CREAR`, `INTERVENCIONES_EDITAR`, `REPORTES_CONSULTAR` y `NOTIFICACIONES_FALLAS_RECIBIR`.
   - Los revisé en el código: son los únicos que se consultan con `PROPIAS` o `SECTORES`.
   - Es una propiedad del sistema, no algo que cada empresa configure.
2. **`ck_auditoria_permisos_accion`:** se reemplaza para aceptar, además de las acciones actuales, `EXCEPCION_CREADA`, `EXCEPCION_MODIFICADA` y `EXCEPCION_ELIMINADA`.
   - `DROP CONSTRAINT IF EXISTS` y `ADD CONSTRAINT`, con la lista completa.

**Prueba `backend/tests/migration_014.test.ts`** (script `test:migration-014`):

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| M14-01 | Aplicar la migración | Sin errores. |
| M14-02 | Aplicarla otra vez | Sin errores. |
| M14-03 | `usa_alcance` | `TRUE` exactamente en los cinco permisos de arriba. |
| M14-04 | Restricción de la auditoría, dentro de una transacción con `ROLLBACK` | Acepta las tres acciones nuevas y sigue rechazando una inexistente. |

**Cierre del primer commit:** `npm run test:migration-014` en verde. Mensaje: `feat(db): migración 014, excepciones de permisos`.

---

## 2. Catálogo de permisos: `GET /api/permisos`

- Con `USUARIOS_GESTIONAR`, igual que `/api/usuarios` y `/api/perfiles`.
- Devuelve `[{ id, codigo, nombre, descripcion, usa_alcance }]`, ordenado por `codigo`.

Lo va a usar la pantalla de la F4 para elegir qué permiso conceder o denegar.

---

## 3. Crear, cambiar y quitar una excepción

### 3.1 Rutas

| Ruta | Para qué |
| :--- | :--- |
| `PUT /api/usuarios/:id/excepciones/:codigo` | Crea la excepción de ese permiso o la reemplaza si ya existe. |
| `DELETE /api/usuarios/:id/excepciones/:codigo` | La quita. El usuario vuelve a tener lo que da su perfil. |

`:codigo` es el código del permiso, por ejemplo `INTERVENCIONES_VER`.

**Cuerpo del `PUT`:**

```json
{ "efecto": "CONCEDER", "alcance": "SECTORES", "motivo": "Cubre el turno noche en Pintura" }
```

**Cuerpo del `DELETE`:** `{ "motivo": "…" }`.

**Respuesta de las dos:** 200 con el mismo objeto que `GET /api/usuarios/:id`, ya actualizado: permisos efectivos y excepciones. Armar ese objeto con una sola función, compartida por las tres rutas.

### 3.2 Validaciones

Se controlan en este orden.

| # | Regla | Respuesta |
| :-: | :--- | :--- |
| 1 | Quien hace el cambio necesita `PERMISOS_GESTIONAR`, además de `USUARIOS_GESTIONAR`, que ya pide el router. | 403 `PERMISO_INSUFICIENTE` |
| 2 | `:id` inválido. | 400 `DATOS_INVALIDOS` |
| 3 | El usuario no existe. | 404 `USUARIO_NO_ENCONTRADO` |
| 4 | Es el propio usuario: nadie cambia sus propias excepciones (8.5). | 403 `AUTOGESTION_NO_PERMITIDA` |
| 5 | El permiso no existe. | 404 `PERMISO_NO_ENCONTRADO` |
| 6 | `motivo` falta o tiene menos de 5 caracteres, sin contar los espacios de los extremos. | 422 `MOTIVO_REQUERIDO` |
| 7 | Solo en el `PUT`: `efecto` no es `CONCEDER` ni `DENEGAR`. | 400 `DATOS_INVALIDOS` |
| 8 | Solo en el `PUT`, el alcance:<br>• `CONCEDER` de un permiso con `usa_alcance`: `alcance` es obligatorio y tiene que ser `PROPIAS`, `SECTORES` o `TODAS`;<br>• `CONCEDER` de un permiso sin alcance: `alcance` puede no venir, o venir `TODAS`; se guarda `TODAS`;<br>• `DENEGAR`: `alcance` no puede venir. | 400 `DATOS_INVALIDOS` |
| 9 | Nadie toca un permiso que no tiene (8.5):<br>• quien hace el cambio tiene que tener ese permiso entre sus permisos efectivos;<br>• para `CONCEDER`, con un alcance igual o mayor que el que concede (`PROPIAS` < `SECTORES` < `TODAS`).<br>Se aplica también a `DENEGAR` y a `DELETE`, así nadie recorta lo que no podría dar. Usar la misma jerarquía de alcances que `validarAsignacionPerfil`. | 403 `PERMISO_NO_OTORGABLE` |
| 10 | `PUT` con el mismo `efecto` y `alcance` que la excepción que ya tiene. | 422 `SIN_CAMBIOS` |
| 11 | `DELETE` de una excepción que no existe. | 404 `EXCEPCION_NO_ENCONTRADA` |

**Último administrador.** No hace falta controlarlo:

- quien hace el cambio tiene `USUARIOS_GESTIONAR` y `PERMISOS_GESTIONAR`;
- no puede cambiarse a sí mismo (regla 4);
- así que siempre queda al menos un usuario activo con los dos permisos.

Dejar esa explicación en un comentario en el código.

### 3.3 Qué se guarda

Todo en una transacción:

1. **`usuario_permiso`:** `INSERT … ON CONFLICT (usuario_id, permiso_id) DO UPDATE`, con:
   - `efecto`, `alcance` y `motivo`;
   - `otorgado_por_usuario_id` = quien hace el cambio;
   - `creado_en = NOW()`.

   El `DELETE` borra la fila.
2. **`auditoria_permisos`:**
   - `realizado_por_usuario_id` = quien hace el cambio;
   - `sobre_usuario_id` = el usuario;
   - `accion`: `EXCEPCION_CREADA`, `EXCEPCION_MODIFICADA` o `EXCEPCION_ELIMINADA`;
   - `detalle`: JSON con `codigo`, `efecto`, `alcance` y `motivo`. En la modificación y la eliminación, también `anterior: { efecto, alcance, motivo }`.

**La sesión no se invalida.** `dbVerify` resuelve los permisos en cada pedido, así que el cambio vale desde el siguiente pedido del usuario, sin volver a entrar.

---

## 4. `GET /api/usuarios/:id`

Cada elemento de `excepciones` suma:

- `otorgado_por: { id, nombre, apellido }`;
- `usa_alcance`.

La pantalla de la F4 va a mostrar quién dio cada excepción y cuándo. Lo demás no cambia.

---

## 5. Pruebas: `backend/tests/excepciones.test.ts`

Script `test:excepciones`. Crea sus propios usuarios y borra todo por sus ids, incluidas sus filas de `auditoria_permisos`.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| EX-01 | `GET /api/permisos` | 200 con todos los permisos y `usa_alcance` en los cinco de la sección 1. Con un operario: 403. |
| EX-02 | Conceder `INTERVENCIONES_VER` con `SECTORES` a un operario de la prueba | 200. La respuesta trae `permisos.INTERVENCIONES_VER = 'SECTORES'` y la excepción con `otorgado_por`. Hay un registro `EXCEPCION_CREADA` con el `detalle` de 3.3. Con el token que el operario sacó **antes** del cambio, `GET /api/auth/me` ya muestra el permiso nuevo. |
| EX-03 | Cambiarla a `TODAS` | `EXCEPCION_MODIFICADA`, con `anterior.alcance = 'SECTORES'`. El mismo cuerpo otra vez: 422 `SIN_CAMBIOS`. |
| EX-04 | Denegar `INTERVENCIONES_CREAR` a un responsable de la prueba | El permiso desaparece de los efectivos. `POST /api/intervenciones` con ese responsable: 403. |
| EX-05 | Quitar una excepción | Vuelve el permiso del perfil. Registro `EXCEPCION_ELIMINADA` con `anterior`. Quitarla de nuevo: 404 `EXCEPCION_NO_ENCONTRADA`. Sin motivo: 422 `MOTIVO_REQUERIDO`. |
| EX-06 | Validaciones | (a) Código inexistente: 404 `PERMISO_NO_ENCONTRADO`.<br>(b) `efecto: 'OTRO'`: 400.<br>(c) Conceder `INTERVENCIONES_VER` sin alcance: 400.<br>(d) Denegar con alcance: 400.<br>(e) Conceder `MAQUINAS_GESTIONAR` con `SECTORES`: 400; sin alcance: 200, guardado con `TODAS`.<br>(f) Motivo de 3 letras: 422.<br>(g) Usuario inexistente: 404 `USUARIO_NO_ENCONTRADO`. |
| EX-07 | Sin `PERMISOS_GESTIONAR`: un responsable de la prueba con `USUARIOS_GESTIONAR` concedido por SQL | 403 `PERMISO_INSUFICIENTE`, en el `PUT` y en el `DELETE`. |
| EX-08 | `ADMIN001` sobre sí mismo | 403 `AUTOGESTION_NO_PERMITIDA`. |
| EX-09 | No dar lo que no se tiene: un responsable de la prueba con `USUARIOS_GESTIONAR` y `PERMISOS_GESTIONAR` concedidos por SQL | (a) Conceder `INTERVENCIONES_CORREGIR`, que no tiene: 403 `PERMISO_NO_OTORGABLE`.<br>(b) Con su `INTERVENCIONES_VER` bajado a `SECTORES` por SQL, conceder `INTERVENCIONES_VER` con `TODAS`: 403; con `SECTORES`: 200.<br>(c) Denegar `INTERVENCIONES_CORREGIR`: 403. |
| EX-10 | Todo en una transacción | Si falla el registro de auditoría (forzado en la prueba, como en B-37), la excepción no queda guardada. |

---

## 6. Documentación

1. **`docs/modelo-datos.md`:** `permisos.usa_alcance` y las acciones nuevas de `auditoria_permisos`.
2. **`docs/decisiones.md`:** agregar al final:

   > ## D-014 — Excepciones de permisos por usuario
   >
   > **Estado:** Aceptada
   >
   > Un usuario con `PERMISOS_GESTIONAR` puede conceder o denegar un permiso a otro usuario, por encima de su perfil, con un motivo obligatorio.
   >
   > Reglas (sección 8.5 del análisis):
   >
   > - nadie cambia sus propias excepciones;
   > - nadie concede, deniega ni quita un permiso que no tiene, ni concede un alcance mayor que el suyo;
   > - cada cambio queda en `auditoria_permisos`, con el valor anterior.
   >
   > El cambio vale desde el siguiente pedido del usuario, sin volver a entrar.
   >
   > **Motivo:** relevamiento, "una persona cumple varios roles". Las excepciones cubren esos casos sin crear un perfil por persona.

---

## 7. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 6 están hechas, en dos commits:
   1. `feat(db): migración 014, excepciones de permisos`;
   2. `feat(api): crear, cambiar y quitar excepciones de permisos (API-05)`.
2. `npm run test:migration-014` y `npm run test:excepciones` en verde.
3. `npm run test:todo -- etapa-api-05` en verde:
   - **una sola vez**, al cierre;
   - con 294 más las pruebas nuevas y los once números en 0;
   - el log va en `docs/evidencia/`.
4. `npm run typecheck` sin errores.
5. Push de los dos commits en `feat/base-neon`.

**Informe corto:**

1. Los hashes de los dos commits.
2. La línea de total y la de datos que quedaron de `test:todo`.
3. Cuántas pruebas nuevas hay en `migration_014` y en `excepciones`.
4. Las pruebas existentes que se modificaron y por qué.
5. Desvíos.
6. Dudas.
