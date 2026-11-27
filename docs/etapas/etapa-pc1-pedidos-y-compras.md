# Etapa PC1 — Pedidos de repuestos y compras

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `feaa837` (Etapa CAL1).
> **Origen:** la charla del 13/11 sobre pedidos, costos y el SAE, y las decisiones del 16/11 (sección 1).

---

## 0. Qué pasa hoy

**Lo que ya funciona bien:**
- **Stock:** cada repuesto puede llevar control de stock o no (D-018).
- **Ingreso de stock:** guarda cantidad, proveedor, comprobante y costo unitario, y el costo actualiza el del repuesto.
- **Uso en una intervención:** un repuesto con stock descuenta stock al costo del momento. Uno sin stock registra su costo en el uso.
- **Costo de la intervención:** suma solo lo que se **usó**, más los renglones de costo (D-019). Un pedido no suma, y eso está bien: lo que se pide puede cancelarse o ir al stock.

**Lo que confunde:**
1. **El pedido no cambia nada solo.** Se carga el pedido y la intervención sigue "En proceso". Para que quede esperando, hay que apretar "Esperar repuestos" aparte.
2. **Recibir no es usar.** Se recibe el pedido y entra al stock, pero después hay que cargarlo de nuevo como usado en la misma intervención: dos pasos para lo mismo.
3. **Un repuesto sin stock, al recibirlo, no guarda nada:** ni costo ni comprobante. El costo aparece recién cuando se carga el uso, y ahí ya no se sabe a quién se le compró ni con qué factura.
4. **No se ve lo que se compró.** Un ingreso de 100 rulemanes a $5.000 actualiza el precio, pero no aparece en ningún reporte como compra.

**La idea de fondo** (la que charlamos): **dos números distintos, que no se mezclan.**

| Número | Qué es | Dónde se ve | ¿Va al SAE? |
| :--- | :--- | :--- | :-: |
| **Compras** | La plata que salió, con factura de un proveedor: un ingreso de stock o un pedido recibido. | Reporte nuevo de compras | Sí, cuando se haga el archivo |
| **Costo de mantenimiento** | Lo que se usó en cada máquina: repuestos usados, mano de obra y servicios. | Intervención y reporte de costos (ya existe) | No: los repuestos ya entraron como compra |

---

## 1. Decisiones (acordadas el 16/11)

Van en la D-029 (sección 8), con su motivo.

| # | Tema | Decisión | Se descartó |
| :-: | :--- | :--- | :--- |
| D1 | El pedido y la espera | Al guardar un pedido con la intervención en proceso, **se pregunta** si pasa a esperar repuestos. Si la máquina está parada por esa falla, el diálogo avisa que va a figurar **"Detenida"** en vez de "En mantenimiento". | Que pase sola: a veces se pide algo para después y se sigue trabajando. |
| D2 | Pedido de texto libre | Para **usarlo** al recibirlo, se elige el repuesto del catálogo, o se crea. Si no se usa, se recibe como hoy, sin elegir nada. | Cargarlo como renglón de costo "Otro": queda afuera del reporte de repuestos y de su historial de precios. |
| D3 | Cuánto se usa al recibir | **Con stock:** entra todo lo recibido y se usa la cantidad indicada, como mucho lo recibido; por omisión, todo. Lo que sobra queda en stock. **Sin stock:** se usa todo lo recibido. | Elegir cantidad sin stock: si sobra seguido, ese repuesto tiene que llevar stock. |
| D4 | Qué es una compra | Un **pedido recibido**, siempre. Un **ingreso manual** de stock, solo si tiene **proveedor**: sin proveedor suele ser carga inicial o un hallazgo en el depósito, y el reporte lo cuenta aparte. **Cada compra cuenta una vez:** el uso de algo comprado no es otra compra. | Un campo "Tipo de ingreso": se suma si en la prueba con GI-RE la regla confunde. |
| D5 | Pedido que llega con la intervención cerrada | Se recibe igual, porque es una compra, y si lleva stock entra al stock. **No se ofrece "Usar en esta intervención":** para cargarlo ahí, se corrige con permiso y motivo, como hoy. Al **finalizar** con pedidos sin recibir, el diálogo avisa, pero no frena. | Frenar la finalización: un arreglo provisorio es normal. |
| D6 | Quién ve el reporte de compras | `REPORTES_CONSULTAR` con **alcance a todas las máquinas**, más `COSTOS_VER`. Una compra para stock no es de ningún sector. | Abrirlo a `REPUESTOS_GESTIONAR`. |
| D7 | Lo que el reporte no es | **No es contabilidad:** no distingue IVA, tipo de factura ni condición de pago. Muestra los importes como se cargaron. | — |
| D8 | Fuera de esta etapa | El archivo para el SAE, que espera el documento: esta etapa deja los datos listos. La regla de la mano de obra (la externa tiene factura; la interna es sueldo). Recibir un pedido en partes. | — |

**Pregunta abierta, para el padre de Andrés, que no frena la etapa:** los costos que se cargan, ¿son con IVA o sin IVA?

---

## 2. Reglas de trabajo (para cuando se implemente)

1. **Leé `CLAUDE.md` entero y seguí sus reglas.**
   - **Nunca abras, leas, muestres ni modifiques `.env`.**
   - Rama `feat/base-neon`. **No se agregan dependencias.**
2. **Dos commits,** y cada uno pasa `npm run typecheck` solo:

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 3, 4, 5 y 8 | `feat(api): pedidos que se usan al recibir y reporte de compras` |
   | 2 | 6 y 7 | `feat(front): pedidos, espera y compras` |

3. **Pruebas:**
   - en Neon: `test:pedidos-compras` (nueva), `test:migration-020` (nueva), `test:repuestos-intervenciones`, `test:repuestos`, `test:costos` y `test:reportes`;
   - además: `test:front`, `typecheck` y `build:frontend`;
   - **no correr `test:todo`.**
4. **Pruebas existentes:** no se autoriza cambiar ninguna. Si una falla, frenar y avisar.
5. **Ante cualquier duda, frenar y preguntar.**

Guardar este archivo como `docs/etapas/etapa-pc1-pedidos-y-compras.md`.

---

## 3. Base de datos: migración 020 (primer commit)

`database/migrations/020_pedidos_compras.sql`. Tiene que poder reaplicarse sin error.

| Tabla | Columna | Tipo | Para qué |
| :--- | :--- | :--- | :--- |
| `pedidos_repuesto` | `costo_unitario` | `NUMERIC(14,2) NULL`, `CHECK (>= 0)` | El precio de la compra, aunque el repuesto no lleve stock. |
| `pedidos_repuesto` | `comprobante` | `VARCHAR(60) NULL` | La factura o el remito. |
| `pedidos_repuesto` | `consumo_id` | `BIGINT NULL REFERENCES intervencion_repuestos(id)` | El uso que se creó al recibir, si se usó. |

- **Sin tablas nuevas:** `TABLAS_CONTROL` no cambia.
- **Prueba de la migración:** `backend/tests/migration_020.test.ts`, con el script `test:migration-020`:
  - aplicar dos veces;
  - las tres columnas con sus tipos;
  - el `CHECK` rechaza un costo negativo.

---

## 4. Recibir un pedido (primer commit)

`POST /api/intervenciones/:id/pedidos/:pedidoId/recibir` suma campos **opcionales**. Sin ellos, se comporta exactamente como hoy.

| Campo | Regla |
| :--- | :--- |
| `comprobante` | Se guarda siempre en el pedido, y también en el movimiento si entra al stock. Hasta 60 caracteres. |
| `costo_unitario` | **Ahora también sin ingreso al stock.** Se guarda en el pedido. Pide permiso para cargar costos, como hoy. Si entra al stock, también va en el movimiento y actualiza el costo del repuesto, como hoy. |
| `repuesto_id` | Solo en un pedido de texto libre y solo con `usar`: asocia el pedido a ese repuesto del catálogo (D2). En un pedido que ya tiene repuesto: 422 `DATOS_INVALIDOS`. |
| `usar` | `{ "cantidad": n }`. Registra el uso en esta intervención, en la misma transacción (D3). |

**Reglas de `usar`, en este orden:**
- **La intervención tiene que estar en proceso o esperando repuestos.** Si no, 409 `ESTADO_NO_PERMITE_REPUESTOS` (D5), **también si está finalizada:** este control va antes de `autorizarRegistroConsumo`, que con una finalizada aceptaría una corrección con motivo.
- **Después, quién recibe:** `autorizarRegistroConsumo`, igual que al cargar un uso hoy.
- **Sin repuesto,** ni en el pedido ni en el cuerpo: 422 `PEDIDO_SIN_REPUESTO`.
- **Repuesto con stock:** `ingresar_stock` tiene que ser `true`; si no, 422 `DATOS_INVALIDOS`, "Para usarlo, primero tiene que entrar al stock". La cantidad va de más de 0 a la del pedido.
- **Repuesto sin stock:** la cantidad tiene que ser igual a la del pedido.
- **El uso se registra con `registrarConsumo`,** sin copiar su lógica. Lleva la observación "Pedido N.º X".
  - Sin stock: el costo es el `costo_unitario` del cuerpo; sin él, el del repuesto, como hoy.
  - Con stock: el egreso sale al costo del repuesto, que ya se actualizó con el ingreso.
- **El pedido guarda `consumo_id`.**

**Todo en una transacción:** si el uso falla (por ejemplo, el repuesto está inactivo), no se recibe nada.

**La respuesta suma:**
- `costo_unitario` (solo para quien ve costos), `comprobante` y `consumo_id`;
- `intervencion_estado`, el estado de la intervención;
- `pedidos_abiertos`, cuántos pedidos de la intervención quedan pendientes o pedidos. Sirve para ofrecer "Reanudar" (6.3).

**`GET /api/intervenciones/:id/pedidos`** suma `costo_unitario` (solo con permiso de costos), `comprobante` y `consumo_id`.

**Anular un uso que vino de un pedido:** como cualquier uso. El pedido sigue recibido, porque la compra se hizo igual.

---

## 5. Reporte de compras (primer commit)

`GET /api/reportes/compras?desde=&hasta=&proveedor_id=`

- **Permisos:** como en D6. Sin ellos, 403.
- **Fechas:** con `validarIntervaloReporte`, como los otros reportes. La fecha de una compra es la del día local del movimiento de ingreso o de la recepción del pedido.

**Qué es una compra (D4):**
1. **Un movimiento `INGRESO` con proveedor:** manual, o de un pedido que entró al stock.
2. **Un pedido `RECIBIDO` sin movimiento:** un repuesto sin stock, o uno de texto libre.

Un pedido que entró al stock cuenta por su movimiento, no dos veces.

**La respuesta:**

```json
{
  "desde": "2026-11-01", "hasta": "2026-11-30",
  "total": 512500.00,
  "compras": 7,
  "sin_costo": 1,
  "ingresos_sin_proveedor": 3,
  "por_proveedor": [ { "proveedor": { "id": 4, "nombre": "Rodamientos André" }, "compras": 3, "importe": 500000.00 } ],
  "filas": [
    {
      "fecha": "2026-11-10",
      "proveedor": { "id": 4, "nombre": "Rodamientos André" },
      "comprobante": "A-0001-00001234",
      "repuesto": { "id": 12, "codigo": "RUL-6204", "nombre": "Rulemán 6204" },
      "descripcion": null,
      "cantidad": 100, "unidad": "unidad",
      "costo_unitario": 5000.00, "importe": 500000.00,
      "origen": { "tipo": "STOCK", "intervencion": null }
    }
  ]
}
```

- **`origen.tipo`:** `STOCK` si entró al stock, o `INTERVENCION` si fue un pedido recibido sin stock. Con `intervencion: { id, maquina: { id, codigo } }` cuando vino de un pedido.
- **Una compra sin costo:** `costo_unitario` e `importe` en `null`. No suma al total y se cuenta en `sin_costo`.
- **El orden de `filas`:** fecha, de la más nueva a la más vieja, y después el id.
- **El orden de `por_proveedor`:** importe, de mayor a menor. Un pedido sin proveedor va como "Sin proveedor".

---

## 6. Pantallas (segundo commit)

### 6.1 Cargar un pedido

**Después de guardar un pedido,** si la intervención está en proceso y el usuario puede "Esperar repuestos", se abre el `ModalEsperaRepuestos` que ya existe, con:
- **arriba,** "Cargaste un pedido. ¿La intervención queda esperando este repuesto?";
- **si la máquina está parada por esta intervención,** "La máquina va a figurar como Detenida mientras se espera";
- **la observación precargada:** "Esperando: Rulemán 6204 × 4 (pedido N.º 18)";
- **los botones** "Sí, esperar" y "No, sigue en proceso".

No hay endpoint nuevo: es la misma acción de hoy. Para esto, `componentes/acciones/ModalEsperaRepuestos.tsx` suma **props opcionales**: el texto de arriba, el aviso de la máquina, la observación precargada y los textos de los botones. Sin ellas, se ve y funciona exactamente como hoy.

### 6.2 Recibir un pedido

El `ModalRecibirPedido` queda así:

| Campo | Cuándo aparece |
| :--- | :--- |
| ¿Cuándo llegó? | Siempre, como hoy. |
| Comprobante (factura o remito) | Siempre. |
| Costo unitario | Siempre, si el usuario puede cargar costos. Precargado con el costo actual del repuesto, si lo tiene. |
| Ingresar al stock | Si el repuesto lleva stock, como hoy. |
| **Usar en esta intervención** | Si la intervención está en proceso o esperando repuestos. **Marcado por omisión.** |
| Cantidad a usar | Con "Usar" marcado. Con stock: editable hasta lo recibido. Sin stock: fija. |
| Repuesto del catálogo | Con "Usar" marcado en un pedido de texto libre: un `Select` para elegirlo, obligatorio. Con permiso, un "Nuevo repuesto" al lado. |

- **Con "Usar" marcado y un repuesto con stock,** "Ingresar al stock" queda marcado y no se puede desmarcar, con la ayuda "Para usarlo, primero entra al stock".
- **Debajo, una línea que resume lo que va a pasar,** por ejemplo:
  - "Entran 10 al stock y se usan 4 en esta intervención. Quedan 6 en stock."
  - "Se usa en esta intervención: 1 × $ 85.000,00."

### 6.3 Después de recibir

**Si la respuesta dice `intervencion_estado` = `EN_ESPERA_REPUESTOS` y `pedidos_abiertos` = 0,** se abre el `ModalReanudar` que ya existe, con:
- **arriba,** "Llegó lo último que faltaba. ¿Reanudar la intervención?";
- **los botones** "Reanudar" y "Todavía no".

`componentes/acciones/ModalReanudar.tsx` suma props opcionales para esos textos, con el mismo criterio que la 6.1.

### 6.4 La lista de pedidos de la intervención

- **Un pedido recibido y usado** muestra "Usado: 4 de 10", con un enlace al uso en el bloque de repuestos.
- **El comprobante y el costo,** si el usuario puede verlos.

### 6.5 Finalizar con pedidos abiertos

**En `ModalFinalizar`, si quedan pedidos pendientes o pedidos,** un aviso amarillo: "Quedan 2 pedidos sin recibir. Quedan abiertos: podés cancelarlos desde Pedidos." No frena (D5).

---

## 7. Pestaña "Compras" en Reportes (segundo commit)

- **Una pestaña nueva, "Compras",** visible solo con los permisos de D6.
- **Filtros:** el período, como las otras pestañas, más el proveedor. Sin planta ni sector: una compra para stock no es de ningún sector.
- **Arriba, tres tarjetas:**
  - el total comprado;
  - la cantidad de compras;
  - el proveedor con más importe.
- **Si hay compras sin costo,** un aviso: "1 compra sin costo: no suma al total".
- **Si hay ingresos sin proveedor,** una línea chica: "3 ingresos sin proveedor no se cuentan como compra".
- **Tabla "Por proveedor",** y debajo **tabla "Detalle"**, con:
  - fecha, proveedor y comprobante;
  - repuesto o descripción, cantidad, costo unitario e importe;
  - origen: "Stock", o "Intervención N.º X · PIN-01", con enlace.
- **"Descargar CSV",** como en las otras pestañas.
- **El celular** no muestra esta pestaña: el resumen de la A2 no cambia.

**La lógica va en un archivo nuevo, `lib/compras.ts`,** porque `lib/reportes.ts` ya tiene 813 líneas. Con pruebas FE desde **FE-144**:
- cuándo preguntar por la espera (6.1);
- cuándo ofrecer reanudar (6.3);
- el texto que resume la recepción (6.2);
- las filas del CSV de compras.


---

## 8. Pruebas de la API y decisión (primer commit)

En `backend/tests/pedidos_compras.test.ts`, con el script `test:pedidos-compras`. Siguen el patrón de C2 (`clienteSano`) y limpian lo que crean.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| PC-01 | Recibir sin campos nuevos | Igual que hoy: el mismo resultado y los mismos movimientos. |
| PC-02 | Con stock: recibe 10, `ingresar_stock`, usa 4, con costo y comprobante | Un ingreso de 10 con comprobante y costo; un egreso de 4; un uso de 4 al costo nuevo; el stock sube 6; el costo de la intervención sube 4 × costo; el pedido tiene `consumo_id`. |
| PC-03 | Con stock y `usar`, sin `ingresar_stock` | 422, y no cambia nada. |
| PC-04 | Con stock: usar 11 de 10, y usar 0 | 422 en los dos, y no cambia nada. |
| PC-05 | Sin stock: recibe 2 a $85.000 y los usa | Uso de 2 a $85.000; el pedido guarda costo y comprobante; sin movimientos de stock. |
| PC-06 | Sin stock: usar 1 de 2 | 422. |
| PC-07 | Texto libre: `usar` sin `repuesto_id`; con `repuesto_id`; `repuesto_id` en un pedido que ya tiene repuesto | 422 `PEDIDO_SIN_REPUESTO`; se asocia y se usa; 422 `DATOS_INVALIDOS`. |
| PC-08 | `usar` con la intervención finalizada, y con una cancelada | 409 `ESTADO_NO_PERMITE_REPUESTOS`. Sin `usar`, se recibe igual. |
| PC-09 | El uso falla (repuesto inactivo) | No se recibe nada: el pedido sigue abierto y el stock no cambia. |
| PC-10 | `costo_unitario` sin permiso de costos | 403, como hoy. |
| PC-11 | `pedidos_abiertos` | Con dos pedidos abiertos, recibir uno da 1, y el segundo da 0. |
| PC-12 | Anular el uso que vino de un pedido | El stock vuelve y el pedido sigue recibido. |
| PC-13 | Compras: ingreso manual con proveedor, ingreso sin proveedor, pedido con stock, pedido sin stock y uno sin costo | Cuentan el primero, el tercero, el cuarto y el sin costo; el segundo va en `ingresos_sin_proveedor`. El pedido con stock aparece una sola vez. Total y `por_proveedor` correctos. |
| PC-14 | Compras: permisos y filtros | Sin `COSTOS_VER` o con alcance de sector: 403. El filtro por proveedor y el período funcionan. |
| PC-15 | Concurrencia | Dos recepciones a la vez del mismo pedido: una se recibe, y la otra da 409 `PEDIDO_CERRADO`. Hay un solo ingreso y un solo uso. |

**En `docs/decisiones.md`, la D-029 — Pedidos y compras,** con las decisiones de la sección 1 y su motivo:
- compras y costo de mantenimiento son dos números distintos;
- qué cuenta como compra;
- usar al recibir;
- lo que no es este reporte.

**En `docs/alcance.md`:** se suma "Reporte de compras", hecho en PC1.

---

## 9. Cierre e informe

**Criterios de cierre:**
1. Las secciones 3 a 8 están hechas, en dos commits que compilan solos.
2. Las pruebas de la regla 3 en verde, en Neon.
3. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:
1. Los dos hashes.
2. La salida final de cada suite de la regla 3.
3. Typecheck y build.
4. Las líneas de los archivos nuevos o tocados del front.
5. Desvíos y dudas.

**El recorrido en pantalla lo hace el revisor.**
