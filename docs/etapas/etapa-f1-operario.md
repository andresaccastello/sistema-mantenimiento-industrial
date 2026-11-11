# Etapa F1 — Pantallas del operario

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `0c31c59` (Etapa F0.1).
> **Base:** `docs/front/mapa-pantallas.md` (pantallas O1, O2 y O3; reglas generales de la sección 1), `docs/relevamiento-requisitos-derivados.md` (carga mínima para el operario) y `docs/etapas/etapa-f0-base-frontend.md`.
> **Para qué:** que quien detecta una falla pueda reportarla en menos de un minuto y después seguir cómo avanza, sin depender de avisos de palabra.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`.
2. Esta etapa tiene **una parte chica de backend** (sección 1) y el resto es frontend. Fuera de lo que dice la sección 1, no se toca el backend.
3. **No se agregan dependencias.** Todo lo de esta etapa se hace con lo que ya está instalado. `Select`, `Timeline` y `Modal` vienen en `@mantine/core`.
4. Seguir la documentación oficial de **Mantine 9** (mantine.dev) y de **React Router 7** en modo declarativo. En particular, revisar en la documentación de `Select` cómo se arman los grupos de opciones y la prop `filter`.
5. Lo que está en `lib/` sigue siendo lógica pura, sin React y sin `fetch`.
6. Ante cualquier duda o diferencia con el mapa de pantallas, **frenar y preguntar**.
7. Informe corto (sección 11).

Guardar este archivo como `docs/etapas/etapa-f1-operario.md`.

---

## 1. Backend: dos agregados chicos

### 1.1 API-08 — Código de la máquina en las consultas de máquinas

La tabla `maquinas` tiene la columna `codigo`, y `POST /api/maquinas` ya la recibe, pero `GET /api/maquinas` y `GET /api/maquinas/:id` no la devuelven. El operario identifica las máquinas por ese número (relevamiento, sección 2), así que el buscador de O2 lo necesita.

**Cambio:** agregar `codigo` (texto o `null`) a cada máquina de `GET /api/maquinas` y a la respuesta de `GET /api/maquinas/:id`. No cambia nada más.

### 1.2 API-09 — Apellido en los datos de personas

Hoy las personas que aparecen dentro de una intervención solo traen `id`, `legajo` y `nombre`. Si un usuario tiene apellido, la pantalla muestra solo "Juan" en lugar de "Juan Pérez".

**Cambio:** agregar `apellido` (texto o `null`) a cada objeto de persona de estas respuestas:

| Endpoint | Objetos |
| :--- | :--- |
| `GET /api/intervenciones` | `creado_por`, `responsable`, `eliminado_por` |
| `GET /api/intervenciones/:id` | `creado_por`, `responsable`, `historial_estados[].cambiado_por`, `periodos_detencion[].abierto_por`, `periodos_detencion[].confirmado_por`, `auditoria[].realizado_por` |
| `GET /api/intervenciones/:id/responsables-habilitados` | cada usuario de la lista |

Los demás campos de esos objetos quedan igual.

### 1.3 Pruebas del backend

Agregar dos pruebas en `backend/tests/api_front.test.ts`, con los mismos datos de prueba que ya arma ese archivo:

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| AF-18 | Código de máquina | Una máquina creada con `codigo` `'AF18-01'` lo trae en `GET /api/maquinas` y en `GET /api/maquinas/:id`. Una máquina sin código trae `codigo: null`. |
| AF-19 | Apellido en personas | Un usuario con apellido `'Pérez'` reporta una falla. En `GET /api/intervenciones`, `creado_por.apellido` es `'Pérez'`. En `GET /api/intervenciones/:id`, lo son `creado_por.apellido` y `historial_estados[0].cambiado_por.apellido`. Para un usuario sin apellido, el campo es `null`. |

`npm run test:todo -- etapa-f1` tiene que terminar en verde con **272** pruebas (las 270 de antes más estas 2). El log queda en `docs/evidencia/`.

---

## 2. Arreglos previos del frontend

### 2.1 El apellido es opcional

En la base, `usuarios.apellido` acepta `null`, pero el frontend lo trata como texto obligatorio. Por eso "Mi cuenta" muestra **"Responsable Demo null"** cuando el usuario no tiene apellido.

- En `api/tipos.ts`, `Usuario.apellido` pasa a `string | null`.
- Nueva función `nombreCompleto` (sección 4). Se usa en "Mi cuenta", en la barra superior y en todas las pantallas de esta etapa que muestran personas.

### 2.2 Una sola función para los pedidos

Hoy `listar()` repite casi todo `request()` y además no reacciona ante `CAMBIO_PASSWORD_REQUERIDO`.

**Cambio en `api/cliente.ts`:** una sola función interna hace el `fetch`, arma el `ApiError` y aplica la reacción según el código. `get`, `post`, `patch`, `put`, `delete` y `listar` la usan. `listar` solo agrega la lectura de `X-Total-Count`. El comportamiento visible no cambia.

---

## 3. Tipos (`api/tipos.ts`)

Agregar los tipos de las respuestas que usa esta etapa, copiando los nombres de campo **del código del backend**, sin inventar:

| Tipo | Respuesta |
| :--- | :--- |
| `Persona` | `{ id, legajo, nombre, apellido: string \| null }` |
| `MaquinaLista` | cada ítem de `GET /api/maquinas`, con `codigo` y `intervenciones_abiertas` |
| `TiemposIntervencion` | el objeto `tiempos` (`espera_minutos`, `espera_en_curso`, `duracion_bruta_minutos`, `duracion_neta_minutos`, `tiempo_total_minutos`, `trabajo_en_curso`, `inactividad_minutos`, `inactividad_en_curso`) |
| `IntervencionLista` | cada ítem de `GET /api/intervenciones` |
| `HistorialEstado`, `PeriodoDetencion` | los ítems de `historial_estados` y `periodos_detencion` del detalle |
| `IntervencionDetalle` | la respuesta de `GET /api/intervenciones/:id`, con `acciones_disponibles: string[]` |
| `IntervencionCreada` | la respuesta 201 de `POST /api/intervenciones` |

---

## 4. Lógica pura nueva (`lib/`)

### 4.1 `lib/personas.ts`

**`nombreCompleto(persona)`:** recibe `{ nombre, apellido }` o `null`.

| Entrada | Salida |
| :--- | :--- |
| `{ nombre: 'Juan', apellido: 'Pérez' }` | "Juan Pérez" |
| `{ nombre: 'Juan', apellido: null }` o con apellido vacío | "Juan" |
| `null` o `undefined` | "" |

Recorta los espacios de cada parte.

### 4.2 `lib/formato.ts` (se agrega)

**`formatFechaHora(fecha)`:** recibe un texto ISO o un `Date` y devuelve **"DD/MM/YYYY HH:mm"** en la hora local del navegador, con ceros a la izquierda. `null`, `undefined` o una fecha inválida → "—".

### 4.3 `lib/maquinas.ts`

| Función | Qué hace |
| :--- | :--- |
| `normalizarTexto(texto)` | Pasa a minúsculas, quita las tildes (`normalize('NFD')` y se quitan las marcas) y recorta los espacios. |
| `etiquetaMaquina(maquina)` | Con código: "M-012 · Torno CNC". Sin código: "Torno CNC". |
| `coincideMaquina(maquina, texto)` | Si el texto está vacío, devuelve `true`. Si no, devuelve `true` cuando el texto normalizado está contenido en el nombre normalizado o en el código normalizado. |
| `agruparMaquinas(maquinas, sectoresUsuario)` | Devuelve `{ propias, otras }`. `propias` son las máquinas de los sectores del usuario (lista de ids). Cada grupo va ordenado por nombre con `localeCompare(…, 'es')`. |
| `textoFallasAbiertas(cantidad)` | 0 o menos → `null`. 1 → "Esta máquina ya tiene 1 falla abierta." N → "Esta máquina ya tiene N fallas abiertas." |

### 4.4 `lib/intervenciones.ts`

**Constantes:**

- `ESTADOS_ABIERTOS = ['PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS']`
- `ESTADOS_CERRADOS = ['FINALIZADA', 'CANCELADA']`

**`vistaDetalle(permisos)`:** devuelve `'simple'` (O3) o `'completa'` (R3, que llega en la F2).

- `'simple'` cuando se cumplen las dos condiciones:
  - `destinoInicio(permisos)` es `/mis-reportes`;
  - el usuario no tiene **ninguno** de estos permisos de gestión: `INTERVENCIONES_ASIGNAR`, `INTERVENCIONES_ASIGNARSE`, `INTERVENCIONES_RECIBIR_ASIGNACION`, `INTERVENCIONES_CAMBIAR_ESTADO`, `INTERVENCIONES_FINALIZAR`, `INTERVENCIONES_CANCELAR`, `INTERVENCIONES_REABRIR`, `INTERVENCIONES_GESTIONAR`, `INTERVENCIONES_ELIMINAR`, `INTERVENCIONES_CORREGIR`, `INTERVENCIONES_CONFIRMAR_RECUPERACION`.
- `'completa'` en cualquier otro caso.

Así, un perfil nuevo que solo ve lo propio pero también recibe trabajos asignados va a la vista completa, que es la que tiene las acciones. `INTERVENCIONES_EDITAR` no cuenta como permiso de gestión, porque el operario lo tiene para corregir su propio reporte.

**`itemHistorial(h)`:** recibe un ítem de `historial_estados` y devuelve `{ titulo, fecha, estado }`.

- `titulo`:
  - si `estado_anterior` es `null` → "Reporte registrado";
  - si no → el texto del estado nuevo según la tabla de estados ("En proceso", "Finalizada"…).
- `fecha`: `fecha_efectiva` si existe; si no, `cambiado_en`. Es cuándo ocurrió, no cuándo se cargó.
- `estado`: el `estado_nuevo`.

---

## 5. O1 — Mis reportes (`/mis-reportes`)

**Quién la ve:** si `destinoInicio(permisos)` no es `/mis-reportes`, la ruta redirige a `/`. Así un responsable que escribe la dirección a mano no ve todas las intervenciones bajo el título "Mis reportes".

**Arriba de todo:**

- Encabezado "Mis reportes".
- Si tiene `INTERVENCIONES_CREAR`: botón **"Reportar falla"**, grande (`size="xl"`), con el ícono de alerta y ancho completo en pantallas angostas. Lleva a `/reportar`. Es la acción principal de la pantalla (regla 3 del mapa).

**Bloque "Abiertos":**

- Pide `GET /api/intervenciones?estado=PENDIENTE,EN_PROCESO,EN_ESPERA_REPUESTOS&limit=50` con `listar`.
- Muestra la cantidad en el título del bloque.
- Si el total supera los 50, agrega una línea: "Se muestran los 50 más recientes de N."

**Bloque "Cerrados recientemente":**

- Pide `estado=FINALIZADA,CANCELADA` con `limit=10`.
- Botón **"Ver más"** mientras falten: suma 10 al límite y vuelve a pedir.

**Cada reporte es una tarjeta clickeable** que lleva a `/intervenciones/:id`. Tiene que poder abrirse también con el teclado. Muestra:

- `etiquetaMaquina` y, más chico, el sector;
- `EstadoBadge` del estado;
- "Reportado " + `formatHace(fecha_creacion)`;
- el responsable con `nombreCompleto`, o "Sin asignar";
- la marca roja **"Máquina detenida"** si `detiene_maquina_actualmente`;
- la descripción, cortada a 2 líneas.

**Distribución:** tarjetas en grilla de 1, 2 o 3 columnas según el ancho (`SimpleGrid` con `base: 1, sm: 2, lg: 3`).

**Sin reportes:** `PantallaVacia` con el texto "Todavía no reportaste fallas." y el botón "Reportar falla" (si tiene el permiso).

**Actualización:** los dos bloques se vuelven a pedir cada 60 segundos.

**Clave de React Query:** `['intervenciones', parámetros]`.

**Sin permiso de ver:** si el usuario no tiene `INTERVENCIONES_VER`, no se piden los bloques; queda solo el botón "Reportar falla".

---

## 6. O2 — Reportar falla (`/reportar`)

Es la pantalla más importante de la etapa. Tiene que poder completarse en menos de un minuto, también desde el celular. Los controles van en tamaño grande (`size="lg"`).

### 6.1 Campos, de arriba abajo

**1. Máquina** (obligatoria)

- Un `Select` con búsqueda y la etiqueta "¿En qué máquina?".
- Las máquinas salen de `GET /api/maquinas`, con la clave `['maquinas']`.
- Con `agruparMaquinas` se arman dos grupos: **"Máquinas de mis sectores"** y **"Otras máquinas"**. Si alguno de los dos queda vacío, la lista va sin grupos.
- Cada opción muestra `etiquetaMaquina` y, más chico, el sector.
- La búsqueda usa `coincideMaquina` en la prop `filter`, así que encuentra por nombre o por código, con o sin tildes.
- Sin resultados: "No hay máquinas que coincidan".

**2. Datos de la máquina elegida**

Aparecen al elegirla:

- su estado actual con `EstadoBadge`;
- si `textoFallasAbiertas(intervenciones_abiertas)` no es `null`, un recuadro amarillo con ese texto y, debajo: "Si es la misma falla, no hace falta reportarla de nuevo. Si es otra, podés seguir."

El aviso **no bloquea** el guardado (punto 3 de la sección 8 del mapa).

**3. "¿La máquina quedó detenida?"** (obligatoria)

- Dos botones grandes, uno al lado del otro: **"Sí, está parada"** y **"No, sigue funcionando"**.
- El elegido queda marcado (variante llena) y tiene `aria-pressed`.
- **No hay valor por omisión:** el operario tiene que elegir uno.

**4. Descripción** (obligatoria)

- `Textarea` con la etiqueta "¿Qué pasa?" y el ejemplo "Ej.: hace ruido fuerte al arrancar y se apaga sola".
- Entre 5 y 2000 caracteres, con contador.

**5. Observaciones** (opcional)

- `Textarea` de hasta 2000 caracteres.

**6. Dato de control** (prototipo 10.5.2)

- Una línea gris, que no se puede editar: "Reporta: {nombreCompleto} · legajo {legajo} · {formatFechaHora(ahora)}".
- La hora se actualiza cada minuto.
- Es solo informativa: la fecha real la pone el servidor.

**Mensajes de validación** (en pantalla, antes de enviar):

| Campo | Mensaje |
| :--- | :--- |
| Máquina | "Elegí la máquina." |
| Máquina detenida | "Indicá si la máquina quedó detenida." |
| Descripción | "Describí la falla (al menos 5 caracteres)." |

### 6.2 Botones

- **"Enviar reporte"**, primario y grande. Mientras se envía queda en estado de carga, para que no se pueda enviar dos veces.
- **"Cancelar"**, secundario. Lleva a `/`.

### 6.3 Envío

`POST /api/intervenciones` con:

- `maquina_id`;
- `detiene_maquina`;
- `descripcion`;
- `observaciones` (si está vacío, no se manda).

**Si falla:**

- aviso emergente con `mensajeError`;
- **el formulario conserva lo que escribió el operario**.

### 6.4 Confirmación

Si sale bien, el formulario se reemplaza por una pantalla de confirmación con:

- un ícono grande de confirmación;
- **"Reporte N.º {id} registrado"**;
- `etiquetaMaquina` de la máquina;
- "Estado de la máquina:" con `EstadoBadge` de `maquina.estado_actual` (de la respuesta);
- tres botones:
  - **"Ver el reporte"** → `/intervenciones/{id}`;
  - **"Reportar otra falla"** → formulario vacío;
  - **"Ir al inicio"** → `/`.

Además se invalidan las claves `['intervenciones']`, `['maquinas']` y `['notificaciones-contador']`.

### 6.5 Máquina elegida de antemano

Si la dirección trae `?maquina={id}` y esa máquina está en la lista, queda elegida al abrir la pantalla. Si no está, se ignora.

La van a usar el detalle de máquina (F3) y las revisiones de rutina del operario (Preventivos), que, cuando encuentran algo, salen directo a "Reportar falla".

---

## 7. O3 — Detalle de mi reporte (`/intervenciones/:id`)

### 7.1 Qué vista se muestra

La ruta `/intervenciones/:id` es una sola para todos. Las notificaciones ya llevan ahí.

- Si `vistaDetalle(permisos)` es `'simple'` → **O3**, que se describe abajo.
- Si es `'completa'` → sigue "En construcción" (etapa F2).

Los datos salen de `GET /api/intervenciones/:id`, con la clave `['intervencion', id]`, y se vuelven a pedir cada 60 segundos.

### 7.2 Contenido

**Arriba:**

- un enlace "← Mis reportes";
- el título **"Reporte N.º {id}"** y, a la derecha, `EstadoBadge` en tamaño grande.

**Tarjeta "Máquina":**

- `etiquetaMaquina`;
- el sector;
- el estado actual de la máquina con `EstadoBadge`.

**Tarjeta "Seguimiento"**, en filas de dato y valor:

| Dato | Valor |
| :--- | :--- |
| Reportado | `formatFechaHora(fecha_creacion)` y, entre paréntesis, `formatHace` |
| Reportado por | `nombreCompleto(creado_por)` |
| Responsable | `nombreCompleto(responsable)`, o "Sin asignar todavía" |
| Espera | `formatDuracion(tiempos.espera_minutos)`, con la marca **"en curso"** si `tiempos.espera_en_curso` |
| ¿Detuvo la máquina? | "Sí" si `periodos_detencion` tiene alguno, con "(sigue detenida)" si alguno `esta_abierto`; si no, "No" |
| Finalizado | solo si hay `fecha_finalizacion`: `formatFechaHora` |

**Tarjeta "Descripción":**

- la descripción;
- debajo, las observaciones, si hay;
- si hay `trabajo_realizado`, un apartado **"Trabajo realizado"**, porque al operario le sirve saber qué se hizo.

**Tarjeta "Historial":**

- `Timeline` de Mantine con `historial_estados`, en el orden en que vienen;
- cada ítem usa `itemHistorial`: el título, `formatFechaHora(fecha)`, "por " + `nombreCompleto(cambiado_por)` y la `observacion` en gris, si hay;
- el punto de cada ítem usa el color del estado.

### 7.3 Editar

- **Botón "Editar":** solo si `acciones_disponibles` incluye `'EDITAR'`. El frontend no repite la regla (regla 4 del mapa).
- **Diálogo** (`Modal`): descripción y observaciones, cargadas con los valores actuales y con las mismas validaciones que O2.
- **Pedido:** `PATCH /api/intervenciones/:id` con `estado_esperado` igual al estado que se está mostrando, más los dos campos.
- **Si sale bien:** aviso "Reporte actualizado" y se vuelve a pedir el detalle.
- **Si falla con `ESTADO_DESACTUALIZADO` o `EDICION_NO_PERMITIDA`** (por ejemplo, alguien lo tomó mientras tanto): se cierra el diálogo, se muestra `mensajeError` y se vuelve a pedir el detalle. El botón desaparece solo, porque el backend deja de ofrecer la acción.
- **Otros errores:** el diálogo queda abierto con el mensaje.

### 7.4 No encontrado

Con `INTERVENCION_NO_ENCONTRADA`, se muestra `PantallaVacia` con "No encontramos este reporte." y el botón "Volver a Mis reportes".

---

## 8. Rutas

| Ruta | Antes | Ahora |
| :--- | :--- | :--- |
| `/mis-reportes` | En construcción | O1 (sección 5) |
| `/reportar` | En construcción | O2 (sección 6); sigue exigiendo `INTERVENCIONES_CREAR` |
| `/intervenciones/:id` | En construcción | O3 o En construcción F2, según `vistaDetalle` (sección 7.1) |

Las demás rutas no cambian.

---

## 9. Pruebas del frontend

En `frontend/src/lib/`, con `node:test`:

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| FE-09 | `nombreCompleto` | "Juan Pérez"; con apellido `null` → "Juan"; con apellido `"  "` → "Juan"; `null` → "" |
| FE-10 | `formatFechaHora` | `new Date(2026, 9, 31, 8, 5)` → "31/10/2026 08:05"; `new Date(2026, 0, 2, 23, 59)` → "02/01/2026 23:59"; `null` → "—"; `'no-es-fecha'` → "—" |
| FE-11 | `vistaDetalle` | Permisos de OPERARIO → `'simple'`. RESPONSABLE_MANTENIMIENTO, CONSULTA y ADMINISTRADOR → `'completa'`. `{ INTERVENCIONES_VER: 'PROPIAS', INTERVENCIONES_RECIBIR_ASIGNACION: 'TODAS' }` → `'completa'`. `{ INTERVENCIONES_VER: 'PROPIAS', INTERVENCIONES_EDITAR: 'PROPIAS' }` → `'simple'`. |
| FE-12 | `normalizarTexto`, `etiquetaMaquina` y `coincideMaquina` | "Cámara" → "camara". Con código: "M-012 · Torno CNC". Sin código: "Torno CNC". "torno" y "TÓRNO" encuentran "Torno CNC"; "012" encuentra la de código "M-012"; "camara" encuentra "Cámara de pintura"; "fresa" no encuentra "Torno CNC"; el texto vacío encuentra todas. |
| FE-13 | `agruparMaquinas` | Con 4 máquinas en los sectores 1, 2, 1 y 3, y el usuario en el sector 1: `propias` tiene 2 y `otras` 2, cada grupo ordenado por nombre. Con un usuario sin sectores: todas van a `otras`. |
| FE-14 | `textoFallasAbiertas` | 0 → `null`; 1 → "Esta máquina ya tiene 1 falla abierta."; 3 → "Esta máquina ya tiene 3 fallas abiertas." |
| FE-15 | `itemHistorial` | Con `estado_anterior` `null` → "Reporte registrado". `EN_PROCESO` → "En proceso". Con `fecha_efectiva`, la fecha es esa; sin ella, es `cambiado_en`. |

En FE-11, los permisos de cada perfil se copian de las migraciones, igual que en FE-04.

---

## 10. Lo que voy a revisar yo

Voy a levantar el backend y el frontend contra mi base local, con datos de prueba, y sacar capturas en **1440×900** y **390×844**:

- **O1:** vacío y con reportes abiertos y cerrados; "Ver más".
- **O2:**
  - errores de validación;
  - búsqueda por código y por nombre sin tildes;
  - el aviso con una y con varias fallas abiertas;
  - un reporte con la máquina detenida: en la base tiene que quedar el período de detención y la máquina en "Detenida";
  - la confirmación con su número;
  - entrar con `?maquina=`.
- **O3:**
  - pendiente sin responsable, con "Editar" y la edición guardada;
  - tomado por un responsable: sin "Editar";
  - "Editar" cuando alguien lo tomó mientras tanto: tiene que mostrar el error y quitar el botón;
  - finalizado con trabajo realizado y el historial completo;
  - un reporte ajeno: "No encontramos este reporte.".
- **Otros perfiles:**
  - un responsable en `/intervenciones/:id` sigue viendo "En construcción F2";
  - un responsable en `/mis-reportes` vuelve al tablero.
- **Nombres:** un usuario sin apellido ya no muestra "null".
- **Celular:** que nada se desborde a 390 px.

---

## 11. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 9 están hechas.
2. `npm run test:front` en verde (FE-01 a FE-15).
3. `npm run test:todo -- etapa-f1` en verde con 272 pruebas; el log va en `docs/evidencia/`.
4. `npm run typecheck` y `npm run build:frontend` sin errores.
5. Commit y push en `feat/base-neon`.

**Informe corto:**

1. Hash del commit.
2. La salida final de `test:front` y la línea de total de `test:todo`, copiadas de la consola o del log.
3. Typecheck y build.
4. Desvíos, incluido todo lo que no se haya hecho.
5. Dudas.
