# Etapa C1.2.1 — Correcciones

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `49a5c53` (Etapa C1.2).
> **Origen:** revisión de la C1.2 con el sistema levantado en mi base local.
>
> - `test:costos` 23 de 23 y `test:front` 210 de 210. La huella de la base, sin cambios ajenos.
> - El lote, con 29 cuerpos raros, 9 ids de ruta, todo o nada con `TOTAL_FUERA_DE_RANGO`, y concurrencia en 10 vueltas por caso: dos lotes con ajustes, un lote y una anulación, cuatro lotes a la vez. Todo bien, salvo lo de la sección 1.
> - Recorrido con Playwright, en escritorio y en celular: las pestañas, las marcas, "Vaciar pestaña", el salto a la pestaña con errores, la confirmación, `TOTAL_NEGATIVO`, un proveedor desactivado antes de guardar, y la intervención finalizada.

**Lo que funciona y no se toca:** el lote y su `indice`, el `POST` de uno, el diálogo con sus pestañas y su guardado, y el motivo de la corrección.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Dos commits:**

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1 | `fix(api): ids fuera de rango sin error interno` |
   | 2 | 2 y 3 | `fix(front): marcas y confirmación del diálogo de costos` |

3. **Pruebas:**
   - solo `test:ids` (nueva), `test:costos` y `test:front`;
   - **no correr `test:todo`:** va en la corrida de la noche;
   - las pruebas existentes no se modifican.
4. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-c1-2-1-correcciones.md`.

---

## 1. Un id fuera de rango da 500

Viene de antes de la C1.2. Un id de 20 dígitos da **500 `ERROR_INTERNO`**:

- **En la ruta:** `GET /api/maquinas/:id`, `/api/intervenciones/:id`, `…/:id/costos`, `…/:id/repuestos`, `/api/usuarios/:id`, `/api/repuestos/:id` y `/api/sectores/:id`, y `POST …/:id/costos` y `…/:id/costos/lote`.
- **En la consulta:** `?maquina_id=` del listado de intervenciones.
- **En el cuerpo, con 1e20:** `usuario_id` y `proveedor_id` de los costos, `repuesto_id` del consumo, `proveedor_id` de un repuesto y `maquina_id` al reportar una falla.

**Causa:** `parseId`, `parseIdRuta` y `validarIdCuerpo` aceptan cualquier entero. PostgreSQL rechaza el que no entra en `bigint`, y el error sale como 500.

**Corrección:**

1. **Las tres funciones aceptan solo enteros seguros:** `Number.isSafeInteger`, hasta 9.007.199.254.740.991.
2. **Fuera de rango es lo mismo que un id inválido:** cada endpoint responde lo mismo que hoy con 0.
3. **Buscar otros lugares** que conviertan un id por su cuenta, con `Number(…)` o `parseInt(…)`. Si hay, que usen estas funciones.

**Suite nueva `test:ids`** (`backend/tests/ids.test.ts`):

| ID | Qué prueba |
| :--- | :--- |
| ID-01 | **En la ruta:** las rutas de arriba, y al menos una con id de cada módulo montado en `api.ts`, con un id de 20 dígitos: la misma respuesta que con 0, nunca 500. |
| ID-02 | **En la consulta:** `maquina_id` del listado de intervenciones y `planta_id` del tablero: lo mismo que con 0. |
| ID-03 | **En el cuerpo, con 1e20:** `usuario_id` y `proveedor_id` de los costos, en el `POST` de uno y en el lote (con `indice`); `repuesto_id` del consumo; `proveedor_id` de un repuesto; `maquina_id` al reportar una falla. La misma respuesta que con 0, y no se guarda nada. |

---

## 2. Punto rojo sin ningún error a la vista

**Cómo se ve:**

1. Agregar con la pestaña Mano de obra vacía. Aparece, entre otros, "Ingresá un importe." en Importe.
2. Completar Persona y Horas, y escribir un Valor hora. El campo Importe se oculta, pero su error queda guardado.
3. **La pestaña sigue con el punto rojo,** y no se ve ningún error en ella.

**Corrección:**

- Cambiar Valor hora también borra el error de Importe.
- **La regla:** el punto rojo sale solo de errores que se ven en la pestaña.

---

## 3. Confirmación sin nada que descartar

**Cómo se ve:** con "Hay costos sin guardar. ¿Descartarlos?" a la vista, "Vaciar pestaña" deja el diálogo sin datos. La pregunta sigue.

**Corrección:**

- La confirmación se ve solo mientras haya datos sin guardar.
- Si los datos se van, vuelven Cancelar y Agregar.

---

## 4. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 3 están hechas, en dos commits.
2. `test:ids` y `test:costos` en verde, en Neon.
3. `npm run test:front`, `npm run typecheck` y `npm run build:frontend` sin errores.
4. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. Los dos hashes.
2. Los lugares de la sección 1.3 que encontraste, y qué hiciste con cada uno.
3. La salida final de `test:ids`, `test:costos` y `test:front`.
4. Typecheck y build.
5. `wc -l` de los archivos tocados.
6. **Qué probaste en pantalla de las secciones 2 y 3, y qué no.** Si no levantaste la app, decirlo.
7. Desvíos y dudas.
