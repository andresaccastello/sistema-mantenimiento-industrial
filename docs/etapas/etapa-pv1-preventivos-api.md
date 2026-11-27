# Etapa PV1 — Preventivos por calendario: la API

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `824369c` (Etapa C1.2.2).
> **Origen:** `docs/relevamiento-requisitos-derivados.md`, requisitos 5 y 8; D-008 ("Preventivos básicos"). En la planilla del caso de estudio, el 98 % del trabajo es correctivo: este módulo es el que tiene que cambiar eso.

**Qué entra:** planes preventivos por máquina, armados con tareas que vencen por calendario; la lista de vencimientos; generar desde un plan una intervención `PREVENTIVO`, con sus tareas para marcar; y la próxima fecha, que se recalcula sola cuando se finaliza la intervención.

**Qué no entra:** se hace en etapas siguientes.

| Etapa | Qué |
| :--- | :--- |
| PV2 | Las pantallas: planes en la ficha de la máquina, la pantalla de vencimientos y las tareas en la intervención. |
| PV3 | Medidores por máquina (horas, kilómetros, ciclos), disparadores por uso y por condición, y "lo que llegue primero" (requisito 6). |
| PV4 | Revisiones de rutina del operario (requisito 7). |
| PV5 | Generación automática con un disparador programado, y avisos de vencimiento. |

Tampoco entran el día fijo de la semana, copiar un plan a otra máquina ni el indicador de cumplimiento en los reportes.

**Esta etapa no tiene pantallas.** Del front, solo los tipos y el ejemplo del contrato (sección 7).

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Tres commits:**

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1, 2 y 3 | `feat(db): planes y tareas preventivas` |
   | 2 | 4, 5, y de la 8, PV-01 a PV-05 | `feat(api): planes preventivos y vencimientos` |
   | 3 | 6, 7, y de la 8, PV-06 a PV-12 y la 8.3 | `feat(api): intervenciones preventivas desde un plan` |

3. **Pruebas:**
   - solo `test:migration-018`, `test:preventivos`, `test:intervenciones`, `test:ids` y `test:front`;
   - **no correr `test:todo`:** va en la corrida de la noche;
   - las pruebas existentes no se modifican, salvo la lista de rutas de ID-01 (sección 8.3).
4. **Si una prueba existente compara las claves exactas** de la lista o del detalle de una intervención, frenar y avisar: la sección 6.4 les agrega `tipo` y `plan`.
5. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-pv1-preventivos-api.md`.

---

## 1. Reglas: D-021 (primer commit)

Agregar a `docs/decisiones.md`:

> **D-021 — Preventivos por calendario**
>
> **Estado:** Aceptada
>
> 1. **Un plan es de una máquina** y tiene tareas. Cada tarea tiene su frecuencia: cada N días, semanas, meses o años. Una máquina puede tener varios planes, por ejemplo uno mecánico y uno eléctrico, cada uno con su responsable.
> 2. **La próxima fecha se calcula, no se guarda.** Es la última ejecución más la frecuencia; sin ejecuciones, la primera fecha que se cargó. La última ejecución es la fecha de finalización de la última intervención finalizada, no eliminada, con esa tarea marcada como hecha. Así, reabrir, cancelar, eliminar o corregir la fecha de una intervención mueve la próxima fecha sin ningún paso extra.
> 3. **Se cuenta desde la última ejecución,** no desde la fecha que tocaba. Si un cambio de aceite cada 6 meses se hizo con un mes de atraso, el próximo es 6 meses después de cuando se hizo.
> 4. **La intervención se genera a pedido.** Un usuario con `PLANES_GESTIONAR` genera, desde el plan, una intervención `PREVENTIVO` con las tareas que vencen. Sigue el mismo circuito que una correctiva: estados, tiempos, repuestos, costos y detenciones. La generación automática y los avisos de vencimiento quedan para la PV5, porque necesitan un disparador programado y un autor que no es una persona.
> 5. **Una tarea está en una sola intervención abierta a la vez.** Mientras está en una, no se vuelve a generar.
> 6. **"Hoy" es el de la instalación,** según su zona horaria (`configuracion_sistema.zona_horaria`), no el del servidor.

**Motivo:** cumplir los requisitos 5 y 8 con lo mínimo que funciona de punta a punta, y dejar el modelo listo para los medidores (PV3).

Actualizar también `docs/modelo-datos.md`: la descripción de `planes_mantenimiento` y las dos tablas nuevas.

---

## 2. Migración 018 (primer commit)

`database/migrations/018_preventivos.sql`. Como todas: se puede aplicar varias veces, y con datos cargados no pierde nada.

### 2.1 `configuracion_sistema`

| Columna | Tipo |
| :--- | :--- |
| `zona_horaria` | `text`, no nulo, por omisión `'America/Argentina/Buenos_Aires'`. Esta etapa no la cambia desde la API. |

### 2.2 `planes_mantenimiento`, rehecha

La tabla existe desde la 001 y nunca se usó.

- **Si todavía tiene la columna `criterio` y tiene filas,** la migración falla, con un mensaje que incluye los ids. Si no, se sacan `criterio`, `frecuencia_valor`, `frecuencia_unidad`, `proxima_fecha`, `proximo_valor_objetivo` y `observaciones`, con sus restricciones y el índice `idx_planes_proxima_fecha`.
- **Quedan** `id`, `maquina_id`, `responsable_usuario_id`, `nombre`, `descripcion`, `activo`, `creado_en` y `actualizado_en`.

| Columna nueva | Tipo |
| :--- | :--- |
| `anticipacion_dias` | `integer`, no nulo, por omisión 7, de 0 a 90. Cuántos días antes la tarea pasa a "próxima". |
| `creado_por_usuario_id` | FK a `usuarios`, no nulo. |

**Único:** `(maquina_id, lower(nombre))`.

### 2.3 `plan_tareas`, nueva

| Columna | Tipo |
| :--- | :--- |
| `id` | `bigint` identidad |
| `plan_id` | FK a `planes_mantenimiento`, no nulo |
| `orden` | `integer`, no nulo. Único con `plan_id`. |
| `accion` | `varchar(200)`, no nulo: qué hay que hacer. |
| `detalle` | `text` nulo: instrucciones. |
| `frecuencia_valor` | `integer`, no nulo |
| `frecuencia_unidad` | `DIAS`, `SEMANAS`, `MESES` o `ANIOS` |
| `primera_fecha` | `date`, no nulo: cuándo vence por primera vez. |
| `repuesto_id` | FK a `repuestos`, nulo: el repuesto sugerido. |
| `cantidad` | `numeric(14,3)` nulo, mayor que 0. Va si y solo si va `repuesto_id`. |
| `proveedor_id` | FK a `proveedores`, nulo: el proveedor sugerido. |
| `activo` | `boolean`, no nulo, por omisión `true` |
| `creado_en`, `actualizado_en` | `timestamptz` |

**La frecuencia, hasta 10 años:** de 1 a 3650 días, 520 semanas, 120 meses o 10 años, según la unidad.

### 2.4 `intervencion_tareas`, nueva

Las tareas de una intervención preventiva. Se copian del plan al generarla, para que cambiar el plan después no cambie lo que se hizo.

| Columna | Tipo |
| :--- | :--- |
| `id` | `bigint` identidad |
| `intervencion_id` | FK a `intervenciones`, no nulo |
| `plan_tarea_id` | FK a `plan_tareas`, no nulo. Único con `intervencion_id`. Con índice. |
| `orden` | `integer`, no nulo |
| `accion`, `detalle` | copiados de la tarea |
| `fecha_programada` | `date`, no nulo: la próxima fecha de la tarea al generar. |
| `hecha` | `boolean`, no nulo, por omisión `false` |
| `hecha_por_usuario_id` | FK a `usuarios`, nulo |
| `hecha_en` | `timestamptz` nulo |
| `observacion` | `varchar(500)` nulo |

**Coherencia:** con `hecha`, van `hecha_por_usuario_id` y `hecha_en`; sin `hecha`, ninguno de los dos.

### 2.5 Otros cambios

- **`intervencion_auditoria`:** el evento `CORRECCION_TAREA` se suma a los permitidos.
- **`intervenciones.plan_mantenimiento_id`** ya existe, con su índice y con la FK compuesta de la 002 (`fk_intervenciones_plan_maquina`), que obliga a que el plan sea de la misma máquina. No cambia, y por eso la máquina de un plan no se puede cambiar.

### 2.6 Una sola definición del estado de una tarea

Una vista, `v_plan_tareas_estado`, o una función de SQL. **Es el único lugar** donde se calcula, y la usan la API, la generación y las pruebas.

Por cada tarea da todas sus columnas, más estas:

| Columna | Cómo se calcula |
| :--- | :--- |
| `hoy` | `(now() AT TIME ZONE zona_horaria)::date` |
| `ultima_ejecucion` | La mayor `(fecha_finalizacion AT TIME ZONE zona_horaria)::date` de las intervenciones `FINALIZADA`, no eliminadas, con la tarea hecha. Si no hay, nulo. |
| `proxima_fecha` | Sin `ultima_ejecucion`: `primera_fecha`. Con ella: `ultima_ejecucion` más la frecuencia, con la aritmética de PostgreSQL. El 31/01 más un mes da el 28/02, o el 29/02. |
| `dias` | `proxima_fecha - hoy`: negativo si está vencida. |
| `intervencion_en_curso_id` y su estado | Una intervención no eliminada en `PENDIENTE`, `EN_PROCESO` o `EN_ESPERA_REPUESTOS` con la tarea. Si hay más de una, la de menor id. |
| `estado` | El primero que se cumpla, en este orden:<br>1. `INACTIVA`: la tarea, el plan o la máquina están inactivos.<br>2. `EN_CURSO`: tiene una intervención en curso.<br>3. `VENCIDA`: `proxima_fecha < hoy`.<br>4. `PROXIMA`: `proxima_fecha <= hoy + anticipacion_dias`.<br>5. `AL_DIA`: el resto. |

---

## 3. Pruebas de la migración (primer commit)

`backend/tests/migration_018.test.ts`, con el script `test:migration-018`.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| M18-01 | Aplicar | Dos veces seguidas, sin error. Con un plan, una tarea y una intervención con su tarea cargados, reaplicar no cambia nada. |
| M18-02 | Estructura | Las columnas nuevas existen, y las seis viejas de `planes_mantenimiento` no. |
| M18-03 | Restricciones | **Se rechazan:**<br>• 0 días, 3651 días, 121 meses y 11 años;<br>• una unidad `HORAS`;<br>• un repuesto sin cantidad, y una cantidad sin repuesto;<br>• `hecha` sin `hecha_en`, o `hecha_en` sin `hecha`;<br>• la misma tarea dos veces en una intervención;<br>• dos planes "Lubricación" y "lubricación" en la misma máquina;<br>• una anticipación de 91.<br>**Se aceptan:** el mismo nombre en otra máquina, y 120 meses. |
| M18-04 | Planes con el formato viejo | Con `ROLLBACK`: volver a crear la columna `criterio` y cargar un plan. Reaplicar falla, y el mensaje incluye su id. |
| M18-05 | El estado de una tarea | Con datos de la prueba y fechas armadas con `hoy`:<br>• sin ejecuciones, la próxima es `primera_fecha`;<br>• `primera_fecha` hoy − 3: `VENCIDA`, con `dias` −3;<br>• hoy y hoy + 7, con anticipación 7: `PROXIMA`;<br>• hoy + 8: `AL_DIA`;<br>• en una intervención `PENDIENTE`: `EN_CURSO`;<br>• finalizada con la tarea hecha el 31/01/2027, cada 1 mes: última 2027-01-31 y próxima 2027-02-28;<br>• finalizada sin la tarea hecha: no cuenta;<br>• cancelada, o eliminada: no cuenta;<br>• la tarea, el plan o la máquina inactivos: `INACTIVA`;<br>• una finalización a las 23:30 de Buenos Aires, que en UTC ya es el día siguiente, cuenta el día de Buenos Aires. |

---

## 4. API de planes (segundo commit)

Un módulo nuevo, `backend/functions/planes.ts`, montado en `/api/planes`. Si conviene, sus funciones van en `backend/functions/preventivos/`.

### 4.1 Quién puede

- **Todas las rutas de esta sección y de la 5 piden `PLANES_GESTIONAR`.**
- **Con un alcance que no es `TODAS`,** el usuario ve solo los planes de las máquinas de sus sectores, como en los reportes.
  - Un plan de otro sector da 404 `PLAN_NO_ENCONTRADO`, como si no existiera.
  - Crear un plan en una máquina de otro sector da 403 `PERMISO_INSUFICIENTE`.

### 4.2 Rutas

| Ruta | Qué hace | Responde |
| :--- | :--- | :--- |
| `GET /api/planes` | La lista. Filtros: `maquina_id`, `sector_id` y `planta_id`. Sin `?all=true`, solo los activos, como en sectores. | 200 |
| `GET /api/planes/:id` | El detalle (4.3). | 200 |
| `POST /api/planes` | El alta, con sus tareas. | 201, con el detalle |
| `PATCH /api/planes/:id` | `nombre`, `descripcion`, `responsable_usuario_id` (puede ser `null`) y `anticipacion_dias`. La máquina no cambia: `maquina_id` en el cuerpo da 422. | 200, con el detalle |
| `POST /api/planes/:id/desactivar` y `/reactivar` | La baja y el alta. Repetir da 409 `PLAN_YA_INACTIVO` o `PLAN_YA_ACTIVO`. | 200, con el detalle |
| `POST /api/planes/:id/tareas` | Una tarea más, al final del orden. | 201, con el detalle |
| `PATCH /api/planes/:id/tareas/:tareaId` | Cualquier campo de la tarea. Una tarea de otro plan da 404 `TAREA_NO_ENCONTRADA`. | 200, con el detalle |
| `POST /api/planes/:id/tareas/:tareaId/desactivar` y `/reactivar` | La baja y el alta de la tarea. Repetir da 409 `TAREA_YA_INACTIVA` o `TAREA_YA_ACTIVA`. | 200, con el detalle |

Nada se borra: ni planes ni tareas.

### 4.3 El detalle

```json
{
  "id": 12,
  "nombre": "Mecánico",
  "descripcion": null,
  "activo": true,
  "anticipacion_dias": 7,
  "hoy": "2026-11-09",
  "maquina": { "id": 760, "codigo": "PIN-01", "nombre": "Cámara de pintura", "activo": true, "sector": { "id": 3, "nombre": "Pintura" } },
  "responsable": { "id": 552, "legajo": "DEMO_RESP", "nombre": "Responsable", "apellido": "Demo" },
  "creado_por": { "id": 557, "legajo": "DEMO_ADMIN2", "nombre": "Admin", "apellido": "Demo" },
  "creado_en": "2026-11-09T12:00:00.000Z",
  "actualizado_en": "2026-11-09T12:00:00.000Z",
  "tareas": [
    {
      "id": 41,
      "orden": 1,
      "accion": "Cambiar el aceite del reductor",
      "detalle": null,
      "frecuencia_valor": 6,
      "frecuencia_unidad": "MESES",
      "primera_fecha": "2026-11-01",
      "repuesto": { "id": 2, "codigo": "AC-68", "nombre": "Aceite ISO 68", "unidad": "litro" },
      "cantidad": 2.5,
      "proveedor": null,
      "activo": true,
      "ultima_ejecucion": null,
      "proxima_fecha": "2026-11-01",
      "dias": -8,
      "estado": "VENCIDA",
      "intervencion_en_curso": null
    }
  ],
  "intervenciones": [
    { "id": 9001, "estado": "FINALIZADA", "fecha_creacion": "…", "fecha_finalizacion": "…", "responsable": null }
  ]
}
```

- **Las fechas sin hora,** como `YYYY-MM-DD`.
- **`intervencion_en_curso`:** `{ "id", "estado" }` o `null`.
- **`intervenciones`:** las últimas 20 del plan, no eliminadas, de la más nueva a la más vieja. `responsable` va como en el resto: `{ id, legajo, nombre, apellido }` o `null`.
- **`responsable` y `creado_por`:** el mismo formato.
- **Las tareas,** en su orden, con las inactivas incluidas.

**Cada elemento de la lista** (`GET /api/planes`) lleva:
- `id`, `nombre`, `activo`, `anticipacion_dias`, `maquina` y `responsable`, como en el detalle;
- `tareas_activas`;
- `vencidas`, `proximas` y `en_curso`: cuántas tareas hay en cada estado;
- `proxima_fecha`: la menor de sus tareas activas que no están en curso, o `null`.

Orden: por `proxima_fecha`, las nulas al final, y después por código de máquina y nombre.

### 4.4 Los datos

| Campo | Regla |
| :--- | :--- |
| `maquina_id` | Solo en el alta. Que no exista: 404 `MAQUINA_NO_ENCONTRADA`. Inactiva: 422 `MAQUINA_INACTIVA`. Se lee con `FOR SHARE`. |
| `nombre` | De 3 a 150, recortado. Repetido en la máquina, sin importar mayúsculas: 409 `PLAN_DUPLICADO`. |
| `descripcion` | Opcional, hasta 2000. |
| `responsable_usuario_id` | Opcional. Se valida con `validarResponsableHabilitado`, contra el sector de la máquina, con sus mismos códigos. |
| `anticipacion_dias` | Opcional, entero de 0 a 90, por omisión 7. |
| `tareas` | Solo en el alta: de 1 a 50. Un error en una da su código, con `indice`, como el lote de costos, y no se guarda nada. |

**Una tarea:**

| Campo | Regla |
| :--- | :--- |
| `accion` | De 3 a 200, recortada. |
| `detalle` | Opcional, hasta 2000. |
| `frecuencia_valor` y `frecuencia_unidad` | Obligatorias, con los límites de la 2.3. |
| `primera_fecha` | Obligatoria. `YYYY-MM-DD`, una fecha que existe, entre hoy − 10 años y hoy + 10 años. |
| `repuesto_id` y `cantidad` | Opcionales; van juntos. El repuesto, activo, leído con `FOR SHARE`; si no, 422 `REPUESTO_INVALIDO`. La cantidad, con las reglas de la de un consumo de la R1. |
| `proveedor_id` | Opcional. Activo, leído con `FOR SHARE`; si no, 422 `PROVEEDOR_INVALIDO`. |

- **Los ids y los booleanos se validan con su tipo real,** como en el resto: `true` no es un id.
- **Cambiar la frecuencia** de una tarea con ejecuciones mueve su próxima fecha. Cambiar `primera_fecha` solo importa mientras no tenga ninguna.

### 4.5 Concurrencia

- **Todo cambio de un plan o de sus tareas** bloquea el plan con `FOR UPDATE`.
- **El orden de una tarea nueva** se calcula con el plan bloqueado.
- **El nombre repetido** que se escapa por concurrencia da 409 `PLAN_DUPLICADO`, nunca 500.

---

## 5. Vencimientos (segundo commit)

`GET /api/planes/vencimientos`. Se declara antes de `/:id`.

| Parámetro | Regla |
| :--- | :--- |
| `estado` | Uno o varios, separados por comas: `VENCIDA`, `PROXIMA`, `EN_CURSO`, `AL_DIA`. Por omisión, los tres primeros. Otro valor: 422. |
| `maquina_id`, `sector_id`, `planta_id` | Como en la lista de intervenciones. |
| `limit` y `offset` | `limit` de 1 a 500, por omisión 100; con `parseEnteroTexto`. Con `X-Total-Count`. |

**Solo entran tareas activas, de planes activos y de máquinas activas,** dentro del alcance del usuario.

```json
{
  "hoy": "2026-11-09",
  "resumen": { "vencidas": 3, "proximas": 5, "en_curso": 1, "al_dia": 20 },
  "tareas": [
    {
      "tarea_id": 41,
      "accion": "Cambiar el aceite del reductor",
      "frecuencia_valor": 6,
      "frecuencia_unidad": "MESES",
      "ultima_ejecucion": null,
      "proxima_fecha": "2026-11-01",
      "dias": -8,
      "estado": "VENCIDA",
      "intervencion_en_curso": null,
      "plan": { "id": 12, "nombre": "Mecánico" },
      "maquina": { "id": 760, "codigo": "PIN-01", "nombre": "Cámara de pintura", "criticidad": { "nombre": "Alta", "prioridad_alta": true } },
      "sector": { "id": 3, "nombre": "Pintura" },
      "responsable": null
    }
  ]
}
```

- **`resumen`** cuenta con los mismos filtros, salvo `estado`.
- **`responsable`** es el del plan.
- **Orden:**
  1. por `proxima_fecha`;
  2. a igual fecha, primero las máquinas de prioridad alta;
  3. después por código de máquina, plan y orden de la tarea.

---

## 6. Intervenciones preventivas (tercer commit)

### 6.1 Generar: `POST /api/planes/:id/generar`

Pide `PLANES_GESTIONAR`, con el alcance de la 4.1.

**Cuerpo:** `{ "tarea_ids": [41, 42] }`, opcional.

| Caso | Qué tareas van |
| :--- | :--- |
| Sin `tarea_ids` | Las activas del plan en `VENCIDA` o `PROXIMA`. |
| Con `tarea_ids` | Esas, en cualquier estado salvo `INACTIVA` y `EN_CURSO`. Sirve para adelantar una. |

**Validación de `tarea_ids`:** un arreglo de 1 a 50 ids, sin repetidos, validados con `validarIdCuerpo`. Una tarea de otro plan, o inactiva: 422 `TAREA_INVALIDA`, con `tarea_id` en los detalles.

**Errores:**

| Caso | Respuesta |
| :--- | :--- |
| El plan, inactivo | 409 `PLAN_INACTIVO` |
| La máquina, inactiva | 422 `MAQUINA_INACTIVA` |
| Una tarea elegida ya está en curso | 409 `TAREA_EN_CURSO`, con `tarea_id` e `intervencion_id` |
| No queda ninguna tarea | 409 `SIN_TAREAS_PARA_GENERAR` |

**Qué hace, en una transacción:**

1. **Bloquea, en este orden:** la máquina con `FOR UPDATE`, como el alta de una falla; el plan con `FOR UPDATE`; y sus tareas con `FOR UPDATE`. Recién después calcula los estados.
2. **Crea la intervención:**
   - tipo `PREVENTIVO`, estado `PENDIENTE`, con `plan_mantenimiento_id`;
   - `creado_por_usuario_id`: quien genera;
   - descripción: `Preventivo: <nombre del plan>. Tareas: <acción 1>; <acción 2>.`, recortada a 2000 con "…";
   - no detiene la máquina. Si hace falta, la detención se registra después, como en cualquier intervención.
3. **El historial:** `NULL → PENDIENTE`, con la observación `Generada desde el plan «<nombre>»`.
4. **Las tareas:** una fila de `intervencion_tareas` por tarea, con su orden, su acción, su detalle y `fecha_programada`, que es su próxima fecha.
5. **El responsable del plan,** si tiene uno:
   - **si está habilitado** (`validarResponsableHabilitado`), queda asignado. Lleva la misma auditoría `ASIGNACION` que una asignación, con el motivo "Responsable del plan preventivo", y el evento `INTERVENCION_ASIGNADA`, con quien genera como actor;
   - **si no está habilitado,** la intervención queda sin responsable, y la respuesta lo dice con `responsable_omitido: true`.

**No se emite `FALLA_REGISTRADA`:** no es una falla.

**Respuesta 201:**

```json
{
  "intervencion": { "id": 9002, "estado": "PENDIENTE", "responsable": { "id": 552, "legajo": "DEMO_RESP", "nombre": "Responsable", "apellido": "Demo" } },
  "responsable_omitido": false,
  "tareas": [
    { "id": 77, "plan_tarea_id": 41, "orden": 1, "accion": "Cambiar el aceite del reductor", "fecha_programada": "2026-11-01" }
  ]
}
```

### 6.2 Las tareas de una intervención

Un archivo nuevo, `backend/functions/intervencionTareas.ts`, como el de costos.

**`GET /api/intervenciones/:id/tareas`:** con la misma visibilidad que el detalle de la intervención.

```json
{
  "tareas": [
    {
      "id": 77,
      "plan_tarea_id": 41,
      "orden": 1,
      "accion": "Cambiar el aceite del reductor",
      "detalle": null,
      "fecha_programada": "2026-11-01",
      "repuesto": { "id": 2, "codigo": "AC-68", "nombre": "Aceite ISO 68", "unidad": "litro" },
      "cantidad": 2.5,
      "proveedor": null,
      "hecha": false,
      "hecha_por": null,
      "hecha_en": null,
      "observacion": null
    }
  ],
  "resumen": { "total": 1, "hechas": 0 },
  "puede_marcar": true
}
```

- **El repuesto, la cantidad y el proveedor** salen de la tarea del plan tal como está hoy: son una sugerencia, no lo que se usó.
- **`hecha_por`:** `{ id, legajo, nombre, apellido }` o `null`.
- **Una intervención sin plan** da `tareas: []`, el resumen en 0 y `puede_marcar: false`.

**`PATCH /api/intervenciones/:id/tareas/:tareaId`:**

| Campo | Regla |
| :--- | :--- |
| `hecha` | Obligatorio, `boolean` de verdad. |
| `observacion` | Opcional, hasta 500. `null` la borra. |
| `motivo` | Solo con la intervención `FINALIZADA`: obligatorio, de al menos 5 caracteres. Si no, 422 `MOTIVO_REQUERIDO`. |

- Con `hecha: true` se guardan quién y cuándo. Con `false` se borran los dos.
- **Mandar el mismo valor** responde 200 y no cambia nada, ni deja auditoría.
- Una tarea de otra intervención da 404 `TAREA_NO_ENCONTRADA`.
- **Responde 200** con la tarea, como en el `GET`, y con `proxima_fecha` de la tarea del plan después del cambio.

**Quién puede marcar.** Se bloquea la intervención con `bloquearIntervencion`, y se decide así:

| Estado | Quién puede |
| :--- | :--- |
| `PENDIENTE`, `EN_PROCESO`, `EN_ESPERA_REPUESTOS` | `INTERVENCIONES_CAMBIAR_ESTADO`, si es el responsable o tiene `INTERVENCIONES_ASIGNAR`. Se puede en `PENDIENTE` para que "Resolver ahora" funcione. |
| `FINALIZADA` | `INTERVENCIONES_CORREGIR`, con `motivo`. Deja una auditoría `CORRECCION_TAREA` con "Se marcó como hecha: <acción>" o "Se desmarcó: <acción>", y el motivo. |
| `CANCELADA` | Nadie: 409 `ESTADO_NO_PERMITE_TAREAS`. |

Si no puede, 403 `PERMISO_INSUFICIENTE`. **`puede_marcar` del `GET` sale de la misma función.**

### 6.3 Finalizar, reabrir, cancelar y eliminar

**No cambian.** La próxima fecha se calcula (D-021), así que se mueve sola.

Finalizar con tareas sin marcar se permite: esas tareas vuelven a quedar como estaban, vencidas o próximas. La PV2 lo avisa en la pantalla.

### 6.4 `tipo` y `plan` en las intervenciones

- **Cada elemento de `GET /api/intervenciones` y el detalle** suman:
  - `tipo`: `CORRECTIVO` o `PREVENTIVO`;
  - `plan`: `{ "id", "nombre" }` o `null`.
- **El filtro `tipo` de la lista** ya existe y no cambia.

---

## 7. Tipos y contrato (tercer commit)

- **En `frontend/src/api/tipos.ts`:**
  - los tipos de las respuestas de las secciones 4, 5 y 6;
  - `tipo` y `plan` en los de la intervención.
- **En `frontend/src/api/contrato-preventivos.ts`:** un ejemplo de cada respuesta, copiado de una respuesta real:
  - el detalle del plan;
  - un elemento de la lista;
  - los vencimientos;
  - la generación;
  - las tareas de una intervención.
- **PV-12** compara las respuestas reales con esos ejemplos usando `mismaForma`, como CO-15.

---

## 8. Pruebas de la API

### 8.1 `backend/tests/preventivos.test.ts`, con el script `test:preventivos`

**Usuarios de la prueba:**

| Nombre | Cómo se arma |
| :--- | :--- |
| A | Perfil `ADMINISTRADOR`. |
| R | Perfil `RESPONSABLE_MANTENIMIENTO`: `PLANES_GESTIONAR` y `INTERVENCIONES_CAMBIAR_ESTADO`, sin `INTERVENCIONES_CORREGIR`. |
| R2 | Como R, pero no es el responsable de las intervenciones de la prueba, y tiene `DENEGAR` de `INTERVENCIONES_ASIGNAR`. |
| S | Como R, con `PLANES_GESTIONAR` en alcance `SECTORES`, solo del sector de la máquina 1. |
| O | Perfil `OPERARIO`. |

**Datos:** dos máquinas de la prueba en sectores distintos, y un repuesto y un proveedor de la prueba. Las fechas se arman a partir de `hoy`, leído de la base.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| PV-01 | Permisos | • O: 403 en todas las rutas de las secciones 4, 5 y 6.1.<br>• S: ve los planes de la máquina 1. El de la máquina 2 da 404, y no aparece en la lista ni en los vencimientos.<br>• S crea un plan en la máquina 2: 403. |
| PV-02 | Alta | • Con dos tareas, una con repuesto y cantidad: 201, con el detalle de la 4.3.<br>• 422 en estos casos, sin guardar nada:<br>&nbsp;&nbsp;– nombre de 2 caracteres;<br>&nbsp;&nbsp;– sin tareas, o con 51;<br>&nbsp;&nbsp;– la segunda tarea con 0 meses, con `indice` 1;<br>&nbsp;&nbsp;– `HORAS` como unidad;<br>&nbsp;&nbsp;– `2026-02-30` y `2026-2-1` como fecha, y una fecha a 11 años;<br>&nbsp;&nbsp;– repuesto sin cantidad;<br>&nbsp;&nbsp;– repuesto inactivo: `REPUESTO_INVALIDO`;<br>&nbsp;&nbsp;– proveedor inactivo: `PROVEEDOR_INVALIDO`;<br>&nbsp;&nbsp;– `maquina_id: true`;<br>&nbsp;&nbsp;– máquina inactiva: `MAQUINA_INACTIVA`;<br>&nbsp;&nbsp;– un responsable inactivo: `RESPONSABLE_NO_HABILITADO`;<br>&nbsp;&nbsp;– anticipación 91.<br>• El mismo nombre con la inicial en minúscula, en la misma máquina: 409 `PLAN_DUPLICADO`. En la otra máquina: 201. |
| PV-03 | Edición | • `PATCH` de nombre, responsable (también a `null`) y anticipación: 200.<br>• `maquina_id` en el cuerpo: 422.<br>• Una tarea más: queda última en el orden.<br>• Editar la frecuencia de una tarea con una ejecución mueve su próxima fecha.<br>• Desactivar y reactivar el plan y una tarea; repetir da los 409 de la 4.2.<br>• Una tarea de otro plan en la ruta: 404. |
| PV-04 | Estado de las tareas | Con anticipación 7, tareas con primera fecha hoy − 3, hoy, hoy + 7 y hoy + 8: `VENCIDA` con `dias` −3, `PROXIMA`, `PROXIMA` y `AL_DIA`. Desactivar la máquina las deja `INACTIVA` en el detalle y las saca de los vencimientos. |
| PV-05 | Vencimientos | • Sin `estado`, no trae las `AL_DIA`.<br>• Con `estado=AL_DIA`, solo esas.<br>• `estado=OTRO`: 422.<br>• Los filtros por máquina, sector y planta.<br>• El orden de la sección 5, con dos máquinas de distinta criticidad y la misma fecha.<br>• `resumen` cuenta igual con cualquier `estado`.<br>• `limit=1` con `X-Total-Count`. |
| PV-06 | Generar | • Sin cuerpo: lleva la vencida y las próximas, no la `AL_DIA`.<br>• La intervención queda así: `PREVENTIVO`, `PENDIENTE`, con el plan, la descripción y el historial de la 6.1.<br>• Con el responsable del plan: queda asignado, con la auditoría `ASIGNACION` y una notificación para él, ninguna para quien genera, y ninguna `FALLA_REGISTRADA`.<br>• Esas tareas pasan a `EN_CURSO`, y generar otra vez da 409 `SIN_TAREAS_PARA_GENERAR`.<br>• Con `tarea_ids` de una `AL_DIA`: 201.<br>• Una en curso: 409 `TAREA_EN_CURSO`, con sus detalles.<br>• Una de otro plan, o inactiva: 422 `TAREA_INVALIDA`.<br>• `tarea_ids` con repetidos, o `["41"]`: 422.<br>• Plan inactivo: 409. Máquina inactiva: 422.<br>• Un responsable del plan desactivado después: 201, sin responsable y con `responsable_omitido: true`. |
| PV-07 | Marcar tareas | • En `PENDIENTE`, el responsable R marca: 200.<br>• R2: 403. O: 403.<br>• `hecha: "true"`: 422.<br>• Una observación de 501 caracteres: 422.<br>• Repetir el mismo valor: 200, sin cambios.<br>• Una tarea de otra intervención: 404.<br>• Cancelada: 409 `ESTADO_NO_PERMITE_TAREAS`.<br>• Finalizada:<br>&nbsp;&nbsp;– R: 403;<br>&nbsp;&nbsp;– A sin motivo: 422;<br>&nbsp;&nbsp;– A con motivo: 200, con la auditoría `CORRECCION_TAREA` y la próxima fecha movida. |
| PV-08 | La próxima fecha se mueve sola | Con las tareas X e Y en una intervención:<br>• **Finalizar con X hecha e Y sin marcar:** X tiene `ultima_ejecucion` hoy, la próxima fecha a una frecuencia de distancia, y queda `AL_DIA`. Y vuelve a `VENCIDA` y ya no está en curso.<br>• **Reabrir:** X vuelve a su próxima fecha anterior y a `EN_CURSO`.<br>• **Cancelar otra intervención preventiva:** sus tareas vuelven a estar disponibles para generar.<br>• **Eliminar una:** lo mismo. |
| PV-09 | Concurrencia | Diez vueltas de cada caso:<br>• **dos generar a la vez del mismo plan:** uno 201 y otro 409, y cada tarea queda en una sola intervención;<br>• **generar y desactivar el plan a la vez:** o se generó y el plan quedó inactivo, o 409 `PLAN_INACTIVO` y no hay intervención nueva;<br>• **dos altas a la vez con el mismo nombre en la misma máquina:** una 201 y otra 409. |
| PV-10 | `tipo` y `plan` | Una correctiva: `CORRECTIVO` y `plan` `null`. La generada: `PREVENTIVO` y su plan, en la lista y en el detalle. `?tipo=PREVENTIVO` la trae. |
| PV-11 | `puede_marcar` | Coincide con lo que responde el `PATCH`, para A, R, R2 y O, en `EN_PROCESO` y en `FINALIZADA`. |
| PV-12 | Contrato | `mismaForma` sin diferencias, entre cada respuesta real y su ejemplo de la sección 7. |

### 8.2 Los datos de la prueba

Cada prueba crea y borra sus datos, como siempre: planes, tareas, intervenciones con sus tareas, historial, auditoría y notificaciones.

### 8.3 Lo que se suma a pruebas existentes

- **ID-01 (`ids.test.ts`):** se suman a su lista las rutas nuevas con id, de las secciones 4, 5 y 6. Es el único cambio autorizado en pruebas existentes.
- **`scripts/run-all-tests.mjs`:** `planes_mantenimiento`, `plan_tareas` e `intervencion_tareas` se suman a las tablas que controla `test:todo`. En `CLAUDE.md`, de 16 pasa a 19 tablas.

---

## 9. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 8 están hechas, en tres commits.
2. Las cinco suites de la regla 3 en verde, en Neon.
3. `npm run typecheck` y `npm run build:frontend` sin errores.
4. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. Los tres hashes.
2. Cómo quedó la definición del estado (2.6): vista o función, y su SQL.
3. La salida final de las cinco suites.
4. Typecheck y build.
5. `wc -l` de los archivos tocados.
6. Desvíos y dudas.
7. Lo que quedó en la rama de pruebas que no es de esta etapa.
