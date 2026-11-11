# Relevamiento y requisitos derivados

> **Fuentes:**
> - el cuestionario respondido por la empresa del caso de estudio;
> - su archivo maestro de mantenimiento (Excel);
> - dos planillas de mantenimiento pegadas en las máquinas (un compresor y un láser de corte).
>
> **Criterio:** este documento guarda solo conclusiones para el diseño. No incluye nombres de personas, clientes ni proveedores, ni importes. Esos datos quedan fuera del repositorio.

---

## 1. Principio (D-012)

**El sistema se desarrolla completo y general.** El caso de estudio sirve para ordenar prioridades, validar el diseño y tomar ejemplos reales, pero **no limita** lo que se construye. Las particularidades de cada empresa se resuelven por **configuración**: perfiles, permisos, marca, catálogos y qué módulos usa. Lo que una empresa no use queda disponible para otra.

---

## 2. Lo que el relevamiento confirma

| Hallazgo | Fuente | Cómo lo resuelve el sistema |
| :--- | :--- | :--- |
| La falla casi siempre la detecta el operador de la máquina. Se avisa de palabra y no hay un circuito definido. | Cuestionario 25-26 | El operario reporta la falla, y se notifica a quienes gestionan el mantenimiento. |
| El registro en Excel resulta lento y se pierden datos. | Cuestionario 28 y 34 | Carga mínima; los tiempos se calculan solos, a partir de los cambios de estado. |
| Las responsabilidades son difusas: una persona cumple varios roles. | Cuestionario 19 | Permisos por perfil más excepciones por usuario. |
| La planilla clasifica cada trabajo como **reactivo o preventivo** y como **interno o externo**. | Excel, resumen | Es exactamente `tipo` × `ejecucion`, y los reportes agrupan igual. |
| La planilla registra **horas de máquina parada** y **horas de reparación** por separado. | Excel, columnas Hs MP y Hs R | Inactividad (períodos de detención) y duración bruta y neta. |
| Las máquinas se identifican por un número interno. | Excel y planillas | `maquinas.codigo`. |
| La contabilidad y las compras siguen en el sistema contable. | Cuestionario 38 | RNF-15: el sistema no reemplaza al sistema contable. |

---

## 3. Requisitos derivados, por etapa

| # | Requisito | Origen | Etapa |
| :-: | :--- | :--- | :--- |
| 1 | **Catálogo de proveedores** (servicio técnico externo y casas de repuestos). Se usa en dos lugares: quién hizo un trabajo externo y dónde comprar un repuesto. | Excel: "realizó" con empresas externas y "dónde comprar" | Repuestos y stock |
| 2 | **Seguimiento de repuestos pedidos** mientras la intervención está "Esperando repuestos": qué falta, a quién se pidió, cuándo, para cuándo se espera y si llegó. | Cuestionario 39: el mayor problema son las demoras | Repuestos y stock |
| 3 | **Control de stock opcional por repuesto.** Un repuesto puede llevar stock (con movimientos y mínimo) o no. Si no lo lleva, igual se registra su uso y su costo en la intervención. | Cuestionario 36-37: hay empresas sin stock | Repuestos y stock |
| 4 | **Mano de obra por persona:** quiénes trabajaron (puede haber más de uno) y cuántas horas, interna o externa, con su costo. | Excel: "realizó" con varias personas y Hs R | Costos |
| 5 | **Planes preventivos por máquina, armados con tareas.** Cada tarea tiene acción, repuesto sugerido (con cantidad), proveedor sugerido y **uno o más disparadores**. Se ejecuta con el que llegue primero (ejemplo del relevamiento: "2000 h / 6 meses"). Disparadores posibles: **calendario** (cada N días, semanas, meses o años, o un día fijo de la semana); **uso**, según un medidor (requisito 6); y **condición**, cuando una lectura o inspección pasa un umbral (por ejemplo, nivel de lubricante, temperatura o desgaste visible). | Excel, bloque "rutinarias"; planillas; cuestionario 33 | Preventivos |
| 6 | **Medidores configurables por máquina:** horas, kilómetros, ciclos, golpes, piezas producidas, o el que defina cada empresa, con su unidad. Cada máquina puede tener varios. Las lecturas se registran al ejecutar una tarea o por separado, y con ellas se calcula el próximo vencimiento por uso. | Excel "HS/PERIODO", planillas, cuestionario 33 | Preventivos |
| 7 | **Revisiones de rutina del operario:** diarias, semanales o mensuales (inspección visual, limpieza, control de alarmas). Las completa el operario y, si encuentra algo, sale directo a "Reportar falla". Una tarea puede marcarse "no requiere registro" (se cumple, pero no se anota). | Planillas en máquina, cuestionario 19 | Preventivos |
| 8 | **Próximo vencimiento y avisos:** fecha calculada de cada tarea y notificación cuando se acerca o vence. | Planillas: "próxima fecha" | Preventivos y notificaciones |
| 9 | **Datos de la máquina:** **criticidad**, con niveles configurables (por omisión: alta, media y baja; la alta es la que en el relevamiento aparece como "crítica para la producción" o "crítica para otras máquinas"); **tipo de equipo**, también configurable (máquina, vehículo, instalación, herramienta menor…); y notas de mantenimiento. Las máquinas de criticidad alta aparecen primero en el tablero y sus detenciones notifican con prioridad alta. | Planillas: "esta unidad es crítica"; cuestionario 13 | Máquinas (la criticidad puede adelantarse a antes de F3, porque la usa el tablero) |
| 10 | **Planta o ubicación del sector,** para filtrar cuando hay varias plantas o naves. | Cuestionario 4 | Máquinas |
| 11 | **Manuales e instructivos por máquina; facturas, remitos y presupuestos por intervención.** | Cuestionario 22, 29 y 41; planillas: "consultar manual" | Documentos (postergada; la demanda está confirmada) |
| 12 | **Avisos por WhatsApp o correo.** La bandeja de salida ya está preparada (D-36). | Cuestionario 26: se avisa de palabra | Notificaciones (más adelante) |
| 13 | **Importación inicial del historial** desde la planilla existente, como opción de cada instalación. Los reportes tienen datos desde el primer día. | Excel con registros desde 2025 | Opcional, por instalación |

---

## 4. Datos para la demostración

El archivo maestro y las planillas tienen máquinas reales con su número, tareas de rutina con su periodicidad, proveedores y trabajos ya hechos. Sirven para armar los **datos de demostración** de la instalación del caso de estudio:

- se cargan con un script que lee un archivo local, **excluido del repositorio**;
- en el repositorio solo queda un ejemplo con datos inventados.

---

## 5. Dato para el diagnóstico

En la planilla, cerca del **98 %** del costo y de las horas registradas corresponde a trabajos **correctivos** (reactivos). El preventivo casi no aparece. Además, alrededor del **87 %** del costo fue de trabajos **externos**.

El registro es parcial: unas trece máquinas, desde 2025. Igual muestra el perfil de la situación actual: mantenimiento casi exclusivamente reactivo y dependiente de terceros. Ese es el punto de partida que el sistema busca cambiar.
