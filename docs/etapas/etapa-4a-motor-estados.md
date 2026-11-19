# Etapa 4A — Motor de estados: núcleo, asignación e inicio del trabajo

> **Estado:** requerimiento aprobado para implementar.
> **Base:** `docs/analisis-intervenciones.md` (v3) y commit `b845b1a` de `feat/base-neon` (Etapas 1 a 3).
> **Siguiente:** Etapa 4B (cierres). No implementar nada de 4B en esta etapa.

---

## 0. Reglas de trabajo

1. Trabajar en `feat/base-neon`. No tocar `main`.
2. Las migraciones y pruebas se ejecutan **solo en la rama aislada de Neon** (mismo bloqueo de seguridad que usan los tests actuales). **Nunca** contra la base principal. Avisar antes de aplicar cualquier migración fuera de la rama de pruebas.
3. No modificar nada fuera del alcance de la sección 2. Si algo del documento es ambiguo o contradice el código existente, **detenerse y preguntar** en lugar de suponer.
4. Mantener el estilo actual: SQL visible con `pg`, sin ORM, migraciones idempotentes (`IF NOT EXISTS` / bloques `DO $$`), tests con `node:test` + `app.request(...)`.
5. Todas las fechas "ahora" se toman de PostgreSQL (`NOW()`), nunca de `new Date()` de Node.
6. Al terminar, entregar el informe de la sección 11.

---

## 1. Paso previo: actualizar la documentación

### 1.1 `docs/analisis-intervenciones.md`, sección 11 (decisiones)

- Completar la fila **D-02** (hoy está cortada): opción **A — automático**. Estado: aprobada.
- Agregar al final de la tabla:

| ID | Decisión | Resolución |
| :-: | :--- | :--- |
| D-23 | Quién puede iniciar una intervención asignada a otro usuario | **Aprobada:** solo el responsable asignado o un usuario con `INTERVENCIONES_ASIGNAR`. La misma regla aplica a pasar a espera de repuestos y a reanudar. |
| D-24 | Quitar el responsable en `EN_PROCESO` o `EN_ESPERA_REPUESTOS` | **Aprobada:** no se permite; en esos estados solo se reasigna. Quitarlo solo es posible en `PENDIENTE`. |
| D-25 | Permiso para liberar la máquina al finalizar o cancelar | **Aprobada:** responder "la máquina ya funciona" requiere además `INTERVENCIONES_CONFIRMAR_RECUPERACION`. Sin ese permiso, el período queda abierto y se notifica a quien puede confirmar. (Se implementa en 4B.) |
| D-26 | División de la Etapa 4 | **Aprobada:** 4A (núcleo, asignación, T1/T4/T5) y 4B (cierres, confirmación de recuperación, "Resolver ahora"). La Etapa 5 se integra en 4A. Motivo: la Etapa 4 original no era verificable sin funciones planificadas en las Etapas 5 y 6. |

### 1.2 `docs/analisis-intervenciones.md`, sección 12 (plan)

Reemplazar las filas de las Etapas 4, 5 y 6 por:

| Etapa | Alcance | Resultado verificable |
| :-: | :--- | :--- |
| **4A** | **Núcleo del motor, asignación e inicio**: migración 005; servicio único de transición con bloqueos; recálculo del estado de la máquina; tomar / asignar / reasignar / desasignar con auditoría; T1, T4, T5; el alta (T0) pasa por el recálculo; se bloquea el cambio libre de estado desde el ABM de máquinas. | Pruebas P-01 a P-30 de `docs/etapas/etapa-4a-motor-estados.md`. |
| **4B** | **Cierres**: T3, T6, T7, T8 con decisión explícita de liberar la máquina; "Confirmar recuperación"; T2 "Resolver ahora"; `tiempo_inactividad_minutos` al cerrar períodos; cambio manual de estado de máquina (`FUERA_DE_SERVICIO` y su salida). | Ejemplos 1, 2, 3 y 5 de la sección 4.6. |
| **5** | *(Integrada en 4A.)* | — |
| **6** | **Reabrir (T9) y eliminación lógica.** | RN-21 a RN-30 y ejemplo 4. |

### 1.3 Guardar este archivo

Guardar este documento como `docs/etapas/etapa-4a-motor-estados.md`.

---

## 2. Alcance

### Incluido

- Migración `005_motor_estados.sql` (sección 3).
- Extracción de la resolución de permisos efectivos a una función reutilizable (sección 4.1).
- Servicio del motor de estados (sección 4).
- Endpoints de asignación: tomar, asignar/reasignar, desasignar (sección 5).
- Transiciones **T1** (iniciar), **T4** (pasar a espera de repuestos), **T5** (reanudar) (sección 6).
- Refactor del alta (`POST /api/intervenciones`) para usar el recálculo y los bloqueos (sección 7.1).
- Cierre del cambio libre de `estado` en el ABM de máquinas (sección 7.2).
- Correcciones menores de consulta (sección 7.3).
- Ajustes mínimos de la dev-ui (sección 8).
- Pruebas (sección 9).

### Excluido (no implementar)

- T2, T3, T6, T7, T8, T9, eliminación lógica, "Confirmar recuperación" → 4B / Etapa 6.
- Cambio manual de estado de máquina (incluido `FUERA_DE_SERVICIO`) → 4B.
- Tabla y lógica real de notificaciones → Etapa 7 (aquí solo el punto de enganche, 4.7).
- Asociación de repuestos al reanudar → Etapa 12.

---

## 3. Migración `database/migrations/005_motor_estados.sql`

Idempotente, en una transacción, con el mismo estilo que 003 y 004.

1. **Clave compuesta en intervenciones** (mismo patrón que `002`):
   `ALTER TABLE intervenciones ADD CONSTRAINT uq_intervenciones_id_maquina UNIQUE (id, maquina_id);`
2. **Coherencia de máquina en períodos de detención:**
   FK `fk_periodos_intervencion_maquina` en `intervencion_periodos_detencion (intervencion_id, maquina_id)` → `intervenciones (id, maquina_id)` `ON DELETE RESTRICT`.
3. **Coherencia de máquina en el historial de máquina:**
   FK `fk_historial_maquina_intervencion_maquina` en `historial_estados_maquina (intervencion_id, maquina_id)` → `intervenciones (id, maquina_id)` `ON DELETE RESTRICT`. Con `MATCH SIMPLE` (por defecto), las filas con `intervencion_id` nulo (cambios manuales) no se validan; es el comportamiento buscado.
4. **Observación obligatoria al pasar a espera de repuestos:**
   `CHECK ck_historial_espera_observacion`: `estado_nuevo != 'EN_ESPERA_REPUESTOS' OR (observacion IS NOT NULL AND TRIM(observacion) != '')`.
5. Si los datos existentes violan alguna restricción, la migración debe fallar (no "arreglar" datos en silencio) y se informa.

Prueba de migración: agregar casos en un test (puede ser `backend/tests/migration_005.test.ts`) que verifiquen que cada restricción rechaza un dato inválido.

---

## 4. Servicio del motor de estados

Ubicación sugerida: `backend/functions/intervenciones/` (o `backend/functions/servicios/`). Los nombres son orientativos; lo obligatorio es la separación de responsabilidades y que **todas** las operaciones de esta etapa pasen por estas funciones.

### 4.1 Permisos efectivos reutilizables

- Extraer la lógica actual de `dbVerify` a `resolverPermisosEfectivos(db, usuarioId)` → `{ activo, permisos: Record<codigo, alcance>, sectores: number[] }`.
- `dbVerify` pasa a usar esa función. **Su comportamiento no cambia**: `test:permisos` debe seguir verde sin modificaciones.
- Se usa además para validar a **otro** usuario (el destinatario de una asignación), incluidas sus excepciones `CONCEDER` / `DENEGAR`.

### 4.2 Errores de negocio

Clase `ErrorNegocio(status, codigo, mensaje)`. Respuesta JSON homogénea: `{ "error": "<mensaje legible>", "codigo": "<CODIGO>" }`.

| HTTP | Cuándo | Códigos |
| :-: | :--- | :--- |
| 403 | Falta un permiso de acción | `PERMISO_INSUFICIENTE`, `NO_ES_RESPONSABLE` |
| 404 | No existe, está eliminada lógicamente **o está fuera del alcance de visibilidad** del usuario | `INTERVENCION_NO_ENCONTRADA` |
| 409 | La acción no es válida desde el estado actual, el estado cambió o el recurso está bloqueado | `TRANSICION_NO_PERMITIDA`, `ESTADO_DESACTUALIZADO`, `INTERVENCION_YA_ASIGNADA`, `DESASIGNACION_NO_PERMITIDA`, `RECURSO_OCUPADO` |
| 422 | Datos inválidos o reglas de negocio | `DATOS_INVALIDOS`, `OBSERVACION_REQUERIDA`, `MOTIVO_REQUERIDO`, `FECHA_INCOHERENTE`, `RESPONSABLE_REQUERIDO`, `RESPONSABLE_NO_HABILITADO`, `RESPONSABLE_SIN_VISIBILIDAD`, `RESPONSABLE_SIN_CAMBIOS`, `ESTADO_NO_EDITABLE` |

### 4.3 Transacción

`conTransaccion(fn)`:

1. `pool.connect()` → conexión dedicada.
2. `BEGIN` y `SET LOCAL lock_timeout = '<valor>'` (por defecto `5s`, configurable por variable de entorno `LOCK_TIMEOUT` para que los tests usen `1s`).
3. Ejecuta `fn(client)`; `COMMIT` si termina bien, `ROLLBACK` ante cualquier error, `release()` siempre.
4. Error de PostgreSQL `55P03` (lock_not_available) → `409 RECURSO_OCUPADO`.

> No usar el driver HTTP de Neon (`neon()`): no soporta transacciones interactivas con `FOR UPDATE`. Seguir con `pg`.

### 4.4 Bloqueos (orden obligatorio: máquina → intervención)

`bloquearIntervencion(client, intervencionId)`:

1. `SELECT maquina_id FROM intervenciones WHERE id = $1` (sin bloqueo). Si no existe → 404.
2. `SELECT ... FROM maquinas WHERE id = $maquina FOR UPDATE`.
3. `SELECT ... FROM intervenciones WHERE id = $1 FOR UPDATE`. Si `eliminado_en IS NOT NULL` → 404.
4. Verificar visibilidad (4.5). Si no la ve → 404.

**Todas** las operaciones que cambian estados de intervención o de máquina respetan ese orden, incluido el alta.

### 4.5 Visibilidad

Extraer la regla de alcance que hoy está repetida en `GET /` y `GET /:id` a una función única `puedeVerIntervencion(usuario, intervencion)` basada en `INTERVENCIONES_VER`:

- `TODAS`: ve todo.
- `SECTORES`: el sector de la máquina está en sus sectores.
- `PROPIAS`: es el creador o el responsable.

La usan los GET y todas las acciones de esta etapa.

### 4.6 Recálculo del estado de la máquina

`recalcularEstadoMaquina(client, maquinaId, { usuarioId, intervencionId, motivo, confirmacion = false })`. Se llama con la fila de la máquina ya bloqueada. Implementa la tabla 4.2 del análisis:

| # | Condición | Estado resultante |
| :-: | :--- | :--- |
| 1 | La máquina está `FUERA_DE_SERVICIO` | No cambia. |
| 2 | Hay períodos abiertos (`hasta IS NULL`) de intervenciones **no eliminadas** y al menos una de **esas** intervenciones está `EN_PROCESO` | `EN_MANTENIMIENTO` |
| 3 | Hay períodos abiertos y ninguna de esas intervenciones está `EN_PROCESO` | `DETENIDA` |
| 4 | No hay períodos abiertos y `confirmacion === true` | `OPERATIVA` |
| 5 | No hay períodos abiertos y `confirmacion === false` | No cambia. |

- Solo si el estado resultante es distinto del actual: `UPDATE maquinas` + una fila en `historial_estados_maquina` (estado anterior, nuevo, `intervencion_id`, motivo, usuario).
- Devuelve `{ estadoAnterior, estadoNuevo, cambio: boolean }`.
- En 4A nadie llama con `confirmacion = true` (eso llega en 4B), pero la regla 4 se implementa y se prueba directamente sobre la función.

### 4.7 Cambio de estado de la intervención

`registrarCambioEstado(client, { intervencion, estadoNuevo, usuarioId, observacion, camposExtra })`:

- `UPDATE intervenciones SET estado = $nuevo, actualizado_en = NOW(), ... WHERE id = $id AND estado = $actual` y verificar que afectó 1 fila (segunda barrera; si no, `409 ESTADO_DESACTUALIZADO`).
- Inserta la fila de `historial_estados_intervencion` en la **misma** transacción.

### 4.8 Tabla de transiciones declarativa

Una constante en TypeScript, única fuente de verdad del código:

| Acción | Código | Desde | Hacia | Permiso |
| :--- | :-: | :--- | :--- | :--- |
| `INICIAR` | T1 | `PENDIENTE` | `EN_PROCESO` | `INTERVENCIONES_CAMBIAR_ESTADO` |
| `ESPERAR_REPUESTOS` | T4 | `EN_PROCESO` | `EN_ESPERA_REPUESTOS` | `INTERVENCIONES_CAMBIAR_ESTADO` |
| `REANUDAR` | T5 | `EN_ESPERA_REPUESTOS` | `EN_PROCESO` | `INTERVENCIONES_CAMBIAR_ESTADO` |

Debe quedar preparada para agregar en 4B las filas T2, T3, T6, T7, T8 sin reescribir el motor.

### 4.9 Auditoría y eventos

- `registrarAuditoria(client, { intervencionId, tipoEvento, campo, valorAnterior, valorNuevo, motivo, usuarioId })` → `intervencion_auditoria`.
- Cada operación junta una lista de eventos de dominio (`FALLA_REGISTRADA`, `INTERVENCION_ASIGNADA`, `INTERVENCION_REASIGNADA`, `INTERVENCION_DESASIGNADA`, `INTERVENCION_INICIADA`, `INTERVENCION_EN_ESPERA`, `INTERVENCION_REANUDADA`, `MAQUINA_CAMBIO_ESTADO`) y, antes del `COMMIT`, llama a `registrarNotificaciones(client, eventos)`.
- En 4A `registrarNotificaciones` **no hace nada** (solo existe y recibe los eventos). En la Etapa 7 se completa sin tocar el motor.

---

## 5. Endpoints de asignación

Todos bajo `/api/intervenciones`, con `jwtVerify` + `dbVerify`, dentro de `conTransaccion`, usando `bloquearIntervencion`. Ninguno cambia el estado de la intervención ni escribe en `historial_estados_intervencion` (RN-06).

**Responsable habilitado** (RN-08): usuario activo, con `INTERVENCIONES_RECIBIR_ASIGNACION` efectivo (incluidas excepciones), y que pueda ver la intervención según su propio `INTERVENCIONES_VER` (si su alcance es `PROPIAS`, la asignación la vuelve propia y cuenta como visible).

### 5.1 `POST /:id/tomar`

- Permisos: `INTERVENCIONES_ASIGNARSE`, y el usuario debe ser responsable habilitado.
- Body: `{ "estado_esperado": "PENDIENTE" }`.
- Solo en `PENDIENTE` sin responsable.
  - Ya asignada a otro → `409 INTERVENCION_YA_ASIGNADA` (eso es reasignar).
  - Ya asignada a él mismo → `422 RESPONSABLE_SIN_CAMBIOS`.
  - Otro estado → `409 TRANSICION_NO_PERMITIDA`.
- Auditoría: `ASIGNACION`, campo `responsable_usuario_id`, anterior `NULL`, nuevo = su id.

### 5.2 `PUT /:id/responsable`

- Permiso: `INTERVENCIONES_ASIGNAR`.
- Body: `{ "usuario_id": n, "motivo": "...", "estado_esperado": "..." }`.
- Estados permitidos: `PENDIENTE`, `EN_PROCESO`, `EN_ESPERA_REPUESTOS`. Otros → 409.
- El destinatario debe ser responsable habilitado; si no → `422 RESPONSABLE_NO_HABILITADO` o `422 RESPONSABLE_SIN_VISIBILIDAD`.
- Mismo responsable que el actual → `422 RESPONSABLE_SIN_CAMBIOS`.
- **Reasignación** (ya había responsable): `motivo` obligatorio (`422 MOTIVO_REQUERIDO`). Primera asignación: motivo opcional.
- Auditoría: `ASIGNACION` con valor anterior (id previo o `NULL`) y nuevo.

### 5.3 `DELETE /:id/responsable`

- Permiso: `INTERVENCIONES_ASIGNAR`, **o** que el usuario sea el responsable actual y tenga `INTERVENCIONES_ASIGNARSE` (puede liberar lo que tomó por error).
- Body: `{ "motivo": "...", "estado_esperado": "PENDIENTE" }`. Motivo obligatorio.
- Solo en `PENDIENTE` (D-24). En `EN_PROCESO` / `EN_ESPERA_REPUESTOS` → `409 DESASIGNACION_NO_PERMITIDA`. Sin responsable → `422 RESPONSABLE_SIN_CAMBIOS`.
- Auditoría: `DESASIGNACION`.

---

## 6. Endpoints de transición

Comunes a los tres:

- `estado_esperado` **obligatorio** en el body. Si no coincide con el estado actual (leído con bloqueo) → `409 ESTADO_DESACTUALIZADO` sin cambios.
- Si la acción no admite el estado actual según la tabla 4.8 → `409 TRANSICION_NO_PERMITIDA`.
- **Regla de actor (D-23):** el usuario debe ser el responsable actual **o** tener `INTERVENCIONES_ASIGNAR`; si no → `403 NO_ES_RESPONSABLE`. (Excepción: el caso sin responsable de T1, ver 6.1.)
- Llamar a `recalcularEstadoMaquina` después del cambio, con `intervencionId` y un motivo descriptivo.
- Respuesta `200`:

```json
{
  "intervencion": { "id": 1, "estado": "EN_PROCESO", "fecha_inicio": "...", "responsable": { "id": 2, "legajo": "...", "nombre": "..." } },
  "maquina": { "id": 3, "estado_anterior": "DETENIDA", "estado_nuevo": "EN_MANTENIMIENTO", "cambio": true }
}
```

### 6.1 `POST /:id/iniciar` (T1)

- Body: `{ "estado_esperado": "PENDIENTE", "fecha_inicio": "<ISO, opcional>", "observacion": "<opcional>" }`.
- Responsable:
  - Sin responsable: si el usuario tiene `INTERVENCIONES_ASIGNARSE` y es responsable habilitado, queda asignado **en la misma transacción** (auditoría `ASIGNACION`). Si no → `422 RESPONSABLE_REQUERIDO`, sin cambios.
  - Responsable = usuario: OK.
  - Responsable = otro: aplicar la regla de actor (D-23). Además, el responsable debe seguir habilitado; si no → `422 RESPONSABLE_NO_HABILITADO`.
- `fecha_inicio`: por defecto `NOW()`. Si se envía, debe ser `>= fecha_creacion` y `<= NOW()`, comparando en la base. Si no → `422 FECHA_INCOHERENTE`.
- Se graba `fecha_inicio` **solo si es nula** (regla: nunca se sobrescribe).

### 6.2 `POST /:id/espera-repuestos` (T4)

- Body: `{ "estado_esperado": "EN_PROCESO", "observacion": "qué repuesto falta" }`.
- `observacion` obligatoria, mínimo 5 caracteres → `422 OBSERVACION_REQUERIDA`.
- El período de detención (si hay) **sigue abierto**; el recálculo decide `DETENIDA` o `EN_MANTENIMIENTO`.

### 6.3 `POST /:id/reanudar` (T5)

- Body: `{ "estado_esperado": "EN_ESPERA_REPUESTOS", "observacion": "<opcional>" }`.
- **No** modifica `fecha_inicio`.

---

## 7. Cambios sobre código existente

### 7.1 Alta de falla (`POST /api/intervenciones`)

Problemas actuales:

- No bloquea la fila de la máquina: un alta concurrente con una transición puede dejar el estado inconsistente.
- Pone `DETENIDA` directamente. Si la máquina estaba `EN_MANTENIMIENTO` por otra intervención `EN_PROCESO` con período abierto, la "baja" a `DETENIDA` (viola la tabla 4.2).
- La respuesta informa `estado_actual: 'DETENIDA'` aunque la máquina esté `FUERA_DE_SERVICIO` (y no haya cambiado).

Cambios:

1. Usar `conTransaccion`. Bloquear la máquina con `FOR UPDATE` al validarla.
2. Si detiene: abrir el período y llamar a `recalcularEstadoMaquina` (eliminar el `UPDATE` directo).
3. `maquina.estado_actual` de la respuesta = resultado del recálculo.
4. Emitir el evento `FALLA_REGISTRADA` (y `MAQUINA_CAMBIO_ESTADO` si cambió) hacia `registrarNotificaciones`.
5. El resto del contrato del endpoint no cambia.

### 7.2 ABM de máquinas (`backend/functions/maquinas.ts`)

Hoy `PUT /api/maquinas/:id` permite cambiar `estado` libremente (sin historial ni bloqueo) y `POST` acepta cualquier estado inicial. Esto permite poner `OPERATIVA` una máquina con períodos abiertos y rompe RN-13.

- `POST`: el estado inicial es siempre `OPERATIVA`. Si el body trae `estado` distinto de `OPERATIVA` → `422 ESTADO_NO_EDITABLE`.
- `PUT`: si el body trae `estado` → `422 ESTADO_NO_EDITABLE` ("el estado se gestiona desde las intervenciones o el cambio manual de estado"). El resto de los campos se sigue editando igual.
- El cambio manual (incluido `FUERA_DE_SERVICIO`) se implementa en 4B; mientras tanto no hay forma de ponerla desde la API y es aceptado.

### 7.3 Consultas

- `GET /:id`: fuera de alcance devuelve hoy `403`; pasa a `404 INTERVENCION_NO_ENCONTRADA` (no revelar que existe). Usar `puedeVerIntervencion`.
- Historial de estados: ordenar por `cambiado_en ASC, id ASC`. `NOW()` devuelve el mismo valor en toda la transacción, así que dos filas de la misma transacción (por ejemplo, T2 en 4B) empatan en `cambiado_en`.
- Agregar al detalle la lista de auditoría (`intervencion_auditoria`) con usuario, evento, valores y motivo, ordenada por `creado_en, id`.

---

## 8. Dev-ui (mínimo, provisional)

- `Intervenciones.tsx`, en el detalle: botones **Tomar**, **Asignar / Reasignar** (selector de usuario + motivo), **Quitar responsable**, **Iniciar**, **Pasar a espera de repuestos** (observación) y **Reanudar**. Mostrar solo los que aplican al estado actual; enviar siempre `estado_esperado`; mostrar el `codigo` y el mensaje de error que devuelva la API.
- Mostrar la auditoría en el detalle.
- `Maquinas.tsx`: quitar el campo "Estado Operativo" del formulario de alta y edición; el estado se muestra solo como lectura.
- Para el selector de usuarios a asignar, si no existe un endpoint que liste usuarios habilitados, agregar `GET /api/intervenciones/:id/responsables-habilitados` (requiere `INTERVENCIONES_ASIGNAR`) que devuelva los usuarios que cumplen la definición de responsable habilitado para esa intervención.

---

## 9. Pruebas de aceptación

Nuevo archivo `backend/tests/motor_estados.test.ts` y script `test:motor` en `package.json`, con el mismo bloqueo de rama aislada que los tests actuales y `LOCK_TIMEOUT=1s`.

Los resultados esperados se escriben **a mano en cada test**. No derivarlos de la tabla de transiciones del código (sería una prueba tautológica). Cada prueba verifica, además del código HTTP, el estado de la base (intervención, historial, auditoría, máquina, historial de máquina).

Para preparar estados que esta etapa no permite alcanzar por API (`FINALIZADA`, `CANCELADA`, `FUERA_DE_SERVICIO`, eliminada lógicamente) se permite escribir directamente con SQL en el setup del test, respetando las restricciones de la base.

### 9.1 Asignación

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| P-01 | Responsable toma una `PENDIENTE` sin responsable | 200. Responsable = él. Estado sigue `PENDIENTE`. **Ninguna** fila nueva en el historial de estados. 1 fila `ASIGNACION` en auditoría. |
| P-02 | Tomar una ya asignada a otro | 409 `INTERVENCION_YA_ASIGNADA`. Sin cambios. |
| P-03 | Operario (sin `ASIGNARSE`) intenta tomar | 403. |
| P-04 | Asignar a: (a) usuario inactivo, (b) usuario sin `RECIBIR_ASIGNACION`, (c) usuario cuyo perfil lo tiene pero con excepción `DENEGAR` | 422 `RESPONSABLE_NO_HABILITADO` en los tres. El caso (c) prueba que se usan los permisos efectivos del destinatario. |
| P-05 | Asignar a un usuario con `VER` alcance `SECTORES` que no incluye el sector de la máquina | 422 `RESPONSABLE_SIN_VISIBILIDAD`. |
| P-06 | Reasignar una `EN_PROCESO`: (a) sin motivo, (b) con motivo | (a) 422 `MOTIVO_REQUERIDO`. (b) 200, auditoría con valor anterior y nuevo, estado sigue `EN_PROCESO`. |
| P-07 | Quitar responsable: (a) en `PENDIENTE` con motivo, (b) en `EN_PROCESO`, (c) el propio responsable con `ASIGNARSE` en `PENDIENTE` | (a) 200 y `DESASIGNACION`. (b) 409 `DESASIGNACION_NO_PERMITIDA`. (c) 200. |

### 9.2 Transiciones

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| P-08 | Iniciar sin responsable, usuario con `ASIGNARSE` | 200. Queda asignado y `EN_PROCESO`, con `fecha_inicio`. 1 fila de historial y 1 de auditoría. |
| P-09 | Iniciar sin responsable, usuario con `CAMBIAR_ESTADO` pero `ASIGNARSE` denegado por excepción | 422 `RESPONSABLE_REQUERIDO`. Nada cambia. |
| P-10 | Iniciar una asignada a otro: (a) usuario sin `ASIGNAR`, (b) usuario con `ASIGNAR` | (a) 403 `NO_ES_RESPONSABLE`. (b) 200, el responsable no cambia. |
| P-11 | Iniciar con `fecha_inicio` (a) anterior a la creación, (b) futura, (c) válida en el pasado | (a) y (b) 422 `FECHA_INCOHERENTE`. (c) 200 con esa fecha exacta. |
| P-12 | `estado_esperado` desactualizado | 409 `ESTADO_DESACTUALIZADO`. Nada cambia. |
| P-13 | **Matriz** estado × acción (abajo) | Exactamente los códigos de la matriz. |
| P-14 | Pasar a espera: (a) sin observación, (b) con observación | (a) 422 `OBSERVACION_REQUERIDA`. (b) 200, la observación queda en el historial. |
| P-15 | Reanudar | 200. `fecha_inicio` idéntica a la del primer inicio. |
| P-16 | Iniciar / pasar a espera / reanudar sobre una intervención de un sector fuera del alcance `VER` del usuario | 404 (no 403). |
| P-17 | `GET /:id` fuera de alcance | 404. |

Matriz de P-13:

| Estado actual | iniciar | espera-repuestos | reanudar |
| :--- | :-: | :-: | :-: |
| `PENDIENTE` | 200 | 409 | 409 |
| `EN_PROCESO` | 409 | 200 | 409 |
| `EN_ESPERA_REPUESTOS` | 409 | 409 | 200 |
| `FINALIZADA` | 409 | 409 | 409 |
| `CANCELADA` | 409 | 409 | 409 |

### 9.3 Estado de la máquina

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| P-18 | Una intervención con detención: alta → iniciar → espera → reanudar | Máquina: `DETENIDA` → `EN_MANTENIMIENTO` → `DETENIDA` → `EN_MANTENIMIENTO`. Exactamente 4 filas en `historial_estados_maquina`, todas con `intervencion_id`. |
| P-19 | Intervención **sin** detención, iniciada | La máquina sigue `OPERATIVA`. Ninguna fila en el historial de máquina. |
| P-20 | A detiene y está `EN_PROCESO` (máquina `EN_MANTENIMIENTO`); se registra B con detención | La máquina **sigue** `EN_MANTENIMIENTO` (regresión del bug del alta). A pasa a espera → `DETENIDA`. Se inicia B → `EN_MANTENIMIENTO`. |
| P-21 | A detiene y está en espera; B no detiene y está `EN_PROCESO` | `DETENIDA` (B no tiene período). |
| P-22 | Máquina `FUERA_DE_SERVICIO`: alta con detención; luego iniciar | Se abre el período, pero la máquina sigue `FUERA_DE_SERVICIO` en ambos pasos. La respuesta del alta informa `FUERA_DE_SERVICIO`. |
| P-23 | A con período abierto y eliminada lógicamente (setup por SQL); B detiene y se inicia | El período de A no cuenta en el recálculo. |
| P-24 | `recalcularEstadoMaquina` directo: sin períodos abiertos, con `confirmacion = false` y luego `true` | `false`: no cambia. `true`: `OPERATIVA` con fila en el historial. |

### 9.4 Atomicidad y concurrencia

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| P-25 | **Fallo a mitad de transacción.** En el test, crear un trigger temporal que lance error al insertar en `historial_estados_intervencion` para una intervención concreta; llamar a iniciar; luego eliminar el trigger. | 500. Estado, responsable, `fecha_inicio`, auditoría y máquina **sin ningún cambio**. |
| P-26 | Dos `iniciar` simultáneos sobre la misma intervención (`Promise.all`) con el mismo `estado_esperado` | Exactamente un 200 y un 409. Una sola fila nueva en el historial. |
| P-27 | Iniciar simultáneamente A y B, ambas con detención, de la misma máquina | Ambas 200. Máquina `EN_MANTENIMIENTO`. Una sola fila `DETENIDA → EN_MANTENIMIENTO` en el historial de máquina. |
| P-28 | Un cliente del test toma `FOR UPDATE` sobre la máquina y no libera; se llama a iniciar | 409 `RECURSO_OCUPADO` tras ~1 s. Luego se libera y el reintento da 200. |

### 9.5 Máquinas y regresión

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| P-29 | `PUT /api/maquinas/:id` con `estado`; `POST` con `estado: 'DETENIDA'` | 422 `ESTADO_NO_EDITABLE` en ambos. `PUT` sin `estado` sigue funcionando. |
| P-30 | Suites anteriores: `test:e2e`, `test:migration`, `test:permisos`, `test:intervenciones`, y `npm run typecheck` | Todo verde. Si algún test anterior se modifica (por ejemplo por el cambio 403 → 404 o por el estado de máquinas), **listar cuál y por qué** en el informe. `test:permisos` no debe modificarse. |

---

## 10. Criterios de cierre

La etapa se da por terminada cuando:

1. La migración 005 está aplicada **solo** en la rama de pruebas y su test pasa.
2. P-01 a P-30 pasan.
3. La documentación de la sección 1 está actualizada.
4. Hay un commit en `feat/base-neon` con mensaje descriptivo, y push.

---

## 11. Informe a entregar

1. Lista de archivos creados y modificados.
2. Salida completa de todos los scripts de test y del typecheck.
3. Tests anteriores modificados y motivo de cada cambio.
4. Cualquier desvío respecto de este documento y su justificación.
5. Dudas o decisiones que hayan quedado abiertas.
