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
