# Etapa C1.1 — Correcciones de costos

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `28c8d5c` (Etapa C1).
> **Origen:** revisión de la C1 con el sistema levantado en mi base local.
>
> - `test:todo` en mi base: 425 de 425, con los quince números en 0. La huella de la base, sin cambios ajenos.
> - 39 cuerpos raros contra el `POST`: ningún 500, y ninguno guarda nada.
> - El importe con valor hora: la API, `ROUND` de SQL e `importeManoObra` coinciden en 8 casos.
> - Concurrencia, 10 vueltas por caso: ajustes simultáneos, anulaciones simultáneas, y un ajuste y una anulación que juntos darían negativo. Todo bien.
> - Contrato: las cuatro respuestas reales, asignadas a los tipos del frontend, pasan el typecheck.
> - Recorrido con Playwright, en escritorio y en celular, de R3, los diálogos y D1.

**Lo que funciona y no se toca:**

- **La API:**
  - los permisos por estado;
  - el total que nunca queda negativo, también al anular un consumo, y sin tocar el stock;
  - las auditorías sin importes;
  - el reporte, con sus filtros y su alcance.
- **Las pantallas:**
  - el bloque Costos, con el resumen, las horas y los anulados tachados;
  - los diálogos, con sus errores en cada campo y `TOTAL_NEGATIVO` en los tres;
  - "Motivo de la corrección" con la intervención finalizada;
  - la pestaña Costos, el CSV y el estado vacío;
  - sin `COSTOS_VER`, ni el bloque ni la pestaña.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Dos commits:**

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1 y 2 | `fix(db): la migración 017 valida sus restricciones` |
   | 2 | 3 a 5 | `fix: costos sin desborde y auditoría con la persona` |

3. **Pruebas:**
   - solo `test:migration-017`, `test:costos` y `test:front`;
   - **no correr `test:todo`:** va en la corrida de la noche;
   - las pruebas existentes no se modifican: se agregan M17-05, CO-16 y CO-17.
4. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-c1-1-correcciones.md`.

---

## 1. Las restricciones de la 017 quedan sin validar

Las cinco restricciones nuevas se crean con `NOT VALID`. Eso tiene dos efectos:

- **Quedan sin validar aunque no haya filas.** En mi base, `intervencion_costos` está vacía, y `pg_constraint` muestra `convalidated = false` en las cinco. Lo mismo va a pasar en la base principal.
- **Un renglón viejo que no las cumple no se puede anular.** La anulación es un `UPDATE`, y el `CHECK` se controla igual. Lo probé con un `AJUSTE` sin motivo: el `UPDATE` falla con 23514, y la API respondería 500.

**Corrección:** que la migración haga con los renglones lo mismo que ya hace con los importes de la sección 2.2 de la C1: frenar y avisar, sin corregir nada.

1. **Un bloque `DO` antes de validar:**
   - busca los renglones que no cumplen alguna de las cinco reglas: los que dan verdadero en `NOT (<condición del CHECK>)`;
   - **si hay alguno, la migración falla** con un mensaje que nombra hasta 20 ids: "Hay renglones de costo que no cumplen las reglas nuevas: … Revisarlos antes de migrar.".
2. **Después, las cinco quedan validadas:** `VALIDATE CONSTRAINT`, o crearlas sin `NOT VALID`.
3. **La rama de pruebas de Neon,** antes de aplicar:
   - listar esos renglones: `id`, `intervencion_id`, `tipo`, `descripcion`, `importe`, `motivo`, `registrado_en`, y la `descripcion` de su intervención;
   - **mostrar la lista y esperar el OK.** Solo con el OK, borrar esos renglones y nada más.
   - Si alguno no es de `migration_003` (intervención "Test costos"), frenar.
4. **M17-05:**
   - después de aplicar, las cinco restricciones nuevas tienen `convalidated = true`;
   - con `ROLLBACK`, como M17-04: quitar `ck_intervencion_costos_ajuste`, insertar en una intervención de la prueba un `AJUSTE` sin motivo, y reaplicar. La migración falla, y el mensaje incluye el id del renglón.

---

## 2. El runner no controla `intervencion_costos`

`TABLAS_CONTROL`, en `scripts/run-all-tests.mjs`, no incluye la tabla nueva. Si una prueba deja renglones, nadie se entera. Así quedaron los 19 de la rama de pruebas.

**Corrección:** agregar `intervencion_costos` después de `intervencion_repuestos`. La línea de "Datos que quedaron" pasa a tener dieciséis tablas.

---

## 3. Un total demasiado grande da 500

En la intervención de prueba, la API aceptó 99 renglones de 1000 h × $ 10.000.000. El renglón 100 dio **500 `ERROR_INTERNO`**: el total no entra en `numeric(14,2)`. Son importes irreales, pero la regla es que la API nunca responda 500 por un dato.

**Corrección:**

1. **El importe calculado tiene el mismo máximo que el cargado a mano:** si `ROUND(horas * valor_hora, 2)` pasa de 1.000.000.000, 422 `DATOS_INVALIDOS`. Se compara en SQL, con el mismo `ROUND`.
2. **`recalcularCostosIntervencion`:**
   - suma sin el `::numeric(14,2)`;
   - si los repuestos, la mano de obra o el total pasan de 999.999.999.999,99: 409 `TOTAL_FUERA_DE_RANGO`, antes de escribir nada, como `TOTAL_NEGATIVO`.
3. **`GET /api/reportes/costos`:** las sumas sin `::numeric(14,2)`, para que un período con mucho gasto no desborde.

**CO-16:**

- mano de obra de 1000 h × 10.000.000: 422, y no se guarda nada;
- en una intervención de la prueba, 1000 renglones `OTRO` de 1.000.000.000 insertados por SQL. Después:
  - un `POST` de 1 da 409 `TOTAL_FUERA_DE_RANGO`, y `costo_total_estimado` no cambia;
  - el reporte del período da 200.

---

## 4. Los errores de los campos numéricos no se borran

En `ModalCosto`, Horas, Valor hora e Importe conservan su error después de que el usuario corrige el valor. Lo vi en pantalla: "Hasta 1.000 horas." seguía debajo de 2,5. Los demás campos del diálogo sí lo borran.

**Corrección:** el `onChange` de esos tres campos también borra su error, igual que en los demás.

---

## 5. "Mano de obra — Mano de obra" en el historial

Una mano de obra sin descripción se guarda como "Mano de obra". Entonces la auditoría dice "Se agregó: Mano de obra — Mano de obra". No dice quién trabajó ni cuánto.

**Corrección**, solo para `MANO_OBRA`, al agregar y al anular:

- **Texto:** "Se agregó: Mano de obra — <persona o proveedor>, <horas> h".
  - La persona va como "Nombre Apellido".
  - Las horas van con `formatearCantidad`.
- **Si la descripción no es la de omisión,** se agrega al final ": <descripción>". Por ejemplo:
  - "Se agregó: Mano de obra — Responsable Demo, 2,5 h";
  - "Se anuló: Mano de obra — Taller Gómez, 4 h: Rebobinado del motor".
- **Sigue sin importes ni valor hora.** Los otros tipos no cambian.

**CO-17:** los dos ejemplos, en una intervención `FINALIZADA`.

---

## 6. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 5 están hechas, en dos commits.
2. En verde, en Neon: `test:migration-017` y `test:costos`.
3. `npm run test:front`, `npm run typecheck` y `npm run build:frontend` sin errores.
4. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. Los dos hashes.
2. La lista de la sección 1.3, y qué se hizo con ella.
3. La salida de `SELECT conname, convalidated FROM pg_constraint WHERE conrelid = 'intervencion_costos'::regclass AND contype = 'c' ORDER BY conname;` en la rama de pruebas.
4. La salida final de las tres suites.
5. Typecheck y build.
6. `wc -l` de los archivos tocados.
7. **Qué probaste en pantalla y qué no.** Si no levantaste la app, decirlo.
8. Desvíos y dudas.
