# Etapa RT1 — Tareas de rutina (diarias y semanales)

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `af78290` (HE1).
> **Origen:**
> - la entrevista con GI-RE del 19/11. Ejemplo: al láser no le cambiaron el agua en 8 meses y se tapó. Hoy esas tareas van en una hoja pegada en la máquina que nadie completa;
> - lo que acordamos con Andrés el 19/11.

**La idea en una línea:** cada máquina puede tener tareas cortas, diarias o semanales, que hace el operario. El operario las marca como hechas con un toque, y el administrador ve si se vienen haciendo.

**Lo que esto NO es** (D-033):
- **No son intervenciones:** no tienen estados, ni repuestos, ni costos, ni avisos.
- **No son preventivos:** no van en el calendario ni en los planes, y no generan nada.
- **Si el operario encuentra un problema,** usa "Reportar falla", como siempre.

**En el código se llaman "rutinas"** (`rutinas`, `rutina_registros`, `/api/rutinas`), para no confundirlas con las tareas de los planes (`plan_tareas`). **En pantalla** se llaman "Tareas de rutina" y, para el operario, "Tareas de hoy".

**Qué no entra:**
- avisos o mails por tareas no hechas;
- tareas mensuales: van como preventivo por fecha;
- marcar un día que ya pasó;
- tener en cuenta el estado de la máquina (parada o en mantenimiento);
- el QR.

---

## 0. Reglas de trabajo

1. **Leé `CLAUDE.md` entero y seguí sus reglas.**
   - **Nunca abras, leas, muestres ni modifiques `.env`.**
   - Rama `feat/base-neon`. **No se agregan dependencias.**
2. **Tres commits.** Cada uno tiene que pasar `npm run typecheck` solo:

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1, 2, 3, 6.1 y 6.2 | `feat(api): tareas de rutina` |
   | 2 | 4 | `feat(front): tareas de hoy` |
   | 3 | 5 y 6.3 | `feat(front): rutinas en la máquina y en reportes` |

3. **Pruebas:**
   - **en Neon:**
     - `test:migration-024` y `test:rutinas`, las dos nuevas;
     - `test:migration-014`, `test:permisos`, `test:excepciones`, `test:usuarios`, `test:administracion` y `test:api-front`;
   - **además:** `test:front`, `typecheck` y `build:frontend`;
   - **no correr `test:todo`.**
4. **Pruebas existentes:** se autoriza cambiar solo las que comparan la lista exacta de permisos de un perfil, o los ítems del menú de la computadora o del celular. Solo para sumar `RUTINAS_REALIZAR` y el ítem "Tareas de hoy". **Lo que ya se esperaba no cambia.** Si una prueba falla por otra cosa, frenar y avisar.
5. **Ante cualquier duda, frenar y preguntar.**
6. **Los números:**
   - la decisión es la **D-033**;
   - la migración, la **024**;
   - las FE nuevas, desde la **FE-168**.

   Si alguno ya está usado, frenar y avisar.

Guardar este archivo como `docs/etapas/etapa-rt1-tareas-de-rutina.md`.

---

## 1. Migración 024 (primer commit)

Va en `database/migrations/024_rutinas.sql` y tiene que poder reaplicarse sin error.

### 1.1 `rutinas`

| Columna | Tipo | Regla |
| :--- | :--- | :--- |
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PK |
| `maquina_id` | `BIGINT NOT NULL` | FK a `maquinas` |
| `descripcion` | `VARCHAR(200) NOT NULL` | `CHECK (btrim(descripcion) <> '')` |
| `frecuencia` | `VARCHAR(7) NOT NULL` | `CHECK IN ('DIARIA', 'SEMANAL')` |
| `incluye_sabado` | `BOOLEAN NOT NULL DEFAULT FALSE` | `CHECK (frecuencia = 'DIARIA' OR NOT incluye_sabado)` |
| `activa` | `BOOLEAN NOT NULL DEFAULT TRUE` | |
| `vigente_desde` | `DATE NOT NULL` | El "hoy" del alta o de la última reactivación |
| `baja_en` | `DATE NULL` | `CHECK (activa = (baja_en IS NULL))` |
| `creado_por_usuario_id` | `BIGINT NOT NULL` | FK a `usuarios` |
| `creado_en`, `actualizado_en` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |

- **Una descripción no se repite** entre las activas de una máquina: índice único sobre `(maquina_id, lower(btrim(descripcion))) WHERE activa`.
- **Índice por `maquina_id`.**
- **Las rutinas no se borran:** se dan de baja.

### 1.2 `rutina_registros`: una fila por cada vez que se hizo

| Columna | Tipo | Regla |
| :--- | :--- | :--- |
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PK |
| `rutina_id` | `BIGINT NOT NULL` | FK a `rutinas`, sin `CASCADE` |
| `periodo` | `DATE NOT NULL` | El día (diaria) o el lunes de la semana (semanal) |
| `usuario_id` | `BIGINT NOT NULL` | FK a `usuarios`: quién la marcó |
| `hecha_en` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |
| `nota` | `VARCHAR(500) NULL` | |

- **`UNIQUE (rutina_id, periodo)`:** se marca una sola vez por período.
- **`CHECK`:** si la rutina es semanal, el `periodo` es un lunes. Va como trigger o como validación en la API; elegí uno y decilo en el informe.

### 1.3 Funciones, para que la API, el reporte y las pruebas usen la misma regla

- **`periodo_rutina(frecuencia, fecha) → DATE`:**
  - `DIARIA` devuelve la misma fecha;
  - `SEMANAL` devuelve el lunes de esa semana: `fecha - (ISODOW - 1)`.
- **`rutina_corresponde(frecuencia, incluye_sabado, fecha) → BOOLEAN`:**
  - `DIARIA`: de lunes a viernes, y el sábado si `incluye_sabado`. **El domingo nunca.**
  - `SEMANAL`: siempre `TRUE`.

Las dos son `IMMUTABLE`. El "hoy" sale siempre de `hoy_instalacion()`.

### 1.4 El permiso nuevo

`RUTINAS_REALIZAR`, "Marcar tareas de rutina": "Permite marcar como hechas las tareas de rutina de las máquinas". Lleva `usa_alcance = TRUE`.

| Perfil | Alcance |
| :--- | :--- |
| ADMINISTRADOR | `TODAS` |
| RESPONSABLE_MANTENIMIENTO | `TODAS` |
| OPERARIO | `SECTORES` |

- **El alcance `SECTORES`** usa los sectores del usuario (`usuario_sector`), como en el resto del sistema. Si el operario no tiene sectores, no ve ninguna rutina.
- **En la 014:** sumar `RUTINAS_REALIZAR` a la lista del `UPDATE permisos SET usa_alcance = ...`. Si no, reaplicar la 014 lo vuelve a `FALSE`.
- **Para crear y gestionar rutinas no hay permiso nuevo:** se usa `PLANES_GESTIONAR`, con su alcance (`sectoresDelAlcance`).
- **Para el reporte,** `REPORTES_CONSULTAR`, con su alcance.

**`scripts/run-all-tests.mjs`:** sumar `rutinas` y `rutina_registros` a `TABLAS_CONTROL`. En `CLAUDE.md`, "24 tablas" pasa a "26 tablas".

---

## 2. API (primer commit)

Va en `backend/functions/rutinas.ts`, y si pasa de unas 500 líneas, en `backend/functions/rutinas/`.

**Cómo se tratan los errores:**
- con `ErrorNegocio`, sin 500 previsibles;
- un único repetido de la base se traduce a 409, nunca a 500.

**Los códigos:**

| Código | Status | Cuándo |
| :--- | :--- | :--- |
| `RUTINA_NO_ENCONTRADA` | 404 | También fuera de alcance, como en los planes. |
| `RUTINA_DUPLICADA` | 409 | Misma descripción entre las activas de la máquina. |
| `RUTINA_YA_HECHA` | 409 | Ya está marcada en este período. |
| `RUTINA_NO_CORRESPONDE` | 422 | Hoy no toca, la rutina está dada de baja o la máquina está inactiva. |
| `DATOS_INVALIDOS` | 422 | |
| `PERMISO_INSUFICIENTE` | 403 | |

**La forma de una rutina en las respuestas:**

```jsonc
{
  "id": 12, "descripcion": "Cambiar el agua del refrigerante", "frecuencia": "SEMANAL",
  "incluye_sabado": false, "activa": true, "vigente_desde": "2026-11-24", "baja_en": null,
  "maquina": { "id": 5331, "codigo": "COM-01", "nombre": "…", "sector": { "id": 2011, "nombre": "…" }, "planta": { "id": 482, "nombre": "…" } }
}
```

### 2.1 Gestión, con `PLANES_GESTIONAR` y la máquina dentro del alcance

**`GET /api/maquinas/:id/rutinas?incluir_inactivas=true`**
- **Quién la usa:** se puede con `PLANES_GESTIONAR` o con `REPORTES_CONSULTAR`, cada uno con su alcance.
- **Qué devuelve,** por cada rutina:
  - la rutina;
  - `ultima`: `{ periodo, hecha_en, usuario }` o `null`;
  - `recientes`: los últimos 7 períodos esperados, del más viejo al más nuevo. Cada uno con `{ periodo, estado }`, donde el estado es `HECHA`, `NO_HECHA` o `PENDIENTE`, como en la 2.3.
- **Orden:** primero las activas, después por descripción.

**`POST /api/maquinas/:id/rutinas`** con `{ descripcion, frecuencia, incluye_sabado? }`:
- la máquina tiene que estar activa;
- la descripción se guarda con `trim`, y vacía o de más de 200 caracteres da 422;
- `incluye_sabado` es booleano real, y con `SEMANAL` en `true` da 422;
- `vigente_desde` es `hoy_instalacion()`;
- responde 201 con la rutina.

**`PATCH /api/rutinas/:id`** con `{ descripcion?, incluye_sabado?, activa? }`:
- **la `frecuencia` no se cambia:** si viene, da 422, porque cambiaría la historia. Para otra frecuencia, se da de baja y se crea otra;
- **`activa: false`:** `baja_en` pasa a ser el "hoy" de la instalación;
- **`activa: true`:** `vigente_desde` pasa a ser hoy y `baja_en`, `NULL`;
- **reactivar con una descripción repetida** da 409 `RUTINA_DUPLICADA`;
- **concurrencia:** `FOR UPDATE` en la rutina.

### 2.2 El operario, con `RUTINAS_REALIZAR`

**`GET /api/rutinas/hoy?maquina_id=`** (el filtro es opcional)
- **Qué rutinas trae:** las activas de máquinas activas, dentro del alcance, que corresponden hoy (`rutina_corresponde(…, hoy)`).
- **Respuesta:**

  ```jsonc
  {
    "hoy": "2026-11-24", "sin_sectores": false,
    "rutinas": [ { …rutina, "periodo": "2026-11-24",
                   "registro": null | { "id", "usuario": { id, legajo, nombre, apellido }, "hecha_en", "nota" } } ]
  }
  ```

- **`sin_sectores`** es `true` cuando el alcance es `SECTORES` y el usuario no tiene ningún sector.
- **Orden:**
  - primero las que faltan, después las hechas;
  - dentro de cada grupo, por planta, sector, código de máquina y descripción.

**`POST /api/rutinas/:id/hecha`** con `{ nota? }`:
- la rutina tiene que estar dentro del alcance, activa, con la máquina activa, y tiene que corresponder hoy;
- el período es `periodo_rutina(frecuencia, hoy)`;
- `nota`: con `trim`; vacía queda en `null`; más de 500 caracteres da 422;
- `FOR SHARE` en la rutina y en la máquina;
- **si ya estaba hecha, 409 `RUTINA_YA_HECHA`, aunque sea de otra persona.** Si dos personas marcan a la vez, una recibe 201 y la otra 409; nunca 500;
- responde 201 con el registro.

**`DELETE /api/rutinas/:id/hecha`:** deshace la marca del período actual.
- **Solo quien la marcó;** a cualquier otro, 403.
- Si no hay marca en el período actual, 404 `RUTINA_NO_ENCONTRADA`.
- Los períodos que ya pasaron no se tocan.

### 2.3 El reporte, con `REPORTES_CONSULTAR`

**`GET /api/reportes/rutinas?desde=&hasta=&planta_id=&sector_id=&maquina_id=`**
- **El intervalo** se valida con `validarIntervaloReporte`, como en los demás reportes. Además: como mucho 92 días; si no, 422.
- **Los filtros** se validan como en `reportes/cumplimiento.ts`, con el alcance de `REPORTES_CONSULTAR`.
- **Entran** las rutinas de máquinas activas, activas o dadas de baja, que estuvieron vigentes en algún momento del intervalo.

**Los períodos esperados de cada rutina** son todos los de `periodo_rutina` que cumplen estas condiciones:
- caen entre `max(desde, vigente_desde)` y `min(hasta, hoy, baja_en)`;
- en las diarias, solo los días en que `rutina_corresponde` da `TRUE`;
- en las semanales, la semana de `vigente_desde` cuenta aunque haya empezado a mitad de semana.

**El estado de cada período:**
- `HECHA`: tiene registro;
- `PENDIENTE`: es el período actual y todavía no tiene registro;
- `NO_HECHA`: ya pasó sin registro.

**La respuesta:**

```jsonc
{
  "desde": "…", "hasta": "…", "hoy": "…",
  "resumen": { "esperadas": 40, "hechas": 31, "no_hechas": 8, "pendientes": 1, "porcentaje": 79 },
  "rutinas": [ { …rutina,
    "resumen": { "esperadas", "hechas", "no_hechas", "pendientes", "porcentaje" },
    "periodos": [ { "periodo": "2026-11-24", "estado": "HECHA", "usuario": {…} | null, "hecha_en": "…" | null, "nota": "…" | null } ] } ]
}
```

- **El `porcentaje`** es `round(hechas / (hechas + no_hechas) × 100)`. Los pendientes no cuentan, y sin períodos cerrados es `null`.
- **Las rutinas van ordenadas** por planta, sector, código de máquina, frecuencia y descripción.

---

## 3. D-033, en `docs/decisiones.md` (primer commit)

**D-033 — Tareas de rutina del operario.** Reemplaza la D-024.

1. **Cada máquina puede tener tareas de rutina cortas,** diarias o semanales, que hace el operario. Por ejemplo, cambiar el agua del refrigerante o limpiar el lente.
2. **No son intervenciones ni preventivos:** no tienen estados, repuestos, costos ni avisos, y no van al calendario. Si aparece un problema, se usa "Reportar falla".
3. **Se marcan con un toque,** con una nota opcional, y solo en el período actual: el día, o la semana de lunes a domingo. Lo que no se marcó a tiempo queda como no hecho.
4. **Las diarias corresponden de lunes a viernes,** más el sábado si la tarea lo indica. Las semanales, cualquier día de la semana.
5. **Las ve y las marca** cualquier usuario con `RUTINAS_REALIZAR` dentro de su alcance. Para el operario, son los sectores que tiene asignados.
6. **El administrador ve el cumplimiento** por máquina y en Reportes.

**Motivo:** en la entrevista del 19/11, GI-RE contó una rotura por una tarea de rutina que no se hizo durante meses. La D-024 suponía que estas tareas no aportaban información. El cliente mostró que sí, siempre que marcarlas no le agregue trabajo al operario.

En la D-024, el estado pasa a "Reemplazada por la D-033".

---

## 4. Tareas de hoy, la pantalla del operario (segundo commit)

**La pantalla nueva es `pantallas/TareasDeHoy.tsx`,** en la ruta `/rutinas`, con `React.lazy` como las demás.

**El menú:**
- **en la computadora:** el ítem "Tareas de hoy" (`IconChecklist`), después de "Lecturas", con `RUTINAS_REALIZAR`;
- **en el celular con modo simple:** el mismo ítem, y `permitidaEnCelular('/rutinas')` con `RUTINAS_REALIZAR`.

**El encabezado:** "Tareas de hoy · lunes 24/11".

**Las tareas, agrupadas por máquina:**
- cada grupo tiene como título el código, el nombre y el sector de la máquina;
- cada tarea muestra la descripción y el badge "Diaria" o "Semanal".

**Para marcar:**
- **un toque en "Hecha"** la marca, sin confirmación. Es el caso de todos los días;
- **un ícono al lado,** "Con nota", abre un modal chico con la nota y "Marcar hecha".

**Una tarea hecha** muestra "Hecha por L. Pérez a las 10:32", y la nota si tiene.
- Si la marcó el usuario que está mirando, aparece "Deshacer", que pide confirmación.

**Los casos especiales:**
- **una semanal hecha el martes** sigue apareciendo como hecha el resto de la semana;
- **un 409 `RUTINA_YA_HECHA`** (otro la marcó antes) refresca la lista y muestra "Ya la marcó otra persona";
- **sin tareas:** "Hoy no hay tareas de rutina";
- **con `sin_sectores`:** "No tenés sectores asignados. Pedile al administrador que te asigne los tuyos".

**El diseño:**
- **en el celular,** botones de 44 px de alto como mínimo;
- **nada se sale de costado a 390 px;**
- **modo claro y modo oscuro,** solo con variables `--sm-*`.

**Funciones puras en `lib/rutinas.ts`, con pruebas desde FE-168:**
- agrupar por máquina y ordenar;
- el texto "Hecha por … a las …";
- el rótulo de la frecuencia;
- si se puede deshacer (lo marcó el usuario actual).

---

## 5. La máquina y el reporte (tercer commit)

### 5.1 La ficha de la máquina: `componentes/rutinas/BloqueRutinasMaquina.tsx`

- **Se ve** con `PLANES_GESTIONAR` o con `REPORTES_CONSULTAR`.
- **Cada rutina muestra:**
  - descripción y frecuencia, con "incluye sábado" si corresponde;
  - "Última vez: 21/11, L. Pérez";
  - los 7 períodos recientes como puntos: verde si se hizo, rojo si no, y gris con borde si está pendiente. Cada punto lleva un tooltip con la fecha.
- **Con `PLANES_GESTIONAR`,** botones "Nueva tarea de rutina", "Editar" y "Dar de baja / Reactivar". En el modal:
  - descripción;
  - frecuencia con `SegmentedControl`, que **no se puede cambiar** al editar;
  - "incluye sábado", solo si es diaria.
- **Las dadas de baja** quedan ocultas detrás de "Ver dadas de baja".

### 5.2 Reportes: la pestaña "Rutinas"

**La pestaña** va después de "Preventivos" y usa los filtros de la pantalla. El período por defecto son las últimas 4 semanas.

**Arriba, el resumen:** esperadas, hechas, no hechas y porcentaje.

**Abajo, dos grillas,** una para las diarias (con una columna por día) y otra para las semanales (con una columna por semana):
- **las filas** muestran la máquina y la descripción;
- **las celdas** muestran el color del estado, con tooltip de quién, cuándo y la nota;
- **la última columna** es el porcentaje.

**El scroll horizontal queda dentro de la grilla,** nunca en la página.

**En el celular,** en lugar de la grilla, una lista: cada rutina con su porcentaje y sus últimos 5 períodos como puntos.

**Funciones en `lib/rutinas.ts`, con sus FE:**
- las columnas de la grilla a partir de la respuesta;
- el color y el rótulo de cada estado;
- el formato del porcentaje, con "—" si es `null`.

---

## 6. Pruebas

### 6.1 `test:migration-024` (M24)

- Las tablas, las columnas y los `CHECK`:
  - frecuencia inválida;
  - sábado en una semanal;
  - `activa` y `baja_en` que no coinciden;
  - descripción vacía.
- El único de descripción entre las activas, y que se pueda repetir si la otra está dada de baja.
- El único de `(rutina_id, periodo)`.
- `periodo_rutina` y `rutina_corresponde` con fechas fijas:
  - un lunes, un sábado y un domingo;
  - un sábado con y sin `incluye_sabado`;
  - el período semanal de un jueves.
- `RUTINAS_REALIZAR` con sus tres alcances y `usa_alcance = TRUE`, incluso después de reaplicar la 014.
- Reaplicar la migración no da error.

### 6.2 `test:rutinas` (RT)

- **Cómo se arma:**
  - los datos se crean y se borran en la misma prueba, con nombres genéricos;
  - para armar historia se cambia `vigente_desde` y se insertan registros con períodos pasados directo en la base;
  - **las fechas esperadas se calculan con el `hoy` de la base y con las funciones de la 1.3, nunca con el reloj de la máquina.** Si una prueba depende del día de la semana, se resuelve con `rutina_corresponde(…, hoy)`, sin suponer que hoy es día hábil.

| N.º | Qué se prueba |
| :-: | :--- |
| RT-01 | Alta válida, diaria y semanal. Las validaciones dan 422: descripción vacía, de más de 200 caracteres, frecuencia inválida, `incluye_sabado` en una semanal, `incluye_sabado: "true"` y una máquina inactiva. |
| RT-02 | Una descripción repetida entre las activas da 409. Con la otra dada de baja, se puede. Reactivar con una repetida da 409. |
| RT-03 | Los permisos. Sin `PLANES_GESTIONAR`, 403. Una máquina fuera del alcance da la respuesta de siempre para los planes. |
| RT-04 | `PATCH`. Cambiar la frecuencia da 422. La baja pone `baja_en` en hoy. Reactivar pone `vigente_desde` en hoy y `baja_en` en `NULL`. |
| RT-05 | `/hoy`. Un operario con `SECTORES` ve solo sus sectores; sin sectores, lista vacía y `sin_sectores: true`. El responsable, con `TODAS`, ve todo. No aparecen las rutinas de máquinas inactivas ni las dadas de baja. Las diarias aparecen solo si `rutina_corresponde(…, hoy)`. |
| RT-06 | Marcar. 201 la primera vez, 409 la segunda, también con otro usuario. Una semanal con registro en el lunes de esta semana aparece hecha. |
| RT-07 | Marcar una rutina que no corresponde (dada de baja, o una diaria si hoy no toca) da 422. Fuera del alcance, 404. |
| RT-08 | Deshacer. Lo propio funciona; lo de otro, 403; sin marca, 404. Un registro de un período pasado no se puede deshacer. |
| RT-09 | Concurrencia. Dos `POST /hecha` a la vez: uno da 201 y el otro 409, nunca 500. |
| RT-10 | Reporte de una diaria con `vigente_desde` en hoy − 14 y registros en algunos días. Los períodos esperados coinciden con `rutina_corresponde`. Están bien hechas, no hechas, la pendiente de hoy (si corresponde) y el porcentaje. Antes de `vigente_desde` no se espera nada. |
| RT-11 | Reporte de una semanal: la semana de alta cuenta. Una rutina dada de baja no tiene períodos después de `baja_en`. |
| RT-12 | Validaciones del reporte: más de 92 días, `desde > hasta` e ids inválidos dan 422. Respeta el alcance de `REPORTES_CONSULTAR`. Sin el permiso, 403. |
| RT-13 | Tipos en la respuesta: las fechas van como `YYYY-MM-DD`, los ids como número y los booleanos como booleanos reales. La nota de más de 500 caracteres da 422; la nota en blanco queda en `null`. |

### 6.3 El front

Las FE de las secciones 4 y 5, desde la FE-168.

---

## 7. Cierre e informe

**Criterios de cierre:**
1. Las secciones 1 a 6 están hechas, en tres commits que compilan solos.
2. Las pruebas de la regla 3 están en verde, en Neon.
3. Se hizo push en `feat/base-neon`.

**El informe.** Las salidas van pegadas tal cual:
1. Los tres hashes.
2. La salida final de cada suite.
3. El typecheck y el build.
4. Las pruebas existentes que se tocaron, con una línea por cada una.
5. La validación del lunes en las semanales: si fue con trigger o en la API.
6. La búsqueda de colores escritos a mano en los archivos tocados.
7. Los desvíos y las dudas.

**El recorrido en pantalla lo hace el revisor:**
- el operario en el celular, a 390 px, con modo simple: marcar, marcar con nota y deshacer;
- la ficha de la máquina;
- la pestaña Rutinas, a 1440 px;
- todo en claro y en oscuro.
