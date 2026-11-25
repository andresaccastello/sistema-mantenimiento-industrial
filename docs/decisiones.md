# Registro de decisiones técnicas

Este archivo documenta las decisiones relevantes del proyecto para evitar cambios sin justificación y mantener trazabilidad durante la tesis.

## D-001 — Aplicación web

**Estado:** Aceptada

Se desarrollará una aplicación web de uso interno, accesible desde navegador.

**Motivo:** permite utilizar los equipos existentes y facilita el acceso desde distintos sectores sin instalar una aplicación de escritorio en cada dispositivo.

---

## D-002 — Base de datos centralizada

**Estado:** Aceptada

La información del sistema se almacenará en una base de datos centralizada.

**Motivo:** se requiere consultar desde distintos equipos la misma información de máquinas, intervenciones, repuestos, costos e historial.

---

## D-003 — SAE fuera del núcleo del sistema

**Estado:** Aceptada

SAE continuará siendo un sistema externo. En la primera versión no habrá integración contable directa.

**Motivo:** la tesis está enfocada en mantenimiento industrial, no en reemplazar la gestión administrativa o contable.

---

## D-004 — Stack tecnológico

**Estado:** Aceptada

Se utilizará:

- **Frontend:** React + Vite + TypeScript.
- **Backend:** Node.js ejecutado mediante Neon Functions.
- **Framework HTTP:** Hono.
- **Base de datos:** PostgreSQL alojado en Neon.
- **Acceso a datos inicial:** `pg` con pool de conexiones.
- **API:** REST.

**Motivo:** el stack permite desarrollar una aplicación web desacoplada y mantener el backend próximo a la base de datos. Para la primera versión se prioriza una solución simple, con pocas capas y fácil de explicar y mantener durante la tesis.

---

## D-005 — Infraestructura Neon

**Estado:** Aceptada

Neon alojará:

- PostgreSQL.
- Backend Node.js mediante Neon Functions.

La configuración se mantendrá como código mediante `neon.ts`. En producción, Neon inyectará la variable `DATABASE_URL` al backend.

El frontend React se desplegará por separado, ya que Neon Functions se utilizará para la API y no como hosting del cliente web.

---

## D-006 — ORM

**Estado:** Pendiente

No se incorporará un ORM al inicio. Primero se diseñará el modelo relacional y se crearán las migraciones SQL. Si más adelante aporta valor real, se evaluará incorporar una herramienta de acceso a datos.

**Motivo:** evitar complejidad innecesaria durante la primera etapa y mantener visible el diseño de PostgreSQL para la tesis.

---

## D-007 — Sistema independiente de SolGest

**Estado:** Aceptada

El sistema es una aplicación aislada, con autenticación y permisos propios. `docs/InfromeSobreFront/FRONTEND_HANDOFF.md` se usa solo como referencia visual para el frontend definitivo. La integración con SolGest queda como posible evolución futura, fuera del alcance de la tesis.

---

## D-008 — Orden de etapas hasta la entrega

**Estado:** Aceptada

El plan original (sección 12 del análisis de intervenciones) cubría solo ese módulo. Para llegar a un sistema usable se reordena lo que falta: 7 Notificaciones → U Usuarios y perfiles → 8 Tiempos e inactividad → Repuestos y stock (incluye la ex Etapa 12) → 9 Costos → Preventivos básicos → Reportes de la tesis. El frontend definitivo avanza en paralelo desde la Etapa 8. Se postergan: Etapa 10 (correcciones de finalizadas), administración completa de permisos (resto de la Etapa 11) y documentos adjuntos.

**Motivo:** priorizar lo que el sistema necesita para funcionar de punta a punta y para la defensa.

---

## D-009 — Sistema general, marca por instalación

**Estado:** Aceptada

El código no tiene nada específico de una empresa. El sistema se llama "Sistema de Mantenimiento Industrial"; el nombre de la empresa y el logo se configuran en cada instalación (tabla `configuracion_sistema`). Una instalación atiende a una empresa: varias empresas en una misma base (multiempresa) queda fuera de alcance y se evaluará si se integra con otro sistema.

---

## D-010 — Frontend

**Estado:** Aceptada

React con Mantine (licencia MIT), versiones exactas. Escritorio primero; en celular la pantalla se acomoda sola y, si se confirma el uso, habrá una vista propia para las pantallas del operario. Paleta tomada de SolGest como referencia visual.

---

## D-011 — Mapa de pantallas aprobado

**Estado:** Aceptada

Mapa de pantallas aprobado (`docs/front/mapa-pantallas.md`). Es la referencia de las etapas F0 a F5.

---

## D-012 — Principio de diseño frente al caso de estudio

**Estado:** Aceptada

**El sistema se desarrolla completo y general.** El caso de estudio sirve para ordenar prioridades, validar el diseño y tomar ejemplos reales, pero **no limita** lo que se construye. Las particularidades de cada empresa se resuelven por **configuración**: perfiles, permisos, marca, catálogos y qué módulos usa. Lo que una empresa no use queda disponible para otra.

---

## D-013 — Datos de la máquina: criticidad, tipo de equipo y planta

**Estado:** Aceptada

La máquina tiene **criticidad** y **tipo de equipo**, los dos de catálogos configurables con un valor por omisión. El **sector** puede pertenecer a una **planta**.

Datos iniciales:

- criticidades Alta, Media (por omisión) y Baja;
- tipos de equipo Máquina (por omisión), Vehículo, Instalación y Herramienta menor;
- ninguna planta.

Una falla en una máquina cuya criticidad tiene `prioridad_alta` avisa con prioridad alta aunque no la detenga. El texto libre `tipo` pasa a llamarse `modelo` (marca y modelo).

**Motivo:** relevamiento, requisitos 9 y 10. El tablero muestra primero las máquinas más críticas, y una empresa con varias plantas puede filtrar por planta.

---

## D-014 — Excepciones de permisos por usuario

**Estado:** Aceptada

Un usuario con `PERMISOS_GESTIONAR` puede conceder o denegar un permiso a otro usuario, por encima de su perfil, con un motivo obligatorio.

Reglas (sección 8.5 del análisis):

- nadie cambia sus propias excepciones;
- nadie concede, deniega ni quita un permiso que no tiene, ni concede un alcance mayor que el suyo;
- cada cambio queda en `auditoria_permisos`, con el valor anterior.

El cambio vale desde el siguiente pedido del usuario, sin volver a entrar.

**Motivo:** relevamiento, "una persona cumple varios roles". Las excepciones cubren esos casos sin crear un perfil por persona.

---

## D-015 — Bajas en sectores, plantas y catálogos

**Estado:** Aceptada

Un sector, una planta, una criticidad o un tipo de equipo no se desactiva mientras algo activo lo use:

- un sector, mientras tenga máquinas activas o usuarios activos;
- una planta, mientras tenga sectores activos;
- una criticidad o un tipo de equipo, mientras lo use una máquina activa.

Cada catálogo tiene siempre un valor por omisión activo. Se cambia marcando otro, y el valor por omisión no se puede desactivar.

Lo que ya estaba asignado se conserva: una máquina o un usuario inactivos pueden quedar con un valor inactivo. Una máquina no se reactiva con su sector, criticidad o tipo inactivos. Un usuario sí, porque un sector inactivo no tiene máquinas activas y no le da acceso a nada.

**Motivo:** que ningún dato activo dependa de uno inactivo, y que el alta de una máquina siempre encuentre sus valores por omisión.


---

## D-016 — Avisos por email configurables

**Estado:** Aceptada

La campana sigue siendo el aviso principal. El email es una copia para quien no está mirando el sistema.

- El administrador prende o apaga cada canal y decide, por tipo de aviso, si sale nunca, solo con prioridad alta o siempre.
- Los envíos pasan por la bandeja de salida y se procesan cada minuto. No se mandan dentro del pedido que generó el aviso, para que un servidor de correo lento no demore a nadie.
- Cada envío se reintenta hasta 5 veces. Se descarta si el usuario no tiene email, está inactivo, el aviso tiene más de 24 horas o el canal se apagó.
- Las contraseñas del correo van solo en variables de entorno.
- WhatsApp queda preparado (datos de contacto y reglas) hasta tener su transporte.

**Motivo:** decisión del usuario. Que cada instalación elija cuánto avisar, sin tocar el código.

---

## D-017 — Indicadores de mantenimiento

**Estado:** Aceptada

Sobre las máquinas activas de la selección y el período elegido:

- **Disponibilidad:** tiempo sin detenciones ÷ tiempo del período. El tiempo fuera de servicio no cuenta como detención (D-07).
- **Fallas:** intervenciones correctivas reportadas en el período, sin contar las canceladas.
- **MTTR** (tiempo medio de reparación): duración neta promedio de las correctivas finalizadas en el período, sin las pausas.
- **Tiempo de respuesta:** espera promedio de esas mismas correctivas, desde el reporte hasta el inicio del trabajo.
- **MTBF** (tiempo medio entre fallas): tiempo del período sin detenciones correctivas ÷ cantidad de fallas.

**Motivo:** son los indicadores usuales del área. Se definen acá para que el número del sistema y el de la tesis sean el mismo.

---

## D-018 — Repuestos, stock y pedidos

**Estado:** Aceptada

1. **Proveedores:** un solo catálogo, para comprar repuestos y, más adelante, para los trabajos externos.
2. **Control de stock opcional por repuesto.** Si un repuesto no lleva stock, su uso y su costo se registran igual en la intervención, sin movimientos.
3. **El stock cambia solo con movimientos:**
   - ingreso;
   - egreso: manual con motivo, o por consumo en una intervención;
   - ajuste a una cantidad contada, con motivo;
   - devolución, al anular un consumo.

   Cada movimiento guarda cuánto cambió y el stock que quedó. El stock nunca queda negativo.
4. **Costo:**
   - el costo unitario de un repuesto es el último conocido: el del alta, una edición, un ingreso con costo o un consumo de un repuesto sin stock;
   - cada cambio queda en un historial;
   - el consumo guarda el costo del momento (RN-41). Un cambio posterior no lo modifica.
5. **Consumos en la intervención:**
   - se registran en `EN_PROCESO` y `EN_ESPERA_REPUESTOS`;
   - con la intervención `FINALIZADA`, solo con `INTERVENCIONES_CORREGIR` y motivo;
   - no se editan: se anulan con motivo (si habían movido stock, vuelve con una devolución) y se cargan de nuevo.
6. **D-20, resuelta:** cancelar, reabrir o corregir una intervención no mueve stock. Lo que no se usó se anula a mano; con la intervención cancelada, con `INTERVENCIONES_CORREGIR`.
7. **Pedidos:** qué falta, cuánto, a quién se pidió, cuándo, para cuándo se espera y si llegó. Al recibir, se puede ingresar al stock en el mismo paso.
8. **Costos visibles:**
   - los ve quien tiene `COSTOS_VER` o `REPUESTOS_GESTIONAR`;
   - los carga quien tiene `REPUESTOS_GESTIONAR` o `COSTOS_REGISTRAR`.
9. **Reporte de repuestos:** consumos no anulados, por fecha de registro, de las máquinas visibles de la selección, activas o no: lo gastado en una máquina dada de baja sigue siendo gasto.

## D-019 — Costos de la intervención

**Estado:** Aceptada

1. **El total sale solo:** repuestos usados (D-018) más los renglones no anulados. `costo_mano_obra` es la suma de los renglones `MANO_OBRA`. Ningún importe se escribe a mano en la intervención.
2. **Renglones** de mano de obra, servicio externo, transporte, otro y ajuste. No se editan: se anulan con motivo y se carga otro.
3. **Mano de obra:** un renglón por persona, con horas, interna (un usuario) o externa (un proveedor). Con valor hora, el importe es horas × valor hora, redondeado a centavos. Sin valor hora, se carga el importe total.
4. **Solo el ajuste puede ser negativo, y el total nunca:** una operación que lo dejaría negativo se rechaza, aunque sea anular un repuesto.
5. **Quién puede:**
   - carga y anula quien tiene `COSTOS_REGISTRAR`, en `EN_PROCESO` y `EN_ESPERA_REPUESTOS`;
   - con la intervención `FINALIZADA`, además `INTERVENCIONES_CORREGIR` y motivo;
   - con la intervención `CANCELADA`, solo se anula, con `INTERVENCIONES_CORREGIR`.
6. **Importes visibles:** con `COSTOS_VER`. Las horas de mano de obra las ve cualquiera que ve la intervención.
7. **Valor hora:** no se guarda por persona. Se carga en cada renglón y queda como histórico. Una tarifa por persona es una mejora futura.
8. **Reporte de costos:** gasto registrado en el período, por la fecha de cada consumo y de cada renglón, no anulado, de las máquinas visibles de la selección, activas o no. Es el mismo criterio que D-018, punto 9.

## D-020 — Varios costos en un guardado

**Estado:** Aceptada

1. **Una pestaña por tipo.** Cada una recuerda lo escrito mientras el diálogo está abierto.
2. **Todas o ninguna.** Agregar graba las pestañas con datos en un solo pedido y una sola transacción. Si una falla, no se graba ninguna.
3. **Nada se descarta en silencio.** Una pestaña empezada e incompleta frena el guardado hasta que se complete o se vacíe. Cerrar el diálogo con datos pide confirmación.
4. **El total se controla una vez,** con todos los renglones juntos: un ajuste negativo puede ir con los costos que lo cubren.
5. **Un renglón por pestaña** en cada guardado. Dos personas de mano de obra son dos guardados (D-019, punto 3).

## D-021 — Preventivos por calendario

**Estado:** Aceptada

1. **Un plan es de una máquina** y tiene tareas. Cada tarea tiene su frecuencia: cada N días, semanas, meses o años. Una máquina puede tener varios planes, por ejemplo uno mecánico y uno eléctrico, cada uno con su responsable.
2. **La próxima fecha se calcula, no se guarda.** Es la última ejecución más la frecuencia; sin ejecuciones, la primera fecha que se cargó. La última ejecución es la fecha de finalización de la última intervención finalizada, no eliminada, con esa tarea marcada como hecha. Así, reabrir, cancelar, eliminar o corregir la fecha de una intervención mueve la próxima fecha sin ningún paso extra.
3. **Se cuenta desde la última ejecución,** no desde la fecha que tocaba. Si un cambio de aceite cada 6 meses se hizo con un mes de atraso, el próximo es 6 meses después de cuando se hizo.
4. **La intervención se genera a pedido.** Un usuario con `PLANES_GESTIONAR` genera, desde el plan, una intervención `PREVENTIVO` con las tareas que vencen. Sigue el mismo circuito que una correctiva: estados, tiempos, repuestos, costos y detenciones. La generación automática y los avisos de vencimiento quedan para la PV5 (D-025), porque necesitan un disparador programado y un autor que no es una persona.
5. **Una tarea está en una sola intervención abierta a la vez.** Mientras está en una, no se vuelve a generar.
6. **"Hoy" es el de la instalación,** según su zona horaria (`configuracion_sistema.zona_horaria`), no el del servidor.

**Motivo:** cumplir los requisitos 5 y 8 con lo mínimo que funciona de punta a punta, y dejar el modelo listo para los medidores (PV3).

## D-022 — Repuestos previstos en las tareas preventivas

**Estado:** Aceptada

1. **Una tarea del plan tiene una lista de repuestos previstos,** cada uno con su cantidad, hasta 10. Reemplaza al repuesto sugerido único de la PV1. El proveedor sugerido sigue igual.
2. **Al generar la intervención, los previstos se copian a cada tarea.** Cambiar el plan después no cambia la intervención.
3. **Un previsto no mueve stock.** Se registra como consumo recién cuando el técnico marca la tarea como hecha y confirma qué usó y cuánto. Puede bajar o subir la cantidad, o dejar uno sin usar.
4. **Desmarcar la tarea anula esos consumos,** y el stock vuelve.
5. **Se confirman con las reglas de cualquier consumo:** en `EN_PROCESO` o `EN_ESPERA_REPUESTOS` lo hace el responsable o quien tenga `INTERVENCIONES_ASIGNAR`; en `FINALIZADA`, solo `INTERVENCIONES_CORREGIR`, con motivo. **En `PENDIENTE` no se registran repuestos,** así que una tarea con previstos se marca después de iniciar el trabajo. Las tareas sin previstos se siguen marcando en `PENDIENTE`.
6. **Todo o nada:** si un repuesto no alcanza (`STOCK_INSUFICIENTE`) o está inactivo, no se marca la tarea ni se registra ningún consumo.

**Motivo:** no cargar dos veces lo que el plan ya sabe, sin descontar stock de algo que quizás no se usó.

## D-023 — Medidores y tareas que vencen por uso

**Estado:** Aceptada

1. **Un medidor es de una máquina:** un horómetro, un cuentakilómetros, un contador de ciclos o de piezas. Tiene un nombre y una unidad, que se escribe libre. Una máquina puede tener varios.
2. **Las lecturas son acumuladas.** Cada una es mayor o igual que la última vigente. Vale desde que se registra: no se carga con fecha pasada. Una lectura mal cargada se anula con motivo, y nada se borra.
3. **Una tarea vence por fecha, por uso o por las dos,** y en ese caso, lo que llegue primero. Por uso es cada N unidades de un medidor de la misma máquina, con la primera en un valor dado y una anticipación en unidades.
4. **La próxima por uso se calcula, no se guarda,** como la fecha (D-021):
   - es el mayor valor del medidor registrado al hacer la tarea en una intervención finalizada y no eliminada, más el intervalo;
   - sin ninguno, es la primera.

   Reabrir, cancelar o eliminar la intervención la mueve sola.
5. **El valor al hacer la tarea queda en la tarea de la intervención.** Es la última lectura, o una nueva que se carga en ese momento. Hacer la tarea reinicia los dos relojes, el de fecha y el de uso.
6. **El estado de la tarea es el más urgente de los dos.** "Sin lectura" es una tarea por uso cuyo medidor no tiene ninguna lectura vigente.
7. Reemplazado por la D-032.
8. **Si se cambia el medidor físico,** por ejemplo un horómetro nuevo que arranca de cero, se da de alta otro medidor y se le pasan las tareas.

**Motivo:** cumplir el requisito 6 con la misma idea de D-021: nada se guarda que se pueda calcular, y deshacer una intervención deshace su efecto sin pasos extra.

## D-024 — Sin revisiones de rutina del operario

**Estado:** Reemplazada por la D-033

**El requisito 7 del relevamiento** (revisiones diarias, semanales o mensuales del operario) **no se implementa.** Son controles de minutos: cargarlos en el sistema le agrega trabajo al operario y no da información que se use.

El circuito ya está cubierto: el operario hace la revisión como hoy, y si encuentra algo usa "Reportar falla", que abre una intervención correctiva y avisa a mantenimiento. Lo que sí conviene seguir en el sistema, como un cambio de aceite o una tarea con repuestos, va en un plan preventivo.

## D-025 — Generación automática y avisos de vencimiento

**Estado:** Aceptada

1. **Una vez por día,** el sistema revisa las tareas preventivas. Lo dispara el mismo programado de Neon que procesa los envíos. Un usuario con `PLANES_GESTIONAR` también lo puede pedir a mano.
2. **Un aviso por vencimiento:** cuando una tarea está próxima, se avisa una vez, y cuando vence, otra. El vencimiento se identifica por su próxima fecha o su próximo uso. Cuando se hace la tarea, cambia, y el ciclo vuelve a empezar.
3. **El aviso le llega** al responsable del plan. Si el plan no tiene responsable o está inactivo, les llega a los usuarios con `PLANES_GESTIONAR` que alcanzan el sector de la máquina. Va uno por plan, con sus tareas juntas.
4. **La generación automática se prende por plan** (`generacion_automatica`). Prendida, genera la intervención igual que el botón "Generar", con las tareas vencidas y próximas. Apagada, el plan solo avisa.
5. **El autor de lo automático es el usuario "Sistema".** No inicia sesión, no tiene permisos y no aparece en las listas de usuarios. Así cada intervención y cada aviso tienen un autor, como exige el modelo, sin inventar una persona.
6. **Un plan que falla no frena a los demás:** cada plan se procesa en su propia transacción, y el error queda en el resultado.

## D-026 — Cumplimiento de los preventivos

**Estado:** Aceptada

1. **Se mide por tarea, no por intervención.** Una intervención preventiva puede llevar varias tareas, y cada una tiene su propio vencimiento.
2. **Una tarea hecha** es una fila de `intervencion_tareas` con `hecha = true`, de una intervención `FINALIZADA` no eliminada, cuya fecha de finalización cae en el período. **Se hizo a tiempo si cumple todo lo que corresponde:**
   - **con fecha programada:** la fecha local de finalización es igual o anterior a `fecha_programada`;
   - **con uso programado:** `valor_medidor` es igual o menor que `uso_programado`.

   Con los dos, tienen que cumplirse los dos: lo que llegue primero.
3. **Una tarea vencida sin hacer** es una tarea del plan que hoy está `VENCIDA`, con su próxima fecha dentro del período. Las que vencen solo por uso no se cuentan acá, porque no tienen una fecha para ubicarlas en el período.
4. **El cumplimiento** es `a tiempo / (hechas + vencidas sin hacer)`, en porcentaje con un decimal. Sin nada que medir, no hay número: se muestra "—".
5. **El atraso promedio** es el promedio de días entre `fecha_programada` y la fecha local de finalización, solo en las tareas hechas tarde que tienen fecha programada.

**Motivo:** una medida simple, que se explica en una oración y se controla a mano con los datos de una intervención.

## D-027 — Alcance final

**Estado:** Aceptada

1. Reemplazado por la D-035.
2. **WhatsApp (requisito 12): no se implementa en esta versión.** La bandeja de salida y la API quedan preparadas (D-36), pero la interfaz no muestra el canal: ni la configuración, ni las reglas, ni el teléfono del usuario. Los avisos salen por la campana y por email.
3. **El sistema es de escritorio.** GI-RE trabaja en puestos con PC. En el celular solo se puede:
   - el operario: reportar una falla, ver sus reportes y sus notificaciones;
   - quien gestiona: ver el tablero y los reportes, sin cargar nada.

   Todo lo demás se usa desde la computadora. Las pantallas ya se adaptan al celular, así que ampliar el uso es una mejora futura y no un rediseño.
4. **Esto es de interfaz, no de seguridad:** la API no distingue el dispositivo, y los permisos siguen siendo los mismos.

**Motivo:** los sistemas líderes son móviles para el técnico, pero en GI-RE quien repara suele ser externo y la gestión se hace en el escritorio. Cargar costos, repuestos y horas en un celular es donde más errores se cometen.


## D-028 — Calendario de preventivos

**Estado:** Aceptada

1. **El calendario es una consulta, no guarda nada.** Muestra lo que sale de `v_plan_tareas_estado` y del historial, como D-021 y D-023.
2. **Tres clases de evento:**
   - **hecha:** en la fecha en que se finalizó;
   - **pendiente:** la próxima de cada tarea, con su estado;
   - **prevista:** las siguientes, si se hiciera cada una en su fecha.
3. **Una vencida se proyecta desde hoy,** porque lo antes que puede hacerse es hoy. Una tarea que venció por uso antes de su fecha va en hoy.
4. Reemplazado por la D-032.
5. **Las tareas por fecha y por uso** se ven por su fecha, con el aviso de que pueden tocar antes.

**Motivo:** el responsable de mantenimiento planifica por semana y por mes. La lista de vencimientos dice qué urge, pero no cómo se reparte el trabajo. La proyección permite ver semanas cargadas antes de que lleguen.

## D-029 — Pedidos y compras

**Estado:** Aceptada

1. **Compras y costo de mantenimiento son dos números distintos, que no se mezclan.**
   - **Compras:** la plata que salió, con factura de un proveedor. Se ve en el reporte de compras y es lo que algún día va al SAE.
   - **Costo de mantenimiento:** lo que se usó en cada máquina: repuestos usados, mano de obra y servicios (D-019). Se ve en la intervención y en el reporte de costos. No va al SAE: los repuestos ya entraron como compra.
2. **Qué cuenta como compra:**
   - un **pedido recibido**, siempre: entre o no al stock, y aunque no tenga proveedor (va en "Sin proveedor");
   - un **ingreso manual** de stock, solo si tiene **proveedor**. Sin proveedor suele ser una carga inicial o un hallazgo en el depósito: no es compra y el reporte lo cuenta aparte.
   - **Cada compra cuenta una vez.** Un pedido que entró al stock cuenta por su ingreso, y el uso de algo comprado no es otra compra.
3. **Usar al recibir.**
   - **El pedido y la espera:** al guardar un pedido con la intervención en proceso, se pregunta si pasa a esperar repuestos. No pasa sola, porque a veces se pide algo para después y se sigue trabajando. Si la máquina está parada por esa falla, el diálogo avisa que va a figurar "Detenida".
   - **Recibir y usar es un solo paso.** Con stock, entra todo lo recibido y se usa la cantidad indicada, como mucho lo recibido; lo que sobra queda en stock. Sin stock, se usa todo lo recibido: si sobra seguido, ese repuesto tiene que llevar stock.
   - **Un pedido de texto libre,** para usarlo, se asocia a un repuesto del catálogo. Si no se usa, se recibe sin elegir nada. No se carga como renglón de costo "Otro", porque quedaría afuera del reporte de repuestos y de su historial de precios.
   - **Con la intervención cerrada,** el pedido se recibe igual, porque es una compra, pero no se ofrece usarlo ahí: se corrige con permiso y motivo, como cualquier uso.
   - **No se finaliza con pedidos abiertos** (D1, 18/11, reemplaza el punto D5 de la PC1, que avisaba pero no frenaba). Una intervención con pedidos pendientes o pedidos no se finaliza ni se resuelve: la API responde 409 `PEDIDOS_ABIERTOS` y el diálogo lo muestra como bloqueo, con la lista. **La máquina puede volver a funcionar aparte,** con "Volvió a funcionar": el arreglo provisorio sigue siendo posible, y la intervención queda en proceso o esperando repuestos hasta que llegue lo pedido o se cancele el pedido. **Motivo:** con la intervención cerrada, el repuesto que llegaba no se podía usar ahí y su costo no entraba en la intervención (le pasó a Andrés con la 20110).
4. **Lo que no es este reporte.**
   - **No es contabilidad:** no distingue IVA, tipo de factura ni condición de pago. Muestra los importes como se cargaron.
   - **Lo ve** quien consulta reportes con alcance a todas las máquinas y ve costos. Una compra para stock no es de ningún sector.
   - **Queda afuera:** el archivo para el SAE, que espera el documento (esta etapa deja los datos listos); la regla de la mano de obra (la externa tiene factura, la interna es sueldo); y recibir un pedido en partes.

**Motivo:** el pedido no cambiaba nada solo, recibir y usar eran dos pasos, un repuesto sin stock no guardaba ni costo ni comprobante al recibirlo, y lo comprado no aparecía en ningún reporte. Separar lo que se compró de lo que se usó evita contar dos veces el mismo repuesto y deja listo el dato que pide el SAE.

## D-030 — Ronda de lecturas

**Estado:** Aceptada

1. **Las lecturas se cargan en ronda:** una sola pantalla con todos los medidores, para recorrer la planta y cargar todo de una vez.
2. **El celular suma la carga de lecturas.** Amplía la D-027: el operario reporta fallas **y carga lecturas**. La lectura se toma al lado de la máquina, y es el caso más claro de algo que conviene cargar caminando. Lo demás sigue siendo de escritorio.
3. **Avisos:**
   - **en el momento:** si una lectura deja una tarea próxima o vencida, se avisa al guardarla, y si el plan genera solo, se genera. Es lo mismo que hace la revisión diaria, adelantado;
   - **lecturas atrasadas:** cada medidor dice cada cuántos días se lee (7 por omisión). Si se pasa de ese plazo y el medidor tiene tareas activas, la revisión diaria avisa una vez.
4. Reemplazado por la D-032.

**Motivo:** sin lecturas, el preventivo por uso no funciona, y el problema práctico es cargarlas, no calcularlas.

## D-031 — El celular, a elección de cada usuario

**Estado:** Aceptada. Reemplaza el punto 3 de la D-027 y el punto 2 de la D-030.

1. **El dispositivo no quita permisos.** En el celular, cada usuario ve lo que su perfil le permite, igual que en la computadora.
2. **El modo simple es opcional.** Cada usuario lo prende o lo apaga en "Mi cuenta". Prendido, en el celular ve lo esencial: reportar fallas, sus reportes, la ronda de lecturas y un resumen de reportes. Viene prendido, así que el uso de hoy no cambia hasta que alguien lo apague.
3. **Una tablet** de 768 px o más se ve como una computadora. Con el modo simple apagado, da lo mismo de qué lado caiga.
4. **El tema** (claro, oscuro o el del dispositivo) también es una preferencia de cada usuario.

**Motivo:** la revisión con el profesor del 18/11. La tendencia es usar el celular para casi todo, limitar por dispositivo genera casos raros, y el sistema es para cualquier empresa: que cada una decida, no el sistema.

## D-032 — Fecha estimada por ritmo de uso

**Estado:** Aceptada. Reemplaza el punto 7 de la D-023 y el punto 4 de la D-030. Cambia el punto 4 de la D-028.

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

## D-033 — Tareas de rutina del operario

**Estado:** Aceptada. Reemplaza la D-024.

1. **Cada máquina puede tener tareas de rutina cortas,** diarias o semanales, que hace el operario. Por ejemplo, cambiar el agua del refrigerante o limpiar el lente.
2. **No son intervenciones ni preventivos:** no tienen estados, repuestos, costos ni avisos, y no van al calendario. Si aparece un problema, se usa "Reportar falla".
3. **Se marcan con un toque,** con una nota opcional, y solo en el período actual: el día, o la semana de lunes a domingo. Lo que no se marcó a tiempo queda como no hecho.
4. **Las diarias corresponden de lunes a viernes,** más el sábado si la tarea lo indica. Las semanales, cualquier día de la semana.
5. **Las ve y las marca** cualquier usuario con `RUTINAS_REALIZAR` dentro de su alcance. Para el operario, son los sectores que tiene asignados.
6. **El administrador ve el cumplimiento** por máquina y en Reportes.

**Motivo:** en la entrevista del 19/11, GI-RE contó una rotura por una tarea de rutina que no se hizo durante meses. La D-024 suponía que estas tareas no aportaban información. El cliente mostró que sí, siempre que marcarlas no le agregue trabajo al operario.

## D-034 — Avisos de parada crítica y de stock bajo

**Estado:** Aceptada

1. **Una parada crítica** es una detención de una máquina cuya criticidad tiene "prioridad alta". Avisa siempre al reportar la falla, y también al registrar una detención después, si así está configurado.
2. **El aviso de stock bajo** sale cuando un movimiento deja un repuesto en su stock mínimo o por debajo, o cuando se da de alta con el stock inicial ya en el mínimo o por debajo. Avisa una vez hasta que se repone. Un repuesto sin mínimo no avisa.
3. **Quién los recibe se decide con dos permisos,** por perfil o por usuario. El de paradas usa alcance por sectores. Solo reciben usuarios del sistema: no hay direcciones sueltas, y los proveedores externos no reciben avisos.
4. **El mail sale según la regla de cada tipo de aviso.**

**Motivo:** el profesor y GI-RE pidieron que en una parada crítica se entere enseguida gente fuera de mantenimiento, y que el sistema avise cuando falta un repuesto. Configurarlo con permisos y reglas que ya existen evita una pantalla nueva de destinatarios.

## D-035 — Documentos de la máquina como enlaces

**Estado:** Aceptada. Reemplaza el punto 1 de la D-027.

1. **Cada máquina tiene una lista de documentos:** título, tipo, enlace y notas.
2. **El archivo vive afuera:** en el almacenamiento de SAE, en una carpeta compartida o en la web del fabricante. El sistema guarda solo el enlace.
3. **Solo se aceptan enlaces `http` o `https`.**

**Motivo:** GI-RE pidió tener los manuales, fotos e instructivos a mano desde la máquina. Guardar archivos pesados en la base no tiene sentido, y el almacenamiento ya lo está resolviendo SAE.
