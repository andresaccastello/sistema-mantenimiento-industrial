# Etapa F5 — Reportes e indicadores

> **Estado:** requerimiento para implementar. **Se hace de noche, sin nadie para responder** (sección 0, regla 2).
> **Requisito previo:** commit `550a97e` (Etapa N1.1).
> **Base:**
>
> - `docs/front/mapa-pantallas.md`, pantalla D1: inactividad por máquina y tiempos agrupados;
> - la API de reportes que ya existe: `GET /api/reportes/inactividad` y `GET /api/reportes/tiempos`.
>
> **Para qué:** que el sistema muestre cómo está el mantenimiento con los indicadores de siempre en el área (disponibilidad, fallas, MTTR, MTBF y tiempo de respuesta), y no solo las listas. Es lo que se va a mostrar en la defensa.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. **No se agregan dependencias:** las barras se hacen con `Progress` de Mantine.
2. **Trabajo sin supervisión.**
   - **Ante una duda que no pone en riesgo datos ni pruebas ajenas:** elegir la opción más simple que respete este documento, anotarla como desvío en el informe y seguir.
   - **Frenar y dejarlo anotado, sin seguir con esa parte,** solo si para avanzar hubiera que:
     - cambiar el esquema;
     - modificar una prueba existente;
     - tocar algo fuera de lo pedido.
3. **Dos commits:**
   1. secciones 1 y 2: `feat(api): indicadores y filtros de reportes`;
   2. secciones 3 a 6: `feat(front): pantalla de reportes`.
4. **Pruebas:**
   - durante el trabajo, solo `test:reportes` (nuevo), `test:tiempos` y `test:front`;
   - al terminar, la corrida de la noche (sección 8);
   - rige la regla de la F2.2: una prueba no borra ni modifica datos que no creó.
5. Lo que está en `lib/` sigue siendo lógica pura. Ninguna pantalla pasa de 500 líneas; las partes van en `componentes/reportes/`.

Guardar este archivo como `docs/etapas/etapa-f5-reportes.md`.

---

## 1. API: indicadores (primer commit)

### 1.1 `GET /api/reportes/indicadores?desde=&hasta=&planta_id=&sector_id=`

- **Permiso:** `REPORTES_CONSULTAR`, con el mismo alcance que `/inactividad`. Si el alcance no es `TODAS`, solo cuentan las máquinas de los sectores del usuario.
- **Período:**
  - con `validarIntervaloReporte`, igual que los otros reportes;
  - por omisión, los últimos 30 días;
  - como máximo, 366 días.
- **Selección:** las máquinas **activas** visibles, filtradas por `planta_id`, por `sector_id` o por los dos (sección 1.3).

| Campo | Cálculo |
| :--- | :--- |
| `desde`, `hasta` | El período usado, en ISO. |
| `maquinas` | Cantidad de máquinas de la selección. |
| `minutos_periodo` | Minutos del período, redondeados, por `maquinas`. |
| `inactividad_minutos` | Suma de `total_minutos` de `fn_inactividad_maquina` de cada máquina en el período. |
| `inactividad_correctiva_minutos` | Suma de `correctivo_minutos`. |
| `inactividad_preventiva_minutos` | Suma de `preventivo_minutos`. |
| `disponibilidad` | `1 − inactividad_minutos / minutos_periodo`, de 0 a 1, redondeada a 4 decimales. `null` si `minutos_periodo` es 0. |
| `fallas` | Intervenciones `CORRECTIVO` de la selección con `fecha_creacion` dentro del período, sin eliminar y que **no** están `CANCELADA`. |
| `correctivas_finalizadas` | Intervenciones `CORRECTIVO` `FINALIZADA` con `fecha_finalizacion` dentro del período. |
| `preventivas_finalizadas` | Lo mismo, con `PREVENTIVO`. |
| `mttr_minutos` | Promedio redondeado de `duracion_neta_minutos` (`v_intervencion_tiempos`) de las correctivas finalizadas. `null` si no hay. |
| `respuesta_promedio_minutos` | Promedio redondeado de `espera_minutos` de esas mismas. `null` si no hay. |
| `mtbf_horas` | `(minutos_periodo − inactividad_correctiva_minutos) / fallas / 60`, redondeado a 1 decimal. `null` si `fallas` es 0. |

**Sin máquinas en la selección** (alcance vacío, sector ajeno, planta sin máquinas): 200 con `maquinas: 0`, los minutos y conteos en 0, y los promedios y `disponibilidad` en `null`.

**Errores:**

- `planta_id` o `sector_id` que no son enteros positivos: 422 `DATOS_INVALIDOS`, como hoy en `/inactividad`;
- un período inválido: lo que ya devuelve `validarIntervaloReporte`.

### 1.2 Definiciones

Agregar a `docs/decisiones.md`:

> ## D-017 — Indicadores de mantenimiento
>
> **Estado:** Aceptada
>
> Sobre las máquinas activas de la selección y el período elegido:
>
> - **Disponibilidad:** tiempo sin detenciones ÷ tiempo del período. El tiempo fuera de servicio no cuenta como detención (D-07).
> - **Fallas:** intervenciones correctivas reportadas en el período, sin contar las canceladas.
> - **MTTR** (tiempo medio de reparación): duración neta promedio de las correctivas finalizadas en el período, sin las pausas.
> - **Tiempo de respuesta:** espera promedio de esas mismas correctivas, desde el reporte hasta el inicio del trabajo.
> - **MTBF** (tiempo medio entre fallas): tiempo del período sin detenciones correctivas ÷ cantidad de fallas.
>
> **Motivo:** son los indicadores usuales del área. Se definen acá para que el número del sistema y el de la tesis sean el mismo.

### 1.3 Filtros nuevos en los reportes que ya existen

| Ruta | Se agrega |
| :--- | :--- |
| `/inactividad` | `planta_id` |
| `/tiempos` | `planta_id` y `sector_id` |

- **Misma semántica que el `sector_id` de hoy en `/inactividad`:**
  - un sector fuera del alcance devuelve la lista vacía;
  - un valor inválido da 422 `DATOS_INVALIDOS`.
- **`planta_id`:** las máquinas cuyo sector pertenece a esa planta.
- **Sin estos parámetros,** las respuestas quedan exactamente como hoy.

---

## 2. Pruebas del backend: `backend/tests/reportes.test.ts`

Script `test:reportes`. Crea su propia planta, sus sectores, máquinas, usuarios e intervenciones.

**Fechas fijas en el pasado.** Las fechas, los períodos de detención y los cambios de estado se cargan por SQL, con un período explícito de 10 días: `desde` = T0 y `hasta` = T0 + 10 días. T0 queda varios meses antes de hoy, para que nada de otras pruebas caiga adentro. Usar el mismo estilo que las pruebas de tiempos (T-xx).

**Escenario base** (dos máquinas del sector S1 de la planta P1):

| Máquina | Intervenciones |
| :--- | :--- |
| A | **C1:** correctiva finalizada, con una detención de 120 minutos.<br>**C2:** correctiva abierta, sin detención.<br>**C3:** correctiva cancelada. |
| B | **P1:** preventiva finalizada, con una detención de 60 minutos. |

Una tercera máquina, C, en otra planta, tiene una correctiva que **no** tiene que contar cuando se filtra por P1.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| RP-01 | Permiso | Sin `REPORTES_CONSULTAR`: 403 en `/indicadores`. |
| RP-02 | Escenario base, con `planta_id` = P1 | • `maquinas` 2 y `minutos_periodo` 28800;<br>• `inactividad_minutos` 180, correctiva 120 y preventiva 60;<br>• `disponibilidad` igual a `round(1 − 180/28800, 4)`;<br>• `fallas` 2, porque C3 no cuenta;<br>• `correctivas_finalizadas` 1 y `preventivas_finalizadas` 1;<br>• `mttr_minutos` y `respuesta_promedio_minutos` iguales a los de C1 en `v_intervencion_tiempos`;<br>• `mtbf_horas` = `round((28800 − 120) / 2 / 60, 1)`. |
| RP-03 | Filtros | • `sector_id` de S1: lo mismo que RP-02.<br>• Sin filtros, con un usuario de alcance `SECTORES` cuyo único sector es S1: lo mismo.<br>• `planta_id` de otra planta sin máquinas: `maquinas` 0, con los promedios y `disponibilidad` en `null`.<br>• `planta_id=abc`: 422. |
| RP-04 | Alcance | Un usuario con `REPORTES_CONSULTAR` en `SECTORES`, sin S1, pide `sector_id` de S1: `maquinas` 0. |
| RP-05 | Sin fallas | Un período sin intervenciones, en las mismas máquinas: `fallas` 0, `mtbf_horas` y `mttr_minutos` en `null`, y `disponibilidad` 1. |
| RP-06 | Filtros en los otros reportes | • `/inactividad?planta_id=P1`: solo A y B.<br>• `/tiempos?agrupar=tipo&planta_id=P1`: no cuenta la de C.<br>• `/tiempos?agrupar=tipo&sector_id=S1`: igual.<br>• `planta_id=abc` y `sector_id=abc`: 422. |
| RP-07 | Período | `desde` igual o posterior a `hasta`: 422. Más de 366 días: 422. |

---

## 3. Lógica pura: `lib/reportes.ts` (segundo commit)

| Función | Qué hace |
| :--- | :--- |
| `leerFiltrosReportes(params)` / `escribirFiltrosReportes(f)` | **Claves:**<br>• `periodo`: `7d`, `30d` (por omisión), `90d`, `mes` o `mes-anterior`;<br>• `desde` y `hasta` (`AAAA-MM-DD`): para un período personalizado;<br>• `planta`, `sector` y `vista` (`indicadores` por omisión, `inactividad` o `tiempos`);<br>• `agrupar`: `ejecucion` (por omisión), `tipo` o `sector`.<br>**Valores inválidos:** se reemplazan por los de omisión. Un personalizado con `desde` posterior a `hasta`, o al que le falta uno de los dos, vuelve a `30d`. |
| `rangoDePeriodo(filtros, ahora)` | Devuelve `{ desde, hasta }` en ISO, con la hora local del navegador:<br>• **`Nd`:** desde `ahora` menos N días hasta `ahora`;<br>• **`mes`:** desde el día 1 a las 00:00 hasta `ahora`;<br>• **`mes-anterior`:** el mes calendario completo;<br>• **personalizado:** desde las 00:00 del día `desde` hasta las 00:00 del día siguiente a `hasta`. |
| `formatPorcentaje(fraccion)` | `0.99374` → "99,4 %"; `1` → "100 %"; `null` → "—". |
| `formatHoras(horas)` | `239` → "239 h"; `12.5` → "12,5 h"; `null` → "—". |
| `barrasInactividad(filas)` | Por fila, `{ correctivo, preventivo }` en porcentaje del ancho. La fila con más inactividad ocupa el 100 %. Si todas están en 0, todo da 0. |
| `aCsv(columnas, filas)` | Arma un CSV para Excel en castellano:<br>• separador ";";<br>• comillas dobles cuando hace falta, duplicando las internas;<br>• decimales con coma;<br>• saltos de línea `\r\n`;<br>• `﻿` al principio, para que Excel lea bien las tildes. |
| `nombreArchivoReporte(vista, desde, hasta)` | Por ejemplo, `reporte-inactividad-2026-10-06-a-2026-11-05.csv`. |

---

## 4. Pantalla D1 — Reportes (`/reportes`)

Reemplaza a "En construcción". La ruta pide `REPORTES_CONSULTAR`, como hoy.

### 4.1 Filtros

Arriba, en `SimpleGrid`, y todos en la dirección:

- **Período:** `Select` con "Últimos 7 días", "Últimos 30 días", "Últimos 90 días", "Este mes", "Mes anterior" y "Personalizado". Con "Personalizado" aparece un `DatePickerInput` de rango.
- **Planta.**
- **Sector:** solo los de la planta elegida, como en R4.

Debajo, en gris: "Del {fecha} al {fecha}." Así se ve el período exacto.

### 4.2 Pestañas: Indicadores · Inactividad · Tiempos

La pestaña también va en la dirección (`vista`). Cada pestaña tiene un botón "Descargar CSV".

**Indicadores:**

- **Seis tarjetas** (tres columnas en escritorio, una en celular). Cada una con el valor grande, el nombre y una línea en gris con la definición de D-017, en pocas palabras:

  | Tarjeta | Valor |
  | :--- | :--- |
  | Disponibilidad | `formatPorcentaje` |
  | Fallas reportadas | el número |
  | MTTR | `formatDuracion` |
  | MTBF | `formatHoras` |
  | Tiempo de respuesta | `formatDuracion` |
  | Preventivas finalizadas | el número |

- **Un valor `null`:** "—", y debajo "Sin datos en el período".
- **Al pie:** "Sobre {n} máquina(s) activa(s)."
- **CSV:** una fila por indicador, con nombre y valor.

**Inactividad:**

- **Un renglón por máquina:**
  - nombre, código y sector, con enlace a R5;
  - total con `formatDuracion`;
  - una barra `Progress` con dos secciones, correctivo y preventivo, con los anchos de `barrasInactividad`.
- **Leyenda de colores** arriba.
- **Cantidad:** se muestran las primeras 15; "Ver todas ({n})" muestra el resto.
- **Máquinas sin detenciones:** no se muestran, salvo con el `Switch` "Incluir máquinas sin detenciones".
- **CSV:** columnas máquina, código, sector, total, correctivo y preventivo, en minutos, con todas las máquinas.

**Tiempos:**

- **Agrupación:** `SegmentedControl` con "Ejecución", "Tipo" y "Sector".
- **Tabla:**

  | Columna | Contenido |
  | :--- | :--- |
  | Grupo | Para la ejecución: Interna, Externa o "Sin definir". Para el tipo y el sector: su nombre. |
  | Cantidad | El número. |
  | Respuesta promedio | `formatDuracion` |
  | Duración neta promedio | `formatDuracion` |
  | Duración bruta promedio | `formatDuracion` |
  | Duración neta total | `formatDuracion` |

- **Línea en gris:** "La duración neta descuenta las pausas; la bruta va del inicio al fin del trabajo. Cuentan las intervenciones finalizadas en el período."
- **CSV:** las mismas columnas, en minutos.

**Sin datos:** "No hay datos para este período y estos filtros."

---

## 5. Pruebas del frontend

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| FE-41 | `leerFiltrosReportes` / `escribirFiltrosReportes` | **Valores de omisión** con la dirección vacía.<br>**Inválidos:**<br>• `periodo=ROTO` y `vista=otra` vuelven a su valor de omisión;<br>• un personalizado con `desde` posterior a `hasta` vuelve a `30d`;<br>• uno al que le falta `desde` también.<br>**Ida y vuelta** con todos los campos: lo mismo. |
| FE-42 | `rangoDePeriodo` | Con un `ahora` fijo (15 de marzo, 10:30): `7d`, `mes` (1 de marzo, 00:00), `mes-anterior` (todo febrero, también en un año bisiesto) y un personalizado (del 1 al 10 de marzo: hasta el 11, 00:00). |
| FE-43 | `formatPorcentaje` y `formatHoras` | Los ejemplos de la sección 3, incluido `null`. |
| FE-44 | `aCsv` y `nombreArchivoReporte` | • Empieza con el BOM.<br>• Separa con ";" y termina las filas con `\r\n`.<br>• Un texto con ";" va entre comillas; uno con comillas las duplica; uno con salto de línea va entre comillas.<br>• 12.5 sale "12,5".<br>• El nombre del archivo con las fechas. |
| FE-45 | `barrasInactividad` | La máxima suma 100. Otra con la mitad del total suma 50, repartida según correctivo y preventivo. Todas en 0: todo 0. |

---

## 6. Documentación

1. **`docs/decisiones.md`:** D-017 (sección 1.2).
2. **`docs/front/mapa-pantallas.md`:** D1 con las tres pestañas, los filtros, el CSV y `GET /reportes/indicadores`.

---

## 7. Fuera de alcance

- Gráficos de evolución en el tiempo (tendencias por semana o por mes).
- Exportar a PDF.
- Quitar la interfaz provisional (`dev-ui`): va en la etapa de limpieza técnica.
- Desplegar.

---

## 8. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 6 están hechas, en dos commits.
2. `test:reportes`, `test:tiempos` y `test:front` en verde. `npm run typecheck` y `npm run build:frontend` sin errores.
3. Push de los dos commits en `feat/base-neon`.
4. **Al final, la corrida de la noche:**
   - `npm run test:todo -- noche-AAAA-MM-DD`, en Neon, una sola vez;
   - sin cambiar nada después;
   - si algo falla o se corta, **no se arregla ni se vuelve a correr**: solo se informa.

**Informe:**

1. Los dos hashes y el commit que probó la corrida de la noche (`git log -1 --oneline`).
2. La salida final de `test:reportes`, `test:tiempos` y `test:front`.
3. Typecheck y build, con el tamaño del JS.
4. El tamaño en líneas de la pantalla nueva.
5. **Corrida de la noche:**
   - la línea `Total`, la de `Datos que quedaron` y la del código de salida;
   - las líneas `Con problemas` y `CORTADO`, si hay;
   - por cada prueba fallida: el archivo, el nombre y las primeras líneas del error;
   - cuánto tardó;
   - la ruta del registro.
6. Desvíos, incluidas las decisiones tomadas por la regla 2 de la sección 0.
7. Lo que quedó frenado, si algo quedó.
