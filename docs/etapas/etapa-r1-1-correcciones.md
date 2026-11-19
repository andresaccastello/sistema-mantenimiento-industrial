# Etapa R1.1 — Correcciones de repuestos y stock

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `dcdc22c` (Etapa R1).
> **Origen:** revisión de la R1 con el sistema levantado en mi base local.
>
> - `test:todo` en mi base: 398 de 398, con los quince números en 0. La huella de la base, sin cambios ajenos.
> - La migración 016, aplicada dos veces sobre una copia como la principal: sin errores.
> - Ataques a la API con 25 intentos simultáneos por caso, y recorrido con Playwright a 1440×900 y 390×844.

**Lo que funciona y no se toca:**

- **La F5.1:** la respuesta promedio en Tiempos, el tipo con su nombre, el sector, y el nombre del CSV del mes anterior.
- **R3, bloque de repuestos:** registrar un consumo, anularlo con devolución al stock, el total y el aviso "Vuelven 2 al stock".
- **R3, bloque de pedidos:** el alta del pedido y la recepción con ingreso al stock, también desde la pestaña Pedidos.
- **D1:** la pestaña Repuestos, con sus tarjetas, las dos tablas y el CSV.
- **API:** permisos y costos ocultos.
- **Celular:** sin desborde en ninguna pantalla nueva.
- **Consola:** sin avisos.

**Lo grave está en la sección 1:** la pantalla de repuestos lee campos que la API no manda. El stock sale siempre "—", los movimientos manuales dan 404, y el detalle se rompe entero en cuanto el repuesto tiene un uso.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias.
2. **Dos commits:**
   1. secciones 2 a 8: `fix(api): detalles de repuestos y stock`;
   2. secciones 1, 9 y 10: `fix(front): pantallas de repuestos con la respuesta real de la API`.
3. **Pruebas existentes:** solo se pueden cambiar M16-07 (sección 7). Todas las demás quedan como están.
4. **No correr `test:todo`:** va en la corrida de la noche.
5. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-r1-1-correcciones.md`.

---

## 1. El frontend lee una API que no existe (grave)

Los tipos de repuestos de `frontend/src/api/tipos.ts` no son los de la respuesta. Los componentes los siguen, y en algunos lugares usan `any` o tipos propios. Las pruebas del frontend no lo ven, porque solo prueban `lib/`.

| Dónde | Lee | La API manda | Efecto |
| :--- | :--- | :--- | :--- |
| Lista, detalle y opciones de `ModalConsumo` | `stock_actual` | `cantidad_disponible` | El stock sale siempre "— unidad", y el diálogo de consumo no controla el máximo. |
| Movimientos | `creado_en`, `creado_por`, `intervencion.id`, `stock_anterior` | `realizado_en`, `realizado_por`, `intervencion_id` | Fecha "—", usuario vacío, sin enlace a la intervención. |
| **Ingreso, Egreso y Ajuste** | `POST /api/repuestos/:id/ingreso`, `/egreso` y `/ajuste`, con `motivo` | `POST /api/repuestos/:id/movimientos`, con `tipo`, y el motivo en `observacion` | **404: no se puede registrar ningún movimiento.** Además, el diálogo pide 3 caracteres de motivo y la API, 5. |
| **Pestaña Usos** | `u.intervencion.maquina.codigo` | `maquina` aparte, en el primer nivel, y `consumo_id` | **"Cannot read properties of undefined (reading 'codigo')": la pantalla queda en blanco** en cuanto el repuesto tiene un uso. |
| Pestaña Costos | `costo`, `usuario`, `creado_en` | `costo_unitario`, `registrado_por`, `registrado_en` | Costo, usuario y fecha vacíos. |
| Lista de repuestos y de proveedores | `pedidos_abiertos` | No viene: está solo en el detalle | `undefined` donde se use. |

**Corrección:**

1. **Tipos.** Reescribir los tipos de repuestos, proveedores, movimientos, usos, costos, consumos, pedidos y del reporte de repuestos según las secciones 4.3 y 5.1 a 5.4 de la R1. **Las respuestas reales están en el anexo:** las capturé de la API con datos de prueba. Un tipo por forma de respuesta, sin campos opcionales que la API no manda.
2. **Prueba de contrato:** `frontend/src/api/contrato-repuestos.test.ts`.
   - Cada objeto del anexo se copia **tal cual**, como constante con su tipo: `const fila: RepuestoFila = { … }`. Sin `as`, sin `any`, sin `...` y sin tocar los valores.
   - `npm run typecheck` falla si un tipo tiene un campo que la API no manda, o si le falta uno que manda. **Eso es lo que buscamos.**
   - Además, FE-55 (sección 10).
3. **Componentes.** En `componentes/repuestos/`, `DetalleRepuesto.tsx`, `Repuestos.tsx` y `TabReporteRepuestos.tsx`:
   - todo dato de la API usa esos tipos: `clienteApi.get<Tipo>(…)` siempre con su tipo;
   - nada de `any` ni de tipos escritos a mano para respuestas. Solo se permite `catch (err: unknown)`.
4. **Movimientos manuales.** `ModalMovimiento` arma el cuerpo con una función pura nueva, `cuerpoMovimiento(tipo, campos)`, en `lib/repuestos.ts` (FE-56), y lo manda a `POST /api/repuestos/:id/movimientos`:
   - ingreso: `{ tipo: 'INGRESO', cantidad, costo_unitario?, proveedor_id?, comprobante?, observacion? }`;
   - egreso: `{ tipo: 'EGRESO', cantidad, observacion }`;
   - ajuste: `{ tipo: 'AJUSTE', cantidad_contada, observacion }`.

   El motivo pide al menos 5 caracteres, con el mismo mensaje que en el resto: "Ingresá un motivo de al menos 5 caracteres.".
5. **Detalle:** el stock sale de `cantidad_disponible`; los movimientos, usos y costos, de sus campos reales. Con `maquina` en el primer nivel, la pestaña Usos no puede romperse.

---

## 2. El importe no coincide con el total de la intervención

El importe de cada consumo se calcula en JavaScript, con `toFixed(2)`. El costo de la intervención y el reporte, en SQL, con `ROUND`. Redondean distinto en los casos de medio centavo:

| Consumo | Importe en R3 | En la base y en el reporte |
| :--- | :-: | :-: |
| 0,5 × 2,01 | $ 1,00 | $ 1,01 |
| 1,5 × 0,03 | $ 0,04 | $ 0,05 |
| Total de los dos | **$ 1,04** | **$ 1,06** |

**Corrección:**

- el importe sale siempre de SQL, `ROUND(cantidad * costo_unitario_aplicado, 2)`, en todas las respuestas: consumos (`GET`, `POST` y anular) y usos del repuesto;
- `total_repuestos` es el `costo_repuestos` de la intervención.

**RI-20:** esos dos consumos dan importes 1,01 y 0,05. `total_repuestos`, `costo_repuestos` y el `importe_total` del reporte dan los tres 1,06.

---

## 3. La cantidad en el texto de la auditoría

- Al anular, el texto usa la cantidad como la devuelve `pg`: "Se anuló: Aceite × **2.000** litro". En castellano se lee "dos mil".
- Al registrar, usa el número de JavaScript: "× 1.5".

**Corrección:** una función del backend, `formatearCantidad`, en `backend/functions/repuestos/`, que escriba como `formatCantidad` del frontend:

- 2 → "2";
- 1.5 → "1,5";
- 1234.25 → "1.234,25";
- 0.125 → "0,125".

Se usa en los dos textos.

**RI-21:**

- en una intervención finalizada, registrar 1,5 da "Se agregó: … × 1,5 litro";
- anular uno de 2 da "Se anuló: … × 2 litro".

---

## 4. Ids y booleanos mal validados

| Envío | Hoy |
| :--- | :--- |
| `repuesto_id: true` en un consumo | **201: consumió el repuesto 1**, que es de otra prueba. |
| `repuesto_id: 1.5` | 500 |
| `GET /api/repuestos/1.5` | 500 |
| Recibir con `ingresar_stock: "false"` (texto) | **Ingresó al stock.** |
| Editar con `lleva_stock: "false"` (texto) | Quedó en `true`. |

**Corrección**, en todas las rutas nuevas de la R1:

- un id del cuerpo tiene que ser un entero positivo (`Number.isInteger`). Si no: 422, con el código de ese campo (`REPUESTO_INVALIDO`, `PROVEEDOR_INVALIDO` o `DATOS_INVALIDOS`). En un consumo, `repuesto_id` inválido da 422 `DATOS_INVALIDOS`;
- un id de la ruta que no es un entero positivo da el 404 del recurso;
- `lleva_stock`, `activo` e `ingresar_stock` tienen que ser booleanos de verdad. Si no: 422 `DATOS_INVALIDOS`.

**Pruebas:**

- **RE-10:** en repuestos y proveedores, los ids de ruta `1.5` y `abc` dan 404, y `lleva_stock: "false"` y `activo: 1` dan 422.
- **RI-22:** `repuesto_id` con `true`, `1.5` y `"7"` dan 422; `ingresar_stock: "false"` da 422 y el stock no cambia.

---

## 5. Concurrencia

Corrí cada caso 25 veces, con las dos llamadas a la vez:

| Caso | Resultado |
| :--- | :--- |
| Desactivar un repuesto y un ingreso | **20 de 25 quedaron inactivos con stock.** |
| Desactivar un repuesto y el alta de un pedido | **6 de 25 quedaron inactivos con un pedido abierto.** |
| Desactivar un repuesto y editar su ubicación | **10 de 25 quedaron activos, aunque el `DELETE` respondió 200.** El `PUT` escribe todas las columnas que leyó antes. |
| Dejar de llevar stock y un ingreso (15 intentos) | 8 respuestas 500: lo frena la restricción de la base. |
| Dos proveedores con el mismo nombre | Uno 201 y otro **500**. |
| Dos repuestos con el mismo código | Uno 201 y otro **500**. |

`DELETE` y `PUT` leen el repuesto sin bloquearlo, deciden, y escriben después.

**Corrección:**

- **`DELETE` y `PUT` de repuestos y de proveedores:** en una transacción, primero `SELECT … FOR UPDATE` de la fila. Los controles y la escritura usan esa lectura.
- **Quien da de alta o edita un pedido**, o da de alta o edita un repuesto con un proveedor, lee el repuesto y el proveedor con `FOR SHARE`, en la misma transacción. Así espera a una baja en curso, y la baja lo espera a él.
- **Los movimientos y los consumos** ya bloquean el repuesto con `FOR UPDATE`: con el cambio de arriba quedan en fila con la baja.
- **Un nombre o un código repetido que se cuela** (violación de `uq_proveedores_nombre` o de `uq_repuestos_codigo`): 409 `NOMBRE_DUPLICADO` o `CODIGO_DUPLICADO`, no 500.

**RE-11:** 10 intentos de cada caso de la tabla. Esperado: ningún repuesto inactivo con stock o con pedido abierto, ninguno reactivado, y ningún 500.

---

## 6. La respuesta del `POST` de consumo

`registrado_por` sale de los datos de la sesión: `{ "nombre": "", "apellido": null }`. En el `GET`, el mismo consumo dice "Responsable Demo".

**Corrección:** el `POST` responde el consumo con el mismo formato y los mismos datos que el `GET`. Se verifica en RI-21.

---

## 7. La migración 016 deshace cambios al reaplicarse

Es el mismo problema de la sección 3 de la N1.1. Lo probé en una copia:

1. dos repuestos con proveedor de texto, "Casa Uno" y "Otra Casa";
2. después, el usuario le saca el proveedor al primero y renombra "Otra Casa" a "Otra Casa SRL";
3. reaplicar la 016 **vuelve a ponerle "Casa Uno" al primero y crea otra vez "Otra Casa".**

**Corrección:**

- el paso 7.1 de la migración, las dos partes, considera solo los repuestos con `proveedor_id IS NULL`;
- la API, cada vez que escribe `proveedor_id` en un repuesto (alta o edición, incluido `null`), deja `proveedor` (el texto viejo) en `NULL`. El dato ya está en `proveedores`.

La 016 todavía no está en la base principal, así que se puede editar.

**Pruebas:**

- **M16-07 se amplía**, dentro de su `ROLLBACK`:
  - renombrar el proveedor y reaplicar: no se crea otro;
  - dejar un repuesto con `proveedor_id` y `proveedor` en `NULL`, como lo deja la API, y reaplicar: sigue sin proveedor.
- **RE-12:** un repuesto con texto viejo (cargado por SQL) y `PUT` con `proveedor_id: null`: el texto viejo queda en `NULL`.

---

## 8. Detalles de la API

**`GET /:id/repuestos` y `GET /:id/pedidos` bloquean filas para leer.** Usan `bloquearIntervencion`, que hace `SELECT … FOR UPDATE` de la máquina y de la intervención, fuera de una transacción.

**Corrección:** controlar la visibilidad sin bloquear, como el `GET /api/intervenciones/:id`.

---

## 9. Detalles del frontend

1. **Los botones ⋮ no tienen nombre accesible:** el de cada consumo y el de cada pedido de R3, y los del detalle y de las pestañas. Agregar `aria-label`: "Acciones del consumo", "Acciones del pedido", etcétera.
2. **El importe se parte en dos líneas en R3:** "$" arriba y "2.469,00" abajo. Las columnas de dinero van sin corte de línea.
3. **`ModalProveedor`:** `EMAIL_INVALIDO` sale solo como aviso rojo. Va en el campo Email, como `NOMBRE_DUPLICADO` en Nombre.
4. **`ModalDesactivarElemento`:** la rama nueva de `EN_USO` corre para todos los tipos. Para plantas, sectores y catálogos pierde el mensaje del servidor y dice solo "No se puede desactivar.". Va solo para `proveedor` y `repuesto`.
5. **Después de registrar o anular un consumo,** invalidar también `['repuesto']`. Hoy el detalle del repuesto queda con el stock viejo.

---

## 10. Pruebas del frontend

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| (typecheck) | `api/contrato-repuestos.test.ts` | Compila con los objetos del anexo copiados tal cual. |
| FE-55 | Contrato en uso | Con los objetos del anexo:<br>• `formatCantidad(fila.cantidad_disponible)` da "10";<br>• `textoMovimiento` del movimiento del `POST` da "Ingreso" y "+1";<br>• `infoPedido` del pedido recibido da "Recibido";<br>• `filasReporteRepuestos` del reporte da la fila "ZZR1-001 · ZZR1 Rodamiento de prueba" con importe 2469. |
| FE-56 | `cuerpoMovimiento` | Los tres cuerpos de la sección 1.4, exactos. Sin `motivo`. |

---

## 11. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 10 están hechas, en dos commits.
2. En verde, en Neon: `test:migration-016`, `test:repuestos` y `test:repuestos-intervenciones`.
3. `npm run test:front`, `npm run typecheck` y `npm run build:frontend` sin errores.
4. Push en `feat/base-neon`.

**Informe corto:**

1. Los dos hashes.
2. La salida final de las suites del punto 2 y de `test:front`.
3. Typecheck y build.
4. La salida de `wc -l` de `DetalleIntervencion.tsx`, `DetalleRepuesto.tsx` y de cada archivo de `componentes/repuestos/`, **pegada tal cual**. En el informe de la R1, `DetalleIntervencion.tsx` decía 491 líneas y tiene 524; `DetalleRepuesto.tsx` decía 452 y tiene 477.
5. Desvíos.
6. Dudas.

---

## Anexo: respuestas reales de la API

Capturadas de la API de la R1 con datos de prueba. Se copian tal cual en `contrato-repuestos.test.ts` (sección 1.2). Donde dice "un elemento", es un elemento del arreglo que devuelve la ruta.

```json
{
  "POST /api/repuestos/:id/movimientos": {
    "movimiento": {
      "id": 82, "tipo": "INGRESO", "cantidad": 1, "delta": 1, "stock_resultante": 10, "costo_unitario": 1300,
      "proveedor": { "id": 13, "nombre": "ZZR1 Ferretería Prueba" },
      "comprobante": "R-0001", "observacion": null, "intervencion_id": null,
      "realizado_por": { "id": 557, "nombre": "Administradora", "apellido": "Segunda" },
      "realizado_en": "2026-11-06T11:36:01.115Z"
    },
    "repuesto": {
      "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad", "lleva_stock": true,
      "cantidad_disponible": 10, "stock_minimo": 3, "estado_stock": "OK", "costo_unitario": 1300,
      "proveedor": { "id": 13, "nombre": "ZZR1 Ferretería Prueba", "activo": true },
      "ubicacion": "Estante A3", "activo": true, "descripcion": null,
      "creado_en": "2026-11-06T11:29:40.114Z", "actualizado_en": "2026-11-06T11:36:01.115Z",
      "pedidos_abiertos": 0, "consumos_vigentes": 1
    }
  },
  "GET /api/repuestos (un elemento)": {
    "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad", "lleva_stock": true,
    "cantidad_disponible": 10, "stock_minimo": 3, "estado_stock": "OK", "costo_unitario": 1300,
    "proveedor": { "id": 13, "nombre": "ZZR1 Ferretería Prueba", "activo": true },
    "ubicacion": "Estante A3", "activo": true
  },
  "GET /api/repuestos/opciones (un elemento)": {
    "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad", "lleva_stock": true,
    "cantidad_disponible": 10, "costo_unitario": 1300
  },
  "GET /api/repuestos/:id": {
    "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad", "lleva_stock": true,
    "cantidad_disponible": 10, "stock_minimo": 3, "estado_stock": "OK", "costo_unitario": 1300,
    "proveedor": { "id": 13, "nombre": "ZZR1 Ferretería Prueba", "activo": true },
    "ubicacion": "Estante A3", "activo": true, "descripcion": null,
    "creado_en": "2026-11-06T11:29:40.114Z", "actualizado_en": "2026-11-06T11:36:01.115Z",
    "pedidos_abiertos": 0, "consumos_vigentes": 1
  },
  "GET /api/repuestos/:id/movimientos (un elemento)": {
    "id": 81, "tipo": "INGRESO", "cantidad": 3, "delta": 3, "stock_resultante": 9, "costo_unitario": null,
    "proveedor": null, "comprobante": null, "observacion": "Pedido N.º 20 de la intervención N.º 4509",
    "intervencion_id": 4509,
    "realizado_por": { "id": 557, "nombre": "Administradora", "apellido": "Segunda" },
    "realizado_en": "2026-11-06T11:33:10.865Z"
  },
  "GET /api/repuestos/:id/usos (un elemento)": {
    "consumo_id": 96,
    "intervencion": { "id": 4509, "estado": "EN_PROCESO" },
    "maquina": { "id": 759, "codigo": "MEC-03", "nombre": "Rectificadora plana" },
    "cantidad": 2, "costo_unitario_aplicado": 1234.5, "importe": 2469,
    "registrado_en": "2026-11-06T11:32:58.829Z", "anulado": false
  },
  "GET /api/repuestos/:id/costos (un elemento)": {
    "id": 127, "costo_unitario": 1300, "origen": "INGRESO",
    "registrado_por": { "id": 557, "nombre": "Administradora", "apellido": "Segunda" },
    "registrado_en": "2026-11-06T11:36:01.115Z"
  },
  "GET /api/proveedores (un elemento)": {
    "id": 13, "nombre": "ZZR1 Ferretería Prueba", "contacto": null, "telefono": null,
    "email": "ventas@ejemplo.com", "notas": null, "activo": true, "repuestos_activos": 1
  },
  "GET /api/proveedores/opciones (un elemento)": { "id": 13, "nombre": "ZZR1 Ferretería Prueba" },
  "GET /api/intervenciones/:id/repuestos": {
    "consumos": [
      {
        "id": 95,
        "repuesto": { "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad" },
        "cantidad": 2, "costo_unitario_aplicado": 1234.5, "importe": 2469, "observacion": null,
        "registrado_por": { "id": 552, "nombre": "Responsable", "apellido": "Demo" },
        "registrado_en": "2026-11-06T11:31:40.073Z", "movimiento_id": 78, "movio_stock": true,
        "anulado": true,
        "anulado_por": { "id": 552, "nombre": "Responsable", "apellido": "Demo" },
        "anulado_en": "2026-11-06T11:33:01.694Z", "motivo_anulacion": "No se llegó a usar"
      }
    ],
    "total_repuestos": 2469, "ve_costos": true, "puede_registrar": true, "puede_anular": true
  },
  "GET /api/intervenciones/:id/pedidos": {
    "pedidos": [
      {
        "id": 20, "intervencion_id": 4509,
        "repuesto": { "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad", "lleva_stock": true },
        "descripcion": null, "cantidad": 3, "proveedor": null, "estado": "RECIBIDO",
        "pedido_en": null, "esperado_para": null, "recibido_en": "2026-11-06T11:33:10.869Z",
        "observacion": null, "motivo_cancelacion": null, "ingreso_stock": true,
        "creado_por": { "id": 552, "nombre": "Responsable", "apellido": "Demo" },
        "creado_en": "2026-11-06T11:33:05.012Z", "actualizado_en": "2026-11-06T11:33:10.865Z"
      }
    ],
    "puede_crear": true, "puede_gestionar": true
  },
  "GET /api/pedidos-repuesto (un elemento)": {
    "id": 20, "intervencion_id": 4509,
    "repuesto": { "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad", "lleva_stock": true },
    "descripcion": null, "cantidad": 3, "proveedor": null, "estado": "RECIBIDO",
    "pedido_en": null, "esperado_para": null, "recibido_en": "2026-11-06T11:33:10.869Z",
    "observacion": null, "motivo_cancelacion": null, "ingreso_stock": true,
    "creado_por": { "id": 552, "nombre": "Responsable", "apellido": "Demo" },
    "creado_en": "2026-11-06T11:33:05.012Z", "actualizado_en": "2026-11-06T11:33:10.865Z",
    "intervencion": { "id": 4509, "estado": "EN_PROCESO", "descripcion": "Vibra la mesa al bajar el cabezal" },
    "maquina": { "id": 759, "codigo": "MEC-03", "nombre": "Rectificadora plana" },
    "sector": { "id": 101, "nombre": "Mecanizado" }
  },
  "GET /api/reportes/repuestos": {
    "desde": "2026-10-07T11:36:01.182Z", "hasta": "2026-11-06T11:36:01.182Z", "ve_costos": true,
    "consumos": 1, "intervenciones": 1, "importe_total": 2469,
    "por_repuesto": [
      {
        "repuesto": { "id": 187, "codigo": "ZZR1-001", "nombre": "ZZR1 Rodamiento de prueba", "unidad": "unidad" },
        "cantidad": 2, "consumos": 1, "intervenciones": 1, "importe": 2469
      }
    ],
    "por_maquina": [
      {
        "maquina": { "id": 759, "codigo": "MEC-03", "nombre": "Rectificadora plana" },
        "sector": { "id": 101, "nombre": "Mecanizado" },
        "consumos": 1, "importe": 2469
      }
    ]
  }
}
```
