# Etapa C3 — Detalles pendientes

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `8fa1d39` (Etapa PV5).
> **Origen:** tres cosas chicas que quedaron anotadas en las revisiones de la PV2.2 a la PV5.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Un commit:** `fix: detalles pendientes (motivo, revisión diaria, M18-04)`.
3. **Pruebas:**
   - `test:motivos` (nueva), `test:vencimientos`, `test:migration-018` y `test:front`;
   - **no correr `test:todo`.**
4. **Pruebas existentes: se autoriza cambiar solo:**
   - PA-02, por la 2;
   - M18-04, por la 3;
   - las que esperan que se acepte un motivo de más de 500 caracteres, si hubiera alguna.

   Si otra falla, frenar y avisar.
5. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-c3-detalles.md`.

---

## 1. El motivo: mismo límite en todos lados

**Qué pasa:** el motivo pide al menos 5 caracteres en todos lados, pero el máximo cambia:
- en los costos es 500;
- en los consumos, las tareas de una preventiva, las lecturas, la cancelación, la reapertura, la eliminación, las detenciones y los repuestos, no hay tope.

En la revisión de la PV3, la API aceptó un motivo de 20.000 caracteres al anular una lectura.

**La corrección:**
- **Una función compartida, `validarMotivo(valor)`,** en `backend/functions/validations.ts`. Tiene que ser un texto que, recortado, tenga entre 5 y 500 caracteres.
  - Si no es un texto, o tiene menos de 5: 422 `MOTIVO_REQUERIDO`, con el mensaje que ya tenga esa ruta.
  - Más de 500: 422 `DATOS_INVALIDOS`, "El motivo no puede superar los 500 caracteres".
  - Devuelve el texto recortado.
- **La usan todas las rutas que reciben un motivo.** Donde el motivo es opcional, como reasignar en `PENDIENTE`, se valida solo si viene.
- **No cambia ningún código de error que ya exista**, salvo el nuevo de los 500.
- **En el front,** todo campo de motivo lleva `maxLength={500}`.

**Pruebas,** en `backend/tests/motivos.test.ts`, con el script `test:motivos`:

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| MO-01 | Cada ruta con motivo, con 501 caracteres | 422 `DATOS_INVALIDOS`, y no cambia nada en la base. |
| MO-02 | La misma, con 500 caracteres | Se acepta, y se guarda entero. |
| MO-03 | `validarMotivo` sola | Los bordes: 4, 5, 500 y 501 caracteres, solo espacios, un número y `null`. |

**En el informe va la lista de rutas tocadas.**

---

## 2. La revisión diaria se marca al terminar

**Qué pasa:** `procesarVencimientos` marca el día como revisado antes de revisar los planes. Si el proceso se corta a mitad de camino, por ejemplo por un corte de Neon, los planes que faltaban no se revisan hasta el día siguiente, salvo que alguien apriete el botón.

**La corrección:**
- **La fecha se marca al final,** cuando terminó de recorrer todos los planes, aunque alguno haya dado error.
- **Al empezar, sin `forzar`:** si `vencimientos_revisados_el` ya es hoy, responde `{ revisado: false }` como ahora. Esa lectura ya no lleva el `UPDATE`.
- **Si dos programados arrancan a la vez,** los dos revisan. No pasa nada: los avisos no se repiten, por el índice único, y la intervención no se duplica, por los bloqueos de generar. Así lo dice la 3.4 de la PV5.

**PA-02 suma un caso:** con un error forzado que corta la revisión antes de terminar, la fecha no queda marcada, y el próximo programado vuelve a revisar.

---

## 3. M18-04 no depende de cuántos planes haya

**Qué pasa:** la `018` nombra en su error los 20 planes de menor id con el formato viejo, y M18-04 busca su plan en esa lista. Si en la rama de pruebas quedan 20 planes viejos con id menor, por ejemplo restos de una corrida cortada, su plan no aparece y la prueba falla aunque la migración ande bien. Pasó en la PV3.

**La corrección, solo en la prueba:**
- **Si su plan está entre los 20 primeros,** controla que aparezca, como hoy;
- **si no,** controla que el error nombre 20 planes y que la migración haya fallado.

La migración no cambia.

---

## 4. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 3 están hechas, en un commit.
2. Las suites de la regla 3 en verde, en Neon.
3. `typecheck` y `build:frontend` sin errores.
4. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. El hash.
2. La lista de rutas que usan `validarMotivo`, y los campos del front con `maxLength`.
3. La salida final de las suites.
4. Desvíos y dudas.
