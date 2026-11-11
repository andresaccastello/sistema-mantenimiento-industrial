# Etapa 4B — Motor de estados: cierres, recuperación de la máquina y estado manual

> **Estado:** requerimiento para implementar.
> **Requisito previo:** Etapa 4A.1 (correcciones de la revisión de 4A) terminada, revisada y con push. No empezar 4B sobre una 4A sin esas correcciones.
> **Base:** `docs/analisis-intervenciones.md` (v3), `docs/etapas/etapa-4a-motor-estados.md` y el código de 4A / 4A.1.

---

## 0. Reglas de trabajo

Las mismas de la sección 0 de `docs/etapas/etapa-4a-motor-estados.md`:

1. Rama `feat/base-neon`; nada en `main`.
2. Migraciones y tests **solo** en la rama aislada de Neon.
3. Nada fuera del alcance de la sección 2. Ante ambigüedad o contradicción con el código, **detenerse y preguntar**.
4. SQL visible con `pg`, sin ORM; migraciones idempotentes; tests con `node:test` + `app.request(...)`.
5. Fechas "ahora" siempre desde PostgreSQL (`NOW()`). Fechas recibidas: ISO 8601 **con zona horaria explícita** (mismo validador de 4A.1); si no → `422 DATOS_INVALIDOS`.
6. **Todo** cambio de estado pasa por el motor de 4A: `conTransaccion`, `bloquearIntervencion` (orden máquina → intervención), `registrarCambioEstado`, `recalcularEstadoMaquina`, `registrarNotificaciones`. No se escribe `UPDATE intervenciones SET estado` ni `UPDATE maquinas SET estado` fuera de esas funciones.
7. El informe final (sección 11) debe declarar **todo** desvío, incluido cualquier cambio fuera de alcance aunque parezca menor.

### 0.1 Ajustes previos (de la revisión de 4A.1)

Hacer esto **antes** de empezar con la sección 1, en el mismo trabajo de 4B:

1. **Búsqueda de transición por acción.** `buscarTransicionPorAccion(accion)` devuelve la **primera** fila de la acción. En 4B `CANCELAR` tiene tres filas (T3, T7, T8), así que solo funcionaría desde `PENDIENTE`. Reemplazar por `transicionesDeAccion(accion)`, que devuelve todas las filas:
   - El permiso se valida **antes** de bloquear, y sale de esas filas. Todas las filas de una misma acción deben tener el mismo permiso; verificarlo con un test sobre la constante `TRANSICIONES`.
   - **Después** de bloquear, se elige la fila cuyo `desde` coincide con el estado actual; si no hay → `409 TRANSICION_NO_PERMITIDA`.
2. **Validador de fechas único.** Hoy `2026-02-30T10:00:00Z` pasa la expresión regular y `Date.parse`, pero PostgreSQL lo rechaza y la API responde 500. Crear `validarFechaISO(client, valor, campo)`, que:
   - aplica la expresión regular actual;
   - convierte con `SELECT $1::timestamptz` y transforma los errores `22007` / `22008` en `422 DATOS_INVALIDOS`.

   Usarlo en `fecha_inicio` (4A) y en todas las fechas de 4B.
3. **P-32 depende de la latencia de red.** Envía una `fecha_inicio` de "ahora − 5 s" sobre una intervención recién creada. Contra Neon pasa porque entre la creación y el pedido transcurren más de 5 s; contra una base local falla con `FECHA_INCOHERENTE`, que es el comportamiento correcto. Corregir el test: en el setup, llevar `fecha_creacion` una hora atrás por SQL y enviar una `fecha_inicio` de hace 30 minutos.
4. **Consultas en paralelo sobre la misma conexión.** `resolverPermisosEfectivos` hace `Promise.all` de cuatro consultas. Cuando recibe una conexión de transacción (`PoolClient`), `pg` emite el aviso "Calling client.query() when the client is already executing a query", y esa forma de uso dejará de funcionar en `pg` 9 (el `package.json` tiene `"pg": "latest"`). Ejecutarlas en secuencia cuando `db` es un `PoolClient`, o unirlas en una sola consulta. El aviso no debe aparecer más en la salida de `test:motor`.
5. **D-007 pendiente.** Si todavía no está, agregar a `docs/decisiones.md`: *D-007 — Sistema independiente de SolGest. El sistema es una aplicación aislada, con autenticación y permisos propios. `docs/InfromeSobreFront/FRONTEND_HANDOFF.md` se usa solo como referencia visual para el frontend definitivo. La integración con SolGest queda como posible evolución futura, fuera del alcance de la tesis.*

Pruebas: agregar al final de `motor_estados.test.ts` **P-33** (cancelar no existe todavía en 4A; probar con una tabla de prueba o directamente con la constante que `transicionesDeAccion` devuelve todas las filas y que el permiso es uniforme) y **P-34** (`2026-02-30T10:00:00Z` → 422 `DATOS_INVALIDOS`).

---

## 1. Paso previo: documentación

### 1.1 `docs/analisis-intervenciones.md`, sección 11

Agregar:

| ID | Decisión | Resolución |
| :-: | :--- | :--- |
| D-27 | Registrar que una intervención abierta pasó a detener la máquina (RN-18, sección 4.5) | **Aprobada:** acción "Registrar detención" en 4B. Abre un período nuevo y recalcula la máquina. |
| D-28 | Regla de actor en finalizar y cancelar | **Aprobada:** finalizar (T6) y "Resolver ahora" (T2) aplican la regla de D-23 (responsable o `INTERVENCIONES_ASIGNAR`). Cancelar (T3, T7, T8) es una decisión administrativa: alcanza con `INTERVENCIONES_CANCELAR`. |
| D-29 | Fecha de recuperación por defecto al finalizar con "la máquina funciona" | **Aprobada:** si no se informa, es la `fecha_finalizacion` (el trabajo terminó con la prueba de funcionamiento, proceso 3.2). En cancelar y en "Confirmar recuperación", por defecto `NOW()`. |
| D-30 | Reactivar una máquina | **Aprobada:** "Reactivar" saca una máquina de `FUERA_DE_SERVICIO` y su estado pasa a ser el derivado de sus períodos abiertos. También se permite sobre una máquina en cualquier estado **sin** períodos abiertos (normaliza datos previos a 4A); vale como confirmación humana de que funciona. |
| D-31 | Confirmar recuperación con la intervención todavía abierta | **Aprobada:** se permite. La máquina puede volver a funcionar mientras el trabajo sigue (ej.: se terminan ajustes con la máquina operando). Al finalizar después, no hay período abierto y no se pregunta nada. |

### 1.2 Guardar este archivo

Como `docs/etapas/etapa-4b-cierres.md`.

---

## 2. Alcance

### Incluido

- Migración `006_cierres.sql` (sección 3).
- Extensión de la tabla de transiciones con T2, T3, T6, T7, T8 (sección 4).
- Servicio común de "decisión de recuperación" (sección 5).
- Endpoints: finalizar (T6), resolver ahora (T2), cancelar (T3/T7/T8), registrar detención (D-27) (sección 6).
- Endpoints de máquina: detenciones abiertas, confirmar recuperación, estado manual (sección 7).
- Cálculo de `tiempo_inactividad_minutos` al cerrar períodos (sección 5.4).
- Dev-ui mínima (sección 8).
- Pruebas (sección 9).

### Excluido (no implementar)

- Reabrir (T9) y eliminación lógica → Etapa 6.
- Notificaciones reales → Etapa 7 (solo eventos al enganche).
- Tiempos de gestión, unión de períodos por máquina, exclusión de horas `FUERA_DE_SERVICIO` (D-07) → Etapa 8.
- Renglones de costo y su validación al finalizar → Etapa 9.
- Repuestos → Etapa 12.

---

## 3. Migración `database/migrations/006_cierres.sql`

Idempotente y en una transacción, con el estilo de 003–005.

1. `intervenciones.trabajo_realizado TEXT` (nulo). Es la "descripción del trabajo / tareas realizadas" (M-RF-09); `descripcion` sigue siendo la falla informada.
2. `CHECK ck_intervenciones_finalizada_datos`:
   `estado != 'FINALIZADA' OR (trabajo_realizado IS NOT NULL AND TRIM(trabajo_realizado) != '' AND ejecucion IS NOT NULL)`.
3. `intervencion_periodos_detencion.observacion_confirmacion TEXT` (nulo). Hoy hay una sola `observacion`; la del cierre no debe pisar la de la apertura.
4. Si datos existentes violan el `CHECK` del punto 2, la migración falla y se informa (no corregir datos en silencio).

> **Atención con los tests de 4A:** P-13 (y cualquier otro) pone `estado = 'FINALIZADA'` por SQL sin `trabajo_realizado` ni `ejecucion`. Ese setup debe completarse con ambos campos. Es un cambio de test permitido; declararlo en el informe.

Test: `backend/tests/migration_006.test.ts` verifica que el `CHECK` rechaza una `FINALIZADA` sin trabajo o sin ejecución, y que ambas columnas existen.

---

## 4. Tabla de transiciones

Agregar a `TRANSICIONES` (las de 4A no cambian):

| Acción | Código | Desde | Hacia | Permiso | Regla de actor (D-23 / D-28) |
| :--- | :-: | :--- | :--- | :--- | :-: |
| `RESOLVER_AHORA` | T2 | `PENDIENTE` | `FINALIZADA` (pasando por `EN_PROCESO`) | `INTERVENCIONES_FINALIZAR` | Sí, con auto-asignación como en T1 |
| `CANCELAR` | T3 | `PENDIENTE` | `CANCELADA` | `INTERVENCIONES_CANCELAR` | No |
| `FINALIZAR` | T6 | `EN_PROCESO` | `FINALIZADA` | `INTERVENCIONES_FINALIZAR` | Sí |
| `CANCELAR` | T7 | `EN_PROCESO` | `CANCELADA` | `INTERVENCIONES_CANCELAR` | No |
| `CANCELAR` | T8 | `EN_ESPERA_REPUESTOS` | `CANCELADA` | `INTERVENCIONES_CANCELAR` | No |

- La regla de actor pasa a ser un atributo de la fila (`requiereActor: boolean`), no un `if` por acción.
- El permiso sale de la fila (corrección de 4A.1).
- Una misma acción (`CANCELAR`) tiene varias filas; `buscarTransicion(accion, estado)` ya lo soporta.
- Transiciones no permitidas que deben dar `409 TRANSICION_NO_PERMITIDA`: `EN_ESPERA_REPUESTOS → FINALIZADA` (primero se reanuda), cualquier acción sobre `CANCELADA`, cualquier cierre sobre `FINALIZADA`.

---

## 5. Decisión de recuperación (servicio común)

Finalizar, resolver ahora y cancelar comparten esta lógica. Implementarla **una sola vez**, por ejemplo `resolverDecisionRecuperacion(client, { intervencion, maquina, usuario, maquinaRecuperada, fechaRecuperacion, fechaPorDefecto, observacion })`.

### 5.1 Entrada

En el body de las tres acciones:

- `maquina_recuperada`: `true` / `false`.
- `fecha_recuperacion`: opcional.
- `observacion_recuperacion`: opcional.

### 5.2 Reglas

1. Buscar el período abierto de la intervención (`hasta IS NULL`), con `FOR UPDATE`. Como mucho hay uno (índice único parcial).
2. **Sin período abierto:** `maquina_recuperada` y `fecha_recuperacion` se ignoran. La respuesta informa `periodo: null`.
3. **Con período abierto y `maquina_recuperada` ausente** → `422 DECISION_RECUPERACION_REQUERIDA`, sin cambios. La decisión es siempre explícita (4.4).
4. **`maquina_recuperada = true`:**
   - Exige `INTERVENCIONES_CONFIRMAR_RECUPERACION` efectivo (D-25); si no → `403 CONFIRMACION_NO_PERMITIDA`, sin cambios.
   - `hasta` = `fecha_recuperacion` si viene; si no, el valor por defecto de la acción (D-29: `fecha_finalizacion` al finalizar / resolver; `NOW()` al cancelar).
   - Validar `desde <= hasta <= NOW()` → si no, `422 FECHA_INCOHERENTE`.
   - Completar `hasta`, `confirmado_por_usuario_id`, `observacion_confirmacion`.
   - Recalcular `tiempo_inactividad_minutos` (5.4).
   - Recalcular la máquina con `confirmacion = true`.
   - Evento `RECUPERACION_CONFIRMADA`.
5. **`maquina_recuperada = false`:**
   - El período queda abierto.
   - Recalcular la máquina con `confirmacion = false` (si la intervención estaba `EN_PROCESO`, la máquina pasa de `EN_MANTENIMIENTO` a `DETENIDA` salvo otra causa en proceso).
   - Evento `DETENCION_PENDIENTE_CONFIRMACION` (en la Etapa 7 será la notificación de prioridad alta de 8.6).

### 5.3 Orden dentro de la transacción

1. Bloqueos (máquina → intervención → período).
2. Validaciones completas (estado, permisos, actor, datos, decisión de recuperación). **Nada se escribe antes de terminar de validar.**
3. Cambio de estado + historial.
4. Cierre del período (si corresponde) + `tiempo_inactividad_minutos`.
5. **Un solo** recálculo de máquina al final.
6. Eventos → `registrarNotificaciones`.

### 5.4 `tiempo_inactividad_minutos` (D-08 A)

Cada vez que se cierra un período (por cualquier vía: finalizar, cancelar, confirmar recuperación):

```sql
UPDATE intervenciones
SET tiempo_inactividad_minutos = (
  SELECT ROUND(EXTRACT(EPOCH FROM SUM(hasta - desde)) / 60)
  FROM intervencion_periodos_detencion
  WHERE intervencion_id = $1 AND hasta IS NOT NULL
)
WHERE id = $1;
```

- Solo cuenta períodos **cerrados**. El tiempo de un período abierto se calcula al consultar (Etapa 8).
- Es inactividad **atribuible a la intervención**. La inactividad real de la máquina (unión sin doble conteo) es Etapa 8.
- Nunca se recibe desde el cliente.

---

## 6. Endpoints de intervención

Comunes: `estado_esperado` obligatorio (`422 DATOS_INVALIDOS` si falta); `409 ESTADO_DESACTUALIZADO` si no coincide; `404` fuera de alcance. Formato de error `{ error, codigo }`. Respuesta `200`, el mismo formato de 4A, más:

```json
"periodo": { "id": 10, "cerrado": true, "hasta": "...", "tiempo_inactividad_minutos": 240 }
```

(`periodo: null` si la intervención no tenía período abierto.)

### 6.1 `POST /:id/finalizar` (T6)

Body:

```json
{
  "estado_esperado": "EN_PROCESO",
  "fecha_finalizacion": "<opcional, ISO con zona>",
  "trabajo_realizado": "texto",
  "ejecucion": "INTERNA | EXTERNA",
  "observacion": "<opcional>",
  "maquina_recuperada": true,
  "fecha_recuperacion": "<opcional>",
  "observacion_recuperacion": "<opcional>"
}
```

- `fecha_finalizacion`: por defecto `NOW()`. Debe ser `>= fecha_inicio` y `<= NOW()` → si no, `422 FECHA_INCOHERENTE`.
- `trabajo_realizado`: obligatorio, mínimo 5 caracteres → `422 TRABAJO_REALIZADO_REQUERIDO`.
- `ejecucion`: obligatorio, `INTERNA` o `EXTERNA` → `422 EJECUCION_REQUERIDA` (D-11).
- Decisión de recuperación (sección 5), con valor por defecto `fecha_finalizacion`.
- Regla de actor: sí.
- Evento `INTERVENCION_FINALIZADA`.

### 6.2 `POST /:id/resolver-ahora` (T2)

Body: igual que finalizar, con `estado_esperado: "PENDIENTE"` y además `fecha_inicio` **obligatoria**.

- Coherencia: `fecha_creacion <= fecha_inicio <= fecha_finalizacion <= NOW()` → si no, `422 FECHA_INCOHERENTE`.
- Responsable: mismas reglas que T1 (auto-asignación si no hay y el usuario tiene `INTERVENCIONES_ASIGNARSE` y está habilitado; si no, `422 RESPONSABLE_REQUERIDO`; si es de otro, regla de actor). Auditoría de la auto-asignación.
- Permiso: `INTERVENCIONES_FINALIZAR` (no exige además `CAMBIAR_ESTADO`).
- Historial: **exactamente dos filas** en la misma transacción, en este orden: `PENDIENTE → EN_PROCESO` y `EN_PROCESO → FINALIZADA`, con observación "Resolución inmediata" en la primera. Las dos van a tener el mismo `cambiado_en`; el orden lo da el `id`.
- La máquina se recalcula **una sola vez, al final**. No debe aparecer un `EN_MANTENIMIENTO` transitorio en `historial_estados_maquina`.
- Implementación: dos llamadas a `registrarCambioEstado` (no un `UPDATE` directo a `FINALIZADA`), así la doble barrera de estado sigue funcionando.
- Eventos: `INTERVENCION_INICIADA` e `INTERVENCION_FINALIZADA`.

### 6.3 `POST /:id/cancelar` (T3, T7, T8)

Body:

```json
{
  "estado_esperado": "PENDIENTE | EN_PROCESO | EN_ESPERA_REPUESTOS",
  "motivo": "texto",
  "maquina_recuperada": false,
  "fecha_recuperacion": "<opcional>",
  "observacion_recuperacion": "<opcional>"
}
```

- `motivo`: obligatorio, mínimo 5 caracteres → `422 MOTIVO_REQUERIDO`. Se guarda como `observacion` del historial (ya hay un `CHECK` en la base).
- Lo ya cargado se conserva: responsable, `fecha_inicio`, períodos cerrados. No se completa `fecha_finalizacion`.
- Decisión de recuperación (sección 5), con valor por defecto `NOW()`.
- Regla de actor: **no** (D-28).
- Evento `INTERVENCION_CANCELADA`.

### 6.4 `POST /:id/registrar-detencion` (D-27, RN-18)

Body: `{ "estado_esperado": "...", "desde": "<opcional>", "observacion": "texto" }`.

- Estados permitidos: `PENDIENTE`, `EN_PROCESO`, `EN_ESPERA_REPUESTOS`. Otro → `409 TRANSICION_NO_PERMITIDA`.
- Si ya tiene un período abierto → `409 DETENCION_YA_ABIERTA`.
- `desde`: por defecto `NOW()`; debe ser `>= fecha_creacion` y `<= NOW()`.
- `observacion` obligatoria (mínimo 5).
- Permiso: `INTERVENCIONES_CAMBIAR_ESTADO`. Regla de actor: no (registrar que la máquina se detuvo es un hecho, no una decisión sobre el trabajo).
- No cambia el estado de la intervención ni escribe en su historial. Abre el período y recalcula la máquina (`PENDIENTE` o en espera → `DETENIDA`; `EN_PROCESO` → `EN_MANTENIMIENTO`).
- Evento `DETENCION_REGISTRADA`.

---

## 7. Endpoints de máquina

Rutas en `backend/functions/maquinas.ts`; la lógica en servicios del motor (por ejemplo, `backend/functions/intervenciones/detenciones.ts`). Mismo formato de error.

### 7.1 `GET /api/maquinas/:id/detenciones-abiertas`

- Permiso: `INTERVENCIONES_VER`.
- Devuelve los períodos abiertos de la máquina de intervenciones no eliminadas **que el usuario puede ver** (misma regla de visibilidad), con: período (id, desde, observación, abierto por), intervención (id, descripción, estado, responsable).

### 7.2 `POST /api/maquinas/:id/confirmar-recuperacion`

Body: `{ "periodo_ids": [1, 2], "fecha_recuperacion": "<opcional>", "observacion": "<opcional>" }`.

- Permiso: `INTERVENCIONES_CONFIRMAR_RECUPERACION`.
- `periodo_ids` no vacío y sin repetidos → si no, `422 DATOS_INVALIDOS`.
- Bloqueos: máquina `FOR UPDATE`; luego los períodos `FOR UPDATE`; luego sus intervenciones `FOR UPDATE` en orden ascendente de id.
- **Todo o nada:** si algún id no existe, no es de esta máquina, ya está cerrado, pertenece a una intervención eliminada o no visible para el usuario → `422 PERIODO_INVALIDO` con la lista de ids rechazados, y no se cierra ninguno.
- `fecha_recuperacion`: por defecto `NOW()`; para cada período `desde <= hasta <= NOW()`.
- Cierra cada período (`hasta`, `confirmado_por_usuario_id`, `observacion_confirmacion`), recalcula `tiempo_inactividad_minutos` de cada intervención afectada y hace **un** recálculo de máquina con `confirmacion = true`.
- Si quedan otros períodos abiertos, la máquina sigue `DETENIDA` / `EN_MANTENIMIENTO` (RN-13).
- Permitido aunque la intervención siga abierta (D-31).
- En el historial de máquina, `intervencion_id` = la intervención del período si se cerró uno solo; `NULL` si fueron varios (el motivo lista los ids).
- Evento `RECUPERACION_CONFIRMADA`.

### 7.3 `POST /api/maquinas/:id/estado` (cambio manual)

Body: `{ "accion": "FUERA_DE_SERVICIO" | "REACTIVAR", "motivo": "texto" }`.

- Permiso: `MAQUINAS_CAMBIAR_ESTADO`. `motivo` obligatorio (mínimo 5).
- Bloqueo: máquina `FOR UPDATE`.
- `FUERA_DE_SERVICIO`: desde cualquier estado salvo el mismo (`422 SIN_CAMBIOS`). Los períodos abiertos **no** se cierran.
- `REACTIVAR` (D-30):
  - Desde `FUERA_DE_SERVICIO`: el estado pasa a ser el derivado (períodos abiertos → `DETENIDA` / `EN_MANTENIMIENTO`; sin períodos → `OPERATIVA`).
  - Desde otro estado: solo si **no** hay períodos abiertos → `OPERATIVA`. Con períodos abiertos → `409 MAQUINA_CON_DETENCIONES_ABIERTAS` ("usar Confirmar recuperación").
  - Ya `OPERATIVA` sin períodos → `422 SIN_CAMBIOS`.
- Implementación: extender `recalcularEstadoMaquina` con una opción `salidaFueraDeServicio: true` que omite la regla 1, y llamarla con `confirmacion = true`. No duplicar la tabla 4.2 en otro lugar. Para poner `FUERA_DE_SERVICIO`, una función pequeña del mismo módulo que hace `UPDATE` + historial.
- Historial de máquina con `intervencion_id = NULL` y el motivo.
- Eventos `MAQUINA_FUERA_DE_SERVICIO` / `MAQUINA_REACTIVADA`.

---

## 8. Dev-ui (mínimo, provisional)

- `Intervenciones.tsx`, en el detalle:
  - **Finalizar** (`EN_PROCESO`): trabajo realizado, ejecución, fecha de fin opcional y, **solo si hay período abierto**, la pregunta "¿La máquina ya puede funcionar?" Sí / No. Si el usuario no tiene `INTERVENCIONES_CONFIRMAR_RECUPERACION`, el "Sí" aparece deshabilitado con una aclaración.
  - **Resolver ahora** (`PENDIENTE`): lo mismo, más fecha de inicio obligatoria.
  - **Cancelar** (`PENDIENTE`, `EN_PROCESO`, `EN_ESPERA_REPUESTOS`): motivo y, si hay período abierto, la misma pregunta.
  - **Registrar detención**: si está abierta y sin período abierto.
  - Mostrar `trabajo_realizado`, `ejecucion` y `tiempo_inactividad_minutos`.
- `Maquinas.tsx`:
  - Panel "Detenciones abiertas" con casillas para elegir períodos y el botón **Confirmar recuperación**.
  - Botones **Fuera de servicio** / **Reactivar**, con motivo.
- Si la dev-ui necesita saber los permisos del usuario y no existe un endpoint, usar el que ya exista en `auth` o mostrar todos los botones y dejar que la API rechace. **No** crear endpoints nuevos de permisos (eso es Etapa 11).
- Las fechas que envía la dev-ui deben llevar zona horaria (`new Date(valorDelInput).toISOString()`).

---

## 9. Pruebas de aceptación

Archivo `backend/tests/motor_cierres.test.ts`, script `test:cierres`. Mismas reglas que en 4A: bloqueo de rama aislada, resultados esperados escritos a mano, y verificar la base además del código HTTP. Para simular horarios (08:00, 12:00…) se permite ajustar `desde` y `fecha_inicio` por SQL en el setup.

### 9.1 Finalizar (T6)

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| B-01 | Finalizar una intervención sin detención | 200. `FINALIZADA`, `fecha_finalizacion`, `trabajo_realizado`, `ejecucion` guardados; 1 fila de historial; máquina sin cambios; `periodo: null`. |
| B-02 | Validaciones: sin `trabajo_realizado`; `ejecucion` inválida; `fecha_finalizacion` < `fecha_inicio`; fecha futura; fecha sin zona | 422 con el código de cada caso. Nada cambia. |
| B-03 | Con período abierto y sin `maquina_recuperada` | 422 `DECISION_RECUPERACION_REQUERIDA`. Nada cambia. |
| B-04 | Con período abierto, `maquina_recuperada = true`, sin `fecha_recuperacion` | 200. Período cerrado con `hasta = fecha_finalizacion` y `confirmado_por`; `tiempo_inactividad_minutos` correcto; máquina `OPERATIVA`. |
| B-05 | `maquina_recuperada = true` con `CONFIRMAR_RECUPERACION` denegado por excepción | 403 `CONFIRMACION_NO_PERMITIDA`. **Ni** el estado **ni** el período cambian. |
| B-06 | `maquina_recuperada = false` (era `EN_MANTENIMIENTO`) | 200. `FINALIZADA`; período abierto; máquina `DETENIDA`. |
| B-07 | Finaliza alguien que no es el responsable y no tiene `ASIGNAR` | 403 `NO_ES_RESPONSABLE`. |
| B-08 | Finalizar desde `EN_ESPERA_REPUESTOS` | 409 `TRANSICION_NO_PERMITIDA`. |

### 9.2 Ejemplos del análisis (sección 4.6)

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| B-09 | **Ejemplo 1**: A detiene; B no detiene; se finaliza B; A pasa a `EN_PROCESO`; A se finaliza con recuperación | Máquina: `DETENIDA` → (B finalizada) `DETENIDA` → `EN_MANTENIMIENTO` → `OPERATIVA`. Historial de máquina: exactamente `OPERATIVA→DETENIDA`, `DETENIDA→EN_MANTENIMIENTO`, `EN_MANTENIMIENTO→OPERATIVA`. |
| B-10 | **Ejemplo 2**: A y B detienen; se finaliza A con recuperación; luego B con recuperación | Después de A: `DETENIDA` (**nunca** `OPERATIVA` mientras B siga abierta). Después de B: `OPERATIVA`. |
| B-11 | **Ejemplo 3**: A se finaliza con "no recuperada"; luego "Confirmar recuperación" de su período | Tras finalizar: `FINALIZADA` + período abierto + `DETENIDA`. Tras confirmar: `OPERATIVA`, período cerrado con la fecha de la confirmación. |
| B-12 | **Ejemplo 5**: A y B `EN_PROCESO`, ambas con período; se finalizan **simultáneamente** con recuperación (`Promise.all`) | Ambas 200. Máquina `OPERATIVA`. Una sola fila `→ OPERATIVA` en el historial de máquina, y es la última. Ningún período queda abierto. |

### 9.3 Resolver ahora (T2)

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| B-13 | `PENDIENTE` sin responsable ni detención, usuario con `ASIGNARSE` | 200. `FINALIZADA`; responsable = el usuario (auditoría `ASIGNACION`); exactamente 2 filas de historial en el orden `PENDIENTE→EN_PROCESO`, `EN_PROCESO→FINALIZADA`. |
| B-14 | Con detención y recuperación | Historial de máquina: `DETENIDA→OPERATIVA` directo; **ninguna** fila con `EN_MANTENIMIENTO`. |
| B-15 | Sin `fecha_inicio`; `fecha_inicio` > `fecha_finalizacion`; `fecha_inicio` < `fecha_creacion` | 422 en los tres. Nada cambia. |
| B-16 | Usuario sin `FINALIZAR` | 403. |

### 9.4 Cancelar (T3, T7, T8)

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| B-17 | Cancelar desde `PENDIENTE`, `EN_PROCESO` y `EN_ESPERA_REPUESTOS`, con motivo | 200 en los tres; `CANCELADA`; motivo en el historial. |
| B-18 | Sin motivo o con menos de 5 caracteres | 422 `MOTIVO_REQUERIDO`. |
| B-19 | T7 conserva lo cargado | `responsable`, `fecha_inicio` y la auditoría siguen igual; `fecha_finalizacion` nula. |
| B-20 | Cancela un usuario con `CANCELAR` que no es el responsable ni tiene `ASIGNAR` | 200 (D-28). |
| B-21 | Con período abierto, `maquina_recuperada = false` | Período abierto, máquina `DETENIDA`. Luego confirmar recuperación → `OPERATIVA`. |
| B-22 | Cancelar una `FINALIZADA` o `CANCELADA` | 409 `TRANSICION_NO_PERMITIDA`. |

### 9.5 Confirmar recuperación y detenciones

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| B-23 | Dos períodos abiertos; se confirma uno | Máquina sigue `DETENIDA`. Se confirma el otro → `OPERATIVA`. |
| B-24 | `periodo_ids` con: uno de otra máquina, uno ya cerrado, uno inexistente, uno de intervención no visible (cada caso junto con uno válido) | 422 `PERIODO_INVALIDO` en cada caso; el período válido **tampoco** se cierra. |
| B-25 | Usuario sin `CONFIRMAR_RECUPERACION` | 403. |
| B-26 | `fecha_recuperacion` anterior a `desde`, o futura | 422 `FECHA_INCOHERENTE`. |
| B-27 | Confirmar con la intervención todavía `EN_PROCESO` (D-31) y después finalizarla sin `maquina_recuperada` | Confirmación 200 → `OPERATIVA`. Finalización 200 con `periodo: null`. |
| B-28 | `tiempo_inactividad_minutos`: período con `desde` 4 h antes, cerrado ahora; segundo período de la misma intervención (insertado cerrado por SQL, 2 h) | Tras cerrar: 240. Con el segundo período agregado y un nuevo cierre: 360 (el hueco no cuenta). |
| B-29 | `GET /detenciones-abiertas` con un usuario de alcance `SECTORES` | Solo los períodos de intervenciones que puede ver. |
| B-30 | Registrar detención en `EN_PROCESO` sin período; en `PENDIENTE` sin período | `EN_MANTENIMIENTO` y `DETENIDA` respectivamente; período abierto con el `desde` indicado. |
| B-31 | Registrar detención con período ya abierto; en una `FINALIZADA` | 409 `DETENCION_YA_ABIERTA`; 409 `TRANSICION_NO_PERMITIDA`. |

### 9.6 Estado manual de máquina

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| B-32 | `FUERA_DE_SERVICIO` desde `OPERATIVA` con motivo; sin motivo; sin permiso | 200 con historial (`intervencion_id` nulo); 422; 403. |
| B-33 | Máquina `FUERA_DE_SERVICIO` con período abierto: iniciar, finalizar con recuperación | La máquina sigue `FUERA_DE_SERVICIO` en todo momento; el período se cierra igual. |
| B-34 | `REACTIVAR` desde `FUERA_DE_SERVICIO` (a) con período abierto de intervención en espera, (b) con una `EN_PROCESO` con período, (c) sin períodos | (a) `DETENIDA`; (b) `EN_MANTENIMIENTO`; (c) `OPERATIVA`. Una fila de historial en cada caso. |
| B-35 | `REACTIVAR` desde `DETENIDA` (a) con períodos abiertos, (b) sin períodos (setup por SQL) | (a) 409 `MAQUINA_CON_DETENCIONES_ABIERTAS`; (b) `OPERATIVA`. |

### 9.7 Matriz, atomicidad y regresión

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| B-36 | **Matriz** estado × acción (abajo) | Exactamente los códigos de la matriz. |
| B-37 | Trigger temporal que falla al cerrar el período (`UPDATE` de `intervencion_periodos_detencion`) durante un finalizar con recuperación | 500. Intervención sigue `EN_PROCESO`, sin fila nueva de historial, período abierto, máquina sin cambios, `tiempo_inactividad_minutos` sin cambios. |
| B-38 | Suites anteriores (`test:e2e`, `test:migration`, `test:permisos`, `test:intervenciones`, `test:migration-005`, `test:motor`), `test:migration-006`, `npm run typecheck` | Todo verde. Listar los tests anteriores modificados (al menos el setup de `FINALIZADA` en P-13) y por qué. |

Matriz de B-36 (con datos válidos y el `estado_esperado` correcto):

| Estado actual | finalizar | resolver-ahora | cancelar | registrar-detencion |
| :--- | :-: | :-: | :-: | :-: |
| `PENDIENTE` | 409 | 200 | 200 | 200 |
| `EN_PROCESO` | 200 | 409 | 200 | 200 |
| `EN_ESPERA_REPUESTOS` | 409 | 409 | 200 | 200 |
| `FINALIZADA` | 409 | 409 | 409 | 409 |
| `CANCELADA` | 409 | 409 | 409 | 409 |

---

## 10. Criterios de cierre

1. Migración 006 aplicada **solo** en la rama de pruebas y su test pasa.
2. B-01 a B-38 pasan.
3. Documentación de la sección 1 actualizada.
4. Commit y push en `feat/base-neon`.

---

## 11. Informe a entregar

1. Archivos creados y modificados.
2. Salida completa de **todas** las suites y del typecheck (no resúmenes).
3. Tests anteriores modificados y motivo.
4. **Todos** los desvíos respecto de este documento, incluidos cambios fuera de alcance y cambios de códigos HTTP o de error.
5. Dudas o decisiones abiertas.
