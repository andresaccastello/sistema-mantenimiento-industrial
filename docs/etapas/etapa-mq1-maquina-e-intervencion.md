# Etapa MQ1 — Máquina, intervención y proveedores

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** AV1 terminada.
> **Origen:** la entrevista con GI-RE del 19/11.

**Seis cosas chicas, todas pedidas por GI-RE:**

| N.º | Qué | Qué dijo GI-RE |
| :-: | :--- | :--- |
| 1 | Documentos de la máquina como enlaces: manuales, fotos, videos, instructivos, planos | "Todo lo documental asociado a esa máquina, como una wiki". |
| 2 | "Participaron" a la vista en la intervención | "¿Cómo sé quién hizo la reparación?" |
| 3 | Exportar el historial de intervenciones filtrado | "Del torno 23, todo lo de 2026". |
| 4 | Alta rápida de un repuesto de una sola vez desde la intervención | "Hasta que desarmo el balancín no sé qué resorte es". |
| 5 | Código SAE del proveedor y su ficha a un clic | "Que con un clic me lleve a la ficha del proveedor". |
| 6 | El servidor dice "corriendo" solo cuando ya escucha | Detalle técnico. |

**Qué no entra:**
- **subir archivos:** el almacenamiento lo resuelve SAE, con Daniel. Acá se guarda el enlace;
- **la ficha del proveedor dentro de SAE:** acá se muestra la ficha propia.

---

## 0. Reglas de trabajo

1. **Leé `CLAUDE.md` entero y seguí sus reglas.**
   - **Nunca abras, leas, muestres ni modifiques `.env`.**
   - Rama `feat/base-neon`. **No se agregan dependencias.**
2. **Dos commits.** Cada uno tiene que pasar `npm run typecheck` solo:

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1, 2, 3, 5 y 7.1 | `feat(api): documentos de la máquina, participantes, exportación y proveedores` |
   | 2 | 4 y 7.2 | `feat(front): documentos, participantes, exportación, alta rápida y ficha del proveedor` |

3. **Pruebas:**
   - **en Neon:**
     - la migración nueva y `test:maquina-extras` (nueva, `backend/tests/maquina_extras.test.ts`, IDs MX-xx);
     - `test:maquinas`, `test:intervenciones`, `test:api-front`, `test:costos`, `test:repuestos`, `test:pedidos-compras` y `test:administracion`;
   - **además:** `test:front`, `typecheck` y `build:frontend`;
   - **no correr `test:todo`.**
4. **Pruebas existentes:** se autoriza cambiar solo las que comparan entero el detalle de una intervención o de un proveedor, para sumar `participantes` y `codigo_externo`. **Lo que ya se esperaba no cambia.**
5. **Ante cualquier duda, frenar y preguntar.**
6. **Los números:** la decisión es la **siguiente libre después de AV1**, y la migración y las FE, las siguientes libres. Anotalos en el informe.

Guardar este archivo como `docs/etapas/etapa-mq1-maquina-e-intervencion.md`.

---

## 1. Documentos de la máquina (primer commit)

### 1.1 La tabla `maquina_documentos`

| Columna | Tipo | Regla |
| :--- | :--- | :--- |
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PK |
| `maquina_id` | `BIGINT NOT NULL` | FK a `maquinas` |
| `titulo` | `VARCHAR(150) NOT NULL` | `btrim <> ''` |
| `tipo` | `VARCHAR(12) NOT NULL` | `CHECK IN ('MANUAL', 'FOTO', 'VIDEO', 'INSTRUCTIVO', 'PLANO', 'OTRO')` |
| `url` | `VARCHAR(1000) NOT NULL` | `CHECK (url ~* '^https?://')` |
| `notas` | `VARCHAR(500) NULL` | |
| `creado_por_usuario_id` | `BIGINT NOT NULL` | FK a `usuarios` |
| `creado_en`, `actualizado_en` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |

- **Índice por `maquina_id`.**
- **Sumar la tabla a `TABLAS_CONTROL`**, y actualizar la cuenta de tablas en `CLAUDE.md`.

### 1.2 La API

| Método y ruta | Quién | Qué hace |
| :--- | :--- | :--- |
| `GET /api/maquinas/:id/documentos` | Quien puede ver la máquina | Lista por tipo y título. |
| `POST /api/maquinas/:id/documentos` | `DOCUMENTOS_GESTIONAR` (ya existe; lo tienen el administrador y el responsable) | Alta, `{ titulo, tipo, url, notas? }`. |
| `PATCH /api/documentos/:id` | `DOCUMENTOS_GESTIONAR` | Edición, con los mismos campos opcionales. |
| `DELETE /api/documentos/:id` | `DOCUMENTOS_GESTIONAR` | Borra de verdad: es solo un enlace. |

**Validación,** con 422 `DATOS_INVALIDOS`:
- `trim` en todos los textos;
- la `url` tiene que empezar con `http://` o `https://`. Así se rechazan `javascript:` y `data:`;
- largos máximos como en la tabla.

**Errores:**
- un documento que no existe da 404 `DOCUMENTO_NO_ENCONTRADO`;
- en una máquina inactiva se puede ver la lista, pero no agregar documentos: 422.

### 1.3 La decisión

**D-0xx — Documentos de la máquina como enlaces.** Reemplaza lo que la D-027 decía de los documentos.

1. **Cada máquina tiene una lista de documentos:** título, tipo, enlace y notas.
2. **El archivo vive afuera:** en el almacenamiento de SAE, en una carpeta compartida o en la web del fabricante. El sistema guarda solo el enlace.
3. **Solo se aceptan enlaces `http` o `https`.**

**Motivo:** GI-RE pidió tener los manuales, fotos e instructivos a mano desde la máquina. Guardar archivos pesados en la base no tiene sentido, y el almacenamiento ya lo está resolviendo SAE.

---

## 2. Participantes y exportación (primer commit)

### 2.1 Quién participó

**El detalle de la intervención suma `participantes`:**

```jsonc
"participantes": {
  "internos": [ { "id", "legajo", "nombre", "apellido" } ],
  "externos": [ { "id", "nombre" } ]
}
```

- **Quiénes entran como internos:**
  - el responsable;
  - los usuarios de los renglones de mano de obra **vigentes** (sin anular).
- **Quiénes entran como externos:** los proveedores de los renglones de mano de obra vigentes.
- **Sin repetidos.** Los internos, por apellido y nombre; los externos, por nombre.
- **No lleva montos ni horas,** así que se ve sin `COSTOS_VER`.

### 2.2 Exportar el historial

**`GET /api/intervenciones/exportar`**
- **Filtros:** los mismos que el listado (estado, planta, sector, máquina, tipo y "reportadas entre"), con la misma visibilidad (`INTERVENCIONES_VER` y su alcance).
- **Responde un CSV** pensado para Excel en castellano:
  - UTF-8 con BOM;
  - `;` como separador;
  - `,` como separador decimal;
  - las fechas como `dd/mm/aaaa hh:mm`.
- **El nombre del archivo:** `intervenciones-AAAA-MM-DD.csv`.
- **Las columnas:**
  - número, tipo, estado y máquina (código y nombre);
  - sector y planta;
  - fechas de creación, inicio y fin;
  - responsable, participantes y descripción;
  - tiempo de detención en horas.
  - **Con `COSTOS_VER`,** además el costo total.
- **Máximo 5.000 filas.** Si hay más, responde 422 `DEMASIADOS_RESULTADOS` con el total, para que se achique el filtro.
- **Seguridad del CSV:** los textos que empiezan con `=`, `+`, `-` o `@` llevan un `'` adelante, para que Excel no los tome como fórmulas.

## 3. Proveedores (primer commit)

**`proveedores.codigo_externo`:**
- `VARCHAR(40) NULL`, con único sobre `upper(trim(codigo_externo))` entre los que no son nulos;
- un repetido da 409 `CODIGO_DUPLICADO`;
- se suma al alta, la edición y la respuesta del proveedor.

**`GET /api/proveedores/:id/ficha`:**
- **Lo puede ver quien tenga alguno de los permisos de `/opciones`.**
- **Devuelve** `{ id, nombre, codigo_externo, contacto, telefono, email, notas, activo }`.
- **Para qué:** la ficha a un clic desde cualquier lugar donde aparece un proveedor.

## 5. El servidor (primer commit)

**En `backend/server.ts`,** el mensaje "Servidor corriendo en http://localhost:3000" se muestra en el callback de `serve`, cuando ya está escuchando.

**Si el puerto está ocupado (`EADDRINUSE`),** se muestra "El puerto 3000 ya está en uso: cerrá el otro servidor" y el proceso sale con código 1. No arranca el `setInterval`.

---

## 4. Pantallas (segundo commit)

### 4.1 La ficha de la máquina: `componentes/maquinas/BloqueDocumentosMaquina.tsx`

- **La lista se agrupa por tipo,** con un ícono por tipo.
- **Cada documento** abre en una pestaña nueva, con `target="_blank"` y `rel="noopener noreferrer"`. **Nunca se incrusta** (nada de `iframe`, `img` ni `video` con esa URL).
- **Con `DOCUMENTOS_GESTIONAR`:** "Agregar documento", editar y borrar, con confirmación.
- **La ayuda del formulario:** "Pegá el enlace al archivo (en SAE, una carpeta compartida o la web del fabricante)".

### 4.2 La intervención

- **Debajo de los datos de la intervención,** una línea "Participaron: L. Pérez, M. Gómez · Servicios Eléctricos Ramírez".
- **Los nombres de los externos** abren la ficha del proveedor (4.4).
- **Sin participantes,** no se muestra la línea.

### 4.3 Intervenciones

- **En la lista,** un botón "Exportar" con los filtros que estén puestos.
- **En la ficha de la máquina,** el enlace "Ver todas" ya filtra por la máquina. Ahí también se puede exportar.
- **Con 422 `DEMASIADOS_RESULTADOS`:** "Son N intervenciones; acotá el filtro (máximo 5.000)".

### 4.4 La ficha del proveedor: `componentes/repuestos/FichaProveedor.tsx`

- **Un `Popover`, o un modal en el celular,** con:
  - nombre y código SAE;
  - contacto;
  - teléfono como `tel:`;
  - email como `mailto:`;
  - notas.
- **Se abre tocando el nombre del proveedor** en estos lugares:
  - el detalle del repuesto (proveedor habitual);
  - los pedidos;
  - los renglones de mano de obra externa;
  - "Participaron".
- **En la pestaña Proveedores y en su modal,** el campo nuevo "Código en SAE".

### 4.5 Alta rápida de un repuesto

- **En `ModalConsumo` y en `ModalPedido`,** debajo del selector de repuesto, va el enlace **"No está en la lista: crear repuesto"**. Solo lo ve quien tiene `REPUESTOS_GESTIONAR`.
- **Abre un formulario corto:** nombre, unidad y costo unitario (opcional), **sin control de stock**, y el proveedor como opcional.
- **Usa el `POST /api/repuestos` que ya existe.** Al guardar, el repuesto nuevo queda elegido en el selector. Sin backend nuevo.

**Las reglas de pantalla:**
- **modo claro y modo oscuro,** solo con variables `--sm-*`;
- **a 390 px, nada se sale de costado.**

**FE nuevas:**
- la etiqueta y el ícono de cada tipo de documento;
- el texto de "Participaron";
- armar la URL de exportación con los filtros;
- el armado del cuerpo del alta rápida.

---

## 7. Pruebas

### 7.1 `test:maquina-extras` (MX), y la migración

**De la migración:** la tabla, sus `CHECK` (una URL `javascript:` falla en la base), el código del proveedor con su único, y que se pueda reaplicar.

| N.º | Qué se prueba |
| :-: | :--- |
| MX-01 | Documentos: alta, edición y borrado con `DOCUMENTOS_GESTIONAR`; sin el permiso, 403; ver la lista sin el permiso, sí. |
| MX-02 | Validaciones: URL `javascript:`, `data:` o sin esquema dan 422; título vacío o largo, y tipo inválido, 422; máquina inactiva, 422 al agregar. |
| MX-03 | Participantes: responsable más dos internos y dos externos en renglones de mano de obra, uno de ellos anulado. Salen sin repetidos, sin el anulado, en orden, y sin `COSTOS_VER`. |
| MX-04 | Exportar: respeta filtros y alcance; tiene BOM, `;` y decimales con coma; el costo total sale solo con `COSTOS_VER`. |
| MX-05 | Exportar: una descripción que empieza con `=` sale con el `'` adelante. Más de 5.000 filas da 422 (con un límite que la prueba pueda forzar, sin crear 5.000 filas). |
| MX-06 | Proveedores: código repetido (sin distinguir mayúsculas) da 409. La ficha con permiso sale bien; sin ninguno de los permisos, 403; un proveedor inexistente, 404. |

**El mensaje de `server.ts`:** se prueba a mano y se describe en el informe. No va con una prueba automática.

### 7.2 El front

Las FE de la sección 4.

---

## 8. Cierre e informe

**Criterios de cierre:**
1. Las secciones 1 a 7 están hechas, en dos commits que compilan solos.
2. Las pruebas de la regla 3 están en verde, en Neon.
3. Se hizo push en `feat/base-neon`.

**El informe.** Las salidas van pegadas tal cual:
1. Los hashes y los números que se usaron.
2. La salida de cada suite, el typecheck y el build.
3. Las pruebas existentes que se tocaron, con una línea por cada una.
4. Un CSV de ejemplo de 3 filas, con datos de prueba.
5. Los desvíos y las dudas.
