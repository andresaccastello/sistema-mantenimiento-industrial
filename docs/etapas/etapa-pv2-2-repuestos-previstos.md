# Etapa PV2.2 — Repuestos previstos en las tareas

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `8f3cc55` (Etapa PV2.1).
> **Origen:** pedido de Andrés (09/11). Si el plan ya sabe que un cambio de aceite lleva aceite y filtro, el técnico no tiene que volver a cargarlos. Quedan previstos en la intervención, y él solo confirma lo que usó.

**Lo que hay que lograr, en una frase:** al tildar una tarea como hecha, se abre un diálogo con sus repuestos previstos ya cargados; el técnico confirma o corrige las cantidades, y recién ahí se registran como consumo y se descuentan del stock.

**Qué cambia:**
- **Una tarea del plan pasa de un repuesto sugerido a una lista de repuestos previstos,** cada uno con su cantidad.
- **Al generar la intervención,** los previstos se copian a cada tarea.
- **Nada se descuenta solo.** Se descuenta al confirmar, y al desmarcar la tarea se anula y vuelve al stock.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Tres commits:**

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1, 2 y 3 | `feat(api): repuestos previstos en las tareas preventivas` |
   | 2 | 4 | `feat(front): repuestos previstos en el plan` |
   | 3 | 5 y 6 | `feat(front): confirmar los repuestos al hacer una tarea` |

3. **Pruebas:**
   - solo `test:migration-018`, `test:preventivos`, `test:repuestos`, `test:costos` y `test:front`;
   - **no correr `test:todo`:** va en la corrida de la noche;
   - **se autoriza cambiar** M18-03, PV-02, PV-03 y PV-12, y el contrato de preventivos, solo en lo que cambia por `repuesto_id` y `cantidad` de la tarea. Las demás pruebas existentes no se modifican.
4. **El registro de un consumo y su anulación no se duplican.** La lógica de `POST /:id/repuestos` y de `/anular` se saca a funciones compartidas, y esta etapa las usa. Esos dos endpoints responden igual que hoy.
5. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-pv2-2-repuestos-previstos.md`.

---

## 1. Regla: D-022 (primer commit)

Agregar a `docs/decisiones.md`:

> **D-022 — Repuestos previstos en las tareas preventivas**
>
> **Estado:** Aceptada
>
> 1. **Una tarea del plan tiene una lista de repuestos previstos,** cada uno con su cantidad, hasta 10. Reemplaza al repuesto sugerido único de la PV1. El proveedor sugerido sigue igual.
> 2. **Al generar la intervención, los previstos se copian a cada tarea.** Cambiar el plan después no cambia la intervención.
> 3. **Un previsto no mueve stock.** Se registra como consumo recién cuando el técnico marca la tarea como hecha y confirma qué usó y cuánto. Puede bajar o subir la cantidad, o dejar uno sin usar.
> 4. **Desmarcar la tarea anula esos consumos,** y el stock vuelve.
> 5. **Se confirman con las reglas de cualquier consumo:** en `EN_PROCESO` o `EN_ESPERA_REPUESTOS` lo hace el responsable o quien tenga `INTERVENCIONES_ASIGNAR`; en `FINALIZADA`, solo `INTERVENCIONES_CORREGIR`, con motivo. **En `PENDIENTE` no se registran repuestos,** así que una tarea con previstos se marca después de iniciar el trabajo. Las tareas sin previstos se siguen marcando en `PENDIENTE`.
> 6. **Todo o nada:** si un repuesto no alcanza (`STOCK_INSUFICIENTE`) o está inactivo, no se marca la tarea ni se registra ningún consumo.
>
> **Motivo:** no cargar dos veces lo que el plan ya sabe, sin descontar stock de algo que quizás no se usó.

---

## 2. Base de datos (primer commit)

**Se edita la `018`,** que todavía no está en la base principal. Tiene que seguir siendo aplicable varias veces, también en una base donde la `018` vieja ya está aplicada y tiene datos.

### 2.1 `plan_tarea_repuestos`, nueva

| Columna | Tipo |
| :--- | :--- |
| `id` | `bigint` identidad |
| `plan_tarea_id` | FK a `plan_tareas`, no nulo, con índice |
| `repuesto_id` | FK a `repuestos`, no nulo. Único con `plan_tarea_id`. |
| `cantidad` | `numeric(14,3)`, no nulo, mayor que 0 |
| `orden` | `integer`, no nulo |

### 2.2 `plan_tareas`

- **Si todavía tiene `repuesto_id`,** cada tarea con repuesto pasa su repuesto y su cantidad a `plan_tarea_repuestos`, con orden 1. Después se sacan las dos columnas y su `CHECK`.
- **La vista** se vuelve a crear después de este cambio, porque usa `t.*`.

### 2.3 `intervencion_tarea_repuestos`, nueva

Los previstos de una tarea en la intervención.

| Columna | Tipo |
| :--- | :--- |
| `id` | `bigint` identidad |
| `intervencion_tarea_id` | FK a `intervencion_tareas`, no nulo, con índice |
| `repuesto_id` | FK a `repuestos`, no nulo. Único con `intervencion_tarea_id`. |
| `cantidad_prevista` | `numeric(14,3)`, no nulo, mayor que 0 |
| `orden` | `integer`, no nulo |
| `consumo_id` | FK a `intervencion_repuestos`, nulo, único: el consumo que se registró al confirmar. |

### 2.4 Pruebas de la migración

| ID | Qué |
| :--- | :--- |
| M18-03, cambiada | Las restricciones de la 2.1 y la 2.3: cantidad 0, el mismo repuesto dos veces en una tarea, y el mismo consumo en dos previstos. Sale lo de `repuesto_id` y `cantidad` de `plan_tareas`. |
| M18-06, nueva | **Con el formato de la PV1:** con `ROLLBACK`, volver a agregar `repuesto_id` y `cantidad` a `plan_tareas` y cargar una tarea con repuesto. Reaplicar la `018` deja esa tarea con un previsto igual, y sin las dos columnas. |

---

## 3. API (primer commit)

### 3.1 El plan

**En el alta del plan, en `POST /:id/tareas` y en el `PATCH` de una tarea:**

- **`repuesto_id` y `cantidad` se reemplazan por `repuestos`:** `[{ "repuesto_id": 2, "cantidad": 2.5 }]`.
  - Opcional, de 0 a 10 elementos, sin repetir repuesto.
  - Cada repuesto, activo y leído con `FOR SHARE`; la cantidad, con las reglas de un consumo de la R1.
  - **Los errores** dan `indice_repuesto`, y en el alta del plan también `indice` de la tarea.
  - **En el `PATCH`, `repuestos` reemplaza la lista entera.** Si no viene, no cambia. Como en la PV1, un repuesto que ya estaba y se desactivó después no impide guardar la misma lista.
- **Mandar `repuesto_id` o `cantidad` sueltos** en una tarea da 422 `DATOS_INVALIDOS`, con el mensaje "Usá repuestos.".

**En el detalle del plan,** `repuesto` y `cantidad` de cada tarea se reemplazan por:

```json
"repuestos": [
  { "repuesto": { "id": 2, "codigo": "AC-68", "nombre": "Aceite ISO 68", "unidad": "litro" }, "cantidad": 2.5 }
]
```

### 3.2 Generar

**Cada tarea copiada a `intervencion_tareas` copia también sus previstos** a `intervencion_tarea_repuestos`, con su orden. Si un repuesto está inactivo, se copia igual: el técnico lo va a poder dejar sin usar.

### 3.3 Las tareas de una intervención

**`GET /api/intervenciones/:id/tareas`:**
- `repuesto` y `cantidad` de cada tarea se reemplazan por `repuestos_previstos`;
- se suma `previstos_sin_confirmar` al `resumen`: los previstos de las tareas no hechas.

```json
"repuestos_previstos": [
  {
    "id": 31,
    "repuesto": { "id": 2, "codigo": "AC-68", "nombre": "Aceite ISO 68", "unidad": "litro", "lleva_stock": true, "cantidad_disponible": 12 },
    "cantidad_prevista": 2.5,
    "estado": "USADO",
    "consumo": { "id": 880, "cantidad": 2, "anulado": false }
  }
]
```

| `estado` | Cuándo |
| :--- | :--- |
| `PREVISTO` | La tarea no está hecha. |
| `USADO` | La tarea está hecha y su consumo no está anulado. |
| `NO_USADO` | La tarea está hecha sin consumo, o su consumo se anuló después desde el bloque de repuestos. |

- **`cantidad_disponible`** va solo si el usuario puede ver el stock, con las mismas reglas que hoy en la intervención. Si no, `null`.
- **`consumo`** es `null` si no hay.

**`PATCH /api/intervenciones/:id/tareas/:tareaId`:**

| Campo | Regla |
| :--- | :--- |
| `repuestos` | `[{ "id": 31, "cantidad": 2 }]`: los previstos que se usaron, con la cantidad usada. Los que no vienen quedan `NO_USADO`.<br>• **Obligatorio** al pasar a `hecha: true` una tarea con previstos. Puede ser `[]`, si no se usó ninguno.<br>• **Cada `id`** tiene que ser un previsto de esa tarea, sin repetir; si no, 422 `DATOS_INVALIDOS`.<br>• **La cantidad,** con las reglas de un consumo.<br>• En una tarea sin previstos, o con `hecha: false`, se ignora. |

**Al marcar con previstos,** en una transacción, con la intervención bloqueada:

1. **Los permisos y el estado** son los de un consumo (D-022, punto 5).
   - En `PENDIENTE`, una tarea con previstos da 409 `ESTADO_NO_PERMITE_REPUESTOS`, con el mensaje "Iniciá el trabajo para confirmar los repuestos de esta tarea.".
   - En `FINALIZADA`, el `motivo` va también a cada consumo.
2. **Por cada previsto usado,** registra el consumo con la función compartida (regla 4), con la observación `Previsto en la tarea «<acción>»`, y guarda su `consumo_id`.
3. **Marca la tarea como hecha.**
4. **Si un consumo falla, no queda nada:** ni consumos, ni movimientos de stock, ni la tarea marcada.
   - `STOCK_INSUFICIENTE`, `REPUESTO_INACTIVO` y los demás errores de un consumo se responden igual que hoy, con `previsto_id` en los detalles.

**Al desmarcar** (`hecha: false`) una tarea con consumos de previstos:
- se anulan con la función compartida, con el motivo `Se desmarcó la tarea «<acción>»` (en `FINALIZADA`, el motivo del pedido);
- el stock vuelve;
- `consumo_id` queda en `null`.

Los consumos que ya estaban anulados se saltean.

**Mandar `hecha: true` a una tarea que ya está hecha** sigue respondiendo 200 sin cambios, aunque venga `repuestos`. Para corregir lo usado, se desmarca y se vuelve a marcar.

### 3.4 Pruebas de la API

Se suman a `preventivos.test.ts`:

| ID | Qué |
| :--- | :--- |
| PV-15 | **Previstos en el plan:**<br>• una tarea con dos previstos;<br>• errores: el mismo repuesto dos veces, 11 previstos, cantidad 0, un repuesto inactivo (con `indice` e `indice_repuesto`), y `repuesto_id` suelto;<br>• el `PATCH` con `repuestos` reemplaza la lista, y sin `repuestos` no la toca. |
| PV-16 | **Generar** copia los previstos de cada tarea, también el de un repuesto inactivo. Cambiar el plan después no cambia la intervención. |
| PV-17 | **Confirmar:**<br>• marcar con un previsto usado con otra cantidad y otro sin usar: un consumo con la cantidad usada, el stock baja esa cantidad, el costo de repuestos de la intervención se recalcula, y los estados quedan `USADO` y `NO_USADO`;<br>• `repuestos: []`: hecha y sin consumos;<br>• sin `repuestos`: 422;<br>• un `id` de otra tarea: 422;<br>• un repuesto que no lleva stock: consumo sin movimiento, como hoy. |
| PV-18 | **Todo o nada:** con un previsto sin stock suficiente, 409 `STOCK_INSUFICIENTE` con `previsto_id`. No queda ningún consumo ni movimiento, la tarea sigue sin marcar, y el stock de los otros repuestos no cambia. |
| PV-19 | **Desmarcar:**<br>• anula los consumos y el stock vuelve;<br>• un consumo anulado antes desde el bloque de repuestos deja ese previsto `NO_USADO`, y al desmarcar se saltea. |
| PV-20 | **Estados y permisos:**<br>• en `PENDIENTE`, una tarea con previstos da 409, y una sin previstos se marca;<br>• R2: 403;<br>• en `FINALIZADA`, A con motivo registra los consumos con ese motivo, y R da 403;<br>• en `CANCELADA`: 409. |
| PV-21 | **Concurrencia,** diez vueltas:<br>• dos confirmaciones de la misma tarea a la vez: un solo juego de consumos;<br>• confirmar dos tareas que comparten repuesto, con stock para una sola: una pasa y la otra da `STOCK_INSUFICIENTE`, y el stock nunca queda negativo. |

**PV-12 y el contrato:** el ejemplo del detalle del plan y el de las tareas de una intervención se vuelven a copiar de respuestas reales.

---

## 4. Front: el plan (segundo commit)

**En el diálogo de una tarea (PV2, 3.5),** "Repuesto sugerido" y su cantidad pasan a una lista, "Repuestos previstos":
- cada fila con el buscador del repuesto, la cantidad con su unidad y un botón para quitarla;
- debajo, "Agregar repuesto", hasta 10;
- **validación:** un repuesto repetido da "Ese repuesto ya está en la lista."; una cantidad vacía o inválida, el mensaje de siempre;
- **los errores de la API** con `indice_repuesto` van a su fila.

**Donde hoy se ve "Sugerido"** (tabla de tareas de P2, lista de tareas de P3) se ve la lista: "Aceite ISO 68 × 2,5 litro · Filtro de aceite × 1 unidad". Con más de dos: "Aceite ISO 68 × 2,5 litro y 2 más", y el detalle completo en un `Tooltip`.

**En `lib/preventivos.ts`:** `validarTareaBorrador`, `cuerpoTarea` y `errorTareaDeApi` se adaptan a la lista. Suma `textoPrevistos(repuestos)`.

---

## 5. Front: confirmar al hacer una tarea (tercer commit)

### 5.1 En el bloque de tareas de R3

**Cada tarea muestra sus previstos debajo de la acción:**
- **sin hacer:** "Previsto: Aceite ISO 68 × 2,5 litro · Filtro × 1 unidad";
- **hecha:** cada uno con su estado. "Usado: 2 litro" en verde, "No usado" en gris.

**Tildar una tarea con previstos:**
- **En `PENDIENTE`:** no se manda nada. Se muestra al lado: "Iniciá el trabajo para confirmar los repuestos.".
- **En los otros estados:** se abre el diálogo de la 5.2.

**Destildar una tarea con repuestos usados** pide confirmación: "Se anulan los repuestos registrados de esta tarea y vuelven al stock.". En `FINALIZADA` va con el diálogo de motivo que ya existe.

**Las tareas sin previstos** se marcan como hoy.

### 5.2 Diálogo "Confirmar tarea"

- **Título:** "Marcar como hecha", y debajo la acción.
- **"¿Qué repuestos usaste?":** una fila por previsto, con:
  - una casilla, tildada;
  - el nombre;
  - la cantidad, editable, con la prevista por omisión y la unidad al lado;
  - el disponible, si viene: "Hay 12 litro". Si la cantidad es mayor, en rojo: "No alcanza: hay 1,5 litro.".
- **Destildar un repuesto** deshabilita su cantidad.
- **La observación de la tarea,** opcional.
- **En `FINALIZADA`,** el motivo, obligatorio, con el aviso de la corrección que ya existe.
- **El botón:**
  - "Marcar como hecha" sin repuestos tildados;
  - "Marcar como hecha y registrar 1 repuesto" con uno;
  - "… 2 repuestos" con más.
- **Errores:** `STOCK_INSUFICIENTE` y `REPUESTO_INACTIVO` van a la fila de su `previsto_id`. Los demás, con `mensajeError`.
- **Al confirmar,** se refrescan las tareas, los repuestos, los costos, el detalle y los planes.

### 5.3 En el bloque "Repuestos usados" de R3

Si hay previstos sin confirmar, debajo del título va: "Hay 3 repuestos previstos en las tareas: se registran al marcarlas como hechas.".

### 5.4 Lógica y pruebas

**En `lib/preventivos.ts`:**

| Función | Qué hace |
| :--- | :--- |
| `filasConfirmar(previstos)` | Arma las filas del diálogo. |
| `validarConfirmar(filas)` | Valida cantidades y avisa si no alcanza el stock. |
| `cuerpoConfirmar(filas, observacion, motivo)` | Arma el cuerpo del `PATCH`. |
| `textoBotonConfirmar(n)` | El texto del botón. |
| `textoEstadoPrevisto(previsto)` | "Usado: 2 litro", "No usado" o "Previsto". |

**Pruebas:** FE-80 en adelante, una por función nueva o adaptada.

---

## 6. Un detalle de antes (tercer commit)

**En R5, la tabla "Intervenciones de esta máquina"** corta las insignias de estado a 1280 y 1366 px ("Pend…"). Viene de antes de la PV2. Va con el mismo criterio que la PV2.1: un ancho mínimo en la columna Estado, y que la insignia "Preventivo" no se corte.

---

## 7. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 6 están hechas, en tres commits.
2. `test:migration-018`, `test:preventivos`, `test:repuestos` y `test:costos` en verde, en Neon.
3. `npm run test:front`, `npm run typecheck` y `npm run build:frontend` sin errores.
4. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. Los tres hashes.
2. Las funciones compartidas de consumo y anulación: dónde quedaron y quién las usa.
3. Cómo quedó la `018` en la parte de `plan_tareas`, con su SQL.
4. La salida final de las cinco suites.
5. Typecheck y build.
6. `wc -l` de los archivos tocados.
7. Lo que no pudiste probar en pantalla.
8. Desvíos y dudas.
