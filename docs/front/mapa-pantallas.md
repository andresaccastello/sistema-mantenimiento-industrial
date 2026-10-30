# Mapa de pantallas del frontend

> **Estado:** aprobado por Andrés el 28/10/2026. Es la referencia de las etapas del frontend y de la etapa "API para el front".
> **Base:** tesis (RNF-01, RNF-03, RNF-06; casos de uso 10.5 y 10.6 con sus prototipos), análisis de intervenciones y la API del commit `c2152c2`.
> **Para qué:** definir qué pantallas hay, qué muestra cada una y qué se puede hacer en ella. De acá salen dos cosas: la etapa de backend "API para el front" (sección 6) y las etapas del frontend (sección 7).

---

## 1. Reglas generales

1. **El menú y los botones salen de los permisos del usuario, no del nombre del perfil** (RNF-06). Los perfiles de la sección 4 sirven para ordenar el mapa, pero un usuario con permisos combinados ve todo lo que le corresponde.
2. **Escritorio primero.** En GI-RE el sistema se va a usar principalmente desde computadoras, incluidas las de planta. Todas las pantallas se diseñan para una pantalla de escritorio normal.
   - **Celular, por ahora:** la pantalla se acomoda sola (Mantine lo da casi sin costo), así que el sistema se puede usar desde un celular aunque no esté optimizado. Esto alcanza para cumplir RNF-03 y el caso de uso 10.5.
   - **Celular, más adelante:** si se confirma que se usa, se hace una **vista propia para celular** solo de las pantallas de planta (O1 a O3, y R3 si hace falta). Es la etapa M de la sección 7.
3. **Una acción principal por pantalla.** En las pantallas del operario, los botones y los textos son más grandes que en el resto, porque las usa gente que no está todo el día frente a la computadora.
4. **Solo se muestran las acciones que el usuario puede hacer en ese momento.** El backend dice cuáles son (sección 6, API-01). El frontend no repite la lógica de estados y permisos.
5. **Los estados se muestran siempre con color, texto e ícono**, nunca solo con color, y usando la tabla de la sección 2.
6. **Los tiempos se muestran en formato legible:** "hace 1 h 20 min", "2 h 15 min", con la marca "en curso" cuando el contador sigue corriendo.
7. **Los errores se muestran según su `codigo`,** con un texto claro para el usuario. `NO_AUTENTICADO` y `SESION_INVALIDADA` llevan al ingreso.
8. **Nada específico de una empresa en el código.** El sistema se llama **"Sistema de Mantenimiento Industrial"**. El nombre de la empresa y el logo salen de la configuración de cada instalación (API-07), así se puede usar en cualquier empresa sin tocar el código.
9. **Colores:** paleta tomada de SolGest (verde `emerald`, superficies `slate`/`zinc`). Los tamaños son los de un sistema de gestión en computadora y más grandes en las pantallas de planta. Librería: Mantine (pendiente de registrar como decisión).

---

## 2. Tabla única de estados

| Entidad | Estado | Texto | Color propuesto |
| :--- | :--- | :--- | :--- |
| Intervención | `PENDIENTE` | Pendiente | ámbar |
| Intervención | `EN_PROCESO` | En proceso | azul |
| Intervención | `EN_ESPERA_REPUESTOS` | Esperando repuestos | violeta |
| Intervención | `FINALIZADA` | Finalizada | verde |
| Intervención | `CANCELADA` | Cancelada | gris |
| Máquina | `OPERATIVA` | Operativa | verde |
| Máquina | `DETENIDA` | Detenida | rojo |
| Máquina | `EN_MANTENIMIENTO` | En mantenimiento | azul |
| Máquina | `FUERA_DE_SERVICIO` | Fuera de servicio | gris oscuro |

Los tonos exactos se definen en la etapa F0.

---

## 3. Pantallas comunes

| ID | Pantalla | Dispositivo | Qué muestra y qué permite | API |
| :-: | :--- | :--- | :--- | :--- |
| C1 | Ingreso | ambos | Nombre del sistema; logo y nombre de la empresa, si están configurados; legajo y contraseña. | `POST /auth/login`, `GET /configuracion/publica` (API-07) |
| C2 | Cambio de contraseña | ambos | Obligatoria en el primer ingreso: no deja seguir hasta cambiarla. También se entra desde "Mi cuenta". | `POST /auth/cambiar-password` |
| C3 | Notificaciones | ambos | Campana con contador en la barra superior; bandeja con los avisos; marcar uno o todos como leídos; tocar un aviso lleva a la intervención. | `GET /notificaciones`, `/contador`, `/:id/leer`, `/leer-todas` |
| C4 | Mi cuenta | ambos | Nombre, legajo, perfil, sectores; cambiar contraseña; cerrar sesión. | `GET /auth/me` |

---

## 4. Pantallas por perfil

### 4.1 Operario — computadora de planta (celular más adelante)

| ID | Pantalla | Qué muestra | Acciones | API |
| :-: | :--- | :--- | :--- | :--- |
| O1 | Inicio del operario | Botón grande **"Reportar falla"**. Debajo, "Mis reportes" como tarjetas: máquina, estado, hace cuánto se reportó y responsable, si ya tiene. | Reportar falla; abrir un reporte | `GET /intervenciones` (alcance PROPIAS) |
| O2 | Reportar falla | Máquina (buscador por nombre o código, con las de sus sectores primero). Al elegirla, si ya tiene fallas abiertas, aviso: "Esta máquina ya tiene 1 falla abierta". Igual se puede reportar. "¿La máquina quedó detenida?" con dos botones grandes Sí/No; descripción; observaciones (opcional). Usuario, fecha y hora a la vista como dato de control, como pide el prototipo 10.5.2. | Guardar; cancelar. Al guardar se confirma con el número de reporte. | `GET /maquinas` + **falta** la cantidad de abiertas (API-06), `POST /intervenciones` |
| O3 | Detalle de mi reporte | Estado, responsable, cuánto lleva esperando, historial simple. | Editar, solo si sigue pendiente y sin responsable (regla de la Etapa 6) | `GET /intervenciones/:id`, `PATCH /intervenciones/:id` |

### 4.2 Responsable de mantenimiento — computadora

| ID | Pantalla | Qué muestra | Acciones | API |
| :-: | :--- | :--- | :--- | :--- |
| R1 | Tablero | Contadores de máquinas detenidas, en mantenimiento y fuera de servicio; contadores de intervenciones sin asignar, en proceso, esperando repuestos y asignadas a mí. Lista "Detenidas ahora", con el tiempo de inactividad en curso. | Tocar un contador abre la lista filtrada | **Falta** (API-03) |
| R2 | Intervenciones | Pestañas: Sin asignar · Mías · Abiertas · Cerradas. Filtros por estado, máquina, sector, tipo, responsable y fechas; búsqueda por texto. En computadora es una tabla: número, máquina, estado, tipo, responsable, antigüedad, si detiene la máquina y duración. | Abrir; nueva intervención | `GET /intervenciones` + **falta** filtros y paginación (API-02) |
| R3 | **Detalle de intervención** (la pantalla central) | Cabecera: número, máquina, estado, tipo, responsable, si detiene la máquina. Bloques: descripción y trabajo realizado; **tiempos** (espera, bruta, neta, total, inactividad, marca "en curso"); detenciones de la máquina; **historial** (cada cambio con cuándo ocurrió y cuándo se registró). Más adelante: repuestos, costos y documentos. | **Barra de acciones con solo las disponibles:** tomar, asignar o quitar responsable, iniciar, esperar repuestos, reanudar, finalizar, resolver ahora, cancelar, reabrir, registrar detención, editar, eliminar. Cada una abre un diálogo corto con los datos que pide. Ejemplo: finalizar pide trabajo realizado, interna o externa, fecha de fin y si la máquina volvió a funcionar. | `GET /intervenciones/:id` + las acciones existentes; **falta** API-01 |
| R4 | Máquinas | Lista con estado (color), sector e intervenciones abiertas. Filtros por sector y estado. | Abrir; nueva máquina (si tiene `MAQUINAS_GESTIONAR`) | `GET /maquinas` + **falta** la cantidad de abiertas (API-06) |
| R5 | Detalle de máquina | Datos; estado actual y desde cuándo; detenciones abiertas; inactividad de los últimos 30 días, con selector de fechas; historial de intervenciones de esa máquina. | Reportar falla en esta máquina; confirmar recuperación (volver a operativa); fuera de servicio y vuelta; editar o desactivar (si tiene permiso) | `GET /maquinas/:id`, `/detenciones-abiertas`, `/inactividad`, `/confirmar-recuperacion`, `/estado`; **falta** filtrar intervenciones por máquina (API-02) |

### 4.3 Administrador — computadora

| ID | Pantalla | Qué muestra | Acciones | API |
| :-: | :--- | :--- | :--- | :--- |
| A1 | Usuarios | Lista con filtros por activo, perfil y sector. | Abrir; nuevo usuario | `GET /usuarios` |
| A2 | Alta y edición de usuario | Datos, perfil, sectores, contraseña temporal (en el alta), excepciones de permisos. | Guardar; desactivar o reactivar; restablecer contraseña | `POST`, `PATCH /usuarios/:id`, `/desactivar`, `/reactivar`, `/restablecer-password`; **falta** gestionar excepciones (API-05) |
| A3 | Sectores | Lista simple. | Alta, edición, baja | `/sectores` |
| A4 | Perfiles | Consulta de cada perfil y sus permisos. Solo lectura por ahora. | — | `GET /perfiles` |

El alta, edición y baja de máquinas se hace desde R4 y R5, con los botones que da el permiso. No hay una pantalla aparte.

### 4.4 Consulta, Dirección e I+D — computadora

| ID | Pantalla | Qué muestra | Acciones | API |
| :-: | :--- | :--- | :--- | :--- |
| D1 | Reportes | **Inactividad por máquina:** ranking con barras, filtro de fechas y de sector. **Tiempos:** tabla agrupada por ejecución (interna o externa), tipo o sector. | Cambiar fechas y agrupación | `GET /reportes/inactividad`, `/reportes/tiempos` |

Además ven R1, R2, R3, R4 y R5 en modo consulta, según sus permisos.

---

## 5. Navegación

| Ítem del menú | Se muestra si tiene | Lleva a |
| :--- | :--- | :--- |
| Inicio | siempre | R1 si puede ver intervenciones ajenas (alcance `SECTORES` o `TODAS`); si no, O1 |
| Reportar falla | `INTERVENCIONES_CREAR` | O2 |
| Intervenciones | `INTERVENCIONES_VER` | R2 (el operario ve solo las suyas) |
| Máquinas | siempre | R4 |
| Reportes | `REPORTES_CONSULTAR` | D1 |
| Usuarios | `USUARIOS_GESTIONAR` | A1 |
| Sectores | `MAQUINAS_GESTIONAR` | A3 |
| Avisos (campana) | siempre | C3 |

**En computadora:** menú lateral, como en SolGest. **En celular, por ahora:** el mismo menú se pliega detrás del botón de tres rayitas. La barra inferior queda para la etapa M.

---

## 6. Lo que le falta a la API (insumo para la etapa "API para el front")

| ID | Qué | Para qué pantalla | Prioridad |
| :-: | :--- | :--- | :-: |
| API-01 | **Acciones disponibles** en `GET /intervenciones/:id`: la lista de acciones que ese usuario puede hacer ahora. Se calcula con la misma tabla `TRANSICIONES`, los permisos y las reglas de actor. | R3 (y O3) | alta |
| API-02 | **Filtros y paginación** en `GET /intervenciones`: estado (varios), máquina, sector, tipo, responsable o "mías", rango de fechas, texto; `limit`, `offset` y total. | R2, R5, O1 | alta |
| API-03 | **Resumen para el tablero:** máquinas por estado, intervenciones por estado, sin asignar, asignadas a mí y detenidas ahora con su inactividad en curso. | R1 | alta |
| API-04 | **Catálogo de tipos de intervención**, para el filtro. | R2 | baja |
| API-05 | **Gestión de excepciones de permisos por usuario:** hoy se pueden leer pero no crear ni quitar. Se hace **antes de F4**, en una etapa aparte. | A2 | media |
| API-06 | **Cantidad de intervenciones abiertas por máquina** en `GET /maquinas`. Es solo un número, sin el detalle, así que no muestra datos que el operario no puede ver. | R4 y el aviso de O2 | media |
| API-07 | **Marca configurable por instalación:** nombre del sistema, nombre de la empresa y logo, guardados en la base y leídos sin iniciar sesión (los usa la pantalla de ingreso). | C1 y barra superior | alta |

---

## 7. Etapas del frontend propuestas

| Etapa | Contenido |
| :-: | :--- |
| F0 | Base: Mantine, tema con la paleta, menú lateral, ingreso, cambio de contraseña, campana de avisos, cliente de la API con manejo de errores por `codigo`, tabla de estados. |
| F1 | Operario: O1, O2, O3. |
| F2 | Intervenciones: R2 y R3 con todas las acciones. |
| F3 | Tablero y máquinas: R1, R4, R5. |
| F4 | Administración: A1 a A4. |
| F5 | Reportes: D1. |
| M | **Más adelante, si se confirma el uso en celular:** vista propia para celular de O1, O2 y O3 (y R3 si hace falta), con barra inferior y botones grandes. |

Después, Repuestos y stock, Costos y Preventivos entran como etapas completas, cada una con su backend y sus pantallas. La interfaz provisional (`dev-ui`) se borra cuando el frontend nuevo cubra lo mismo.

---

## 8. Definido con Andrés

1. **Dispositivo:** escritorio primero. Celular por ahora solo con la pantalla que se acomoda sola; la vista propia queda para la etapa M.
2. **Quién hace los arreglos:** sin preferencia. Como es escritorio primero, R3 se diseña para computadora y queda disponible para cualquier usuario con permisos sobre la intervención.
3. **Reportes duplicados:** sin preferencia; se decidió **mostrar el aviso** (API-06), porque cuesta poco y evita trabajo repetido.
4. **Sistema general, no atado a GI-RE:** nombre fijo "Sistema de Mantenimiento Industrial"; empresa y logo por configuración (API-07). El logo de GI-RE no se sube al repositorio: se carga en la instalación de GI-RE.

## 9. Pendiente

- **Computadoras de planta compartidas:** si varios operarios usan la misma computadora, conviene un cierre automático de la sesión después de unos minutos sin uso. Por ahora: "Salir" siempre visible en la barra superior. El cierre automático se decide cuando se confirme cómo se usan.
