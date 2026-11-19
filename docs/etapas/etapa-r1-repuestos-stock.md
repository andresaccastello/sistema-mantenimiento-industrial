# Etapa R1 — Repuestos, stock y pedidos

> **Estado:** requerimiento para implementar. **Se hace de noche, sin nadie para responder** (sección 0, regla 2).
> **Requisito previo:** commit `b7a3885` (Etapa F5).
> **Base:**
>
> - `docs/relevamiento-requisitos-derivados.md`, requisitos 1, 2 y 3: catálogo de proveedores, seguimiento de repuestos pedidos y control de stock opcional;
> - `docs/analisis-intervenciones.md`: RN-41, RN-46, 7.3, 10.3, E4 y D-20;
> - las tablas de la migración 001: `repuestos`, `movimientos_stock` e `intervencion_repuestos`.
>
> **Para qué:**
>
> - saber qué repuestos hay, cuánto cuestan y dónde se usaron;
> - que el costo de repuestos de cada intervención salga solo de lo usado;
> - seguir los pedidos mientras la máquina espera, que según el relevamiento es la mayor causa de demora.
>
> **Empieza con las correcciones de la F5** (sección 1), que salieron de la revisión.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias.
2. **Trabajo sin supervisión.**
   - **Ante una duda que no pone en riesgo datos ni pruebas ajenas:** elegir la opción más simple que respete este documento, anotarla como desvío en el informe y seguir.
   - **Frenar y dejarlo anotado, sin seguir con esa parte,** solo si para avanzar hubiera que:
     - cambiar el esquema fuera de la migración 016;
     - modificar una prueba existente que no esté en la regla 4;
     - tocar algo fuera de lo pedido.
   - Si una parte queda frenada, seguir con las que no dependen de ella.
3. **Seis commits, en este orden:**

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1 | `fix(front): detalles de la pantalla de reportes` |
   | 2 | 2 y 3 | `feat(db): repuestos, stock y pedidos` |
   | 3 | 4 | `feat(api): repuestos, proveedores y movimientos de stock` |
   | 4 | 5 | `feat(api): repuestos y pedidos en la intervención, y reporte` |
   | 5 | 6 a 9 | `feat(front): pantalla de repuestos` |
   | 6 | 10 a 12 | `feat(front): repuestos y pedidos en la intervención, y reporte` |

4. **Pruebas:**
   - durante el trabajo, solo las del commit:
     - `test:front`;
     - `test:migration-016`, `test:repuestos` y `test:repuestos-intervenciones`, nuevas;
     - `test:etapa6`, porque E-06 carga repuestos a mano;
   - al terminar, la corrida de la noche (sección 14);
   - rige la regla de la F2.2: una prueba no borra ni modifica datos que no creó. Tampoco toca los repuestos que ya están en la base;
   - **pruebas existentes:** solo se pueden cambiar FE-04 (sección 9), FE-41 (sección 10.3) y FE-44 (sección 1.3). Ninguna del backend.
5. **Frontend:**
   - lo que está en `lib/` sigue siendo lógica pura;
   - ninguna pantalla nueva pasa de 500 líneas; las partes van en `componentes/repuestos/`;
   - `DetalleIntervencion.tsx` (512 líneas hoy) solo suma los dos bloques y sus imports.
6. **Sin datos reales.** En las pruebas, nombres genéricos: "Rodamiento RE", "Proveedor RI", etcétera.
7. **Todo cambio de stock pasa por `moverStock`** (sección 4.1). Ningún otro código hace `UPDATE` de `cantidad_disponible`.

Guardar este archivo como `docs/etapas/etapa-r1-repuestos-stock.md`.

---

## 1. Correcciones de la F5 (primer commit)

Revisé la F5 con el sistema levantado en mi base local:

- `test:todo` dio 359 de 359, con los once números en 0;
- los seis indicadores coinciden con un cálculo propio en SQL, en cuatro casos;
- las capturas a 1440×900 y 390×844 están bien, sin desborde y sin avisos en la consola.

Quedan estos cuatro detalles. **Solo frontend.**

### 1.1 "Respuesta promedio" siempre vacía en Tiempos

La API de tiempos manda `espera_promedio_minutos`. El tipo y `TabTiempos` leen `respuesta_promedio_minutos`, que no existe. Por eso la columna sale siempre "—", y en el CSV, vacía.

**Corrección:** en el tipo de las filas de tiempos y en `TabTiempos` (tabla y CSV), usar `espera_promedio_minutos`.

### 1.2 El tipo aparece con su código

Agrupando por tipo, el grupo dice "CORRECTIVO". Tiene que decir el nombre, "Mantenimiento correctivo".

**Corrección:** para el tipo, usar `tipo.nombre`. Para el sector, `sector.nombre`. En los dos casos, `grupo` solo como respaldo.

### 1.3 Las fechas del nombre del CSV

El nombre usa las fechas en UTC y el fin del período sin descontar:

- con "Mes anterior", la pantalla dice "al 31/10/2026" y el archivo, `…-a-2026-11-01.csv`;
- en Argentina, después de las 21, las dos fechas se corren un día.

**Corrección:** el nombre usa las mismas fechas locales que la línea "Del … al …", con el último día incluido. **FE-44 se amplía** con "Mes anterior" y con una hora de la noche.

### 1.4 Que no vuelva a pasar lo de 1.1

Pasar a `lib/reportes.ts` una función pura `filaTiempos(fila, agrupar)` que devuelva lo que muestra la tabla: grupo, cantidad y los cuatro tiempos. La usan la tabla y el CSV.

**FE-46:**

- con una fila de cada agrupación, **escrita igual que la respuesta real de la API**, incluidos `espera_promedio_minutos`, `tipo` y `sector`, sale el grupo con su nombre y la respuesta promedio con valor;
- con `ejecucion: null`, sale "Sin definir".

---

## 2. Migración 016 (segundo commit)

Archivo `database/migrations/016_repuestos_stock.sql`.

- Se puede aplicar varias veces, como la 015.
- No borra datos ni columnas.
- No agrega permisos: se usan los que ya existen.

### 2.1 `proveedores` (nueva)

| Columna | Tipo y regla |
| :--- | :--- |
| `id` | identidad |
| `nombre` | `varchar(150)` obligatorio. **Único sin distinguir mayúsculas ni espacios de los extremos:** índice único sobre `lower(trim(nombre))`. |
| `contacto` | `varchar(150)` nulo |
| `telefono` | `varchar(40)` nulo. Texto libre: no es el de WhatsApp. |
| `email` | `varchar(254)` nulo, con el mismo `CHECK` de formato que `usuarios.email` |
| `notas` | `text` nulo |
| `activo` | `boolean`, `true` por omisión |
| `creado_en`, `actualizado_en` | `timestamptz`, `now()` |

Es un solo catálogo para las dos cosas del requisito 1: dónde comprar repuestos y, más adelante, quién hizo un trabajo externo.

### 2.2 `repuestos`: columnas nuevas

| Columna | Tipo y regla |
| :--- | :--- |
| `codigo` | `varchar(40)` nulo. Único cuando no es nulo, sin distinguir mayúsculas: índice único parcial sobre `upper(trim(codigo))`. |
| `unidad` | `varchar(20)`, `'unidad'` por omisión, no vacía |
| `lleva_stock` | `boolean`, `true` por omisión |
| `stock_minimo` | `numeric(14,3)` nulo, mayor o igual a 0 |
| `proveedor_id` | FK a `proveedores`, nulo. Es el proveedor habitual. |
| `ubicacion` | `varchar(100)` nulo |
| `descripcion` | `text` nulo |

**Restricción nueva:** `lleva_stock OR (cantidad_disponible = 0 AND stock_minimo IS NULL)`. Un repuesto sin control de stock no tiene stock ni mínimo.

La columna vieja `proveedor` (texto) queda sin uso, con un `COMMENT` que lo diga.

### 2.3 `repuesto_costos` (nueva): historial de costos

| Columna | Tipo y regla |
| :--- | :--- |
| `id` | identidad |
| `repuesto_id` | FK a `repuestos`, **`ON DELETE CASCADE`**. La aplicación nunca borra repuestos; el cascade evita que una limpieza de pruebas, como la de E-06, falle por el historial. |
| `costo_unitario` | `numeric(14,2)`, mayor o igual a 0 |
| `origen` | `varchar(12)`: `MIGRACION`, `ALTA`, `EDICION`, `INGRESO` o `CONSUMO` |
| `registrado_por_usuario_id` | FK a `usuarios`, nulo solo si el origen es `MIGRACION` |
| `registrado_en` | `timestamptz`, `now()` |

Índice por `(repuesto_id, registrado_en)`. **No hay disparadores:** las filas las escribe la API (sección 4.1).

### 2.4 `movimientos_stock`: columnas nuevas

| Columna | Tipo y regla |
| :--- | :--- |
| `delta` | `numeric(14,3)` nulo. Cuánto cambió el stock, con signo. |
| `stock_resultante` | `numeric(14,3)` nulo, mayor o igual a 0 |
| `proveedor_id` | FK a `proveedores`, nulo |
| `comprobante` | `varchar(60)` nulo: remito o factura |

**Restricciones:**

- el tipo admite además `DEVOLUCION`;
- `delta` y `stock_resultante` son los dos nulos (filas viejas) o los dos no nulos;
- `delta` concuerda con el tipo:
  - `INGRESO` y `DEVOLUCION`: `delta = cantidad`;
  - `EGRESO`: `delta = −cantidad`;
  - `AJUSTE`: `abs(delta) = cantidad`.

Índice por `intervencion_id`.

### 2.5 `intervencion_repuestos`: columnas nuevas (los consumos)

| Columna | Tipo |
| :--- | :--- |
| `registrado_por_usuario_id` | FK a `usuarios`, **nulo** |
| `observacion` | `text` nulo |
| `movimiento_id` | FK a `movimientos_stock`, nulo: el egreso que generó |
| `anulado_en` | `timestamptz` nulo |
| `anulado_por_usuario_id` | FK a `usuarios`, nulo |
| `motivo_anulacion` | `text` nulo |
| `devolucion_movimiento_id` | FK a `movimientos_stock`, nulo: la devolución al anular |

**Restricción nueva:** los tres datos de anulación están todos o ninguno.

`registrado_por_usuario_id` queda nulo a propósito: E-06 inserta con solo las cuatro columnas de siempre y tiene que seguir andando. La API siempre lo completa.

### 2.6 `pedidos_repuesto` (nueva)

| Columna | Tipo y regla |
| :--- | :--- |
| `id` | identidad |
| `intervencion_id` | FK a `intervenciones`, obligatorio, `ON DELETE RESTRICT` |
| `repuesto_id` | FK a `repuestos`, nulo |
| `descripcion` | `varchar(200)` nulo. Para lo que no está en el catálogo. |
| `cantidad` | `numeric(14,3)`, mayor que 0 |
| `proveedor_id` | FK a `proveedores`, nulo |
| `estado` | `varchar(12)`: `PENDIENTE`, `PEDIDO`, `RECIBIDO` o `CANCELADO`; `PENDIENTE` por omisión |
| `pedido_en` | `date` nulo: el día en que se pidió |
| `esperado_para` | `date` nulo |
| `recibido_en` | `timestamptz` nulo |
| `observacion` | `text` nulo |
| `motivo_cancelacion` | `text` nulo |
| `movimiento_id` | FK a `movimientos_stock`, nulo: el ingreso al recibir |
| `creado_por_usuario_id` | FK a `usuarios`, obligatorio |
| `actualizado_por_usuario_id` | FK a `usuarios`, nulo |
| `creado_en`, `actualizado_en` | `timestamptz`, `now()` |

**Restricciones:**

- tiene `repuesto_id`, o una `descripcion` de al menos 3 caracteres sin contar espacios;
- `PEDIDO` tiene `pedido_en`; `RECIBIDO` tiene `recibido_en`; `CANCELADO` tiene `motivo_cancelacion`;
- `esperado_para` no es anterior a `pedido_en`.

Índices por `intervencion_id` y, parcial, por `estado` para `PENDIENTE` y `PEDIDO`.

### 2.7 Datos que ya existen

1. **Proveedores desde el texto viejo.** Por cada valor distinto de `repuestos.proveedor` (sin distinguir mayúsculas ni espacios de los extremos, sin vacíos) se crea un proveedor, si no existe ya. Después se completa el `proveedor_id` de esos repuestos. Reaplicar no duplica nada.
2. **Historial de costos inicial.** Cada repuesto que no tiene ninguna fila en `repuesto_costos` recibe una con su costo actual, origen `MIGRACION` y `registrado_en` igual a su `actualizado_en`.
3. **No se crean movimientos** para el stock que ya existe: la historia de cada repuesto empieza en su primer movimiento.

### 2.8 Control de la corrida

En `scripts/run-all-tests.mjs`, agregar a `TABLAS_CONTROL`: `proveedores`, `movimientos_stock`, `intervencion_repuestos` y `pedidos_repuesto`. Quedan 15.

### 2.9 Pruebas: `backend/tests/migration_016.test.ts`

Script `test:migration-016`. Las pruebas de restricciones van dentro de una transacción con `ROLLBACK`, como en la 015.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| M16-01 | Aplicar | Dos veces seguidas, sin error. |
| M16-02 | Estructura | Existen las tres tablas nuevas y las columnas nuevas de las secciones 2.2, 2.4 y 2.5. |
| M16-03 | `repuestos` y `proveedores` | Se rechazan:<br>• sin control de stock y con cantidad mayor que 0;<br>• sin control de stock y con mínimo;<br>• mínimo negativo;<br>• un código repetido con otras mayúsculas;<br>• un proveedor repetido con otras mayúsculas y espacios.<br>Dos repuestos sin código, en cambio, se aceptan. |
| M16-04 | `movimientos_stock` | • `DEVOLUCION` con `delta = cantidad` se acepta.<br>• Un `INGRESO` con `delta` negativo y un `EGRESO` con `delta` positivo se rechazan.<br>• `delta` sin `stock_resultante` se rechaza.<br>• `stock_resultante` negativo se rechaza.<br>• Una fila sin `delta` ni `stock_resultante` se acepta. |
| M16-05 | `intervencion_repuestos` | • Un `INSERT` con solo `intervencion_id`, `repuesto_id`, `cantidad` y `costo_unitario_aplicado` se acepta.<br>• `anulado_en` sin motivo se rechaza. |
| M16-06 | `pedidos_repuesto` | Se rechazan:<br>• sin repuesto y sin descripción;<br>• `PEDIDO` sin `pedido_en`;<br>• `CANCELADO` sin motivo;<br>• `esperado_para` anterior a `pedido_en`. |
| M16-07 | Proveedores desde el texto | Con `ROLLBACK`: dos repuestos con proveedor `' Casa Uno '` y `'casa uno'`, y reaplicar. Queda **un** proveedor, y los dos repuestos tienen su `proveedor_id`. Reaplicar otra vez no crea otro. |
| M16-08 | Historial inicial | Todo repuesto tiene al menos una fila en `repuesto_costos`. Reaplicar no cambia la cantidad de filas. |

---

## 3. Reglas: D-018 (segundo commit)

Agregar a `docs/decisiones.md`:

> ## D-018 — Repuestos, stock y pedidos
>
> **Estado:** Aceptada
>
> 1. **Proveedores:** un solo catálogo, para comprar repuestos y, más adelante, para los trabajos externos.
> 2. **Control de stock opcional por repuesto.** Si un repuesto no lleva stock, su uso y su costo se registran igual en la intervención, sin movimientos.
> 3. **El stock cambia solo con movimientos:**
>    - ingreso;
>    - egreso: manual con motivo, o por consumo en una intervención;
>    - ajuste a una cantidad contada, con motivo;
>    - devolución, al anular un consumo.
>
>    Cada movimiento guarda cuánto cambió y el stock que quedó. El stock nunca queda negativo.
> 4. **Costo:**
>    - el costo unitario de un repuesto es el último conocido: el del alta, una edición, un ingreso con costo o un consumo de un repuesto sin stock;
>    - cada cambio queda en un historial;
>    - el consumo guarda el costo del momento (RN-41). Un cambio posterior no lo modifica.
> 5. **Consumos en la intervención:**
>    - se registran en `EN_PROCESO` y `EN_ESPERA_REPUESTOS`;
>    - con la intervención `FINALIZADA`, solo con `INTERVENCIONES_CORREGIR` y motivo;
>    - no se editan: se anulan con motivo (si habían movido stock, vuelve con una devolución) y se cargan de nuevo.
> 6. **D-20, resuelta:** cancelar, reabrir o corregir una intervención no mueve stock. Lo que no se usó se anula a mano; con la intervención cancelada, con `INTERVENCIONES_CORREGIR`.
> 7. **Pedidos:** qué falta, cuánto, a quién se pidió, cuándo, para cuándo se espera y si llegó. Al recibir, se puede ingresar al stock en el mismo paso.
> 8. **Costos visibles:**
>    - los ve quien tiene `COSTOS_VER` o `REPUESTOS_GESTIONAR`;
>    - los carga quien tiene `REPUESTOS_GESTIONAR` o `COSTOS_REGISTRAR`.
> 9. **Reporte de repuestos:** consumos no anulados, por fecha de registro, de las máquinas visibles de la selección, activas o no: lo gastado en una máquina dada de baja sigue siendo gasto.

---

## 4. API: repuestos, proveedores y stock (tercer commit)

### 4.1 Archivos y funciones comunes

**Rutas nuevas:** `/api/proveedores`, `/api/repuestos` y, en el cuarto commit, `/api/pedidos-repuesto`. Cada una en su archivo de `backend/functions/`, con `use('*', jwtVerify, dbVerify)` como las demás, y montada en `api.ts`.

**Funciones comunes**, en `backend/functions/repuestos/`:

**`moverStock(client, { repuestoId, tipo, delta, usuarioId, intervencionId?, proveedorId?, comprobante?, costoUnitario?, observacion? })`.** Siempre dentro de una transacción.

1. `SELECT … FROM repuestos WHERE id = $1 FOR UPDATE`.
2. Sin control de stock: 409 `REPUESTO_SIN_CONTROL_STOCK`.
3. `nuevo = actual + delta`. Si da negativo: 409 `STOCK_INSUFICIENTE`, con `disponible` en la respuesta.
4. Inserta el movimiento con `cantidad = |delta|`, `delta` y `stock_resultante = nuevo`.
5. Actualiza `cantidad_disponible` y `actualizado_en`.
6. Devuelve el movimiento.

**`cambiarCosto(client, { repuestoId, costo, origen, usuarioId })`.** Si el costo es distinto del actual, lo actualiza y agrega la fila al historial. Si es igual, no hace nada.

**Permisos de costos:**

- `veCostos(usuario)`: `COSTOS_VER` o `REPUESTOS_GESTIONAR`. Sin esto, todo importe y costo de las respuestas va en `null`, nunca omitido.
- `puedeCargarCostos(usuario)`: `REPUESTOS_GESTIONAR` o `COSTOS_REGISTRAR`. Sin esto, mandar un costo da 403 `PERMISO_INSUFICIENTE`.

**`requireAlgunPermiso([...])`** en `middleware.ts`: como `requirePermission`, pero alcanza con uno de la lista.

**Números:**

- en las respuestas, los `numeric` van como número, no como texto;
- cantidades: mayores que 0, hasta 3 decimales, hasta 1.000.000;
- costos: desde 0, hasta 2 decimales, hasta 1.000.000.000;
- un número mandado como texto es inválido.

Un dato inválido da 422 `DATOS_INVALIDOS`, salvo que se indique otro código. En esta sección, primero se controlan los datos (422) y después el estado (409).

### 4.2 Proveedores: `/api/proveedores`

| Ruta | Permiso | Qué hace |
| :--- | :--- | :--- |
| `GET /` | `REPUESTOS_GESTIONAR` | Activos, por nombre. Con `?all=true`, también los inactivos.<br>Cada uno: `id`, `nombre`, `contacto`, `telefono`, `email`, `notas`, `activo` y `repuestos_activos`. |
| `GET /opciones` | `REPUESTOS_GESTIONAR` o `INTERVENCIONES_CAMBIAR_ESTADO` | Solo activos: `id` y `nombre`. Para los diálogos de pedidos. |
| `POST /` | `REPUESTOS_GESTIONAR` | Alta. 201 con el proveedor. |
| `PUT /:id` | `REPUESTOS_GESTIONAR` | Edición de los campos que vengan. `activo: true` reactiva. |
| `DELETE /:id` | `REPUESTOS_GESTIONAR` | Desactiva, como en D-015. |

**Validaciones:**

- `nombre`: recortado, de 2 a 150. Repetido: 409 `NOMBRE_DUPLICADO`.
- `email`: como en usuarios, hasta 254 y con formato. Inválido: 422 `EMAIL_INVALIDO`.
- `contacto` hasta 150, `telefono` hasta 40, `notas` hasta 1000. Vacíos: `null`.
- Inexistente: 404 `PROVEEDOR_NO_ENCONTRADO`.

**Desactivar:**

- con repuestos activos que lo tienen como habitual, o con pedidos abiertos: 409 `EN_USO`, con `repuestos_activos` y `pedidos_abiertos`;
- ya inactivo: 200.

`/opciones` va declarada antes de `/:id`. Lo mismo en repuestos.

### 4.3 Repuestos: `/api/repuestos`

Todas con `REPUESTOS_GESTIONAR`, salvo `/opciones`.

| Ruta | Qué hace |
| :--- | :--- |
| `GET /` | Activos, por nombre. Con `?all=true`, también los inactivos. Cada uno, una **fila de repuesto**. |
| `GET /opciones` | Permiso: `REPUESTOS_GESTIONAR` o `INTERVENCIONES_CAMBIAR_ESTADO`. Solo activos, por nombre: `id`, `codigo`, `nombre`, `unidad`, `lleva_stock`, `cantidad_disponible` y `costo_unitario` (`null` sin `veCostos`). |
| `GET /:id` | La fila, más `descripcion`, `creado_en`, `actualizado_en`, `pedidos_abiertos` y `consumos_vigentes`. 404 `REPUESTO_NO_ENCONTRADO`. |
| `POST /` | Alta. 201 con el detalle. |
| `PUT /:id` | Edición. 200 con el detalle. |
| `DELETE /:id` | Desactiva. |
| `GET /:id/movimientos?limite=` | Del más nuevo al más viejo; 100 por omisión, hasta 500. |
| `POST /:id/movimientos` | Ingreso, egreso o ajuste (sección 4.4). |
| `GET /:id/usos` | Los consumos de este repuesto, del más nuevo al más viejo, hasta 100. |
| `GET /:id/costos` | El historial de costos, del más nuevo al más viejo. |

**Fila de repuesto:** `id`, `codigo`, `nombre`, `unidad`, `lleva_stock`, `cantidad_disponible`, `stock_minimo`, `estado_stock`, `costo_unitario`, `proveedor` (`{ id, nombre, activo }` o `null`), `ubicacion` y `activo`.

**`estado_stock`**, en este orden:

| Valor | Cuándo |
| :--- | :--- |
| `SIN_CONTROL` | No lleva stock. |
| `SIN_STOCK` | Cantidad 0. |
| `BAJO` | Tiene mínimo y la cantidad es menor o igual al mínimo. |
| `OK` | En otro caso. |

**Campos del alta:**

| Campo | Regla |
| :--- | :--- |
| `codigo` | Opcional; recortado; vacío es `null`; hasta 40. Repetido sin distinguir mayúsculas: 409 `CODIGO_DUPLICADO`. |
| `nombre` | Obligatorio; recortado; de 2 a 150. No es único. |
| `unidad` | Opcional, `unidad` por omisión; de 1 a 20. |
| `lleva_stock` | Opcional, `true` por omisión. |
| `stock_inicial` | Opcional, desde 0. Solo si lleva stock. Si es mayor que 0, crea un `INGRESO` con la observación "Stock inicial". |
| `stock_minimo` | Opcional, desde 0. Solo si lleva stock. |
| `costo_unitario` | Opcional, 0 por omisión. |
| `proveedor_id` | Opcional. Inexistente o inactivo: 422 `PROVEEDOR_INVALIDO`. |
| `ubicacion`, `descripcion` | Opcionales: hasta 100 y hasta 1000. |

El alta siempre agrega la fila `ALTA` al historial de costos, aunque el costo sea 0.

**Edición:**

- los mismos campos, salvo `stock_inicial`;
- mandar `cantidad_disponible` da 422: "El stock se cambia con movimientos";
- un costo distinto agrega la fila `EDICION`;
- dejar de llevar stock con stock mayor que 0: 409 `TIENE_STOCK`, con `cantidad_disponible`. Con 0, se permite y el mínimo pasa a `null`;
- `activo: true` reactiva.

**Desactivar:**

- con stock mayor que 0: 409 `TIENE_STOCK`;
- con pedidos abiertos: 409 `EN_USO`, con `pedidos_abiertos`;
- ya inactivo: 200.

**Usos:** `consumo_id`, `intervencion` (`{ id, estado }`), `maquina` (`{ id, codigo, nombre }`), `cantidad`, `costo_unitario_aplicado`, `importe`, `registrado_en` y `anulado`.

**Costos:** `id`, `costo_unitario`, `origen`, `registrado_por` (`{ id, nombre, apellido }` o `null`) y `registrado_en`.

**Movimiento:** `id`, `tipo`, `cantidad`, `delta`, `stock_resultante`, `costo_unitario`, `proveedor` (`{ id, nombre }` o `null`), `comprobante`, `observacion`, `intervencion_id`, `realizado_por` (`{ id, nombre, apellido }`) y `realizado_en`.

### 4.4 Movimientos manuales: `POST /api/repuestos/:id/movimientos`

| `tipo` | Campos | Efecto |
| :--- | :--- | :--- |
| `INGRESO` | `cantidad`; opcionales: `costo_unitario`, `proveedor_id`, `comprobante` (hasta 60) y `observacion` | `delta = +cantidad`. Con costo distinto, `cambiarCosto` con origen `INGRESO`. |
| `EGRESO` | `cantidad` y `observacion`, que es el motivo | `delta = −cantidad`. Para roturas, préstamos o pérdidas; el uso en una intervención va por la sección 5. |
| `AJUSTE` | `cantidad_contada` (desde 0) y `observacion`, que es el motivo | `delta = contada − actual`. |

**Errores:**

- otro `tipo`, incluido `DEVOLUCION`: 422;
- egreso o ajuste sin motivo de al menos 5 caracteres: 422 `MOTIVO_REQUERIDO`;
- ajuste a la misma cantidad: 422 `SIN_CAMBIOS`;
- repuesto inactivo: 409 `REPUESTO_INACTIVO`;
- sin control de stock: 409 `REPUESTO_SIN_CONTROL_STOCK`;
- egreso mayor que el stock: 409 `STOCK_INSUFICIENTE`, con `disponible`.

**Respuesta:** 201 con `{ movimiento, repuesto }`, este último con la fila actualizada.

### 4.5 Pruebas: `backend/tests/repuestos.test.ts`

Script `test:repuestos`. Crea sus usuarios, proveedores y repuestos.

**Las listas pueden traer datos que no son de la prueba,** como los repuestos que ya están en la base. Las verificaciones miran solo los de la prueba. Vale también para la sección 5.5.

**Usuarios:**

| Nombre | Cómo se arma |
| :--- | :--- |
| G (gestor) | Perfil `RESPONSABLE_MANTENIMIENTO`. |
| T (técnico) | Perfil `RESPONSABLE_MANTENIMIENTO` con excepciones `DENEGAR` de `REPUESTOS_GESTIONAR`, `COSTOS_VER` y `COSTOS_REGISTRAR`. |
| O | Perfil `OPERARIO`. |

**Limpieza**, en este orden: pedidos, consumos, movimientos, historial de costos, repuestos, proveedores, excepciones y usuarios. En la sección 5.5, además, la cadena de siempre de las intervenciones, con su auditoría.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| RE-01 | Permisos | • O: 403 en `GET /api/repuestos`, `POST /api/repuestos`, `GET /api/proveedores`, `GET /api/repuestos/opciones` y `GET /api/proveedores/opciones`.<br>• T: 403 en `GET /api/repuestos`; 200 en las dos `/opciones`, con `costo_unitario` en `null`.<br>• G: `/opciones` con el costo. |
| RE-02 | Proveedores | • Alta: 201.<br>• Otro con el mismo nombre en mayúsculas y con espacios: 409 `NOMBRE_DUPLICADO`.<br>• Email inválido: 422 `EMAIL_INVALIDO`.<br>• Desactivar uno que es el habitual de un repuesto activo: 409 `EN_USO`, con `repuestos_activos` 1.<br>• Desactivar otro sin uso: 200. No sale en `GET /`, ni en `/opciones`; sale en `?all=true` con `activo: false`.<br>• Reactivar con `PUT` y `activo: true`: vuelve a salir. |
| RE-03 | Alta de repuesto | • Sin stock inicial: cantidad 0, `SIN_STOCK` y una fila `ALTA` en el historial.<br>• Con `stock_inicial` 10: un `INGRESO` "Stock inicial" con `delta` 10 y `stock_resultante` 10.<br>• Código repetido con otras mayúsculas: 409 `CODIGO_DUPLICADO`.<br>• Sin stock y con `stock_inicial` o con `stock_minimo`: 422.<br>• Cantidad con 4 decimales: 422. Cantidad como texto: 422.<br>• Proveedor inactivo: 422 `PROVEEDOR_INVALIDO`. |
| RE-04 | `estado_stock` | Con mínimo 5: cantidad 6 da `OK`; 5 da `BAJO`; 0 da `SIN_STOCK`. Uno sin stock: `SIN_CONTROL`. En `GET /`, todos los `numeric` son números. |
| RE-05 | Edición | • Costo nuevo: fila `EDICION`, y el costo anterior sigue en el historial.<br>• El mismo costo: no agrega fila.<br>• Mandar `cantidad_disponible`: 422.<br>• Dejar de llevar stock con 3 en stock: 409 `TIENE_STOCK`. Con 0: 200, y el mínimo queda en `null`. |
| RE-06 | Movimientos | Sobre un repuesto con 10:<br>• `INGRESO` de 5, con costo nuevo, proveedor y comprobante: stock 15, costo actualizado, fila `INGRESO` en el historial.<br>• `EGRESO` sin motivo: 422 `MOTIVO_REQUERIDO`.<br>• `EGRESO` de 16: 409 `STOCK_INSUFICIENTE`, con `disponible` 15.<br>• `EGRESO` de 2 con motivo: 13.<br>• `AJUSTE` a 13: 422 `SIN_CAMBIOS`.<br>• `AJUSTE` a 12: `delta` −1.<br>• `tipo` `DEVOLUCION`: 422.<br>• En uno sin stock: 409 `REPUESTO_SIN_CONTROL_STOCK`. En uno inactivo: 409 `REPUESTO_INACTIVO`. |
| RE-07 | Coherencia | Del repuesto de RE-06, ordenando los movimientos por `id`:<br>• cada `stock_resultante` es el anterior más su `delta`;<br>• el último es igual a `cantidad_disponible`;<br>• la suma de los `delta` también.<br>`GET /:id/movimientos` los trae del más nuevo al más viejo, con `realizado_por`. |
| RE-08 | Concurrencia | Un repuesto con 4 y dos `EGRESO` de 4 a la vez: uno 201 y otro 409. Queda en 0, con un solo egreso. |
| RE-09 | Desactivar | • Con stock: 409 `TIENE_STOCK`.<br>• Sin stock: 200, y otra vez: 200.<br>• Inactivo: no sale en `GET /` ni en `/opciones`.<br>• Reactivar: vuelve a salir.<br>El caso de los pedidos abiertos va en RI-19. |

---

## 5. API: repuestos y pedidos en la intervención (cuarto commit)

Las rutas van en un archivo nuevo, `backend/functions/intervencionRepuestos.ts`: un `Hono` **sin middleware propio**. Se monta con una sola línea al final de `intervenciones.ts`, `intervencionesApp.route('/', intervencionRepuestosApp)`. Así usa el `jwtVerify` y el `dbVerify` de siempre, una sola vez. El resto de `intervenciones.ts` no se toca.

**En todas las rutas:** una intervención eliminada, o que el usuario no puede ver (`puedeVerIntervencion`), da 404 `INTERVENCION_NO_ENCONTRADA`.

**Bloqueos:** `bloquearIntervencion` (máquina y después intervención), después el consumo o el pedido, y al final el repuesto, dentro de `moverStock`.

### 5.1 Consumos

**Quién puede**, según el estado:

| Estado | Registrar | Anular |
| :--- | :--- | :--- |
| `PENDIENTE` | No: 409 `ESTADO_NO_PERMITE_REPUESTOS` | No hay consumos que anular |
| `EN_PROCESO`, `EN_ESPERA_REPUESTOS` | `INTERVENCIONES_CAMBIAR_ESTADO` y la regla de actor: ser el responsable o tener `INTERVENCIONES_ASIGNAR` | Igual |
| `FINALIZADA` | `INTERVENCIONES_CORREGIR` y `motivo` | `INTERVENCIONES_CORREGIR` |
| `CANCELADA` | No: 409 `ESTADO_NO_PERMITE_REPUESTOS` | `INTERVENCIONES_CORREGIR` |

**Errores de permiso:**

- falta el permiso: 403 `PERMISO_INSUFICIENTE`;
- tiene el permiso, pero no es el responsable ni tiene `INTERVENCIONES_ASIGNAR`: 403 `NO_ES_RESPONSABLE`.

Esta tabla vive en **una sola función**, `permisosRepuestos(usuario, intervencion)`. La usan el `GET`, el `POST` y la anulación.

**`GET /api/intervenciones/:id/repuestos`** (`INTERVENCIONES_VER`):

```text
{
  consumos: [{
    id, repuesto: { id, codigo, nombre, unidad }, cantidad,
    costo_unitario_aplicado, importe,          // null sin veCostos
    observacion, registrado_por, registrado_en, movio_stock,
    anulado, anulado_por, anulado_en, motivo_anulacion
  }],
  total_repuestos,                             // null sin veCostos
  ve_costos, puede_registrar, puede_anular
}
```

- Orden: del más viejo al más nuevo. Los anulados también vienen.
- `importe = round(cantidad × costo_unitario_aplicado, 2)`.
- `total_repuestos` suma los importes de los no anulados.
- `registrado_por` y `anulado_por` son `{ id, nombre, apellido }` o `null`.

**`POST /api/intervenciones/:id/repuestos`:**

| Campo | Regla |
| :--- | :--- |
| `repuesto_id` | Obligatorio. Inexistente: 404 `REPUESTO_NO_ENCONTRADO`. Inactivo: 409 `REPUESTO_INACTIVO`. |
| `cantidad` | Como en 4.1. Si lleva stock y no alcanza: 409 `STOCK_INSUFICIENTE`, con `disponible`. |
| `observacion` | Opcional, hasta 500. |
| `costo_unitario` | Opcional. **Solo para un repuesto sin control de stock** (con stock: 422) y con `puedeCargarCostos` (si no: 403). |
| `motivo` | Obligatorio en `FINALIZADA`, al menos 5 caracteres: si no, 422 `MOTIVO_REQUERIDO`. En los demás estados no se usa. |

**Efectos, en una transacción:**

1. El costo aplicado es el que vino o, si no vino, el vigente del repuesto. Si vino uno distinto, `cambiarCosto` con origen `CONSUMO`.
2. Si lleva stock: `moverStock` con `EGRESO`, `delta = −cantidad`, el `intervencion_id` y la observación "Intervención N.º X".
3. Inserta el consumo, con `registrado_por_usuario_id` y `movimiento_id`.
4. `recalcularCostosIntervencion` (abajo).
5. Si está `FINALIZADA`: auditoría `CORRECCION_COSTO`, campo `repuestos`, `valor_nuevo` "Se agregó: <nombre> × <cantidad> <unidad>" y el motivo. **Sin importes:** la auditoría la ve cualquiera que ve la intervención.

Responde 201 con el consumo, en el formato del `GET`.

**`POST /api/intervenciones/:id/repuestos/:consumoId/anular`**, con `{ motivo }`:

- motivo de menos de 5 caracteres: 422 `MOTIVO_REQUERIDO`;
- consumo de otra intervención o inexistente: 404 `CONSUMO_NO_ENCONTRADO`;
- ya anulado: 409 `CONSUMO_YA_ANULADO`. El consumo se bloquea con `FOR UPDATE` antes de mirarlo.

**Efectos:**

1. Si el consumo movió stock y el repuesto todavía lleva stock: `moverStock` con `DEVOLUCION` y `delta = +cantidad`. Se guarda en `devolucion_movimiento_id`.
2. Completa los tres datos de anulación.
3. `recalcularCostosIntervencion`.
4. Si está `FINALIZADA` o `CANCELADA`: auditoría `CORRECCION_COSTO`, campo `repuestos`, "Se anuló: <nombre> × <cantidad> <unidad>" y el motivo.

Responde 200 con el consumo.

**`recalcularCostosIntervencion(client, id)`**, en `backend/functions/intervenciones/costos.ts`:

- `costo_repuestos` = suma de los importes de los consumos no anulados;
- `costo_total_estimado` = `costo_mano_obra + costo_repuestos`.

La etapa de Costos la va a ampliar con los renglones.

### 5.2 Pedidos

**Quién puede:** `REPUESTOS_GESTIONAR`, o `INTERVENCIONES_CAMBIAR_ESTADO` con la regla de actor. Si no: 403 `PERMISO_INSUFICIENTE` o `NO_ES_RESPONSABLE`, como en 5.1.

| Ruta | Estado de la intervención | Qué hace |
| :--- | :--- | :--- |
| `GET /:id/pedidos` | Cualquiera (`INTERVENCIONES_VER`) | `{ pedidos, puede_crear, puede_gestionar }` |
| `POST /:id/pedidos` | `EN_PROCESO` o `EN_ESPERA_REPUESTOS`; si no, 409 `ESTADO_NO_PERMITE_PEDIDOS` | Alta. 201. |
| `PATCH /:id/pedidos/:pedidoId` | Cualquiera | Edita un pedido abierto. |
| `POST /:id/pedidos/:pedidoId/recibir` | Cualquiera | Lo pasa a `RECIBIDO`. |
| `POST /:id/pedidos/:pedidoId/cancelar` | Cualquiera | Lo pasa a `CANCELADO`, con `{ motivo }` de al menos 5 caracteres. |

Una vez pedido, el repuesto puede llegar aunque la intervención ya se haya cerrado. Por eso editar, recibir y cancelar se permiten en cualquier estado.

**Estados del pedido:**

- `PENDIENTE`: por pedir, sin `pedido_en`;
- `PEDIDO`: con `pedido_en`;
- `RECIBIDO` y `CANCELADO`: cerrados. Editar, recibir o cancelar uno cerrado: 409 `PEDIDO_CERRADO`.

Un pedido de otra intervención o inexistente: 404 `PEDIDO_NO_ENCONTRADO`.

**Campos del alta y la edición:**

| Campo | Regla |
| :--- | :--- |
| `repuesto_id` | Opcional. Inexistente o inactivo: 422 `REPUESTO_INVALIDO`. |
| `descripcion` | De 3 a 200. Obligatoria si no hay repuesto. |
| `cantidad` | Como en 4.1. |
| `proveedor_id` | Opcional. Inexistente o inactivo: 422 `PROVEEDOR_INVALIDO`. |
| `pedido_en`, `esperado_para` | Opcionales, `YYYY-MM-DD` y fechas válidas. `esperado_para` no anterior a `pedido_en`. |
| `observacion` | Opcional, hasta 500. |

- **El estado sale de `pedido_en`:** con fecha, `PEDIDO`; sin fecha, `PENDIENTE`. En la edición, `pedido_en: null` lo vuelve a `PENDIENTE`.
- **Fechas sin hora.** `pedido_en` y `esperado_para` son días: se guardan como `date` y se devuelven con `to_char(…, 'YYYY-MM-DD')`. **Nunca como `Date` de JS**, que las corre un día.
- Toda escritura completa `actualizado_por_usuario_id` y `actualizado_en`.

**Recibir:**

| Campo | Regla |
| :--- | :--- |
| `recibido_en` | Opcional, ISO; ahora por omisión. Más de un minuto en el futuro: 422 `FECHA_INCOHERENTE`. |
| `ingresar_stock` | Opcional, `false` por omisión. Pide un repuesto del catálogo, activo y con stock:<br>• pedido sin repuesto: 422 `PEDIDO_SIN_REPUESTO`;<br>• inactivo: 409 `REPUESTO_INACTIVO`;<br>• sin control de stock: 409 `REPUESTO_SIN_CONTROL_STOCK`. |
| `costo_unitario` | Opcional. Solo con `ingresar_stock` y `puedeCargarCostos`. |
| `comprobante` | Opcional, hasta 60. |

**Con `ingresar_stock`:**

1. `moverStock` con `INGRESO` y `delta = +cantidad`, con el proveedor del pedido, el comprobante y la observación "Pedido N.º P de la intervención N.º I";
2. si vino un costo distinto, `cambiarCosto` con origen `INGRESO`;
3. guarda el movimiento en `movimiento_id`.

**Pedido en las respuestas:**

- `id`, `intervencion_id`;
- `repuesto` (`{ id, codigo, nombre, unidad, lleva_stock }` o `null`), `descripcion`, `cantidad`;
- `proveedor` (`{ id, nombre }` o `null`), `estado`;
- `pedido_en`, `esperado_para` (`YYYY-MM-DD` o `null`), `recibido_en`;
- `observacion`, `motivo_cancelacion`, `ingreso_stock` (si tiene `movimiento_id`);
- `creado_por` (`{ id, nombre, apellido }`), `creado_en` y `actualizado_en`.

**Orden en `GET /:id/pedidos`:** primero los abiertos, y dentro de cada grupo, por `id`.

### 5.3 Lista general: `GET /api/pedidos-repuesto`

- **Permiso:** `REPUESTOS_GESTIONAR`.
- `?estado=ABIERTOS` (por omisión: `PENDIENTE` y `PEDIDO`) o `?estado=TODOS`. Otro valor: 422.
- Sin los de intervenciones eliminadas.
- **Orden:** `esperado_para` ascendente con los nulos al final, y después `id`.
- **Cada uno:** el pedido, más `intervencion` (`{ id, estado, descripcion }`), `maquina` (`{ id, codigo, nombre }`) y `sector` (`{ id, nombre }`).

### 5.4 Reporte: `GET /api/reportes/repuestos?desde=&hasta=&planta_id=&sector_id=`

En `reportes.ts`.

- **Permiso, alcance, período y filtros:** igual que `/indicadores`.
- **Qué cuenta:** consumos no anulados, con `creado_en` dentro del período, de intervenciones no eliminadas, de las máquinas visibles de la selección, **activas o no** (D-018, punto 9).

```text
{
  desde, hasta, ve_costos,
  consumos, intervenciones, importe_total,      // importe_total: null sin veCostos
  por_repuesto: [{ repuesto: { id, codigo, nombre, unidad },
                   cantidad, consumos, intervenciones, importe }],
  por_maquina:  [{ maquina: { id, codigo, nombre }, sector: { id, nombre },
                   consumos, importe }]
}
```

**Orden:**

- con `ve_costos`: por importe, de mayor a menor, y después por nombre;
- sin `ve_costos`: `por_repuesto` por cantidad, `por_maquina` por consumos, de mayor a menor, y después por nombre.

### 5.5 Pruebas: `backend/tests/repuestos_intervenciones.test.ts`

Script `test:repuestos-intervenciones`. Crea dos plantas (PL1 con el sector S1 y PL2 con el sector S2), una máquina en cada sector (M1 y M2), sus usuarios y sus repuestos. Las intervenciones se crean y se mueven **por la API**, como en las pruebas de la F2.

**Usuarios:**

| Nombre | Cómo se arma |
| :--- | :--- |
| R | Perfil `RESPONSABLE_MANTENIMIENTO`, sectores S1 y S2. Es el responsable de las intervenciones. |
| R2 | Como R, con excepciones `DENEGAR` de `INTERVENCIONES_ASIGNAR` y `REPUESTOS_GESTIONAR`. No es responsable de nada. |
| D (depósito) | Como R, con `DENEGAR` de `INTERVENCIONES_ASIGNAR` e `INTERVENCIONES_CAMBIAR_ESTADO`: solo gestiona repuestos. |
| T (técnico) | Como R, con `DENEGAR` de `REPUESTOS_GESTIONAR`, `COSTOS_VER` y `COSTOS_REGISTRAR`. Responsable de su propia intervención. |
| A | Perfil `ADMINISTRADOR`: tiene `INTERVENCIONES_CORREGIR`. |
| O | Perfil `OPERARIO`: crea las intervenciones y las ve como propias. |
| O2 | Perfil `OPERARIO`: no creó ninguna, así que no ve ninguna. |
| X | Perfil `OPERARIO` con excepción `CONCEDER` de `REPORTES_CONSULTAR` en alcance `SECTORES`, y solo el sector S2. |

**Repuestos:**

- P1: con stock 10 y costo 100;
- P2: sin control de stock, con costo 50;
- P3: inactivo.

**Stock:** cada caso mide el stock antes y después. Un caso que necesita un stock exacto crea su propio repuesto.

**Período del reporte:** fijo, en el pasado, de 10 días, como en RP. Los `creado_en` de los consumos del reporte se corren por SQL después de cargarlos por la API.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| RI-01 | Estados | • `PENDIENTE`: 409 `ESTADO_NO_PERMITE_REPUESTOS`.<br>• `EN_PROCESO`: 201.<br>• `EN_ESPERA_REPUESTOS`: 201.<br>• `CANCELADA`: 409.<br>• Eliminada: 404. |
| RI-02 | Consumo con stock | R registra P1 × 3:<br>• stock 7;<br>• un `EGRESO` con el `intervencion_id`, `delta` −3 y `stock_resultante` 7;<br>• el consumo con `movimiento_id` y `costo_unitario_aplicado` 100;<br>• la intervención con `costo_repuestos` 300 y `costo_total_estimado` igual a `costo_mano_obra + 300`. |
| RI-03 | Costo histórico | R cambia el costo de P1 a 150 con `PUT /api/repuestos/:id`. El consumo de RI-02 sigue en 100. Un consumo nuevo de P1 × 1 sale a 150. `costo_repuestos` 450. |
| RI-04 | Sin control de stock | • P2 × 2: sin movimiento, `movio_stock` false.<br>• R con `costo_unitario` 60: se aplica 60, el costo de P2 pasa a 60 y hay una fila `CONSUMO` en el historial.<br>• T con `costo_unitario`: 403.<br>• `costo_unitario` en P1: 422. |
| RI-05 | Datos | • P1 × 99: 409 `STOCK_INSUFICIENTE`, con `disponible`.<br>• P3: 409 `REPUESTO_INACTIVO`.<br>• Un id inexistente: 404 `REPUESTO_NO_ENCONTRADO`.<br>• Cantidad 0, negativa, con 4 decimales o como texto: 422. |
| RI-06 | Permisos | • O: 403 `PERMISO_INSUFICIENTE`.<br>• D: 403 `PERMISO_INSUFICIENTE`.<br>• R2: 403 `NO_ES_RESPONSABLE`.<br>• O2, que no la ve: 404. |
| RI-07 | Anular | • Sin motivo: 422 `MOTIVO_REQUERIDO`.<br>• El de RI-02 con motivo: 200; una `DEVOLUCION` con `delta` +3; el stock vuelve; los tres datos de anulación completos; `costo_repuestos` sin esos 300.<br>• Otra vez: 409 `CONSUMO_YA_ANULADO`.<br>• Uno de P2: 200, sin movimiento.<br>• Un `consumoId` de otra intervención: 404 `CONSUMO_NO_ENCONTRADO`. |
| RI-08 | `FINALIZADA` | Se finaliza por la API.<br>• R registra: 403 `PERMISO_INSUFICIENTE`.<br>• A sin motivo: 422 `MOTIVO_REQUERIDO`.<br>• A con motivo: 201, y una auditoría `CORRECCION_COSTO` con campo `repuestos`, el nombre y la cantidad en `valor_nuevo`, el motivo, y **sin el importe ni el costo** en ningún texto.<br>• A anula: 200, y otra auditoría con "Se anuló". |
| RI-09 | `CANCELADA` (D-20) | Una intervención con P1 × 2 se cancela por la API.<br>• El stock **no cambia**.<br>• R anula: 403.<br>• A anula con motivo: 200, y el stock vuelve. |
| RI-10 | Reabrir | Una finalizada con consumos se reabre por la API: los consumos siguen, el stock no cambia, y R vuelve a poder registrar. |
| RI-11 | `GET` y lo que puede cada uno | • Orden del más viejo al más nuevo, con los anulados.<br>• T y O: `costo_unitario_aplicado`, `importe` y `total_repuestos` en `null`, y `ve_costos` false.<br>• `puede_registrar` y `puede_anular`: true para R en `EN_PROCESO`; false para O; false para R en `FINALIZADA`; true para A en `FINALIZADA`.<br>• En cada caso, coincide con lo que responde el `POST`. |
| RI-12 | Concurrencia | • Un repuesto propio con stock 2 y dos consumos de 2 a la vez: uno 201 y otro 409; un solo egreso.<br>• Dos anulaciones a la vez del mismo consumo: una 200 y otra 409; una sola devolución. |
| RI-13 | Alta de pedidos | En `EN_ESPERA_REPUESTOS`:<br>• con P1 y sin fecha: `PENDIENTE`;<br>• con `pedido_en` 2026-11-03 y `esperado_para` 2026-11-10: `PEDIDO`, y las dos fechas vuelven **exactamente** así;<br>• solo con descripción: 201;<br>• sin repuesto ni descripción: 422;<br>• `esperado_para` antes de `pedido_en`: 422;<br>• fecha `2026-02-30`: 422;<br>• en una `PENDIENTE`: 409 `ESTADO_NO_PERMITE_PEDIDOS`. |
| RI-14 | Permisos de pedidos | • D, que no puede registrar consumos (RI-06), sí puede dar de alta, editar, recibir y cancelar pedidos: le alcanza `REPUESTOS_GESTIONAR`.<br>• R2: 403 `NO_ES_RESPONSABLE`.<br>• O: 403 `PERMISO_INSUFICIENTE`.<br>• `puede_crear` y `puede_gestionar` coinciden con esas respuestas. |
| RI-15 | Ciclo del pedido | • `PATCH` con `pedido_en`: `PEDIDO`. Con `pedido_en: null`: `PENDIENTE`.<br>• Recibir P1 × 4 con `ingresar_stock`: `RECIBIDO`; un `INGRESO` de 4 con el proveedor del pedido; `movimiento_id` completo; el stock sube 4.<br>• Recibir otra vez, o editarlo: 409 `PEDIDO_CERRADO`.<br>• Recibir uno solo con descripción, con `ingresar_stock`: 422 `PEDIDO_SIN_REPUESTO`.<br>• `recibido_en` de mañana: 422 `FECHA_INCOHERENTE`.<br>• Cancelar sin motivo: 422. Con motivo: `CANCELADO`. |
| RI-16 | Intervención cerrada | Con un pedido abierto, la intervención se cancela. Recibirlo con `ingresar_stock` funciona igual. |
| RI-17 | Lista general | Mirando solo los pedidos de la prueba:<br>• sin parámetros: solo `PENDIENTE` y `PEDIDO`, por `esperado_para` con los nulos al final, con la intervención, la máquina y el sector;<br>• `estado=TODOS`: también los cerrados;<br>• `estado=OTRO`: 422;<br>• O: 403. |
| RI-18 | Reporte | Con dos repuestos propios del caso, Q1 (con stock) y Q2 (sin control), en el período fijo:<br>• una intervención en M1: Q1 × 3 a 100 y Q1 × 1 a 150;<br>• una en M2: Q2 × 5 a 60;<br>• además, un consumo anulado y otro fuera del período, que no cuentan.<br>Resultados:<br>• `consumos` 3, `intervenciones` 2 e `importe_total` 750;<br>• Q1: cantidad 4, consumos 2 e importe 450; Q2: cantidad 5, consumos 1 e importe 300. Q1 va primero;<br>• `por_maquina`: M1 con 450 y M2 con 300;<br>• con `planta_id` de PL1: solo M1;<br>• con `sector_id` de S2: solo M2;<br>• T: los importes en `null`, `ve_costos` false, y **Q2 primero**, porque se ordena por cantidad;<br>• X: solo M2;<br>• O: 403;<br>• `desde` posterior a `hasta`: 422. |
| RI-19 | Bajas con pedidos abiertos | • Desactivar el repuesto de un pedido abierto: 409 `EN_USO`, con `pedidos_abiertos` 1.<br>• Desactivar el proveedor de un pedido abierto: 409 `EN_USO`, con `pedidos_abiertos` 1.<br>• Cancelado el pedido, las dos bajas se permiten. Para eso, el repuesto del caso no tiene stock y el proveedor no es el habitual de ningún repuesto. |

---

## 6. Lógica pura (quinto commit)

### 6.1 En `lib/formato.ts`

| Función | Ejemplos |
| :--- | :--- |
| `formatMoneda(valor)` | 12345.5 → "$ 12.345,50"; 0 → "$ 0,00"; `null` → "—". Con un espacio común, no uno duro. |
| `formatCantidad(valor)` | 2 → "2"; 1.5 → "1,5"; 1234.25 → "1.234,25"; 0.125 → "0,125"; `null` → "—". |

### 6.2 `lib/repuestos.ts` (nuevo)

**`infoEstadoStock(estado)`** devuelve `{ etiqueta, color }`:

| Estado | Etiqueta | Color |
| :--- | :--- | :--- |
| `OK` | En stock | verde |
| `BAJO` | Bajo mínimo | naranja |
| `SIN_STOCK` | Sin stock | rojo |
| `SIN_CONTROL` | Sin control de stock | gris |

**`resumenStock(lista)`** devuelve `{ total, bajo, sinStock }`, contando solo los activos.

**`validarCantidad(valor, maximo?)`** devuelve el error o `null`:

- vacío: "Ingresá una cantidad.";
- cero o negativa: "Tiene que ser mayor que cero.";
- más de tres decimales: "Hasta tres decimales.";
- mayor que el máximo: "Hay {máximo} en stock.", con `formatCantidad`.

**`validarCosto(valor)`**:

- vacío o válido: `null`;
- negativo: "No puede ser negativo.";
- más de dos decimales: "Hasta dos decimales.".

**`leerFiltrosRepuestos` y `escribirFiltrosRepuestos`:**

| Parámetro | Valores | Por omisión |
| :--- | :--- | :--- |
| `vista` | `repuestos`, `pedidos`, `proveedores` | `repuestos` |
| `q` | texto | vacío |
| `estado` | `todos`, `OK`, `BAJO`, `SIN_STOCK`, `SIN_CONTROL` | `todos` |
| `proveedor` | id | ninguno |
| `inactivos` | `1` o nada | no |
| `cerrados` | `1` o nada | no |

Un valor inválido vuelve a su valor por omisión.

**`filtrarRepuestos(lista, filtros)`:**

- el texto busca en código, nombre y ubicación, sin distinguir mayúsculas ni acentos, con `normalizarTexto`, como en Usuarios;
- sin `inactivos`, solo los activos;
- después, estado y proveedor.

**`hoyLocal(ahora)`** devuelve el día local como `YYYY-MM-DD`.

**`infoPedido(pedido, hoy)`** devuelve `{ etiqueta, color, plazo, atrasado }`.

| Estado | Etiqueta |
| :--- | :--- |
| `PENDIENTE` | Por pedir |
| `PEDIDO` | Pedido |
| `RECIBIDO` | Recibido |
| `CANCELADO` | Cancelado |

`plazo`, solo para los abiertos (en los cerrados, `null`):

| Caso | Texto |
| :--- | :--- |
| Sin `esperado_para` | "Sin fecha prevista" |
| `esperado_para` anterior a hoy | "Atrasado 1 día" o "Atrasado N días" |
| `esperado_para` igual a hoy | "Llega hoy" |
| `esperado_para` posterior | "Para el DD/MM/AAAA" |

`atrasado` es true solo en el segundo caso.

**`textoMovimiento(movimiento)`** devuelve `{ etiqueta, cantidad }`:

- etiqueta: "Ingreso", "Egreso", "Ajuste" o "Devolución";
- cantidad: con el signo del `delta`, "+5" o "−2", con `formatCantidad`;
- en una fila vieja sin `delta`: la cantidad sin signo, salvo `INGRESO` (+) y `EGRESO` (−).

### 6.3 FE nuevas de este commit

Ver la sección 11: FE-47 a FE-52.

---

## 7. Pantalla Repuestos: `/repuestos` (quinto commit)

`pantallas/Repuestos.tsx`. Pestañas **Repuestos · Pedidos · Proveedores**, guardadas en `?vista=`, como en Reportes. Los filtros también van en la dirección.

### 7.1 Pestaña Repuestos (`componentes/repuestos/TabRepuestos.tsx`)

**Arriba:**

- el resumen "N repuestos · X bajo mínimo · Y sin stock". Tocar "bajo mínimo" o "sin stock" aplica ese filtro;
- el botón **"Nuevo repuesto"**.

**Filtros:** buscar, estado, proveedor y el interruptor "Mostrar inactivos".

**Tabla:**

- columnas: Código, Nombre, Stock (la cantidad con su unidad, y la marca de `infoEstadoStock`), Mínimo, Costo unitario, Proveedor y Ubicación;
- los inactivos, atenuados y con la marca "Inactivo";
- tocar una fila abre `/repuestos/:id`;
- en el celular, la tabla se desplaza dentro de su caja (`Table.ScrollContainer`), como en Usuarios.

**Sin repuestos:** "Todavía no hay repuestos cargados." Con filtros que no dan nada: "Ningún repuesto coincide con los filtros."

**Diálogo `ModalRepuesto`**, de alta y edición:

- Código, Nombre y Unidad. La unidad es un `Autocomplete` con unidad, metro, litro, kg, juego y caja, y admite otra;
- "Lleva control de stock", un interruptor;
- "Stock inicial", solo en el alta, y "Stock mínimo", los dos solo si lleva stock;
- Costo unitario, Proveedor habitual (solo los activos), Ubicación y Descripción.

Los números van con `NumberInput`, coma decimal y punto de miles. Cada error de la API se muestra en su campo: `CODIGO_DUPLICADO` en Código, `TIENE_STOCK` en el interruptor.

### 7.2 Pestaña Pedidos (`componentes/repuestos/TabPedidos.tsx`)

- **Datos:** `GET /api/pedidos-repuesto`. El interruptor "Incluir cerrados" pide `estado=TODOS`.
- **Columnas:** Repuesto (o la descripción), Cantidad, Proveedor, Intervención (enlace "N.º X · máquina"), Estado y Plazo.
- **Plazo:** el de `infoPedido`. Si está atrasado, en rojo.
- **Acciones** en cada abierto: "Recibir" y "Cancelar", con `ModalRecibirPedido` y `ModalCancelarPedido`. Están descritos en la sección 10.2, pero se hacen en este commit; el sexto los reutiliza.

**Sin pedidos abiertos:** "No hay pedidos abiertos."

### 7.3 Pestaña Proveedores (`componentes/repuestos/TabProveedores.tsx`)

- **Columnas:** Nombre, Contacto, Teléfono, Email, Repuestos (los activos que lo tienen como habitual) y Estado.
- **Acciones:**
  - "Nuevo proveedor" y editar, con `ModalProveedor`;
  - desactivar y reactivar, con `ModalDesactivarElemento` y `ModalReactivarElemento`. `EN_USO` muestra cuántos repuestos y cuántos pedidos lo usan.
- El interruptor "Mostrar inactivos".

---

## 8. Detalle de repuesto: `/repuestos/:id` (quinto commit)

`pantallas/DetalleRepuesto.tsx`.

**Encabezado:**

- el nombre, el código y la marca de estado;
- el stock actual grande, con su unidad;
- los botones:
  - "Ingreso", "Egreso" y "Ajuste", si lleva stock y está activo;
  - "Editar";
  - en el menú, "Desactivar" o "Reactivar".

**Tarjeta de datos:** unidad, mínimo, costo unitario, proveedor habitual, ubicación, descripción, pedidos abiertos y consumos vigentes.

**Pestañas:**

| Pestaña | Contenido |
| :--- | :--- |
| Movimientos | Fecha, Tipo y cantidad (`textoMovimiento`), Stock resultante, Costo, Proveedor y comprobante, Intervención (enlace), Usuario y Observación. |
| Usos | Fecha, Intervención (enlace, con su estado), Máquina, Cantidad e Importe. Los anulados, tachados. |
| Costos | Fecha, Costo, Origen y Usuario. |

**Diálogo `ModalMovimiento`**, uno solo para los tres tipos:

| Tipo | Campos |
| :--- | :--- |
| Ingreso | Cantidad; Costo unitario (con el actual), Proveedor (con el habitual), Comprobante y Observación. |
| Egreso | Cantidad y Motivo. |
| Ajuste | "Cantidad contada" (con la actual) y Motivo. Debajo, "Diferencia: −1". |

- Valida con `validarCantidad` y `validarCosto`.
- `STOCK_INSUFICIENTE` muestra "Ya no alcanza: hay N en stock." y recarga el repuesto.

**Repuesto inexistente:** la pantalla "No encontrada" que ya existe.

---

## 9. Menú, rutas e ícono (quinto commit)

- **Menú:** "Repuestos", con `REPUESTOS_GESTIONAR`, entre "Máquinas" y "Reportes".
- **Ícono:** `IconPackage`, agregado a `ICONOS_MENU`.
- **Rutas:** `/repuestos` y `/repuestos/:id`, con `RutaProtegida permiso="REPUESTOS_GESTIONAR"`.

**FE-04 se actualiza** para sumar "Repuestos" a RESPONSABLE_MANTENIMIENTO, I_D y ADMINISTRADOR. El administrador pasa a tener 9 ítems. Los demás perfiles no cambian.

---

## 10. Intervención y reportes (sexto commit)

### 10.1 R3: bloque "Repuestos usados"

`componentes/repuestos/BloqueRepuestosIntervencion.tsx`, en la columna principal, entre "Trabajo realizado" e "Historial". Lee `GET /intervenciones/:id/repuestos`.

**Tabla:**

- columnas: Repuesto (código · nombre), Cantidad (con la unidad), Costo unitario, Importe y Registró (persona y fecha);
- Costo unitario e Importe solo con `ve_costos`;
- un menú con "Anular" en cada consumo vigente, si `puede_anular`;
- los anulados, atenuados y tachados, con "Anulado por X el …: motivo".

**Debajo:**

- "Total en repuestos: $ …", solo con `ve_costos`;
- el botón **"Agregar repuesto"**, si `puede_registrar`.

**Sin consumos:** "Todavía no se registraron repuestos."

**Cancelada con consumos vigentes**, si `puede_anular`: "La intervención está cancelada. Si algún repuesto no se usó, anulalo para devolverlo al stock."

**Diálogo `ModalConsumo`:**

- **Repuesto:** un `Select` con búsqueda, de `/api/repuestos/opciones`. Cada opción dice "código · nombre — stock: 7 (unidad)" o "código · nombre — sin control de stock".
- **Cantidad.** Si lleva stock, el máximo es lo que hay.
- **Costo unitario:** solo para uno sin control de stock y con permiso de cargar costos. Viene con el costo actual.
- **Observación.**
- **Motivo de la corrección:** solo si la intervención está `FINALIZADA`, obligatorio.
- `STOCK_INSUFICIENTE`: "Ya no alcanza: hay N en stock." y recarga las opciones.

**Diálogo `ModalAnularConsumo`:** el motivo. Si el consumo movió stock, avisa "Vuelven N al stock".

**Al terminar, invalidar:**

- los repuestos de la intervención;
- el detalle de la intervención, por el historial;
- todo lo que empieza con `['repuestos']`.

### 10.2 R3: bloque "Pedidos de repuestos"

`componentes/repuestos/BloquePedidosIntervencion.tsx`, debajo del anterior. **Solo se muestra si hay pedidos o si `puede_crear`.**

**Cada pedido:**

- "Rodamiento 6204 × 2" o la descripción;
- el proveedor, la marca de estado y el plazo de `infoPedido`; si está atrasado, en rojo;
- un menú con "Editar", "Recibir" y "Cancelar", si `puede_gestionar` y está abierto.

**Debajo:** el botón **"Agregar pedido"**, si `puede_crear`.

**En `EN_ESPERA_REPUESTOS` sin pedidos abiertos**, si `puede_crear`: "Cargá qué se pidió para seguir la demora."

**Diálogos:**

| Diálogo | Campos |
| :--- | :--- |
| `ModalPedido` (alta y edición) | • Repuesto del catálogo, opcional, o una descripción.<br>• Cantidad.<br>• Proveedor, de `/api/proveedores/opciones`. Al elegir un repuesto, propone su proveedor habitual.<br>• "Fecha del pedido", sin días futuros.<br>• "Se espera para", no anterior al pedido.<br>• Observación.<br>Las fechas, con `DatePickerInput`; se mandan como `YYYY-MM-DD`. |
| `ModalRecibirPedido` | • "Cuándo llegó", con `SelectorMomento`.<br>• "Ingresar al stock": marcado si el repuesto lleva stock y está activo; no se muestra si no se puede.<br>• Costo unitario, solo con "Ingresar al stock" y permiso de cargar costos.<br>• Comprobante. |
| `ModalCancelarPedido` | El motivo. |

### 10.3 D1: pestaña "Repuestos"

`componentes/reportes/TabReporteRepuestos.tsx`. Va cuarta: Indicadores · Inactividad · Tiempos · **Repuestos**. Usa los mismos filtros.

**FE-41 se amplía:** `vista=repuestos` es válida.

**Contenido:**

- **Tarjetas:**
  - "Gastado en repuestos", solo con `ve_costos`;
  - "Consumos";
  - "Intervenciones con repuestos".
- **"Más usados":**
  - columnas: Repuesto, Cantidad, Unidad, Consumos, Intervenciones e Importe;
  - Importe, solo con `ve_costos`.
- **"Por máquina":**
  - columnas: Máquina, Sector, Consumos e Importe;
  - cada máquina enlaza a su detalle.
- **CSV:** el de "Más usados", con las columnas de la tabla, de `filasReporteRepuestos`.

**Sin datos:** "No hay consumos de repuestos para este período y estos filtros."

**`filasReporteRepuestos(datos)`**, en `lib/reportes.ts`:

- devuelve `{ columnas, filas }`; lo usan la tabla y el CSV;
- el repuesto sale "código · nombre", o solo el nombre si no tiene código;
- sin `ve_costos`, la columna Importe no está.

### 10.4 Historial de R3

En `eventosHistorial` (`lib/intervenciones.ts`), la auditoría `CORRECCION_COSTO` con campo `repuestos` sale como:

- **título:** "Corrección de repuestos";
- **detalle:** el `valor_nuevo`, y después "Motivo: …".

---

## 11. Pruebas del frontend

| ID | Commit | Qué prueba | Esperado |
| :-: | :-: | :--- | :--- |
| FE-44 (ampliada) | 1 | `nombreArchivoReporte` | Sección 1.3. |
| FE-46 | 1 | `filaTiempos` | Sección 1.4. |
| FE-04 (actualizada) | 5 | `itemsMenu` | Sección 9. |
| FE-47 | 5 | `formatMoneda` y `formatCantidad` | Los ejemplos de 6.1. |
| FE-48 | 5 | `infoEstadoStock` y `resumenStock` | Los cuatro estados. El resumen no cuenta los inactivos. |
| FE-49 | 5 | `validarCantidad` y `validarCosto` | Cada mensaje de 6.2, y `null` con valores válidos: `1`, `0.5` y `0.125`. |
| FE-50 | 5 | Filtros de repuestos | • Valores por omisión con la dirección vacía.<br>• `vista=otra` y `estado=ROTO` vuelven a su valor por omisión.<br>• Ida y vuelta con todos los campos: lo mismo.<br>• `filtrarRepuestos`: "rodamiento" encuentra "Rodamiento", y "cafe" encuentra "Café"; busca también en código y ubicación; sin `inactivos` no trae los inactivos. |
| FE-51 | 5 | `hoyLocal` e `infoPedido` | • `hoyLocal(new Date(2026, 10, 6, 22, 30))` da `2026-11-06`, en cualquier zona horaria.<br>• Con hoy `2026-11-06`: esperado el 4, "Atrasado 2 días"; el 5, "Atrasado 1 día"; el 6, "Llega hoy"; el 10, "Para el 10/11/2026"; sin fecha, "Sin fecha prevista".<br>• Uno recibido: `plazo` `null` y `atrasado` false. |
| FE-52 | 5 | `textoMovimiento` | Ingreso "+5"; egreso "−2"; ajuste con `delta` −1, "−1"; devolución "+3"; y una fila vieja sin `delta`. |
| FE-41 (ampliada) | 6 | `leerFiltrosReportes` | `vista=repuestos` se conserva. |
| FE-53 | 6 | `filasReporteRepuestos` | Con una respuesta escrita **igual que la real de la API**:<br>• con costos: la columna Importe, y el repuesto "código · nombre";<br>• sin costos: sin la columna;<br>• sin código: solo el nombre. |
| FE-54 | 6 | `eventosHistorial` | Una auditoría `CORRECCION_COSTO` con campo `repuestos`: título y detalle de 10.4. |

---

## 12. Documentación (sexto commit, salvo donde se indica)

1. **`docs/decisiones.md`:** D-018, en el segundo commit.
2. **`docs/modelo-datos.md`:** `proveedores`, `repuesto_costos` y `pedidos_repuesto`, y las columnas nuevas, también en el segundo commit.
3. **`docs/analisis-intervenciones.md`:** en D-20, "Resuelta por D-018".
4. **`docs/front/mapa-pantallas.md`:**
   - R6, Repuestos (tres pestañas), y R7, Detalle de repuesto;
   - en R3, los dos bloques;
   - en D1, la cuarta pestaña.
5. **`docs/plan-trabajo.md`:** tildar "Repuestos y movimientos de stock".

---

## 13. Fuera de alcance

- **Avisos de stock bajo y de repuesto recibido:** necesitan un tipo de aviso nuevo, y M15-03 cuenta los que hay hoy. Van en una etapa propia.
- **Renglones de costo y mano de obra:** etapa de Costos.
- **Repuesto sugerido en los planes preventivos:** etapa de Preventivos.
- **Bloque de repuestos en el detalle de máquina:** `DetalleMaquina.tsx` ya tiene 1044 líneas. Va en la limpieza técnica.
- **Aprobación de compras** (D-19): sigue fuera, como se decidió.
- **Migrar la base principal.**

---

## 14. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 12 están hechas, en seis commits.
2. En verde: `test:migration-016`, `test:repuestos`, `test:repuestos-intervenciones`, `test:etapa6` y `test:front`.
3. `npm run typecheck` y `npm run build:frontend` sin errores.
4. Push de los seis commits en `feat/base-neon`.
5. **Al final, la corrida de la noche:**
   - `npm run test:todo -- noche-AAAA-MM-DD`, en Neon, una sola vez;
   - sin cambiar nada después;
   - si algo falla o se corta, **no se arregla ni se vuelve a correr**: solo se informa.

**Informe:**

1. Los seis hashes y el commit que probó la corrida de la noche (`git log -1 --oneline`).
2. La salida final de las cinco suites del punto 2.
3. Typecheck y build, con el tamaño del JS.
4. Las líneas de cada pantalla nueva y de `DetalleIntervencion.tsx`.
5. **Corrida de la noche:**
   - la línea `Total`, la de `Datos que quedaron` (ahora con 15 números) y la del código de salida;
   - las líneas `Con problemas` y `CORTADO`, si hay;
   - por cada prueba fallida: el archivo, el nombre y las primeras líneas del error;
   - cuánto tardó;
   - la ruta del registro.
6. Desvíos, incluidas las decisiones tomadas por la regla 2 de la sección 0.
7. Lo que quedó frenado, si algo quedó.
