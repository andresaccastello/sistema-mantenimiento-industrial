# Etapa F1.1 — Correcciones de las pantallas del operario

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `931c713` (Etapa F1).
> **Origen:** revisión con el sistema levantado en local y capturas en 1440×900 y 390×844, con datos de planta (7 máquinas en 3 sectores, reportes abiertos, en espera, finalizados y cancelados). Todo lo de abajo se vio en las capturas, se midió con el navegador o se comprobó en la base.

---

## 0. Reglas de trabajo

Las de la Etapa F1 (sección 0). No se agregan dependencias.

Guardar este archivo como `docs/etapas/etapa-f1-1-correcciones.md`.

---

## 1. Las máquinas nunca se agrupan por sector (lo principal)

**Problema.** En "Reportar falla", la lista de máquinas no muestra nunca los grupos "Máquinas de mis sectores" y "Otras máquinas", aunque el operario tenga sector y haya máquinas de otros sectores. Todas caen en "Otras máquinas" y, como ese grupo es el único con elementos, la lista sale sin grupos.

**Causa.** Las columnas `id` de `maquinas` y `sectores` son `bigint`, y `pg` devuelve los `bigint` como **texto**. `GET /api/maquinas` responde `"id": "763"` y `"sector": { "id": "226" }`, pero los sectores del usuario (`/api/auth/me`) llegan como número (`197`). `agruparMaquinas` compara `197` con `"197"` y nunca coinciden.

`intervenciones.ts` ya convierte con `Number(...)`; `maquinas.ts` y `sectores.ts` no.

**Corrección (backend, API-10).** Devolver como **número** todos los `id` de estas respuestas, con `Number(...)`, igual que en `intervenciones.ts`:

| Archivo | Respuestas |
| :--- | :--- |
| `backend/functions/maquinas.ts` | `GET /`, `GET /:id`, `POST /`, `PUT /:id`: `id` y `sector.id` (y `sector_id`, si la respuesta lo trae) |
| `backend/functions/sectores.ts` | todas las rutas: `id` de cada sector |

No usar un conversor global de `pg` (`setTypeParser`): cambiaría todas las consultas del sistema y no es el alcance de esta corrección.

**Prueba nueva en `backend/tests/api_front.test.ts`:**

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| AF-20 | Ids numéricos | En `GET /api/maquinas`, cada máquina tiene `typeof id === 'number'` y `typeof sector.id === 'number'`. Lo mismo en `GET /api/maquinas/:id`. En `GET /api/sectores`, cada sector tiene `typeof id === 'number'`. |

Si alguna prueba existente comparaba esos `id` con texto, se ajusta y se informa en "Desvíos".

**Frontend.** Cuando uno de los dos grupos queda vacío, la lista sin grupos tiene que ir **ordenada por nombre**: usar `[...propias, ...otras]`, que ya vienen ordenadas, y no `maquinas` tal como llega. Hoy sale en el orden del backend ("Compresor de aire" antes que "Cámara de pintura").

---

## 2. En el celular se cortan los botones "Sí / No"

**Problema.** A 390 px, los dos botones de "¿La máquina quedó detenida?" miden 167 px y el texto no entra. Se ve **"Sí, está parac"** y **"No, sigue fun"**. Es la pregunta más importante del formulario y el operario la contesta desde el celular.

**Corrección.**

- Los dos botones van en `SimpleGrid cols={{ base: 1, xs: 2 }}`: uno debajo del otro en el celular y uno al lado del otro desde 576 px.
- El grupo lleva `role="group"` y `aria-labelledby` con el id del texto "¿La máquina quedó detenida?".
- En pantallas de menos de 768 px, "Enviar reporte" y "Cancelar" ocupan el ancho completo, uno debajo del otro ("Enviar reporte" primero). En escritorio quedan como están.

---

## 3. "Ver más" vacía la pantalla y la lleva arriba

**Problema.** En "Mis reportes", al tocar "Ver más", toda la pantalla se reemplaza por el indicador de carga (también desaparece el bloque "Abiertos") y la página vuelve arriba: se midió el desplazamiento de 616 px a 0. El operario pierde el lugar donde estaba.

**Causa.** Al cambiar el límite cambia la clave de la consulta, la consulta nueva no tiene datos y `isLoading` vuelve a `true`.

**Corrección.**

- En la consulta de "Cerrados recientemente", usar `placeholderData: keepPreviousData` (de `@tanstack/react-query`). Así se siguen viendo las tarjetas mientras llegan las nuevas.
- El botón "Ver más" muestra `loading` mientras se piden los siguientes (`isPlaceholderData`).
- El indicador de carga general aparece solo en la primera carga, cuando todavía no hay nada para mostrar.

---

## 4. Al editar, no se pueden borrar las observaciones

**Problema.** En el diálogo "Editar reporte", si el operario borra las observaciones y guarda:

- si también cambió la descripción, la descripción se guarda pero **las observaciones siguen igual en la base**;
- si solo borró las observaciones, aparece el error "Los valores enviados no presentan cambios respecto de los actuales".

**Causa.** Con el campo vacío se manda `observaciones: undefined`, y el backend lo interpreta como "no tocar este campo".

**Corrección.**

- Con el campo vacío se manda `observaciones: null`. El backend ya acepta `null` y deja el campo vacío.
- Nueva función pura `hayCambiosReporte(actual, editado)` en `lib/intervenciones.ts`. Recibe dos objetos `{ descripcion, observaciones }` y devuelve `true` si alguno cambió. Compara los textos recortados y trata `null`, `undefined` y `""` como iguales.
- "Guardar cambios" queda **deshabilitado** mientras `hayCambiosReporte` dé `false`. Así no se puede llegar al error de "sin cambios".

---

## 5. Mensajes de error en el idioma de la pantalla

**Problema.** Cuando el responsable toma el reporte mientras el operario lo está editando, el diálogo se cierra bien y el botón "Editar" desaparece, pero el aviso dice:

> "Con alcance PROPIAS solo puedes editar intervenciones creadas por ti, en estado PENDIENTE y sin responsable asignado"

El mensaje es técnico ("alcance PROPIAS") y usa "puedes" en lugar de "podés".

**Corrección.** Agregar a `mensajeError` (en `lib/errores.ts`):

| Código | Texto |
| :--- | :--- |
| `EDICION_NO_PERMITIDA` | "Ya no se puede editar: el reporte cambió de estado o ya tiene responsable." |
| `SIN_CAMBIOS` | "No hay cambios para guardar." |

---

## 6. Dirección con un número inválido

**Problema.** `/intervenciones/abc` muestra "Error al cargar reporte · ID de intervención inválido".

**Corrección.**

- Nueva función pura `parsearId(texto)` en `lib/formato.ts`. Devuelve el número si el texto es un entero positivo y, si no, `null`.
- En el detalle, si `parsearId(id)` es `null`, no se hace el pedido (`enabled: false`) y se muestra lo mismo que con `INTERVENCION_NO_ENCONTRADA`: "No encontramos este reporte." con el botón "Volver a Mis reportes".

---

## 7. Orden de los hooks en "Mis reportes"

**Problema.** `MisReportes` devuelve `<Navigate>` **antes** de llamar a `useState` y `useQuery`. Rompe la regla de los hooks de React: si los permisos del usuario cambian durante la sesión (por ejemplo, con `recargarUsuario`), React puede cortar con "Rendered fewer hooks than expected".

**Corrección.** Separar en dos componentes:

- uno exterior, que solo decide la redirección con `destinoInicio`;
- el interior, que tiene los hooks y la pantalla.

Revisar que `ReportarFalla` y `DetalleReporteOperario` no tengan el mismo problema.

---

## 8. Detalle: observaciones de más de 2000 caracteres

**Problema.** En "Reportar falla" y en "Editar reporte", el contador de observaciones se pone rojo al pasar los 2000 caracteres, pero se puede enviar igual y el error llega recién del backend.

**Corrección.** Validar en pantalla, con el mensaje "Las observaciones no pueden superar los 2000 caracteres.", igual que se hace con la descripción.

---

## 9. Pruebas del frontend

En `frontend/src/lib/`:

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| FE-16 | `hayCambiosReporte` | Mismos textos → `false`. Solo cambian los espacios de los extremos → `false`. Observaciones `null` contra `""` → `false`. Descripción distinta → `true`. Observaciones `"algo"` contra `""` → `true`. |
| FE-17 | `mensajeError` | `EDICION_NO_PERMITIDA` y `SIN_CAMBIOS` devuelven los textos de la sección 5, aunque el error traiga otro mensaje del backend. |
| FE-18 | `parsearId` | `"12"` → 12. `"abc"`, `"0"`, `"-3"`, `"1.5"`, `""`, `null` → `null`. |

---

## 10. Lo que voy a revisar yo

Con los mismos datos de planta:

- la lista de máquinas con los dos grupos, y sin grupos (ordenada) para un usuario cuyos sectores tienen todas las máquinas;
- los botones Sí/No y los de enviar en 390 px, sin texto cortado;
- "Ver más" sin perder el bloque "Abiertos" ni el lugar de la página;
- borrar las observaciones al editar (en la base tiene que quedar `NULL`) y el botón deshabilitado sin cambios;
- el aviso en lenguaje claro cuando alguien toma el reporte mientras se edita;
- `/intervenciones/abc`.

---

## 11. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 9 están hechas.
2. `npm run test:front` en verde (FE-01 a FE-18).
3. `npm run test:todo -- etapa-f1-1` en verde con **273** pruebas; el log va en `docs/evidencia/`.
4. `npm run typecheck` y `npm run build:frontend` sin errores.
5. Commit y push en `feat/base-neon`.

**Informe corto:**

1. Hash del commit.
2. La salida final de `test:front` y la línea de total de `test:todo`.
3. Typecheck y build.
4. Desvíos, incluido todo lo que no se haya hecho.
5. Dudas.
