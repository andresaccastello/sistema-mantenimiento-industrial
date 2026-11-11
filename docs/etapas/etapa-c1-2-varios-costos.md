# Etapa C1.2 — Varios costos en un guardado

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `48e2fa0` (Etapa C1.1).
> **Origen:** pedido de Andrés. Hoy "Agregar costo" cierra el diálogo al guardar: para cargar un transporte y otro gasto hay que abrirlo dos veces.

**Qué cambia:**

- El diálogo recuerda lo escrito en cada pestaña mientras está abierto. Al agregar, graba juntas todas las pestañas con datos: todas o ninguna.
- La API suma un pedido que graba varios renglones en una sola transacción.
- Los límites del diálogo quedan iguales a los de la API.

**Lo que no se toca:** el `POST` de un renglón, la anulación, el `GET`, el reporte y el bloque Costos. CO-01 a CO-17 y FE-01 a FE-62 siguen igual y en verde.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Dos commits:**

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1 y 2 | `feat(api): varios costos en un solo pedido` |
   | 2 | 3 a 5 | `feat(front): costos en varias pestañas` |

3. **Pruebas:**
   - solo `test:costos` y `test:front`;
   - **no correr `test:todo`:** va en la corrida de la noche;
   - las pruebas existentes no se modifican, salvo el título de la suite de costos (sección 2.3).
4. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-c1-2-varios-costos.md`.

---

## 1. Decisión D-020

Agregar a `docs/decisiones.md`, después de D-019:

> ## D-020 — Varios costos en un guardado
>
> **Estado:** Aceptada
>
> 1. **Una pestaña por tipo.** Cada una recuerda lo escrito mientras el diálogo está abierto.
> 2. **Todas o ninguna.** Agregar graba las pestañas con datos en un solo pedido y una sola transacción. Si una falla, no se graba ninguna.
> 3. **Nada se descarta en silencio.** Una pestaña empezada e incompleta frena el guardado hasta que se complete o se vacíe. Cerrar el diálogo con datos pide confirmación.
> 4. **El total se controla una vez,** con todos los renglones juntos: un ajuste negativo puede ir con los costos que lo cubren.
> 5. **Un renglón por pestaña** en cada guardado. Dos personas de mano de obra son dos guardados (D-019, punto 3).

---

## 2. API: `POST /api/intervenciones/:id/costos/lote`

### 2.1 Pedido y respuesta

- **Cuerpo:** `{ "renglones": [ … ] }`. Cada elemento es el mismo cuerpo del `POST` de un renglón. La API no exige tipos distintos.
- **Respuesta:** 201 con `{ "renglones": [ … ] }`. Cada renglón va como lo devuelve el `POST` de uno, en el orden del pedido.
- **Tipos:** `CuerpoLoteCostos` y `LoteCostosRespuesta` en `api/tipos.ts`. El ejemplo `loteCreadoEjemplo` va en `api/contrato-costos.ts`.

### 2.2 Controles, en este orden

1. **Id de la ruta inválido:** 404, como el `POST` de uno.
2. **Forma del cuerpo,** antes de abrir la transacción:
   - si el cuerpo no es un objeto: 422 `DATOS_INVALIDOS`, como hoy;
   - si `renglones` falta, no es un arreglo, está vacío o tiene más de 5: 422 `DATOS_INVALIDOS`, "Debe mandar entre 1 y 5 renglones";
   - si un elemento no es un objeto: 422 `DATOS_INVALIDOS`, con `indice`.
3. **Bloqueo, visibilidad, estado y permisos:** igual que el `POST` de uno.
4. **Cada renglón, en orden:**
   - pasa por las mismas validaciones del `POST` de uno, incluidos el tope del importe calculado, la persona y el proveedor;
   - el primer error corta, y la respuesta agrega `indice`: la posición del renglón en el arreglo, desde 0. Por ejemplo, `{ "error": "…", "codigo": "PERSONA_INVALIDA", "indice": 1 }`.
5. **Inserta** todos los renglones, en orden.
6. **Recalcula una sola vez.** `TOTAL_NEGATIVO` y `TOTAL_FUERA_DE_RANGO` salen como hoy, sin `indice`.
7. **Auditoría:** con la intervención `FINALIZADA`, una por renglón, en orden, como la del `POST` de uno.
8. `COMMIT`.

**Cualquier error revierte todo.** No quedan renglones ni auditorías, y los costos de la intervención no cambian.

### 2.3 Cómo se hace

- **Un solo código para los dos `POST`:** pasar a una función lo que valida e inserta un renglón dentro de la transacción, y usarla en los dos `POST`.
  - El `POST` de uno no cambia ni su respuesta ni sus errores. CO-01 a CO-17 lo garantizan.
  - `indice` va solo en el lote.
- **Título de la suite:** "(CO-01 a CO-15)" pasa a "(CO-01 a CO-22)".

### 2.4 Pruebas

| ID | Qué prueba |
| :--- | :--- |
| CO-18 | **Lote en `EN_PROCESO`:** mano de obra interna con valor hora, transporte con proveedor, y ajuste de −100 con motivo. Da 201, con los tres en el orden del pedido, y los costos de la intervención quedan bien. La respuesta tiene la forma de `loteCreadoEjemplo` (`mismaForma`). |
| CO-19 | **Todo o nada, con `indice`.** Tres casos:<br>(a) `OTRO` válido y `TRANSPORTE` sin descripción: 422, `indice` 1;<br>(b) primero una mano de obra con una persona inactiva: 422 `PERSONA_INVALIDA`, `indice` 0;<br>(c) `OTRO` válido y una mano de obra de 100,01 h × 10.000.000: 422, `indice` 1.<br>En los tres no se guarda nada y `costo_total_estimado` no cambia. |
| CO-20 | **El total se controla una vez.** Con el total en 0, `TRANSPORTE` 1000 y `AJUSTE` −500 juntos: 201, total 500. Después, `OTRO` 100 y `AJUSTE` −1000: 409 `TOTAL_NEGATIVO`, con `total_resultante` −400 y sin `indice`. No se guarda nada. |
| CO-21 | **Cuerpo, estado y permisos.** Sin `renglones`, con `renglones` que no es un arreglo, con `[]`, con 6 renglones y con un elemento `null`: 422 (el último con `indice` 0). `PENDIENTE` y `CANCELADA`: 409. Sin `COSTOS_REGISTRAR`: 403. `FINALIZADA` sin `INTERVENCIONES_CORREGIR`: 403. Intervención no visible: 404. En ningún caso se guarda nada. |
| CO-22 | **`FINALIZADA`.** Dos renglones con motivo: 201 y dos auditorías "Se agregó: …", en orden y con el motivo. Si el segundo no tiene motivo: 422 `MOTIVO_REQUERIDO`, `indice` 1, sin renglones ni auditorías. |

---

## 3. El diálogo de costos

### 3.1 La lógica va en `lib/costos.ts`

El componente se queda con el estado y la pantalla. Funciones nuevas:

- **`BorradorCosto`:** lo que se escribe en una pestaña: externa, persona, proveedor, horas, valor hora, importe, descripción y motivo. El motivo es solo el del ajuste (sección 3.3).
- **`borradorVacio()`.**
- **`borradorEmpezado(b)`:** verdadero si algún campo tiene algo. No cuentan el selector Interna/Externa solo ni los textos con solo espacios.
- **`validarBorrador(tipo, b, { finalizada })`:** los mismos mensajes que da hoy el diálogo, más los límites de la sección 4.
- **`cuerposLote(borradores, { finalizada, motivoCorreccion })`:**
  - arma los cuerpos de las pestañas empezadas, en el orden de las pestañas, con `cuerpoCosto`;
  - con la intervención finalizada, el motivo de la corrección va en todos; si no, solo el ajuste lleva su motivo.
- **`textoBotonAgregar(n)`:** "Agregar costo" con 0 o 1, "Agregar 2 costos" con 2 o más.
- **`textoCostosAgregados(n)`:** "Costo agregado." con 1, "Se agregaron 3 costos." con más.

### 3.2 Pestañas

- **Cada pestaña tiene su borrador.** Cambiar de pestaña no borra nada, tampoco los errores de las otras.
- **Marca en la etiqueta de la pestaña:**
  - con datos, un punto del color de la marca;
  - con errores, un punto rojo;
  - en los dos casos, un texto oculto para lectores de pantalla: "con datos" o "con errores".
- **"Vaciar pestaña":** un botón chico que aparece solo en una pestaña empezada. Deja esa pestaña vacía y sin errores.
- **Título del diálogo:** "Agregar costos".

### 3.3 Motivo

- **Con la intervención finalizada:** un solo campo "Motivo de la corrección", debajo de las pestañas, para todos los costos. La pestaña Ajuste no muestra otro.
- **Si no:** "Motivo" va dentro de la pestaña Ajuste, como hoy, y es parte de su borrador.

### 3.4 Agregar

1. **Si no hay ninguna pestaña empezada,** valida la pestaña visible, como hoy.
2. **Si hay, valida todas las empezadas,** y el motivo de la corrección cuando corresponde. Si hay errores, no manda nada:
   - muestra cada error en su campo y marca las pestañas;
   - si la pestaña visible no tiene errores, pasa a la primera que tenga.
3. **Sin errores,** hace un solo `POST …/costos/lote` con las pestañas empezadas.
4. **Con 201:**
   - muestra el aviso de `textoCostosAgregados`;
   - actualiza el bloque, invalidando la misma clave que hoy;
   - cierra el diálogo.
5. **Con error,** no se pierde nada de lo escrito:
   - **con `indice`:** pasa a la pestaña de ese renglón. `PERSONA_INVALIDA`, `PROVEEDOR_INVALIDO` y `MOTIVO_REQUERIDO` muestran el error en su campo, como hoy; los demás, un aviso con el texto de la API;
   - **`TOTAL_NEGATIVO`:** pasa a la pestaña Ajuste, con el error en Importe, como hoy;
   - **otro error:** un aviso con el texto de la API, como hoy.

**El botón** dice `textoBotonAgregar(n)`, donde n es la cantidad de pestañas empezadas.

### 3.5 Cerrar

- **Sin pestañas empezadas,** cierra como hoy.
- **Con datos sin guardar,** sea una pestaña empezada o el motivo de la corrección escrito, Cancelar, la X, Escape y el clic afuera no cierran:
  - abajo, en lugar de los botones, aparece "Hay costos sin guardar. ¿Descartarlos?", con "Seguir cargando" y "Descartar";
  - va dentro del mismo diálogo, sin dependencias nuevas.
- **Mientras guarda,** el diálogo no se cierra.
- **Al abrir,** todo está vacío, como hoy.

### 3.6 Celular

A 390 px, las pestañas siguen en vertical, con sus marcas, y los botones de abajo no desbordan.

---

## 4. Límites del diálogo, iguales a los de la API

Hoy el diálogo deja pasar importes que la API rechaza, y el error llega como un aviso. Con esta corrección, el error queda debajo del campo:

| Campo | Límite | Mensaje |
| :--- | :--- | :--- |
| Importe | Hasta 1.000.000.000. En el ajuste, en valor absoluto. | "Hasta $ 1.000.000.000." |
| Valor hora | Hasta 10.000.000, no negativo y con dos decimales. | "Hasta $ 10.000.000." |
| Importe calculado (horas × valor hora) | Hasta 1.000.000.000. | "El importe calculado pasa de $ 1.000.000.000.", debajo de Valor hora. |

- **Importe:** el máximo va en `validarImporteCosto`. FE-60 sigue igual.
- **Valor hora:** lleva su propia función, `validarValorHora`.
  - Vacío es válido, porque es opcional.
  - Usa "No puede ser negativo." y "Hasta dos decimales.", igual que el importe.

### 4.1 Pruebas

| ID | Qué prueba |
| :--- | :--- |
| FE-63 | **`borradorVacio` y `borradorEmpezado`:** el vacío, solo Externa y solo espacios no cuentan; cualquier otro campo, sí. |
| FE-64 | **`validarBorrador`:**<br>- un caso por tipo, con los mensajes de hoy;<br>- el motivo del ajuste, solo sin finalizar;<br>- los tres límites de la sección 4, en el borde y un centavo arriba.<br>También `validarValorHora` y el máximo de `validarImporteCosto`. |
| FE-65 | **`cuerposLote`:**<br>- solo las pestañas empezadas, en el orden de las pestañas;<br>- con la finalizada, el motivo de la corrección en todos;<br>- sin finalizar, el motivo solo en el ajuste;<br>- con valor hora, no va el importe.<br>Cada cuerpo es igual al que da `cuerpoCosto` con el mismo borrador. |
| FE-66 | **`textoBotonAgregar` y `textoCostosAgregados`,** con 0, 1, 2 y 5. |

---

## 5. Documentación

En `CLAUDE.md`, "`test:todo` controla 15 tablas" pasa a 16. La tabla nueva es `intervencion_costos`, de la C1.1.

---

## 6. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 5 están hechas, en dos commits.
2. `test:costos` en verde, en Neon.
3. `npm run test:front`, `npm run typecheck` y `npm run build:frontend` sin errores.
4. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. Los dos hashes.
2. La salida final de `test:costos` y de `test:front`.
3. Typecheck y build.
4. `wc -l` de los archivos tocados.
5. **Qué probaste en pantalla y qué no.** Si no levantaste la app, decirlo.
6. Desvíos y dudas.
