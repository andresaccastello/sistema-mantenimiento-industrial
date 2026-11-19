# Etapa F2 — Intervenciones: lista y detalle con todas las acciones

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `cf2afd4` (Etapa F1.1).
> **Base:** `docs/front/mapa-pantallas.md` (pantallas R2 y R3, reglas de la sección 1), el motor de estados (`backend/functions/intervenciones/`) y `docs/etapas/etapa-f1-operario.md`.
> **Para qué:** que el responsable de mantenimiento vea todas las fallas, las filtre y lleve cada una de punta a punta desde el sistema, sin usar la interfaz provisional.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`.
2. **Dos commits:**
   - el primero, solo con la sección 1 (pruebas del backend);
   - el segundo, con todo lo demás.
   Así se revisan por separado.
3. Del backend se toca solo lo de las secciones 1 y 2.
4. **Dependencias nuevas:** solo estas dos, en el frontend y con la versión exacta:
   - `@mantine/dates` `9.7.4`;
   - `dayjs` `1.11.23`.
   No se agrega nada más.
5. Seguir la documentación oficial:
   - de **Mantine 9**: `Tabs`, `Table`, `Pagination`, `Menu`, `Modal`, `SegmentedControl`, `MultiSelect`, `Grid` y `Timeline`;
   - de **@mantine/dates**: `DateTimePicker`, `DatePickerInput` y `DatesProvider`;
   - de **React Router 7**: `useSearchParams` y `useLocation`.
6. Lo que está en `lib/` sigue siendo lógica pura, sin React y sin `fetch`.
7. **Las reglas las decide el backend.** Los botones de acción salen de `acciones_disponibles` (regla 4 del mapa). El frontend valida en pantalla solo lo que el backend también exige, con los mismos mínimos (sección 7.3), para avisar antes de enviar.
8. Ante cualquier duda o diferencia con el mapa de pantallas, **frenar y preguntar**.
9. Informe corto (sección 11).

Guardar este archivo como `docs/etapas/etapa-f2-intervenciones.md`.

---

## 1. Las pruebas tienen que dejar la base como la encontraron (primer commit)

### 1.1 Problema

Cada corrida de `npm run test:todo` deja datos en la base de pruebas. Esto se midió en una corrida completa, contando las filas nuevas que quedaron al terminar:

| Tabla | Filas que quedan | De qué archivos salen |
| :--- | :-: | :--- |
| `usuarios` | 22 | `api_front` (4), `usuarios` (17) y `motor_estados` (1, con legajo `INAC_…`) |
| `sectores` | 5 | `api_front` (`Sector_AF1`, `Sector_AF2`), `motor_cierres` (`Sector Cierres A` y `B`), `usuarios` (`Sector Inactivo`) |
| `maquinas` | 6 | `api_front` |
| `intervenciones` | 116 | `api_front` (112), `usuarios` (4) |

Las 4 intervenciones de `usuarios.test.ts` (pruebas U11 y U16) se crean sobre una máquina que **ya existía** en la base, no sobre una creada por la prueba.

### 1.2 Causa principal

En `api_front.test.ts`, la limpieza del final borra las intervenciones antes que `historial_estados_maquina`, que las referencia. Ese borrado falla, el `catch {}` vacío lo esconde y, en cadena, fallan los borrados siguientes. Corriendo el archivo con los errores a la vista, aparecen estos:

| Al borrar | Lo impide |
| :--- | :--- |
| `intervenciones` | `historial_estados_maquina_intervencion_id_fkey` |
| `maquinas` (6 veces) | `intervenciones_maquina_id_fkey` |
| `sectores` (2 veces) | `maquinas_sector_id_fkey` |
| `usuarios` (4 veces) | `intervenciones_creado_por_usuario_id_fkey` y `intervenciones_responsable_usuario_id_fkey` |

### 1.3 Cambios

1. **`api_front.test.ts`:** antes de borrar las intervenciones, borrar las filas de `historial_estados_maquina` que las nombran (y las de las máquinas creadas por la prueba).
2. **`usuarios.test.ts`:**
   - U11 y U16 crean su propia máquina, y si hace falta su propio sector, en lugar de usar una que ya existía;
   - al final se borra todo lo que crea el archivo: intervenciones, máquina, sectores (incluido `Sector Inactivo`) y usuarios;
   - si un usuario no se puede borrar porque otra tabla lo nombra, primero se borran esas filas, **solo las de los usuarios creados por la prueba**.
3. **`motor_cierres.test.ts`:** borrar sus dos sectores.
4. **`motor_estados.test.ts`:** borrar el usuario `INAC_…` que crea.
5. **Ningún `catch` vacío en las limpiezas,** en ningún archivo de prueba. En su lugar: `console.error('[limpieza] <archivo>:', error.message)`. Así un borrado que falla queda en el log.
6. **Control en `test:todo`** (`scripts/run-all-tests.mjs`):
   - antes de la primera suite y después de la última, contar las filas de `usuarios`, `sectores`, `maquinas` e `intervenciones`, con la misma base que usan las pruebas (la del `.env`); puede ser un script chico aparte que el runner llama dos veces;
   - al final, después de la línea de total, imprimir:
     `[test:todo] Datos que quedaron: usuarios 0, sectores 0, maquinas 0, intervenciones 0`
   - si algún número no es 0 (para arriba o para abajo), la corrida termina con código de salida 1, aunque todas las pruebas pasen.

**No** se borran los datos que dejaron las corridas anteriores: el control mide solo lo que deja cada corrida.

### 1.4 Cierre del primer commit

- `npm run test:todo -- etapa-f2-limpieza` en verde con **273** pruebas y la línea de datos con los cuatro números en 0. El log queda en `docs/evidencia/`.
- Mensaje del commit: `test: las pruebas dejan la base como la encontraron`.

---

## 2. Backend: nombres en los cambios de responsable (API-12)

**Problema.** En `GET /api/intervenciones/:id`, cada cambio de responsable aparece en `auditoria` con `campo_modificado = 'responsable_usuario_id'`, pero `valor_anterior` y `valor_nuevo` son **ids en texto** (`"12"`). El historial de R3 tiene que poder decir "Reasignada de Juan Pérez a Ana Gómez".

**Cambio.** Agregar a cada ítem de `auditoria` dos campos:

- `responsable_anterior`;
- `responsable_nuevo`.

Cada uno es una persona `{ id, legajo, nombre, apellido }` (con `id` numérico) o `null`. Se completan solo cuando `campo_modificado = 'responsable_usuario_id'` y el valor correspondiente no es `null`. En los demás ítems, los dos son `null`. Lo demás de la respuesta queda igual.

La conversión del texto a número se hace dentro de un `CASE`, para no convertir valores de otros campos:

```sql
LEFT JOIN usuarios u_ant ON u_ant.id = CASE
  WHEN a.campo_modificado = 'responsable_usuario_id' AND a.valor_anterior ~ '^[0-9]+$'
  THEN a.valor_anterior::bigint END
```

Y lo mismo con `valor_nuevo`.

**Prueba nueva en `backend/tests/api_front.test.ts`**, con los usuarios que ya arma ese archivo: el operario y los responsables `R1_…` y `R2_…`.

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| AF-21 | Personas en la auditoría | Un operario reporta. El responsable 1 la **toma**: en el detalle, el ítem de auditoría tiene `responsable_anterior: null` y `responsable_nuevo` con el `id`, `nombre` y `apellido` del responsable 1. Después se **reasigna** al responsable 2 con motivo: el nuevo ítem tiene `responsable_anterior` = responsable 1 y `responsable_nuevo` = responsable 2. Después se **edita** la descripción: ese ítem tiene los dos campos en `null`. |

---

## 3. Base del frontend

### 3.1 Fechas

- Instalar las dos dependencias de la regla 4.
- En `index.css`, después de los estilos de Mantine que ya están: `@import '@mantine/dates/styles.css';`.
- En `main.tsx`:
  - `import 'dayjs/locale/es';`;
  - `DatesProvider` dentro de `MantineProvider`, con `settings={{ locale: 'es', firstDayOfWeek: 1 }}`.
- Formato a la vista:
  - `DateTimePicker`: "DD/MM/YYYY HH:mm";
  - `DatePickerInput`: "DD/MM/YYYY".

### 3.2 Tipos (`api/tipos.ts`)

Copiando los nombres de campo del código del backend, sin inventar:

| Tipo | Qué es |
| :--- | :--- |
| `AuditoriaItem` | cada ítem de `auditoria` del detalle: `id`, `tipo_evento`, `campo_modificado`, `valor_anterior`, `valor_nuevo`, `motivo`, `creado_en`, `realizado_por` (`Persona`), `responsable_anterior` y `responsable_nuevo` (`Persona \| null`) |
| `IntervencionDetalle` | `auditoria` pasa a ser `AuditoriaItem[]` (deja de ser opcional) |
| `SectorLista` | cada ítem de `GET /api/sectores` |

Para la lista de `responsables-habilitados` alcanza con `Persona`.

### 3.3 Cliente

`clienteApi.delete` recibe un cuerpo opcional, igual que `post`: `delete(path, body?, options?)`. Lo necesita "Quitar responsable" (sección 7). Revisar que no haya otros usos que se rompan.

### 3.4 Mensajes de error (`lib/errores.ts`)

**Textos nuevos en `mensajeError`:**

| Código | Texto |
| :--- | :--- |
| `TRANSICION_NO_PERMITIDA` | "Esta acción ya no está disponible para esta intervención." |
| `INTERVENCION_YA_ASIGNADA` | "Otra persona ya tomó esta intervención." |
| `RESPONSABLE_SIN_CAMBIOS` | "Esa persona ya es la responsable." |
| `RESPONSABLE_NO_HABILITADO` | "Esa persona no puede ser responsable de intervenciones." |
| `RESPONSABLE_SIN_VISIBILIDAD` | "Esa persona no tiene acceso al sector de esta máquina." |
| `RESPONSABLE_REQUERIDO` | "La intervención no tiene responsable y no podés asignártela." |
| `NO_ES_RESPONSABLE` | "Solo el responsable, o quien asigna los trabajos, puede hacer esto." |
| `DESASIGNACION_NO_PERMITIDA` | "El responsable solo se puede quitar mientras está pendiente. Después se puede reasignar." |
| `MOTIVO_REQUERIDO` | "Indicá el motivo." |
| `OBSERVACION_REQUERIDA` | "Completá la observación (al menos 5 caracteres)." |
| `TRABAJO_REALIZADO_REQUERIDO` | "Describí el trabajo realizado (al menos 5 caracteres)." |
| `EJECUCION_REQUERIDA` | "Indicá si lo hizo personal propio o un servicio externo." |
| `DECISION_RECUPERACION_REQUERIDA` | "Indicá si la máquina volvió a funcionar." |
| `DECISION_DETENCION_REQUERIDA` | "Indicá si la máquina volvió a detenerse." |
| `CONFIRMACION_NO_PERMITIDA` | "No tenés permiso para confirmar que la máquina volvió a funcionar." |
| `FECHA_INCOHERENTE` | "La fecha y hora no encaja con las anteriores de esta intervención, o es posterior a este momento." |
| `DETENCION_YA_ABIERTA` | "Esta intervención ya tiene una detención abierta." |
| `ELIMINACION_NO_PERMITIDA` | "No se puede eliminar: la intervención ya tiene actividad registrada." |
| `PERIODO_INVALIDO` | "Esa detención ya se cerró o no se puede confirmar." |
| `INTERVENCION_NO_ENCONTRADA` | "No encontramos esta intervención." |

**Función nueva `requiereRecargar(error)`:** devuelve `true` si el código es uno de estos y `false` en cualquier otro caso:

- `ESTADO_DESACTUALIZADO`, `TRANSICION_NO_PERMITIDA`, `INTERVENCION_YA_ASIGNADA`;
- `EDICION_NO_PERMITIDA`, `DESASIGNACION_NO_PERMITIDA`, `NO_ES_RESPONSABLE`;
- `DETENCION_YA_ABIERTA`, `PERIODO_INVALIDO`;
- `ELIMINACION_NO_PERMITIDA`, `INTERVENCION_NO_ENCONTRADA`.

Son los errores que significan "la intervención cambió mientras tanto": el diálogo se cierra y se vuelve a pedir el detalle (sección 7.2).

---

## 4. Lógica pura nueva (`lib/`)

### 4.1 `lib/acciones.ts`

**Tabla `ACCIONES`**, en este orden, que es también el orden en que se muestran:

| Código | Botón | Lugar | Aviso al terminar bien |
| :--- | :--- | :--- | :--- |
| `INICIAR` | Iniciar trabajo | principal | "Trabajo iniciado." |
| `REANUDAR` | Reanudar | principal | "Trabajo reanudado." |
| `FINALIZAR` | Finalizar | principal | "Intervención finalizada." |
| `TOMAR` | Tomar | visible | "Tomaste la intervención." |
| `ASIGNAR` | Asignar (o **Reasignar**, si ya tiene responsable) | visible | "Responsable asignado." |
| `ESPERAR_REPUESTOS` | Esperar repuestos | visible | "Quedó esperando repuestos." |
| `RESOLVER_AHORA` | Registrar como resuelta | visible | "Intervención registrada como resuelta." |
| `REABRIR` | Reabrir | visible | "Intervención reabierta." |
| `DESASIGNAR` | Quitar responsable | menú | "Se quitó el responsable." |
| `REGISTRAR_DETENCION` | Registrar detención | menú | "Detención registrada." |
| `EDITAR` | Editar | menú | "Cambios guardados." |
| `CANCELAR` | Cancelar intervención | menú, en rojo | "Intervención cancelada." |
| `ELIMINAR` | Eliminar | menú, en rojo | "Intervención N.º {id} eliminada." |

**`ordenarAcciones(disponibles)`:** recibe `acciones_disponibles` y devuelve `{ principal, visibles, menu }`:

- `principal`: el primer código disponible con lugar "principal", o `null`;
- `visibles`: los de lugar "visible" (y los "principal" que sobren, si hubiera más de uno);
- `menu`: los de lugar "menú".

Cada lista sigue el orden de la tabla, no el que trae el backend. Los códigos que no están en la tabla se ignoran.

Con el motor actual hay a lo sumo una acción principal por estado: `INICIAR` en pendiente, `FINALIZAR` en proceso y `REANUDAR` esperando repuestos.

**`etiquetaAccion(codigo, tieneResponsable)`:** el texto del botón. Para `ASIGNAR` devuelve "Reasignar" si `tieneResponsable` y "Asignar" si no.

### 4.2 `lib/fechas.ts`

`DateTimePicker` entrega y recibe la fecha como texto local `YYYY-MM-DD HH:mm:ss`. El backend exige ISO 8601 **con zona horaria** (`Z` o `±hh:mm`). Estas funciones hacen el paso de una a otra.

| Función | Qué hace |
| :--- | :--- |
| `fechaLocalTexto(fecha: Date)` | Devuelve `YYYY-MM-DD HH:mm:ss` en hora local, con ceros a la izquierda. |
| `fechaLocalAIso(texto)` | Acepta `YYYY-MM-DD HH:mm` o `YYYY-MM-DD HH:mm:ss` en hora local. Devuelve `YYYY-MM-DDTHH:mm:ss±hh:mm`, con la diferencia horaria local de **esa** fecha. Si el texto no es una fecha real (por ejemplo, 30 de febrero) o no tiene ese formato, devuelve `null`. |
| `validarMomento(momento, minimo, ahora)` | Ver abajo. |
| `momentoAIso(momento, minimo)` | Ver abajo. |
| `rangoDiasAIso(desde, hasta)` | Recibe dos días `YYYY-MM-DD` (o `null`). Devuelve `{ desde?, hasta? }` para el listado: `desde` es el comienzo de ese día (00:00:00) y `hasta` el final del suyo (23:59:59), los dos con `fechaLocalAIso`. Un valor `null` o inválido no aparece en el resultado. |
| `minutosEntre(desde, hasta, ahora)` | Minutos enteros (hacia abajo) entre `desde` y `hasta`. Si `hasta` es `null`, usa `ahora`. Nunca negativo. |

**Momento.** Varios diálogos preguntan "¿cuándo?". La respuesta es un objeto `{ modo: 'ahora' | 'otra', fecha: string | null }`:

- `'ahora'`: no se manda la fecha y el backend usa la hora del servidor;
- `'otra'`: la fecha elegida en el `DateTimePicker`.

**`validarMomento(momento, minimo, ahora)`** devuelve un texto de error o `null`. `minimo` es un texto ISO o un `Date`.

| Caso | Resultado |
| :--- | :--- |
| `modo: 'ahora'` | `null` |
| `'otra'` sin fecha | "Indicá la fecha y la hora." |
| `'otra'` con fecha inválida | "La fecha no es válida." |
| el **minuto** elegido es anterior al minuto de `minimo` | "No puede ser anterior al {formatFechaHora(minimo)}." |
| la fecha es posterior a `ahora` | "No puede ser posterior a este momento." |
| cualquier otro caso | `null` |

Se compara por minuto porque el selector no tiene segundos.

**`momentoAIso(momento, minimo)`:**

- `'ahora'` → `undefined`, porque el campo no se manda;
- `'otra'` → `fechaLocalAIso(fecha)`.

Excepción: si el instante elegido quedó antes de `minimo` (pasa cuando se elige el mismo minuto, porque el selector pone 0 segundos), devuelve `minimo` en ISO. Así no hay un rechazo del backend por segundos que el usuario no puede ver.

### 4.3 `lib/listado.ts` (filtros de R2)

**Vistas** (las pestañas):

| Vista | En la dirección | Estados posibles |
| :--- | :--- | :--- |
| Sin asignar | `sin-asignar` | — (el backend devuelve solo pendientes sin responsable) |
| Mías | `mias` | los abiertos |
| Abiertas | `abiertas` | `PENDIENTE`, `EN_PROCESO`, `EN_ESPERA_REPUESTOS` |
| Cerradas | `cerradas` | `FINALIZADA`, `CANCELADA` |

**`vistasDisponibles(permisos)`:** devuelve las vistas en el orden de la tabla:

- "Sin asignar", solo si tiene `INTERVENCIONES_ASIGNAR` o `INTERVENCIONES_ASIGNARSE`;
- "Mías", solo si tiene `INTERVENCIONES_RECIBIR_ASIGNACION`;
- "Abiertas" y "Cerradas", siempre.

**Filtros:**

```ts
interface FiltrosIntervenciones {
  vista: 'sin-asignar' | 'mias' | 'abiertas' | 'cerradas';
  estados: string[];          // vacío = todos los de la vista
  sectorId: number | null;
  maquinaId: number | null;
  desde: string | null;       // 'YYYY-MM-DD', fecha de reporte
  hasta: string | null;
  texto: string;
  pagina: number;             // desde 1
}
```

Valores por omisión: vista `abiertas`, sin estados, sin sector, sin máquina, sin fechas, texto vacío, página 1.

| Función | Qué hace |
| :--- | :--- |
| `leerFiltros(params, vistasPermitidas)` | Lee un `URLSearchParams` con las claves `vista`, `estado` (separados por coma), `sector`, `maquina`, `desde`, `hasta`, `q` y `pagina`. Todo valor inválido se reemplaza por el de omisión: una vista desconocida o no permitida, estados que no son de la vista, ids que no pasan `parsearId`, fechas que no son días reales `YYYY-MM-DD`, una página que no es entero positivo. El texto se recorta y se corta en 100 caracteres. |
| `escribirFiltros(filtros)` | Devuelve el `URLSearchParams` correspondiente, **sin** las claves que tienen su valor por omisión. Leer lo que se escribió devuelve los mismos filtros. |
| `paramsListado(filtros, tamanio)` | Devuelve los parámetros para `GET /api/intervenciones` (ver la tabla de abajo). |
| `hayFiltros(filtros)` | `true` si hay estados, sector, máquina, alguna fecha o texto. La vista y la página no cuentan. |

**`paramsListado(filtros, tamanio)`:**

| Parámetro | Valor |
| :--- | :--- |
| `sin_asignar` | `true`, solo en la vista "Sin asignar" (y en esa vista no se manda `estado`) |
| `mias` | `true`, solo en la vista "Mías" |
| `estado` | los estados elegidos o, si no hay, todos los de la vista, separados por coma |
| `sector_id`, `maquina_id` | si no son `null` |
| `desde`, `hasta` | con `rangoDiasAIso` |
| `q` | el texto recortado, solo si tiene 2 caracteres o más (el backend rechaza 1) |
| `limit` | `tamanio` |
| `offset` | `(pagina − 1) × tamanio` |

### 4.4 `lib/intervenciones.ts` (se agrega)

**`tiempoLista(item)`** devuelve `{ etiqueta, texto, enCurso }` para la columna "Tiempo" de R2:

| Estado | `etiqueta` | Minutos | `enCurso` |
| :--- | :--- | :--- | :--- |
| `PENDIENTE` | "Espera" | `tiempos.espera_minutos` | `tiempos.espera_en_curso` |
| `EN_PROCESO`, `EN_ESPERA_REPUESTOS` | "Trabajo" | `tiempos.duracion_bruta_minutos` | `tiempos.trabajo_en_curso` |
| `FINALIZADA` | "Total" | `tiempos.tiempo_total_minutos` | `false` |
| `CANCELADA` | `null` | — | `false` |

`texto` es `formatDuracion(minutos)`. En cancelada, `texto` es "—".

**`minimoNuevaDetencion(detalle)`:** devuelve, en ISO, la fecha más tardía entre `fecha_creacion` y el `hasta` de los períodos de detención cerrados. Es el límite inferior de "¿Desde cuándo?" al reabrir con una detención nueva, que es lo mismo que exige el backend.

**`eventosHistorial(detalle)`:** arma el historial de R3 juntando `historial_estados` y `auditoria`. Devuelve una lista de:

```ts
{
  clave: string;            // única, para React
  titulo: string;
  fecha: string;            // cuándo ocurrió
  registrado: string;       // cuándo se cargó
  mostrarRegistrado: boolean;
  persona: Persona | null;  // quién lo hizo
  detalle: string | null;
  estado: string | null;    // para el color del punto; null en los de auditoría
}
```

*Ítems de `historial_estados`:*

- `titulo`, `fecha` y `estado`: los de `itemHistorial`;
- `registrado`: `cambiado_en`;
- `mostrarRegistrado`: `true` solo si hay `fecha_efectiva` y difiere de `cambiado_en` en 60 segundos o más;
- `persona`: `cambiado_por`;
- `detalle`: `observacion`.

*Ítems de `auditoria`:* `fecha` y `registrado` son `creado_en`, `mostrarRegistrado` es `false` y `persona` es `realizado_por`. El título y el detalle dependen del evento:

| `tipo_evento` y campo | `titulo` | `detalle` |
| :--- | :--- | :--- |
| `ASIGNACION` sin responsable anterior, hecha por el mismo que queda como responsable | "Tomada por {nuevo}" | el motivo, salvo que sea un texto automático (abajo) |
| `ASIGNACION` sin responsable anterior, hecha por otra persona | "Asignada a {nuevo}" | ídem |
| `ASIGNACION` con responsable anterior | "Reasignada de {anterior} a {nuevo}" | el motivo |
| `DESASIGNACION` | "Se quitó el responsable ({anterior})" | el motivo |
| `EDICION`, campo `descripcion` | "Se editó la descripción" | "Antes: " + valor anterior |
| `EDICION`, campo `observaciones` | "Se editaron las observaciones" | "Antes: " + valor anterior, o "Antes: (vacío)" |
| `OTRO`, campo `trabajo_realizado` | "Se reemplazó el trabajo realizado" | "Antes: " + valor anterior |
| `OTRO`, campo `ejecucion` | "Cambió quién hizo el trabajo" | "Antes: " + "Personal propio" o "Servicio externo" |
| `REAPERTURA`, `ELIMINACION_LOGICA` y cualquier otro | no se incluyen | |

- `{anterior}` y `{nuevo}` son `nombreCompleto` de `responsable_anterior` y `responsable_nuevo`, o "—" si son `null`.
- La reapertura no se incluye porque ya aparece como cambio de estado.
- **Textos automáticos** (no se muestran como detalle): "Intervención tomada por el responsable", "Asignación de responsable" y "Asignación automática al iniciar trabajo".

*Orden:* por `registrado`, de más viejo a más nuevo. Con el mismo `registrado`, primero los de auditoría y después los de estado, cada grupo en el orden en que vino del backend. Ejemplo: al iniciar una intervención sin responsable, "Tomada por …" queda antes que "En proceso".

---

## 5. R2 — Intervenciones (`/intervenciones`)

### 5.1 Encabezado y pestañas

- Encabezado "Intervenciones". A la derecha, si tiene `INTERVENCIONES_CREAR`, el botón **"Reportar falla"**, que lleva a `/reportar`.
- Pestañas (`Tabs`) con las vistas de `vistasDisponibles`.
- **El estado de la pantalla vive en la dirección:** pestaña, filtros y página se leen con `leerFiltros` y se escriben con `escribirFiltros` (`useSearchParams`). Así, al volver desde un detalle, la lista queda como estaba, y una lista filtrada se puede compartir con el enlace.
- Cambiar de pestaña conserva sector, máquina, fechas y texto; borra los estados elegidos y vuelve a la página 1.

### 5.2 Filtros

En una fila arriba de la tabla. En pantallas angostas pasan a varias filas.

| Filtro | Control | Detalle |
| :--- | :--- | :--- |
| Buscar | `TextInput` | Ejemplo: "Máquina, código o descripción". Se aplica 400 ms después de que se deja de escribir. |
| Estado | `MultiSelect` | Solo los estados de la vista. No aparece en "Sin asignar". |
| Sector | `Select` | `GET /api/sectores`, clave `['sectores']`. |
| Máquina | `Select` con búsqueda | `GET /api/maquinas`, clave `['maquinas']`, con `etiquetaMaquina` y `coincideMaquina`. Si hay sector elegido, solo las de ese sector. Si se cambia el sector y la máquina elegida no es de ese sector, la máquina se borra. |
| Reportadas entre | `DatePickerInput` con `type="range"` | |
| Limpiar filtros | botón | Solo si `hayFiltros`. Deja la pestaña y borra el resto. |

Todo cambio de filtro vuelve a la página 1.

### 5.3 Tabla

- Datos: `GET /api/intervenciones` con `listar` y `paramsListado(filtros, 25)`.
- Clave de React Query: `['intervenciones', parámetros]`, con `placeholderData: keepPreviousData` (lo aprendido en la F1.1). Se vuelve a pedir cada 60 segundos.
- Arriba de la tabla: "{total} intervenciones" (o "1 intervención").
- La tabla va dentro de `Table.ScrollContainer`, con un ancho mínimo de 900 px: en pantallas angostas se desplaza la tabla, no la página.

| Columna | Contenido |
| :--- | :--- |
| N.º | El número, como **enlace** (`Link`) a `/intervenciones/{id}`. Así se puede abrir con el teclado o en otra pestaña. |
| Máquina | `etiquetaMaquina` y, debajo, más chico, el sector. Debajo, en gris y cortada a una línea, la descripción. |
| Estado | `EstadoBadge` y, si `detiene_maquina_actualmente`, la marca roja "Máquina detenida". |
| Responsable | `nombreCompleto`, o "Sin asignar" en gris. |
| Reportada | `formatHace(fecha_creacion)`, con `formatFechaHora` como `title`. |
| Tiempo | `tiempoLista`: "{etiqueta} {texto}" y la marca "en curso" cuando corresponde. |

- **Toda la fila es clickeable:** lleva al detalle, igual que el enlace del número.
- Al ir al detalle se pasa en el `state` de la navegación la dirección actual de la lista (`{ volverA: '/intervenciones?…' }`). R3 la usa para su enlace de volver.
- **Paginación:** `Pagination` debajo de la tabla, solo si hay más de una página. La página va en la dirección.

### 5.4 Estados especiales

| Situación | Qué se muestra |
| :--- | :--- |
| Primera carga | indicador de carga |
| Sin resultados, con filtros | "No hay intervenciones con estos filtros." y el botón "Limpiar filtros" |
| Sin resultados, sin filtros, en "Sin asignar" | "No hay fallas sin asignar." |
| Sin resultados, sin filtros, en otra vista | "No hay intervenciones en esta vista." |
| Error al pedir | el aviso de `mensajeError` y la tabla anterior, si había |

### 5.5 Quién la ve

- Todos los que tienen `INTERVENCIONES_VER`, igual que hoy.
- El backend ya filtra por alcance: el operario ve solo lo suyo, y como no tiene permisos de asignación, solo ve las pestañas "Abiertas" y "Cerradas".
- Al tocar una fila, el operario va a O3, porque `/intervenciones/:id` sigue eligiendo la vista con `vistaDetalle`.

---

## 6. R3 — Detalle de intervención (`/intervenciones/:id`, vista completa)

### 6.1 Datos

- `GET /api/intervenciones/:id`, clave `['intervencion', id]`, cada 60 segundos.
- Igual que en O3: si `parsearId` da `null`, no se hace el pedido. En ese caso, y también con `INTERVENCION_NO_ENCONTRADA`, se muestra `PantallaVacia` con "No encontramos esta intervención." y el botón "Volver a Intervenciones".

### 6.2 Cabecera

- **Enlace "← Intervenciones":**
  - lleva a `location.state.volverA`, si existe y empieza con `/intervenciones`;
  - si no, a `/intervenciones`.
- **Título** "Intervención N.º {id}", con `EstadoBadge` grande al lado.
- Si algún período de detención está abierto, la marca roja "Máquina detenida".
- Debajo, la **barra de acciones** (sección 7.1).

### 6.3 Distribución

Desde `lg`, dos columnas con `Grid`: la principal de 8 y la lateral de 4. Por debajo de `lg`, una sola columna, primero la principal.

**Columna principal:**

1. **"Falla reportada":** la descripción y, si hay, las observaciones.
2. **"Trabajo realizado":** solo si hay `trabajo_realizado`. El texto (respetando los saltos de línea), "Lo hizo: Personal propio" o "Lo hizo: Servicio externo" según `ejecucion`, y la fecha de finalización.
3. **"Historial":** `Timeline` con `eventosHistorial`. Cada ítem muestra:
   - el `titulo`;
   - `formatFechaHora(fecha)` · "por " + `nombreCompleto(persona)`;
   - si `mostrarRegistrado`, en gris: "cargado el {formatFechaHora(registrado)}";
   - el `detalle` en gris, si hay, cortado a 3 líneas.
   El punto usa el color del estado; los de auditoría van en gris.

**Columna lateral:**

1. **"Datos"**, en filas de dato y valor:

   | Dato | Valor |
   | :--- | :--- |
   | Máquina | `etiquetaMaquina` |
   | Sector | el nombre |
   | Estado de la máquina | `EstadoBadge` de máquina |
   | Reportada por | `nombreCompleto(creado_por)` · legajo |
   | Reportada | `formatFechaHora(fecha_creacion)` |
   | Responsable | `nombreCompleto(responsable)`, o "Sin asignar" |
   | Inicio del trabajo | `formatFechaHora(fecha_inicio)`, o "—" |
   | Finalización | solo si hay `fecha_finalizacion` |

2. **"Tiempos":**

   | Fila | Valor | "en curso" si |
   | :--- | :--- | :--- |
   | Espera hasta empezar | `espera_minutos` | `espera_en_curso` |
   | Duración del trabajo | `duracion_bruta_minutos` | `trabajo_en_curso` |
   | Trabajo efectivo | `duracion_neta_minutos` | el estado es `EN_PROCESO` |
   | Tiempo total | `tiempo_total_minutos` | nunca |
   | Máquina detenida | `inactividad_minutos` | `inactividad_en_curso` |

   - Todos los valores con `formatDuracion`.
   - Debajo de "Trabajo efectivo", en gris: "sin contar la espera de repuestos".
   - Debajo de "Tiempo total", en gris: "del reporte al cierre".

3. **"Detenciones de la máquina":**
   - Sin períodos: "Esta falla no detuvo la máquina."
   - Con períodos: uno debajo del otro, cada uno con:
     - "{formatFechaHora(desde)} → {formatFechaHora(hasta)}"; si está abierto, "→ **sigue detenida**", en rojo;
     - la duración con `formatDuracion(minutosEntre(desde, hasta, ahora))` y "en curso" si está abierto;
     - "Registrada por {nombreCompleto(abierto_por)}" y la `observacion`;
     - si está cerrado y tiene `confirmado_por`: "Volvió a funcionar, confirmado por {nombre}", más la `observacion_confirmacion` si hay.
   - **"Confirmar que volvió a funcionar":** botón en cada período abierto, si el usuario tiene `INTERVENCIONES_CONFIRMAR_RECUPERACION` (sección 7.4).

### 6.4 Celular

Escritorio primero. A 390 px alcanza con que:

- no haya desborde horizontal;
- la barra de acciones pase a varias filas;
- los diálogos ocupen toda la pantalla por debajo de `sm` (`fullScreen`).

---

## 7. R3 — Acciones

### 7.1 Barra de acciones

- Sale de `ordenarAcciones(acciones_disponibles)`:
  - la **principal**: botón lleno con el color de la marca;
  - las **visibles**: botones con variante `default`;
  - las del **menú**: dentro de un `Menu` con el botón "Más acciones". `CANCELAR` y `ELIMINAR` van al final, en rojo, separadas de las demás por un `Menu.Divider`.
- Si `acciones_disponibles` está vacía, no se muestra la barra. Es el caso del perfil Consulta.
- Si el menú queda vacío, no se muestra "Más acciones".

### 7.2 Comportamiento común

1. **Tomar** se hace directamente, sin diálogo: el botón muestra la carga mientras se envía. Todas las demás acciones abren un diálogo (`Modal`).
2. **`estado_esperado`** es el estado de la intervención **en el momento en que se abrió el diálogo**, no el último que trajo la actualización automática.
3. **Validaciones en pantalla** antes de enviar, con los mínimos de la tabla 7.3. Las fechas, con `validarMomento`.
4. **Botones de cada diálogo:**
   - el de confirmar, con el nombre de la acción ("Finalizar", "Reabrir"…) y la carga mientras se envía;
   - el de cerrar sin hacer nada se llama **"Volver"**, no "Cancelar", para no confundirlo con cancelar la intervención.
5. **Si sale bien:**
   - se cierra el diálogo;
   - aparece el aviso de la tabla 4.1;
   - se invalidan `['intervencion', id]`, `['intervenciones']`, `['maquinas']` y `['notificaciones-contador']`.
6. **Si falla con `requiereRecargar(error)`:** se cierra el diálogo, se muestra `mensajeError` y se vuelve a pedir el detalle. Los botones cambian solos, porque el backend deja de ofrecer la acción.
7. **Cualquier otro error:** el diálogo queda abierto, con el mensaje dentro (`Alert` rojo) y lo escrito sin tocar.
8. **"¿Cuándo?"** se pregunta siempre igual: un `SegmentedControl` con dos opciones y, si se elige la segunda, un `DateTimePicker` con `minDate` y `maxDate`. Lo que se manda sale de `momentoAIso`. Cada diálogo dice cuál es el mínimo y qué texto lleva la primera opción.
9. **"¿La máquina volvió a funcionar?"** (en Finalizar, Registrar como resuelta, Cancelar y Eliminar) se pregunta solo si hay un período de detención abierto:
   - dos botones, "Sí, ya funciona" y "No, sigue detenida", sin valor por omisión;
   - con "Sí": "¿Desde cuándo funciona?" (un "¿Cuándo?" del punto 8) y "Observación de la recuperación" (opcional);
   - **sin `INTERVENCIONES_CONFIRMAR_RECUPERACION`:** no se pregunta; se manda `maquina_recuperada: false` y se muestra: "La máquina va a seguir figurando detenida hasta que alguien con permiso confirme que volvió a funcionar."

### 7.3 Cada acción

Todas las acciones con cuerpo llevan `estado_esperado`, salvo Eliminar. "Opcional" quiere decir que, si queda vacío, el campo no se manda.

| Acción | Pedido | Campos del diálogo |
| :--- | :--- | :--- |
| Tomar | `POST /api/intervenciones/:id/tomar` | sin diálogo |
| Asignar o Reasignar | `PUT /api/intervenciones/:id/responsable` | **Responsable** (`usuario_id`): `Select` con `GET /api/intervenciones/:id/responsables-habilitados` (se pide al abrir el diálogo), sin el responsable actual, con `nombreCompleto` · legajo. Si la lista queda vacía: "No hay personas habilitadas para esta máquina." **Motivo** (`motivo`): obligatorio si ya hay responsable (reasignación); si no, opcional. |
| Quitar responsable | `DELETE /api/intervenciones/:id/responsable` | **Motivo** (`motivo`), obligatorio. |
| Iniciar trabajo | `POST /api/intervenciones/:id/iniciar` | **¿Cuándo empezó?** (`fecha_inicio`): "Ahora" u "Otra fecha y hora", con mínimo `fecha_creacion`. **Observación** (`observacion`), opcional. Si no tiene responsable: "Vas a quedar como responsable." |
| Esperar repuestos | `POST /api/intervenciones/:id/espera-repuestos` | **¿Qué falta?** (`observacion`): al menos 5 caracteres. Ejemplo: "Rodamiento 6204, pedido al proveedor". |
| Reanudar | `POST /api/intervenciones/:id/reanudar` | **Observación** (`observacion`), opcional. Ejemplo: "Llegó el rodamiento". |
| Finalizar | `POST /api/intervenciones/:id/finalizar` | **Trabajo realizado** (`trabajo_realizado`): al menos 5 caracteres. **¿Quién lo hizo?** (`ejecucion`): `SegmentedControl` "Personal propio" (`INTERNA`) / "Servicio externo" (`EXTERNA`), sin valor por omisión. **¿Cuándo terminó?** (`fecha_finalizacion`): "Ahora" u "Otra fecha y hora", con mínimo `fecha_inicio`. **Observación** (`observacion`), opcional. **Recuperación**, según el punto 7.2.9: `maquina_recuperada`, `fecha_recuperacion` ("Al terminar el trabajo" u "Otra fecha y hora", con mínimo el `desde` del período abierto) y `observacion_recuperacion`. |
| Registrar como resuelta | `POST /api/intervenciones/:id/resolver-ahora` | Lo mismo que Finalizar, más **¿Cuándo empezó el arreglo?** (`fecha_inicio`), **obligatorio**: un `DateTimePicker` (sin la opción "Ahora"), con mínimo `fecha_creacion` y valor inicial `fecha_creacion`. El mínimo de "¿Cuándo terminó?" es esa fecha de inicio. Arriba del formulario, en gris: "Para fallas que ya se arreglaron sin pasar por 'Iniciar trabajo'." |
| Cancelar intervención | `POST /api/intervenciones/:id/cancelar` | **Motivo** (`motivo`): al menos 5 caracteres. **Recuperación**, según el punto 7.2.9, con "Ahora" como primera opción de "¿Desde cuándo funciona?". El botón de confirmar es rojo: "Cancelar intervención". |
| Reabrir | `POST /api/intervenciones/:id/reabrir` | **Motivo** (`motivo`): al menos 5 caracteres. Si **no** hay período abierto: **¿La máquina volvió a detenerse?** (`maquina_detenida`), "Sí" / "No", sin valor por omisión. Con "Sí": **¿Desde cuándo?** (`desde`), "Ahora" u "Otra fecha y hora", con mínimo `minimoNuevaDetencion(detalle)`, y **Observación de la detención** (`observacion_detencion`), opcional. |
| Registrar detención | `POST /api/intervenciones/:id/registrar-detencion` | **¿Desde cuándo está detenida?** (`desde`): "Ahora" u "Otra fecha y hora", con mínimo `fecha_creacion`. **Qué pasó** (`observacion`): al menos 5 caracteres. Ejemplo: "Se paró al volver a arrancarla". |
| Editar | `PATCH /api/intervenciones/:id` | El mismo diálogo de O3: descripción y observaciones, con `hayCambiosReporte` y observaciones vacías como `null`. **Se pasa a `componentes/`** y lo usan las dos pantallas. |
| Eliminar | `POST /api/intervenciones/:id/eliminar` | Arriba, en un `Alert` amarillo: "Se usa para reportes cargados por error. La intervención deja de aparecer en las listas." **Motivo** (`motivo`): al menos 5 caracteres. **Recuperación**: solo `maquina_recuperada` y `observacion_recuperacion`, porque este pedido no acepta fecha. El botón de confirmar es rojo: "Eliminar". Si sale bien, además del aviso, se navega a la lista (`volverA` o `/intervenciones`). |

### 7.4 Confirmar que la máquina volvió a funcionar

No está en `acciones_disponibles`, porque es una acción sobre la máquina. Se agrega en R3, y no solo en el detalle de máquina de la F3, porque sin ella una falla finalizada con "No, sigue detenida" deja la máquina detenida sin forma de cerrarla desde las pantallas nuevas.

- **Dónde:** botón en cada período abierto de "Detenciones de la máquina", si el usuario tiene `INTERVENCIONES_CONFIRMAR_RECUPERACION`.
- **Diálogo:**
  - "¿Desde cuándo funciona?": "Ahora" u "Otra fecha y hora", con mínimo el `desde` del período;
  - "Observación", opcional.
- **Pedido:** `POST /api/maquinas/{maquina.id}/confirmar-recuperacion` con `periodo_ids: [id del período]`, `fecha_recuperacion` y `observacion`.
- **Aviso al terminar bien:** "Listo: la máquina volvió a funcionar."
- El resto del comportamiento, igual que la sección 7.2.

---

## 8. Rutas

| Ruta | Antes | Ahora |
| :--- | :--- | :--- |
| `/intervenciones` | En construcción | R2 (sección 5); sigue exigiendo `INTERVENCIONES_VER` |
| `/intervenciones/:id` | O3 o "En construcción F2", según `vistaDetalle` | O3 o **R3** (secciones 6 y 7), según `vistaDetalle` |

Las demás rutas no cambian. El Inicio del responsable sigue llevando a `/tablero`, que llega en la F3.

**No entra en esta etapa:**

- **El tipo de intervención** (columna y filtro): hoy todas son correctivas. Se agrega con Preventivos.
- **El filtro por responsable:** necesita una consulta de las personas que pueden ser responsables, que hoy no existe fuera de cada intervención. Se agrega en la F3, junto con el tablero.
- **El enlace de la máquina a su detalle:** la pantalla de máquina llega en la F3.

---

## 9. Pruebas del frontend

En `frontend/src/lib/`, con `node:test`. Las que usan fechas locales comparan instantes (`getTime()`) y no textos con zona fija, así pasan en cualquier zona horaria.

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| FE-19 | `ordenarAcciones` y `etiquetaAccion` | `['TOMAR','ASIGNAR','INICIAR','RESOLVER_AHORA','CANCELAR','REGISTRAR_DETENCION','EDITAR','ELIMINAR']` → principal `INICIAR`; visibles `TOMAR`, `ASIGNAR`, `RESOLVER_AHORA`; menú `REGISTRAR_DETENCION`, `EDITAR`, `CANCELAR`, `ELIMINAR`. `['ASIGNAR','ESPERAR_REPUESTOS','FINALIZAR','CANCELAR','REGISTRAR_DETENCION','EDITAR']` → principal `FINALIZAR`; visibles `ASIGNAR`, `ESPERAR_REPUESTOS`; menú `REGISTRAR_DETENCION`, `EDITAR`, `CANCELAR`. `['REABRIR']` → sin principal, visibles `REABRIR`, menú vacío. `[]` y `['ALGO_NUEVO']` → todo vacío. `etiquetaAccion('ASIGNAR', true)` → "Reasignar"; con `false` → "Asignar". |
| FE-20 | `requiereRecargar` y `mensajeError` | `true` para `ESTADO_DESACTUALIZADO`, `INTERVENCION_YA_ASIGNADA` y `PERIODO_INVALIDO`; `false` para `MOTIVO_REQUERIDO`, `FECHA_INCOHERENTE` y `SIN_CONEXION`. `mensajeError` devuelve el texto de la sección 3.4 para `INTERVENCION_YA_ASIGNADA`, `EJECUCION_REQUERIDA` y `DECISION_RECUPERACION_REQUERIDA`, aunque el error traiga otro mensaje. |
| FE-21 | `fechas.ts` | `fechaLocalTexto(new Date(2026, 0, 2, 3, 4, 5))` → "2026-01-02 03:04:05". `fechaLocalAIso('2026-11-02 14:05:00')` cumple `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/` y representa el mismo instante que `new Date(2026, 10, 2, 14, 5, 0)`; sin segundos (`'2026-11-02 14:05'`), lo mismo. `'2026-02-30 10:00'`, `'abc'` y `''` → `null`. `validarMomento`: con `'ahora'` → `null`; `'otra'` sin fecha → "Indicá la fecha y la hora."; anterior al mínimo → el texto con la fecha mínima; el mismo minuto que el mínimo → `null`; posterior a `ahora` → "No puede ser posterior a este momento.". `momentoAIso` con `'ahora'` → `undefined`; con el mismo minuto que el mínimo pero antes en segundos → el instante del mínimo. `rangoDiasAIso('2026-11-01', '2026-11-03')` → `desde` es el mismo instante que `new Date(2026, 10, 1, 0, 0, 0)` y `hasta` que `new Date(2026, 10, 3, 23, 59, 59)`; con `null` en `hasta` → solo `desde`. `minutosEntre` con 90 minutos → 90; con `hasta` `null` usa `ahora`; con `hasta` anterior a `desde` → 0. |
| FE-22 | `vistasDisponibles`, `leerFiltros` y `escribirFiltros` | Permisos de RESPONSABLE_MANTENIMIENTO → las cuatro vistas. OPERARIO y CONSULTA → solo "Abiertas" y "Cerradas". `leerFiltros` de una dirección vacía → los valores por omisión. `vista=sin-asignar` sin ese permiso → `abiertas`. `estado=FINALIZADA` en la vista `abiertas` → sin estados. `sector=abc` → `null`. `desde=2026-02-30` → `null`. `pagina=0` → 1. Ida y vuelta: unos filtros con todos los campos completos, escritos y vueltos a leer, dan lo mismo. `escribirFiltros` de los valores por omisión → sin claves. |
| FE-23 | `paramsListado` y `hayFiltros` | Vista `sin-asignar` → `sin_asignar: true`, sin `estado`. `mias` → `mias: true` y los tres estados abiertos. `cerradas` con `estados: ['CANCELADA']` → `estado: 'CANCELADA'`. Texto `' a '` → sin `q`; `'torno'` → `q: 'torno'`. Página 3 con tamaño 25 → `offset: 50`, `limit: 25`. `hayFiltros` de los valores por omisión → `false`; con solo la vista o la página cambiadas → `false`; con sector → `true`. |
| FE-24 | `tiempoLista` y `minimoNuevaDetencion` | Pendiente con 75 minutos de espera en curso → `{ etiqueta: 'Espera', texto: '1 h 15 min', enCurso: true }`. Esperando repuestos → "Trabajo". Finalizada → "Total", sin "en curso". Cancelada → etiqueta `null` y "—". `minimoNuevaDetencion` sin períodos → `fecha_creacion`; con un período cerrado posterior a la creación → su `hasta`; un período abierto no cuenta. |
| FE-25 | `eventosHistorial` | Con un historial de dos estados y una auditoría de toma, reasignación con motivo, edición de observaciones y reapertura: títulos "Reporte registrado", "Tomada por …", "Reasignada de … a …" (con el motivo como detalle), "Se editaron las observaciones" (con "Antes: …") y sin ítem de reapertura. La toma no muestra el texto automático como detalle. A igual `registrado`, la auditoría queda antes que el estado. `mostrarRegistrado` es `true` solo cuando `fecha_efectiva` y `cambiado_en` difieren en 60 segundos o más. |

En FE-22, los permisos de cada perfil se copian de las migraciones, igual que en FE-04 y FE-11.

---

## 10. Lo que voy a revisar yo

Con el backend y el frontend levantados contra mi base local, con datos de planta, y capturas en **1440×900** y **390×844**.

**Pruebas del backend:**

- la línea de datos que quedaron, en 0, también con el control activo en mi base;
- AF-21.

**R2:**

- las pestañas según el perfil (responsable, operario y consulta);
- cada filtro, combinado con otros;
- la paginación;
- volver desde un detalle y encontrar la lista igual (pestaña, filtros y página);
- un enlace con filtros pegado en otra pestaña;
- la búsqueda con 1 carácter (no tiene que dar error);
- la tabla a 390 px sin desborde de la página.

**R3, cada acción de punta a punta, mirando la base después de cada una:**

- tomar; asignar; reasignar sin motivo (tiene que pedirlo) y con motivo; quitar responsable;
- iniciar ahora y con una fecha anterior; con una fecha anterior a la creación (tiene que avisar antes de enviar);
- esperar repuestos y reanudar;
- finalizar:
  - con la máquina detenida y "Sí, ya funciona": período cerrado y máquina operativa;
  - con "No, sigue detenida": período abierto y después "Confirmar que volvió a funcionar";
- registrar como resuelta, con fechas;
- cancelar con detención abierta;
- reabrir, con y sin nueva detención;
- registrar detención;
- editar;
- eliminar: desaparece de la lista;
- el historial con nombres en las asignaciones y "cargado el …" cuando la fecha efectiva es anterior;
- **dos pestañas a la vez:** una toma la intervención mientras la otra tiene abierto el diálogo de iniciar; tiene que avisar y actualizar;
- el perfil Consulta sin barra de acciones;
- el operario sigue viendo O3.

**Celular:** desborde, barra de acciones y diálogos a pantalla completa.

---

## 11. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 9 están hechas, en dos commits (regla 2).
2. `npm run test:front` en verde (FE-01 a FE-25).
3. `npm run test:todo -- etapa-f2` en verde con **274** pruebas y la línea de datos que quedaron en 0. El log va en `docs/evidencia/`.
4. `npm run typecheck` y `npm run build:frontend` sin errores.
5. Push de los dos commits en `feat/base-neon`.

**Informe corto:**

1. Los hashes de los dos commits.
2. La salida final de `test:front`, más la línea de total y la de datos que quedaron de `test:todo`, para cada commit.
3. Typecheck y build.
4. Desvíos, incluido todo lo que no se haya hecho.
5. Dudas.
