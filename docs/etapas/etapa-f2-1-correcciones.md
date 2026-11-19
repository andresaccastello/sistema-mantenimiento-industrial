# Etapa F2.1 — Correcciones de intervenciones y de las pruebas

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `9741de7` (Etapa F2).
> **Origen:** revisión con el sistema levantado en local, con datos de planta, y capturas en 1440×900 y 390×844. Se probaron las 13 acciones y la confirmación de recuperación de punta a punta, mirando la base después de cada una; dos pestañas a la vez; y los perfiles Responsable, Consulta y Operario. Todo lo de abajo se vio en las capturas, se midió con el navegador o se comprobó en la base.

**Lo que funciona y no se toca:**

- las acciones cambian la base como corresponde, con `estado_esperado` correcto;
- los avisos, la recarga cuando otra persona tomó o inició la intervención, y los diálogos a pantalla completa en el celular;
- el historial con nombres;
- los filtros en la dirección y el enlace de volver.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias.
2. **Tres commits**, para revisarlos por separado:
   1. sección 1 (pruebas del backend);
   2. secciones 2, 3 y 4 (correcciones de pantallas y sus pruebas);
   3. sección 5 (separar los diálogos de R3, sin cambiar el comportamiento).
3. Del backend se tocan solo las pruebas y `scripts/run-all-tests.mjs`. El código de `backend/functions/` no cambia.
4. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-f2-1-correcciones.md`.

---

## 1. Las pruebas borran datos que no crearon (primer commit)

### 1.1 Problema

Corrí `npm run test:todo` en mi base local, que tiene datos de corridas viejas y datos cargados a mano. Las 274 pruebas pasaron, pero el control nuevo terminó así:

```
[test:todo] Datos que quedaron: usuarios -20, sectores 0, maquinas 0, intervenciones -4
[test:todo] Finalizado con código de salida: 1
```

El control funcionó: las pruebas **borraron** datos que no habían creado. En la base de pruebas de Neon dio 0 porque esos datos ya se habían borrado en alguna corrida anterior. Las causas:

| Archivo | Qué borra | Por qué está mal |
| :--- | :--- | :--- |
| `motor_estados.test.ts` | `DELETE FROM usuarios WHERE legajo LIKE 'INAC_%'` | Borra los usuarios `INAC_…` de **todas** las corridas anteriores: fueron los −20. Además, en `LIKE` el `_` es comodín: también borraría un legajo como `INACT01`. |
| `motor_estados.test.ts` | las intervenciones con `creado_por_usuario_id IN (resp1, resp2, operario, adminId)` | `adminId` es el **administrador real** (`ADMIN001`). Borra **todas** las intervenciones que haya creado: fueron las −4. |
| `motor_estados.test.ts` | `DELETE FROM usuario_permiso WHERE otorgado_por_usuario_id = adminId` | Borra **todos** los permisos individuales que el administrador haya otorgado a personas reales. El control no lo ve porque no cuenta esa tabla. |
| `usuarios.test.ts` | todos los usuarios que no estaban al empezar el archivo | No son "los creados por la prueba": también se borraría un usuario que alguien cree mientras corre. El requerimiento de la F2 (sección 1.3) pedía borrar solo los creados por la prueba. |
| `scripts/run-all-tests.mjs` | — | Si no puede contar (por ejemplo, falla la conexión), el control **desaparece en silencio**: no imprime la línea y la corrida termina en 0. |

### 1.2 Cambios

1. **`motor_estados.test.ts`:**
   - guardar el id del usuario inactivo en una variable del archivo (`let inactivoId = 0`, como las demás) y, en la limpieza final, borrarlo **por ese id**, no por legajo;
   - borrar las intervenciones de las **máquinas de los dos sectores que crea la prueba** (`maquina_id IN (SELECT id FROM maquinas WHERE sector_id IN (sector1Id, sector2Id))`), no las de un creador;
   - borrar de `usuario_permiso` solo las filas de los usuarios que crea la prueba (`usuario_id IN (...)`), no por quién las otorgó.
2. **`usuarios.test.ts`:** cada usuario que el archivo crea, por la API o con `INSERT`, se agrega a una lista `createdUsuarioIds` **en el momento de crearlo**. La limpieza borra solo los de esa lista. Se quita la comparación con los usuarios del principio.
3. **Revisar los demás archivos de prueba** con la misma regla: toda limpieza borra por ids que la prueba guardó, o por máquinas o sectores que la prueba creó. Nunca por patrón de legajo, por creador ni por quién otorgó algo. Lo que se encuentre y se corrija va en "Desvíos".
4. **`scripts/run-all-tests.mjs`:**
   - contar también `usuario_permiso` y `notificaciones`. La línea queda: `[test:todo] Datos que quedaron: usuarios 0, sectores 0, maquinas 0, intervenciones 0, usuario_permiso 0, notificaciones 0`;
   - si no se puede contar antes o después, imprimir `[test:todo] No se pudo controlar los datos que quedaron: <mensaje>` y terminar con código 1. El mensaje no puede incluir la cadena de conexión;
   - si al contar las dos tablas nuevas aparecen pruebas que dejan filas, se corrige su limpieza con la misma regla del punto 3.

### 1.3 Cierre del primer commit

- `npm run test:todo -- etapa-f2-1-limpieza` en verde con **274** pruebas y los seis números en 0.
- **Correrlo dos veces seguidas**, sin tocar nada en el medio. Las dos tienen que dar 0. El log que queda es el de la segunda.
- Mensaje del commit: `test: las limpiezas borran solo lo que crea cada prueba`.

---

## 2. R2 — Lista

### 2.1 La búsqueda se come el espacio mientras se escribe

**Problema.** Escribí "torno ", con espacio, y me detuve medio segundo. El campo quedó en "torno", sin el espacio. Al seguir con "cnc" quedó **"tornocnc"**.

**Causa.** Cuando termina la espera de 400 ms, se escribe en la dirección el texto recortado. El efecto que copia `filtros.texto` al campo pisa lo que la persona está escribiendo.

**Corrección.** Copiar de la dirección al campo solo cuando la dirección cambió por otra razón, como "Limpiar filtros", volver atrás o un enlace pegado. Es decir, solo si `filtros.texto` es distinto de `busquedaLocal.trim()`.

### 2.2 No se puede filtrar un solo día

**Problema.** En "Reportadas entre", elegir el mismo día dos veces ("hoy a hoy") **borra** la selección. "Lo reportado hoy" es probablemente el filtro de fecha más usado.

**Corrección.** `allowSingleDateInRange` en el `DatePickerInput`.

### 2.3 Página fuera de rango

**Problema.** Con `?vista=mias&pagina=40` se ve "9 intervenciones", la tabla vacía y ningún paginador: no hay forma de volver. Pasa también sin tocar la dirección, por ejemplo cuando se está en la última página de "Mías" y en el próximo refresco se cierran las que había.

**Corrección.**

- Función pura nueva en `lib/listado.ts`: `paginaValida(pagina, total, tamanio)`. Devuelve:
  - 1, si `total` es 0;
  - la última página, si `pagina` es mayor;
  - si no, `pagina`.
- En R2, cuando hay datos y `paginaValida(...)` es distinta de `filtros.pagina`, se reescribe la dirección con esa página usando `setSearchParams(..., { replace: true })`. Así no queda una entrada de más en el historial del navegador.

### 2.4 Columna "Tiempo" cortada

**Problema.** A 1440 px, "Trabajo 3 h 11 min" pasa a dos líneas y la marca queda cortada en "EN CUR…".

**Corrección.** El texto del tiempo no se corta en líneas (`white-space: nowrap`) y la columna tiene un ancho mínimo de 210 px. La marca "en curso" se ve completa.

### 2.5 Filtros

**Problema.**

- Los filtros se reacomodan al elegir valores: con la misma pantalla pasan de una fila a otra (comparar las capturas 40 y 43).
- En el celular, Estado, Sector y Máquina no ocupan todo el ancho.
- Los controles no tienen nombre accesible, solo el texto de ejemplo, que desaparece al elegir un valor.

**Corrección.**

- Los cinco filtros van en un `SimpleGrid` con `cols={{ base: 1, sm: 2, lg: 3, xl: 5 }}`: cada control ocupa su celda y no se mueve.
- "Limpiar filtros" pasa a la línea del conteo: "{total} intervenciones" a la izquierda y el botón a la derecha, solo si `hayFiltros`.
- Cada control lleva `aria-label`:
  - "Buscar";
  - "Estado";
  - "Sector";
  - "Máquina";
  - "Reportadas entre".

---

## 3. R3 — Detalle

### 3.1 "Tomar" cuando ya sos el responsable

**Problema.** El mismo responsable, en dos pestañas. En una toma la intervención. En la otra, que todavía muestra "Tomar", también la toma. El backend responde `RESPONSABLE_SIN_CAMBIOS`. Entonces:

- aparece "Esa persona ya es la responsable.";
- la pantalla **no** se actualiza: sigue mostrando "Tomar".

En "Asignar" pasa lo mismo, porque la lista no ofrece al responsable actual: ese error solo puede aparecer si el responsable cambió mientras el diálogo estaba abierto.

Cuando la toma otra persona funciona bien: aparece "Otra persona ya tomó esta intervención." y la pantalla se actualiza.

**Corrección.**

- `RESPONSABLE_SIN_CAMBIOS` se agrega a `requiereRecargar`.
- Solo en "Tomar", con ese código, el aviso es: "Ya sos el responsable de esta intervención."

### 3.2 Eliminar muestra "No encontramos esta intervención"

**Problema.** Al eliminar, durante un instante se ve "No encontramos esta intervención." y la consola muestra un 404, antes de volver a la lista.

**Causa.** Se vuelve a pedir el detalle de la intervención recién eliminada antes de navegar.

**Corrección.** Al eliminar con éxito:

1. navegar a `volverA` (o `/intervenciones`);
2. quitar del caché el detalle de esa intervención (`removeQueries` de `['intervencion', id]`);
3. invalidar `['intervenciones']`, `['maquinas']` y `['notificaciones-contador']`.

### 3.3 La barra de acciones cambia de lugar

**Problema.** Va a la derecha del título cuando entra y abajo cuando no. Al cambiar de estado, salta de un lugar al otro (por ejemplo, de "Iniciar trabajo · Tomar · Asignar · Registrar como resuelta · Más acciones" a "Reabrir").

**Corrección.** Siempre **debajo** del título, como dice la sección 6.2 de la F2.

---

## 4. Pruebas del frontend

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| FE-20 (se amplía) | `requiereRecargar` | Además de lo actual: `true` para `RESPONSABLE_SIN_CAMBIOS`. |
| FE-26 | `paginaValida` | `(1, 0, 25)` → 1. `(3, 60, 25)` → 3. `(40, 9, 25)` → 1. `(5, 60, 25)` → 3. `(2, 50, 25)` → 2. |

---

## 5. Separar los diálogos de R3 (tercer commit)

**Problema.** `DetalleIntervencion.tsx` tiene 1827 líneas: la pantalla, 13 diálogos y una sola función de envío con 12 casos, que comparten 17 estados (`useState`). Funciona, pero cuesta revisarlo y cambiarlo sin romper otro diálogo. Además, en la F3 la pantalla de máquina va a necesitar "Confirmar que volvió a funcionar", que hoy solo existe dentro de este archivo.

**Cambio.** Solo se reorganiza el código: no cambia ningún texto, estilo, validación, pedido ni aviso. Si algo tiene que cambiar para poder separarlo, frenar y preguntar.

- **Un componente por diálogo** en `componentes/acciones/`, como ya está `ModalEditarReporte`. Cada uno:
  - tiene su propio estado de formulario;
  - recibe por props lo que necesita: el detalle o los datos puntuales, el estado al abrir y los permisos;
  - recibe `onCerrar`.
- **El comportamiento común de la sección 7.2 de la F2** va en un hook, por ejemplo `useAccionIntervencion`:
  - enviar;
  - el aviso de éxito;
  - las invalidaciones;
  - `requiereRecargar`;
  - el error dentro del diálogo.
- **"Confirmar que volvió a funcionar"** recibe solo `maquinaId` y el período. No depende del detalle de la intervención, así se puede usar desde la pantalla de máquina en la F3.
- **`DetalleIntervencion.tsx`** queda con la pantalla, la barra de acciones y qué diálogo está abierto. Debería quedar por debajo de 500 líneas.

**Cierre del tercer commit:**

- `test:front`, `typecheck` y `build:frontend` en verde;
- mensaje: `refactor(f2): un componente por diálogo de acción`.

Yo vuelvo a correr el recorrido completo de acciones contra la base para comprobar que no cambió nada.

---

## 6. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 5 están hechas, en tres commits (regla 2).
2. `npm run test:front` en verde (FE-01 a FE-26).
3. `npm run test:todo -- etapa-f2-1`:
   - en verde, con **274** pruebas;
   - la línea de datos que quedaron con los seis números en 0;
   - corrido **dos veces seguidas**;
   - el log de la segunda corrida va en `docs/evidencia/`.
4. `npm run typecheck` y `npm run build:frontend` sin errores.
5. Push de los tres commits en `feat/base-neon`.

**Informe corto:**

1. Los hashes de los tres commits.
2. Las salidas de las pruebas:
   - la salida final de `test:front`;
   - de las dos corridas de `test:todo`, la línea de total y la de datos que quedaron.
3. Typecheck y build. Incluir:
   - el tamaño del JS del build;
   - las líneas de `DetalleIntervencion.tsx` después del tercer commit.
4. Desvíos, incluido lo que se haya encontrado en el punto 1.2.3.
5. Dudas.
