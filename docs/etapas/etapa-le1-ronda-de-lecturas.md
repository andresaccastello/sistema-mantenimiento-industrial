# Etapa LE1 — Ronda de lecturas

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** la Etapa PC1 terminada y revisada.
> **Origen:** la charla del 16/11 sobre el preventivo por horómetro.

**El problema.** Un preventivo por uso depende de que alguien cargue las lecturas del medidor, y hoy nada lo empuja a hacerlo:
- las lecturas se cargan de a una, entrando a la ficha de cada máquina, y solo desde la computadora;
- si nadie carga, la tarea queda "Sin lectura" y el preventivo no sirve;
- la lectura se toma al lado de la máquina, pero en el celular no se puede cargar.

**Qué entra:**
- una pantalla para cargar todas las lecturas de una vez, en la computadora y en el celular;
- avisos en el momento, cuando una lectura deja una tarea próxima o vencida;
- avisos de lecturas atrasadas.

**Además,** las correcciones chicas que salieron de la revisión de la PC1 (sección 7).

**Qué no entra:** estimar fechas con el ritmo de uso (D-030, punto 4).

---

## 0. Reglas de trabajo

1. **Leé `CLAUDE.md` entero y seguí sus reglas.**
   - **Nunca abras, leas, muestres ni modifiques `.env`.**
   - Rama `feat/base-neon`. **No se agregan dependencias.**
2. **Tres commits,** y cada uno pasa `npm run typecheck` solo:

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 7 | `fix: detalles de la revisión de la PC1` |
   | 2 | 1, 2, 3 y 6 | `feat(api): ronda de lecturas y avisos de lecturas` |
   | 3 | 4 y 5 | `feat(front): ronda de lecturas, también en el celular` |

   El de las correcciones va primero, porque la pantalla nueva usa el `useEsCelular` de la 7.5.

3. **Pruebas:**
   - en Neon: `test:lecturas-ronda` (nueva), `test:migration-021` (nueva), `test:migration-015`, `test:medidores`, `test:vencimientos`, `test:preventivos` y `test:pedidos-compras`;
   - además: `test:front`, `typecheck` y `build:frontend`;
   - **no correr `test:todo`.**
4. **Pruebas existentes: se autoriza cambiar solo:**
   - M15-03, de 18 a 20 reglas, por el tipo de aviso nuevo (2.2);
   - FE-129 y FE-130, por `/lecturas` en el celular (4.4);
   - las FE que listan los tipos de aviso, solo para sumar `LECTURA_ATRASADA`;
   - en `test:vencimientos`, una prueba que compare el resultado entero de `procesarVencimientos` y falle solo por el campo nuevo `lecturas_atrasadas` (3.4);
   - PC-13 y PC-14, por la 7.1;
   - las FE de `lib/compras.ts` que esperan el texto viejo del resumen de la recepción, por la 7.2.

   Si otra falla, frenar y avisar.
5. **Ante cualquier duda, frenar y preguntar.** No inventar reglas que la etapa no dice.
6. **Los números:** la decisión es la **D-030**; la migración, la **021**; las FE nuevas, desde el siguiente número libre después de la PC1. Si alguno ya está usado, frenar y avisar.

Guardar este archivo como `docs/etapas/etapa-le1-ronda-de-lecturas.md`.

---

## 1. Decisión (segundo commit)

En `docs/decisiones.md`:

> **D-030 — Ronda de lecturas**
>
> **Estado:** Aceptada
>
> 1. **Las lecturas se cargan en ronda:** una sola pantalla con todos los medidores, para recorrer la planta y cargar todo de una vez.
> 2. **El celular suma la carga de lecturas.** Amplía la D-027: el operario reporta fallas **y carga lecturas**. La lectura se toma al lado de la máquina, y es el caso más claro de algo que conviene cargar caminando. Lo demás sigue siendo de escritorio.
> 3. **Avisos:**
>    - **en el momento:** si una lectura deja una tarea próxima o vencida, se avisa al guardarla, y si el plan genera solo, se genera. Es lo mismo que hace la revisión diaria, adelantado;
>    - **lecturas atrasadas:** cada medidor dice cada cuántos días se lee (7 por omisión). Si se pasa de ese plazo y el medidor tiene tareas activas, la revisión diaria avisa una vez.
> 4. **No se estiman fechas con el ritmo de uso.** Si el uso es parejo, alcanza con una tarea por fecha. Si varía, que es cuando el horómetro tiene sentido, una fecha estimada se equivoca y da una falsa tranquilidad. Las horas son horas y las fechas son fechas. Refuerza la D-028, punto 4.
>
> **Motivo:** sin lecturas, el preventivo por uso no funciona, y el problema práctico es cargarlas, no calcularlas.

**En `docs/alcance.md`:** se suma "Ronda de lecturas", hecha en LE1, y se anota que el celular también carga lecturas.

---

## 2. Base de datos (segundo commit)

### 2.1 Migración 021

`database/migrations/021_ronda_lecturas.sql`. Tiene que poder reaplicarse sin error.

| Tabla | Columna | Tipo | Para qué |
| :--- | :--- | :--- | :--- |
| `medidores` | `lectura_cada_dias` | `SMALLINT NULL DEFAULT 7`, `CHECK (lectura_cada_dias BETWEEN 1 AND 365)` | Cada cuántos días se lee. `NULL` = sin control de atraso. Los medidores que ya existen quedan con 7. |
| `medidores` | `atraso_avisado_en` | `TIMESTAMPTZ NULL` | Cuándo se avisó el atraso. Se limpia con cada lectura nueva, para avisar una sola vez por atraso. |

- **Sin tablas nuevas:** `TABLAS_CONTROL` no cambia.
- **Prueba de la migración:** `backend/tests/migration_021.test.ts`, con el script `test:migration-021`:
  - aplicar dos veces;
  - las columnas con sus tipos;
  - un medidor que ya existía queda con 7;
  - el `CHECK` rechaza 0 y 366, y acepta `NULL`.

### 2.2 El tipo de aviso nuevo, en la 015

**`LECTURA_ATRASADA`**, con el mismo criterio de la PV5 para `PREVENTIVO_VENCIMIENTO`. La 015 todavía es editable.
- **En `015_avisos_email.sql`:**
  - se suma a `ck_notificacion_reglas_tipo_evento`;
  - dos reglas nuevas, `('LECTURA_ATRASADA', 'EMAIL', 'NUNCA')` y `('LECTURA_ATRASADA', 'WHATSAPP', 'NUNCA')`. Quedan 20.
- **Si otra restricción de alguna migración lista los tipos de aviso,** se suma también ahí.
- **En `REGLAS_EVENTOS_NOTIFICACION`** (`backend/functions/intervenciones/notificaciones.ts`).
- **M15-03** pasa a esperar 20 reglas.

---

## 3. La API (segundo commit)

### 3.1 La lista de la ronda

`GET /api/medidores/ronda`, en `medidoresApp`, **antes de `/:id`**.
- **Permisos:** como los otros `GET` de medidores. Ver lecturas es de todas las máquinas (D-023).
- **Parámetros opcionales:** `planta_id`, `sector_id`, `maquina_id`, más `solo_atrasados=true`. Un id inválido da 422.
- **Entran:** los medidores activos de máquinas activas.

**Cada medidor:**

```json
{
  "id": 7, "nombre": "Horómetro", "unidad": "horas", "lectura_cada_dias": 7,
  "maquina": { "id": 3, "codigo": "COM-01", "nombre": "Compresor" },
  "sector": { "id": 2, "nombre": "Servicios" },
  "ultima": { "valor": 12340, "registrada_en": "2026-11-08T14:10:00Z" },
  "dias_sin_lectura": 8,
  "atrasado": true,
  "tareas": [
    { "tarea_id": 52, "accion": "Cambiar aceite", "plan": { "id": 9, "nombre": "Compresor" },
      "estado": "PROXIMA", "proximo_uso": 12500, "faltan_uso": 160 }
  ]
}
```

- **`dias_sin_lectura`:** `hoy_instalacion()` menos el día local de la última lectura. Si no tiene lecturas, desde el día local en que se creó el medidor.
- **`atrasado`:** `true` si se cumplen las tres cosas:
  - `lectura_cada_dias` no es `NULL`;
  - el medidor tiene al menos una tarea activa, de un plan activo;
  - `dias_sin_lectura` es **mayor** que `lectura_cada_dias`. Con "cada 7" y la última lectura el lunes, el lunes siguiente no está atrasado; el martes, sí.
- **`tareas`:** las tareas activas que usan el medidor, con el estado y el uso de `v_plan_tareas_estado`, y sin las `INACTIVA`.
- **Orden:** el nombre del sector, el código de la máquina y el nombre del medidor. Es el orden de una recorrida.

### 3.2 Guardar la ronda

`POST /api/medidores/ronda`, con `MAQUINAS_REGISTRAR_LECTURAS`.

```json
{ "lecturas": [ { "medidor_id": 7, "valor": 12395, "observacion": null } ] }
```

**Si el cuerpo está mal, 422 `DATOS_INVALIDOS` y no se guarda nada.** Está mal si:
- `lecturas` no es una lista, o tiene 0 o más de 200 elementos;
- el mismo `medidor_id` aparece dos veces;
- un `valor` no pasa `validarValorMedidor`;
- una `observacion` pasa de 200 caracteres.

**Cada lectura se guarda en su propia transacción,** con `bloquearMedidor` y `registrarLectura`, origen `MANUAL`, como el `POST /:id/lecturas` de hoy. **Una lectura que falla no frena a las demás:** en una ronda de 30 medidores, un error de tipeo no puede tirar las otras 29. Respeta el orden de bloqueos: la máquina antes que el medidor.

**`registrarLectura` limpia `atraso_avisado_en`** del medidor, en la misma transacción. Así funciona también para el `POST /:id/lecturas` de siempre.

**La respuesta, 200, con un resultado por lectura, en el orden en que llegaron:**

```json
{
  "resultados": [
    { "medidor_id": 7, "ok": true, "lectura_id": 501,
      "tareas": [ { "tarea_id": 52, "accion": "Cambiar aceite", "plan": { "id": 9, "nombre": "Compresor" },
                    "estado": "PROXIMA", "proximo_uso": 12500, "faltan_uso": 105 } ] },
    { "medidor_id": 8, "ok": false, "codigo": "LECTURA_MENOR", "error": "La lectura es menor que la última registrada" }
  ],
  "generadas": [ { "plan_id": 9, "intervencion_id": 85 } ],
  "avisos": 1
}
```

- **Los errores de cada lectura** usan los mismos códigos y mensajes que el `POST /:id/lecturas` de hoy. Un medidor que no existe da `MEDIDOR_NO_ENCONTRADO` en su resultado, no un 404 de todo el pedido.
- **`tareas`** se lee **después** del aviso inmediato (3.3), así ya muestra la intervención en curso si se generó una.

### 3.3 El aviso en el momento

**Después de guardar,** fuera de las transacciones de las lecturas, se procesan los planes afectados, **igual que en la revisión diaria:**
- **cuáles:** los planes activos, de máquinas activas, con alguna tarea activa que use un medidor que se leyó bien, y con alguna tarea `VENCIDA` o `PROXIMA`;
- **cómo:** cada plan con `procesarPlan`, de `preventivos/vencimientos.ts`, que se exporta. Cada uno en su transacción y con el usuario del sistema, como en `procesarVencimientos`;
- **los avisos no se repiten:** si la revisión diaria ya avisó ese estado en ese ciclo, el índice único de `avisos_vencimiento` lo frena. Al revés, igual;
- **si el plan genera solo, genera:** es lo mismo que haría la revisión diaria al día siguiente, adelantado;
- **si un plan falla, la lectura ya quedó guardada.** El error se registra en el log, no cambia la respuesta de esa lectura, y la revisión diaria lo retoma.

**El `POST /:id/lecturas` de siempre hace lo mismo** después de guardar. Su respuesta no cambia.

### 3.4 Lecturas atrasadas, en la revisión diaria

**En `procesarVencimientos`, después de recorrer los planes,** un paso nuevo, en una transacción:
1. **Bloquear,** en el orden de siempre (las máquinas `FOR SHARE` y después los medidores `FOR UPDATE`), los medidores **atrasados** (como en 3.1) que tienen `atraso_avisado_en` en `NULL`.
2. **Volver a controlar** después del bloqueo: si dos revisiones corren a la vez, la segunda no encuentra nada.
3. **Los destinatarios de cada medidor:** por cada plan activo con tareas activas que lo usan, los mismos que en un vencimiento (`destinatarios`: el responsable del plan o, si no tiene, quienes gestionan los planes del sector). Se juntan todos, sin repetir.
4. **Un aviso por destinatario,** con todos sus medidores atrasados juntos:
   - tipo `LECTURA_ATRASADA`, prioridad `NORMAL`;
   - título: "Lecturas atrasadas";
   - mensaje: una línea por medidor, por ejemplo "COM-01 · Horómetro: 8 días sin lectura (se lee cada 7)";
   - `maquina_id`: la máquina, si es un solo medidor; si son varios, `NULL`;
   - a la bandeja de salida con `encolarEnvios`, como los otros.
5. **Marcar `atraso_avisado_en = NOW()`** en esos medidores.

- **El resultado de `procesarVencimientos`** suma `lecturas_atrasadas`, la cantidad de medidores avisados.
- **Si este paso falla,** los planes ya están procesados, y el día se marca igual: la próxima revisión lo intenta de nuevo, porque los medidores siguen sin marcar.

### 3.5 Cada cuánto se lee

- **`POST /api/medidores`** acepta `lectura_cada_dias`: un entero de 1 a 365, o `null`. Sin él, 7.
- **`PATCH /api/medidores/:id`** también acepta `lectura_cada_dias`. Al cambiarlo, se limpia `atraso_avisado_en`.
- **Fuera de rango o un texto:** 422 `DATOS_INVALIDOS`.
- **Los `GET` de medidores** suman `lectura_cada_dias`, `dias_sin_lectura` y `atrasado`.

---

## 4. Pantallas (tercer commit)

### 4.1 La pantalla "Lecturas", en la computadora

Una pantalla nueva, `/lecturas`, en `pantallas/Lecturas.tsx`, con sus partes en `componentes/lecturas/`. Ningún archivo pasa de 500 líneas.

- **Arriba:**
  - los filtros de planta, sector y máquina;
  - el interruptor "Solo atrasados";
  - el texto "Cargá la lectura de cada medidor que recorras. Los que dejes vacíos no se guardan."
- **Una tabla, agrupada por máquina:**

  | Columna | Qué muestra |
  | :--- | :--- |
  | Medidor | El nombre y la unidad. |
  | Última lectura | El valor, y "hace 8 días" debajo. Con un `Badge` rojo "Atrasado" si corresponde. Sin lecturas: "Sin lecturas". |
  | Tareas | Una línea por tarea: "Cambiar aceite · faltan 160 h", con el `Badge` de su estado. Sin tareas: "Sin tareas que lo usen". |
  | Nueva lectura | Un campo numérico con la unidad a la derecha. |

- **Antes de mandar,** si un valor es menor que la última lectura, el campo lo marca: "Menor que la última (12.340 h)". El botón no se habilita hasta corregirlo.
- **Abajo, fijo:** el botón "Guardar 5 lecturas", con la cantidad de campos completos. Sin ninguno, deshabilitado.

### 4.2 Después de guardar

- **Cada fila guardada** muestra ✓ "Guardada", y debajo lo que cambió:
  - "Cambiar aceite pasó a Próxima: faltan 105 h";
  - "Cambiar aceite está Vencida: se pasó por 20 h";
  - "Se generó la intervención N.º 85", con enlace.
- **Una fila con error** conserva el valor, muestra el mensaje de la API y queda para corregir.
- **Un aviso arriba:** "Se guardaron 4 lecturas. 1 no se pudo guardar." Si alguna tarea cambió de estado, también: "2 tareas pasaron a próxima."
- **Salir con valores sin guardar** pide confirmación: "Tenés 3 lecturas sin guardar. ¿Salir igual?"

### 4.3 En el celular

La misma pantalla, como tarjetas, una por medidor:
- **arriba:** la máquina (código y nombre) y el medidor;
- **debajo:**
  - "Última: 12.340 h · hace 8 días", con "Atrasado" si corresponde;
  - la tarea más cercana, en una línea: "Cambiar aceite · faltan 160 h";
- **el campo,** grande, con `inputMode="decimal"`, para que salga el teclado numérico;
- **los filtros:** solo el sector y "Solo atrasados";
- **el botón "Guardar (5)"**, fijo abajo;
- **los resultados,** como en 4.2, dentro de cada tarjeta.

### 4.4 El menú y el celular

- **El ítem "Lecturas"** aparece en el menú de quien tiene `MAQUINAS_REGISTRAR_LECTURAS`, en la computadora y en el celular. En la computadora va después de "Preventivos"; en el celular, después de "Mis reportes".
- **Quien solo tiene `PLANES_GESTIONAR`** puede abrir la pantalla para mirar, pero sin los campos ni el botón.
- **`permitidaEnCelular('/lecturas')`** es `true` con `MAQUINAS_REGISTRAR_LECTURAS`.
- **El destino al entrar en el celular no cambia:** el operario sigue entrando a "Mis reportes".
- **FE-129 y FE-130** se ajustan a esto.

### 4.5 Lo demás

- **En la ficha de la máquina,** en Medidores:
  - el formulario suma "Leer cada", con "días" a la derecha, 7 por omisión, y la ayuda "Vacío: sin aviso de atraso";
  - la lista muestra "Atrasado" si corresponde;
  - un enlace "Cargar en ronda" lleva a `/lecturas?maquina_id=X`.
- **El aviso `LECTURA_ATRASADA`:**
  - en `lib/avisos.ts`, con el nombre "Lecturas atrasadas" y el texto de destinatarios;
  - en la configuración de avisos, como un tipo más;
  - al tocarlo en la campana, lleva a `/lecturas?solo_atrasados=true`.
- **Los filtros de `/lecturas`** van en la URL, para poder compartir el enlace y volver con Atrás.

### 4.6 La lógica, en `lib/lecturas.ts`

Con pruebas FE:
- qué lecturas se mandan: las de campos completos, sin las que tienen un valor menor que la última;
- el texto de cada consecuencia de 4.2, para cada estado;
- el resumen de arriba;
- `diasSinLectura` en texto: "hoy", "ayer", "hace 8 días".

---

## 5. Tipos del front (tercer commit)

En `frontend/src/api/tipos.ts`, los tipos de la ronda, de su respuesta y de `LECTURA_ATRASADA`. La consulta de la ronda se invalida al guardar una lectura, en la ronda o en la ficha, y al cambiar un medidor.

---

## 6. Pruebas de la API (segundo commit)

En `backend/tests/lecturas_ronda.test.ts`, con el script `test:lecturas-ronda`. Siguen el patrón de C2 (`clienteSano`) y limpian lo que crean. Las fechas, a partir de `hoy_instalacion()`.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| LR-01 | Permisos | Sin `MAQUINAS_REGISTRAR_LECTURAS`, el `POST` da 403. Un operario de fábrica, 200. Con solo `PLANES_GESTIONAR`, el `GET` da 200. |
| LR-02 | Cuerpo inválido: vacío, 201 lecturas, un medidor repetido, un valor inválido | 422, y no se guarda ninguna. |
| LR-03 | Tres lecturas, una menor que la última | Se guardan dos. La otra da `LECTURA_MENOR` en su resultado. El orden de los resultados es el del pedido. |
| LR-04 | Un medidor inactivo y uno que no existe | El error, en su resultado. Las demás se guardan. |
| LR-05 | Una lectura deja una tarea próxima | En `tareas`, `PROXIMA` con `faltan_uso`. Se avisa al momento al responsable del plan. Otra lectura en el mismo ciclo no repite el aviso, y la revisión diaria tampoco. |
| LR-06 | Plan con generación automática; la lectura vence una tarea | Se genera la intervención, y viene en `generadas`. Otra lectura no genera otra. |
| LR-07 | El `POST /:id/lecturas` de siempre | También avisa, y su respuesta no cambia. |
| LR-08 | Si el aviso falla (error forzado en `procesarPlan`) | La lectura queda guardada y su resultado es `ok`. |
| LR-09 | Atraso | Última lectura hace 8 días, "cada 7", con una tarea activa: `atrasado` en el `GET`, y la revisión diaria avisa `LECTURA_ATRASADA`. Una segunda revisión no repite. Una lectura nueva limpia la marca. No avisan: un medidor sin tareas activas, uno con `lectura_cada_dias` en `NULL`, ni uno con exactamente 7 días. |
| LR-10 | Agrupado | Un destinatario con dos medidores atrasados recibe **un** aviso con las dos líneas. |
| LR-11 | Dos revisiones diarias a la vez | Un solo aviso por destinatario y medidor. |
| LR-12 | El `GET` de la ronda | Orden de recorrida, filtros, `solo_atrasados`. Sin medidores inactivos ni de máquinas inactivas. Sin tareas `INACTIVA`. |
| LR-13 | `lectura_cada_dias` | Al crear, sin el campo, queda 7. 0, 366 y `"x"` dan 422; `null` se acepta. Al cambiarlo, se limpia `atraso_avisado_en`. |
| LR-14 | Concurrencia | Dos rondas a la vez sobre el mismo medidor, con valores crecientes: ningún 500, y las lecturas que quedan nunca bajan. |

---

## 7. Correcciones de la revisión de la PC1 (primer commit)

Son chicas y no cambian ninguna regla. Salieron de la revisión del 16/11.

### 7.1 PC-14 depende de la velocidad

**Qué pasa:** la ventana "antes" de PC-14 termina 1 segundo antes del `desde` de PC-13, y supone que las recepciones de PC-01 y PC-02 fueron más de 1 segundo antes. En Neon pasa, porque es lento. En una base rápida falla: el revisor lo reprodujo, y con una pausa de 1,5 s pasa. Además, PC-13 mezcla dos relojes: `desde` sale de `NOW()` de la base, y `recibido_en`, del reloj de la API.

**La corrección, solo en la prueba:** ninguna ventana de PC-13 ni de PC-14 puede depender de la velocidad ni de la diferencia entre el reloj de la PC y el de la base. Por ejemplo:
- recibir los pedidos de PC-01 y PC-02 con `recibido_en` explícito, una hora antes;
- o armar la ventana "antes" a partir de los `recibido_en` reales de esos pedidos, leídos de la base.

**Para comprobarlo,** correr `test:pedidos-compras` dos veces seguidas: las dos en verde.

### 7.2 El texto del recibir

**Qué pasa:** con stock previo, "Entran 5 al stock y se usan 2 en esta intervención. Quedan 3 en stock" confunde: en el stock quedan 5, porque ya había 2.

**La corrección:** "Entran 5 al stock y se usan 2 en esta intervención. **Quedan 3 más en stock (total: 5).**" El total es el stock disponible antes más lo que queda. Si no se usa nada, "Entran 5 al stock (total: 7)."

### 7.3 Aviso de React en la consola

Al abrir el diálogo de recibir, la consola muestra "…a style property during rerender… when a conflicting property is set…": una propiedad de estilo corta mezclada con una larga (por ejemplo, `border` y `borderColor`) en el mismo elemento. **Encontrarla y sacarla.** En el informe va dónde estaba.

### 7.4 El comprobante en la tabla de compras

En "Detalle" de la pestaña Compras, el comprobante se corta en dos líneas ("A-0001-" y "00012345"). **Esa columna va sin corte de línea.**

### 7.5 Un solo `useEsCelular`

**Qué pasa:** el arreglo del commit `99d407f` lee el ancho del celular en el primer render, pero solo en `rutas.tsx` y en `MisReportes.tsx`. `Layout`, `Reportes` y `ReportarFalla` siguen con `useMediaQuery(CORTE_CELULAR)` a secas: en el celular, el primer render es de computadora. Por ejemplo, Reportes pide los datos de las pestañas y después cambia al resumen.

**La corrección:**
- un hook `useEsCelular()`, en `frontend/src/lib/celular.ts` o al lado, con `useMediaQuery(CORTE_CELULAR, undefined, { getInitialValueInEffect: false })`;
- lo usan **todos** los lugares que hoy leen `CORTE_CELULAR`, incluidos `rutas.tsx` y `MisReportes.tsx`, y la pantalla nueva de lecturas;
- **al terminar,** buscar `useMediaQuery(CORTE_CELULAR` en `frontend/src`: solo puede quedar dentro del hook.

---

## 8. Cierre e informe

**Criterios de cierre:**
1. Las secciones 1 a 7 están hechas, en tres commits que compilan solos.
2. Las pruebas de la regla 3 en verde, en Neon.
3. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:
1. Los tres hashes.
2. La salida final de cada suite de la regla 3, con `test:pedidos-compras` corrida dos veces seguidas.
3. Typecheck y build.
4. Las líneas de los archivos nuevos o tocados del front.
5. Dónde estaba el aviso de la 7.3, y la búsqueda de la 7.5.
6. Desvíos y dudas.

**El recorrido en pantalla lo hace el revisor,** en la computadora y en el celular.
