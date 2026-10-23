# Análisis Funcional: Módulo de Intervenciones (v3)

> **Estado:** borrador para revisión. **No hay código, endpoints, migraciones ni cambios de base de datos asociados a este documento.**
> Nada de lo marcado como `[PROPUESTA]` se implementa hasta que sea aprobado.

---

## 0. Cómo leer este documento

### 0.1 Convención de origen

| Etiqueta | Significado |
| :--- | :--- |
| `[APROBADO]` | Decisión tomada expresamente por el usuario en esta conversación. Es vinculante. |
| `[TESIS]` | Requisito o criterio que figura en el Word de la tesis (`docs/informeWordDeTesis/Informe-Sistema_De_Mantenimiento(20261002-234631).docx`). |
| `[PROPUESTA]` | Propuesta nueva de este análisis. **Requiere aprobación** antes de implementarse. Se resumen en la sección 11. |

### 0.2 Fuente de la tesis

En esta versión revisé el Word completo: texto, listas de requerimientos (secciones 5 y 9.2), fichas de casos de uso, diagrama de clases (10.3), diagrama de estados (10.4), diagramas de casos de uso y de paquetes, flujogramas de procesos (3.2 a 3.4) y la planilla de costos del Anexo A.1.

Los diagramas de asociaciones y de secuencia de los casos de uso 10.6 y 10.7 figuran en el Word como imágenes o enlaces a Drive; **solo revisé las imágenes incluidas**. Los enlaces a Drive no los abrí.

> La versión v2 atribuía los estados de máquina (`OPERATIVA`, `DETENIDA`, etc.) a la tesis. Era un error: **la tesis no define esos estados**. Provienen del esquema de base de datos. Lo único que dice la tesis (4.5) es que el sistema debe permitir "conocer qué máquinas se encuentran detenidas o con mantenimiento en curso".

### 0.3 Decisiones aprobadas tras revisar la tesis `[APROBADO]`

| # | Tema | Decisión |
| :-: | :--- | :--- |
| A1 | Detenciones e inactividad | **Tabla de períodos de detención** por intervención (desde, hasta, quién confirmó). Las fechas de inicio y fin del trabajo quedan en la intervención. |
| A2 | Estados de la intervención | **Fijos** en la primera versión (los 5 actuales). La configurabilidad completa queda para una etapa futura, documentada como desvío consciente respecto de la tesis. |
| A3 | Inicio de sesión | **Legajo como identificador + contraseña propia con hash** (lo ya implementado). Se corrige la tesis, que en 9.2 dice "nombre + legajo como clave". |
| A4 | Ejecución interna / externa | Campo `ejecucion` (`INTERNA` / `EXTERNA`) por intervención; los servicios externos son un tipo de costo. |
| A5 | Falla persistente tras finalizar | **Se permite reabrir** una intervención finalizada (`FINALIZADA` → `EN_PROCESO`), con permiso y motivo. |
| A6 | Avisos a responsables | **Notificaciones desde la primera versión.** |
| A7 | Mano de obra | Es un **renglón** en la misma tabla de costos (tipo `MANO_OBRA`), igual que gastos adicionales y ajustes. |

### 0.4 Concordancias y divergencias con la tesis

| Tema | Lo que dice la tesis | Este análisis | Consecuencia |
| :--- | :--- | :--- | :--- |
| Aviso de falla | Clase `NecesidadMantenimiento` separada; la intervención tiene `necesidadId` opcional; caso de uso propio (10.5). | Una falla y una intervención correctiva son **el mismo registro** `[APROBADO]`. | **Actualizar** la tesis: diagrama de clases (10.3), asociaciones (10.5.4, 10.6.4), ficha de 10.5 y la correspondencia de 10.8. |
| "Necesidad" vs "falla" | La necesidad puede ser "falla, anomalía o necesidad de mantenimiento". | El formulario del operario crea siempre `CORRECTIVO`. | Un operario no puede informar una necesidad no correctiva. Ver D-17. |
| Estados | Clase configurable `EstadoIntervencion` (con `esFinal` y `activo`); estados y transiciones "configurables". | 5 estados fijos `[APROBADO]` (A2). | Desvío consciente; documentarlo en la tesis. |
| Tiempos | Clase `RegistroTiempo` (`tipoTiempo`, `inicio`, `fin`, `duracionHoras`) con varios registros por intervención. La clase `IntervencionMantenimiento` **no** tiene fechas de inicio/fin propias. | Fechas de trabajo en la intervención + tabla de **períodos de detención** `[APROBADO]` (A1). | Alineado en el concepto de períodos. Difiere en que el trabajo no se registra como períodos. |
| Costos | Clase `CostoIntervencion` (concepto, importe, fecha), con "mano de obra y otros conceptos"; `ConsumoRepuesto` con costo histórico y subtotal. | Renglones de costo, incluida la mano de obra `[APROBADO]` (A7). | Alineado. |
| Cambios de estado | `CambioEstado` guarda solo el estado nuevo. | El historial guarda estado anterior y nuevo. | Compatible. |
| Responsable | `responsableLegajo` es nulo en el diagrama de clases; el RNF-06 de la sección 5.1 lo lista como dato obligatorio. | Opcional al crear; **obligatorio para pasar a `EN_PROCESO`**. | Alineado con el diagrama; aclarar el RNF-06. |
| Transiciones | El diagrama de estados tiene: `PENDIENTE→EN_PROCESO`, `PENDIENTE→CANCELADA`, `EN_PROCESO→CANCELADA`, `EN_PROCESO→FINALIZADA`, `EN_PROCESO↔EN_ESPERA_REPUESTOS`. `FINALIZADA` y `CANCELADA` son finales. | Se agregan: "Resolver ahora" (pasa por `EN_PROCESO`), `EN_ESPERA_REPUESTOS→CANCELADA` y la **reapertura** de `FINALIZADA` `[APROBADO]` (A5). | Actualizar el diagrama 10.4. |
| Perfiles y permisos | RNF-06 (9.2): funciones según permisos "del perfil **o usuario**"; permisos de consulta "configurables para cada usuario". | Permisos por perfil y por usuario. | `[TESIS]` respalda las excepciones por usuario. El **alcance por sector/propias** no figura en la tesis: es una extensión `[APROBADO]`. |
| Estado de la máquina | `Maquina` tiene un atributo de estado (RF-03 de 5.1) pero **no se definen sus valores**. | 4 estados del esquema. | Documentar los valores en la tesis. |
| Código de máquina | La clase `Maquina` tiene `codigo`. | La tabla `maquinas` **no** tiene `codigo`. | Ver D-18. |
| Inicio de sesión | RF-02 (5.1): usuario y contraseña. RF-03 (9.2): nombre + legajo como clave. | Legajo + contraseña con hash `[APROBADO]` (A3). | Corregir la tesis (la propia tesis es inconsistente). |
| Infraestructura | Servidor interno en red LAN/WiFi (6.1, RNF-02). | Neon (nube) y Neon Functions (`docs/decisiones.md`, D-005). | No afecta a este módulo; justificar o actualizar la tesis. |
| Interno / externo | No figura en las clases ni en 4.4; sí en la planilla del Anexo A.1 (costos y horas "Externas" e "Internas", reactivas y preventivas). | Campo `ejecucion` `[APROBADO]` (A4). | Agregarlo a la tesis (4.4 y clase de intervención). |
| Prueba de funcionamiento | Proceso 3.2: tras reparar se prueba la máquina; si no funciona se vuelve a evaluar. | Confirmación explícita de recuperación y reapertura `[APROBADO]` (A5). | Alineado. |
| Notificaciones | RF-15 y paquete Notificaciones (vencimientos, pendientes y otros eventos). | In-app desde la primera versión `[APROBADO]` (A6). | Alcance concreto en sección 8.6. |

### 0.5 Lo que la tesis ya establece

- `[TESIS]` El operario registra desde celular o terminal a pie de máquina; se identifica con su legajo (en la tesis, además, con su nombre).
- `[TESIS]` Perfiles: Administrador, Responsable de mantenimiento, Operario y Consulta (Dirección / I+D); permisos configurables por perfil o usuario.
- `[TESIS]` Al registrar: fecha, hora y usuario automáticos; mínimo máquina y descripción; estado inicial `Pendiente` (M-RF-02 a M-RF-04).
- `[TESIS]` Intervención con responsable, tipo, descripción, fechas, estado, tareas realizadas, observaciones, tiempos de trabajo e inactividad, repuestos y costos (M-RF-06 a M-RF-11).
- `[TESIS]` Calcular el costo total "sin duplicar el costo de los repuestos" (M-RF-11).
- `[TESIS]` Historial de cambios de estado con usuario, fecha y observación (`CambioEstado`, M-RF-08, M-RNF-03).
- `[TESIS]` Consumo de repuestos con costo unitario histórico; se descuenta del stock (RF-18 de 9.2).
- `[TESIS]` Reportes: tiempo de inactividad por máquina, fallas históricas, costos, repuestos más usados, intervenciones pendientes o en proceso (4.8).

### 0.6 Cambios respecto de la v2

| Tema | v2 | v3 |
| :--- | :--- | :--- |
| Detención | Columnas en la intervención | **Tabla de períodos de detención** |
| Costos | Renglones solo para adicionales | **Todos** los conceptos manuales (incl. mano de obra) como renglones |
| `FINALIZADA` | Estado terminal | **Reabrible** con permiso y motivo |
| Ejecución | No contemplada | Campo `ejecucion` interna/externa |
| Notificaciones | Fuera de alcance | Incluidas (in-app) |
| Fuente de la tesis | Solo documentos del repo | Word revisado; sección 0.4 |

---

## 1. Descripción funcional (simplificada)

El módulo de Intervenciones registra y hace el seguimiento de los trabajos de mantenimiento sobre las máquinas de GI-RE S.A.

1. `[APROBADO]` **Un aviso de falla y una intervención correctiva son el mismo registro.** No existe una entidad "aviso" separada.
2. `[APROBADO]` Cuando el operario informa una falla se crea una intervención `CORRECTIVO` en estado `PENDIENTE`, con el usuario y la fecha de creación registrados automáticamente.
3. `[APROBADO]` El responsable es **opcional** al crear. Una intervención puede permanecer `PENDIENTE` sin responsable.
4. `[APROBADO]` El formulario de falla tiene tres datos: **máquina**, **descripción del problema** y **estado operativo en que quedó la máquina** (continúa funcionando / quedó detenida).
5. `[APROBADO]` Una máquina puede tener **varias intervenciones abiertas a la vez**. Su estado no depende de la última intervención modificada.
6. `[APROBADO]` Se distinguen: **eliminación lógica** (registro equivocado), **cancelación** (no corresponde ejecutar) y **finalización** (trabajo realizado, aunque haya durado minutos).
7. `[APROBADO]` Los tiempos de gestión (espera, trabajo, total) son distintos de la **inactividad real de la máquina**.
8. `[APROBADO]` Los costos se calculan automáticamente cuando es posible y admiten gastos adicionales y ajustes **justificados y trazables**.
9. `[APROBADO]` Los permisos son configurables por perfil y por usuario; se separan **permisos de acción** y **alcance de visibilidad**.
10. `[APROBADO]` Una intervención finalizada puede **reabrirse** (con permiso y motivo) si la falla persiste.
11. `[APROBADO]` Cada intervención indica si se ejecutó con personal **interno o externo**.
12. `[APROBADO]` El sistema genera **notificaciones** a los usuarios correspondientes desde la primera versión.

### 1.1 Intervenciones preventivas

`[PROPUESTA]` Las reglas de estados, tiempos, costos, permisos, detención de máquina y notificaciones aplican también a las intervenciones `PREVENTIVO` (un preventivo puede detener la máquina de forma planificada). La generación automática de preventivos desde los planes queda para una etapa posterior.

---

## 2. Actores y responsabilidades

Los perfiles son los **valores iniciales por defecto**. `[APROBADO]` El administrador puede modificar los permisos de cada perfil y, cuando corresponda, de cada usuario (sección 8).

| Actor | Responsabilidades por defecto | Fuente |
| :--- | :--- | :--- |
| **Operario** | Registrar fallas. Consultar el estado de las fallas e intervenciones que tenga autorizadas. **No** asigna, finaliza ni modifica trabajos técnicos, salvo autorización específica. | `[APROBADO]` / `[TESIS]` |
| **Responsable de mantenimiento** | Gestionar intervenciones; asignar responsables; modificar estados; registrar trabajos, tiempos y costos; finalizar y cancelar. | `[APROBADO]` / `[TESIS]` |
| **Administrador** | Configurar perfiles, permisos y accesos. Administrar el sistema según las autorizaciones definidas. | `[APROBADO]` / `[TESIS]` |
| **Consulta / Dirección / I+D** | Acceso a información autorizada, sin cambios operativos por defecto. | `[APROBADO]` / `[TESIS]` |
| **Usuario habilitado como responsable** | Cualquier usuario activo con permiso para recibir asignaciones. | `[PROPUESTA]` |

> **Observación:** en el proceso actual (3.2) I+D y Dirección evalúan y coordinan las reparaciones, y la tesis dice que I+D participa de la gestión operativa del mantenimiento (2.2). Con los permisos por defecto, esos usuarios solo consultarían. Se resuelve con perfil o excepciones por usuario (D-17).

> `[PROPUESTA]` El Administrador tendría por defecto todos los permisos, como en `001_initial_schema.sql`, pero configurables (D-12).

---

## 3. Escenarios de mantenimiento correctivo

### E1 — Falla con máquina detenida (flujo completo)

1. El operario informa: *Torno CNC / "El motor no arranca" / máquina detenida*.
2. Se crea la intervención `CORRECTIVO` / `PENDIENTE`, sin responsable, y se abre un **período de detención**. La máquina pasa a `DETENIDA`.
3. Se notifica a los usuarios habilitados para asignar (sección 8.6).
4. Un responsable **se asigna** la intervención (no inicia el trabajo).
5. Inicia el trabajo: `EN_PROCESO`, con fecha de inicio. La máquina pasa a `EN_MANTENIMIENTO`.
6. Repara, prueba la máquina y finaliza: `FINALIZADA`, con fecha de fin, descripción del trabajo y ejecución interna o externa.
7. Confirma que **la máquina puede funcionar**: se cierra el período de detención (queda quién y cuándo). Si no hay otros períodos abiertos, la máquina vuelve a `OPERATIVA`.

### E2 — Falla con la máquina funcionando

1. El operario informa: *Prensa / "luz del panel quemada" / continúa funcionando*.
2. Se crea la intervención `PENDIENTE`. **No se abre período de detención** y la máquina no cambia de estado.
3. Al finalizar no hay nada que liberar.

### E3 — Falla resuelta en pocos minutos

1. `[APROBADO]` Debe quedar registrada como `FINALIZADA` aunque haya demorado minutos.
2. `[PROPUESTA]` Acción única **"Resolver ahora"** (`PENDIENTE` → `FINALIZADA`): exige fecha de inicio, fecha de fin y descripción del trabajo. Graba en una sola transacción las dos filas de historial (`PENDIENTE→EN_PROCESO` y `EN_PROCESO→FINALIZADA`), de modo que el recorrido respeta el diagrama de estados de la tesis.

### E4 — Falta de repuestos

1. Durante `EN_PROCESO` falta un repuesto: pasa a `EN_ESPERA_REPUESTOS`, indicando qué falta.
2. Si había período de detención abierto, **sigue abierto**. La máquina pasa a `DETENIDA` si ninguna otra impediente está `EN_PROCESO`.
3. Al llegar el repuesto vuelve a `EN_PROCESO`; el repuesto utilizado se asocia a la intervención y su costo se incorpora automáticamente.

### E5 — Registro equivocado (eliminación lógica)

1. Una intervención se creó por error (máquina equivocada, duplicada).
2. `[APROBADO]` Si **no tiene trabajo, tiempo ni gastos registrados**, un usuario autorizado la quita de las listas mediante **eliminación lógica**, con motivo.
3. Queda registrado quién, cuándo y por qué. El registro no se destruye.
4. Si tenía un período de detención abierto, hay que decidir explícitamente qué pasa con la máquina (4.4).

### E6 — Cancelación

1. `[APROBADO]` Una intervención que no corresponde ejecutar se cancela con **motivo obligatorio** y permanece en el historial.

### E7 — Finalización administrativa sin recuperación de la máquina

1. `[APROBADO]` Se cierra administrativamente una intervención, pero la máquina sigue sin poder usarse.
2. El usuario declara que **la máquina no recuperó su funcionamiento**: la intervención queda `FINALIZADA` y el **período de detención sigue abierto**.
3. Más adelante un usuario autorizado ejecuta **"Confirmar recuperación"** (4.4). También se notifica este caso (8.6).

### E8 — Corrección de datos de una intervención finalizada

1. Se detecta que la hora de inicio se cargó mal.
2. Un usuario autorizado corrige la fecha **justificando** el cambio. Queda valor anterior, valor nuevo, motivo, usuario y fecha (5.4).

### E9 — La falla persiste después de finalizar (reapertura) `[APROBADO]`

1. Una intervención se finalizó, pero al probar la máquina la falla continúa (el "No" del proceso real 3.2).
2. Un usuario con permiso de reapertura ejecuta **"Reabrir"**, con motivo obligatorio: `FINALIZADA` → `EN_PROCESO`.
3. Si el período de detención seguía abierto, continúa sin interrupción. Si ya se había cerrado y la máquina volvió a detenerse, se indica la nueva detención y se abre un **nuevo período**; el período anterior no se modifica.
4. La reapertura conserva todo lo cargado (tiempos, costos, repuestos) y queda en el historial.

---

## 4. Varias intervenciones sobre una misma máquina

### 4.1 Regla fundamental `[APROBADO]`

- Una máquina puede tener **múltiples intervenciones abiertas simultáneamente**.
- **Cada intervención** debe permitir saber si provoca una detención y si ese impedimento sigue vigente.
- El estado de la máquina **no** se determina mirando la última intervención modificada.
- **Ninguna intervención individual puede dejar la máquina `OPERATIVA` si existe otra causa registrada que todavía la mantiene inoperativa.**

### 4.2 Modelo conceptual `[APROBADO]` (A1, tabla de períodos)

Cada vez que una intervención detiene la máquina se registra un **período de detención**:

| Dato | Significado |
| :--- | :--- |
| Intervención | Causa de la detención. |
| `desde` | Momento en que la máquina se detuvo por esa causa. |
| `hasta` | Momento en que se **confirmó** que esa causa ya no impide operar. `NULL` = **vigente**. |
| Quién lo abrió / quién confirmó | Usuarios responsables de cada acto. |
| Observación | Contexto opcional. |

**Definición de impedimento vigente:**

> Es un período de detención con `hasta` nulo, perteneciente a una intervención que no está eliminada lógicamente. El estado de la intervención (incluso `FINALIZADA` o `CANCELADA`) no libera el impedimento por sí mismo: solo lo libera una **confirmación explícita** (4.4).

Reglas del modelo:

- Una intervención tiene **como máximo un período abierto** a la vez (se garantiza con un índice único parcial).
- Puede tener **varios períodos a lo largo del tiempo** (se detuvo, se confirmó la recuperación, volvió a detenerse tras reabrirla).
- Una intervención sin períodos nunca detuvo la máquina.

**Derivación del estado de la máquina** (un único procedimiento de aplicación, dentro de la misma transacción de cada cambio relevante):

| # | Condición (sobre **todas** las intervenciones de la máquina) | Estado resultante |
| :-: | :--- | :--- |
| 1 | La máquina está `FUERA_DE_SERVICIO` | No cambia por acción de intervenciones. Solo cambia manualmente (con permiso y registro). |
| 2 | Hay al menos un período abierto y alguna de esas intervenciones está `EN_PROCESO` | `EN_MANTENIMIENTO` |
| 3 | Hay al menos un período abierto y ninguna está `EN_PROCESO` | `DETENIDA` |
| 4 | **No** hay períodos abiertos y se acaba de **confirmar** la recuperación | `OPERATIVA` |
| 5 | No hay períodos abiertos y no hubo confirmación | No se modifica |

`OPERATIVA` solo se alcanza mediante una **confirmación humana explícita** del último impedimento; nunca porque una intervención haya terminado.

### 4.3 Relación con los estados existentes de la máquina

`[PROPUESTA]` **No se agregan estados nuevos.**

| Estado | Uso |
| :--- | :--- |
| `OPERATIVA` | Sin períodos abiertos y con recuperación confirmada. |
| `DETENIDA` | Hay impedimento vigente y nadie trabaja activamente en él. |
| `EN_MANTENIMIENTO` | Hay impedimento vigente y al menos una de esas intervenciones está `EN_PROCESO`. |
| `FUERA_DE_SERVICIO` | Baja prolongada o definitiva. Decisión manual; las intervenciones no la modifican. |

**Justificación:** "finalizada pero sin recuperación" o "en espera de repuestos" se expresan con *estado de intervención* + *período abierto*, sin multiplicar estados de máquina. Un estado como `EN_PRUEBA` duplicaría lo que ya indican los períodos.

> `[PROPUESTA]` La diferencia automática `DETENIDA` / `EN_MANTENIMIENTO` (filas 2 y 3) es informativa. Alternativa: solo `DETENIDA` automática y `EN_MANTENIMIENTO` manual (D-02).

### 4.4 Liberación de un impedimento

La decisión es siempre **explícita**, nunca implícita:

| Situación | Decisión solicitada | Efecto |
| :--- | :--- | :--- |
| **Finalizar** una intervención con período abierto | "¿La máquina ya puede funcionar?" Sí / No | Sí: se completa `hasta`, se registra quién confirmó y se recalcula la máquina. No: el período sigue abierto (E7). |
| **Cancelar** una intervención con período abierto | Ídem | Ídem. |
| **Eliminar lógicamente** una intervención con período abierto | Ídem (por defecto "Sí") | Ídem. |
| Acción **"Confirmar recuperación"** | Selección de los períodos abiertos que se cierran | Cierra los seleccionados; si queda alguno, la máquina sigue inoperativa. |

> `[APROBADO]` Solo cuando no queda ningún período abierto y se confirmó que la máquina puede funcionar, vuelve a `OPERATIVA`.

### 4.5 Una intervención que no detenía la máquina pasa a detenerla

`[PROPUESTA]` Se registra "la máquina se detuvo" con fecha y hora, lo que **abre un período** y recalcula la máquina. Queda en la auditoría. Es el mismo mecanismo que se usa al crear una falla con máquina detenida.

### 4.6 Ejemplos

**Ejemplo 1 — el caso planteado `[APROBADO]`**

| Momento | Evento | Períodos abiertos | Estado de la máquina |
| :-- | :--- | :--- | :--- |
| 08:00 | Intervención **A** (motor): máquina detenida | A | `DETENIDA` |
| 08:30 | Intervención **B** (iluminación): sigue funcionando | A | `DETENIDA` |
| 09:00 | Se resuelve y finaliza **B** | A | `DETENIDA` (A todavía impide) |
| 10:00 | A pasa a `EN_PROCESO` | A | `EN_MANTENIMIENTO` |
| 13:00 | A finalizada; se confirma que la máquina funciona | ninguno | `OPERATIVA` |

**Ejemplo 2 — dos intervenciones que detienen**

| Momento | Evento | Períodos abiertos | Estado |
| :-- | :--- | :--- | :--- |
| 08:00 | A detiene la máquina | A | `DETENIDA` |
| 10:00 | B detiene la máquina (otra causa) | A, B | `DETENIDA` |
| 12:00 | Se finaliza A y se confirma su recuperación | B | `DETENIDA` |
| 14:00 | Se finaliza B y se confirma | ninguno | `OPERATIVA` |

**Ejemplo 3 — finalización administrativa sin recuperación `[APROBADO]`**

| Momento | Evento | Períodos abiertos | Estado |
| :-- | :--- | :--- | :--- |
| 08:00 | A detiene la máquina | A | `DETENIDA` |
| 11:00 | A se finaliza administrativamente; "máquina NO recuperada" | A (intervención `FINALIZADA`) | `DETENIDA` |
| Día siguiente 09:00 | "Confirmar recuperación" | ninguno | `OPERATIVA` |

**Ejemplo 4 — reapertura `[APROBADO]`**

| Momento | Evento | Períodos | Estado |
| :-- | :--- | :--- | :--- |
| 08:00 | A detiene la máquina | A#1 abierto | `DETENIDA` |
| 12:00 | A finalizada y recuperación confirmada | A#1 cerrado (08:00–12:00) | `OPERATIVA` |
| 15:00 | Falla de nuevo: se reabre A y la máquina vuelve a detenerse | A#2 abierto | `DETENIDA` |
| 17:00 | A finalizada y confirmada | A#2 cerrado (15:00–17:00) | `OPERATIVA` |

Inactividad atribuible a A = 4 h + 2 h = 6 h. El hueco 12:00–15:00 **no** cuenta.

**Ejemplo 5 — concurrencia**

Dos responsables finalizan A y B casi al mismo tiempo, ambas confirmando. Sin coordinación cada transacción vería a la otra como "aún abierta" y la máquina quedaría mal. **Regla:** el recálculo bloquea la fila de la máquina durante la transacción para que se ejecuten en serie (5.3).

---

## 5. Estados y transiciones de la intervención

### 5.1 Resumen

```text
          (creación)
              │
              ▼
        ┌───────────┐   iniciar    ┌────────────┐  finalizar   ┌────────────┐
        │ PENDIENTE │────────────▶│ EN_PROCESO │─────────────▶│ FINALIZADA │
        └───────────┘              └────────────┘◀─────────────└────────────┘
          │   │                     │   ▲  │         reabrir
          │   │  "Resolver ahora"   │   │  │
          │   └──────────────────────────────────────────────▶ FINALIZADA
          │                         ▼   │  │
          │                  ┌─────────────────────┐
          │                  │ EN_ESPERA_REPUESTOS │
          │                  └─────────────────────┘
          │                            │
          ▼                            ▼
        ┌───────────┐ ◀────────  cancelar (desde estados abiertos)
        │ CANCELADA │
        └───────────┘                (terminal)
```

`FINALIZADA` ya **no** es terminal: admite reapertura `[APROBADO]` y correcciones de datos. `CANCELADA` es terminal.

### 5.2 Tabla de transiciones

Los permisos nombrados son los de la sección 8.3.

| # | Transición | Quién (permiso) | Validaciones | Qué se registra | Efecto en la máquina | Otras intervenciones abiertas |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- |
| T0 | *(creación)* → `PENDIENTE` | `INTERVENCIONES_CREAR` | Máquina activa; descripción no vacía; estado operativo informado. | Usuario, fecha, fila inicial de historial (`NULL → PENDIENTE`). Si detiene: período de detención con `desde`. Notificación (8.6). | Si detiene → `DETENIDA`. Si no → sin cambios. | Se suma un período; no altera los de otras. |
| T1 | `PENDIENTE` → `EN_PROCESO` | `INTERVENCIONES_CAMBIAR_ESTADO` | Debe haber responsable; si no hay, quien inicia debe tener `INTERVENCIONES_ASIGNARSE` y queda asignado en la misma acción. `fecha_inicio` ≥ creación y ≤ ahora. | Fecha de inicio, usuario, observación (opcional). | Si hay período abierto → `EN_MANTENIMIENTO`. | Independiente. |
| T2 | `PENDIENTE` → `FINALIZADA` ("Resolver ahora") | `INTERVENCIONES_FINALIZAR` | `fecha_inicio` y `fecha_finalizacion` coherentes (inicio ≤ fin ≤ ahora); descripción del trabajo; `ejecucion`; decisión sobre el período abierto. | Dos filas de historial, todo en una transacción. | Según 4.4. | No afecta a otras. |
| T3 | `PENDIENTE` → `CANCELADA` | `INTERVENCIONES_CANCELAR` | **Motivo obligatorio.** Decisión sobre el período abierto. | Motivo (en el historial), usuario, fecha. | Según 4.4. | Ídem. |
| T4 | `EN_PROCESO` → `EN_ESPERA_REPUESTOS` | `INTERVENCIONES_CAMBIAR_ESTADO` | Observación obligatoria (qué se espera). | Observación, usuario, fecha. | El período **sigue abierto**; la máquina pasa de `EN_MANTENIMIENTO` a `DETENIDA` si ninguna otra impediente está `EN_PROCESO`. | Si otra está `EN_PROCESO`, la máquina sigue `EN_MANTENIMIENTO`. |
| T5 | `EN_ESPERA_REPUESTOS` → `EN_PROCESO` | `INTERVENCIONES_CAMBIAR_ESTADO` | Observación recomendada. Si se asocian repuestos, deben existir en stock (etapa de repuestos). | Observación, usuario, fecha. | Si hay período abierto → `EN_MANTENIMIENTO`. | Independiente. |
| T6 | `EN_PROCESO` → `FINALIZADA` | `INTERVENCIONES_FINALIZAR` | `fecha_finalizacion` ≥ `fecha_inicio` y ≤ ahora; descripción del trabajo; `ejecucion`; renglones de costo válidos; decisión sobre el período abierto. | Fecha de fin, usuario, observaciones; cierre del período si se confirma. | Según 4.4. **Nunca** `OPERATIVA` si queda otro período abierto. | Se recalcula con todas las de la máquina. |
| T7 | `EN_PROCESO` → `CANCELADA` | `INTERVENCIONES_CANCELAR` | Motivo obligatorio. Lo ya cargado (trabajo, tiempos, costos) **se conserva**. | Motivo, usuario, fecha. | Según 4.4. | Ídem. |
| T8 | `EN_ESPERA_REPUESTOS` → `CANCELADA` | `INTERVENCIONES_CANCELAR` | Motivo obligatorio. | Ídem. | Según 4.4. | Ídem. |
| T9 | `FINALIZADA` → `EN_PROCESO` ("Reabrir") | `INTERVENCIONES_REABRIR` | **Motivo obligatorio.** La intervención no debe estar eliminada. | Motivo, usuario, fecha; `fecha_finalizacion` se limpia y su valor anterior queda en la auditoría. | Si el período seguía abierto, continúa. Si estaba cerrado y la máquina volvió a detenerse, se abre un **período nuevo** (se indica `desde`). Se recalcula la máquina. | Independiente. |

**Transiciones no permitidas:**

- `CANCELADA` → cualquier otro estado. Si se canceló por error, se registra una nueva intervención. `[PROPUESTA]`
- `EN_PROCESO` → `PENDIENTE`. Para devolver el trabajo se **reasigna** o se quita el responsable. `[PROPUESTA]`
- `EN_ESPERA_REPUESTOS` → `FINALIZADA` directo: primero se vuelve a `EN_PROCESO`. `[PROPUESTA]`
- `FINALIZADA` → `PENDIENTE` o `EN_ESPERA_REPUESTOS`: la reapertura siempre va a `EN_PROCESO`. `[PROPUESTA]`

### 5.3 Atomicidad y consistencia `[APROBADO]`

Todo cambio de estado debe cumplir **simultáneamente**:

1. Cambiar el estado de la intervención.
2. Insertar la fila en `historial_estados_intervencion` (usuario, fecha, observación).
3. Abrir o cerrar el período de detención (si corresponde).
4. Recalcular y, si cambia, actualizar el estado de la máquina, registrando ese cambio.
5. Generar las notificaciones correspondientes (8.6).

Todo en **una única transacción**: o se completa todo, o no se guarda nada.

- Conexión dedicada con `BEGIN` / `COMMIT` / `ROLLBACK`, no consultas sueltas del pool.
- Se **bloquea la fila de la intervención** y la **de la máquina** mientras dura la transacción.
- La actualización verifica que el estado actual sea el esperado; si otro usuario ya lo cambió, se rechaza con un error claro.
- El historial **nunca** se inserta fuera de esa transacción.

### 5.4 Correcciones de intervenciones finalizadas `[APROBADO]`

- Solo usuarios con `INTERVENCIONES_CORREGIR`, con motivo **obligatorio**.
- Se conserva: campo, valor anterior, valor nuevo, motivo, usuario y fecha (`intervencion_auditoria`, sección 10).
- Una corrección de fechas recalcula tiempos e inactividad.
- Una corrección **no** cambia el estado ni el historial de estados original.
- **Corregir** (datos mal cargados) y **reabrir** (el trabajo no resolvió el problema) son acciones distintas, con permisos distintos.

---

## 6. Reglas de negocio definitivas

### 6.1 Registro y asignación

| ID | Regla | Origen |
| :-: | :--- | :--- |
| RN-01 | Un aviso de falla y una intervención correctiva son el mismo registro. | `[APROBADO]` |
| RN-02 | Al informar una falla se crea una intervención `CORRECTIVO` / `PENDIENTE`. | `[APROBADO]` |
| RN-03 | Usuario creador y fecha de creación se registran automáticamente. | `[APROBADO]` / `[TESIS]` |
| RN-04 | La asignación de responsable no es obligatoria al crear ni para permanecer `PENDIENTE`. Sí lo es para pasar a `EN_PROCESO`. | `[APROBADO]` / `[PROPUESTA]` (condición) |
| RN-05 | El formulario de falla solo pide máquina, descripción y estado operativo en que quedó. | `[APROBADO]` |
| RN-06 | Asignar un responsable **no** implica que el trabajo haya comenzado. | `[APROBADO]` |
| RN-07 | Un usuario autorizado puede asignarse la intervención, asignarla a otro usuario habilitado o modificar la asignación. Cada cambio se registra. | `[APROBADO]` / trazabilidad `[PROPUESTA]` |
| RN-08 | Un usuario "habilitado" para recibir asignaciones es el que tiene el permiso correspondiente y está activo. | `[PROPUESTA]` |

### 6.2 Estado de la máquina

| ID | Regla | Origen |
| :-: | :--- | :--- |
| RN-09 | Si la falla informa "máquina detenida", la máquina pasa automáticamente a `DETENIDA`. | `[APROBADO]` |
| RN-10 | Si informa "continúa funcionando", esa intervención no detiene la máquina. | `[APROBADO]` |
| RN-11 | Una máquina puede tener varias intervenciones abiertas a la vez. | `[APROBADO]` |
| RN-12 | El estado de la máquina nunca se determina por la última intervención modificada, sino evaluando **todos** los períodos de detención abiertos. | `[APROBADO]` |
| RN-13 | Ninguna intervención individual puede establecer `OPERATIVA` si otra causa sigue manteniendo inoperativa la máquina. | `[APROBADO]` |
| RN-14 | Una intervención puede finalizar administrativamente sin que la máquina haya recuperado el funcionamiento. | `[APROBADO]` |
| RN-15 | `OPERATIVA` solo se alcanza al **confirmar explícitamente** la recuperación del último período abierto. | `[APROBADO]` (criterio) / mecanismo `[PROPUESTA]` |
| RN-16 | No se agregan estados nuevos de máquina. | `[PROPUESTA]` |
| RN-17 | `FUERA_DE_SERVICIO` solo se asigna o retira manualmente, con permiso y registro. | `[PROPUESTA]` |
| RN-18 | Una intervención que no detenía la máquina puede pasar a detenerla: se abre un período con fecha y hora. | `[PROPUESTA]` |
| RN-19 | Finalizar, cancelar o eliminar una intervención con período abierto exige decidir explícitamente si se libera. | `[PROPUESTA]` |
| RN-20 | Una intervención tiene como máximo un período abierto a la vez. | `[PROPUESTA]` |

### 6.3 Eliminación, cancelación, finalización y reapertura

| ID | Regla | Origen |
| :-: | :--- | :--- |
| RN-21 | **Eliminación lógica:** solo para registros creados por error, **sin trabajo, tiempo ni gastos**. Se quitan de las listas habituales. | `[APROBADO]` |
| RN-22 | La eliminación lógica conserva quién, cuándo y motivo. | `[APROBADO]` |
| RN-23 | **Cancelación:** para lo que no corresponde ejecutar; el motivo es obligatorio. | `[APROBADO]` |
| RN-24 | Toda intervención con trabajo efectivo, tiempo o gastos se conserva y **no puede eliminarse**. | `[APROBADO]` |
| RN-25 | Una falla resuelta en minutos queda registrada como `FINALIZADA`. | `[APROBADO]` |
| RN-26 | Criterio de "sin actividad relevante" para eliminar: estado `PENDIENTE`; sin `fecha_inicio`; sin renglones de costo; sin repuestos asociados; sin movimientos de stock; sin documentos; historial solo con la fila inicial. | `[PROPUESTA]` |
| RN-27 | La eliminación **física** de intervenciones no está permitida desde la aplicación. | `[PROPUESTA]` |
| RN-28 | Una `FINALIZADA` o `CANCELADA` no puede eliminarse lógicamente. | `[PROPUESTA]` |
| RN-29 | Una `FINALIZADA` puede reabrirse (a `EN_PROCESO`) con permiso y motivo; una `CANCELADA` no. | `[APROBADO]` (reapertura) |
| RN-30 | Al reabrir se conservan tiempos, costos, repuestos e historial; la fecha de fin anterior queda en la auditoría. | `[PROPUESTA]` |

### 6.4 Fechas, tiempos y correcciones

| ID | Regla | Origen |
| :-: | :--- | :--- |
| RN-31 | Se registran fecha y hora de creación, de inicio del trabajo y de finalización. | `[APROBADO]` |
| RN-32 | Se calculan automáticamente: espera hasta comenzar, duración del trabajo y tiempo total. | `[APROBADO]` |
| RN-33 | Esos tiempos son **distintos** de la inactividad real de la máquina. | `[APROBADO]` |
| RN-34 | Los usuarios autorizados pueden corregir fechas o duraciones cargadas incorrectamente, **justificando** el cambio. | `[APROBADO]` |
| RN-35 | Toda corrección registra quién, valor anterior, valor nuevo, motivo y fecha. | `[APROBADO]` |
| RN-36 | Coherencia: `fecha_inicio` ≥ `fecha_creacion`; `fecha_finalizacion` ≥ `fecha_inicio`; períodos con `hasta` ≥ `desde`; ninguna fecha en el futuro. | `[PROPUESTA]` |
| RN-37 | Para estar `FINALIZADA` son obligatorias `fecha_inicio` y `fecha_finalizacion`. | `[PROPUESTA]` (D-05) |
| RN-38 | `fecha_creacion` es la fecha de registro del sistema; solo se corrige con permiso y justificación. | `[PROPUESTA]` |
| RN-39 | La inactividad se **calcula** desde los períodos de detención; no se tipea. | `[PROPUESTA]` |

### 6.5 Costos y ejecución

| ID | Regla | Origen |
| :-: | :--- | :--- |
| RN-40 | Los costos se calculan automáticamente cuando es posible. | `[APROBADO]` |
| RN-41 | El costo de repuestos proviene **exclusivamente** de los repuestos efectivamente usados (`cantidad × costo_unitario_aplicado`). | `[APROBADO]` / `[TESIS]` |
| RN-42 | Un responsable autorizado puede agregar gastos adicionales o ajustes justificados. | `[APROBADO]` |
| RN-43 | El total se actualiza automáticamente incorporando esos conceptos. | `[APROBADO]` |
| RN-44 | Nunca se sobrescribe un importe calculado sin conservar su origen: lo manual son **renglones separados**. | `[APROBADO]` (criterio) / mecanismo `[PROPUESTA]` |
| RN-45 | La mano de obra es un renglón de costo (tipo `MANO_OBRA`). | `[APROBADO]` (A7) |
| RN-46 | Los repuestos **no** se cargan como renglón manual, para no duplicarlos (M-RF-11). | `[TESIS]` / `[PROPUESTA]` |
| RN-47 | Un renglón no puede ser negativo, salvo el tipo `AJUSTE`; el total de la intervención nunca puede ser negativo. | `[PROPUESTA]` |
| RN-48 | Un renglón no se borra ni se edita: se **anula** con motivo y, si corresponde, se agrega uno nuevo. | `[PROPUESTA]` |
| RN-49 | Cada intervención indica si se ejecutó con personal `INTERNA` o `EXTERNA`. | `[APROBADO]` (A4) |
| RN-50 | La ejecución es obligatoria para finalizar y se puede corregir con justificación. | `[PROPUESTA]` (D-11) |

### 6.6 Permisos y notificaciones

| ID | Regla | Origen |
| :-: | :--- | :--- |
| RN-51 | El administrador configura qué puede hacer y qué información puede consultar cada usuario. | `[APROBADO]` |
| RN-52 | Los perfiles iniciales tienen permisos **modificables**. | `[APROBADO]` |
| RN-53 | Se pueden personalizar permisos por perfil y, cuando corresponda, por usuario. | `[APROBADO]` / `[TESIS]` |
| RN-54 | Se distinguen **permisos de acción** y **alcance de visibilidad** (propias / sectores autorizados / toda la empresa). | `[APROBADO]` |
| RN-55 | Los usuarios comunes no pueden otorgarse permisos a sí mismos. | `[APROBADO]` |
| RN-56 | Los permisos se evalúan contra la base de datos en cada solicitud, no solo contra el token. | Ya implementado |
| RN-57 | Nadie otorga un permiso que no posee ni modifica su propio perfil u overrides; debe quedar al menos un administrador activo. | `[PROPUESTA]` |
| RN-58 | Toda modificación de perfiles, permisos o accesos se registra. | `[PROPUESTA]` |
| RN-59 | Los eventos relevantes generan notificaciones dentro de la misma transacción que los provoca. | `[APROBADO]` (A6) / mecanismo `[PROPUESTA]` |
| RN-60 | Quién recibe cada notificación depende de permisos y alcance configurables, no de listas fijas. | `[PROPUESTA]` |

---

## 7. Cálculo de tiempos y costos

### 7.1 Tiempos de gestión (se calculan, no se cargan) `[APROBADO]`

| Indicador | Fórmula | Observación |
| :--- | :--- | :--- |
| **Espera hasta comenzar** | `fecha_inicio − fecha_creacion` | Mientras siga `PENDIENTE`, se muestra el tiempo transcurrido hasta ahora. |
| **Duración del trabajo** | `fecha_finalizacion − fecha_inicio` | Bruta: incluye esperas de repuestos y, si hubo reapertura, el tiempo entre finalización y reapertura. |
| **Tiempo total** | `fecha_finalizacion − fecha_creacion` | Espera + trabajo. |

`[PROPUESTA]` **Duración neta** = tiempo acumulado en `EN_PROCESO`, calculado desde el historial. Excluye esperas de repuestos y huecos de reapertura (D-06).

`[PROPUESTA]` Los valores se **calculan al consultar** desde las fechas; no se guardan duplicados que puedan desincronizarse.

`[PROPUESTA]` Los reportes por **ejecución** (como la planilla del Anexo A.1) toman la duración del trabajo agrupada por `INTERNA` / `EXTERNA`.

### 7.2 Inactividad real de la máquina `[APROBADO]` (criterio) / `[PROPUESTA]` (cálculo)

Es el tiempo que la máquina estuvo realmente sin poder operar. Puede ser menor que la duración de la intervención, mayor (espera previa al inicio) o nula.

1. Cada **período de detención** tiene `desde` y `hasta` (si sigue abierto, hasta el momento de la consulta).
2. **Inactividad atribuible a una intervención** = suma de las duraciones de sus períodos.
3. **Inactividad real de una máquina en un intervalo** = **unión** de todos sus períodos dentro del intervalo, **sin contar dos veces los solapamientos**.

| Intervención | Detención | Duración individual |
| :--- | :--- | :--- |
| A | 08:00 – 12:00 | 4 h |
| B | 10:00 – 14:00 | 4 h |
| **Inactividad real de la máquina** | 08:00 – 14:00 (unión) | **6 h** (no 8 h) |

- Para reportes por máquina se usa siempre la **unión**. Sumar por intervención duplicaría el solapamiento.
- Al ser una tabla de períodos, la consulta por máquina es directa; PostgreSQL puede resolverlo con rangos (`tstzrange`, `range_agg`) o fusionando intervalos ordenados.
- `desde` por defecto es la fecha de creación del aviso. `[PROPUESTA]` Es corregible con justificación si la máquina se detuvo antes de informarse.
- Las horas de `FUERA_DE_SERVICIO` **no** se cuentan como inactividad por falla `[PROPUESTA]` (D-07).
- `tiempo_inactividad_minutos` no se tipea: se completa automáticamente al cerrar un período o corregir sus fechas (D-08).

### 7.3 Costos `[APROBADO]` (criterio) / `[PROPUESTA]` (mecanismo)

```text
Costo total =  Repuestos           (automático: suma cantidad × costo_unitario_aplicado)
             + Renglones de costo  (MANO_OBRA, SERVICIO_EXTERNO, TRANSPORTE, OTRO, AJUSTE; no anulados)
```

| Componente | Origen | ¿Editable? |
| :--- | :--- | :--- |
| Repuestos | Automático desde `intervencion_repuestos` | No se escribe a mano. |
| Mano de obra | Renglón `MANO_OBRA` cargado por un responsable autorizado `[APROBADO]` | Se anula y se agrega otro; no se edita. |
| Servicio externo, transporte, otros | Renglones con tipo, descripción, importe, motivo, usuario y fecha | Ídem. |
| Ajustes | Renglón `AJUSTE`, positivo o negativo | Ídem. |

`[PROPUESTA]` No hay tarifa por hora definida en la tesis ni en el modelo, así que el importe de mano de obra se carga a mano (es lo que refleja la planilla del Anexo A.1). Calcular horas × tarifa queda como mejora futura.

Ejemplo:

| Concepto | Importe | Origen |
| :--- | ---: | :--- |
| Repuestos (2 rodamientos) | 18.000 | Automático |
| Mano de obra interna | 25.000 | Renglón `MANO_OBRA` |
| Flete urgente | 4.500 | Renglón `TRANSPORTE` — "desde proveedor" |
| Ajuste por descuento posterior | −1.000 | Renglón `AJUSTE` — "descuento acordado" |
| **Total** | **46.500** | Calculado |

- `[PROPUESTA]` El total se **recalcula siempre**. Las columnas actuales `costo_mano_obra`, `costo_repuestos` y `costo_total_estimado` pasan a ser **valores de lectura** actualizados en cada transacción, o se calculan solo al consultar (D-08).
- `[PROPUESTA]` Con la intervención `FINALIZADA`, agregar o anular renglones requiere además `INTERVENCIONES_CORREGIR`.

### 7.4 Correcciones de fechas y duraciones `[APROBADO]`

- `[PROPUESTA]` Como duración e inactividad **derivan de las fechas**, corregir una duración equivale a corregir las fechas involucradas.
- Cada corrección exige motivo y registra usuario, fecha, campo, valor anterior y nuevo.
- Se vuelven a validar las reglas de coherencia (RN-36).

---

## 8. Gestión configurable de permisos y notificaciones

### 8.1 Dos conceptos distintos `[APROBADO]`

| Concepto | Pregunta | Ejemplos |
| :--- | :--- | :--- |
| **Permiso de acción** | *¿Qué puede hacer?* | crear, ver, modificar, asignar, finalizar, cancelar, reabrir, corregir. |
| **Alcance de visibilidad** | *¿Sobre qué registros?* | **propias**, **sectores autorizados**, **toda la empresa**. |

### 8.2 Capas de configuración `[PROPUESTA]`

1. **Perfil** (base): permisos con su alcance.
2. **Excepción por usuario** (opcional): *concede* o *deniega* un permiso concreto, con alcance, motivo y quién lo otorgó.

**Resolución del permiso efectivo:**

1. Se parte de los permisos del perfil.
2. Se aplican las excepciones: una **denegación** elimina el permiso; una **concesión** lo agrega o ajusta su alcance.
3. **La denegación prevalece** en caso de conflicto.
4. Si el alcance es "sectores autorizados", se usa la lista de sectores asignados al usuario.

Se evalúa en cada solicitud contra la base de datos. El middleware actual solo considera permisos del perfil y debería ampliarse.

### 8.3 Catálogo de permisos propuesto `[PROPUESTA]`

**Referencias:** ✓ = concedido · — = no concedido · P = propias · S = sectores autorizados · T = toda la empresa.

| Permiso | Acción | Alcance aplicable | Operario | Resp. mant. | Admin | Consulta |
| :--- | :--- | :-: | :-: | :-: | :-: | :-: |
| `INTERVENCIONES_VER` | Ver intervenciones y su estado | Sí | P | T | T | T |
| `INTERVENCIONES_CREAR` | Registrar fallas / intervenciones | Sí (máquinas/sectores) | ✓ | ✓ | ✓ | — |
| `INTERVENCIONES_ASIGNARSE` | Asignarse una intervención | No | — | ✓ | ✓ | — |
| `INTERVENCIONES_ASIGNAR` | Asignar o reasignar a otros | No | — | ✓ | ✓ | — |
| `INTERVENCIONES_RECIBIR_ASIGNACION` | Poder ser designado responsable | No | — | ✓ | ✓ | — |
| `INTERVENCIONES_CAMBIAR_ESTADO` | Iniciar, pasar a espera de repuestos | No | — | ✓ | ✓ | — |
| `INTERVENCIONES_EDITAR` | Modificar datos técnicos del trabajo | No | — | ✓ | ✓ | — |
| `INTERVENCIONES_FINALIZAR` | Finalizar | No | — | ✓ | ✓ | — |
| `INTERVENCIONES_CANCELAR` | Cancelar | No | — | ✓ | ✓ | — |
| `INTERVENCIONES_ELIMINAR` | Eliminación lógica | No | — | ✓ | ✓ | — |
| `INTERVENCIONES_REABRIR` | Reabrir una finalizada | No | — | ✓ | ✓ | — |
| `INTERVENCIONES_CORREGIR` | Corregir fechas/datos de finalizadas | No | — | — | ✓ | — |
| `INTERVENCIONES_CONFIRMAR_RECUPERACION` | Confirmar que la máquina puede funcionar | No | — | ✓ | ✓ | — |
| `COSTOS_VER` | Ver costos | Sí | — | T | T | T |
| `COSTOS_REGISTRAR` | Renglones de costo (mano de obra, adicionales, ajustes) | No | — | ✓ | ✓ | — |
| `MAQUINAS_CAMBIAR_ESTADO` | Cambio manual de estado (incl. `FUERA_DE_SERVICIO`) | No | — | ✓ | ✓ | — |
| `NOTIFICACIONES_FALLAS_RECIBIR` | Recibir avisos de fallas nuevas | Sí | — | S/T | T | — |
| `PERMISOS_GESTIONAR` | Configurar perfiles, permisos y accesos | No | — | — | ✓ | — |
| *(existentes)* `USUARIOS_GESTIONAR`, `MAQUINAS_GESTIONAR`, `REPUESTOS_GESTIONAR`, `PLANES_GESTIONAR`, `DOCUMENTOS_GESTIONAR`, `REPORTES_CONSULTAR` | Sin cambios de significado | — | según 001 | según 001 | todos | `REPORTES_CONSULTAR` |

Notas:

- `INTERVENCIONES_GESTIONAR` se **reemplaza** por los permisos granulares. Los perfiles que lo tienen reciben el conjunto equivalente para no perder funciones.
- `[APROBADO]` El operario por defecto **no** asigna, finaliza ni modifica trabajos técnicos; con autorización específica puede hacerlo.
- "Propias" = intervenciones **creadas por** el usuario **o asignadas a** él (D-03).
- `COSTOS_VER` separa la **información** consultable; los operarios no ven costos por defecto (D-04). La tesis sí prevé costos para Dirección / I+D.

### 8.4 Qué falta en el modelo actual

| Necesidad | Por qué hoy no se puede |
| :--- | :--- |
| Alcance de visibilidad | `perfil_permiso` solo tiene `perfil_id` y `permiso_id`. |
| Permisos personalizados por usuario | No existe relación usuario ↔ permiso. |
| "Sectores autorizados" | No existe relación usuario ↔ sector. |
| Granularidad de acciones | El catálogo es grueso. |
| Auditoría de cambios de permisos | No hay registro alguno. |

### 8.5 Protecciones contra auto-otorgamiento `[APROBADO]` / `[PROPUESTA]`

- Solo `PERMISOS_GESTIONAR` modifica perfiles, permisos o excepciones.
- Nadie modifica **sus propias** excepciones ni su perfil `[PROPUESTA]` (D-16).
- Nadie otorga un permiso (ni un alcance mayor) que no posee `[PROPUESTA]`.
- No se desactiva ni degrada al último administrador activo `[PROPUESTA]`.
- La verificación es en el servidor, nunca solo en la interfaz.
- Todo cambio queda en una auditoría de permisos `[PROPUESTA]`.

### 8.6 Notificaciones desde la primera versión `[APROBADO]` (A6)

La tesis prevé avisos configurables (RF-15) y un paquete Notificaciones. El alcance concreto es una `[PROPUESTA]` a aprobar (D-10):

| Evento | Destinatarios | Prioridad |
| :--- | :--- | :--- |
| **Falla nueva** | Usuarios con `NOTIFICACIONES_FALLAS_RECIBIR` cuyo alcance incluya la máquina o su sector | **Alta** si detiene la máquina; normal si no |
| **Intervención asignada o reasignada** | El nuevo responsable | Normal |
| **Intervención finalizada, cancelada o reabierta** | Creador y responsable | Normal |
| **Finalizada sin recuperación** (período aún abierto, E7) | Usuarios con `INTERVENCIONES_CONFIRMAR_RECUPERACION` | Alta |

Mecanismo `[PROPUESTA]`:

- **Bandeja dentro de la aplicación** (campana con contador y lista). Otros canales (correo, WhatsApp, push) quedan para decidir (D-10).
- La notificación se crea **en la misma transacción** que el evento (RN-59), así nunca se pierde ni se genera sin que el evento haya ocurrido.
- Los destinatarios se calculan desde **permisos y alcance** (RN-60): no hay listas fijas.
- Recordatorios por tiempo (por ejemplo "pendiente sin asignar hace más de X horas") y avisos de vencimientos de preventivos quedan para una etapa posterior; hace falta definir los umbrales.
- Complemento sin costo: una **vista "Sin asignar"** que ordena primero las fallas con máquina detenida.

---

## 9. Evaluación del modelo de datos existente

Base: `001_initial_schema.sql` y `002_integrity_constraints.sql` (ya preparada).

> **Conclusión:** el modelo actual **no es suficiente** para implementar las decisiones. Cubre bien la base (historial de estados, separación creador/responsable, restricciones de costos y fechas), pero faltan atributos y relaciones para varias reglas fundamentales.

### 9.1 Verificación de capacidades pedidas

| Capacidad | ¿Se puede hoy? | Detalle |
| :--- | :-: | :--- |
| Determinar qué intervenciones mantienen detenida una máquina | **No** | No hay forma de saber si una intervención detiene la máquina ni si el impedimento sigue vigente. `maquinas.estado` es un valor global sin causa asociada. |
| Registrar cuándo recuperó su funcionamiento | **No** | No hay historial de estados de máquina ni fecha/usuario de confirmación. `fecha_finalizacion` indica fin del trabajo, no recuperación. |
| Calcular tiempos de inactividad | **Parcial** | Solo `tiempo_inactividad_minutos` (número manual, sin períodos ni origen). No permite unión ni evitar doble conteo. |
| Registrar costos adicionales | **No** | `costo_total_estimado` es un número editable; no hay renglones, motivo ni origen. |
| Registrar interno / externo | **No** | No hay atributo. |
| Conservar eliminaciones | **No** | No hay eliminación lógica. Además `historial_estados_intervencion`, `intervencion_repuestos` y `documentos` tienen `ON DELETE CASCADE`: **borrar físicamente una intervención destruiría su historial**. |
| Conservar correcciones y reaperturas | **No** | Solo existe `actualizado_en`. |
| Trazabilidad de asignaciones | **No** | `responsable_usuario_id` se sobrescribe sin rastro. |
| Notificaciones | **No** | No existe ninguna tabla. |
| Permisos personalizados por usuario | **No** | Solo perfil → permisos. |
| Alcance de visibilidad | **No** | Falta el atributo en `perfil_permiso` y la relación usuario ↔ sectores. |

### 9.2 Evaluación tabla por tabla

| Tabla | Cubre | Falta / observaciones |
| :--- | :--- | :--- |
| `intervenciones` | Máquina, tipo, creador, responsable opcional, estado, fechas de creación/inicio/fin, costos básicos, restricciones de fechas y costos. | `ejecucion`. Eliminación lógica. Sin `CHECK` que exija fechas para `FINALIZADA`. `costo_mano_obra`, `costo_repuestos`, `costo_total_estimado` y `tiempo_inactividad_minutos` deben pasar a valores derivados. |
| `historial_estados_intervencion` | Estado anterior/nuevo, usuario, observación, fecha; fila inicial con anterior `NULL`. Sirve también para reabrir. | Observación no obligatoria para `CANCELADA`. `ON DELETE CASCADE` riesgoso. No registra asignaciones ni correcciones. |
| `maquinas` | Estado con `CHECK` de cuatro valores; vínculo con sector. | Sin historial de cambios de estado ni causa. No tiene `codigo` (que sí figura en el diagrama de clases de la tesis). |
| `usuarios` | Legajo único, perfil, activo. | Falta la relación con sectores autorizados. |
| `perfiles` | Perfiles iniciales y `activo`. | Suficiente. |
| `permisos` | Catálogo con código único. | Catálogo grueso: ampliar con permisos granulares (solo datos). |
| `perfil_permiso` | Relación perfil ↔ permiso. | Falta **alcance**. |
| `intervencion_repuestos` | Cantidad y costo unitario aplicado (histórico, como pide la tesis). | Sin usuario que registró ni anulación (se trata en la etapa de repuestos). |

### 9.3 Lo que sí está bien resuelto

- `historial_estados_intervencion` soporta la trazabilidad de estados y la fila inicial `NULL → PENDIENTE`.
- La distinción `creado_por_usuario_id` / `responsable_usuario_id` (nullable) coincide con el diagrama de clases de la tesis (`responsableLegajo` nullable).
- `CHECK` para estados, fechas coherentes entre inicio y fin, y costos no negativos.
- `intervencion_repuestos.costo_unitario_aplicado` cumple el "costo unitario histórico" de `ConsumoRepuesto`.
- `002_integrity_constraints.sql` garantiza que el plan pertenezca a la misma máquina. Este análisis asume 001 y 002 aplicadas.

---

## 10. Cambios de base de datos propuestos (sin implementar)

> **No se crean ni ejecutan migraciones.** Se aplicarían como migraciones nuevas, probadas solo en una rama temporal de Neon, nunca directamente en producción.

### 10.1 Cambios en tablas existentes

| # | Tabla | Cambio | Justificación |
| :-: | :--- | :--- | :--- |
| C1 | `intervenciones` | `ejecucion` (`INTERNA` / `EXTERNA`, nulo hasta definirse) con `CHECK` | Distinguir mantenimiento interno y externo (A4). |
| C2 | `intervenciones` | `eliminado_en`, `eliminado_por_usuario_id`, `motivo_eliminacion` | Eliminación lógica con trazabilidad mínima. |
| C3 | `intervenciones` | `CHECK`: `FINALIZADA` exige `fecha_inicio` y `fecha_finalizacion` | Respalda RN-37 (sujeto a D-05). |
| C4 | `intervenciones` | `costo_mano_obra`, `costo_repuestos`, `costo_total_estimado` y `tiempo_inactividad_minutos`: se mantienen como **valores derivados** actualizados por la aplicación (nunca tipeados), o se retiran más adelante | Evitar fuentes de verdad duplicadas (D-08). No se agregan columnas. |
| C5 | `historial_estados_intervencion` | `CHECK`: si `estado_nuevo = 'CANCELADA'`, la observación no puede estar vacía | Refuerza en BD el motivo obligatorio. |
| C6 | `historial_estados_intervencion`, `intervencion_repuestos`, `documentos` | `ON DELETE CASCADE` hacia `intervenciones` pasa a `RESTRICT` | Impedir que un borrado físico accidental destruya el historial. |
| C7 | `perfil_permiso` | `alcance` (`PROPIAS` / `SECTORES` / `TODAS`, por defecto `TODAS`) | Separar permiso de acción y alcance. |

Observación: **ya no** se agregan `detiene_maquina`, `detencion_desde`, `detencion_hasta` ni confirmador a `intervenciones`; esa información vive en la tabla de períodos (N2).

### 10.2 Tablas nuevas

| # | Tabla | Contenido mínimo | Justificación |
| :-: | :--- | :--- | :--- |
| N1 | `historial_estados_maquina` | máquina, estado anterior, estado nuevo, intervención de origen (opcional), motivo, usuario, fecha | Único lugar donde queda cuándo y por qué cambió el estado de una máquina (incluidos los cambios manuales como `FUERA_DE_SERVICIO`). |
| N2 | `intervencion_periodos_detencion` | intervención, `desde`, `hasta` (nulo = vigente), abierto por, confirmado por, observación. `CHECK hasta ≥ desde`; **índice único parcial** que permite un solo período abierto por intervención; índice parcial de períodos abiertos por máquina | Saber qué intervenciones mantienen detenida una máquina, cuándo se confirmó la recuperación y calcular la inactividad por unión de períodos (A1). Alineado con `RegistroTiempo` de la tesis. |
| N3 | `intervencion_auditoria` | intervención, tipo de evento (`ASIGNACION`, `CORRECCION_FECHA`, `CORRECCION_COSTO`, `ELIMINACION_LOGICA`, `REAPERTURA`, etc.), campo, valor anterior, valor nuevo, motivo, usuario, fecha | Una sola tabla de trazabilidad para cambios que no son transiciones de estado. |
| N4 | `intervencion_costos` | intervención, tipo (`MANO_OBRA`, `SERVICIO_EXTERNO`, `TRANSPORTE`, `OTRO`, `AJUSTE`), descripción, importe, motivo, registrado por/fecha, anulado por/fecha/motivo (nulos). `CHECK` importe ≥ 0 salvo `AJUSTE`; sin tipo `REPUESTO` | Renglones de costo sin pisar importes calculados; equivale a `CostoIntervencion` de la tesis (A7). |
| N5 | `usuario_permiso` | usuario, permiso, efecto (`CONCEDER` / `DENEGAR`), alcance, motivo, otorgado por, fecha | Excepciones por usuario sobre el perfil. |
| N6 | `usuario_sector` | usuario, sector | Define los "sectores autorizados". |
| N7 | `auditoria_permisos` | quién, sobre quién (usuario o perfil), qué cambió, valores anterior/nuevo, fecha | Trazabilidad de la gestión de permisos. |
| N8 | `notificaciones` | usuario destino, tipo de evento, prioridad, intervención y máquina (opcionales), mensaje, creada en, leída en | Bandeja interna de avisos (A6). |

### 10.3 Cambios diferidos a la etapa de repuestos `[PROPUESTA]`

- `intervencion_repuestos`: agregar usuario que registró y datos de anulación, y definir su relación con `movimientos_stock` al corregir, cancelar o reabrir (D-20).

### 10.4 Alternativas evaluadas y **no** propuestas

| Alternativa | Motivo de descarte |
| :--- | :--- |
| Nuevos estados de máquina (`EN_PRUEBA`, `PENDIENTE_CONFIRMACION`) | Ya se expresa con estado de intervención + período abierto. |
| Columnas de detención en `intervenciones` | Reemplazadas por la tabla de períodos (A1): soportan reaperturas y varias detenciones. |
| Replicar `RegistroTiempo` completo (períodos de TRABAJO e INACTIVIDAD) | No aprobado; las fechas de trabajo quedan en la intervención. Se puede ampliar si se necesita registrar sesiones de trabajo. |
| Estados configurables en tabla | Pospuesto (A2). |
| Tabla separada de "avisos de falla" | Contradice la decisión de un único registro. |
| Persistir tiempos de espera, duración y total | Se derivan de las fechas. |
| Varios perfiles por usuario | Las excepciones por usuario ya cubren esa flexibilidad. |
| Tablas de auditoría separadas por tipo de cambio | Una tabla genérica es más simple. |

### 10.5 Compatibilidad

- Las intervenciones existentes, si hubiera alguna, quedarían sin períodos de detención: su comportamiento no cambia.
- Los permisos actuales se **migran por equivalencia** al catálogo granular, verificados con pruebas antes de aplicarse.
- Antes de cambiar el catálogo hay que revisar qué rutas del backend usan `MAQUINAS_GESTIONAR` y `USUARIOS_GESTIONAR`.

---

## 11. Decisiones que todavía necesitan aprobación

Las decisiones `[APROBADO]` (sección 0.3 y las marcadas en el texto) están cerradas. Para cada punto indico mi recomendación.

| ID | Decisión | Opciones | Recomendación |
| :-: | :--- | :--- | :--- |
| D-01 | **Cómo se confirma la recuperación**: pregunta al finalizar/cancelar/eliminar y acción posterior "Confirmar recuperación" (4.4). Aprobado |
| D-02 | **`DETENIDA` / `EN_MANTENIMIENTO` automático** (en proceso → `EN_MANTENIMIENTO`). | A) automático 
| D-03 | **Definición de "propias"**. | A) creadas o asignadas · B) solo creadas | **A**. |
| D-04 | **Operario sin acceso a costos** por defecto (`COSTOS_VER`). | Sí / No | **Sí**. |
| D-05 | **Fechas obligatorias para finalizar**. | Sí / No | **Sí**. |
| D-06 | **Duración neta** (tiempo en `EN_PROCESO`) además de la bruta. | A) solo bruta · B) bruta + neta | **B**. |
| D-07 | **`FUERA_DE_SERVICIO` en inactividad**: excluir esas horas. | Excluir / Incluir | **Excluir**. |
| D-08 | **Totales derivados**: mantener `costo_*` y `tiempo_inactividad_minutos` como lectura, actualizados en cada transacción, o calcularlos solo al consultar. | A) guardados · B) calculados | **A**. |
| D-09 | **Detalle de la reapertura**: permiso propio `INTERVENCIONES_REABRIR`; limpia `fecha_finalizacion` (queda en auditoría); períodos nuevos solo si la máquina volvió a detenerse; duración bruta cubre el hueco. | Aprobar o ajustar | Aprobar. | El dato se guarda para el calculo correcto de las horas posteiormente
| D-10 | **Alcance de notificaciones**: eventos y destinatarios de 8.6; solo bandeja interna; recordatorios por tiempo y vencimientos de preventivos para después. | A) bandeja interna · B) agregar correo/WhatsApp/push | **A**. | Empezemos por internas, pero deja todo listo para que en un futuro hagamos que mande whatsapp y mail, todo esto tiene que ser configurable como todo el sistema
| D-11 | **Interno/externo**: obligatorio al finalizar; un valor único por intervención (no mixto); sin campo del proveedor externo por ahora. | Aprobar o ajustar | Aprobar; el proveedor puede ir en la descripción o en un renglón `SERVICIO_EXTERNO`. |
| D-12 | **Permisos por defecto del Administrador**. | A) todos · B) solo administración | **A**, configurable. |
| D-13 | **Quién confirma recuperación**: responsables y administradores por defecto; el operario solo por excepción. | Aprobar / permitir al operario | **Aprobar**. |
| D-14 | **Edición por el operario** de su propia falla mientras esté `PENDIENTE` y sin tomar. | Sí / No | **Sí**, con permiso configurable. |
| D-15 | **Alcance al crear fallas**: cualquier máquina o solo las de sus sectores. | A) cualquiera · B) sus sectores | **A**, configurable. |
| D-16 | **Administradores sobre sí mismos**: no pueden modificar sus propios permisos. | No / Sí | **No**; requiere otro administrador. |
| D-17 | **Perfil real de I+D y Dirección**: en el proceso actual coordinan reparaciones y autorizan compras. ¿Usan el perfil Consulta con excepciones, un perfil de Responsable, o un perfil nuevo? Además, ¿el operario puede informar necesidades no correctivas? | Definir | Decidir con GI-RE. |Hagamos tres roles predefinidos, total eso lo va a definir el usuario después dependiendo como se manejan pero por ahora operario, i+d y dirección y el admin
| D-18 | **`codigo` de máquina**: la tesis lo incluye en la clase `Maquina`; la tabla no lo tiene. | Agregarlo (módulo de máquinas) / no | Resolver en el módulo de máquinas. |Agregalo
| D-19 | **Autorización de compra de repuestos** (hoy la da Dirección/I+D): ¿se modela? | A) no, queda en la observación de `EN_ESPERA_REPUESTOS` · B) paso de aprobación | **A** en la primera versión. |
| D-20 | **Stock al cancelar, reabrir o corregir** una intervención con repuestos. | Definir en la etapa de repuestos | Diferir. |
| D-21 | **Actualización de la tesis**: corregir los puntos de 0.4 (necesidad unificada, estados fijos, login, infraestructura, interno/externo, transiciones). | Aprobar la lista | Aprobar. |
| D-22 | **Pruebas**: todas las migraciones se prueban solo en rama temporal de Neon. | Aprobar | **Aprobar**. |

---

## 12. Plan de implementación en etapas pequeñas

**Nada de esto comienza sin aprobación.** Cada etapa es pequeña, se prueba sola y termina en un punto estable. Las migraciones se prueban solo en rama temporal de Neon.

| Etapa | Alcance | Resultado verificable |
| :-: | :--- | :--- |
| **0** | Revisión y aprobación de este documento; respuesta a D-01 a D-22. | Documento v3 aprobado. |
| **1** | **Migración de intervenciones**: C1–C6, N1–N4 (ejecución, eliminación lógica, restricciones, historial de máquina, períodos de detención, auditoría, costos). | Migración probada en rama temporal. |
| **2** | **Permisos granulares**: C7, N5–N7; catálogo ampliado, alcance, excepciones, sectores autorizados; permisos efectivos en el middleware; equivalencia de los actuales. | Pruebas por perfil, por usuario, denegación, alcance y auto-otorgamiento bloqueado. |
| **3** | **Registrar falla y consultar**: crear `CORRECTIVO`/`PENDIENTE` con indicación de detención; listar y ver según alcance; vista "Sin asignar". | Un operario registra y solo ve lo autorizado; la máquina pasa a `DETENIDA` si corresponde. |
| **4** | **Motor de estados atómico**: transiciones T1 a T8, historial, períodos y recálculo de máquina en una transacción, con bloqueos. | Pruebas de ejemplos 1 a 3 y 5 (A/B, dos que detienen, sin recuperación, concurrencia). |
| **5** | **Asignación** con auditoría. | Asignar no inicia el trabajo. |
| **6** | **Finalizar, cancelar, eliminar lógicamente, confirmar recuperación, "Resolver ahora" y reabrir** (T9). | Reglas RN-14, RN-21 a RN-30 y ejemplo 4 verificadas. |
| **7** | **Notificaciones internas**: migración N8, eventos de 8.6 creados en la misma transacción, bandeja. | Cada evento notifica a los destinatarios correctos y a nadie más. |
| **8** | **Tiempos e inactividad**: espera, duración, total, neta; unión de períodos por máquina; agrupación interna/externa. | Casos con solapamientos, reaperturas y sin detención. |
| **9** | **Costos**: renglones, anulaciones, total automático. | Total correcto; importes calculados nunca pisados. |
| **10** | **Correcciones trazables** de intervenciones finalizadas. | Cada corrección deja usuario, motivo y valores. |
| **11** | **Administración de permisos** (API para el administrador). | Configuración sin tocar la base manualmente. |
| **12** | **Repuestos en la intervención** (depende del ABM de repuestos): cambios de 10.3 y costo automático. | El costo de repuestos proviene de los usados. |

Para cada etapa se redactará, antes de programar, un mini-plan con sus pruebas de aceptación, y se avisará antes de tocar cualquier base de datos.

---

## 13. Fuera del alcance de este análisis

- Recordatorios por tiempo y avisos de vencimientos de preventivos (requieren definir umbrales).
- Canales de notificación distintos de la bandeja interna.
- Generación automática de preventivos desde planes.
- Documentos adjuntos, reportes e indicadores en detalle.
- Interfaz visual (depende del handoff visual).
- Integración con SAE (descartada en la primera versión, ver D-003 en `docs/decisiones.md`).
