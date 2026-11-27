# Etapa A2 — El celular, más simple

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `0f04aff` (Etapa A1).
> **Origen:**
> - la revisión de la A1 (11/11);
> - lo que vio Andrés probando en el celular: los reportes son demasiada información para esa pantalla, y "Reportar falla" y "Mis reportes" se sienten como lo mismo.

**Todo lo de esta etapa es solo para el celular.** En la computadora no cambia nada. Tampoco cambia la API.

---

## 0. Reglas de trabajo

1. **Leé `CLAUDE.md` entero y seguí sus reglas. Nunca abras, leas, muestres ni modifiques `.env`.**
2. Rama `feat/base-neon`. No se agregan dependencias.
3. **Un commit:** `feat(front): celular más simple`. Tiene que pasar `npm run typecheck`.
4. **Pruebas:**
   - `npm run test:front`, `npm run typecheck` y `npm run build:frontend`;
   - más `npm run test:migration-015`, por la 4;
   - **no correr `test:todo`.**
5. **Pruebas existentes: se autoriza cambiar solo:**
   - FE-130 y FE-131, por la 2;
   - la que controle el texto del permiso, por la 4.

   Si otra falla, frenar y avisar.
6. **Ante cualquier duda, frenar y preguntar.**

Guardar este archivo como `docs/etapas/etapa-a2-celular-simple.md`.

---

## 1. El corte del celular

**Qué pasa:** `CORTE_CELULAR` es `(max-width: 48em)`, y a 768 px exactos el sistema se comporta como celular: bloquea las pantallas. Pero el `Layout` muestra el menú de la computadora, porque Mantine usa `min-width: 48em` para `visibleFrom="sm"`. Una tablet en vertical, de 768 px, queda mitad y mitad.

**La corrección:** "celular" es **menos de 48em**. Por ejemplo, `(max-width: 47.99em)`, o lo que sea exactamente lo contrario de `min-width: 48em`. Así coincide con el `Layout`. Sumar una prueba FE con 767 y 768 px, si se puede probar en `lib/`. Si no, explicarlo en el informe.

---

## 2. Una sola entrada para el operario

**Qué pasa:** en el celular, el menú tiene "Reportar falla" y "Mis reportes". "Mis reportes" ya tiene arriba el botón "Reportar falla", así que son dos caminos a lo mismo.

**En el celular:**
- **el menú ya no tiene "Reportar falla".** Queda "Mis reportes", y para quien gestiona, también "Tablero" y "Reportes";
- **al entrar a `/`,** quien tiene `INTERVENCIONES_CREAR` va a `/mis-reportes`, y no a `/reportar`. El resto, como en la A1;
- **en "Mis reportes",** el botón "Reportar una falla" va primero, a todo el ancho y bien visible, antes de la lista;
- **`/reportar` sigue permitida:** el botón lleva ahí;
- **al terminar un reporte,** el botón que vuelve al inicio dice "Ver mis reportes" y lleva a `/mis-reportes`;
- **en el aviso de "Esta sección se usa desde la computadora",** los botones siguen el menú nuevo.

**Las pruebas FE-130 y FE-131** se ajustan a esto: el menú y el destino al entrar en el celular.

---

## 3. Los reportes en el celular: un resumen

**Qué pasa:** en el celular, `/reportes` muestra las mismas pestañas, tablas y filtros que en la computadora. En esa pantalla se hace pesado y no se entiende.

**En el celular,** `/reportes` muestra **un solo resumen**, en lugar de las pestañas. Es un componente nuevo, `componentes/reportes/ResumenCelular.tsx`, que usa los endpoints que ya existen, con el alcance del usuario y sin filtro de planta ni de sector.

**Arriba, el período:** un `SegmentedControl` con "7 días", "30 días" y "Este mes"; por omisión, "30 días". "Este mes" va desde el 1.º del mes, a las 00:00 locales, hasta ahora.

**Debajo, una tarjeta por dato, una debajo de la otra.** Cada una con un título corto, el número grande y, como mucho, una línea chica de contexto:

| Tarjeta | Número | Línea chica | De dónde sale |
| :--- | :--- | :--- | :--- |
| Fallas reportadas | `fallas` | "X reparadas" (`correctivas_finalizadas`) | `/api/reportes/indicadores` |
| Disponibilidad | `disponibilidad` en %, con un decimal, o "—" | "Máquinas paradas: 12 h 30 min" (`inactividad_minutos`, con `formatDuracion`) | `/api/reportes/indicadores` |
| Tiempo de reparación | `mttr_minutos`, con `formatDuracion`, o "—" | "Promedio por falla" | `/api/reportes/indicadores` |
| Preventivos a tiempo | `resumen.cumplimiento`, con `textoCumplimiento` y su color | "X vencidas sin hacer" | `/api/reportes/preventivos?agrupar=sector` |
| Costo de mantenimiento | `total`, con `formatMoneda` | "X intervenciones" | `/api/reportes/costos`. **Solo con `COSTOS_VER`:** sin el permiso, ni la tarjeta ni el pedido. |
| Más tiempo paradas | Las 3 máquinas con más inactividad: "PIN-01 · Cámara de pintura — 5 h 10 min" | Sin línea chica | `/api/reportes/inactividad` |

- **Al pie:** "El detalle completo está en Reportes, desde la computadora."
- **Sin tablas, sin CSV y sin filtros de planta ni de sector.**
- **Sin el permiso de un reporte** (`REPORTES_CONSULTAR`), la pantalla ya está protegida por la ruta; no hace falta nada nuevo.
- **Mientras carga,** cada tarjeta muestra su esqueleto. **Si un pedido falla,** su tarjeta dice "No se pudo cargar", y las otras se muestran igual.

**La lógica va en `lib/reportes.ts`,** con pruebas FE desde FE-132:
- `rangoResumenCelular(opcion, ahora)`: las fechas de cada período; "Este mes" con la zona local;
- `tarjetasResumenCelular(datos, permisos)`: qué tarjetas van, con sus textos;
- `topInactividad(filas, 3)`.

---

## 4. El texto del permiso

**Qué pasa:** en la ficha de un usuario todavía dice "WhatsApp". Es la descripción de `CONFIGURACION_GESTIONAR` en la base: "…como los avisos por email y WhatsApp".

**La corrección:** en `database/migrations/015_avisos_email.sql`, que todavía es editable, la descripción pasa a decir "…como los avisos por email". **La migración tiene que poder reaplicarse:** si el permiso ya existe, se actualiza la descripción.

---

## 5. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 4 están hechas, en un commit.
2. Las pruebas de la regla 4 en verde; `test:migration-015` en Neon.
3. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. El hash.
2. La salida final de `test:front`, con las FE nuevas, y la de `test:migration-015`.
3. Typecheck y build.
4. Desvíos y dudas.

**El recorrido en pantalla lo hace el revisor.**
