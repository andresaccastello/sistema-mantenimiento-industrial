# Etapa 6 — Reapertura, eliminación lógica y edición de intervenciones

> **Estado:** requerimiento para implementar.
> **Requisito previo:** Etapa 4 cerrada (commit `0ec8f80` o posterior).
> **Base:** `docs/analisis-intervenciones.md` (v3), `docs/etapas/etapa-4a-motor-estados.md`, `docs/etapas/etapa-4b-cierres.md` y el código actual del motor.

---

## 0. Reglas de trabajo

Las mismas de las etapas 4A y 4B:

1. Rama `feat/base-neon`; nada en `main`.
2. Migraciones y tests **solo** en la rama aislada de Neon.
3. Nada fuera del alcance de la sección 2. Ante ambigüedad o contradicción con el código, **detenerse y preguntar**.
4. SQL visible con `pg`, sin ORM; migraciones idempotentes; tests con `node:test` + `app.request(...)`.
5. Fechas: siempre `validarFechaISO` y `NOW()` de PostgreSQL.
6. **Todo** cambio de estado pasa por el motor: `conTransaccion`, `bloquearIntervencion`, la tabla `TRANSICIONES`, `aplicarReglaActor`, `registrarCambioEstado`, `recalcularEstadoMaquina`, `registrarNotificaciones`.
7. El informe (sección 11) describe **solo lo que está en el código** y declara todo desvío, incluidos cambios no pedidos y cambios de códigos HTTP o de error.

---

## 1. Paso previo: documentación

### 1.1 `docs/analisis-intervenciones.md`, sección 11

Agregar:

| ID | Decisión | Resolución |
| :-: | :--- | :--- |
| D-33 | Edición de datos de una intervención abierta (M-RF-07, D-14) | **Aprobada:** endpoint de edición de `descripcion` y `observaciones` con `INTERVENCIONES_EDITAR`. El alcance del permiso define qué se puede editar: `TODAS` / `SECTORES` = cualquier intervención abierta visible; `PROPIAS` = solo las creadas por el usuario, en `PENDIENTE` y sin responsable (D-14). El operario recibe `INTERVENCIONES_EDITAR` con alcance `PROPIAS` por defecto. No se cambia la máquina: si se eligió mal, se elimina lógicamente y se registra de nuevo (E5). |
| D-34 | Período abierto al eliminar lógicamente | **Aprobada:** al eliminar, el período abierto **siempre** se cierra (la detención de un registro equivocado no debe contar). La decisión `maquina_recuperada` define solo el recálculo: `true` permite volver a `OPERATIVA` (exige `INTERVENCIONES_CONFIRMAR_RECUPERACION`); `false` deja la máquina como está, a la espera de la intervención correcta. |
| D-35 | Datos de cierre al reabrir | **Aprobada:** reabrir limpia solo `fecha_finalizacion` (D-09). `trabajo_realizado` y `ejecucion` se conservan; al volver a finalizar, si cambian, el valor anterior queda en la auditoría. |

### 1.2 Guardar este archivo

Como `docs/etapas/etapa-6-reapertura-eliminacion.md`.

---

## 2. Alcance

### Incluido

- Migración `007_reapertura_edicion.sql` (sección 3).
- T9 "Reabrir" en la tabla de transiciones (sección 4).
- Endpoint de reapertura (sección 5).
- Endpoint de eliminación lógica y consulta de eliminadas (sección 6).
- Endpoint de edición (sección 7).
- Auditoría de `trabajo_realizado` / `ejecucion` al volver a finalizar (sección 5.4).
- Dev-ui mínima (sección 8).
- Pruebas (sección 9).

### Excluido

- Correcciones de intervenciones finalizadas (fechas, costos) → Etapa 10.
- Notificaciones reales → Etapa 7.
- Exclusión de intervenciones eliminadas en reportes → Etapa 8 (dejar anotado).
- Repuestos y costos → Etapas 9 y 12 (los criterios de eliminación los consultan igual, sección 6.2).

---

## 3. Migración `database/migrations/007_reapertura_edicion.sql`

Idempotente y en una transacción.

1. Ampliar `ck_intervencion_auditoria_evento` agregando `'EDICION'` a la lista actual (`ASIGNACION`, `DESASIGNACION`, `CORRECCION_FECHA`, `CORRECCION_COSTO`, `ELIMINACION_LOGICA`, `REAPERTURA`, `OTRO`). Se hace con `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` dentro de la transacción.
2. Dar al perfil `OPERARIO` el permiso `INTERVENCIONES_EDITAR` con alcance `PROPIAS` (`INSERT ... ON CONFLICT (perfil_id, permiso_id) DO NOTHING`, para no pisar una configuración que el administrador haya cambiado).

Test `backend/tests/migration_007.test.ts`: el `CHECK` acepta `EDICION` y sigue rechazando un evento inexistente; el operario tiene `INTERVENCIONES_EDITAR` con `PROPIAS`.

---

## 4. Tabla de transiciones

Agregar a `TRANSICIONES`:

| Acción | Código | Desde | Hacia | Permiso | `requiereActor` | `validaHabilitacion` |
| :--- | :-: | :--- | :--- | :--- | :-: | :-: |
| `REABRIR` | T9 | `FINALIZADA` | `EN_PROCESO` | `INTERVENCIONES_REABRIR` | `false` | `false` |

- Reabrir es una decisión de supervisión ("la falla persiste"), no del técnico: no aplica la regla de actor.
- La intervención vuelve a `EN_PROCESO` con su responsable anterior. Si ese responsable ya no está habilitado, el trabajo sigue igual (D-32) y un supervisor puede reasignarlo.
- `CANCELADA` no se reabre: no debe haber ninguna fila con `desde = 'CANCELADA'`.

---

## 5. Reabrir (T9) — `POST /api/intervenciones/:id/reabrir`

### 5.1 Body

```json
{
  "estado_esperado": "FINALIZADA",
  "motivo": "texto",
  "maquina_detenida": true,
  "desde": "<opcional, ISO con zona>",
  "observacion_detencion": "<opcional>"
}
```

### 5.2 Reglas

1. Mismo patrón que los cierres: permiso de la fila (antes de bloquear) → `bloquearIntervencion` → `estado_esperado` → fila por `desde` → validaciones → mutaciones → **un** recálculo → eventos.
2. `motivo` obligatorio, mínimo 5 → `422 MOTIVO_REQUERIDO`. Va como `observacion` del historial (`FINALIZADA → EN_PROCESO`).
3. **Período de detención (E9, ejemplo 4):**
   - **Si la intervención tiene un período abierto** (finalizada sin recuperación, E7): el período continúa sin cambios. `maquina_detenida` y `desde` se ignoran.
   - **Si no tiene período abierto:** `maquina_detenida` es obligatorio (boolean) → si falta, `422 DECISION_DETENCION_REQUERIDA`.
     - `true`: se abre un **período nuevo**. `desde` por defecto `NOW()`; debe ser `>=` el `hasta` del último período cerrado de la intervención (si tiene) y `>= fecha_creacion`, y `<= NOW()` → si no, `422 FECHA_INCOHERENTE`. Los períodos anteriores **no** se modifican.
     - `false`: no se abre nada.
4. Mutaciones:
   - `estado = EN_PROCESO`, `fecha_finalizacion = NULL` (con `registrarCambioEstado`).
   - Auditoría `REAPERTURA`, campo `fecha_finalizacion`, valor anterior = la fecha previa, valor nuevo `NULL`, motivo.
   - `fecha_inicio`, `trabajo_realizado`, `ejecucion`, responsable, períodos cerrados y `tiempo_inactividad_minutos` **no cambian** (RN-30, D-35).
5. Recalcular la máquina (con período abierto y `EN_PROCESO` → `EN_MANTENIMIENTO`; `FUERA_DE_SERVICIO` no cambia).
6. Eventos: `INTERVENCION_REABIERTA` y, si se abrió período, `DETENCION_REGISTRADA`.

### 5.3 Respuesta

Mismo formato que finalizar, con `periodo` = el período abierto vigente después de reabrir (o `null`).

### 5.4 Volver a finalizar después de reabrir

En `finalizarIntervencionServicio` (y `resolverAhora` no aplica, porque arranca en `PENDIENTE`):

- Si `trabajo_realizado` ya tenía valor y el nuevo es distinto → auditoría `OTRO`, campo `trabajo_realizado`, valores anterior y nuevo, motivo "Nueva finalización tras reapertura".
- Lo mismo para `ejecucion`.
- El resto de la finalización no cambia.

---

## 6. Eliminación lógica — `POST /api/intervenciones/:id/eliminar`

### 6.1 Body

```json
{
  "motivo": "texto",
  "maquina_recuperada": true,
  "observacion_recuperacion": "<opcional>"
}
```

No lleva `estado_esperado`: solo se puede eliminar en `PENDIENTE`, y esa es la validación.

### 6.2 Reglas

1. Permiso `INTERVENCIONES_ELIMINAR` (antes de bloquear) → `bloquearIntervencion` (una ya eliminada da 404).
2. `motivo` obligatorio, mínimo 5 → `422 MOTIVO_REQUERIDO`.
3. **Sin actividad relevante (RN-21, RN-24, RN-26, RN-28).** Se evalúan **todas** las condiciones y, si alguna falla, se responde `409 ELIMINACION_NO_PERMITIDA` con la lista completa en `motivos` (por ejemplo `["ESTADO_NO_PENDIENTE", "TIENE_COSTOS"]`):

| Código | Condición que impide eliminar |
| :--- | :--- |
| `ESTADO_NO_PENDIENTE` | `estado != 'PENDIENTE'` (incluye `FINALIZADA` y `CANCELADA`) |
| `TIENE_FECHA_INICIO` | `fecha_inicio IS NOT NULL` |
| `TIENE_COSTOS` | existe algún renglón en `intervencion_costos` (aunque esté anulado) |
| `TIENE_REPUESTOS` | existe alguna fila en `intervencion_repuestos` |
| `TIENE_MOVIMIENTOS_STOCK` | existe algún `movimientos_stock` con esa `intervencion_id` |
| `TIENE_DOCUMENTOS` | existe algún `documentos` con esa `intervencion_id` |
| `TIENE_HISTORIAL` | el historial tiene más filas que la inicial (`NULL → PENDIENTE`) |

   La asignación de responsable **no** impide eliminar (no es trabajo).

4. **Período abierto (D-34):**
   - Sin período abierto: `maquina_recuperada` se ignora.
   - Con período abierto: `maquina_recuperada` obligatorio → si falta, `422 DECISION_RECUPERACION_REQUERIDA`. Si es `true`, exige `INTERVENCIONES_CONFIRMAR_RECUPERACION` → si no, `403 CONFIRMACION_NO_PERMITIDA`.
   - En ambos casos el período se **cierra**: `hasta = NOW()`, `confirmado_por_usuario_id` = quien elimina, `observacion_confirmacion` = "Cerrado por eliminación lógica" + la observación si viene.
   - Recalcular la máquina con `confirmacion = maquina_recuperada`.
5. Mutaciones: `eliminado_en = NOW()`, `eliminado_por_usuario_id`, `motivo_eliminacion` (el `CHECK` de la 003 ya los exige juntos). **No** cambia `estado` ni escribe historial de estados. Auditoría `ELIMINACION_LOGICA` con el motivo.
6. Evento `INTERVENCION_ELIMINADA`.
7. **No** se agrega ningún borrado físico (RN-27).

### 6.3 Consultar eliminadas

`GET /api/intervenciones?incluir_eliminadas=true`:

- Requiere además `INTERVENCIONES_ELIMINAR`; sin ese permiso → `403 PERMISO_INSUFICIENTE`.
- Agrega las eliminadas al listado (respetando el alcance de `INTERVENCIONES_VER`) con `eliminada: true`, `eliminado_en`, `eliminado_por` (id, legajo, nombre) y `motivo_eliminacion`.
- `GET /:id` de una eliminada sigue dando 404 (no se cambia).

---

## 7. Edición — `PATCH /api/intervenciones/:id`

### 7.1 Body

```json
{ "estado_esperado": "PENDIENTE", "descripcion": "<opcional>", "observaciones": "<opcional>" }
```

### 7.2 Reglas (D-33)

1. Permiso `INTERVENCIONES_EDITAR` → `bloquearIntervencion` → `estado_esperado`.
2. Estados editables: `PENDIENTE`, `EN_PROCESO`, `EN_ESPERA_REPUESTOS`. `FINALIZADA` / `CANCELADA` → `409 EDICION_NO_PERMITIDA` (las correcciones de finalizadas son la Etapa 10).
3. Alcance de `INTERVENCIONES_EDITAR`:
   - `TODAS` / `SECTORES`: cualquier intervención abierta que el usuario pueda ver (para `SECTORES`, además, del sector de la máquina).
   - `PROPIAS`: solo si la creó el usuario **y** está `PENDIENTE` **y** sin responsable. Si no → `403 EDICION_NO_PERMITIDA`.
4. Campos aceptados: solo `descripcion` y `observaciones`. Cualquier otro campo (`maquina_id`, `estado`, `responsable_usuario_id`, fechas…) → `422 DATOS_INVALIDOS` indicando el campo. Body sin ninguno de los dos → `422 DATOS_INVALIDOS`.
5. Validaciones: `descripcion` 5 a 2000 caracteres; `observaciones` hasta 2000 (vacía permitida, se guarda `NULL`).
6. Si ningún valor cambia → `422 SIN_CAMBIOS`.
7. Una fila de auditoría `EDICION` **por campo cambiado**, con valor anterior y nuevo.
8. No cambia estado, historial, períodos ni máquina. `actualizado_en = NOW()`.

---

## 8. Dev-ui (mínimo, provisional)

- **Reabrir** (`FINALIZADA`): motivo y, si no hay período abierto, la pregunta "¿La máquina volvió a detenerse?" Sí / No, con fecha "desde" opcional.
- **Eliminar** (`PENDIENTE`): motivo y, si hay período abierto, la pregunta de recuperación. Si la API responde `ELIMINACION_NO_PERMITIDA`, mostrar los `motivos` en lenguaje claro.
- **Editar**: descripción y observaciones, en los estados editables.
- Listado: casilla "Incluir eliminadas" (si la API responde 403, ocultarla), con las eliminadas marcadas.
- Mostrar en el detalle las filas de auditoría `REAPERTURA`, `ELIMINACION_LOGICA`, `EDICION` y `OTRO`.

---

## 9. Pruebas de aceptación

Archivo `backend/tests/reapertura_eliminacion.test.ts`, script `test:etapa6`. Mismas reglas: resultados escritos a mano y verificación de la base además del HTTP. Horarios simulados con SQL en el setup.

### 9.1 Reabrir

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| R-01 | `FINALIZADA` sin períodos; reabrir con `maquina_detenida = false` | 200. `EN_PROCESO`; `fecha_finalizacion` nula; `trabajo_realizado`, `ejecucion`, `fecha_inicio` y responsable intactos; historial `FINALIZADA→EN_PROCESO` con el motivo; auditoría `REAPERTURA` con la fecha anterior; máquina sin cambios. |
| R-02 | Sin motivo / menos de 5 | 422 `MOTIVO_REQUERIDO`. |
| R-03 | Usuario sin `REABRIR` | 403. |
| R-04 | Reabrir desde `PENDIENTE`, `EN_PROCESO`, `EN_ESPERA_REPUESTOS`, `CANCELADA` | 409 `TRANSICION_NO_PERMITIDA` en los cuatro. |
| R-05 | `FINALIZADA` con período **todavía abierto** (E7) | 200. El **mismo** período sigue abierto (mismo id, mismo `desde`); máquina `DETENIDA → EN_MANTENIMIENTO`; `maquina_detenida` ignorado. |
| R-06 | **Ejemplo 4 completo**: A detiene 08:00; finaliza 12:00 con recuperación; reabre 15:00 con `maquina_detenida = true`, `desde` 15:00; finaliza 17:00 con recuperación | Máquina `DETENIDA → OPERATIVA → EN_MANTENIMIENTO → OPERATIVA`. Dos períodos (08–12 y 15–17); el primero no cambió. `tiempo_inactividad_minutos = 360` (el hueco 12–15 no cuenta). |
| R-07 | Sin período abierto y sin `maquina_detenida` | 422 `DECISION_DETENCION_REQUERIDA`. Nada cambia. |
| R-08 | `desde` anterior al `hasta` del último período; `desde` futura | 422 `FECHA_INCOHERENTE`. |
| R-09 | Reabrir y volver a finalizar con otro `trabajo_realizado` y otra `ejecucion` | Dos filas de auditoría `OTRO` con valores anterior y nuevo. |
| R-10 | Máquina `FUERA_DE_SERVICIO`; reabrir con `maquina_detenida = true` | Período abierto; la máquina sigue `FUERA_DE_SERVICIO`. |
| R-11 | Dos reabrir simultáneos | Un 200 y un 409 `ESTADO_DESACTUALIZADO`; una sola fila nueva de historial. |

### 9.2 Eliminación lógica

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| E-01 | `PENDIENTE` sin actividad ni detención (con responsable asignado) | 200. Campos de eliminación completos; auditoría `ELIMINACION_LOGICA`; no aparece en `GET /`; `GET /:id` 404; estado sigue `PENDIENTE`; ninguna fila nueva de historial de estados. |
| E-02 | Con período abierto, `maquina_recuperada = true`, sin otras causas | Período cerrado (`hasta`, `confirmado_por`, observación "Cerrado por eliminación lógica"); máquina `OPERATIVA`. |
| E-03 | Igual, pero otra intervención también detiene la máquina | Período de la eliminada cerrado; máquina sigue `DETENIDA`. |
| E-04 | Con período abierto, `maquina_recuperada = false` | Período cerrado; máquina sigue `DETENIDA`. Luego `REACTIVAR` (D-30) → `OPERATIVA`. |
| E-05 | Con período abierto: sin decisión; con `true` y sin `CONFIRMAR_RECUPERACION` | 422 `DECISION_RECUPERACION_REQUERIDA`; 403 `CONFIRMACION_NO_PERMITIDA`. Nada cambia. |
| E-06 | Bloqueos (setup por SQL o API): `EN_PROCESO`; `FINALIZADA`; `CANCELADA`; con renglón de costo anulado; con repuesto; con documento; con varias causas a la vez | 409 `ELIMINACION_NO_PERMITIDA` con `motivos` exactos en cada caso (en el último, todos los que correspondan). |
| E-07 | Sin motivo; sin permiso `ELIMINAR` | 422; 403. |
| E-08 | Eliminar una ya eliminada | 404. |
| E-09 | `GET /?incluir_eliminadas=true` con y sin `ELIMINAR`; usuario con `VER` alcance `SECTORES` | Con permiso: aparece con los datos de eliminación; sin permiso: 403; con `SECTORES`: solo las de sus sectores. |
| E-10 | Fallo forzado (trigger) al insertar la auditoría de eliminación | 500 y nada cambia: no eliminada, período abierto, máquina igual. |

### 9.3 Edición

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| D-01 | Responsable edita `descripcion` y `observaciones` de una `EN_PROCESO` | 200. Dos filas `EDICION` con anterior y nuevo. Estado, historial y máquina sin cambios. |
| D-02 | Operario edita su propia `PENDIENTE` sin responsable | 200. |
| D-03 | Operario edita su propia `PENDIENTE` ya tomada; una ajena | 403 `EDICION_NO_PERMITIDA`; 404 (no la ve). |
| D-04 | Editar `FINALIZADA` / `CANCELADA` | 409 `EDICION_NO_PERMITIDA`. |
| D-05 | Body con `maquina_id` o `estado`; body vacío; `descripcion` de 3 caracteres | 422 `DATOS_INVALIDOS` en los tres. |
| D-06 | Mismos valores que los actuales | 422 `SIN_CAMBIOS`. |
| D-07 | Operario con `EDITAR` denegado por excepción | 403. |

### 9.4 Matriz y regresión

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| M-01 | Matriz estado × acción (abajo), con datos válidos | Exactamente los códigos de la matriz. |
| M-02 | Todas las suites anteriores + `test:migration-007` + `test:etapa6` + typecheck | Todo verde. Listar cualquier test anterior modificado y por qué. |

| Estado actual | reabrir | eliminar (sin actividad) | editar (responsable) |
| :--- | :-: | :-: | :-: |
| `PENDIENTE` | 409 | 200 | 200 |
| `EN_PROCESO` | 409 | 409 | 200 |
| `EN_ESPERA_REPUESTOS` | 409 | 409 | 200 |
| `FINALIZADA` | 200 | 409 | 409 |
| `CANCELADA` | 409 | 409 | 409 |

---

## 10. Criterios de cierre

1. Migración 007 aplicada **solo** en la rama de pruebas y su test pasa.
2. R-01 a R-11, E-01 a E-10, D-01 a D-07, M-01 y M-02 pasan.
3. Documentación de la sección 1 actualizada.
4. Commit y push en `feat/base-neon`.

---

## 11. Informe a entregar

1. Archivos creados y modificados.
2. Salida completa de **todas** las suites y del typecheck.
3. Tests anteriores modificados y motivo.
4. **Todos** los desvíos, incluidos cambios no pedidos.
5. Dudas o decisiones abiertas.
