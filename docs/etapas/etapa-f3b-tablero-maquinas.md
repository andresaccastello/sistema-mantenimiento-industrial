# Etapa F3b — Tablero y máquinas

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `b6f62d7` (Etapa F3a.1).
> **Base:**
>
> - `docs/front/mapa-pantallas.md`: pantallas R1, R4 y R5, y las reglas de la sección 1;
> - la API de la F3a (`docs/etapas/etapa-f3a-datos-maquina.md`);
> - lo ya hecho en la F2: la lista R2, el detalle R3 y los diálogos de `componentes/acciones/`.
>
> **Para qué:**
>
> - que el responsable vea de un vistazo cómo está la planta;
> - que cualquier usuario consulte las máquinas;
> - que quien tiene permiso las gestione desde el sistema, sin la interfaz provisional.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`.
2. **Dos commits**, para revisarlos por separado:
   1. sección 1: el agregado al backend y su prueba;
   2. todo lo demás.
3. **No se agregan dependencias.** Las de la F2 alcanzan: Mantine 9, `@mantine/dates` y `dayjs`.
4. **Documentación oficial a seguir:**
   - Mantine 9: `SimpleGrid`, `Card`, `Table`, `Badge`, `Modal`, `Select`, `MultiSelect`, `Switch`, `Menu` y `Alert`;
   - `@mantine/dates`: `DatePickerInput`;
   - React Router 7: `useSearchParams` y `useLocation`.
5. Lo que está en `lib/` sigue siendo lógica pura, sin React y sin `fetch`.
6. **Las reglas las decide el backend.** Las máquinas no tienen `acciones_disponibles`, así que los botones salen de los permisos y del estado (sección 3.3). Igual, todo error de la API se muestra según su `codigo`.
7. Ante cualquier duda o diferencia con el mapa de pantallas, **frenar y preguntar**.
8. Informe corto (sección 11).

Guardar este archivo como `docs/etapas/etapa-f3b-tablero-maquinas.md`.

---

## 1. Backend: filtro por planta en la lista de intervenciones (primer commit)

El tablero filtra por planta, y sus contadores llevan a la lista de intervenciones. Para que la lista muestre lo mismo que contó el tablero, `GET /api/intervenciones` necesita el mismo filtro.

- **Parámetro opcional `planta_id`:** filtra las intervenciones cuyas máquinas están en sectores de esa planta. Se combina con los demás filtros y con el alcance del usuario.
- **Valor inválido:** 422 `DATOS_INVALIDOS`, igual que `sector_id`. Usar la misma validación.
- **Planta inexistente:** la lista sale vacía, igual que con un sector inexistente.
- **Prueba MQ-11,** en `maquinas.test.ts`, con sus propias plantas, sectores, máquinas e intervenciones:
  - (a) con `planta_id` salen solo las de esa planta y `X-Total-Count` coincide;
  - (b) combinado con `estado`;
  - (c) con `abc`: 422.
- **Cierre del commit:**
  - `npm run test:todo -- etapa-f3b-backend` en verde, con 294 pruebas y los once números en 0;
  - mensaje: `feat(api): filtro por planta en la lista de intervenciones`.

---

## 2. Base del frontend

### 2.1 Tipos (`api/tipos.ts`)

Tipos nuevos, con la forma exacta de las respuestas:

- `TableroResumen`, con `maquinas`, `intervenciones` y `detenidas_ahora`;
- `DetencionAbiertaMaquina`, con `periodo` e `intervencion`;
- `InactividadMaquina`.

### 2.2 Mensajes de error (`lib/errores.ts`)

| `codigo` | Mensaje | ¿Recarga? |
| :--- | :--- | :-: |
| `CODIGO_MAQUINA_DUPLICADO` | Ya hay otra máquina con ese código. | no |
| `MAQUINA_CON_INTERVENCIONES_ABIERTAS` | No se puede desactivar: la máquina tiene intervenciones abiertas. | sí |
| `MAQUINA_CON_DETENCIONES_ABIERTAS` | La máquina tiene detenciones sin confirmar. | sí |
| `PLANTA_NO_ENCONTRADA` | No encontramos esa planta. | no |

`SIN_CAMBIOS` no cambia en el mapa general. En el diálogo de la sección 6.6 se muestra "La máquina ya está en ese estado.", se cierra el diálogo y se recarga.

"Recarga" quiere decir que se agrega a `requiereRecargar`: el diálogo se cierra y se vuelve a pedir la pantalla.

### 2.3 Componente `CriticidadBadge`

- Muestra el `nombre` del nivel.
- **Rojo** si `prioridad_alta`; **gris** en otro caso. Variante `light`, como los estados.
- Los niveles son configurables, así que el color no depende del código ni del nombre.

### 2.4 Invalidaciones de `useAccionIntervencion`

Además de lo que invalida hoy, invalida siempre `['maquina']` y `['tablero']`. Cualquier acción sobre una intervención puede cambiar el estado de la máquina.

---

## 3. Lógica pura nueva (`lib/`)

### 3.1 `lib/maquinasLista.ts`: filtros de R4

```ts
interface FiltrosMaquinas {
  texto: string;             // código, nombre o modelo
  estados: string[];         // de la máquina; vacío = todos
  criticidades: number[];    // ids; vacío = todas
  tipoEquipoId: number | null;
  sectorId: number | null;
  plantaId: number | null;
  inactivas: boolean;        // incluir desactivadas (solo con MAQUINAS_GESTIONAR)
}
```

| Función | Qué hace |
| :--- | :--- |
| `leerFiltrosMaquinas(params, puedeVerInactivas)` | **Claves:** `q`, `estado` (separados por coma), `criticidad` (ids separados por coma), `tipo`, `sector`, `planta` e `inactivas=1`.<br>**Valores inválidos:** se reemplazan por el de omisión, igual que en `leerFiltros`. `inactivas` sin permiso queda en `false`. |
| `escribirFiltrosMaquinas(filtros)` | Sin las claves que tienen su valor por omisión. Ida y vuelta da lo mismo. |
| `filtrarMaquinas(maquinas, filtros)` | Aplica todos los filtros:<br>• el texto con `normalizarTexto` (sin tildes ni mayúsculas) sobre código, nombre y modelo;<br>• la planta, por `sector.planta`;<br>• `inactivas: false` deja solo las activas.<br>Conserva el orden de entrada. |
| `hayFiltrosMaquinas(filtros)` | `true` si hay algún filtro. `inactivas` no cuenta. |

### 3.2 `lib/tablero.ts`

**`enlacesTablero(plantaId)`** devuelve el destino de cada contador. Si hay planta, todos llevan `planta=<id>`.

| Contador | Destino |
| :--- | :--- |
| Máquinas operativas, detenidas, en mantenimiento, fuera de servicio | `/maquinas?estado=<ESTADO>` |
| Sin asignar | `/intervenciones?vista=sin-asignar` |
| En proceso | `/intervenciones?estado=EN_PROCESO` |
| Esperando repuestos | `/intervenciones?estado=EN_ESPERA_REPUESTOS` |
| Asignadas a mí | `/intervenciones?vista=mias` |

**`contadoresIntervencion(permisos)`** devuelve qué contadores de intervenciones se muestran:

- "Sin asignar" y "Asignadas a mí" siguen la regla de `vistasDisponibles` (pestañas de R2);
- "En proceso" y "Esperando repuestos" se muestran siempre.

### 3.3 `lib/maquinas.ts` (se agrega)

**`accionesMaquina(maquina, permisos, cantidadDetencionesAbiertas)`** devuelve, en este orden, las acciones que corresponden:

| Acción | Se muestra si |
| :--- | :--- |
| `CONFIRMAR_RECUPERACION` | tiene `INTERVENCIONES_CONFIRMAR_RECUPERACION` y hay detenciones abiertas visibles |
| `REPORTAR_FALLA` | tiene `INTERVENCIONES_CREAR` y la máquina está activa |
| `FUERA_DE_SERVICIO` | tiene `MAQUINAS_CAMBIAR_ESTADO`, está activa y su estado no es `FUERA_DE_SERVICIO` |
| `VOLVER_A_SERVICIO` | tiene `MAQUINAS_CAMBIAR_ESTADO` y su estado es `FUERA_DE_SERVICIO` |
| `EDITAR` | tiene `MAQUINAS_GESTIONAR` |
| `DESACTIVAR` | tiene `MAQUINAS_GESTIONAR` y está activa |
| `REACTIVAR` | tiene `MAQUINAS_GESTIONAR` y está desactivada |

**Botón principal:**

- `CONFIRMAR_RECUPERACION`, si está;
- si no, `REPORTAR_FALLA`, si está;
- si no, ninguno.

`DESACTIVAR` y `REACTIVAR` van en el menú "Más acciones". El resto, como botones.

**`motivoNoDesactivable(maquina, cantidadDetencionesAbiertas)`** devuelve el texto o `null`:

- con `intervenciones_abiertas > 0`: "Tiene {n} intervención/intervenciones abierta(s). Cerralas o cancelalas antes de desactivarla.";
- con detenciones abiertas: "Tiene detenciones sin confirmar. Confirmá que volvió a funcionar antes de desactivarla.".

**`rangoUltimosDias(dias, ahora)`** devuelve `{ desde, hasta }` en formato `YYYY-MM-DD`. `hasta` es el día de `ahora` y `desde`, `dias − 1` días antes. Con 30 días, son 30 días contando hoy.

### 3.4 `lib/listado.ts` (se agrega la planta a R2)

- `FiltrosIntervenciones` suma `plantaId: number | null`, con la clave `planta` en la dirección.
- `paramsListado` manda `planta_id`.
- `hayFiltros` la cuenta.

---

## 4. R1 — Tablero (`/tablero`)

### 4.1 Datos

`GET /api/tablero`, con `planta_id` si hay una planta elegida. Se refresca cada 60 segundos, como las listas.

### 4.2 Encabezado

- Título "Tablero".
- **Selector de planta,** solo si hay dos plantas activas o más (`GET /api/plantas`):
  - opciones "Todas las plantas" más cada planta;
  - el valor va en la dirección (`?planta=`), así se puede volver y compartir.

### 4.3 Contadores

Dos filas de tarjetas (`SimpleGrid`, 4 columnas en computadora y 2 en celular). Cada tarjeta muestra el número grande y el texto, y es un enlace a `enlacesTablero` (sección 3.2).

| Fila | Tarjetas |
| :--- | :--- |
| **Máquinas** | Operativas · Detenidas · En mantenimiento · Fuera de servicio. Con el color y el ícono de la tabla única de estados. |
| **Intervenciones** | Sin asignar · En proceso · Esperando repuestos · Asignadas a mí. Solo las que da `contadoresIntervencion`. |

Una tarjeta en 0 se muestra igual, en gris.

### 4.4 "Detenidas ahora"

Tabla, en el orden en que la manda la API: criticidad primero y después la que lleva más tiempo detenida.

| Columna | Contenido |
| :--- | :--- |
| Máquina | `etiquetaMaquina`. Es un enlace a R5. |
| Criticidad | `CriticidadBadge` |
| Sector | El sector y, debajo, la planta si tiene. |
| Detenida desde | Fecha y hora; debajo, "hace …". |
| Inactividad | `formatDuracion` con la marca "en curso", como la columna Tiempo de R2. |
| Abiertas | Cantidad de intervenciones abiertas. |

**Sin máquinas detenidas:** se ve un ícono de verificación y "No hay máquinas detenidas.".

### 4.5 Celular

- Contadores en 2 columnas.
- La tabla se desplaza dentro de su contenedor, como R2, sin desborde de la página.

---

## 5. R4 — Máquinas (`/maquinas`)

### 5.1 Datos

- `GET /api/maquinas`. Con "Ver desactivadas", `GET /api/maquinas?all=true`. Clave de consulta `['maquinas', { all }]`.
- Catálogos: `GET /api/criticidades`, `/api/tipos-equipo`, `/api/plantas` y `/api/sectores`.
- **Los filtros se aplican en el frontend** (`filtrarMaquinas`) y van en la dirección.
- No hay paginación.

### 5.2 Encabezado y filtros

- **Encabezado:** título "Máquinas" y, con `MAQUINAS_GESTIONAR`, el botón "Nueva máquina" (sección 6.8).
- **Filtros:** en `SimpleGrid`, como R2, cada uno con su `aria-label`:
  - Buscar (código, nombre o modelo);
  - Estado (varios);
  - Criticidad (varios);
  - Tipo;
  - Sector;
  - Planta, solo si hay dos o más.

  Elegir una planta deja en Sector solo los sectores de esa planta y borra el sector elegido si no es de ella.
- **"Ver desactivadas":** un `Switch`, solo con `MAQUINAS_GESTIONAR`.
- **Línea del conteo:** "{n} máquinas" y "Limpiar filtros", como en R2.

### 5.3 Tabla

| Columna | Contenido |
| :--- | :--- |
| Máquina | `etiquetaMaquina` y, debajo, el modelo en gris si tiene. Una máquina desactivada lleva el distintivo "Desactivada" y la fila en gris. |
| Criticidad | `CriticidadBadge` |
| Tipo | `tipo_equipo.nombre` |
| Sector | El sector y, debajo, la planta. |
| Estado | `EstadoBadge` y, debajo, "desde hace …" (`estado_desde`). |
| Abiertas | La cantidad. Si es mayor que 0, es un enlace a `/intervenciones?maquina=<id>`. |

- **Al tocar una fila** se abre R5. Se pasa `volverA` con la dirección actual, como en R2, así "← Máquinas" vuelve con los filtros.
- **Sin máquinas:** "Todavía no hay máquinas cargadas.", más "Nueva máquina" si tiene permiso.
- **Sin resultados con filtros:** "No hay máquinas con estos filtros." y "Limpiar filtros".

---

## 6. R5 — Detalle de máquina (`/maquinas/:id`)

### 6.1 Datos

| Consulta | Clave | Cuándo |
| :--- | :--- | :--- |
| `GET /api/maquinas/:id` | `['maquina', id]` | siempre |
| `GET /api/maquinas/:id/detenciones-abiertas` | `['maquina', id, 'detenciones']` | con `INTERVENCIONES_VER` |
| `GET /api/intervenciones?maquina_id=:id&limit=10` | `['intervenciones', { maquina: id }]` | con `INTERVENCIONES_VER` |
| `GET /api/maquinas/:id/inactividad?desde&hasta` | `['maquina', id, 'inactividad', desde, hasta]` | con `REPORTES_CONSULTAR` |

Se refresca cada 60 segundos. Si la máquina no existe (404): "No encontramos esta máquina." y "Volver a Máquinas".

### 6.2 Cabecera

- **Volver:** "← Máquinas", a `volverA` o a `/maquinas`.
- **Título:** `etiquetaMaquina`.
- **Al lado del título:**
  - `CriticidadBadge`;
  - `EstadoBadge` y "desde {fecha y hora} · hace …";
  - "Desactivada", si corresponde.
- **Barra de acciones:** siempre **debajo** del título, como en R3. Las acciones salen de `accionesMaquina`. Botón principal, los demás botones y el menú "Más acciones" (sección 3.3).

### 6.3 Distribución (como R3)

| Columna | Bloques |
| :--- | :--- |
| Izquierda (8 de 12) | **Detenciones abiertas** (6.4) · **Intervenciones de esta máquina** (6.9) · **Inactividad** (6.10) |
| Derecha (4 de 12) | **Datos:**<br>• código y modelo;<br>• tipo de equipo y criticidad;<br>• sector y planta;<br>• ubicación;<br>• notas de mantenimiento (`observaciones`), con los saltos de línea;<br>• alta (`creado_en`).<br>Un dato vacío se muestra como "—". |

En celular, una sola columna, con "Datos" primero.

### 6.4 Detenciones abiertas

- **Sin detenciones abiertas:** el bloque no se muestra.
- **Por cada detención:**
  - "desde {fecha y hora} · hace … · **sigue detenida**";
  - la observación y quién la abrió;
  - la intervención como enlace ("Intervención N.º {id}"), con su `EstadoBadge` y su responsable o "Sin asignar".

### 6.5 Confirmar que volvió a funcionar

`ModalConfirmarRecuperacion` pasa a recibir **una lista** de períodos: `periodos: { id: number; desde: string }[]`, al menos uno.

- **Mínimo de "¿Desde cuándo funciona?":** el `desde` más reciente de la lista.
- **Pedido:** manda todos los `periodo_ids`.
- **Con más de uno,** arriba del formulario: "Se confirman las {n} detenciones abiertas de esta máquina.".
- **Desde R3:** se pasa `[periodo]`. El comportamiento no cambia.
- **Desde R5:** se pasan todas las detenciones abiertas que se ven.

Si después de confirmar la máquina sigue detenida (por detenciones que este usuario no ve), la cabecera lo muestra solo después de recargar. No hace falta un aviso aparte.

### 6.6 Fuera de servicio y vuelta a servicio

Un diálogo con "Motivo" (obligatorio, al menos 5 caracteres) y `POST /api/maquinas/:id/estado`.

| Acción | Envía | Aviso |
| :--- | :--- | :--- |
| `FUERA_DE_SERVICIO` | `accion: 'FUERA_DE_SERVICIO'` | "La máquina quedó fuera de servicio." |
| `VOLVER_A_SERVICIO` | `accion: 'REACTIVAR'` | "La máquina volvió a servicio: {estado}.", con el estado que devuelve la API. Puede quedar "Detenida" si tiene detenciones abiertas. |

En el diálogo de fuera de servicio, una línea de ayuda: "Mientras esté fuera de servicio, su tiempo no cuenta como inactividad."

### 6.7 Desactivar y reactivar

**Desactivar:**

- Diálogo de confirmación: "La máquina deja de aparecer en las listas y en Reportar falla. Su historial se conserva."
- Si `motivoNoDesactivable` devuelve un texto, el diálogo muestra ese texto en un `Alert` y solo el botón "Volver".
- Un 409 de la API (por ejemplo, alguien reportó una falla mientras tanto) se muestra con el mensaje de 2.2 y se recarga.

**Reactivar:** confirmación simple y `PUT` con `activo: true`. El 400 de "sector inactivo" se muestra dentro del diálogo.

### 6.8 Alta y edición (`ModalMaquina`, compartido por R4 y R5)

**Campos:**

| Campo | Control | Reglas |
| :--- | :--- | :--- |
| Nombre | texto | obligatorio |
| Código | texto | opcional. Un `CODIGO_MAQUINA_DUPLICADO` se muestra **en este campo**. |
| Sector | `Select` | Obligatorio. Con dos o más plantas, la opción es "Sector · Planta". |
| Criticidad | `Select` | En el alta empieza en la de `por_omision`. |
| Tipo de equipo | `Select` | En el alta empieza en el de `por_omision`. |
| Marca y modelo | texto | opcional (`modelo`) |
| Ubicación | texto | opcional |
| Notas de mantenimiento | área de texto | opcional (`observaciones`) |

**Alta:**

- `POST /api/maquinas`, sin `criticidad_id` ni `tipo_equipo_id` si quedaron en el valor por omisión.
- Al guardar, aviso "Máquina creada." y se abre su R5.

**Edición:**

- `PUT` **solo con los campos que cambiaron**. Un campo opcional vaciado se manda como `""`.
- Aviso "Cambios guardados.".

**Valor que ya no está en el catálogo:** si la máquina tiene una criticidad o un tipo desactivado, igual aparece como opción, con "(inactivo)". Así se puede guardar sin cambiarlo.

### 6.9 Intervenciones de esta máquina

- Tabla con las últimas 10, en el orden de la API: N.º, Estado, Falla (descripción corta), Reportada ("hace …") y Responsable.
- Cada fila lleva a R3.
- **Debajo:**
  - "Ver abiertas", a `/intervenciones?maquina=<id>`;
  - "Ver cerradas", a `/intervenciones?vista=cerradas&maquina=<id>`;
  - el total (`X-Total-Count`).
- **Sin intervenciones:** "Esta máquina no tiene intervenciones.".

### 6.10 Inactividad

Solo con `REPORTES_CONSULTAR`.

- **Período:** `DatePickerInput` de rango con `allowSingleDateInRange`. Empieza en `rangoUltimosDias(30, ahora)` y se manda con `rangoDiasAIso`.
- **Totales:**
  - "Detenida" (`inactividad_minutos`), grande;
  - debajo, "Correctiva" y "Preventiva";
  - "Fuera de servicio (no cuenta): …", si es mayor que 0.
- **Lista de períodos del rango:**
  - desde → hasta, o "sigue detenida";
  - el tipo;
  - la intervención como enlace.
- **Sin períodos:** "Sin detenciones en este período.".
- **Período de más de 366 días:** el `DATOS_INVALIDOS` de la API se muestra debajo del selector.

---

## 7. Otros cambios

1. **R2:**
   - filtro "Planta", con `aria-label` y solo si hay dos plantas o más;
   - elegir una planta deja en Sector solo los sectores de esa planta;
   - con la planta visible, el `SimpleGrid` pasa a `xl: 6`.
2. **R3:** en "Datos", el nombre de la máquina es un enlace a su R5.
3. **Avisos (C3):** un aviso sin `intervencion_id` pero con `maquina_id` lleva a R5.
4. **Rutas:**
   - `/tablero`, `/maquinas` y `/maquinas/:id` reemplazan a "En construcción";
   - `/tablero` mantiene `INTERVENCIONES_VER`;
   - `/maquinas` y `/maquinas/:id` son para cualquier usuario con sesión: cada bloque y cada botón dependen de los permisos.

---

## 8. Quién ve qué

| Perfil | R1 | R4 | R5 |
| :--- | :--- | :--- | :--- |
| Responsable | todo | todo, sin "Nueva máquina" | detenciones, intervenciones e inactividad; confirmar, reportar falla, fuera de servicio y vuelta |
| Administrador | todo | todo | todo |
| Consulta | contadores y detenidas (enlaces de solo lectura) | lista | datos, detenciones, intervenciones e inactividad, sin botones |
| Operario | no está en su menú ("Inicio" lo lleva a sus reportes) | lista | datos, sus intervenciones y "Reportar falla" |

La tabla es la consecuencia de los permisos actuales de cada perfil, no una regla aparte.

---

## 9. Pruebas del frontend

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| FE-27 | `leerFiltrosMaquinas` y `escribirFiltrosMaquinas` | Dirección vacía: valores por omisión. `estado=ROTA`: sin estados. `criticidad=1,abc`: `[1]`. `inactivas=1` sin permiso: `false`; con permiso: `true`. Ida y vuelta con todos los campos: lo mismo. Los valores por omisión se escriben sin claves. |
| FE-28 | `filtrarMaquinas` y `hayFiltrosMaquinas` | Con cinco máquinas de prueba:<br>• "fresádora" encuentra "Fresadora";<br>• el código y el modelo también se buscan;<br>• por planta, a través de `sector.planta`;<br>• una desactivada solo aparece con `inactivas`;<br>• el orden de entrada se conserva.<br>`hayFiltrosMaquinas` es `false` con solo `inactivas`. |
| FE-29 | `enlacesTablero` y `contadoresIntervencion` | Sin planta: los destinos de la tabla 3.2. Con planta 7: todos llevan `planta=7`. RESPONSABLE: los cuatro contadores. CONSULTA: solo "En proceso" y "Esperando repuestos". |
| FE-30 | `accionesMaquina` y `motivoNoDesactivable` | **RESPONSABLE,** máquina activa detenida con 1 detención: `CONFIRMAR_RECUPERACION`, `REPORTAR_FALLA`, `FUERA_DE_SERVICIO`, y el principal es `CONFIRMAR_RECUPERACION`.<br>**ADMINISTRADOR,** máquina activa fuera de servicio sin detenciones: exactamente `REPORTAR_FALLA`, `VOLVER_A_SERVICIO`, `EDITAR` y `DESACTIVAR`, y el principal es `REPORTAR_FALLA`.<br>**Desactivada:** `REACTIVAR` y no `REPORTAR_FALLA`.<br>**OPERARIO:** solo `REPORTAR_FALLA`.<br>**`motivoNoDesactivable`:**<br>• con 2 abiertas: el texto con "2 intervenciones abiertas";<br>• con 1: en singular;<br>• con detenciones: el otro texto;<br>• sin nada: `null`. |
| FE-31 | `rangoUltimosDias` | `(30, new Date(2026, 10, 3, 15, 0))` → `{ desde: '2026-10-05', hasta: '2026-11-03' }`. Cruza bien el cambio de mes. |
| FE-22 y FE-23 (se amplían) | `planta` en R2 | `planta=abc` → `null`. La ida y vuelta incluye la planta. `paramsListado` manda `planta_id`. `hayFiltros` con planta → `true`. |

---

## 10. Lo que voy a revisar yo

Con el backend y el frontend contra mi base local, que ya tiene dos plantas, niveles de criticidad y máquinas en todos los estados. Capturas a 1440×900 y 390×844.

- **R1:**
  - cada contador comparado con la base, con y sin planta;
  - cada enlace abre la lista con lo mismo que contó;
  - el orden de "Detenidas ahora";
  - el refresco.
- **R4:**
  - cada filtro, combinado con otros;
  - la búsqueda sin tildes;
  - "Ver desactivadas";
  - volver desde R5 con los filtros.
- **R5, cada acción contra la base:**
  - confirmar con una y con dos detenciones abiertas;
  - fuera de servicio y vuelta, con y sin detenciones;
  - editar vaciando campos;
  - código repetido;
  - desactivar con trabajo abierto (no tiene que dejar) y sin;
  - reactivar;
  - alta con los valores por omisión;
  - la inactividad comparada con `fn_inactividad_maquina`.
- **Perfiles:** Responsable, Consulta y Operario, según la tabla 8.
- **R2 con planta,** **R3 con el enlace a la máquina** y el **recorrido completo de la F2**, para ver que nada cambió.
- **Celular:** desborde, barra de acciones y diálogos a pantalla completa.

---

## 11. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 9 están hechas, en dos commits (regla 2).
2. `npm run test:front` en verde (FE-01 a FE-31).
3. `npm run test:todo -- etapa-f3b`:
   - en verde, con **294** pruebas y los once números en 0;
   - corrido dos veces seguidas;
   - el log de la segunda va en `docs/evidencia/`.
4. `npm run typecheck` y `npm run build:frontend` sin errores.
5. Push de los dos commits en `feat/base-neon`.

**Informe corto:**

1. Los hashes de los dos commits.
2. Las salidas de las pruebas:
   - la salida final de `test:front`;
   - de las dos corridas de `test:todo`, la línea de total y la de datos que quedaron.
3. Typecheck y build, con el tamaño del JS.
4. Desvíos, incluido todo lo que no se haya hecho.
5. Dudas.
