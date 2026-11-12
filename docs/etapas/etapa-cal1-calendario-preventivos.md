# Etapa CAL1 — Calendario de preventivos

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `8d59d4a` (Etapa A2).
> **Origen:** el plan de cierre de la tesis. Andrés pidió ver los preventivos en un calendario, por mes y por semana.

**Qué entra:**
- una consulta nueva en la API, de solo lectura;
- una pestaña nueva, "Calendario", en Preventivos.

**Qué no entra:**
- la base: no hay migración;
- generar intervenciones desde el calendario: eso se sigue haciendo desde el plan;
- el día fijo de la semana: sigue pendiente de decisión;
- el celular: Preventivos ya no se usa en el celular (D-027), y eso no cambia.

---

## 0. Reglas de trabajo

1. **Leé `CLAUDE.md` entero y seguí sus reglas.**
   - **Nunca abras, leas, muestres ni modifiques `.env`.**
   - Rama `feat/base-neon`. **No se agregan dependencias.**
2. **Dos commits,** y cada uno pasa `npm run typecheck` solo:

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1, 2 y 5 | `feat(api): calendario de preventivos` |
   | 2 | 3 y 4 | `feat(front): calendario de preventivos` |

3. **Pruebas:**
   - `npm run test:calendario` (nueva) y `npm run test:preventivos`, en Neon;
   - `npm run test:front`, `npm run typecheck` y `npm run build:frontend`;
   - **no correr `test:todo`.**
4. **Pruebas existentes:** no se autoriza cambiar ninguna. Si una falla, frenar y avisar.
5. **Ante cualquier duda, frenar y preguntar.** No inventar reglas que la etapa no dice.
6. **Ninguna pantalla ni componente nuevo pasa de 500 líneas.** `lib/preventivos.ts` ya tiene 944, así que la lógica nueva va en un archivo aparte, `lib/calendario.ts`.

Guardar este archivo como `docs/etapas/etapa-cal1-calendario-preventivos.md`.

---

## 1. Qué muestra el calendario

Estas reglas van en la decisión **D-028** (sección 5). Hay tres clases de evento:

| Evento | Qué es | Dónde va |
| :--- | :--- | :--- |
| **Hecha** | Una tarea marcada hecha en una intervención `FINALIZADA` y no eliminada. | La fecha local de finalización, la misma que usa la vista para `ultima_ejecucion`. |
| **Pendiente** | La próxima vez que toca la tarea: `proxima_fecha` de `v_plan_tareas_estado`, con el `estado` de la vista: `VENCIDA`, `PROXIMA`, `AL_DIA`, `EN_CURSO` o `SIN_LECTURA`. Una por tarea. | `proxima_fecha`, salvo un caso (abajo). |
| **Prevista** | Las veces siguientes, si se hiciera cada una justo en su fecha. Es una proyección. | Ver "Cómo se proyecta". |

**Qué tareas entran:**
- **Pendiente y prevista:** solo tareas activas, de planes activos y de máquinas activas, como en `/vencimientos`. Las tareas que vencen solo por uso no tienen fecha y no entran: van a la lista "Vencen por uso" (2.3).
- **Hecha:** entran aunque hoy la tarea, el plan o la máquina estén inactivos, porque es historia.
- **Siempre,** con el alcance de sectores del usuario y los filtros de planta, sector y máquina.

**El caso de la venció por uso:** una tarea por fecha y por uso puede estar `VENCIDA` por uso mientras su fecha todavía no llegó. En ese caso, la pendiente va en **hoy**, no en `proxima_fecha`, y lleva `vencida_por_uso: true`. No puede haber un evento vencido en un día futuro.

**Cómo se proyecta:**
- **La base** es la fecha de la pendiente; si ya pasó, **hoy**, porque una vencida que se haga hoy vuelve a tocar desde hoy.
- **Cada prevista** es la anterior más la frecuencia, **una por vez**, con la misma suma de fechas de Postgres que usa la vista. La primera prevista es la base más la frecuencia.
  - Ejemplo, mensual desde el 31/01/2027: 28/02 y después 28/03, no 31/03. Es lo que pasaría de verdad si se hace cada una en su fecha.
- **Se proyecta hasta `hasta`,** y solo se devuelven las que caen en el rango.
- **Una tarea por fecha y por uso** se proyecta solo por fecha. Su evento lleva `tambien_por_uso: true`, para que la pantalla avise que puede tocar antes.

---

## 2. La API (primer commit)

### 2.1 La ruta

`GET /api/planes/calendario`, en `planesApp`, **antes de `/:id`**. Pide `PLANES_GESTIONAR`, como todo `planesApp`.

**Parámetros:**

| Parámetro | Regla |
| :--- | :--- |
| `desde` y `hasta` | Obligatorios, `YYYY-MM-DD`, fechas válidas. `desde` ≤ `hasta`, y como mucho 62 días entre las dos, contando ambas. |
| `planta_id`, `sector_id` y `maquina_id` | Opcionales, como en `/vencimientos`: usar `filtrosMaquina`. |

Cualquier otro error de parámetros: 422 `DATOS_INVALIDOS`, con un mensaje que diga cuál.

### 2.2 La respuesta

```json
{
  "hoy": "2026-11-11",
  "desde": "2026-10-26",
  "hasta": "2026-12-06",
  "vencidas": 3,
  "eventos": [
    {
      "fecha": "2026-11-12",
      "tipo": "PENDIENTE",
      "estado": "PROXIMA",
      "vencida_por_uso": false,
      "tambien_por_uso": false,
      "tarea_id": 41,
      "accion": "Cambiar filtros",
      "plan": { "id": 7, "nombre": "Mensual de pintura" },
      "maquina": { "id": 3, "codigo": "PIN-01", "nombre": "Cámara de pintura", "criticidad": { "nombre": "Alta", "prioridad_alta": true } },
      "sector": { "id": 2, "nombre": "Pintura" },
      "responsable": { "...": "como en /vencimientos" },
      "intervencion": null
    }
  ],
  "por_uso": [
    {
      "tarea_id": 52,
      "accion": "Cambiar aceite",
      "estado": "PROXIMA",
      "uso": { "...": "como en /vencimientos (usoDeTarea)" },
      "plan": { "id": 9, "nombre": "Compresor" },
      "maquina": { "...": "igual que en eventos" },
      "intervencion": null
    }
  ]
}
```

**Los campos de `eventos`:**
- **`estado`:** solo en las pendientes. En hechas y previstas va `null`.
- **`vencida_por_uso` y `tambien_por_uso`:** booleanos, siempre presentes.
- **`intervencion`:** `{ id, estado }`.
  - En una hecha: la intervención que la finalizó.
  - En una pendiente `EN_CURSO`: la intervención en curso.
  - En los demás casos: `null`.

**Orden de `eventos`:**
1. `fecha`;
2. el tipo: hecha, pendiente y después prevista;
3. entre pendientes, el estado, con el mismo orden que `/vencimientos`;
4. `prioridad_alta` primero;
5. el código de la máquina, el plan y el `orden` de la tarea.

**`vencidas`:** cuántas tareas están `VENCIDA`, con los filtros pero **sin mirar el rango**. Así la pantalla puede avisar aunque se esté mirando el mes que viene.

**`por_uso`:** las tareas activas sin `primera_fecha` y con medidor, con los filtros, sin mirar el rango. Orden: el estado, como en `/vencimientos`, y después `faltan_uso`, de menor a mayor.

**Dónde va el código:**
- en `backend/functions/preventivos/calendario.ts`, una función `calendarioPreventivos(db, filtros, desde, hasta)`;
- reusa `condicionesMaquina`, `usoDeTarea`, `persona` y `COLUMNAS_USO`; si hace falta, exportarlos;
- **la proyección se hace en SQL** (un `generate_series` o un CTE recursivo), para que la suma de fechas sea exactamente la de Postgres. Si se hace en TypeScript, tiene que dar lo mismo que Postgres en fin de mes y en años bisiestos, con prueba;
- **ningún pedido a la base por tarea:** todo en pocas consultas, sin importar cuántas tareas haya.

### 2.3 Pruebas

En `backend/tests/calendario.test.ts`, con el script `test:calendario` en `package.json`. Si `test:todo` arma su lista a mano, sumarla; si la toma de `package.json`, no hace falta.

Las fechas de las pruebas se arman **a partir de `hoy_instalacion()`**, nunca fijas, salvo en CA-04.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| CA-01 | Parámetros: falta `desde`, fecha mal escrita o imposible (`2026-02-30`), `desde` > `hasta`, 63 días | 422 `DATOS_INVALIDOS` en cada uno. Con 62 días, 200. |
| CA-02 | Sin `PLANES_GESTIONAR`; y con alcance de un solo sector | 403. Con alcance, solo eventos y `por_uso` de su sector, y `vencidas` cuenta solo los suyos. |
| CA-03 | Tarea cada 1 mes, primera en hoy + 5 días; rango de hoy a hoy + 62 | Una pendiente en hoy + 5, con el estado de la vista, y previstas un mes y dos meses después, si caen en el rango. |
| CA-04 | Fin de mes: tarea mensual con `primera_fecha` 2027-01-31; rango del 2027-01-25 al 2027-03-28 | Pendiente el 31/01; previstas el 28/02 y el 28/03. |
| CA-05 | Tarea vencida: `primera_fecha` hoy − 10, cada 7 días | Pendiente `VENCIDA` en hoy − 10; previstas en hoy + 7 y hoy + 14 (desde hoy, no desde hoy − 10). `vencidas` la cuenta aunque el rango sea solo del mes que viene. |
| CA-06 | Hechas | Una intervención finalizada con la tarea hecha da una hecha en la fecha local de finalización, con su `intervencion`. Una eliminada, una no finalizada o una tarea no marcada no dan hecha. Si después se inactiva la tarea, la hecha sigue y la pendiente y las previstas no. |
| CA-07 | En curso | La pendiente tiene `EN_CURSO` y la intervención en curso. |
| CA-08 | Por uso | Una tarea solo por uso no está en `eventos` y sí en `por_uso`. Una por fecha y por uso está en `eventos` con `tambien_por_uso: true`, y no en `por_uso`. |
| CA-09 | Venció por uso con la fecha en el futuro | La pendiente va en hoy, `VENCIDA`, con `vencida_por_uso: true`. Las previstas se proyectan desde hoy. |
| CA-10 | Inactivas | Tarea, plan o máquina inactivos: sin pendiente ni prevista. |
| CA-11 | Filtros | Con `maquina_id`, `sector_id` y `planta_id`, solo lo que corresponde, en `eventos`, `por_uso` y `vencidas`. |
| CA-12 | Una tarea diaria, en un rango de 62 días | A lo sumo 62 eventos de esa tarea, uno por día, en orden. |
| CA-13 | Orden | Dos eventos el mismo día, de máquinas con y sin `prioridad_alta`: primero la de prioridad alta. Hecha antes que pendiente y pendiente antes que prevista. |

Las pruebas siguen el patrón de C2 (`clienteSano`) y limpian lo que crean.

---

## 3. La pantalla (segundo commit)

### 3.1 Dónde va

**Una tercera pestaña en Preventivos,** después de "Planes": "Calendario", con `vista=calendario` en la URL.
- **Arriba,** los mismos filtros de planta, sector y máquina que las otras pestañas (`FiltrosMaquinaPreventivos`).
- **Al cambiar de pestaña,** los filtros se conservan, como hoy.

**La barra del calendario:**
- botones ‹ y › para el período anterior y el siguiente;
- un botón "Hoy";
- el título del período: "Noviembre 2026", o en la semana, "9 al 15 de noviembre de 2026";
- un `SegmentedControl` "Mes" / "Semana"; por omisión, "Mes".

**En la URL:** `cal=mes|semana` y `fecha=YYYY-MM-DD`, un día cualquiera del período. Sin `fecha`, hoy. Así se puede volver con el botón Atrás y compartir el enlace.

**Si `vencidas` > 0:** antes del calendario va un aviso rojo, "Hay 3 tareas vencidas", con un botón "Ver vencidas" que lleva a la pestaña Vencimientos, filtrada por `VENCIDA`.

### 3.2 La vista de mes

- **La grilla:**
  - semanas de lunes a domingo, con los títulos "Lun" a "Dom";
  - desde el lunes de la semana del día 1 hasta el domingo de la semana del último día: 4, 5 o 6 filas, según el mes;
  - el pedido a la API es ese rango entero, que nunca pasa de 42 días.
- **Los días de otro mes** van atenuados, pero con sus eventos. **Hoy** va resaltado.
- **En cada día, hasta 3 eventos,** una línea cada uno: "PIN-01 · Cambiar filtros", cortada con puntos suspensivos si no entra. Si hay más, "+2 más".
- **El color de cada evento:**
  - **pendiente:** el de su estado en `lib/estados.ts` (entidad `tarea_preventiva`). `AL_DIA` ya es verde;
  - **hecha:** `teal`, con un ✓, para que no se confunda con "Al día";
  - **prevista:** gris, con borde punteado o texto más claro, para que se note que es una proyección.
- **Al tocar un día** (la celda, un evento o "+N más") se abre el panel del día (3.4).

### 3.3 La vista de semana

- **Siete columnas,** de lunes a domingo, con el día y la fecha arriba.
- **Cada columna muestra todos sus eventos,** sin "+N más", como tarjetitas:
  - el código y el nombre de la máquina;
  - la acción;
  - el estado o "Hecha" o "Prevista";
  - el plan, en chico.
- **Tocar una tarjeta** abre el panel del día.

### 3.4 El panel del día

Un `Drawer` a la derecha, con el título "Jueves 12 de noviembre". Lista todos los eventos del día, en el orden de la API. Cada uno con:
- la máquina, la acción, el plan, el sector y el responsable;
- el estado, con su `Badge`, o "Hecha" o "Prevista";
- **si `vencida_por_uso`:** "Venció por uso";
- **si `tambien_por_uso`:** "También vence por uso: puede tocar antes";
- **botones:**
  - "Ver plan", a `/preventivos/planes/:id`;
  - si tiene `intervencion`, "Ver intervención", a `/intervenciones/:id`.

### 3.5 Vencen por uso

**Debajo del calendario,** una sección "Vencen por uso", con las tareas de `por_uso`:
- la máquina, la acción, el estado con su `Badge` y el texto del próximo uso (`textoProximoUso`), y "Ver plan";
- si la lista está vacía, no se muestra;
- si tiene más de 5, se ven 5 y un botón "Ver todas (N)".

### 3.6 Lo demás

- **Leyenda:** debajo de la barra, una línea chica con los colores: Vencida, Próxima, Al día, En curso, Hecha y Prevista.
- **Mientras carga:** un esqueleto con la forma de la grilla.
- **Si falla:** el mensaje de error de siempre, con "Reintentar".
- **Sin eventos en el período:** la grilla igual, con el texto "No hay preventivos en este período" arriba.
- **A 1280 px** la grilla del mes entra sin barra horizontal. En la vista de semana, si las columnas no entran, la barra horizontal va solo en el calendario, no en la página.

### 3.7 La lógica, en `lib/calendario.ts`

Con pruebas FE desde **FE-135**:

| Función | Qué hace | Casos mínimos |
| :--- | :--- | :--- |
| `rangoCalendario(vista, fecha)` | `{ desde, hasta }` del período. | Noviembre 2026 (empieza domingo): 26/10 al 06/12. Febrero 2027 (5 filas) y un mes que empieza lunes. La semana de un domingo: del lunes anterior a ese domingo. |
| `moverPeriodo(vista, fecha, ±1)` | La fecha del período anterior o siguiente. | Del 31/01 al mes siguiente queda en febrero, no en marzo. Cruce de año en la semana. |
| `semanasDelMes(fecha)` | Las filas de la grilla, con cada día y si es del mes. | 4, 5 y 6 filas. |
| `eventosPorDia(eventos)` | Un mapa de `YYYY-MM-DD` a sus eventos, sin cambiar el orden. | Vacío; varios el mismo día. |
| `visiblesEnCelda(eventos, 3)` | `{ visibles, mas }`. | 0, 3 y 5 eventos. |
| `textoTituloPeriodo(vista, fecha)` | "Noviembre 2026" o "9 al 15 de noviembre de 2026". | Una semana entre dos meses: "30 de noviembre al 6 de diciembre de 2026". Entre dos años: con los dos años. |
| `leerParamsCalendario` y `escribirParamsCalendario` | `cal` y `fecha` de la URL. | Sin parámetros, mes y hoy; `fecha` inválida, hoy; `cal` inválido, mes. |

**Las fechas se manejan como texto `YYYY-MM-DD`,** o con `dayjs`, que ya está, pero **sin pasar por UTC**: un día no puede correrse por la zona horaria.

---

## 4. Tipos y API del front (segundo commit)

- **En `frontend/src/api/tipos.ts`:** los tipos de la respuesta (`CalendarioPreventivos`, `EventoCalendario` y `TareaPorUso`).
- **En el módulo de API de planes:** la función que llama a la ruta.
- **La consulta de TanStack Query** usa la clave `['planes', 'calendario', rango, filtros]`. Así la invalidan los mismos lugares que ya invalidan `['planes']`: al editar un plan, en las acciones de una intervención y al eliminar.
- **Si algún lugar invalida `['vencimientos']` y no `['planes']`,** por ejemplo al generar o al cambiar una tarea, sumarle `['planes']`. En el informe va la lista de lo que se tocó.

---

## 5. Decisión y documentos (primer commit)

**En `docs/decisiones.md`:**

> **D-028 — Calendario de preventivos**
>
> **Estado:** Aceptada
>
> 1. **El calendario es una consulta, no guarda nada.** Muestra lo que sale de `v_plan_tareas_estado` y del historial, como D-021 y D-023.
> 2. **Tres clases de evento:**
>    - **hecha:** en la fecha en que se finalizó;
>    - **pendiente:** la próxima de cada tarea, con su estado;
>    - **prevista:** las siguientes, si se hiciera cada una en su fecha.
> 3. **Una vencida se proyecta desde hoy,** porque lo antes que puede hacerse es hoy. Una tarea que venció por uso antes de su fecha va en hoy.
> 4. **Las tareas que vencen solo por uso no tienen fecha.** No se inventa una con el ritmo de uso, porque cambia con la producción. Van en una lista aparte.
> 5. **Las tareas por fecha y por uso** se ven por su fecha, con el aviso de que pueden tocar antes.
>
> **Motivo:** el responsable de mantenimiento planifica por semana y por mes. La lista de vencimientos dice qué urge, pero no cómo se reparte el trabajo. La proyección permite ver semanas cargadas antes de que lleguen.

**En los demás documentos:**
- **`docs/alcance.md`:** "Calendario de preventivos" pasa a hecho, con la etapa CAL1.
- **`docs/plan-trabajo.md`:** el paso del calendario, hecho.

---

## 6. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 5 están hechas, en dos commits que compilan solos.
2. Las pruebas de la regla 3 en verde; `test:calendario` y `test:preventivos` en Neon.
3. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. Los dos hashes.
2. La salida final de `test:calendario`, `test:preventivos` y `test:front`, con las FE nuevas.
3. Typecheck y build.
4. Cuántas líneas tienen los archivos nuevos del front.
5. Desvíos y dudas.

**El recorrido en pantalla lo hace el revisor.**
