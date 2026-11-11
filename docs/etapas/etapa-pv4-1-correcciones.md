# Etapa PV4.1 — Correcciones de la PV4

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `c7ba3c1` (Etapa PV4).
> **Origen:** revisión de la PV4 (11/11), con el recorrido en pantalla a 1440, 1280 y 390 px, y la duda abierta del informe.

**La PV4 está bien.** Lo que se vio andando en pantalla:
- **Medidores en la ficha:** el alta con lectura inicial, el nombre repetido, la lectura menor, el aviso de salto con "Guardar igual", las lecturas y anular una.
- **El plan:** la tarea "Las dos", con la primera sugerida (1.490), y los textos en el plan y en los vencimientos.
- **Las tarjetas:** las cinco entran en una fila a 1280.
- **Generar y marcar con lectura:** la lectura viene llena, "12.345,5" se manda como 12345.5 y la menor se rechaza.
- **La corrección en `FINALIZADA`:** la lectura vacía y la mayor rechazada.
- **En celular:** nada desborda.

Quedan dos detalles.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Un commit:** `fix(front): correcciones de la PV4`.
3. **Pruebas:**
   - `test:front`, `typecheck` y `build:frontend`;
   - **no correr `test:todo`;**
   - las FE nuevas desde FE-121.
4. Ninguna prueba existente cambia. Si alguna falla, frenar y avisar.
5. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-pv4-1-correcciones.md`.

---

## 1. "Avisar antes" sigue al 10 % (la duda del informe)

**Qué pasa:** al editar una tarea con `cada` 250 y la anticipación de omisión (25), si se cambia "Cada" a 500 sin tocar "Avisar antes", se manda `anticipacion: 25`. Queda en el 5 %. Lo vi en el `PATCH`.

**La regla, en `lib/preventivos.ts`, con su prueba:**
- Al cambiar "Cada", si "Avisar antes" no se tocó en este diálogo y su valor es el 10 % del "Cada" anterior, redondeado a 2 decimales, pasa a ser el 10 % del nuevo.
- Si el valor era otro, lo puso alguien: no se toca.
- Vacío sigue vacío, y la API pone la de omisión.

**Casos de la prueba:**

| "Cada" | "Avisar antes" antes | "Avisar antes" después |
| :--- | :--- | :--- |
| 250 → 500 | 25 | 50 |
| 250 → 500 | 40 | 40 |
| 250 → 500 | vacío | vacío |
| 0,05 → 1 | 0,01 | 0,1 |

---

## 2. Los medidores en celular

**Qué pasa:** a 390 px, el bloque de medidores es una tabla con desplazamiento horizontal. "Cargar lectura" queda fuera de la vista y hay que correr la tabla para encontrarlo. Para el operario, que va a cargar lecturas desde el celular, ese es el camino principal.

**Debajo de `sm`, cada medidor es una tarjeta,** una debajo de la otra:
- el nombre, con la insignia "Inactivo" si corresponde, y el menú a la derecha;
- la última lectura: "1.300 horas", y abajo, chico, "el 11/11/2026 por Responsable Demo";
- "2 tareas";
- **"Cargar lectura",** a todo el ancho, con los mismos permisos y la misma regla de la máquina inactiva.

**Desde `sm`,** la tabla de hoy.

---

## 3. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 y 2 están hechas, en un commit.
2. `test:front`, `typecheck` y `build:frontend` sin errores.
3. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. El hash.
2. La salida final de `test:front`, con las FE nuevas.
3. Desvíos y dudas.

**El recorrido en pantalla lo hace el revisor.**
