# Etapa PV2 — Preventivos: las pantallas

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `0a34b70` (Etapa PV1).
> **Origen:** la PV1 dejó la API de preventivos (D-021). Esta etapa la pone en pantalla, y suma tres ajustes chicos de la API que hacen falta para las pantallas.

**Lo que hay que lograr, en una frase:** el responsable abre "Preventivos", ve qué vence, genera la intervención con un botón, la hace marcando las tareas, y al finalizarla el plan se reprograma solo.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Tres commits:**

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1 | `feat(api): responsables de un plan y ajustes de la PV1` |
   | 2 | 2, 3 y 4 | `feat(front): pantallas de preventivos` |
   | 3 | 5 y 6 | `feat(front): preventivos en el tablero, la máquina y la intervención` |

3. **Pruebas:**
   - solo `test:migration-018`, `test:preventivos`, `test:repuestos` y `test:front`;
   - **no correr `test:todo`:** va en la corrida de la noche;
   - las pruebas existentes no se modifican, salvo lo que autoriza la sección 1.
4. **Escritorio primero, y nada desborda en un celular de 390 px.** Las tablas anchas van dentro de un `ScrollArea`.
5. **Archivos chicos.** Los componentes nuevos van en `frontend/src/componentes/preventivos/`. `DetalleMaquina.tsx` y `DetalleIntervencion.tsx` ya son grandes: lo nuevo entra en ellos como un componente aparte, con pocas líneas en el archivo.
6. **El front no calcula fechas de vencimiento ni estados:** usa `hoy`, `dias`, `estado` y `proxima_fecha` tal como los manda la API.
7. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-pv2-preventivos-pantallas.md`.

---

## 1. Ajustes de la API (primer commit)

### 1.1 Responsables para un plan

`GET /api/planes/responsables-habilitados?maquina_id=X`. Se declara antes de `/:id`.

- **Pide `PLANES_GESTIONAR`,** con el alcance de la PV1 (4.1).
- **Devuelve** los usuarios que pasarían `validarResponsableHabilitado` para el sector de esa máquina, como `Persona[]` (`id`, `legajo`, `nombre`, `apellido`), ordenados por apellido y nombre.
- **La lógica es la de `GET /api/intervenciones/:id/responsables-habilitados`.** Se saca a una función compartida, y la usan los dos endpoints. El de intervenciones sigue respondiendo lo mismo.

| Caso | Respuesta |
| :--- | :--- |
| Sin `maquina_id`, o inválido | 422 `DATOS_INVALIDOS` |
| La máquina no existe | 404 `MAQUINA_NO_ENCONTRADA` |
| Máquina de otro sector, con alcance que no es `TODAS` | 403 `PERMISO_INSUFICIENTE` |

### 1.2 Opciones de repuestos y proveedores

`GET /api/repuestos/opciones` y `GET /api/proveedores/opciones` suman `PLANES_GESTIONAR` a los permisos que aceptan. Hoy un usuario con `PLANES_GESTIONAR` por excepción, sin los otros permisos, no podría elegir el repuesto sugerido.

### 1.3 "Hoy" en un solo lugar

**Hoy la expresión de la zona horaria está en dos lugares:** la vista y `SQL_HOY`.

- En la `018`, una función `hoy_instalacion()` que devuelve la fecha. Va antes de la vista, con `CREATE OR REPLACE`.
- La vista y `SQL_HOY` la usan.
- **M18-02** suma que la función existe y da lo mismo que `(now() AT TIME ZONE zona_horaria)::date`.

### 1.4 Pruebas

| ID | Qué |
| :--- | :--- |
| PV-02, ampliada | **El nombre repetido con tildes:** "Eléctrico" y "ELÉCTRICO" en la misma máquina dan 409. |
| PV-13 | **Responsables para un plan:**<br>• devuelve los mismos usuarios que el endpoint de intervenciones, para una intervención de esa máquina;<br>• no incluye un operario, ni un responsable desactivado, ni uno con alcance `SECTORES` de otro sector;<br>• los tres errores de la 1.1;<br>• O: 403. |
| PV-14 | **Opciones:** un operario con `CONCEDER` de `PLANES_GESTIONAR` recibe 200 en las dos opciones. Sin la excepción, 403. |

**En el informe:** la salida de `SHOW lc_ctype;` y de `SELECT lower('ÁÉÍÓÚÑ');` en la rama de pruebas.

### 1.5 Documentación

- **`docs/modelo-datos.md`:**
  - el punto de "Criterios" ya no dice que los planes admiten horas y kilómetros: eso es de la PV3;
  - el diagrama suma `PLAN_TAREAS` e `INTERVENCION_TAREAS`.
- **`CLAUDE.md`:** la versión de PostgreSQL de la rama de pruebas, que es la 18.

---

## 2. Lógica del front, sin pantallas (segundo commit)

Un archivo nuevo, `frontend/src/lib/preventivos.ts`, con sus pruebas en `lib/preventivos.test.ts`.

| Función | Qué hace |
| :--- | :--- |
| `textoFrecuencia(valor, unidad)` | "Cada día", "Cada 3 días", "Cada semana", "Cada 2 semanas", "Cada mes", "Cada 6 meses", "Cada año", "Cada 2 años". |
| `textoVencimiento(dias)` | Con el `dias` de la API:<br>• "Venció hace 3 días", "Venció ayer";<br>• "Vence hoy";<br>• "Vence mañana", "Vence en 5 días". |
| `formatFechaDia('2026-11-09')` | "09/11/2026". **Sin pasar por `Date`:** con `new Date`, el 9 se mostraría como el 8 en Argentina. `null` da "—". |
| `validarTareaBorrador(borrador)` | Los mismos límites que la API (PV1, 4.4). Devuelve los errores por campo, con los mensajes de la tabla de la 2.1. |
| `cuerpoPlan(borrador)` y `cuerpoTarea(borrador)` | Arman los cuerpos del alta del plan y de una tarea. Los campos vacíos no van, y los números van como números. |
| `tareasParaGenerar(tareas)` | Para el diálogo de generar (3.4):<br>• tildadas: las `VENCIDA` y `PROXIMA`;<br>• destildadas: las `AL_DIA`;<br>• deshabilitadas: las `EN_CURSO` y `INACTIVA`, con el motivo ("Ya está en la intervención N.º 9001", "Inactiva"). |
| `avisoTareasSinMarcar(resumen)` | Con 0 sin marcar, `null`. Con 1: "Queda 1 tarea sin marcar. Si finalizás así, vuelve a quedar pendiente en el plan." Con más, en plural. |

**En `lib/estados.ts`:** la entidad `tarea_preventiva`, con los cinco estados.

| Estado | Texto | Color | Ícono |
| :--- | :--- | :--- | :--- |
| `VENCIDA` | Vencida | `red` | `IconAlertTriangle` |
| `PROXIMA` | Próxima | `orange` | `IconClock` |
| `EN_CURSO` | En curso | `blue` | `IconTool` |
| `AL_DIA` | Al día | `green` | `IconCircleCheck` |
| `INACTIVA` | Inactiva | `gray` | `IconBan` |

### 2.1 Mensajes de validación de una tarea

| Campo | Mensaje |
| :--- | :--- |
| Acción | "Escribí qué hay que hacer (de 3 a 200 caracteres)." |
| Cada | "Ingresá un número entero de 1 a {máximo}." El máximo sale de la unidad. |
| Primera fecha | "Elegí la fecha." |
| Repuesto y cantidad | "Ingresá la cantidad." / "Elegí el repuesto.", según cuál falte. |

**Pruebas:** FE-67 a FE-73, una por función de la tabla de la sección 2, más los estados nuevos de `estados.ts`. Si alguna función conviene partirla, se usan los IDs que sigan.

---

## 3. Pantallas de preventivos (segundo commit)

### 3.1 Menú y rutas

- **Menú:** "Preventivos", con `PLANES_GESTIONAR`, después de "Intervenciones", con el ícono `IconCalendarCheck`. `lib/menu.ts` y su prueba.
- **Rutas,** las tres con `RutaProtegida permiso="PLANES_GESTIONAR"`:

| Ruta | Pantalla |
| :--- | :--- |
| `/preventivos` | P1 |
| `/preventivos/planes/nuevo` | P3. Con `?maquina=ID`, la máquina viene elegida. |
| `/preventivos/planes/:id` | P2 |

### 3.2 P1 — Preventivos

Dos pestañas, **Vencimientos** y **Planes**, guardadas en la dirección (`?vista=`), como las de Repuestos. Arriba, a la derecha, el botón **"Nuevo plan"**.

**Vencimientos** (`GET /api/planes/vencimientos`):

- **Arriba, cuatro tarjetas con el `resumen`:** Vencidas, Próximas, En curso y Al día. Cada una es un filtro por estado: tocarla deja ese estado solo; tocarla otra vez vuelve al filtro por omisión (las tres primeras).
- **Filtros:** planta, sector y máquina. Todos en la dirección.
- **Tabla:**

  | Columna | Qué muestra |
  | :--- | :--- |
  | Estado | La insignia de la 2, con color, texto e ícono. |
  | Vence | `formatFechaDia(proxima_fecha)`, y debajo `textoVencimiento(dias)`. |
  | Tarea | La acción, y debajo `textoFrecuencia`. |
  | Máquina | Código y nombre, con enlace a la máquina, y la criticidad con `CriticidadBadge`. |
  | Plan | Con enlace a P2. |
  | Responsable | El del plan, o "Sin responsable". |
  | Acción | En curso: "Intervención N.º X", con enlace. Si no: el botón **"Generar"**, que abre el diálogo de 3.4 para ese plan. |

- **Paginación** de 100, con `X-Total-Count`, como en Intervenciones.
- **Sin filas:** "No hay tareas vencidas ni próximas." Con un filtro elegido: "No hay tareas con estos filtros."

**Planes** (`GET /api/planes`):

- **Filtros:** planta, sector y máquina, y un interruptor "Ver inactivos" (`?all=true`).
- **Tabla:**
  - Plan, con enlace a P2. Si está inactivo, con la insignia "Inactivo".
  - Máquina y Responsable.
  - Tareas: las activas.
  - Pendientes: "2 vencidas · 1 próxima", con las que haya; si no hay ninguna, "—".
  - Próxima: la fecha, con `formatFechaDia`.
- **Sin planes:** "Todavía no hay planes preventivos. Creá el primero con «Nuevo plan» o desde la ficha de una máquina."

### 3.3 P2 — Detalle de un plan

**Encabezado:**
- "← Preventivos";
- el nombre del plan, con la insignia "Inactivo" si corresponde;
- debajo, la máquina con enlace, el responsable y "Avisa 7 días antes" (la anticipación).

**Acciones:**

| Botón | Qué hace |
| :--- | :--- |
| **Generar intervención** | Principal. Abre 3.4. No está con el plan inactivo. |
| Agregar tarea | Abre 3.5. |
| Editar | Un diálogo con nombre, descripción, responsable y anticipación (`PATCH`). |
| Desactivar / Reactivar | Con confirmación: "Las tareas no van a aparecer en los vencimientos ni se van a poder generar." |

**Tareas:** una tabla, en su orden.

| Columna | Qué muestra |
| :--- | :--- |
| Estado | La insignia. |
| Tarea | La acción y el detalle, recortado a dos líneas. |
| Frecuencia | `textoFrecuencia`. |
| Última vez | `formatFechaDia(ultima_ejecucion)`, o "Nunca". |
| Próxima | `formatFechaDia(proxima_fecha)`, y debajo `textoVencimiento`. Con la tarea inactiva: "—". |
| Sugerido | Repuesto, cantidad y unidad, y el proveedor, si tiene. |
| Menú de la fila | Editar, y Desactivar o Reactivar. Si está en curso, también "Ver intervención N.º X". |

**Debajo, "Intervenciones de este plan":** las últimas 20, con número (enlace), estado, generada, finalizada y responsable. Sin ninguna: "Todavía no se generó ninguna intervención de este plan."

### 3.4 Diálogo "Generar intervención"

- **Título:** "Generar intervención preventiva", y el nombre del plan.
- **Una casilla por tarea,** con `tareasParaGenerar`. Cada fila lleva la acción, la insignia y `textoVencimiento`.
- **Debajo, quién la recibe:**
  - con responsable: "Se asigna a Nombre Apellido.";
  - sin responsable: "El plan no tiene responsable: la intervención queda sin asignar.".
- **El botón:** "Generar" si hay una tarea tildada; "Generar con N tareas" si hay más. Sin ninguna tildada, está deshabilitado.
- **Al generar:**
  - aviso "Se generó la intervención N.º X.", y se va a esa intervención;
  - si `responsable_omitido`, además un aviso amarillo: "El responsable del plan ya no puede recibir intervenciones: quedó sin asignar.".
- **Errores:** `TAREA_EN_CURSO` y `SIN_TAREAS_PARA_GENERAR` muestran su mensaje en el diálogo y refrescan las tareas. Los demás, con `mensajeError`.
- **Se usa desde:** P1 y P2.

### 3.5 Diálogo de una tarea

Para agregar y para editar. En P3 se usa sin guardar en la API: devuelve la tarea al formulario.

| Campo | Cómo |
| :--- | :--- |
| Acción | Texto, obligatorio. |
| Detalle | Texto de varias líneas, opcional. |
| Cada | Un número y la unidad: días, semanas, meses o años. |
| Primera fecha | Un selector de fecha, con `valueFormat="DD/MM/YYYY"`. Ayuda: "Cuándo vence por primera vez." Al editar una tarea que ya se hizo: "Ya se hizo: la próxima fecha se cuenta desde la última vez." |
| Repuesto sugerido | Un buscador con `/api/repuestos/opciones`, opcional. Si se elige, se pide la cantidad, con la unidad del repuesto al lado. |
| Proveedor sugerido | Un buscador con `/api/proveedores/opciones`, opcional. |

- **Valida con `validarTareaBorrador`** antes de mandar. Los errores de la API van a su campo cuando se puede, como en el diálogo de costos.
- **Al editar,** se manda solo lo que cambió.

### 3.6 P3 — Nuevo plan

Una pantalla, no un diálogo, porque lleva varias tareas.

**Datos:**
- **Máquina:** un buscador con las activas. Con un alcance de `PLANES_GESTIONAR` que no es `TODAS`, solo las de sus sectores.
- **Nombre** y **Descripción**.
- **Responsable:** con 1.1, se carga al elegir la máquina, con la opción "Sin responsable".
- **Avisar antes:** de 0 a 90 días, por omisión 7.

**Tareas:**
- una lista con "Agregar tarea", que abre 3.5;
- cada tarea con "Editar" y "Quitar".

**"Guardar plan":**
- **va con al menos una tarea.** Sin ninguna: "Agregá al menos una tarea.";
- un error con `indice` marca esa tarea en rojo, con el mensaje, y abre su diálogo;
- un `PLAN_DUPLICADO` va al campo Nombre;
- **al guardar,** aviso "Se creó el plan." y se va a P2.

**Cancelar** con datos cargados pregunta, como el diálogo de costos.

---

## 4. Mapa de pantallas (segundo commit)

En `docs/front/mapa-pantallas.md`:

- **Una sección 4.5, "Preventivos":** P1, P2 y P3, con lo que muestran, las acciones y los endpoints.
- **R1, R2, R3 y R5:** lo que cambia por la sección 5.
- **La navegación:** el ítem "Preventivos".

---

## 5. Preventivos en el resto del sistema (tercer commit)

### 5.1 R1 — Tablero

- **Una fila "Preventivos"** después de "Intervenciones", solo con `PLANES_GESTIONAR`.
- **Tres tarjetas:** Vencidas, Próximas y En curso.
  - Salen del `resumen` de `GET /api/planes/vencimientos?limit=1`, con la planta elegida en el tablero.
  - Cada una lleva a P1 con ese estado y esa planta.
- **Las cuentas en 0** se ven en gris, como las otras.

### 5.2 R2 — Intervenciones

- **Un filtro "Tipo":** Todas · Correctivas · Preventivas. Va en la dirección y usa el `tipo` que la lista ya acepta.
- **En la columna de la descripción,** las preventivas llevan la insignia "Preventivo".

### 5.3 R3 — Detalle de una intervención

**Si es `PREVENTIVO`:**
- **El encabezado** suma la insignia "Preventivo". Debajo va "Plan: <nombre>", con enlace a P2 si el usuario tiene `PLANES_GESTIONAR`; si no, como texto.
- **"Falla reportada"** pasa a "Trabajo programado". En la tarjeta de la derecha, "Reportada por" y "Reportada" pasan a "Generada por" y "Generada".
- **En el historial,** el primer evento dice "Intervención generada", no "Reporte registrado".

**El bloque de tareas.** Un componente nuevo, `BloqueTareasIntervencion`, va antes de "Repuestos", solo si la intervención tiene plan.

- **Título:** "Tareas del plan", y "2 de 3 hechas".
- **Cada tarea lleva:**
  - una casilla, habilitada si `puede_marcar`;
  - la acción, y el detalle desplegable;
  - "Programada para 06/11/2026";
  - lo sugerido: "Sugerido: Aceite ISO 68 × 2,5 litro · Proveedor X";
  - si está hecha, "Hecha por Nombre Apellido el 09/11/2026 14:30";
  - la observación. "Agregar observación" o "Editar observación" abre un diálogo chico.
- **Marcar** manda el `PATCH` y refresca el bloque.
- **Con la intervención `FINALIZADA`,** marcar o cambiar la observación abre un diálogo:
  - "Corregir una tarea de una intervención finalizada";
  - pide el motivo, de al menos 5 caracteres;
  - avisa: "La próxima fecha del plan se va a recalcular.".
- **En el historial,** `CORRECCION_TAREA` se ve como "Corrección de tareas". El detalle es el texto y el motivo, como "Corrección de costos".

**Finalizar y Resolver ahora.** En una preventiva con tareas sin marcar, los dos diálogos muestran arriba, en amarillo, `avisoTareasSinMarcar`. No impide finalizar.

**Refrescos:** después de marcar, de finalizar, de reabrir, de cancelar o de eliminar una preventiva, se refrescan también las consultas de planes, vencimientos y tablero.

### 5.4 R5 — Detalle de una máquina

Un componente nuevo, `BloquePlanesMaquina`, solo con `PLANES_GESTIONAR`. Va después de "Intervenciones de esta máquina".

- **Título:** "Planes preventivos", con el botón "Nuevo plan" (lleva a P3 con `?maquina=`).
- **Una fila por plan** (`GET /api/planes?maquina_id=&all=true`):
  - nombre con enlace;
  - responsable;
  - pendientes, como en P1;
  - próxima fecha;
  - "Inactivo" si corresponde.
- **Sin planes:** "Esta máquina no tiene planes preventivos."

**En "Intervenciones de esta máquina",** la columna "Falla" pasa a "Descripción", con la insignia "Preventivo" en las preventivas.

---

## 6. Pruebas de las pantallas (tercer commit)

No hay navegador en tu sesión, así que las pantallas las pruebo yo después.

**Lo que tiene que dejar el commit:**
1. **FE-67 en adelante en verde,** y las que ya existían, sin cambios.
2. **`lib/menu.test.ts`:** el ítem nuevo con `PLANES_GESTIONAR`, y sin él, no.
3. **En `lib/intervenciones.test.ts`:** el título del primer evento de una preventiva y el de `CORRECCION_TAREA`. Se agrega un caso; no se cambia ninguno.

---

## 7. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 6 están hechas, en tres commits.
2. `test:migration-018`, `test:preventivos` y `test:repuestos` en verde, en Neon.
3. `npm run test:front`, `npm run typecheck` y `npm run build:frontend` sin errores.
4. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. Los tres hashes.
2. Las salidas de 1.4: `lc_ctype` y `lower`.
3. La salida final de las cuatro suites.
4. Typecheck y build.
5. `wc -l` de los archivos tocados, con los de `DetalleMaquina.tsx` y `DetalleIntervencion.tsx` antes y después.
6. **Qué no pudiste probar sin navegador.** Lo pruebo yo.
7. Desvíos y dudas.
