# Etapa PV4 — Medidores y tareas por uso: las pantallas

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `411e7f4` (Etapa C2).
> **Origen:** la API de la PV3 (D-023). Hoy, con una tarea solo por uso, las pantallas de la PV2 no se rompen, pero muestran "Cada null null", "Vence en null días" y "Programada para —".

**Qué entra:**
- los medidores y sus lecturas en la ficha de la máquina;
- la tarea por uso en el plan;
- el uso en los vencimientos y en la lista de planes;
- la lectura al marcar una tarea en la intervención.

**Qué no entra:**
- nada de la API: si algo de la API falta o no alcanza, frenar y avisar;
- las rutinas del operario (PV5);
- la generación automática (PV6).

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Cuatro commits:**

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1 y 2 | `feat(front): lógica de medidores y tareas por uso` |
   | 2 | 3 | `feat(front): medidores en la ficha de la máquina` |
   | 3 | 4 y 5 | `feat(front): tareas por uso en planes y vencimientos` |
   | 4 | 6 y 7 | `feat(front): lectura al marcar una tarea` |

3. **Pruebas:**
   - `npm run test:front`, `npm run typecheck` y `npm run build:frontend`;
   - no hay suites de la API para correr;
   - **no correr `test:todo`.**
4. **Pruebas existentes de `lib/preventivos.test.ts`: se autoriza cambiar solo esto,** y solo para sumar lo nuevo:
   - el borrador de una tarea (`borradorTareaVacio`, `borradorDeTarea`), con los campos de la 2.2;
   - `ESTADOS_POR_OMISION`, con `SIN_LECTURA`;
   - `textoPendientes`, con `sin_lectura`.

   Si otra falla, frenar y avisar.
5. **La lógica que se puede probar va en `lib/`,** con sus pruebas FE desde FE-95, como en la PV2. Los componentes solo la usan.
6. **Los números se muestran con `formatCantidad`,** seguidos de la unidad del medidor: "250 horas", "512,5 horas", "1.240 km".
7. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-pv4-medidores-pantallas.md`.

---

## 1. Tipos (primer commit)

En `frontend/src/api/tipos.ts`, lo que la PV3 dejó para esta etapa:
- **`SIN_LECTURA`** en `EstadoVencimiento` y en `EstadoTareaPlan`;
- **pueden venir en `null`:**
  - en la tarea del plan y en el elemento de los vencimientos: `frecuencia_valor`, `frecuencia_unidad`, `primera_fecha`, `proxima_fecha` y `dias`;
  - en la tarea de la intervención: `fecha_programada`.

Donde el typecheck se queje, se arregla con lo de las secciones 3 a 6. **No vale un `!` ni un `as` para callarlo.**

---

## 2. La lógica (primer commit)

### 2.1 Textos, en `lib/preventivos.ts`

| Función | Devuelve |
| :--- | :--- |
| `textoValorMedidor(valor, unidad)` | "512,5 horas". |
| `textoFrecuenciaTarea(t)` | "Cada 6 meses", "Cada 250 horas" o "Cada 6 meses o 250 horas". |
| `textoUso(uso)` | • **Sin lectura:** "Sin lecturas del Horómetro".<br>• **`faltan` mayor que 0:** "Faltan 25 horas".<br>• **0:** "Toca ahora".<br>• **Negativo:** "Se pasó por 12,5 horas". |
| `textoProximoUso(uso)` | "A las 500 horas". |
| `textoVenceTarea(t)` | El texto del criterio que apura:<br>• si `estado_fecha` es `VENCIDA` o `PROXIMA`, `textoVencimiento(dias)`;<br>• si no, si `uso.estado` es `VENCIDA`, `PROXIMA` o `SIN_LECTURA`, `textoUso`;<br>• si no, el de la fecha, y sin fecha, el del uso. |
| `textoProgramada(fecha, uso)` | "Programada para el 10/12/2026", "Programada a las 500 horas" o "Programada para el 10/12/2026 o a las 500 horas". |
| `textoValorAlHacer(uso)` | "Con el Horómetro en 512,5 horas", o `null` si no hay `valor`. |
| `textoPendientes` | Suma "1 sin lectura" / "2 sin lectura". |

`ESTADOS_POR_OMISION` suma `SIN_LECTURA`: hoy el front manda la lista, y sin él esas tareas no aparecen.

### 2.2 El borrador de una tarea

`BorradorTarea` suma:
- `criterio`: `'FECHA'`, `'USO'` o `'AMBOS'`;
- `medidorId`, `usoCada`, `usoPrimera` y `usoAnticipacion`. Los tres últimos como texto o número, como `frecuenciaValor`.

| Función | Qué cambia |
| :--- | :--- |
| `borradorTareaVacio()` | `criterio` es `'FECHA'`, y lo de uso queda vacío. |
| `borradorDeTarea(t)` | Saca el criterio de la tarea: con fecha y con uso, `'AMBOS'`. |
| `validarTareaBorrador(b)` | Valida solo lo del criterio elegido, con los límites de la API (PV3, 4.1):<br>• medidor: "Elegí el medidor.";<br>• cada: mayor que 0, con hasta 2 decimales;<br>• primera: desde 0, con hasta 2 decimales;<br>• anticipación: vacía, o de 0 a `cada`. |
| `cuerpoTarea(b)` | **Alta:** sin fecha, no manda los tres campos de la fecha; sin uso, no manda `uso`. Una anticipación vacía no se manda. |
| `cuerpoTarea(b, original)` | **`PATCH`:** la fecha que no va cuenta como `null`, así que sacarla manda los tres en `null`. `uso` se compara entero: si cambió, se manda el objeto, o `null` si se sacó. |
| `errorTareaDeApi` | `MEDIDOR_INVALIDO` va al campo del medidor. |

`primeraUsoSugerida(ultima, cada)` devuelve la última lectura más `cada`, o `cada` si no hay lecturas.

### 2.3 Medidores y lecturas, en `lib/medidores.ts`, nuevo

| Función | Qué hace |
| :--- | :--- |
| `validarMedidor(b)` | Nombre de 3 a 60, unidad de 1 a 20 y lectura inicial vacía o válida. |
| `cuerpoMedidor(b, original?)` | El alta, o solo lo que cambió en la edición. |
| `validarLectura(texto, ultima, modo)` | `modo` es `'NUEVA'` o `'PASADA'`.<br>• Vacío: "Ingresá la lectura.".<br>• Un número inválido: "Ingresá un número desde 0, con hasta 2 decimales.".<br>• `'NUEVA'`, menor que la última: "No puede ser menor que la última (512,5 horas).".<br>• `'PASADA'`, mayor que la última: "No puede ser mayor que la última (512,5 horas).". |
| `avisoSalto(valor, ultima, unidad)` | Si la última es mayor que 0 y el valor la pasa del doble: "Sube de 1.240 a 12.400 horas. Revisá que esté bien.". Si no, `null`. |
| `textoOrigenLectura(l)` | "Manual" o "Al hacer una tarea". El enlace a la intervención lo pone el componente. |

`unidad` siempre la pasa quien llama: viene del medidor.

### 2.4 Pruebas

FE-95 en adelante, una por función o grupo, con:
- los casos de las tablas;
- los bordes: 0, el máximo y 2 y 3 decimales;
- y en `cuerpoTarea`, los pasajes Fecha → Uso, Uso → Ambos y Ambos → Fecha, contra lo que espera la API.

---

## 3. Medidores en la ficha de la máquina (segundo commit)

**Un bloque nuevo, `BloqueMedidoresMaquina`, en `componentes/maquinas/` o `componentes/medidores/`.**
- **Dónde va:** en `DetalleMaquina`, antes de `BloquePlanesMaquina`.
- **Quién lo ve:** quien tiene `PLANES_GESTIONAR` o `MAQUINAS_REGISTRAR_LECTURAS`.

### 3.1 El bloque

**Título:** "Medidores". Con `PLANES_GESTIONAR`, botón "Nuevo medidor".

**Una fila por medidor:**
- nombre;
- unidad;
- la última lectura: "512,5 horas", y abajo, chico, "el 10/11/2026 por Operario Demo";
- cuántas tareas lo usan: "2 tareas", con `tareas_activas`.

**Acciones:**
- **"Cargar lectura":** botón, con `MAQUINAS_REGISTRAR_LECTURAS`. Con la máquina inactiva, deshabilitado y con el tooltip "La máquina está inactiva.".
- **Un menú con:**
  - "Ver lecturas", para todos;
  - "Editar" y "Desactivar" o "Reactivar", con `PLANES_GESTIONAR`.

**Con `PLANES_GESTIONAR`, se piden también los inactivos** (`all=true`), con la insignia "Inactivo" y sin "Cargar lectura".

**Sin medidores:** "Esta máquina no tiene medidores.".

### 3.2 Diálogos

**Nuevo y editar medidor:**
- **Nombre.**
- **Unidad:** un `Autocomplete` con "horas", "km", "ciclos" y "piezas", que deja escribir otra.
- **En el alta, "Lectura inicial",** opcional.
- `MEDIDOR_DUPLICADO` va al campo nombre.

**Desactivar:**
- se confirma;
- `MEDIDOR_EN_USO` se muestra en el diálogo: "Lo usan tareas activas: desactivalas o cambiales el medidor primero.".

**Cargar lectura:**
- arriba: "Última: 512,5 horas, el 10/11/2026", o "Todavía no tiene lecturas.";
- **"Lectura",** con la unidad a la derecha, y **"Observación",** opcional;
- `validarLectura` en modo `'NUEVA'`;
- **si hay `avisoSalto`,** el primer clic en "Guardar" lo muestra en un aviso amarillo y no manda nada; el botón pasa a "Guardar igual";
- `LECTURA_MENOR` y `MEDIDOR_INACTIVO` de la API van al campo.

**Lecturas del medidor:**
- una tabla con fecha y hora, valor, quién, origen y observación;
- **con origen `TAREA`,** "Al hacer una tarea", con un enlace "Intervención N.º 14338";
- **las anuladas,** con el valor tachado y abajo: "Anulada por Responsable Demo el 10/11/2026: <motivo>";
- de a 20, con `Pagination` y `X-Total-Count`;
- **con `PLANES_GESTIONAR`,** "Anular" en las vigentes. Pide el motivo (al menos 5 caracteres) y avisa: "Si la usó una tarea hecha, esa tarea conserva su valor."

**Al guardar cualquier cosa** se refrescan:
- los medidores de la máquina;
- los planes;
- los vencimientos;
- el tablero.

---

## 4. La tarea por uso en el plan (tercer commit)

### 4.1 `ModalTareaPlan`

- **Suma la prop `maquinaId`.** La pasan `DetallePlan` y `NuevoPlan`.
- **Pide los medidores activos de esa máquina.**

**"Vence por":** un `SegmentedControl` con "Fecha", "Uso" y "Las dos", debajo del detalle.
- **Sin medidores activos,** "Uso" y "Las dos" quedan deshabilitados, con el texto "La máquina no tiene medidores: se cargan en su ficha.".
- **Con "Fecha" o "Las dos":** los campos de hoy.
- **Con "Uso" o "Las dos":**

| Campo | Cómo es |
| :--- | :--- |
| Medidor | `Select`. Con uno solo, viene elegido. Uno inactivo de la tarea se muestra con "(inactivo)", como los repuestos. |
| Cada | Número con hasta 2 decimales, con la unidad a la derecha. |
| Primera vez a los | Número. Si está vacío y no se tocó, se llena con `primeraUsoSugerida` cuando hay medidor y cada.<br>**Descripción:** "Última lectura: 1.240 horas (02/11/2026).", o "El medidor todavía no tiene lecturas.". Si la tarea ya tiene `uso.ultimo`: "Ya se hizo: la próxima se cuenta desde la última vez (a las 480 horas).". |
| Avisar antes | Número, opcional.<br>**Descripción:** "Cuántas horas antes pasa a próxima. Vacío: el 10 % de «Cada».", con la unidad del medidor. |

**Al cambiar de "Las dos" a una sola,** los campos del otro criterio se esconden pero no se borran del borrador, y no se mandan (2.2).

### 4.2 `TablaTareasPlan`

| Columna | Qué muestra |
| :--- | :--- |
| Frecuencia | `textoFrecuenciaTarea`. |
| Última vez | La fecha, y abajo, chico, "a las 480 horas" si hay `uso.ultimo`. |
| Próxima | • **La fecha y `textoVencimiento`,** si tiene fecha.<br>• **`textoProximoUso` y `textoUso`,** si tiene uso.<br>Con las dos, una debajo de la otra, separadas. |

### 4.3 `NuevoPlan`

- `ListaTareasBorrador` muestra `textoFrecuenciaTarea` del borrador, y en lugar de la primera fecha, lo que corresponda al criterio.
- **Al cambiar la máquina,** las tareas por uso pierden el medidor. La lista las marca con "Falta elegir el medidor", y "Crear plan" muestra el error general "Hay tareas sin medidor: editalas." sin mandar nada.

---

## 5. Vencimientos y planes (tercer commit)

- **`estados.ts`:** `SIN_LECTURA` es "Sin lectura", en gris, con `IconGaugeOff`, que se suma a `EstadoBadge`.
- **`TarjetasResumen`:** una tarjeta "Sin lectura". Las cinco tienen que entrar en una fila desde 1280 px, y en celular van de a dos.
- **`TabVencimientos`:**
  - la columna "Vence" muestra lo mismo que "Próxima" en la 4.2;
  - la frecuencia, con `textoFrecuenciaTarea`.
- **`ModalGenerar`:** `textoVenceTarea` en lugar de `textoVencimiento(dias)`.
- **`TabPlanes` y `BloquePlanesMaquina`:** `textoPendientes` con `sin_lectura`.
- **El tablero (`FilaPreventivosTablero`)** no cambia.

---

## 6. La lectura al marcar una tarea (cuarto commit)

En `BloqueTareasIntervencion`:

**Debajo de la acción:**
- **"Programada…":** con `textoProgramada`.
- **Hecha, con `uso.valor`:** `textoValorAlHacer`.

**Marcar como hecha una tarea con `uso`** abre `ModalConfirmarTarea`, tenga o no repuestos previstos:

| Estado | Qué pasa |
| :--- | :--- |
| `PENDIENTE` | **Con previstos,** sigue el aviso de hoy: "Iniciá el trabajo para confirmar los repuestos.". **Solo con uso,** se abre el diálogo: la API lo permite. |
| `EN_PROCESO` o `EN_ESPERA_REPUESTOS` | **Arriba del diálogo, "Lectura del Horómetro":**<br>• viene llena con `uso.medidor.ultima_lectura.valor`, con la descripción "Última: 512,5 horas, el 10/11/2026. Si sigue igual, dejala.";<br>• **sin lecturas:** vacía, con "El medidor todavía no tiene lecturas.".<br>Se valida con `validarLectura` en modo `'NUEVA'`, y con `avisoSalto`, como en la 3.2. |
| `FINALIZADA` | El diálogo ya pide el motivo. **Suma "Lectura del Horómetro cuando se hizo",** obligatoria y vacía, con modo `'PASADA'`. |

**El título del diálogo:**
- con previstos, el de hoy;
- solo con uso: "Marcar como hecha".

**El botón:** con previstos, `textoBotonConfirmar`; si no, "Marcar como hecha".

**La lectura se manda siempre en `lectura`.** Los errores de la API (`LECTURA_REQUERIDA`, `LECTURA_MENOR`, `LECTURA_MAYOR`, `MEDIDOR_INACTIVO`) van al campo de la lectura.

**Desmarcar no cambia:** la lectura que se cargó queda en el medidor.

---

## 7. Grupos de permisos (cuarto commit)

En `lib/permisos.ts`:
- `PLANES_` pasa al grupo "Preventivos", `REPUESTOS_` a "Repuestos" y `COSTOS_` a "Costos", en ese orden, después de los que ya existen;
- "Módulos futuros" queda solo para `DOCUMENTOS_`;
- `MAQUINAS_REGISTRAR_LECTURAS` cae en "Máquinas" sin cambios.

Si una prueba FE de los grupos falla por esto, se autoriza cambiarla solo en los nombres de grupo.

---

## 8. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 7 están hechas, en cuatro commits.
2. `test:front`, `typecheck` y `build:frontend` sin errores.
3. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. Los cuatro hashes.
2. La salida final de `test:front`, con las FE nuevas.
3. Typecheck y build.
4. `wc -l` de los archivos tocados.
5. **Un recorrido a mano, a 1440 px y a 390 px,** que diga qué se vio:
   - crear un medidor con lectura inicial;
   - cargar una lectura con salto;
   - crear una tarea "Las dos";
   - verla en el plan y en los vencimientos;
   - generar, marcar con lectura y finalizar.
6. Desvíos y dudas.
