# Etapa R1 — Cumplimiento de los preventivos en los reportes

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `6e3aa80` (hooks y permisos de Claude Code).
> **Origen:** pendiente anotado desde la PV1: medir si los preventivos se hacen a tiempo.

**Qué entra:**
- un reporte nuevo, `GET /api/reportes/preventivos`;
- una pestaña "Preventivos" en Reportes, con tarjetas, una tabla agrupada y la descarga en CSV.

**Qué no entra:**
- gráficos de evolución en el tiempo;
- el tablero;
- ningún cambio de la base de datos: no hay migración.

---

## 0. Reglas de trabajo

1. **Leé `CLAUDE.md` entero antes de empezar, y seguí sus reglas.**
   - **Nunca abras, leas, muestres ni modifiques `.env`.** Los hooks de `.claude/` lo bloquean en Claude Code, pero no en otras herramientas: la regla igual vale.
   - Las pruebas corren contra la rama de pruebas de Neon que ya usa `.env`.
2. Rama `feat/base-neon`. **No se agregan dependencias.**
3. **Dos commits,** y cada uno pasa `npm run typecheck` solo:

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1, 2 y 4.1 | `feat(api): reporte de cumplimiento de preventivos` |
   | 2 | 3 y 4.2 | `feat(front): pestaña de preventivos en reportes` |

4. **Pruebas durante la etapa:** solo `npm run test:reportes-preventivos` (nueva), `npm run test:reportes` y `npm run test:front`.
5. **No correr `test:todo`.** Va en la corrida de la noche, con el servidor de desarrollo cerrado.
6. **No se cambia ninguna prueba existente.** Si alguna falla, frenar y avisar.
7. **Ante cualquier duda, frenar y preguntar.** No inventar reglas que la etapa no dice.

Guardar este archivo como `docs/etapas/etapa-r1-cumplimiento-preventivos.md`.

---

## 1. Decisión (primer commit)

Agregar a `docs/decisiones.md`:

> **D-026 — Cumplimiento de los preventivos**
>
> **Estado:** Aceptada
>
> 1. **Se mide por tarea, no por intervención.** Una intervención preventiva puede llevar varias tareas, y cada una tiene su propio vencimiento.
> 2. **Una tarea hecha** es una fila de `intervencion_tareas` con `hecha = true`, de una intervención `FINALIZADA` no eliminada, cuya fecha de finalización cae en el período. **Se hizo a tiempo si cumple todo lo que corresponde:**
>    - **con fecha programada:** la fecha local de finalización es igual o anterior a `fecha_programada`;
>    - **con uso programado:** `valor_medidor` es igual o menor que `uso_programado`.
>
>    Con los dos, tienen que cumplirse los dos: lo que llegue primero.
> 3. **Una tarea vencida sin hacer** es una tarea del plan que hoy está `VENCIDA`, con su próxima fecha dentro del período. Las que vencen solo por uso no se cuentan acá, porque no tienen una fecha para ubicarlas en el período.
> 4. **El cumplimiento** es `a tiempo / (hechas + vencidas sin hacer)`, en porcentaje con un decimal. Sin nada que medir, no hay número: se muestra "—".
> 5. **El atraso promedio** es el promedio de días entre `fecha_programada` y la fecha local de finalización, solo en las tareas hechas tarde que tienen fecha programada.
>
> **Motivo:** una medida simple, que se explica en una oración y se controla a mano con los datos de una intervención.

---

## 2. La API (primer commit)

### 2.1 La ruta

`GET /api/reportes/preventivos`, en `reportesApp` (`backend/functions/reportes.ts`). La lógica va en un archivo nuevo, `backend/functions/reportes/cumplimiento.ts`, para no agrandar `reportes.ts`, que ya tiene 898 líneas.

**Permiso y alcance:** `REPORTES_CONSULTAR`, con el mismo manejo que `/tiempos`:
- `getUserScope`;
- sin sectores y sin alcance `TODAS`: resultado vacío;
- un `sector_id` fuera de su alcance: resultado vacío.

**Parámetros:**

| Parámetro | Regla |
| :--- | :--- |
| `desde`, `hasta` | Con `validarIntervaloReporte`, igual que en `/tiempos`. |
| `planta_id`, `sector_id` | Opcionales. Con `parseId`; uno inválido da 422 `DATOS_INVALIDOS`, como en `/tiempos`. |
| `agrupar` | Obligatorio: `sector`, `maquina` o `plan`. Otro valor da 422 `DATOS_INVALIDOS`, "El parámetro agrupar es obligatorio y debe ser: sector, maquina o plan". |

### 2.2 El cálculo

**La fecha local de finalización** es `(i.fecha_finalizacion AT TIME ZONE <zona>)::date`. La zona es `configuracion_sistema.zona_horaria`, y si es nula, `'America/Argentina/Buenos_Aires'`, igual que en la vista `v_plan_tareas_estado` (`018`).

**Las hechas** salen de:
- `intervencion_tareas it`, con `it.hecha`;
- `JOIN intervenciones i`, con `i.estado = 'FINALIZADA'`, `i.eliminado_en IS NULL` y `i.fecha_finalizacion` entre `desde` y `hasta`;
- `JOIN plan_tareas t ON t.id = it.plan_tarea_id`, `JOIN planes_mantenimiento p ON p.id = t.plan_id`;
- `JOIN maquinas m ON m.id = p.maquina_id`, `JOIN sectores s ON s.id = m.sector_id`;
- con los filtros de planta, sector y alcance sobre `m` y `s`.

**A tiempo**, por fila:

```sql
(it.fecha_programada IS NULL OR fecha_local <= it.fecha_programada)
AND (it.uso_programado IS NULL OR it.valor_medidor <= it.uso_programado)
```

Si `it.uso_programado` no es nulo y `it.valor_medidor` es nulo, cuenta como **tarde**.

**Las vencidas sin hacer** salen de `v_plan_tareas_estado v`:
- `v.estado = 'VENCIDA'`;
- `v.proxima_fecha` entre la fecha local de `desde` y la de `hasta`;
- `JOIN planes_mantenimiento p ON p.id = v.plan_id`, con la máquina y el sector, y los mismos filtros.

**El atraso,** solo en las hechas tarde con `fecha_programada` y con `fecha_local > it.fecha_programada`: `fecha_local - it.fecha_programada`, en días.

### 2.3 La respuesta

```json
{
  "resumen": {
    "hechas": 40,
    "a_tiempo": 34,
    "tarde": 6,
    "vencidas_sin_hacer": 2,
    "cumplimiento": 81.0,
    "atraso_promedio_dias": 3.5
  },
  "grupos": [
    {
      "sector": { "id": 3, "nombre": "Pintura" },
      "hechas": 12,
      "a_tiempo": 11,
      "tarde": 1,
      "vencidas_sin_hacer": 0,
      "cumplimiento": 91.7,
      "atraso_promedio_dias": 2.0
    }
  ]
}
```

**El grupo:**
- con `agrupar=maquina`, en lugar de `sector` lleva `"maquina": { "id", "codigo", "nombre" }`;
- con `agrupar=plan`, lleva `"plan": { "id", "nombre" }` y `"maquina": { "id", "codigo", "nombre" }`.

**Los números:**
- `cumplimiento`: `a_tiempo * 100 / (hechas + vencidas_sin_hacer)`, redondeado a un decimal. Si el divisor es 0, `null`;
- `atraso_promedio_dias`: con un decimal, o `null` si no hay atrasos con fecha.

**Los grupos:**
- **orden:** primero el de menor cumplimiento, y los `null` al final. A igual cumplimiento, por nombre o código;
- **sin nada:** `{ "resumen": { ... con ceros y null ... }, "grupos": [] }`.

### 2.4 Tipos y contrato

- **En `frontend/src/api/tipos.ts`:** los tipos de la respuesta.
- **En `frontend/src/api/contrato-reportes.ts`,** si existe; si no, en uno nuevo con ese nombre: un ejemplo por cada `agrupar`.

---

## 3. El front (segundo commit)

En `frontend/src/pantallas/Reportes.tsx`, una pestaña nueva, **"Preventivos"**, después de "Repuestos". Usa los mismos filtros (`FiltrosReportes`): período, planta y sector.

**Un componente nuevo, `frontend/src/componentes/reportes/TabPreventivos.tsx`:**

- **Cinco tarjetas arriba,** como `TarjetasResumen` de preventivos: "Cumplimiento", "A tiempo", "Tarde", "Vencidas sin hacer" y "Atraso promedio".
  - **"Cumplimiento":** el porcentaje con coma, como "81,0 %". En verde desde 90, en amarillo desde 70 y en rojo debajo de 70. Sin número: "—".
  - **"Atraso promedio":** "3,5 días", o "—".
- **Un `SegmentedControl`** "Sector / Máquina / Plan", que cambia `agrupar`. Se recuerda en la dirección, como en Tiempos.
- **Una tabla:** Grupo, Hechas, A tiempo, Tarde, Vencidas sin hacer, Cumplimiento y Atraso.
  - El grupo: el sector; o "PIN-01 · Cámara de pintura"; o "Plan mensual (PIN-01)".
  - En la columna Cumplimiento, el número y una `Progress` chica con el mismo color.
- **"Descargar CSV",** como en Tiempos, con `aCsv`, `descargarCsv` y `nombreArchivoReporte('preventivos', …)`.
- **Una línea de ayuda debajo de las tarjetas:** "Una tarea está a tiempo si se hizo hasta su fecha programada y sin pasar el uso programado. Las vencidas sin hacer son las que vencieron en el período y siguen pendientes."
- **Sin datos:** "No hay tareas preventivas para medir en este período."

**La lógica va en `frontend/src/lib/reportes.ts`,** con pruebas FE desde FE-126:
- `textoCumplimiento(valor)`: "81,0 %" o "—";
- `colorCumplimiento(valor)`: `'green'`, `'yellow'`, `'red'` o `'gray'` si es `null`;
- `nombreGrupoPreventivos(grupo, agrupar)`;
- las filas del CSV.

En celular (390 px), las tarjetas van de a dos y la tabla se desplaza dentro de su caja, como en las otras pestañas. Nada se sale de la pantalla.

---

## 4. Pruebas

### 4.1 `backend/tests/reportes_preventivos.test.ts`, con el script `test:reportes-preventivos` (primer commit)

- **Sigue `CLAUDE.md`:** `let client`, y `client = await clienteSano(client)` como primera línea del `finally` de afuera.
- **Crea sus propios datos:** planta, sectores, máquinas, planes, tareas, intervenciones y medidores, con un prefijo único. Los borra al final.
- **Para fijar fechas,** escribe directo en la base: `fecha_finalizacion`, `fecha_programada`, `uso_programado` y `valor_medidor`.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| RPV-01 | Permisos y parámetros | • Sin `REPORTES_CONSULTAR`: 403.<br>• Sin `agrupar`, o con `agrupar=tipo`: 422.<br>• Con `sector_id=abc`: 422. |
| RPV-02 | A tiempo y tarde por fecha | • Hecha el mismo día programado: a tiempo.<br>• Un día después: tarde, con atraso 1.<br>• Finalizada a las 23:30 locales del día programado, que en UTC ya es el día siguiente: **a tiempo**. |
| RPV-03 | Por uso, y por las dos | • `valor_medidor` 250 con `uso_programado` 250: a tiempo. A 260: tarde.<br>• Con las dos: a tiempo en fecha pero pasada en uso, tarde.<br>• Con `uso_programado` y sin `valor_medidor`: tarde. |
| RPV-04 | Lo que no cuenta | • Una tarea sin hacer.<br>• Una intervención cancelada o eliminada.<br>• Una finalizada fuera del período.<br>• Una correctiva: no tiene tareas de plan. |
| RPV-05 | Vencidas sin hacer | • Una tarea `VENCIDA` con su próxima fecha en el período: cuenta.<br>• Una con fecha fuera del período: no cuenta.<br>• Una vencida solo por uso: no cuenta. |
| RPV-06 | Cumplimiento y atraso | Con 3 a tiempo, 1 tarde (2 días) y 1 vencida sin hacer: `cumplimiento` 60.0 y `atraso_promedio_dias` 2.0. Sin nada: `cumplimiento` y atraso en `null`, y `grupos` vacío. |
| RPV-07 | Agrupar y ordenar | Por `sector`, `maquina` y `plan`, con dos grupos: la forma de la 2.3 y el de menor cumplimiento primero. |
| RPV-08 | Alcance | Un usuario con alcance `SECTORES`: solo ve sus sectores. Con un `sector_id` de otro sector: resultado vacío. |
| RPV-09 | Contrato | `mismaForma` sin diferencias entre cada respuesta real y su ejemplo de la 2.4. |

- **Sumar el script `test:reportes-preventivos` en `package.json`.**
- **`scripts/run-all-tests.mjs` encuentra el archivo solo:** no hay que tocarlo.

### 4.2 Front (segundo commit)

Las FE de la sección 3, desde FE-126.

---

## 5. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 4 están hechas, en dos commits que compilan solos.
2. Las suites de la regla 4 en verde, en Neon.
3. `npm run typecheck` y `npm run build:frontend` sin errores.
4. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. Los dos hashes.
2. La consulta SQL del cálculo, como quedó.
3. La salida final de cada suite de la regla 4.
4. Typecheck y build.
5. Desvíos y dudas.

**El recorrido en pantalla lo hace el revisor.**
