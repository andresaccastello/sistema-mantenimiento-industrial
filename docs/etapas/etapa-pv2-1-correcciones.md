# Etapa PV2.1 — Correcciones

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `a5d3e7a` (Etapa PV2).
> **Origen:** revisión de la PV2 con el sistema levantado en mi base local.
>
> - **Pruebas:** `test:todo` local da 460 de 460, sin restos. Typecheck y build sin errores.
> - **Recorrido con Playwright,** a 1440 × 900, 1366 × 768, 1280 × 800 y 390 × 844:
>   - **P1:** las tarjetas como filtro, el encadenado de planta, sector y máquina, la paginación con 123 filas y los textos sin filas.
>   - **Generar:** las casillas y el texto del botón, `TAREA_EN_CURSO` con otro usuario generando a la vez, y el paso a la intervención.
>   - **P2:** el menú de las filas, editar el plan con `PLAN_DUPLICADO` en Nombre, desactivar y reactivar, y el diálogo de una tarea, con fecha, repuesto y cantidad.
>   - **P3:** la máquina elegida desde la dirección, el error con `indice` en su tarea y su diálogo, la confirmación de Cancelar, y el guardado.
>   - **R3:** marcar en `PENDIENTE`, la observación, el aviso al finalizar, la corrección con motivo en `FINALIZADA` y el historial.
>   - **R1, R2 y R5:** las tres partes.
>   - **Un usuario de consulta:** sin menú, sin enlace al plan y con las casillas deshabilitadas.
>   - **Celular:** nada desborda.
>
> Todo anda, salvo lo de abajo.

**Lo que funciona y no se toca:** todo lo demás de la PV2.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Un commit:** `fix(front): insignias enteras y textos de una preventiva`.
3. **Pruebas:** solo `test:front`, `npm run typecheck` y `npm run build:frontend`. No correr `test:todo`. Las pruebas existentes no se modifican.
4. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-pv2-1-correcciones.md`.

---

## 1. Insignias de estado cortadas

**Cómo se ve.** En P1, pestaña Vencimientos, columna Estado, las insignias se cortan: "Ven…" y "En c…". Pasa a 1280 y a 1366 px, que son anchos comunes de notebook, y en el celular. A 1440 px se ven enteras.

**Por qué.** La tabla tiene un ancho mínimo de 1000 px, y la columna Estado se achica hasta cortar el texto de la insignia.

**Corrección.** Ninguna insignia de estado se corta en las tablas de la PV2: la columna Estado lleva un ancho mínimo, como hace la lista de intervenciones. Revisar las mismas columnas en:

- P1, en las dos pestañas;
- P2, en las tareas y en las intervenciones del plan;
- R5, en el bloque de planes.

---

## 2. "Falla" en una intervención preventiva

En una preventiva quedan tres textos que hablan de una falla:

| Dónde | Hoy | En una preventiva |
| :--- | :--- | :--- |
| R3, tarjeta "Detenciones de la máquina" | "Esta falla no detuvo la máquina." | "Esta intervención no detuvo la máquina." |
| Diálogo "Registrar como resuelta" | "Para fallas que ya se arreglaron sin pasar por 'Iniciar trabajo'." | "Para trabajos que ya se hicieron sin pasar por «Iniciar trabajo»." |
| Diálogo "Editar intervención" | La etiqueta "¿Qué pasa?" y el error "Describí la falla (al menos 5 caracteres)." | "Descripción" y "Describí el trabajo (al menos 5 caracteres)." |

En una correctiva, los tres textos no cambian.

---

## 3. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 y 2 están hechas, en un commit.
2. `npm run test:front`, `npm run typecheck` y `npm run build:frontend` sin errores.
3. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. El hash.
2. Las columnas que tocaste y el ancho que les diste.
3. La salida final de `test:front`, del typecheck y del build.
4. `wc -l` de los archivos tocados.
5. Desvíos y dudas.
