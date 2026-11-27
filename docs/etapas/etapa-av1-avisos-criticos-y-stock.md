# Etapa AV1 — Avisos de parada crítica y de stock bajo

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** RT1 y el arreglo del email propio, terminados.
> **Origen:**
> - **el profesor, el 18/11:** ante una parada crítica se tienen que enterar enseguida el jefe de compras, el de planta y todos los que intervienen;
> - **GI-RE, el 19/11:** avisos a gerencia, producción, ingeniería y directorio, y "usaste el último filtro, comprá otro";
> - **Andrés, el 24/11:** lo más configurable posible.

**La idea en una línea:** dos avisos nuevos, "Parada crítica" y "Stock bajo". Qué los dispara, quién los recibe y si salen por mail se configura con lo que el sistema ya tiene.

| Qué se configura | Dónde |
| :--- | :--- |
| Qué máquina es crítica | La marca "Prioridad alta" de cada criticidad, en Sectores y catálogos (ya existe). |
| Si la detención registrada después también avisa | Un switch nuevo en Configuración. |
| Quién recibe cada aviso | Dos permisos nuevos, por perfil o por usuario, con alcance por sectores en el de paradas (pantallas de Perfiles y Usuarios, ya existen). |
| Si sale por mail | La regla de cada tipo de aviso en Configuración (ya existe). |
| Desde qué stock avisa cada repuesto | Su stock mínimo (ya existe). Sin mínimo, ese repuesto no avisa. |

**Qué no entra:**
- WhatsApp;
- mails a direcciones sueltas o a proveedores externos: solo reciben usuarios del sistema;
- notificaciones push en el celular, que van con la publicación.

---

## 0. Reglas de trabajo

1. **Leé `CLAUDE.md` entero y seguí sus reglas.**
   - **Nunca abras, leas, muestres ni modifiques `.env`.**
   - Las pruebas, con `EMAIL_TRANSPORTE=simulado`: **nunca se manda un mail de verdad.**
   - Rama `feat/base-neon`. **No se agregan dependencias.**
2. **Dos commits.** Cada uno tiene que pasar `npm run typecheck` solo:

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1 a 4 y 6.1 | `feat(api): avisos de parada crítica y de stock bajo` |
   | 2 | 5 y 6.2 | `feat(front): avisos de parada crítica y de stock bajo` |

3. **Pruebas:**
   - **en Neon:**
     - la migración nueva y `test:avisos-criticos` (nueva, `backend/tests/avisos_criticos.test.ts`);
     - `test:migration-008`, `test:migration-014` y `test:migration-015`;
     - `test:notificaciones`, `test:avisos`, `test:repuestos`, `test:repuestos-intervenciones`, `test:pedidos-compras`, `test:tiempos`, `test:permisos`, `test:excepciones`, `test:usuarios` y `test:administracion`;
   - **además:** `test:front`, `typecheck` y `build:frontend`;
   - **no correr `test:todo`.**
4. **Pruebas existentes: se autoriza cambiar solo:**
   - las que cuentan los tipos de aviso o las filas de `notificacion_reglas` (de 20 pasan a 24);
   - las que comparan la lista exacta de permisos de un perfil, para sumar los dos nuevos;
   - las que comparan la configuración de avisos entera, para sumar el switch.

   **Lo que ya se esperaba no cambia.** Si una prueba falla por otra cosa, frenar y avisar.
5. **Ante cualquier duda, frenar y preguntar.**
6. **Los números:** la decisión es la **D-034**, la migración es la **siguiente libre** después de RT1, y las FE, las siguientes libres. Anotalos en el informe.

Guardar este archivo como `docs/etapas/etapa-av1-avisos-criticos-y-stock.md`.

---

## 1. Migración (primer commit)

**Tipos de aviso.** En la 015, igual que hizo LE1:
- sumar `PARADA_CRITICA` y `STOCK_BAJO` al `CHECK` de `notificacion_reglas.tipo_evento`;
- agregar las 4 filas iniciales, que no pisan cambios posteriores:

  | Tipo | `EMAIL` | `WHATSAPP` |
  | :--- | :--- | :--- |
  | `PARADA_CRITICA` | `SIEMPRE` | `NUNCA` |
  | `STOCK_BAJO` | `SIEMPRE` | `NUNCA` |

- si `notificaciones.tipo_evento` tiene su propio `CHECK`, también ahí.

**En la migración nueva:**

| Cambio | Tipo | Para qué |
| :--- | :--- | :--- |
| `notificaciones.repuesto_id` | `BIGINT NULL`, FK a `repuestos` | El enlace del aviso de stock. |
| `repuestos.stock_bajo_avisado_en` | `TIMESTAMPTZ NULL` | Para avisar una sola vez (sección 3). |
| `configuracion_sistema.critico_por_detencion_posterior` | `BOOLEAN NOT NULL DEFAULT TRUE` | El switch de la sección 2. |

**Permisos nuevos:**

| Código | Nombre | `usa_alcance` | Perfiles |
| :--- | :--- | :--- | :--- |
| `NOTIFICACIONES_CRITICAS_RECIBIR` | Recibir avisos de paradas críticas | `TRUE` (también en la lista de la 014) | ADMINISTRADOR, RESPONSABLE_MANTENIMIENTO y CONSULTA, con `TODAS` |
| `NOTIFICACIONES_STOCK_RECIBIR` | Recibir avisos de stock bajo | `FALSE` | ADMINISTRADOR y RESPONSABLE_MANTENIMIENTO |

Con esto, un "jefe de compras" puede recibir el aviso de stock sin gestionar repuestos, y un "jefe de planta" con alcance `SECTORES` recibe solo las paradas de sus sectores.

**`TABLAS_CONTROL`** no cambia: no hay tablas nuevas.

---

## 2. Aviso de parada crítica (primer commit)

**Cuándo se dispara:** al abrirse un período de detención de una máquina cuya criticidad tiene `prioridad_alta = TRUE`, en estos dos casos:
- **al reportar una falla con la máquina detenida.** Siempre;
- **al registrar después una detención dentro de una intervención** (`registrarDetencionIntervencion`). Solo si `critico_por_detencion_posterior` es `TRUE`.

Si hay otro lugar que abre un período de detención con una intervención, nombralo en el informe y preguntá antes de sumarlo.

**Cómo se genera:**
- **Un aviso por período que se abre.** Si la falla ya genera `FALLA_REGISTRADA`, `PARADA_CRITICA` va además, como un evento aparte en la misma transacción.
- **Destinatarios:** los usuarios activos con `NOTIFICACIONES_CRITICAS_RECIBIR`, filtrados por su alcance (`TODAS`, `SECTORES` con el sector de la máquina, y `PROPIAS` como creador o responsable), igual que hoy `FALLA_REGISTRADA`. También aplica la regla de que tienen que poder ver la intervención.
- **`generada_por_usuario_id`:** el usuario del sistema (`es_sistema`). Así también recibe el aviso quien reportó, si tiene el permiso.
- **Prioridad:** `ALTA`. Título: `Parada crítica: <código> · <nombre de la máquina>`. Mensaje: `Sector: <sector>. <descripción, hasta 120 caracteres>`. Lleva `intervencion_id` y `maquina_id`.
- **El mail** sale según la regla del tipo, con el canal activo, por la bandeja de salida de siempre.

**En `GET` y `PUT /api/configuracion/avisos`:** suman `critico_por_detencion_posterior` (booleano real; otro tipo da 422). Se gestiona con `CONFIGURACION_GESTIONAR`.

## 3. Aviso de stock bajo (primer commit)

**Va en `moverStock`, que es el único lugar donde cambia el stock,** dentro de su misma transacción y con la fila ya bloqueada. Con el valor nuevo:
- **Si el repuesto tiene `stock_minimo`, el valor nuevo es `<= stock_minimo` y `stock_bajo_avisado_en` es `NULL`:**
  - genera `STOCK_BAJO` para los usuarios activos con `NOTIFICACIONES_STOCK_RECIBIR`;
  - pone `stock_bajo_avisado_en = NOW()`.
- **Si el valor nuevo es `> stock_minimo`,** `stock_bajo_avisado_en` vuelve a `NULL`.
- **Si cambia el `stock_minimo`** en la edición del repuesto, `stock_bajo_avisado_en` también vuelve a `NULL`. Si el stock ya está por debajo del mínimo nuevo, se avisa en ese momento.

**Cómo se genera:**
- **Prioridad:** `NORMAL`. Lo genera el usuario del sistema.
- **Título:** `Stock bajo: <nombre del repuesto>`.
- **Mensaje:** `Quedan <cantidad> <unidad> (mínimo: <mínimo>).`, más `Proveedor habitual: <nombre>` si el repuesto tiene uno.
- **Lleva `repuesto_id`.**

**Lo que no hace:** no frena ni cambia el movimiento. Si generar el aviso falla, el movimiento igual se guarda: el error se registra en el log y no sale como 500.

## 4. D-034, en `docs/decisiones.md` (primer commit)

**D-034 — Avisos de parada crítica y de stock bajo.**

1. **Una parada crítica** es una detención de una máquina cuya criticidad tiene "prioridad alta". Avisa siempre al reportar la falla, y también al registrar una detención después, si así está configurado.
2. **El aviso de stock bajo** sale cuando un movimiento deja un repuesto en su stock mínimo o por debajo. Avisa una vez hasta que se repone. Un repuesto sin mínimo no avisa.
3. **Quién los recibe se decide con dos permisos,** por perfil o por usuario. El de paradas usa alcance por sectores. Solo reciben usuarios del sistema: no hay direcciones sueltas, y los proveedores externos no reciben avisos.
4. **El mail sale según la regla de cada tipo de aviso.**

**Motivo:** el profesor y GI-RE pidieron que en una parada crítica se entere enseguida gente fuera de mantenimiento, y que el sistema avise cuando falta un repuesto. Configurarlo con permisos y reglas que ya existen evita una pantalla nueva de destinatarios.

---

## 5. Pantallas (segundo commit)

**Configuración:**
- **en el bloque de avisos,** una tarjeta "Paradas críticas" con:
  - el switch "Avisar también cuando la detención se registra después de reportar la falla";
  - el texto: "Qué máquinas son críticas: la criticidad con prioridad alta, en Sectores y catálogos. Quién recibe el aviso: el permiso 'Recibir avisos de paradas críticas', en Perfiles o en cada usuario".
- **la tabla de reglas** muestra los dos tipos nuevos, con sus nombres en castellano en `lib/avisos.ts`: "Parada crítica" y "Stock bajo".

**Notificaciones (campana y pantalla):**
- **`PARADA_CRITICA`** lleva a la intervención, con el mismo estilo de prioridad alta que ya existe;
- **`STOCK_BAJO`** lleva a `/repuestos/<id>` si el usuario tiene `REPUESTOS_GESTIONAR`. Si no, va sin enlace.

**Repuestos:**
- **en la ficha y en el alta o edición,** junto al stock mínimo: "Avisa cuando el stock llega a este número. Sin mínimo, no avisa".

**Las reglas de pantalla:**
- **modo claro y modo oscuro,** solo con variables `--sm-*`;
- **a 390 px, nada se sale de costado.**

**Las FE nuevas:**
- los rótulos y enlaces de los dos tipos;
- cuándo `STOCK_BAJO` lleva enlace.

---

## 6. Pruebas

### 6.1 La migración y `test:avisos-criticos` (AC)

**De la migración** (M + número): las columnas, los permisos con sus alcances (`usa_alcance` sigue en `TRUE` después de reaplicar la 014), las 24 filas de reglas, y que se pueda reaplicar.

**Las pruebas AC:**

| N.º | Qué se prueba |
| :-: | :--- |
| AC-01 | Falla con la máquina detenida, en una máquina de criticidad con prioridad alta. Genera `PARADA_CRITICA` para quien tiene el permiso (`TODAS`, y `SECTORES` del mismo sector), no para `SECTORES` de otro sector, y tampoco para quien no tiene el permiso. Prioridad `ALTA`, con `intervencion_id` y `maquina_id`. |
| AC-02 | La misma falla con la máquina funcionando, o en una máquina sin prioridad alta: no genera `PARADA_CRITICA`. |
| AC-03 | Una detención registrada después, con el switch en `TRUE`: avisa. Con el switch en `FALSE`: no avisa. |
| AC-04 | Quien reportó y tiene el permiso, también recibe el aviso. |
| AC-05 | Una excepción `DENEGAR` saca a un usuario; una `CONCEDER` con `SECTORES` suma a un usuario de Consulta solo para su sector. |
| AC-06 | Con regla `SIEMPRE` y canal activo, se encola un envío por mail (simulado). Con regla `NUNCA`, no se encola. |
| AC-07 | Stock: un consumo deja el repuesto en el mínimo; avisa a quien tiene `NOTIFICACIONES_STOCK_RECIBIR`, con `repuesto_id`. Un segundo consumo por debajo del mínimo no repite el aviso. Una recepción que lo deja por encima limpia la marca, y un consumo siguiente vuelve a avisar. |
| AC-08 | Un repuesto sin mínimo, o sin control de stock, nunca avisa. |
| AC-09 | Cambiar el mínimo limpia la marca. Si el stock ya está por debajo del mínimo nuevo, avisa en ese momento. |
| AC-10 | Si falla la generación del aviso de stock (forzada en la prueba), el movimiento igual se guarda y no da 500. |
| AC-11 | `PUT` del switch: un booleano real funciona; `"true"` da 422; sin `CONFIGURACION_GESTIONAR`, 403. |
| AC-12 | Concurrencia: dos consumos a la vez que cruzan el mínimo dan un solo aviso. |

### 6.2 El front

Las FE de la sección 5.

---

## 7. Cierre e informe

**Criterios de cierre:**
1. Las secciones 1 a 6 están hechas, en dos commits que compilan solos.
2. Las pruebas de la regla 3 están en verde, en Neon.
3. Se hizo push en `feat/base-neon`.

**El informe.** Las salidas van pegadas tal cual:
1. Los hashes.
2. Los números que se usaron: la decisión, la migración y las FE.
3. La salida de cada suite, el typecheck y el build.
4. Las pruebas existentes que se tocaron, con una línea por cada una.
5. Todo lugar que abre un período de detención: cuáles avisan y cuáles no.
6. Los desvíos y las dudas.

**La prueba del mail real la hace Andrés** con el backend en `smtp`: una parada crítica de prueba y un consumo que deje un repuesto en su mínimo.
