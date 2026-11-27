# Etapa PV5 — Generación automática y avisos de vencimiento

> **Estado:** requerimiento para implementar. Etapa de noche: al final se corre `test:todo`.
> **Requisito previo:** commit `dc7ceed` (Etapa PV4.1).
> **Origen:** requisito 8 del relevamiento: el próximo vencimiento y un aviso cuando se acerca o vence. D-021, punto 4, lo dejó para esta etapa: hace falta un disparador programado y un autor que no es una persona.

**Qué entra:**
- un aviso en la campana cuando una tarea preventiva pasa a próxima o a vencida, una vez por vencimiento;
- la generación automática de la intervención, en los planes que la tengan prendida;
- la decisión de no hacer las rutinas del operario (D-024).

**Qué no entra:**
- avisar en el momento en que se carga una lectura: el control es una vez por día;
- WhatsApp;
- el indicador de cumplimiento en los reportes.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Tres commits.** Cada uno tiene que pasar `typecheck` solo.

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1 y 2 | `feat(db): generación automática y avisos de vencimiento` |
   | 2 | 3 y 4 | `feat(api): procesar vencimientos` |
   | 3 | 5 | `feat(front): plan automático y avisos` |

3. **Pruebas durante la etapa:** solo `test:migration-019` (nueva), `test:vencimientos` (nueva), `test:preventivos`, `test:ids` y `test:front`.
4. **Al final,** con los tres commits subidos: `npm run test:todo -- noche-2026-11-11`. Queda corriendo toda la noche. Su resumen va en el informe.
5. **Pruebas existentes: se autoriza cambiar solo esto,** y solo para sumar lo nuevo:
   - las que comparan el plan entero (detalle o elemento de la lista), con `generacion_automatica`;
   - `contrato-preventivos.ts`;
   - las que listan los tipos de aviso de la configuración de email, con el tipo nuevo;
   - las que cuentan usuarios o miembros de un perfil, si el usuario del sistema cambia la cuenta. En ese caso, primero ver la 2.1: el usuario del sistema no se tiene que contar.

   Si otra falla, frenar y avisar.
6. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-pv5-generacion-automatica-avisos.md`.

---

## 1. Decisiones (primer commit)

Agregar a `docs/decisiones.md`:

> **D-024 — Sin revisiones de rutina del operario**
>
> **Estado:** Aceptada
>
> **El requisito 7 del relevamiento** (revisiones diarias, semanales o mensuales del operario) **no se implementa.** Son controles de minutos: cargarlos en el sistema le agrega trabajo al operario y no da información que se use.
>
> El circuito ya está cubierto: el operario hace la revisión como hoy, y si encuentra algo usa "Reportar falla", que abre una intervención correctiva y avisa a mantenimiento. Lo que sí conviene seguir en el sistema, como un cambio de aceite o una tarea con repuestos, va en un plan preventivo.

> **D-025 — Generación automática y avisos de vencimiento**
>
> **Estado:** Aceptada
>
> 1. **Una vez por día,** el sistema revisa las tareas preventivas. Lo dispara el mismo programado de Neon que procesa los envíos. Un usuario con `PLANES_GESTIONAR` también lo puede pedir a mano.
> 2. **Un aviso por vencimiento:** cuando una tarea está próxima, se avisa una vez, y cuando vence, otra. El vencimiento se identifica por su próxima fecha o su próximo uso. Cuando se hace la tarea, cambia, y el ciclo vuelve a empezar.
> 3. **El aviso le llega** al responsable del plan. Si el plan no tiene responsable o está inactivo, les llega a los usuarios con `PLANES_GESTIONAR` que alcanzan el sector de la máquina. Va uno por plan, con sus tareas juntas.
> 4. **La generación automática se prende por plan** (`generacion_automatica`). Prendida, genera la intervención igual que el botón "Generar", con las tareas vencidas y próximas. Apagada, el plan solo avisa.
> 5. **El autor de lo automático es el usuario "Sistema".** No inicia sesión, no tiene permisos y no aparece en las listas de usuarios. Así cada intervención y cada aviso tienen un autor, como exige el modelo, sin inventar una persona.
> 6. **Un plan que falla no frena a los demás:** cada plan se procesa en su propia transacción, y el error queda en el resultado.

En D-021, punto 4, donde dice "la PV6", pasa a decir "la PV5 (D-025)".

---

## 2. Base de datos: migración `019_vencimientos.sql` (primer commit)

Aplicable varias veces, como las demás.

### 2.1 El usuario del sistema

- **`usuarios.es_sistema`:** `boolean`, no nulo, por omisión `false`.
- **Un único usuario con `es_sistema = true`,** con un índice único parcial:
  - legajo `SISTEMA`;
  - nombre "Sistema", apellido vacío o el que permita la tabla;
  - perfil `CONSULTA`;
  - `activo = false`;
  - una contraseña imposible: un hash que no corresponda a ninguna clave, por ejemplo uno generado al azar dentro de la migración.
- **No inicia sesión:** está inactivo, y además el login lo rechaza por `es_sistema`.
- **Se excluye** de toda lista y cuenta de usuarios de la API: la lista, el detalle, los miembros de un perfil, el control del último administrador y los responsables posibles. **Al mostrarlo como autor,** la API manda su nombre como a cualquier otro: "Sistema".

### 2.2 El plan

**`planes_mantenimiento.generacion_automatica`:** `boolean`, no nulo, por omisión `false`.

### 2.3 Los avisos ya dados

**`avisos_vencimiento`, nueva:**

| Columna | Tipo |
| :--- | :--- |
| `id` | `bigint` identidad |
| `plan_tarea_id` | FK a `plan_tareas`, no nulo |
| `estado` | `PROXIMA` o `VENCIDA` |
| `ciclo` | `varchar(40)`, no nulo: `F:<proxima_fecha>` y/o `U:<proximo_uso>`, unidos con `\|`, según los criterios de la tarea. |
| `avisado_en` | `timestamptz`, por omisión `now()` |

**Único:** `(plan_tarea_id, estado, ciclo)`.

### 2.4 La última revisión del día

**`configuracion_sistema.vencimientos_revisados_el`:** `date`, nulo.

### 2.5 El tipo de aviso

- **`PREVENTIVO_VENCIMIENTO`** se suma donde la `015` define los tipos de aviso con su regla de email.
- **Regla por omisión:** solo prioridad alta.
- **Prioridad:** `ALTA` si alguna tarea del aviso está vencida y la máquina es de criticidad con prioridad alta. Si no, `NORMAL`.

### 2.6 Pruebas, en `backend/tests/migration_019.test.ts`, con el script `test:migration-019`

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| M19-01 | Aplicar dos veces, y reaplicar con datos | No cambia nada, y sigue habiendo un solo usuario del sistema. |
| M19-02 | Estructura | Las columnas, la tabla, el índice único, y el usuario con `activo` `false` y perfil `CONSULTA`. |
| M19-03 | Restricciones | Rechaza un segundo `es_sistema`, un `estado` raro y un aviso repetido. |

---

## 3. Procesar los vencimientos (segundo commit)

**Una función nueva, `procesarVencimientos({ forzar })`,** en `backend/functions/preventivos/vencimientos.ts`.

### 3.1 Una vez por día

**Sin `forzar`,** primero:

```sql
UPDATE configuracion_sistema
SET vencimientos_revisados_el = hoy_instalacion()
WHERE id = 1 AND vencimientos_revisados_el IS DISTINCT FROM hoy_instalacion()
RETURNING 1
```

Si no devuelve fila, ya se revisó hoy: responde `{ revisado: false }` y no hace nada más.

**Con `forzar`,** revisa siempre. Igual no repite avisos ni duplica intervenciones, por la 2.3 y por los bloqueos de generar.

### 3.2 Los planes

**Entran los planes activos de máquinas activas** que tienen alguna tarea `VENCIDA` o `PROXIMA` en `v_plan_tareas_estado`. **Cada plan va en su propia transacción.**

**1. Generación automática.** Si el plan tiene `generacion_automatica`:
- genera con la misma función que `POST /api/planes/:id/generar`, sin `tarea_ids` y con el usuario del sistema como autor;
- **`SIN_TAREAS_PARA_GENERAR` no es un error:** por ejemplo, porque ya hay una en curso;
- la responsable se asigna como en la generación a mano;
- las notificaciones de la intervención salen como siempre.

**2. Avisos.** Con las tareas `VENCIDA` y `PROXIMA` que quedan después de generar, las que no pasaron a `EN_CURSO`:
- por cada una, `INSERT` en `avisos_vencimiento` con `ON CONFLICT DO NOTHING`. **Solo las que se insertaron** van en el aviso;
- si quedó al menos una, se crea **una notificación por destinatario**, con la máquina:
  - **tipo:** `PREVENTIVO_VENCIMIENTO`;
  - **autor:** el usuario del sistema;
  - **título:** "Preventivo: <nombre del plan>";
  - **mensaje:** "PIN-01 · Cámara de pintura: 2 tareas vencidas (Cambiar aceite, Revisar filtro) y 1 próxima (Engrasar)." Si se generó una intervención en el paso 1, suma: "Se generó la intervención N.º 14338.".
- **Los destinatarios,** por D-025, punto 3. La notificación pasa por la bandeja de salida, como las demás, así que el email sale con su regla.

**Si un plan falla,** se deshace su transacción, el error se anota y se sigue con el próximo.

### 3.3 El resultado

```json
{
  "revisado": true,
  "planes": 12,
  "generadas": [{ "plan_id": 5, "intervencion_id": 14338 }],
  "avisos": 7,
  "errores": [{ "plan_id": 9, "codigo": "MAQUINA_INACTIVA" }]
}
```

`avisos` es la cantidad de notificaciones creadas.

### 3.4 Concurrencia

- **Dos procesos a la vez:** sin `forzar`, la 3.1 deja pasar uno solo; con `forzar`, generar ya bloquea la máquina y el plan, y los avisos repetidos los frena el índice único.
- **Generar a mano a la vez que lo automático:** una sola intervención, como en PV-09. `RECURSO_OCUPADO` en lo automático cuenta como error del plan, y el plan se revisa al día siguiente o al forzar.

---

## 4. API (segundo commit)

| Ruta | Qué hace |
| :--- | :--- |
| `POST /api/avisos/procesar` | El programado de Neon, que corre cada minuto. Ahora llama primero a `procesarVencimientos()` sin `forzar`, y después a `procesarEnvios()`. Si el primero lanza un error, se anota y los envíos se procesan igual. Responde los dos resultados: `{ vencimientos, envios }`. |
| `POST /api/planes/procesar-vencimientos` | Pide `PLANES_GESTIONAR`. Llama a `procesarVencimientos({ forzar: true })` y responde su resultado. |
| Alta y `PATCH` de un plan | Aceptan `generacion_automatica`, booleano; otro tipo da 422. El detalle y la lista del plan lo devuelven. |
| `backend/server.ts`, el local | Donde hoy procesa los envíos cada 60 segundos, llama antes a `procesarVencimientos()`, igual que el programado. |

**`neon.ts` no cambia:** el programado ya existe.

---

## 5. Front (tercer commit)

- **En el alta y la edición del plan,** un `Switch`: "Generar la intervención sola", con la descripción "Cuando una tarea vence o está por vencer, el sistema genera la intervención. Apagado, solo avisa.".
- **En el encabezado del plan,** junto al responsable: "Generación automática", o nada si está apagada.
- **En Preventivos,** con `PLANES_GESTIONAR`, el botón "Revisar vencimientos ahora".
  - Muestra el resultado en una notificación: "Se revisaron 12 planes: 1 intervención generada, 7 avisos.".
  - Si hubo errores, suma: "2 planes con error.".
  - Refresca vencimientos, planes y tablero.
- **La campana** muestra el aviso como las demás notificaciones. Con `maquina_id`, lleva a la máquina.
- **El autor "Sistema"** se muestra como "Sistema", sin legajo.
- **En la configuración de avisos por email,** el tipo nuevo aparece con su nombre: "Vencimiento de un preventivo".

Las funciones con lógica van en `lib/`, con FE desde FE-122.

---

## 6. Pruebas de la API: `backend/tests/vencimientos.test.ts`, con el script `test:vencimientos` (segundo commit)

Sigue `CLAUDE.md`: `let client` y `clienteSano` en el `finally`.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| PA-01 | Permisos | `POST /api/planes/procesar-vencimientos`: sin `PLANES_GESTIONAR`, 403. `/api/avisos/procesar` sin el encabezado de Neon: 403. |
| PA-02 | Una vez por día | Sin `forzar`, dos veces seguidas: la segunda da `revisado: false`. Con `vencimientos_revisados_el` en ayer, vuelve a revisar. |
| PA-03 | Avisos | Con una tarea vencida y una próxima en un plan sin automática:<br>• una notificación al responsable, con las dos en el mensaje;<br>• forzar de nuevo: ninguna nueva;<br>• la próxima pasa a vencida: un aviso nuevo, solo con esa;<br>• se hace la tarea: con el ciclo nuevo, se vuelve a avisar cuando corresponda. |
| PA-04 | Destinatarios | • Sin responsable: los de `PLANES_GESTIONAR` que alcanzan el sector, y no los de otro sector.<br>• Responsable inactivo: igual que sin responsable.<br>• El usuario del sistema nunca recibe. |
| PA-05 | Prioridad | Vencida en una máquina de criticidad alta: `ALTA`. Solo próxima: `NORMAL`. |
| PA-06 | Generación automática | • Con `generacion_automatica`: genera una intervención con autor "Sistema", con las tareas que tocaban y la responsable del plan, y el aviso dice el número.<br>• Forzar de nuevo: no genera otra.<br>• Apagada: no genera y solo avisa. |
| PA-07 | Un plan que falla | Forzando un error en un plan, por ejemplo un disparador en la prueba como en U-17: los otros planes se procesan, y el error aparece con su `plan_id`. Del plan que falló no queda nada a medias. |
| PA-08 | El usuario del sistema | No inicia sesión: 401, aunque se le ponga una contraseña conocida en la prueba. No aparece en `GET /api/usuarios` ni en los responsables posibles. |
| PA-09 | Concurrencia | Diez vueltas:<br>• forzar dos veces a la vez: avisos sin repetir y una sola intervención;<br>• generar a mano a la vez que lo automático: una sola intervención. Se acepta `RECURSO_OCUPADO`, como en la PV3.1. |
| PA-10 | El programado | `POST /api/avisos/procesar` con el encabezado: responde `{ vencimientos, envios }`. Si `procesarVencimientos` falla, por ejemplo forzando un error, los envíos se procesan igual. |

**Sumar:**
- `avisos_vencimiento` a `TABLAS_CONTROL` de `scripts/run-all-tests.mjs`. En `CLAUDE.md`, de 23 pasa a 24;
- en ID-01, la ruta nueva no lleva id: no hace falta.

Cada prueba crea y borra lo suyo. **Ojo:** la PA-02 cambia `vencimientos_revisados_el`. Su `finally` lo devuelve al valor que tenía.

---

## 7. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 6 están hechas, en tres commits que compilan solos.
2. Las suites de la regla 3 en verde, en Neon.
3. `typecheck` y `build:frontend` sin errores.
4. Push en `feat/base-neon`.
5. `npm run test:todo -- noche-2026-11-11` corrido al final.

**Informe.** Las salidas van pegadas tal cual:

1. Los tres hashes.
2. Dónde se excluye el usuario del sistema (2.1): la lista de lugares.
3. La salida final de cada suite de la regla 3.
4. Typecheck y build.
5. El resumen de `test:todo`: el total y la línea de "Datos que quedaron".
6. Desvíos y dudas.
