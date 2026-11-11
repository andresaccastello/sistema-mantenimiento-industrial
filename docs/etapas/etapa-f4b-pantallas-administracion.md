# Etapa F4b — Pantallas de administración

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `94eb19a` (Etapa F4a).
> **Base:**
>
> - `docs/front/mapa-pantallas.md`: pantallas A1 a A4 y las reglas de la sección 1;
> - la API de la F4a (`docs/etapas/etapa-f4a-api-administracion.md`) y la de la API-05;
> - lo ya hecho en la F3b: la lista R4, el detalle R5 y `ModalMaquina`.
>
> **Para qué:** que el administrador gestione usuarios, permisos, sectores y catálogos desde el sistema, sin la interfaz provisional ni SQL.

**De la F4a, lo que funciona y no se toca.** Lo revisé en mi base y en una copia como la principal:

- `test:todo` en verde, con 328 pruebas y los once números en 0; las tablas que las pruebas no crearon quedan intactas, catálogos incluidos;
- a mano, unos 45 casos: bajas en uso con sus conteos, valor por omisión, orden, altas y cambios simultáneos, reactivar una máquina con su tipo inactivo, sectores inactivos ya asignados e historial;
- la corrección de la API-05: EX-11 en verde.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`.
2. **Dos commits**, para revisarlos por separado:
   1. sección 1: las correcciones del backend y sus pruebas;
   2. todo lo demás.
3. **No se agregan dependencias.**
4. **Documentación oficial a seguir:**
   - Mantine 9: `Table` y `Table.ScrollContainer`, `Tabs`, `Modal`, `Select`, `MultiSelect`, `SegmentedControl`, `Switch`, `Menu`, `Alert` y `Tooltip`;
   - React Router 7: `useSearchParams` y `useLocation`;
   - TanStack Query 5: `useQuery`, `useMutation` e `invalidateQueries`.
5. Lo que está en `lib/` sigue siendo lógica pura, sin React y sin `fetch`.
6. **Las reglas las decide el backend.** El frontend oculta o deshabilita lo que no corresponde, pero igual muestra todo error de la API según su `codigo`.
7. **Tamaño de los archivos:** ninguna pantalla pasa de 500 líneas. Los diálogos van en `componentes/admin/`, uno por archivo. Es la lección de `DetalleMaquina.tsx`.
8. Ante cualquier duda o diferencia con el mapa de pantallas, **frenar y preguntar**.

Guardar este archivo como `docs/etapas/etapa-f4b-pantallas-administracion.md`.

---

## 1. Correcciones del backend (primer commit)

Salieron de probar a mano la F4a.

### 1.1 Orden con un id repetido escrito de otra forma

`PUT /api/criticidades/orden` con `{ "ids": [1, "1", 3, …] }` responde 200. El 1 y el "1" pasan como distintos, y la fila que falta queda con un `orden` alto. Así quedó en mi base: `1:2 3:3 164:4 166:5 2:7`.

**Corrección:**

- convertir cada id a número **antes** de controlar repetidos y faltantes;
- un id que no es un entero positivo: 400;
- lo mismo en `/api/tipos-equipo/orden`.

**Prueba:** se amplía AD-10 con un caso (c): `[x, String(x), …resto]` da 400, y el orden en la base no cambia.

### 1.2 Cuerpos que no son un objeto

En el alta y la edición, un cuerpo `null`, un número, un arreglo o un texto que no es JSON hoy da 500 en varias rutas. Por ejemplo:

- `POST /api/criticidades` con `null`;
- `PUT /api/plantas/:id` con texto.

**Corrección:**

- una función en `validations.ts` que lea el cuerpo y devuelva 400 `DATOS_INVALIDOS` si no es un objeto JSON;
- se usa en `POST` y `PUT` de sectores, plantas, criticidades, tipos de equipo y máquinas.

**Prueba AD-17:** en esas diez rutas, los cuerpos `null` y `texto` dan 400 `DATOS_INVALIDOS`.

### 1.3 Cierre del commit

- Durante el trabajo, correr solo `test:administracion`.
- Mensaje: `fix(api): orden y cuerpos invalidos en catalogos`.
- El `test:todo` va una sola vez, al cerrar la etapa (sección 11).

---

## 2. Base del frontend

### 2.1 Tipos (`api/tipos.ts`)

En `PlantaAdmin`, quitar `creado_en`: la API no lo manda.

### 2.2 Mensajes de error (`lib/errores.ts`)

| `codigo` | Mensaje | ¿Recarga? |
| :--- | :--- | :-: |
| `LEGAJO_DUPLICADO` | Ya hay otro usuario con ese legajo. | no |
| `PASSWORD_INVALIDA` | La contraseña temporal tiene que tener al menos 8 caracteres y no puede ser igual al legajo. | no |
| `PERFIL_NO_ASIGNABLE` | No podés asignar ese perfil: tiene permisos que vos no tenés. | no |
| `ULTIMO_ADMINISTRADOR` | Es el único administrador activo: no se le puede cambiar el perfil ni desactivar. | sí |
| `AUTOGESTION_NO_PERMITIDA` | Eso no lo podés hacer sobre tu propio usuario. | no |
| `PERMISO_NO_OTORGABLE` | No podés dar ni quitar un permiso que no tenés, ni un alcance mayor que el tuyo. | no |
| `EXCEPCION_NO_ENCONTRADA` | Esa excepción ya no existe. | sí |
| `USUARIO_NO_ENCONTRADO` | No encontramos ese usuario. | no |
| `NOMBRE_DUPLICADO` | Ya existe otro con ese nombre. | no |
| `CODIGO_DUPLICADO` | Ya existe otro con ese código. | no |
| `EN_USO` | No se puede desactivar: todavía lo usan datos activos. | sí |
| `ES_POR_OMISION` | Es el valor por omisión. Marcá otro antes de desactivarlo. | sí |
| `SECTOR_NO_ENCONTRADO` | No encontramos ese sector. | sí |
| `CRITICIDAD_NO_ENCONTRADA` | No encontramos esa criticidad. | sí |
| `TIPO_EQUIPO_NO_ENCONTRADO` | No encontramos ese tipo de equipo. | sí |

**Errores en su campo:** `LEGAJO_DUPLICADO`, `PASSWORD_INVALIDA`, `NOMBRE_DUPLICADO` y `CODIGO_DUPLICADO` se muestran en el campo que corresponde, como `CODIGO_MAQUINA_DUPLICADO` en `ModalMaquina`.

### 2.3 Consultas

- Las consultas de administración usan `?all=true` y su propia clave: por ejemplo `['criticidades', { all: true }]`.
- Después de guardar, se invalida por prefijo: `['criticidades']`, `['tipos-equipo']`, `['plantas']`, `['sectores']`, `['usuarios']`, `['usuario', id]`, `['perfiles']`. Así R4 y `ModalMaquina` también se enteran.

---

## 3. Lógica pura nueva (`lib/`)

### 3.1 `lib/usuarios.ts`: filtros de A1 y validaciones

```ts
interface FiltrosUsuarios {
  texto: string;                                   // legajo, nombre o apellido
  estado: 'activos' | 'inactivos' | 'todos';       // por omisión, 'activos'
  perfilId: number | null;
  sectorId: number | null;
}
```

| Función | Qué hace |
| :--- | :--- |
| `leerFiltrosUsuarios(params)` | Claves `q`, `estado`, `perfil` y `sector`. Un valor inválido se reemplaza por el de omisión, como en `leerFiltros`. |
| `escribirFiltrosUsuarios(filtros)` | Sin las claves que tienen su valor por omisión. Ida y vuelta da lo mismo. |
| `filtrarUsuarios(usuarios, filtros)` | El texto con `normalizarTexto`, sobre legajo, nombre y apellido. El sector, por `usuario.sectores`. Conserva el orden de entrada. |
| `hayFiltrosUsuarios(filtros)` | `true` si algún filtro no tiene su valor por omisión. |
| `validarPasswordTemporal(password, legajo)` | El texto del error o `null`. Las mismas reglas que la API: al menos 8 caracteres, y distinta del legajo sin importar mayúsculas ni espacios. |
| `validarMotivo(motivo)` | "Indicá el motivo (al menos 5 caracteres)." si tiene menos de 5 caracteres sin contar los espacios de los extremos; si no, `null`. |

### 3.2 `lib/permisos.ts`

**`etiquetaAlcance(alcance, usaAlcance)`:**

- `PROPIAS` → "Propias";
- `SECTORES` → "Sus sectores";
- `TODAS` → "Todas";
- si el permiso no usa alcance → "Sí".

**`grupoPermiso(codigo)`**, por el prefijo del código, en este orden:

| Prefijo | Grupo |
| :--- | :--- |
| `INTERVENCIONES_` | Intervenciones |
| `MAQUINAS_` | Máquinas |
| `REPORTES_` | Reportes |
| `NOTIFICACIONES_` | Avisos |
| `USUARIOS_`, `PERMISOS_` | Usuarios y permisos |
| `REPUESTOS_`, `COSTOS_`, `DOCUMENTOS_`, `PLANES_` | Módulos futuros |
| otro | Otros |

**`filasPermisos(catalogo, permisosPerfil, excepciones, efectivos)`** arma la tabla de permisos de A2. Una fila por permiso del catálogo, agrupadas por `grupoPermiso` y ordenadas por nombre dentro de cada grupo. Cada fila tiene:

- `porPerfil`: el alcance que le da el perfil, o `null`;
- `excepcion`: la excepción que tiene, o `null`;
- `resultado`: el de `efectivos`, que viene de la API. No se recalcula.

**`opcionesExcepcion(permiso, permisosActor)`** devuelve `{ gestionable, alcances }`:

- `gestionable`: si quien está usando el sistema tiene ese permiso;
- `alcances`: los que puede conceder, del más chico hasta el suyo. Si el permiso no usa alcance, la lista va vacía.

Usa la misma jerarquía que la API: `PROPIAS` < `SECTORES` < `TODAS`.

**`perfilAsignable(permisosDelPerfil, permisosActor)`:** `true` si quien está usando el sistema tiene todos los permisos del perfil, con un alcance igual o mayor. Es la misma regla que `validarAsignacionPerfil`.

**`matrizPerfiles(perfiles, catalogo)`:** filas por permiso, agrupadas como en `filasPermisos`, con una columna por perfil. Cada celda es el texto de `etiquetaAlcance`, o "—" si el perfil no tiene ese permiso.

### 3.3 `lib/auditoria.ts`

**`textoAuditoria(registro, referencias, catalogo)`** devuelve `{ titulo, detalle }`:

| `accion` | Título | Detalle |
| :--- | :--- | :--- |
| `USUARIO_CREADO` | Alta del usuario | "Perfil {perfil}. Sectores: {lista}." |
| `USUARIO_MODIFICADO` | Datos cambiados | "{nombre y apellido anteriores} → {nuevos}" |
| `PERFIL_CAMBIADO` | Perfil cambiado | "{perfil anterior} → {perfil nuevo}" |
| `SECTORES_CAMBIADOS` | Sectores cambiados | "{lista anterior} → {lista nueva}" |
| `USUARIO_DESACTIVADO` | Usuario desactivado | "Motivo: {motivo}." Si era responsable de intervenciones abiertas, se agrega "Era responsable de {n} intervención/intervenciones abierta(s)." |
| `USUARIO_REACTIVADO` | Usuario reactivado | "Motivo: {motivo}." |
| `PASSWORD_RESTABLECIDA` | Contraseña restablecida | — |
| `PASSWORD_CAMBIADA` | Cambió su contraseña | — |
| `EXCEPCION_CREADA` | Excepción agregada | "{permiso}: {efecto}. Motivo: {motivo}." |
| `EXCEPCION_MODIFICADA` | Excepción cambiada | "{permiso}: {anterior} → {nuevo}. Motivo: {motivo}." |
| `EXCEPCION_ELIMINADA` | Excepción quitada | "{permiso}: era {anterior}. Motivo: {motivo}." |
| otra | el código tal cual | — |

**Cómo se escribe cada dato:**

- **Perfiles:** con `nombrePerfil`.
- **Sectores:** separados por coma; si no hay ninguno, "ninguno".
- **Permisos:** por su nombre en el catálogo; si no está, el código.
- **Efecto:**
  - "Concede, {alcance}" con `etiquetaAlcance`;
  - "Concede", si el permiso no usa alcance;
  - "Deniega".
- **Un id que no está en `referencias`:** "Perfil {id}" o "Sector {id}".
- **Si el `detalle` no es un objeto:** el detalle queda vacío.

### 3.4 `lib/catalogos.ts`

| Función | Qué hace |
| :--- | :--- |
| `codigoDesdeNombre(nombre)` | Sugiere un código:<br>• en mayúsculas y sin tildes, con "Ñ" → "N";<br>• lo que no es letra ni número pasa a "\_", sin "\_" repetidos ni en los extremos;<br>• si empieza con un número, se le antepone "N\_";<br>• hasta 30 caracteres, sin "\_" final.<br>Nombre vacío: "". |
| `codigoValido(codigo)` | El mismo formato que la API: `^[A-Z][A-Z0-9_]{0,29}$`. |
| `moverEnOrden(ids, id, direccion)` | Devuelve una lista nueva con ese id un lugar más arriba (`-1`) o más abajo (`+1`). En los extremos, la devuelve igual. |
| `motivoNoDesactivableSector(sector)` | El texto o `null`, con los conteos de `?all=true`. Ver la tabla de abajo. |
| `motivoNoDesactivablePlanta(planta)` | Ídem. |
| `motivoNoDesactivableCatalogo(item, entidad)` | Ídem; `entidad` es `'criticidad'` o `'tipo'`. |

**Textos de `motivoNoDesactivable…`**, en singular o plural según el número, y con "y" si hay dos conteos:

| Caso | Texto |
| :--- | :--- |
| Sector con máquinas o usuarios activos | "Tiene {n} máquina(s) activa(s) y {m} usuario(s) activo(s). Pasá las máquinas a otro sector o desactivalas, y quitales el sector a los usuarios, antes de desactivarlo." Cada parte va solo si su número es mayor que 0. |
| Planta con sectores activos | "Tiene {n} sector(es) activo(s). Pasalos a otra planta o desactivalos antes de desactivarla." |
| Valor por omisión | "Es el valor por omisión. Marcá otro antes de desactivarlo." Tiene prioridad sobre el siguiente. |
| Criticidad o tipo en uso | "Lo usan {n} máquina(s) activa(s). Cambiales la criticidad (o el tipo) antes de desactivarlo." |

---

## 4. A1 — Usuarios (`/usuarios`)

### 4.1 Datos

- `GET /api/usuarios`, sin parámetros: trae activos e inactivos. Clave `['usuarios']`.
- Para los filtros: `GET /api/perfiles` y `GET /api/sectores`.
- **Los filtros se aplican en el frontend** (`filtrarUsuarios`) y van en la dirección, como en R4.

### 4.2 Encabezado y filtros

- **Título:** "Usuarios".
- **Botones:** "Ver perfiles", que lleva a A4, y "Nuevo usuario" (sección 5.7).
- **Filtros,** en `SimpleGrid`, cada uno con su `aria-label`:
  - Buscar (legajo, nombre o apellido);
  - Estado: Activos, Inactivos, Todos;
  - Perfil;
  - Sector.
- **Línea del conteo:** "{n} usuario(s)" y "Limpiar filtros", como en R4.

### 4.3 Tabla

| Columna | Contenido |
| :--- | :--- |
| Usuario | `nombreCompleto` y, debajo, el legajo en gris. Un usuario inactivo lleva el distintivo "Inactivo" y la fila en gris. |
| Perfil | `nombrePerfil` |
| Sectores | Los nombres, separados por coma, o "—". |
| Último acceso | "hace …", o "Nunca". |
| Contraseña | "Debe cambiarla", si `debe_cambiar_password`; si no, vacío. |

- **Al tocar una fila** se abre A2, con `volverA`, como en R4.
- **Sin resultados con filtros:** "No hay usuarios con estos filtros." y "Limpiar filtros".

---

## 5. A2 — Usuario (`/usuarios/:id`)

### 5.1 Datos

| Consulta | Clave |
| :--- | :--- |
| `GET /api/usuarios/:id` | `['usuario', id]` |
| `GET /api/perfiles` | `['perfiles']` |
| `GET /api/permisos` | `['permisos']` |
| `GET /api/sectores` | `['sectores']` |
| `GET /api/usuarios/:id/auditoria?limit={n}` | `['usuario', id, 'auditoria', n]` |

**Quien está usando el sistema** es `useAuth().usuario`. Sus permisos son `usuario.permisos`.

### 5.2 Sobre uno mismo

Si el id es el del propio usuario:

- no hay botones;
- un `Alert` informativo: "Este es tu usuario. Tus datos y permisos los cambia otro administrador. Tu contraseña, desde Mi cuenta.", con un enlace a Mi cuenta.

### 5.3 Cabecera

- "← Usuarios", con `volverA`.
- **Título:** el nombre completo.
- **Debajo:** el legajo y el perfil, más los distintivos "Inactivo" y "Debe cambiar la contraseña" cuando correspondan.
- **Botón principal:** "Editar" (5.4).
- **"Más acciones":** "Restablecer contraseña" (5.5) y "Desactivar" o "Reactivar" (5.6).

### 5.4 Bloque "Datos" y edición

**El bloque muestra:**

- nombre y apellido;
- legajo;
- perfil;
- sectores;
- último acceso, alta y última modificación, con `formatFechaHora`.

**"Editar" abre `ModalUsuario`**, el mismo del alta, en modo edición. Se puede cambiar:

- nombre y apellido;
- perfil;
- sectores.

El legajo no se cambia. Se manda un `PATCH` **solo con lo que cambió**.

- **Perfil:**
  - un `Select` con los perfiles activos;
  - los que no cumplen `perfilAsignable` aparecen deshabilitados, con la descripción "Tiene permisos que vos no tenés.";
  - el perfil actual siempre aparece.
- **Sectores:**
  - un `MultiSelect` con los sectores activos;
  - un sector inactivo que el usuario ya tiene aparece igual, con "(inactivo)", y se puede conservar (D-015).
- **Aviso al guardar:** "Cambios guardados.".

### 5.5 Restablecer contraseña

- Diálogo con el campo "Contraseña temporal", validado con `validarPasswordTemporal`.
- **Texto del diálogo:** "La persona va a tener que cambiarla al entrar. Se cierran las sesiones que tenga abiertas."
- **Aviso al guardar:** "Contraseña restablecida.".

### 5.6 Desactivar y reactivar

- **Desactivar:**
  - diálogo con "Motivo", obligatorio y validado con `validarMotivo`;
  - si `intervenciones_abiertas_como_responsable` es mayor que 0, un `Alert`: "Es responsable de {n} intervención/intervenciones abierta(s). Siguen a su nombre hasta que alguien las reasigne.";
  - texto del diálogo: "No va a poder entrar al sistema. Se cierran las sesiones que tenga abiertas. Su historial se conserva.";
  - el 409 `ULTIMO_ADMINISTRADOR` se muestra dentro del diálogo.
- **Reactivar:** diálogo con "Motivo", igual de obligatorio.

### 5.7 Alta (`ModalUsuario`, desde A1)

| Campo | Regla |
| :--- | :--- |
| Legajo | Obligatorio, sin espacios en los extremos. `LEGAJO_DUPLICADO` se muestra en este campo. |
| Nombre | Obligatorio. |
| Apellido | Opcional. |
| Perfil | Obligatorio, con la regla de 5.4. |
| Sectores | Opcional. |
| Contraseña temporal | Obligatoria, con `validarPasswordTemporal`. Debajo, en gris: "La persona la cambia la primera vez que entra." |

- `POST /api/usuarios`.
- **Aviso al guardar:** "Usuario creado. Pasale la contraseña temporal.".
- Después, se abre su A2.

### 5.8 Bloque "Permisos"

**Tabla con `filasPermisos`**, con una fila de título por grupo:

| Columna | Contenido |
| :--- | :--- |
| Permiso | El nombre y, debajo, la descripción en gris. |
| Por su perfil | `etiquetaAlcance`, o "—". |
| Excepción | "Concede, {alcance}", "Concede" o "Deniega", con el motivo, quién la dio y cuándo en un `Tooltip`. Vacío si no hay. |
| Resultado | `etiquetaAlcance` del resultado, o "No". En negrita si es distinto de lo que da el perfil. |
| (acciones) | Ver abajo. |

**Acciones**, solo si se cumplen las tres cosas:

- quien usa el sistema tiene `PERMISOS_GESTIONAR`;
- no es el propio usuario;
- `opcionesExcepcion(...).gestionable` da `true`.

| Si la fila… | Acciones |
| :--- | :--- |
| no tiene excepción | "Agregar excepción" |
| tiene excepción | "Cambiar" y "Quitar" |

**Diálogo de excepción (`ModalExcepcion`):**

- **Permiso:** fijo, el de la fila.
- **Efecto:** `SegmentedControl` con "Conceder" y "Denegar".
- **Alcance:** solo al conceder un permiso con `usa_alcance`. Un `SegmentedControl` con los `alcances` de `opcionesExcepcion`.
- **Motivo:** obligatorio, con `validarMotivo`.
- **Envío:** `PUT /api/usuarios/:id/excepciones/:codigo`.
- **Aviso al guardar:** "Excepción guardada. Vale desde su próximo pedido, sin volver a entrar.".

**Quitar:** diálogo con "Motivo" y `DELETE`. Aviso: "Excepción quitada.".

**Debajo de la tabla,** una línea en gris: "Las excepciones cambian lo que da el perfil solo para esta persona. Denegar tiene prioridad."

### 5.9 Bloque "Historial"

- Cada registro, con `textoAuditoria`, en este orden:
  - la fecha y quién lo hizo: `nombreCompleto`, o "Usuario eliminado";
  - el título, en negrita;
  - el detalle.
- Empieza con `limit=20`. "Ver más" suma 20, hasta 200. Se oculta cuando ya están todos (`total`).
- **Sin registros:** "Sin cambios registrados.".

---

## 6. A3 — Sectores y catálogos (`/sectores`)

### 6.1 Estructura

- **Título:** "Sectores y catálogos".
- **Pestañas (`Tabs`):** Sectores · Plantas · Criticidades · Tipos de equipo.
- La pestaña va en la dirección (`?pestana=plantas`, etc.). Sin clave, es "Sectores".
- Cada pestaña:
  - pide su lista con `?all=true`;
  - tiene su botón "Nuevo…".
- **Sectores y Plantas** tienen un `Switch` "Ver desactivados", que filtra en el frontend.
- **Criticidades y Tipos de equipo** muestran siempre todas las filas, con las desactivadas en gris. Son listas cortas, y así el orden que se ve es el mismo que se guarda.

### 6.2 Pestaña Sectores

| Columna | Contenido |
| :--- | :--- |
| Sector | El nombre y, debajo, la descripción en gris. Si está desactivado, el distintivo "Desactivado" y la fila en gris. |
| Planta | El nombre, o "—". |
| Máquinas activas | El número. Si es mayor que 0, enlace a `/maquinas?sector=<id>`. |
| Usuarios activos | El número. Si es mayor que 0 y quien usa el sistema tiene `USUARIOS_GESTIONAR`, enlace a `/usuarios?sector=<id>`. |
| (acciones) | "Editar" y, en un menú, "Desactivar" o "Reactivar". |

**`ModalSector`** (alta y edición):

- **Campos:** nombre (obligatorio), descripción y planta.
- **Planta:** las activas. Si el sector ya tiene una planta inactiva, aparece igual, con "(inactiva)".
- `NOMBRE_DUPLICADO` va en el campo nombre.
- **Edición:** se manda solo lo que cambió.

**Desactivar:**

- Si `motivoNoDesactivableSector` devuelve un texto, el diálogo lo muestra en un `Alert`, con solo "Volver".
- Si no, se confirma con "El sector deja de aparecer en las listas. Su historial se conserva."

**Reactivar:**

- confirmación simple;
- el 400 de "planta inactiva" se muestra dentro del diálogo.

### 6.3 Pestaña Plantas

| Columna | Contenido |
| :--- | :--- |
| Planta | El nombre y, debajo, la descripción. Con el distintivo "Desactivada" cuando corresponde. |
| Sectores activos | El número. |
| (acciones) | Como en sectores. |

- **`ModalPlanta`:** nombre (obligatorio) y descripción.
- **Desactivar:** con `motivoNoDesactivablePlanta`, igual que en sectores.

### 6.4 Pestañas Criticidades y Tipos de equipo

Las dos comparten el componente: solo cambian la ruta de la API y la columna "Prioridad alta".

| Columna | Contenido |
| :--- | :--- |
| Orden | Dos botones, ↑ y ↓, con `aria-label` "Subir" y "Bajar". Se deshabilitan en los extremos. |
| Nombre | El nombre y, debajo, el código en gris. El distintivo "Por omisión", si lo es. "Desactivada" o "Desactivado", si corresponde. |
| Prioridad alta | Solo criticidades. "Sí", o vacío. |
| Máquinas activas | El número. |
| (acciones) | "Editar" y, en un menú, "Marcar por omisión", si no lo es y está activa, y "Desactivar" o "Reactivar". |

- **Orden:**
  - ↑ y ↓ mandan `PUT …/orden` con la lista **completa**, incluidas las desactivadas, usando `moverEnOrden`;
  - mientras se guarda, los botones quedan deshabilitados.
- **Línea en gris debajo del título, solo en Criticidades:** "El orden se usa en el tablero: las máquinas más críticas aparecen primero."
- **`ModalCatalogo`** (alta y edición):
  - **Nombre:** obligatorio.
  - **Código:**
    - solo en el alta: en la edición se muestra, pero no se puede cambiar;
    - empieza vacío, y mientras se escribe el nombre se completa con `codigoDesdeNombre`, hasta que el usuario lo cambie a mano;
    - se valida con `codigoValido`;
    - `CODIGO_DUPLICADO` va en este campo.
  - **Prioridad alta:** solo criticidades. Un `Switch` con la descripción "Una falla en una máquina con esta criticidad avisa con prioridad alta, aunque no la haya detenido."
- **Marcar por omisión:** confirmación con "Las máquinas nuevas van a tomar este valor si no se elige otro.".
- **Desactivar:** con `motivoNoDesactivableCatalogo`, igual que en sectores.

---

## 7. A4 — Perfiles (`/perfiles`)

- **Datos:** `GET /api/perfiles` y `GET /api/permisos`.
- **Título:** "Perfiles". Subtítulo: "Qué permite cada perfil. Para cambiarle algo a una persona, usá las excepciones en su usuario."
- **"← Usuarios"** vuelve a A1.
- **Tabla con `matrizPerfiles`:**
  - una fila por permiso, agrupadas, con el nombre y la descripción en un `Tooltip`;
  - una columna por perfil, con `nombrePerfil` y, debajo, "{n} usuario(s) activo(s)".
- **Solo lectura.**
- **En celular:** la tabla va dentro de `Table.ScrollContainer`. Se desplaza la tabla, no la página.

---

## 8. Otros cambios

1. **Rutas:**

   | Ruta | Pantalla | Permiso |
   | :--- | :--- | :--- |
   | `/usuarios` | A1, en lugar de "En construcción" | `USUARIOS_GESTIONAR` |
   | `/usuarios/:id` | A2 | `USUARIOS_GESTIONAR` |
   | `/perfiles` | A4 | `USUARIOS_GESTIONAR` |
   | `/sectores` | A3, en lugar de "En construcción" | `MAQUINAS_GESTIONAR` |

2. **Menú:** el ítem "Sectores" pasa a llamarse "Sectores y catálogos". Se modifica FE-04 para esperar el nombre nuevo. Es el único cambio permitido en pruebas existentes.
3. **`docs/front/mapa-pantallas.md`:**
   - A3 pasa a ser "Sectores y catálogos: sectores, plantas, criticidades y tipos de equipo";
   - A4 lleva la ruta `/perfiles`, y se entra desde A1;
   - en la tabla de navegación, el nuevo nombre del ítem.

---

## 9. Quién ve qué

| Quién | A1 y A2 | A3 | A4 |
| :--- | :--- | :--- | :--- |
| Administrador | todo; las excepciones, con `PERMISOS_GESTIONAR` | todo | sí |
| Con `USUARIOS_GESTIONAR` y sin `PERMISOS_GESTIONAR` | todo, pero la tabla de permisos sin acciones | no está en su menú | sí |
| Con `MAQUINAS_GESTIONAR` y sin `USUARIOS_GESTIONAR` | no está en su menú | todo; los conteos de usuarios, sin enlace | no |
| Responsable, Consulta, Operario | no | no | no |

Como en la F3b, la tabla es la consecuencia de los permisos, no una regla aparte.

---

## 10. Pruebas del frontend

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| FE-32 | `leerFiltrosUsuarios`, `escribirFiltrosUsuarios`, `filtrarUsuarios` y `hayFiltrosUsuarios` | **Dirección y filtros:**<br>• dirección vacía: los valores por omisión, con `estado` en `activos`;<br>• `estado=ROTO`: `activos`; `perfil=abc`: `null`;<br>• ida y vuelta con todos los campos: lo mismo; los valores por omisión no se escriben.<br>**Con cinco usuarios de prueba:**<br>• "gómez" encuentra "Gomez";<br>• el legajo también se busca;<br>• el filtro por sector;<br>• `inactivos` deja solo los inactivos;<br>• se conserva el orden.<br>`hayFiltrosUsuarios` es `false` con los valores por omisión. |
| FE-33 | `validarPasswordTemporal` y `validarMotivo` | **Contraseña:**<br>• 7 caracteres: error;<br>• igual al legajo con otras mayúsculas o con espacios: error;<br>• válida: `null`.<br>**Motivo:** "  abcd  ": error; "abcde": `null`. |
| FE-34 | `etiquetaAlcance`, `grupoPermiso` y `filasPermisos` | **Etiquetas:** las cuatro. **Grupos:** cada prefijo de la tabla 3.2, y uno desconocido va a "Otros".<br>**`filasPermisos`**, con un operario que tiene una excepción que concede `INTERVENCIONES_VER` en `TODAS` y otra que deniega `INTERVENCIONES_CREAR`:<br>• `porPerfil`, `excepcion` y `resultado` correctos en las dos filas;<br>• los grupos en el orden de la tabla. |
| FE-35 | `opcionesExcepcion` y `perfilAsignable` | **`opcionesExcepcion`:**<br>• actor con `INTERVENCIONES_VER` en `SECTORES`: gestionable, con `['PROPIAS', 'SECTORES']`;<br>• permiso que no tiene: no gestionable;<br>• permiso sin alcance: alcances vacíos.<br>**`perfilAsignable`:**<br>• el perfil Administrador, para un actor sin `PERMISOS_GESTIONAR`: `false`;<br>• el Operario, para el administrador: `true`;<br>• un perfil con `SECTORES`, para un actor con `PROPIAS`: `false`. |
| FE-36 | `textoAuditoria` | **Cada una de las once acciones**, con un detalle de ejemplo: el título y el detalle de la tabla 3.3.<br>**Casos borde:**<br>• un sector que falta en `referencias`: "Sector 12";<br>• un detalle que no es objeto: detalle vacío;<br>• una acción desconocida: su código como título.<br>**Plurales:** desactivado con 1 y con 2 intervenciones abiertas. |
| FE-37 | `catalogos.ts` | **`codigoDesdeNombre`:**<br>• "Herramienta menor" → `HERRAMIENTA_MENOR`;<br>• "Señal / Pañol" → `SENAL_PANOL`;<br>• "1ra línea" → `N_1RA_LINEA`;<br>• 40 letras → 30;<br>• "" → "".<br>**`codigoValido`:** `ALTA` sí; `alta` y `1A` no.<br>**`moverEnOrden`:** subir el segundo, bajar el primero, y los dos extremos sin cambio.<br>**`motivoNoDesactivable…`:**<br>• sector con 2 máquinas y 1 usuario;<br>• sector solo con 1 usuario;<br>• planta con 1 sector;<br>• por omisión en uso: gana el texto de por omisión;<br>• sin nada: `null`. |
| FE-38 | `matrizPerfiles` | Con dos perfiles y tres permisos, uno de ellos sin alcance: las celdas "Todas", "Sí" y "—" en su lugar, y los grupos en orden. |
| FE-04 (se modifica) | Menú | "Sectores y catálogos" en lugar de "Sectores". |

---

## 11. Lo que voy a revisar yo

Con el backend y el frontend contra mi base local. Capturas a 1440×900 y 390×844.

- **A1:**
  - cada filtro, combinado con otros;
  - la búsqueda sin tildes;
  - volver desde A2 con los filtros.
- **A2, cada acción contra la base:**
  - alta con legajo repetido y con contraseña inválida;
  - edición que manda solo lo que cambió;
  - perfiles no asignables deshabilitados;
  - conservar un sector inactivo;
  - restablecer la contraseña, y que la sesión vieja se cierre;
  - desactivar a alguien con intervenciones abiertas;
  - el último administrador;
  - excepciones: agregar, cambiar y quitar, con un gestor que no tiene todo;
  - el efecto inmediato en la otra sesión;
  - el historial contra `auditoria_permisos`;
  - sobre uno mismo, sin botones.
- **A3:**
  - cada baja bloqueada, con su texto;
  - reactivar con la planta inactiva;
  - el orden contra la base;
  - marcar por omisión y crear una máquina sin elegir;
  - código sugerido y repetido;
  - que R4 y `ModalMaquina` se actualicen.
- **A4:** la matriz contra `perfil_permiso`.
- **Perfiles:** Administrador, un gestor con excepciones, Responsable y Operario, según la tabla 9.
- **Recorrido de la F2 y la F3:** que nada cambió.
- **Celular:** sin desborde de la página; tablas que se desplazan solas; diálogos a pantalla completa.

---

## 12. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 10 están hechas, en dos commits:
   1. `fix(api): orden y cuerpos invalidos en catalogos`;
   2. `feat(front): administracion de usuarios, sectores y catalogos`.
2. Durante el trabajo, correr solo `test:administracion` y `test:front`.
3. Al cerrar, `npm run test:todo -- etapa-f4b` **una vez**, en Neon:
   - en verde, con **329** pruebas (328 más AD-17);
   - con los once números en 0.
4. `npm run test:front` en verde (FE-01 a FE-38).
5. `npm run typecheck` y `npm run build:frontend` sin errores.
6. Push de los dos commits en `feat/base-neon`.

**Informe corto:**

1. Los hashes de los dos commits.
2. La línea de total y la de datos que quedaron de `test:todo`, y la salida final de `test:front`.
3. Typecheck y build, con el tamaño del JS.
4. El tamaño en líneas de cada pantalla nueva.
5. Desvíos, incluido todo lo que no se haya hecho.
6. Dudas.
