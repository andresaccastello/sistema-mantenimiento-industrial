# Etapa HE1 — Horómetro estimado

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `3880b5f` (D1).
> **Origen:**
> - la revisión con el profesor del 18/11: el preventivo por uso tiene que dar una idea de cuándo va a tocar;
> - lo que acordamos con Andrés el 18/11.

**La idea en una línea:** el usuario declara cuánto se usa cada medidor, el sistema estima la fecha en que una tarea por uso va a tocar, y con las lecturas reales se corrige solo. **La tarea sigue venciendo por la lectura real:** la fecha estimada informa y avisa, pero no cambia ningún estado ni genera nada.

**Qué entra:**
1. El uso declarado del medidor: un valor por día, por semana o por mes.
2. El ritmo de uso: el declarado o, con lecturas suficientes, el real. También la comparación entre los dos.
3. La fecha estimada de cada tarea por uso, en el plan, en la máquina y en el calendario, siempre marcada como estimada.
4. Un aviso nuevo para cargar una lectura: "por el ritmo, ya debería estar cerca".

**Qué no entra:**
- Proyectar las siguientes por uso en el calendario: se estima solo la próxima de cada tarea.
- Mostrar el valor estimado al lado del campo donde se carga la lectura. Es a propósito: invita a copiarlo sin mirar el horómetro.
- Los avisos críticos y la PWA, que son etapas aparte.

---

## 0. Reglas de trabajo

1. **Leé `CLAUDE.md` entero y seguí sus reglas.**
   - **Nunca abras, leas, muestres ni modifiques `.env`.**
   - Rama `feat/base-neon`. **No se agregan dependencias.**
2. **Tres commits.** Cada uno tiene que pasar `npm run typecheck` solo:

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1, 2, 3 y 7 (la decisión, las pruebas M23 y de EU-01 a EU-10) | `feat(api): uso declarado, ritmo y fecha estimada` |
   | 2 | 4, 5 y el resto de la 7 | `feat(api): aviso por estimación y calendario estimado` |
   | 3 | 6 | `feat(front): horómetro estimado` |

3. **Pruebas:**
   - **en Neon:**
     - `test:migration-023` y `test:estimacion-uso`, las dos nuevas;
     - `test:medidores`, `test:lecturas-ronda`, `test:vencimientos`, `test:calendario`, `test:preventivos` y `test:reportes-preventivos`;
   - **además:** `test:front`, `typecheck` y `build:frontend`;
   - **no correr `test:todo`.**
4. **Pruebas existentes: se autoriza cambiar solo** las que comparan objetos enteros, y solo para sumar los campos nuevos:
   - del medidor: `uso_estimado`, `ritmo`, `valor_estimado_hoy`, `atraso_por_dias` y `atraso_por_uso`;
   - de `uso`: `estimacion`;
   - el tipo `ESTIMADA` en los eventos del calendario.

   **Lo que ya se esperaba no cambia.** Si una prueba falla por otra cosa, frenar y avisar.
5. **Ante cualquier duda, frenar y preguntar.**
6. **Los números:**
   - la decisión es la **D-032**;
   - la migración, la **023**;
   - las FE nuevas, desde la **FE-161**.

   Si alguno ya está usado, frenar y avisar.

Guardar este archivo como `docs/etapas/etapa-he1-horometro-estimado.md`.

---

## 1. Migración 023 (primer commit)

Va en `database/migrations/023_uso_estimado.sql` y tiene que poder reaplicarse sin error.

**Columnas nuevas en `medidores`:**
- `uso_estimado_valor NUMERIC(14,2) NULL`, con `CHECK (> 0)`;
- `uso_estimado_periodo VARCHAR(6) NULL`, con `CHECK IN ('DIA', 'SEMANA', 'MES')`;
- `CHECK`: las dos nulas o las dos con valor;
- `estimacion_avisada_en TIMESTAMPTZ NULL`, para el aviso de la sección 4.

**Lo único que se guarda es lo que declara el usuario.** El ritmo y las fechas se calculan siempre, como en la D-021 y la D-023. Se calculan en dos vistas nuevas, que son el único lugar donde se hace ese cálculo.

### 1.1 `v_medidores_ritmo`: una fila por medidor

**El ritmo declarado, por día** (`ritmo_declarado`): el valor dividido 1, 7 o 30, según el período. El mes cuenta como 30 días.

**El ritmo según las lecturas** (`ritmo_lecturas`):
1. **Las lecturas que se usan:** las vigentes (no anuladas) de los **últimos 60 días**, según `registrada_en` contra `now()`. Si en ese período hay menos de 3, se usan **las 3 últimas vigentes**, sean de cuando sean. Cuentan todas las lecturas: las manuales, las del alta y las que se cargan al hacer una tarea.
2. **Hace falta un mínimo** de 3 lecturas, con al menos 7 días entre la primera y la última. Si no se llega, `ritmo_lecturas` queda nulo. Tres lecturas el mismo día darían un ritmo sin sentido.
3. **La cuenta:** la diferencia de valor entre la última y la primera, por fecha y hora, dividida por los días que pasaron entre las dos. Los días se cuentan con decimales: `EXTRACT(EPOCH FROM ...) / 86400`. Se cuentan días de calendario, así que los fines de semana parados ya entran en el promedio.

**Las columnas que sale de la vista:**

| Columna | Qué tiene |
| :--- | :--- |
| `ritmo_declarado` | El ritmo declarado, por día. |
| `ritmo_lecturas` | El ritmo según las lecturas, por día. |
| `lecturas_usadas` | Cuántas lecturas entraron en la cuenta. |
| `lecturas_desde` | La primera lectura que se usó. |
| `lecturas_hasta` | La última lectura que se usó. |
| `ritmo` | El de las lecturas si existe; si no, el declarado; si no hay ninguno, nulo. |
| `fuente` | `'LECTURAS'`, `'DECLARADO'` o nulo. |
| `desvio_pct` | Solo con los dos ritmos: `round((ritmo_lecturas − ritmo_declarado) / ritmo_declarado × 100)`. |

**Si las lecturas dan ritmo 0** (la máquina estuvo parada), la fuente es `'LECTURAS'` con ritmo 0. **No se vuelve al declarado:** el dato real dice que no se usó.

### 1.2 `v_plan_tareas_estimacion`: una fila por tarea con medidor

Se arma sobre `v_plan_tareas_estado` y `v_medidores_ritmo`. **No se toca `v_plan_tareas_estado`.**

- **Fecha base:** la fecha local, en la zona de la instalación, de `lectura_actual_en`.
- **`fecha_estimada`:** la fecha base más `ceil((proximo_uso − lectura_actual) / ritmo)` días.
- **`fecha_aviso_estimada`:** igual, pero con `proximo_uso − uso_anticipacion`, y solo si `estado_uso = 'AL_DIA'`.
- **`valor_estimado_hoy`:** `lectura_actual + ritmo × (hoy − fecha base)`.

**Las dos fechas quedan nulas** en estos casos:
- sin ritmo, o con ritmo 0;
- sin lectura (`SIN_LECTURA`);
- con `estado_uso = 'VENCIDA'`: ya venció de verdad y no hay nada que estimar;
- con la tarea `EN_CURSO` o `INACTIVA`.

**`estimada_pasada`:** `fecha_estimada < hoy`. Quiere decir que, según el ritmo, ya tendría que haber vencido, pero ninguna lectura lo confirma.

**Ejemplo, con los datos de la demo.** COM-01 tiene la última lectura en 100 h. La tarea toca a las 200 h y avisa 30 h antes. Se declaran 40 h por semana:
- el ritmo es 5,714 h/día;
- la fecha estimada es la fecha de la lectura más ceil(100 / 5,714) = **18 días**;
- el aviso estimado es la fecha de la lectura más ceil(70 / 5,714) = **13 días**.

---

## 2. El uso declarado en la API de medidores (primer commit)

**`POST /api/medidores` y `PATCH /api/medidores/:id`** aceptan un campo opcional, `uso_estimado`:
- `{ "valor": 40, "periodo": "SEMANA" }`, o
- `null`, que lo borra.

**Validación, con 400 `DATOS_INVALIDOS`:**
- `valor`: un número mayor que 0 que entre en `NUMERIC(14,2)`;
- `periodo`: `DIA`, `SEMANA` o `MES`;
- un objeto al que le falte cualquiera de los dos es inválido.

**Al cambiar el uso declarado**, `estimacion_avisada_en` vuelve a `NULL`, igual que hace hoy `lectura_cada_dias` con su aviso. El alcance y los permisos son los de siempre para los medidores.

**En la respuesta del medidor** (`GET`, el detalle y la ronda) se suman estos campos:

```jsonc
"uso_estimado": { "valor": 40, "periodo": "SEMANA" },   // o null
"ritmo": {                                               // o null, sin ningún ritmo
  "por_dia": 5.714,
  "fuente": "DECLARADO",                                 // o "LECTURAS"
  "declarado_por_dia": 5.714,                            // o null
  "lecturas": { "usadas": 3, "desde": "…", "hasta": "…" }, // o null, si no alcanzan
  "desvio_pct": null                                     // con los dos ritmos, un entero
},
"valor_estimado_hoy": 117.14,  // o null
"atraso_por_dias": false,
"atraso_por_uso": false
```

- **`valor_estimado_hoy`:** sale de la última lectura y del ritmo. Es nulo sin lectura o sin ritmo.
- **`atrasado`:** sigue existiendo, ahora como `atraso_por_dias || atraso_por_uso` (sección 4).

## 3. La fecha estimada en las tareas (primer commit)

En `usoDeTarea()`, el objeto `uso` suma el campo `estimacion`. Lo reciben el plan, el calendario y todo lo que hoy devuelve `uso`:

```jsonc
"estimacion": {                // o null (los casos de 1.2)
  "fecha": "2026-12-06",
  "fecha_aviso": "2026-12-01", // o null
  "pasada": false,
  "ritmo_por_dia": 5.714,
  "fuente": "DECLARADO"
}
```

**Nada más cambia.** `estado`, `estado_uso`, `faltan` y la generación automática siguen saliendo de la lectura real. Las pruebas EU-08 y EU-09 controlan justamente eso.

---

## 4. El aviso por estimación (segundo commit)

**Cuándo un medidor tiene `atraso_por_uso`:** es un medidor activo, de una máquina activa, con alguna tarea activa de un plan activo que cumple una de estas dos condiciones:
- `estado_uso = 'AL_DIA'` y `fecha_aviso_estimada <= hoy`. Según el ritmo ya estaría para avisar, pero la última lectura dice que no;
- `estado_uso = 'PROXIMA'` y `fecha_estimada <= hoy`. Según el ritmo ya habría vencido.

**No depende de `lectura_cada_dias`:** con `NULL` se apaga el control por días, no este. Este aviso está atado a una tarea que se acerca.

**`atraso_por_dias`** es el `SQL_ATRASADO` de hoy, sin cambios. Los dos se calculan en `medidores/consultas.ts`, en un solo lugar.

**La revisión diaria** suma este aviso al de las lecturas atrasadas, en la misma transacción y con el mismo esquema:
- primero los candidatos;
- después los bloqueos, en el mismo orden;
- vuelve a controlar;
- un aviso por destinatario.

**Detalles del aviso:**
- **El tipo** es el mismo `LECTURA_ATRASADA`, así que no cambia la cantidad de tipos ni de reglas de aviso, ni el link a `/lecturas?solo_atrasados=true`.
- **El título** pasa a ser "Lecturas para cargar".
- **El texto, una línea por medidor:**
  - por días, la de hoy;
  - por uso: `COM-01 · Horómetro: por el ritmo de uso (5,7 h/día) estaría en ≈ 182 h y hay una tarea que avisa a las 170 h. Cargá una lectura.`
  - si las dos condiciones se cumplen a la vez, van las dos líneas.
  - Para la línea por uso, si hay varias tareas, se nombra la del umbral más bajo.
- **Una vez por episodio, y cada aviso por su lado:**
  - por días, con `atraso_avisado_en`, como hoy;
  - por uso, con `estimacion_avisada_en`.
- **`estimacion_avisada_en` vuelve a `NULL`:**
  - con una lectura nueva, en `registrarLectura`, junto con `atraso_avisado_en`;
  - cuando cambia el uso declarado.
- **`ResultadoVencimientos`** suma `lecturas_por_uso`: cuántos medidores se avisaron por estimación.

**La ronda** (`solo_atrasados`) incluye los atrasados por uso.

---

## 5. El calendario (segundo commit)

Hay **un evento nuevo, `ESTIMADA`:** la próxima de una tarea con medidor y `estimacion` no nula.
- **Si la tarea vence solo por uso,** el evento va en `fecha_estimada`. Si es `pasada`, va en **hoy** con `estimada_pasada: true`, igual que una vencida se muestra desde hoy (D-028, punto 3).
- **Si vence por fecha y por uso,** hay evento `ESTIMADA` **solo si `fecha_estimada` es anterior a `proxima_fecha`**. Es "lo que llegue primero": si el uso llega antes, se ve. Si no, alcanza con el evento por fecha, que ya sale.
- **En el orden de un mismo día,** `ESTIMADA` va después de `PENDIENTE` y antes de `PREVISTA`.
- **Cada evento lleva el objeto `estimacion`.** Los demás tipos lo llevan en `null`.
- **La lista `por_uso` sigue igual,** con todas las tareas que vencen solo por uso. Ahora cada una trae `uso.estimacion`, así que se ve la fecha estimada también ahí, y las que no tienen estimación se distinguen.

---

## 6. Pantallas (tercer commit)

**El formulario del medidor (`ModalMedidor`):**
- un bloque **"Uso estimado (opcional)"**: un número, la unidad del medidor como texto fijo y un selector con "por día", "por semana" y "por mes";
- vacío es `null`;
- la ayuda dice: "Se usa para estimar cuándo toca cada tarea hasta que haya lecturas suficientes".

**El medidor en la máquina (`BloqueMedidoresMaquina`):**
- **la línea del ritmo**, según el caso:
  - "Ritmo: 5,7 h/día (declarado: 40 h por semana)";
  - "Ritmo: 6,9 h/día según lecturas (13 al 20/11) · declarado 5,7 h/día, +21 %";
  - "Sin ritmo: cargá el uso estimado o al menos 3 lecturas en 7 días";
- **el valor estimado de hoy:** "≈ 117 h hoy (estimado)", con el texto en gris;
- **un desvío de más del 25 %** muestra el badge naranja "El uso real difiere del declarado" y el botón **"Actualizar declarado"**:
  - hace `PATCH` con el ritmo real, pasado al período que ya tenía elegido y redondeado a un decimal;
  - pide confirmación antes de mandarlo.

**La tarea en el plan (`TablaTareasPlan`)**, debajo de lo que ya muestra por uso:
- "≈ 06/12 (estimada)";
- un tooltip con la fuente y el ritmo;
- si es `pasada`: "Ya debería haber llegado: cargá una lectura", en naranja.

**El calendario:**
- **el evento `ESTIMADA`** va con borde punteado, el prefijo "≈" y un color propio que no se use en los demás tipos;
- **la etiqueta** es "Estimada por uso";
- **en el panel del día:** "Vence al llegar a 200 h · estimada con 5,7 h/día (declarado)";
- **la leyenda del calendario** suma el tipo nuevo;
- **en `ListaPorUso`:** la fecha estimada, o "sin estimación".

**La ronda de lecturas (`TablaRonda` y `TarjetasRonda`):**
- un medidor con `atraso_por_uso` lleva el chip "Por el ritmo, ya debería estar cerca";
- **no se muestra el valor estimado al lado del campo de la lectura.**

**Las reglas de pantalla:**
- **modo claro y modo oscuro:** solo variables `--sm-*`, ningún color escrito a mano;
- **a 390 px**, nada se sale de costado;
- **en el celular con modo simple,** la ronda muestra el chip y nada más.

**Funciones puras en `lib`, con pruebas desde FE-161:**
- el texto del ritmo, para cada fuente y sin ritmo;
- pasar un ritmo por día a un período y al revés, con la semana de 7 días y el mes de 30;
- cuándo se muestra el desvío: `|desvio_pct| > 25`;
- el formato "≈ dd/mm";
- el color y la etiqueta del evento `ESTIMADA`;
- el valor que propone "Actualizar declarado".

---

## 7. Decisión y pruebas

### 7.1 D-032, en `docs/decisiones.md`

**D-032 — Fecha estimada por ritmo de uso.** Reemplaza el punto 7 de la D-023 y el punto 4 de la D-030. Cambia el punto 4 de la D-028.

1. **El usuario declara el uso de cada medidor:** un valor por día, por semana o por mes. Es opcional. Para la cuenta, el mes es de 30 días.
2. **El ritmo de uso es el real, si hay lecturas suficientes:**
   - al menos 3 lecturas vigentes, con 7 días o más entre la primera y la última;
   - se usan las de los últimos 60 días, y si son menos de 3, las 3 últimas;
   - si no se llega al mínimo, se usa el declarado.
3. **Se comparan los dos ritmos.** Si el real se aparta más de un 25 % del declarado, se avisa en pantalla y se ofrece actualizar el declarado.
4. **La fecha estimada es solo informativa.** La tarea vence por la lectura real: la estimación no cambia ningún estado ni genera ninguna intervención.
5. **Hay un aviso para cargar una lectura** cuando, según el ritmo, una tarea ya habría llegado a su aviso o a su vencimiento y ninguna lectura lo confirma.
6. **En el calendario,** la próxima de cada tarea por uso se muestra con su fecha estimada, como un evento distinto. Las siguientes no se proyectan.
7. **Solo se guarda lo que declara el usuario.** El ritmo y las fechas se calculan siempre.

**Motivo:** el preventivo por uso no le decía al responsable de mantenimiento cuándo planificar. La estimación da esa fecha, sin el riesgo de la falsa tranquilidad, porque nunca reemplaza a la lectura. Además, convierte la falta de lecturas en un aviso concreto.

En las D-023, D-028 y D-030, el punto reemplazado dice "Reemplazado por la D-032".

### 7.2 Pruebas

**`test:migration-023` (M23):** las columnas y sus `CHECK`:
- un valor sin período falla;
- un valor de 0 falla;
- un período inválido falla;
- reaplicar la migración no da error;
- existen las dos vistas.

**`test:estimacion-uso` (EU).**
- **Cómo se arma:** las lecturas se cargan por la API y después se les corre `registrada_en` a mediodía de `hoy_instalacion() − N`, como en LR.
- **Las fechas esperadas se calculan con el `hoy` de la base,** nunca con el reloj de la máquina que corre la prueba.

| N.º | Qué se prueba |
| :-: | :--- |
| EU-01 | Sin lecturas ni uso declarado: `ritmo` nulo y `estimacion` nula. |
| EU-02 | 40 por semana y una lectura de 100 hace 2 días, con la tarea a 200 y aviso de 30. `fuente` es `DECLARADO`, `por_dia` es 5,714, `fecha` = base + 18 días, `fecha_aviso` = base + 13 días y `valor_estimado_hoy` ≈ 111,43. |
| EU-03 | Con 2 lecturas sigue `DECLARADO`. Con 3 lecturas en 7 días o más pasa a `LECTURAS`, con el ritmo exacto y `desvio_pct` con su signo. |
| EU-04 | 3 lecturas en menos de 7 días: no alcanza, vuelve al declarado o a nulo. |
| EU-05 | La ventana. Con 3 lecturas en los últimos 60 días, una más vieja no entra. Con menos de 3 en los 60 días, se usan las 3 últimas. |
| EU-06 | Una lectura anulada no cuenta. |
| EU-07 | Ritmo 0 según las lecturas: `fuente` es `LECTURAS`, `por_dia` es 0 y no hay fecha. |
| EU-08 | La estimación no cambia estados. Con `estimada_pasada`, `estado` y `estado_uso` son los mismos que sin uso declarado. |
| EU-09 | No genera nada. `procesarVencimientos({ forzar: true })` con una tarea `pasada`, en un plan con generación automática: no crea ninguna intervención; sí crea el aviso de la sección 4. |
| EU-10 | Validación de `uso_estimado`: 0, negativo, sin período, período inválido y texto dan 400. `null` lo borra. Fuera del alcance, la respuesta de siempre. |
| EU-11 | El aviso por uso: sale una vez y no se repite. Con una lectura nueva se puede volver a avisar, y también al cambiar el declarado. Avisa con `lectura_cada_dias` en `NULL`. |
| EU-12 | Los dos avisos van por separado. Uno avisado por días no tapa el de uso, y al revés. Las dos líneas salen en el mismo aviso si coinciden. |
| EU-13 | La ronda con `solo_atrasados` incluye un medidor con solo `atraso_por_uso`. |
| EU-14 | En el calendario, solo por uso: el evento `ESTIMADA` va en `fecha_estimada`, y una `pasada` va en hoy. |
| EU-15 | En el calendario, fecha y uso: hay evento `ESTIMADA` solo si es anterior a `proxima_fecha`. Una tarea `VENCIDA` o `EN_CURSO` no tiene evento `ESTIMADA`. |

**Las FE nuevas** son las de la sección 6, desde la FE-161.

---

## 8. Cierre e informe

**Criterios de cierre:**
1. Las secciones 1 a 7 están hechas, en tres commits que compilan solos.
2. Las pruebas de la regla 3 están en verde, en Neon.
3. Se hizo push en `feat/base-neon`.

**El informe.** Las salidas van pegadas tal cual:
1. Los tres hashes.
2. La salida final de cada suite de la regla 3.
3. El typecheck y el build.
4. Las pruebas existentes que se tocaron, con una línea por cada una que diga qué campo se sumó.
5. El SQL final de las dos vistas.
6. La búsqueda de colores escritos a mano en los archivos tocados.
7. Los desvíos y las dudas.

**El recorrido en pantalla lo hace el revisor:**
- el medidor con uso declarado, con lecturas y con desvío;
- el calendario con eventos estimados;
- el aviso;
- todo, en claro, en oscuro y a 390 px.
