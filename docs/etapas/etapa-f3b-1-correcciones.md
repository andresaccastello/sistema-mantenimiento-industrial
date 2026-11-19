# Etapa F3b.1 — Detalles de las pantallas de máquinas

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `ce9ee1d` (Etapa F3b).
> **Origen:** revisión de la F3b con el sistema levantado en mi base local.
>
> - Datos: dos plantas, máquinas en los cuatro estados y una desactivada.
> - Capturas a 1440×900 y 390×844.
> - Pruebas del backend: `test:todo` en mi base y en una base como la principal, con 294 de 294 y los once números en 0.

**Lo que funciona y no se toca:**

- **R1 Tablero:**
  - los ocho contadores coinciden con la base, con y sin planta;
  - cada tarjeta abre la lista con lo mismo que contó;
  - "Detenidas ahora" sale ordenada por criticidad;
  - Consulta ve solo los contadores que le corresponden.
- **R4 Máquinas:**
  - la búsqueda funciona sin tildes y por código o modelo;
  - los filtros se combinan bien y la planta deja solo sus sectores;
  - "Ver desactivadas" aparece solo para el administrador;
  - "← Máquinas" vuelve con los filtros.
- **R5 Detalle de máquina:** todas las acciones dejan la base como corresponde.
  - El alta toma los valores por omisión.
  - El código repetido muestra el error en su campo.
  - La edición manda solo lo que cambió.
  - Confirmar con dos detenciones cierra las dos.
  - Fuera de servicio y vuelta funcionan, también con una detención abierta (queda "Detenida").
  - `SIN_CAMBIOS` en dos pestañas avisa y actualiza.
  - No deja desactivar con trabajo abierto; desactivar y reactivar funcionan.
  - La inactividad coincide con `fn_inactividad_maquina`.
- **Perfiles:** Responsable, Consulta y Operario ven lo que indica la tabla 8.
- **R2 y R3:**
  - el filtro por planta cuenta bien;
  - el enlace de R3 a la máquina funciona;
  - el recorrido de la F2 sigue igual.
- **Celular:** sin desborde y con los diálogos a pantalla completa.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias.
2. **Un solo commit:** `fix(front): detalles de las pantallas de máquinas`.
3. Solo frontend. El backend y las pruebas del backend no cambian.
4. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-f3b-1-correcciones.md`.

---

## 1. Correcciones

### 1.1 "Detenidas ahora" no coincide con la tarjeta "Detenidas"

**Problema.** En mi base, la tarjeta "Detenidas" dice 5 y "Detenidas ahora" muestra 7 máquinas.

- Las dos de más están "En mantenimiento": tienen una detención abierta y alguien trabajando en ellas.
- Es correcto que estén en la lista, porque están paradas. Pero la tabla no muestra el estado, así que no se entiende por qué no coinciden los números.

El error es mío: no puse la columna en el requerimiento.

**Corrección.**

- En "Detenidas ahora", debajo del nombre de la máquina, va su `EstadoBadge` (`estado` ya viene en la respuesta).
- Debajo del título del bloque, una línea en gris: "Máquinas paradas ahora, estén detenidas o en mantenimiento."

### 1.2 "1 máquinas"

En R4, la línea del conteo dice "1 máquinas". Tiene que decir "1 máquina" en singular, como "1 intervención" en R2.

### 1.3 "← ← Máquinas"

En R5, el enlace para volver muestra dos flechas: el ícono `IconArrowLeft` y el carácter "←" del texto. Debe quedar como en R3: solo el texto "← Máquinas", sin el ícono.

### 1.4 Singular en `motivoNoDesactivable`

Con una sola intervención abierta, el texto dice "Tiene 1 intervención abierta. Cerralas o cancelalas…". Tiene que decir:

> Tiene 1 intervención abierta. Cerrala o cancelala antes de desactivarla.

Con dos o más, queda como está. Se agrega el caso a FE-30.

---

## 2. Criterios de cierre e informe

**Criterios de cierre:**

1. La sección 1 está hecha, en un commit.
2. `npm run test:front` en verde, con FE-30 ampliada.
3. `npm run typecheck` y `npm run build:frontend` sin errores.
4. Push en `feat/base-neon`.

**No hace falta `test:todo`:** esta etapa no toca el backend. Yo corro las pruebas completas en mis bases al revisar.

**Informe corto:**

1. El hash del commit.
2. La salida final de `test:front`.
3. Typecheck y build, con el tamaño del JS.
4. Desvíos.
5. Dudas.
