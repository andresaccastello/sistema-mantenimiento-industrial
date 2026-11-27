# Etapa PV3 — Medidores y tareas que vencen por uso: la API

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `86db6a7` (Etapa PV2.2).
> **Origen:** `docs/relevamiento-requisitos-derivados.md`, requisito 6. Un cambio de aceite cada 250 horas de uso, o cada 6 meses, lo que llegue primero.

**Qué entra:**
- medidores por máquina (horómetro, kilómetros, ciclos, piezas) y sus lecturas;
- tareas que vencen por uso, o por fecha y por uso, lo que llegue primero;
- la lectura del medidor al hacer la tarea en la intervención.

**Qué no entra:**

| Etapa | Qué |
| :--- | :--- |
| PV4 | Las pantallas: medidores y lecturas en la ficha de la máquina, la tarea por uso en el plan y la lectura al marcar la tarea. |
| PV5 | Revisiones de rutina del operario (requisito 7). |
| PV6 | Generación automática y avisos de vencimiento. Antes era la PV5. |

Tampoco entran los disparadores por condición, como una temperatura o una vibración con un umbral, ni estimar fechas a partir del ritmo de uso.

**Esta etapa no tiene pantallas.** Del front, solo los tipos y los ejemplos del contrato (sección 5).

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Tres commits:**

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1 y 2 | `feat(db): medidores y tareas por uso` |
   | 2 | 3, la 5.1, y de la 6, la 6.1 | `feat(api): medidores y lecturas` |
   | 3 | 4, la 5.2, y de la 6, la 6.2 y la 6.3 | `feat(api): tareas que vencen por uso` |

3. **Pruebas:**
   - solo `test:migration-018`, `test:medidores` (nueva), `test:preventivos`, `test:ids` y `test:front`;
   - **no correr `test:todo`:** va en la corrida de la noche.
4. **Pruebas existentes: se autoriza cambiar solo esto,** y solo para sumar lo nuevo:
   - **M18-02:** las listas de columnas de `plan_tareas` e `intervencion_tareas`;
   - **PV-02:** la tarea entera, con `estado_fecha` y `uso: null`;
   - **PV-05:** el elemento entero, con `estado_fecha` y `uso: null`, y el resumen con `sin_lectura: 0`;
   - **ID-01:** las rutas nuevas y un medidor de la prueba (6.3);
   - **los ejemplos de `contrato-preventivos.ts`.**

   Si otra prueba existente falla, por ejemplo por el orden de los vencimientos (4.2), frenar y avisar.
5. **Una lectura se registra con una sola función,** `registrarLectura`. La usan la ruta de lecturas y el alta con `lectura_inicial` (3), y el marcado de una tarea (4.4), como el consumo de la PV2.2.
6. **Ojo con `null`:** en una tarea solo por uso, `proxima_fecha` y `dias` vienen en `null`, y `Number(null)` da 0.
7. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-pv3-medidores-api.md`.

---

## 1. Regla: D-023 (primer commit)

Agregar a `docs/decisiones.md`:

> **D-023 — Medidores y tareas que vencen por uso**
>
> **Estado:** Aceptada
>
> 1. **Un medidor es de una máquina:** un horómetro, un cuentakilómetros, un contador de ciclos o de piezas. Tiene un nombre y una unidad, que se escribe libre. Una máquina puede tener varios.
> 2. **Las lecturas son acumuladas.** Cada una es mayor o igual que la última vigente. Vale desde que se registra: no se carga con fecha pasada. Una lectura mal cargada se anula con motivo, y nada se borra.
> 3. **Una tarea vence por fecha, por uso o por las dos,** y en ese caso, lo que llegue primero. Por uso es cada N unidades de un medidor de la misma máquina, con la primera en un valor dado y una anticipación en unidades.
> 4. **La próxima por uso se calcula, no se guarda,** como la fecha (D-021):
>    - es el mayor valor del medidor registrado al hacer la tarea en una intervención finalizada y no eliminada, más el intervalo;
>    - sin ninguno, es la primera.
>
>    Reabrir, cancelar o eliminar la intervención la mueve sola.
> 5. **El valor al hacer la tarea queda en la tarea de la intervención.** Es la última lectura, o una nueva que se carga en ese momento. Hacer la tarea reinicia los dos relojes, el de fecha y el de uso.
> 6. **El estado de la tarea es el más urgente de los dos.** "Sin lectura" es una tarea por uso cuyo medidor no tiene ninguna lectura vigente.
> 7. **No se estima.** El sistema compara la última lectura real con el valor que toca. No calcula fechas a partir del ritmo de uso.
> 8. **Si se cambia el medidor físico,** por ejemplo un horómetro nuevo que arranca de cero, se da de alta otro medidor y se le pasan las tareas.
>
> **Motivo:** cumplir el requisito 6 con la misma idea de D-021: nada se guarda que se pueda calcular, y deshacer una intervención deshace su efecto sin pasos extra.

**En D-021, punto 4,** "la PV5" pasa a "la PV6".

---

## 2. Base de datos (primer commit)

**Se edita la `018`,** como en la PV2.2: la vista de la 2.6 necesita las tablas nuevas, y la `018` todavía no está en la base principal. Tiene que seguir siendo aplicable varias veces, también donde la `018` de la PV2.2 ya está aplicada y tiene datos.

### 2.1 Permiso `MAQUINAS_REGISTRAR_LECTURAS`

- **Nombre:** "Cargar lecturas de medidores".
- **`usa_alcance`:** `false`.
- **Se asigna a** `ADMINISTRADOR`, `RESPONSABLE_MANTENIMIENTO` y `OPERARIO`, como en la `015`.

### 2.2 `medidores`, nueva

| Columna | Tipo |
| :--- | :--- |
| `id` | `bigint` identidad |
| `maquina_id` | FK a `maquinas`, no nulo |
| `nombre` | `varchar(60)`, no nulo |
| `unidad` | `varchar(20)`, no nulo: "horas", "km", "ciclos". |
| `activo` | `boolean`, no nulo, por omisión `true` |
| `creado_por_usuario_id` | FK a `usuarios`, no nulo |
| `creado_en`, `actualizado_en` | `timestamptz` |

**Único:** `(maquina_id, lower(nombre))`.

### 2.3 `lecturas_medidor`, nueva

| Columna | Tipo |
| :--- | :--- |
| `id` | `bigint` identidad |
| `medidor_id` | FK a `medidores`, no nulo |
| `valor` | `numeric(14,2)`, no nulo, mayor o igual que 0 |
| `registrada_en` | `timestamptz`, no nulo, por omisión `now()` |
| `registrada_por_usuario_id` | FK a `usuarios`, no nulo |
| `origen` | `MANUAL` o `TAREA` |
| `intervencion_tarea_id` | FK a `intervencion_tareas`, nulo. Va si y solo si el origen es `TAREA`. |
| `observacion` | `varchar(200)` nulo |
| `anulada_en`, `anulada_por_usuario_id`, `motivo_anulacion` | Nulos. Van los tres o ninguno. |

**Índice:** `(medidor_id, valor DESC, id DESC) WHERE anulada_en IS NULL`.

### 2.4 `plan_tareas`

| Cambio | Detalle |
| :--- | :--- |
| `frecuencia_valor`, `frecuencia_unidad` y `primera_fecha` | Pasan a admitir nulo. Van los tres o ninguno. |
| `medidor_id` | Nueva: FK a `medidores`, nulo. |
| `uso_cada` | Nueva: `numeric(14,2)`, nulo, mayor que 0. |
| `uso_primera` | Nueva: `numeric(14,2)`, nulo, mayor o igual que 0: el valor en el que vence la primera vez. |
| `uso_anticipacion` | Nueva: `numeric(14,2)`, nulo, de 0 a `uso_cada`: cuántas unidades antes pasa a "próxima". |

- **Las cuatro de uso,** todas o ninguna.
- **Una tarea tiene al menos un criterio:** fecha, uso o los dos.
- **La anticipación del plan** (`anticipacion_dias`) es solo para la fecha.

### 2.5 `intervencion_tareas`

| Cambio | Detalle |
| :--- | :--- |
| `fecha_programada` | Pasa a admitir nulo: una tarea solo por uso no tiene. |
| `medidor_id` | Nueva: FK a `medidores`, nulo. Se copia del plan al generar. |
| `uso_programado` | Nueva: `numeric(14,2)`, nulo: la próxima por uso al generar. Va si y solo si va `medidor_id`. |
| `valor_medidor` | Nueva: `numeric(14,2)`, nulo: el valor del medidor al hacer la tarea. |

- **`valor_medidor`** va si y solo si la tarea está hecha y tiene medidor.
- **Una fila tiene `fecha_programada`, `medidor_id` o los dos.**

### 2.6 La vista `v_plan_tareas_estado`

Sigue siendo **el único lugar** donde se calcula el estado. Suma estas columnas:

| Columna | Cómo se calcula |
| :--- | :--- |
| `lectura_actual` y `lectura_actual_en` | La lectura vigente del medidor de la tarea con mayor valor; a igual valor, la de mayor id. Sin medidor o sin lecturas: nulas. |
| `ultimo_uso` | El mayor `valor_medidor` de las tareas hechas en intervenciones `FINALIZADA` no eliminadas, **con el mismo `medidor_id` que la tarea del plan hoy.** Si no hay: nulo. |
| `proximo_uso` | Sin `ultimo_uso`: `uso_primera`. Con él: `ultimo_uso + uso_cada`. Sin medidor: nulo. |
| `faltan_uso` | `proximo_uso - lectura_actual`. Negativo si está vencida. Sin lectura: nulo. |
| `estado_uso` | Sin medidor: nulo. Si no: `SIN_LECTURA` sin lectura; `VENCIDA` si `faltan_uso < 0`; `PROXIMA` si `faltan_uso <= uso_anticipacion`; `AL_DIA` el resto. |
| `estado_fecha` | Sin fecha: nulo. Si no, como hoy: `VENCIDA`, `PROXIMA` o `AL_DIA`. |

**Cambian:**
- **`proxima_fecha` y `dias`:** nulos en una tarea sin fecha. **`ultima_ejecucion` no cambia:** también se calcula en una tarea solo por uso.
- **`estado`:** el primero que se cumpla, en este orden:
  1. `INACTIVA`: la tarea, el plan, la máquina o el medidor de la tarea están inactivos;
  2. `EN_CURSO`: como hoy;
  3. `VENCIDA`: si `estado_fecha` o `estado_uso` es `VENCIDA`;
  4. `PROXIMA`: si alguno de los dos es `PROXIMA`;
  5. `SIN_LECTURA`: si `estado_uso` es `SIN_LECTURA`;
  6. `AL_DIA`: el resto.

### 2.7 Pruebas de la migración

En `backend/tests/migration_018.test.ts`:

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| M18-07 | Estructura | • Las dos tablas nuevas, con sus columnas.<br>• Las columnas nuevas de `plan_tareas` e `intervencion_tareas`.<br>• `frecuencia_valor`, `frecuencia_unidad`, `primera_fecha` y `fecha_programada` admiten nulo.<br>• El permiso, con `usa_alcance` `false` y en los tres perfiles. |
| M18-08 | Restricciones | **Se rechazan:**<br>• una tarea sin fecha ni uso;<br>• una fecha a medias, por ejemplo sin `primera_fecha`;<br>• un uso a medias, por ejemplo sin `uso_cada`;<br>• `uso_cada` 0;<br>• una anticipación mayor que `uso_cada`;<br>• `uso_primera` y una lectura negativas;<br>• una lectura `TAREA` sin tarea, y una `MANUAL` con tarea;<br>• una anulación a medias;<br>• "Horómetro" y "horómetro" en la misma máquina;<br>• `valor_medidor` en una tarea sin hacer, o sin medidor;<br>• una tarea hecha, con medidor y sin `valor_medidor`;<br>• una tarea de intervención sin fecha ni medidor;<br>• `uso_programado` sin medidor.<br>**Se aceptan:** el mismo nombre de medidor en otra máquina, una tarea solo por uso y una con los dos criterios. |
| M18-09 | El estado por uso | Con una tarea cada 250, primera 500 y anticipación 25:<br>• sin lecturas: `SIN_LECTURA`;<br>• lectura 400: `AL_DIA`, `faltan_uso` 100;<br>• 475: `PROXIMA`, y 500: `PROXIMA` con 0;<br>• 500,5: `VENCIDA` con −0,5;<br>• anular la de 500,5: vuelve a `PROXIMA`;<br>• finalizada con la tarea hecha y `valor_medidor` 510: `ultimo_uso` 510 y `proximo_uso` 760;<br>• cancelada, eliminada o sin la tarea hecha: no cuenta;<br>• un `valor_medidor` de otro medidor no cuenta;<br>• el medidor inactivo: `INACTIVA`.<br>**Combinadas:**<br>• fecha `AL_DIA` y uso `VENCIDA`: `VENCIDA`;<br>• fecha `VENCIDA` y uso `AL_DIA`: `VENCIDA`;<br>• fecha `PROXIMA` y uso `SIN_LECTURA`: `PROXIMA`;<br>• fecha `AL_DIA` y uso `SIN_LECTURA`: `SIN_LECTURA`. |
| M18-10 | Reaplicar con datos | Con un medidor, lecturas, una anulada, una tarea por uso y una intervención con `valor_medidor`, reaplicar no cambia nada. |

### 2.8 `docs/modelo-datos.md`

Al día con la PV2.2 y con esta etapa:
- `plan_tarea_repuestos` e `intervencion_tarea_repuestos`;
- `plan_tareas` sin `repuesto_id` ni `cantidad`;
- las tablas y columnas de esta etapa.

---

## 3. API de medidores (segundo commit)

Un módulo nuevo, `backend/functions/medidores.ts`, montado en `/api/medidores`. Si conviene, la lógica va en `backend/functions/medidores/`.

### 3.1 Quién puede

| Qué | Permiso |
| :--- | :--- |
| Ver medidores y lecturas | `PLANES_GESTIONAR` o `MAQUINAS_REGISTRAR_LECTURAS`. De todas las máquinas. |
| Cargar una lectura | `MAQUINAS_REGISTRAR_LECTURAS`. |
| Alta, edición, baja y alta de nuevo de un medidor, y anular una lectura | `PLANES_GESTIONAR`. |

- **Con `PLANES_GESTIONAR` en un alcance que no es `TODAS`,** solo se gestionan los medidores de las máquinas de sus sectores. Uno de otro sector da 403 `PERMISO_INSUFICIENTE`.
- **Sin ninguno de los dos permisos:** 403 en todas las rutas.

### 3.2 Rutas

| Ruta | Qué hace | Responde |
| :--- | :--- | :--- |
| `GET /api/medidores` | La lista. Filtro `maquina_id`; si no es un id, 422. Sin `?all=true`, solo los activos. Orden: código de máquina y nombre. | 200 |
| `GET /api/medidores/:id` | El detalle (3.3). | 200 |
| `POST /api/medidores` | El alta. | 201, con el detalle |
| `PATCH /api/medidores/:id` | `nombre` y `unidad`. `maquina_id` en el cuerpo da 422. | 200, con el detalle |
| `POST /api/medidores/:id/desactivar` y `/reactivar` | La baja y el alta. Repetir da 409 `MEDIDOR_YA_INACTIVO` o `MEDIDOR_YA_ACTIVO`. | 200, con el detalle |
| `GET /api/medidores/:id/lecturas` | Las lecturas, también las anuladas, de la más nueva a la más vieja. `limit` de 1 a 500, por omisión 50, y `offset`, con `parseEnteroTexto` y `X-Total-Count`. | 200 |
| `POST /api/medidores/:id/lecturas` | Una lectura nueva. | 201, con la lectura |
| `POST /api/medidores/:id/lecturas/:lecturaId/anular` | Anula una lectura. Una de otro medidor: 404 `LECTURA_NO_ENCONTRADA`. | 200, con la lectura |

- **Un medidor que no existe:** 404 `MEDIDOR_NO_ENCONTRADO`.
- **Nada se borra.**

### 3.3 Las respuestas

**El medidor**, en la lista:

```json
{
  "id": 3,
  "nombre": "Horómetro",
  "unidad": "horas",
  "activo": true,
  "maquina": { "id": 760, "codigo": "PIN-01", "nombre": "Cámara de pintura", "activo": true, "sector": { "id": 3, "nombre": "Pintura" } },
  "ultima_lectura": {
    "id": 55,
    "valor": 512.5,
    "registrada_en": "2026-11-10T11:00:00.000Z",
    "registrada_por": { "id": 551, "legajo": "DEMO_OP", "nombre": "Operario", "apellido": "Demo" }
  },
  "tareas_activas": 2,
  "creado_en": "2026-11-10T10:00:00.000Z",
  "actualizado_en": "2026-11-10T10:00:00.000Z"
}
```

- **`ultima_lectura`:** la vigente de mayor valor, o `null`.
- **`tareas_activas`:** las tareas activas que lo usan, de cualquier plan.

**El detalle** es lo mismo, más `tareas`: las activas que lo usan, como `{ "id", "accion", "plan": { "id", "nombre", "activo" } }`.

**Una lectura:**

```json
{
  "id": 55,
  "valor": 512.5,
  "registrada_en": "2026-11-10T11:00:00.000Z",
  "registrada_por": { "id": 551, "legajo": "DEMO_OP", "nombre": "Operario", "apellido": "Demo" },
  "origen": "MANUAL",
  "intervencion_id": null,
  "observacion": null,
  "anulada": false,
  "anulada_en": null,
  "anulada_por": null,
  "motivo_anulacion": null
}
```

`intervencion_id` es el de la tarea, con origen `TAREA`.

### 3.4 Los datos

**El medidor:**

| Campo | Regla |
| :--- | :--- |
| `maquina_id` | Solo en el alta. Que no exista: 404 `MAQUINA_NO_ENCONTRADA`. Inactiva: 422 `MAQUINA_INACTIVA`. Se lee con `FOR SHARE`. |
| `nombre` | De 3 a 60, recortado. Repetido en la máquina, sin importar mayúsculas: 409 `MEDIDOR_DUPLICADO`. |
| `unidad` | De 1 a 20, recortada. |
| `lectura_inicial` | Opcional, solo en el alta. Si viene, registra la primera lectura, `MANUAL`, a nombre de quien da el alta. |

**Desactivar:** si alguna tarea activa lo usa, de cualquier plan, da 409 `MEDIDOR_EN_USO`, con `tarea_ids` en los detalles.

**Una lectura:**

| Campo | Regla |
| :--- | :--- |
| `valor` | Obligatorio. Un número de 0 a 999.999.999.999,99, con hasta 2 decimales. Menor que la última vigente: 422 `LECTURA_MENOR`, con `ultima: { valor, registrada_en }` en los detalles. Igual se acepta. |
| `observacion` | Opcional, hasta 200. |

- **El medidor inactivo:** 409 `MEDIDOR_INACTIVO`.
- **La máquina inactiva:** 422 `MAQUINA_INACTIVA`.

**Anular:**
- `motivo`, obligatorio, de al menos 5 caracteres; si no, 422 `MOTIVO_REQUERIDO`.
- Repetir da 409 `LECTURA_YA_ANULADA`.
- **Anular no toca ninguna tarea:** el `valor_medidor` de una tarea hecha es una copia.

**Los números,** como en el resto: `"100"` no es un número, y los ids se validan con su tipo real.

### 3.5 Concurrencia

- **Cargar o anular una lectura, desactivar y reactivar** bloquean el medidor con `FOR UPDATE`.
- **La comparación con la última lectura** se hace con el medidor bloqueado: dos lecturas a la vez nunca dejan una menor después de una mayor.
- **El nombre repetido** que se escapa por concurrencia da 409 `MEDIDOR_DUPLICADO`, nunca 500.

---

## 4. Tareas que vencen por uso (tercer commit)

### 4.1 La tarea en el plan

En el alta del plan, en `POST /api/planes/:id/tareas` y en el `PATCH` de una tarea:

| Campo | Regla |
| :--- | :--- |
| `frecuencia_valor`, `frecuencia_unidad` y `primera_fecha` | Los tres, con las reglas de la PV1, o ninguno. En el `PATCH`, para sacar la fecha se mandan los tres en `null`. Si alguno viene en `null` y otro no: 422. |
| `uso` | Opcional. `{ "medidor_id", "cada", "primera", "anticipacion" }`, o `null`. En el `PATCH` reemplaza todo el criterio de uso, como `repuestos`, y `null` lo saca. |

**`uso`:**

| Campo | Regla |
| :--- | :--- |
| `medidor_id` | Obligatorio. Un medidor activo de la máquina del plan, leído con `FOR SHARE`. Si no, 422 `MEDIDOR_INVALIDO`. |
| `cada` | Obligatorio. Mayor que 0, hasta 999.999.999.999,99, con hasta 2 decimales. |
| `primera` | Obligatorio. De 0 a 999.999.999.999,99, con hasta 2 decimales. |
| `anticipacion` | Opcional. De 0 a `cada`, con hasta 2 decimales. Por omisión, el 10 % de `cada`, redondeado a 2 decimales. |

- **Sin fecha ni uso,** después de aplicar el cambio: 422 `DATOS_INVALIDOS`, "Una tarea vence por fecha, por uso o por las dos".
- **En el alta del plan,** un error en una tarea lleva `indice`, como hoy.
- **Cambiar de medidor:** los valores registrados con el otro dejan de contar, y la próxima por uso vuelve a `primera`.
- **Reactivar una tarea cuyo medidor está inactivo:** 409 `MEDIDOR_INACTIVO`.

### 4.2 La tarea en las respuestas

**En el detalle del plan,** cada tarea suma `estado_fecha` y `uso`:

```json
{
  "id": 42,
  "orden": 2,
  "accion": "Cambiar el filtro de aire",
  "detalle": null,
  "frecuencia_valor": 6,
  "frecuencia_unidad": "MESES",
  "primera_fecha": "2026-12-01",
  "repuestos": [],
  "proveedor": null,
  "activo": true,
  "ultima_ejecucion": null,
  "proxima_fecha": "2026-12-01",
  "dias": 21,
  "estado_fecha": "AL_DIA",
  "uso": {
    "medidor": { "id": 3, "nombre": "Horómetro", "unidad": "horas", "activo": true },
    "cada": 250,
    "primera": 500,
    "anticipacion": 25,
    "lectura_actual": { "valor": 512.5, "registrada_en": "2026-11-10T11:00:00.000Z" },
    "ultimo": null,
    "proximo": 500,
    "faltan": -12.5,
    "estado": "VENCIDA"
  },
  "estado": "VENCIDA",
  "intervencion_en_curso": null
}
```

- **Sin uso:** `uso: null`.
- **Sin fecha:** `frecuencia_valor`, `frecuencia_unidad`, `primera_fecha`, `proxima_fecha`, `dias` y `estado_fecha` en `null`.

**En los vencimientos:**
- **Cada elemento** suma `estado_fecha` y `uso`, con el mismo formato.
- **`estado`** acepta también `SIN_LECTURA`. Por omisión: `VENCIDA`, `PROXIMA`, `SIN_LECTURA` y `EN_CURSO`.
- **`resumen`** suma `sin_lectura`.
- **El orden cambia:**
  1. por estado: `VENCIDA`, `PROXIMA`, `SIN_LECTURA`, `EN_CURSO`, `AL_DIA`;
  2. por `proxima_fecha`, las que no tienen al final;
  3. después, como hoy: prioridad alta primero, código de máquina, plan y orden de la tarea.

**En la lista de planes:** cada elemento suma `sin_lectura`. `proxima_fecha` sigue siendo la menor de sus tareas activas que no están en curso; las que no tienen fecha no cuentan.

### 4.3 Generar

**Qué tareas van no cambia:** sin `tarea_ids`, las `VENCIDA` y `PROXIMA`; con `tarea_ids`, cualquiera que no esté `INACTIVA` ni `EN_CURSO`.

Cada fila de `intervencion_tareas` copia además:
- `medidor_id`, de la tarea del plan;
- `uso_programado`, que es su `proximo_uso`.

`fecha_programada` queda en `null` en una tarea solo por uso. **La respuesta de generar no cambia.**

### 4.4 Marcar la tarea, con la lectura

**`GET /api/intervenciones/:id/tareas`:** cada tarea suma `uso`, o `null` si la fila no tiene medidor:

```json
"uso": {
  "medidor": {
    "id": 3,
    "nombre": "Horómetro",
    "unidad": "horas",
    "activo": true,
    "ultima_lectura": { "valor": 512.5, "registrada_en": "2026-11-10T11:00:00.000Z" }
  },
  "programado": 500,
  "valor": null
}
```

`valor` es el `valor_medidor`: `null` mientras no está hecha.

**`PATCH /api/intervenciones/:id/tareas/:tareaId`:** suma un campo, `lectura`, un número con las reglas de `valor` de la 3.4. Con una fila sin medidor, o con `hecha: false`, da 422.

**Al marcar con `hecha: true` una fila con medidor:**

| Estado | Qué pasa |
| :--- | :--- |
| `PENDIENTE`, `EN_PROCESO`, `EN_ESPERA_REPUESTOS` | **Sin `lectura`:** `valor_medidor` es la última lectura vigente. Si no hay ninguna, 422 `LECTURA_REQUERIDA`.<br>**Con `lectura`:**<br>• menor que la última vigente: 422 `LECTURA_MENOR`, con `ultima`;<br>• igual: `valor_medidor` es esa, y no se registra otra;<br>• mayor, o sin lecturas: se registra con `registrarLectura`, con origen `TAREA` y la fila, a nombre de quien marca. Con el medidor inactivo: 409 `MEDIDOR_INACTIVO`. |
| `FINALIZADA` | Es una corrección, con `motivo`. **`lectura` es obligatoria:** si no viene, 422 `LECTURA_REQUERIDA`. Si supera la última vigente: 422 `LECTURA_MAYOR`, con `ultima`. **No registra ninguna lectura,** porque es un valor de antes. La auditoría `CORRECCION_TAREA` dice "Se marcó como hecha: <acción>, con el medidor en 480 horas". El valor va con coma decimal y sin separador de miles. |

- **No pide `MAQUINAS_REGISTRAR_LECTURAS`:** registrar la lectura es parte de marcar la tarea.
- **Al desmarcar:** `valor_medidor` vuelve a `null`. La lectura que se registró queda: es un dato real de la máquina.
- **Con la tarea ya hecha,** `hecha: true` sigue respondiendo 200 sin cambios, y `lectura` no se usa. Para cambiar el valor se desmarca y se vuelve a marcar.
- **El orden de los bloqueos:** el que ya hay, y el medidor con `FOR UPDATE` al final, después de los repuestos.
- **La respuesta del `PATCH`** suma `proximo_uso` de la tarea del plan, junto a `proxima_fecha`.
- **Todo o nada,** como con los repuestos: si la lectura falla, no se marca la tarea ni se registra ningún consumo.

### 4.5 Concurrencia

- **Cambiar una tarea con un medidor** lo lee con `FOR SHARE` después de bloquear el plan.
- **Desactivar ese medidor a la vez:** o la tarea quedó con el medidor y desactivar da 409 `MEDIDOR_EN_USO`, o la tarea da 422 `MEDIDOR_INVALIDO` y el medidor queda inactivo.

---

## 5. Tipos y contrato

### 5.1 Medidores (segundo commit)

- **En `frontend/src/api/tipos.ts`:** los tipos de las respuestas de la sección 3.
- **En `frontend/src/api/contrato-medidores.ts`,** nuevo: un ejemplo, copiado de una respuesta real, de un elemento de la lista, del detalle, de la lista de lecturas y de una lectura cargada.

### 5.2 Preventivos (tercer commit)

- **En `tipos.ts`,** solo se suma lo nuevo:
  - `uso` y `estado_fecha` en la tarea del plan y en el elemento de los vencimientos;
  - `sin_lectura` en el resumen y en la lista de planes;
  - `uso` en la tarea de la intervención;
  - `proximo_uso` en la respuesta del `PATCH`.

  **No se toca lo que ya existe:** que `SIN_LECTURA` sea un estado, y que las fechas y la frecuencia puedan venir en `null`, se ajusta en la PV4, con las pantallas, porque toca componentes.
- **En `contrato-preventivos.ts`:** a cada ejemplo se le suman las claves nuevas, y en la tarea, `uso` completo. **Los valores que ya tenía no cambian.**

---

## 6. Pruebas de la API

### 6.1 `backend/tests/medidores.test.ts`, con el script `test:medidores` en `package.json` (segundo commit)

**Usuarios:** A (`ADMINISTRADOR`), O (`OPERARIO`), C (`CONSULTA`) y S, con `PLANES_GESTIONAR` en alcance `SECTORES`, solo del sector de la máquina 1. **Datos:** dos máquinas de la prueba, en sectores distintos.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| ME-01 | Permisos | • O: ve la lista y el detalle, y carga una lectura: 201. Alta, edición, baja y anular: 403.<br>• C: 403 en todas las rutas.<br>• S: alta en la máquina 1, 201; en la máquina 2, 403. Edita, da de baja o anula en un medidor de la máquina 2: 403. Lo ve: 200. |
| ME-02 | Alta y edición | • Alta con `lectura_inicial`: 201, con `ultima_lectura` `MANUAL` a nombre de A.<br>• 422: nombre de 2 o de 61, unidad vacía o de 21, `maquina_id: true`, `lectura_inicial` −1, `"10"` o 1,234.<br>• Máquina inexistente: 404. Inactiva: 422.<br>• "horómetro" donde ya está "Horómetro": 409 `MEDIDOR_DUPLICADO`. En la otra máquina: 201.<br>• `PATCH` de nombre y unidad: 200. Con `maquina_id`: 422.<br>• Desactivar y reactivar; repetir da los 409. Sin `?all=true`, el inactivo no está en la lista. |
| ME-03 | Lecturas | • Sin lecturas, cualquier valor desde 0: 201.<br>• Menor que la última: 422 `LECTURA_MENOR` con `ultima`. Igual: 201. Mayor: 201.<br>• 422: `"100"`, −1, 1,234, 1.000.000.000.000, sin `valor`, `null`, observación de 201.<br>• Medidor inactivo: 409. Máquina inactiva: 422. Medidor inexistente: 404.<br>• La lista: de la más nueva a la más vieja, `limit=1` con `X-Total-Count`, y `limit=0` 422. |
| ME-04 | Anular | • Sin motivo, o de 4: 422.<br>• Con motivo: 200, con los datos de la anulación.<br>• Repetir: 409. Una lectura de otro medidor en la ruta: 404.<br>• Anulada la última: `ultima_lectura` vuelve a la anterior, y se acepta un valor menor que la anulada.<br>• La anulada sigue en la lista, con `anulada: true`. |
| ME-05 | Concurrencia | Diez vueltas de cada caso:<br>• **dos lecturas a la vez,** 100 y 90, con la última en 50: las dos 201, o una 422 `LECTURA_MENOR`. Las vigentes, por id, nunca bajan;<br>• **una lectura y desactivar a la vez:** o 201 y el medidor inactivo, o 409 `MEDIDOR_INACTIVO` y ninguna lectura nueva;<br>• **dos altas con el mismo nombre en la misma máquina:** una 201 y otra 409. |
| ME-06 | Contrato | `mismaForma` sin diferencias, entre cada respuesta real y su ejemplo de la 5.1. |

### 6.2 En `backend/tests/preventivos.test.ts` (tercer commit)

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| PV-22 | La tarea por uso en el plan | • Solo por uso: 201, con la fecha en `null` y `anticipacion` 25 para `cada` 250.<br>• Con los dos criterios: 201.<br>• 422 con `indice`: sin criterio; sin `primera_fecha`; `cada` 0 y `"250"`; `primera` −1; anticipación mayor que `cada`; 3 decimales.<br>• 422 `MEDIDOR_INVALIDO`: un medidor de otra máquina, uno inactivo y uno que no existe.<br>• `PATCH`:<br>&nbsp;&nbsp;– sacar la fecha, con uso: 200;<br>&nbsp;&nbsp;– `uso: null` sin fecha: 422;<br>&nbsp;&nbsp;– solo `primera_fecha: null`: 422;<br>&nbsp;&nbsp;– cambiar de medidor, con una ejecución en el otro: la próxima vuelve a `primera`.<br>• Desactivar un medidor con una tarea activa: 409 `MEDIDOR_EN_USO` con `tarea_ids`. Con la tarea desactivada, se desactiva; reactivar la tarea da 409 `MEDIDOR_INACTIVO`. |
| PV-23 | Estado por uso | Los casos de M18-09, por la API: el estado, `faltan` y los combinados, en el detalle del plan. |
| PV-24 | Vencimientos con uso | • Por omisión trae las `SIN_LECTURA`. Con `estado=SIN_LECTURA`, solo esas.<br>• `resumen.sin_lectura`.<br>• El orden de la 4.2, con una vencida con fecha, una vencida solo por uso, una próxima, una sin lectura y una en curso.<br>• En la lista de planes: `sin_lectura`, y `proxima_fecha` `null` en un plan solo por uso. |
| PV-25 | Generar con uso | • Sin cuerpo, lleva la vencida por uso.<br>• La fila: `medidor_id`, `uso_programado` y `fecha_programada` `null`.<br>• El `GET` de las tareas: `uso` con `ultima_lectura`.<br>• Cambiar el medidor de la tarea del plan después no cambia la de la intervención. |
| PV-26 | Marcar con lectura | • Sin lecturas y sin `lectura`: 422 `LECTURA_REQUERIDA`.<br>• `lectura` menor: 422 `LECTURA_MENOR`.<br>• Igual: 200, sin lectura nueva.<br>• Mayor: 200, con una lectura `TAREA` con su `intervencion_id`, y `valor` en la tarea.<br>• Sin `lectura`, con lecturas: el valor es la última.<br>• 422: `lectura` en una tarea sin medidor, con `hecha: false`, y `"600"`.<br>• Repetir `hecha: true` con otra lectura: 200, sin cambios ni lectura nueva.<br>• Desmarcar: `valor` `null`, y la lectura queda.<br>• El medidor inactivo: con la última, 200; con una mayor, 409.<br>• `proximo_uso` en la respuesta.<br>• **Todo o nada:** una tarea con previstos y una `lectura` menor: 422, y ni la tarea ni los consumos cambian. |
| PV-27 | La próxima por uso se mueve sola | • Finalizar con la tarea hecha en 512,5: `ultimo` 512,5, `proximo` 762,5 y `AL_DIA`.<br>• Reabrir: vuelve.<br>• Cancelar o eliminar otra con la tarea: no cuenta. |
| PV-28 | Corrección en `FINALIZADA` | • R: 403.<br>• A sin motivo: 422 `MOTIVO_REQUERIDO`. Con motivo y sin `lectura`: 422 `LECTURA_REQUERIDA`. Con una mayor que la última: 422 `LECTURA_MAYOR`.<br>• Con motivo y 480: 200, la auditoría de la 4.4, ninguna lectura nueva, y la próxima movida. |
| PV-29 | Lo que llegue primero | Una tarea cada 6 meses o 250 horas:<br>• **por uso:** la lectura pasa el valor: `VENCIDA`, con `estado_fecha` `AL_DIA`. Generar, marcar y finalizar: los dos relojes se reinician, con `ultima_ejecucion` hoy, `proxima_fecha` a 6 meses, `ultimo` el valor y `AL_DIA`;<br>• **por fecha:** con una ejecución cargada en la base hace 7 meses, con `valor_medidor` 100, y la lectura en 200: `VENCIDA`, con `uso.estado` `AL_DIA`. |
| PV-30 | Concurrencia | Diez vueltas de cada caso:<br>• **marcar con una lectura mayor y cargar una lectura manual a la vez,** en el mismo medidor: sin trabas, y las vigentes, por id, nunca bajan;<br>• **cambiar una tarea a un medidor y desactivarlo a la vez:** lo de la 4.5. |
| PV-31 | Contrato del uso | Con una tarea con los dos criterios: el detalle del plan, un elemento de la lista, los vencimientos, las tareas de la intervención y la respuesta del `PATCH`, contra sus ejemplos de la 5.2. `mismaForma` sin diferencias. |

### 6.3 Lo que se suma a pruebas existentes

- **ID-01 (`ids.test.ts`):** las rutas nuevas con id, de las secciones 3 y 4, con un medidor de la prueba que se borra al final de ID-01.
- **`scripts/run-all-tests.mjs`:** `medidores` y `lecturas_medidor` se suman a las tablas que controla `test:todo`. En `CLAUDE.md`, de 21 pasa a 23.

Cada prueba crea y borra sus datos, como siempre: medidores, lecturas, tareas, intervenciones y lo que cuelga de ellas.

---

## 7. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 6 están hechas, en tres commits.
2. `test:migration-018`, `test:medidores`, `test:preventivos` y `test:ids` en verde, en Neon.
3. `npm run test:front`, `npm run typecheck` y `npm run build:frontend` sin errores.
4. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. Los tres hashes.
2. Cómo quedó la vista (2.6), con su SQL.
3. Dónde quedó `registrarLectura` y quién la usa.
4. La salida final de las cuatro suites del punto 2, y la de `test:front`.
5. Typecheck y build.
6. `wc -l` de los archivos tocados.
7. Desvíos y dudas.
8. Lo que quedó en la rama de pruebas que no es de esta etapa.
