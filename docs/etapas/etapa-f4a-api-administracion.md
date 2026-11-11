# Etapa F4a — API para las pantallas de administración

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `84bdc66` (Etapa API-05).
> **Origen:**
>
> - mapa de pantallas, A1 a A4;
> - F3a, sección 11: el alta y la edición de criticidades, tipos de equipo y plantas van en la F4;
> - revisión de la API-05 con el sistema levantado en mi base local.

**Para qué.** La F4 se divide en dos etapas, como la F3:

- **F4a (esta):** la API que necesitan las pantallas de administración, más la corrección que salió de revisar la API-05. No hay pantallas nuevas.
- **F4b (la siguiente):** las pantallas, sobre esta API ya revisada.

**De la API-05, lo que funciona y no se toca.** Probé a mano contra la API:

- **Autogestión:** ni la administradora ni un gestor pueden cambiar ni quitar sus propias excepciones.
- **No dar lo que no se tiene:** un responsable con `USUARIOS_GESTIONAR` y `PERMISOS_GESTIONAR` por excepción:
  - no puede conceder ni denegar `INTERVENCIONES_CORREGIR`, que no tiene;
  - con `INTERVENCIONES_VER` en `SECTORES`, no puede conceder `TODAS`, pero sí `SECTORES`.
- **Orden de las validaciones:** coincide con la tabla 3.2 en todos los casos que probé.
- **Efecto inmediato:** con el mismo token, el operario pasa de 121 a 122 intervenciones al darle `TODAS`, y baja a 95 al quitársela.
- **Auditoría:** las tres acciones quedan registradas, con el `anterior` correcto.
- **Pruebas:** `test:todo` en mi base y en una base como la principal, con 310 de 310 y los once números en 0.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias.
2. **Sin migración:** esta etapa no cambia el esquema.
3. **Tres commits**, para revisarlos por separado (sección 11).
4. **Pruebas:**
   - solo contra la rama de pruebas de Neon;
   - rige la regla de la F2.2: una prueba no borra ni modifica datos que no creó;
   - **excepción para los catálogos:** cambiar el valor por omisión o el orden por la API toca filas que la prueba no creó. Se permite solo así:
     - al empezar, la prueba guarda el valor por omisión y el `orden` de cada fila;
     - en un `finally`, los devuelve por SQL;
     - nunca desactiva ni renombra filas que no creó.
5. Ante cualquier duda o diferencia con este documento, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-f4a-api-administracion.md`.

---

## 1. Corrección de la API-05: dos pedidos a la vez (primer commit)

### 1.1 Problema

El `PUT` y el `DELETE` de excepciones leen la excepción existente con `pool.query`, **antes** del `BEGIN` y sin bloquear nada. Con esa lectura deciden tres cosas:

- `SIN_CAMBIOS` (regla 10);
- `EXCEPCION_NO_ENCONTRADA` (regla 11);
- la acción y el `anterior` de la auditoría.

Si llegan dos pedidos iguales a la vez, los dos leen lo mismo y los dos siguen.

Lo medí con 15 rondas. En cada una mandé dos `PUT` iguales a la vez y después dos `DELETE` a la vez:

| Resultado | Rondas |
| :--- | :-: |
| Los dos `PUT` dan 200 y quedan **dos** `EXCEPCION_CREADA`; los dos `DELETE` dan 200 y quedan **dos** `EXCEPCION_ELIMINADA` | 13 |
| Uno de los dos pares sale bien y el otro duplica | 2 |
| Los dos pares salen bien | 0 |

Lo correcto es:

- para los dos `PUT`, un 200 y un 422 `SIN_CAMBIOS`;
- para los dos `DELETE`, un 200 y un 404 `EXCEPCION_NO_ENCONTRADA`;
- un solo registro de auditoría para cada operación.

En la práctica, alcanza con un doble clic en la pantalla A2, o con dos administradores a la vez. La auditoría de permisos tiene que contar exactamente lo que pasó.

### 1.2 Corrección

En el `PUT` y en el `DELETE`:

1. Las reglas 1 a 9 quedan como están, fuera de la transacción.
2. Lo primero dentro de la transacción es bloquear al usuario afectado:

   ```sql
   SELECT id FROM usuarios WHERE id = $1 FOR UPDATE
   ```

   Se bloquea al usuario, y no a la excepción, porque un `PUT` que crea la excepción todavía no tiene fila que bloquear. Así, los cambios de excepciones de un mismo usuario van de a uno.
3. Después del bloqueo, leer la excepción existente con `client`, ya no con `pool`.
4. Evaluar las reglas 10 y 11 sobre esa lectura. Si corresponde cortar: `ROLLBACK` y la misma respuesta de hoy.
5. La acción (`EXCEPCION_CREADA` o `EXCEPCION_MODIFICADA`) y el `anterior` salen de esa misma lectura.

El orden de las validaciones de la tabla 3.2 no cambia: solo cambia dónde se evalúan la 10 y la 11. Dejar un comentario breve en el código con el porqué del bloqueo.

### 1.3 Prueba EX-11, en `excepciones.test.ts`

Con un usuario de la prueba y un permiso sin excepción, hacer **5 rondas**. En cada ronda:

| Paso | Qué tiene que pasar |
| :--- | :--- |
| (a) Dos `PUT` iguales a la vez (`Promise.all`) | Un 200 y un 422 `SIN_CAMBIOS`. Un solo `EXCEPCION_CREADA` nuevo. |
| (b) Dos `DELETE` a la vez | Un 200 y un 404 `EXCEPCION_NO_ENCONTRADA`. Un solo `EXCEPCION_ELIMINADA` nuevo. |

Los registros de auditoría se cuentan por el `sobre_usuario_id` del usuario de la prueba.

**Antes de corregir el código, correr EX-11 y confirmar que falla.** Anotar en el informe en cuántas de las 5 rondas falló. Una prueba que no falla sin la corrección no prueba la corrección.

---

## 2. Reglas comunes a sectores, plantas, criticidades y tipos de equipo

### 2.1 Permiso

- **Escritura:** `POST`, `PUT`, `DELETE` y `PUT /orden` piden `MAQUINAS_GESTIONAR`, como los sectores hoy.
- **Lectura:** sigue abierta a cualquier usuario que haya iniciado sesión.

### 2.2 Lectura con inactivos: `?all=true`

Igual que `GET /api/maquinas?all=true`:

- pide `MAQUINAS_GESTIONAR`; si no lo tiene: 403 `PERMISO_INSUFICIENTE`;
- trae también las filas inactivas, con su campo `activo`;
- agrega los conteos de la tabla de 2.3.

Sin `?all=true`, la respuesta queda **exactamente** como hoy.

El orden es el de hoy: sectores y plantas por nombre; criticidades y tipos de equipo por `orden`.

### 2.3 Baja y reactivación

Como en máquinas:

- `DELETE /:id` desactiva;
- `PUT /:id` acepta `activo`:
  - `false`, con las mismas reglas que el `DELETE`;
  - `true`, para reactivar.

Desactivar algo que ya está inactivo responde 200, como hoy en sectores y máquinas.

**No se desactiva lo que algo activo usa:**

| Qué se desactiva | Lo impide | Conteos en `?all=true` y en el 409 |
| :--- | :--- | :--- |
| Sector | máquinas activas del sector; usuarios activos con ese sector asignado | `maquinas_activas`, `usuarios_activos` |
| Planta | sectores activos de la planta | `sectores_activos` |
| Criticidad o tipo de equipo | máquinas activas que lo usan | `maquinas_activas` |

- **Respuesta:** 409 `EN_USO`, con los conteos de la fila. Por ejemplo:

  ```json
  { "error": "…", "codigo": "EN_USO", "maquinas_activas": 3, "usuarios_activos": 0 }
  ```

- **Valor por omisión:** una criticidad o un tipo de equipo marcado por omisión no se desactiva: 409 `ES_POR_OMISION`. Esta regla va antes que `EN_USO`.

**Lo inactivo que ya estaba asignado:**

- se conserva: una máquina o un usuario inactivos pueden quedar con un sector, criticidad o tipo inactivo;
- reactivar un **sector** con su planta inactiva: 400 `DATOS_INVALIDOS`;
- reactivar una **máquina** con su criticidad o su tipo inactivo: 400 `DATOS_INVALIDOS`, igual que hoy con el sector inactivo (sección 4.6);
- un **usuario** sí se puede reactivar con un sector inactivo, porque ese sector no tiene máquinas activas y no le da acceso a nada (sección 5.2).

### 2.4 Duplicados

Nombre o código repetido, en `POST` y en `PUT`:

- 409 `NOMBRE_DUPLICADO`;
- 409 `CODIGO_DUPLICADO`.

Se distinguen por el nombre de la restricción que falla. En sectores, cambia el 400 de hoy por el 409.

Cualquier otra violación de unicidad, por ejemplo la de `orden`, **no** se informa como duplicado: es un error interno y no debería pasar (sección 4.5).

### 2.5 Validación y respuestas

- Datos inválidos e ids inválidos: 400 `DATOS_INVALIDOS`, como en sectores y máquinas.
- No existe:
  - 404 `SECTOR_NO_ENCONTRADO`;
  - 404 `PLANTA_NO_ENCONTRADA`;
  - 404 `CRITICIDAD_NO_ENCONTRADA`;
  - 404 `TIPO_EQUIPO_NO_ENCONTRADO`.
- `POST` (201) y `PUT` (200) devuelven el elemento con la misma forma que en `?all=true`.
- `DELETE` responde como hoy el de sectores.
- Los textos se recortan. Un texto que queda vacío cuenta como que no vino.

---

## 3. Sectores y plantas (segundo commit, con la sección 4)

### 3.1 Sectores: lo que cambia

- `GET /api/sectores?all=true`: sección 2.2, con `maquinas_activas` y `usuarios_activos`.
- **Baja:** sección 2.3, por `DELETE` y por `PUT` con `activo: false`.
- **Reactivar** con la planta inactiva: 400.
- **Nombre repetido:** 409 `NOMBRE_DUPLICADO`.

El resto queda como está.

### 3.2 Plantas: escritura nueva

| Ruta | Cuerpo | Reglas |
| :--- | :--- | :--- |
| `POST /api/plantas` | `nombre` (1 a 100), `descripcion` (opcional) | 201 |
| `PUT /api/plantas/:id` | `nombre`, `descripcion`, `activo`; todos opcionales | Lo que no viene no cambia. `descripcion` en `null` o `""` la vacía. |
| `DELETE /api/plantas/:id` | — | Sección 2.3 |

`GET /api/plantas?all=true`: sección 2.2, con `activo` y `sectores_activos`.

---

## 4. Criticidades y tipos de equipo

Los dos catálogos comparten el código: una función con la tabla como parámetro. La única diferencia es que solo las criticidades tienen `prioridad_alta`.

### 4.1 Lectura

`?all=true`: sección 2.2, con `activo` y `maquinas_activas`.

### 4.2 Alta: `POST /api/criticidades` y `POST /api/tipos-equipo`

| Campo | Regla |
| :--- | :--- |
| `codigo` | Obligatorio. Formato `^[A-Z][A-Z0-9_]{0,29}$`. No se cambia después. |
| `nombre` | Obligatorio, de 1 a 60 caracteres. |
| `prioridad_alta` | Solo criticidades. Booleano, opcional; por omisión `false`. |
| `orden`, `por_omision` | No se reciben: 400 si vienen. |

La fila nueva queda:

- con `orden` = el máximo actual + 1;
- con `por_omision = false`;
- activa.

### 4.3 Edición: `PUT /:id`

| Campo | Regla |
| :--- | :--- |
| `nombre` | Como en el alta. |
| `prioridad_alta` | Solo criticidades. Vale para los avisos que se generen desde ese momento. |
| `por_omision` | Solo `true`. La fila tiene que estar activa; si no, 400. En la misma transacción, la que era por omisión pasa a `false`. |
| `por_omision: false` | 400: para cambiar el valor por omisión, se marca otro. Así siempre hay uno. |
| `activo` | Sección 2.3. |
| `codigo`, `orden` | 400: el código no se cambia y el orden se cambia con `PUT /orden`. |

### 4.4 Orden: `PUT /api/criticidades/orden` y `PUT /api/tipos-equipo/orden`

- **Cuerpo:** `{ "ids": [3, 1, 2] }`, con **todas** las filas, activas e inactivas, cada una una sola vez. Si falta, sobra o se repite un id: 400.
- **Efecto:** `orden` queda en 1, 2, 3… en ese orden.
- **Respuesta:** la lista como en `?all=true`.
- **Implementación:**
  - la ruta se registra antes que `/:id`;
  - la restricción `UNIQUE` de `orden` no es diferible, así que se actualiza en dos pasos: primero `orden = orden + (SELECT MAX(orden) FROM tabla)`, después los valores finales. El `CHECK (orden > 0)` se cumple en los dos pasos.

### 4.5 Dos escrituras a la vez

Toda escritura de estos dos catálogos (`POST`, `PUT`, `DELETE`, `PUT /orden`) va en una transacción que empieza con:

```sql
LOCK TABLE <tabla> IN SHARE ROW EXCLUSIVE MODE
```

Así:

- dos altas simultáneas no calculan el mismo máximo + 1;
- dos cambios del valor por omisión no se pisan.

Ese bloqueo no frena las lecturas ni las altas de máquinas, que toman bloqueos más débiles.

### 4.6 Máquinas: reactivar

`PUT /api/maquinas/:id` con `activo: true`, cuando la criticidad o el tipo de la máquina están inactivos: 400 `DATOS_INVALIDOS`, igual que hoy con el sector inactivo.

---

## 5. Usuarios y perfiles (tercer commit, con las secciones 6 a 8)

### 5.1 `GET /api/perfiles`

Cada perfil agrega `usuarios_activos`: la cantidad de usuarios activos con ese perfil.

### 5.2 `PATCH /api/usuarios/:id`: sectores ya asignados

- Un sector que el usuario **ya tiene** puede quedar en la lista aunque esté inactivo.
- Un sector **nuevo** tiene que existir y estar activo, como hoy.

**Por qué:** un usuario inactivo puede quedar con un sector que se desactivó después. Si se lo reactiva, editar sus datos no tiene que fallar por ese sector.

### 5.3 Nuevo `GET /api/usuarios/:id/auditoria`

Es el historial de la pantalla A2: los registros de `auditoria_permisos` sobre ese usuario.

- **Permiso:** `USUARIOS_GESTIONAR`, como el resto de `/api/usuarios`.
- **Parámetros:**
  - `limit`, de 1 a 200; por omisión, 50;
  - `offset`, 0 o más; por omisión, 0.

  Un valor inválido: 400 `DATOS_INVALIDOS`.
- **Errores:** id inválido, 400; usuario inexistente, 404 `USUARIO_NO_ENCONTRADO`.
- **Orden:** `creado_en` descendente, después `id` descendente.
- **Respuesta:**

  ```json
  {
    "total": 6,
    "registros": [
      {
        "id": 120,
        "accion": "EXCEPCION_CREADA",
        "creado_en": "2026-11-04T18:21:22.592Z",
        "realizado_por": { "id": 557, "nombre": "…", "apellido": "…" },
        "detalle": { "codigo": "INTERVENCIONES_VER", "efecto": "CONCEDER", "alcance": "TODAS", "motivo": "…" }
      }
    ],
    "referencias": {
      "perfiles": { "3": "OPERARIO" },
      "sectores": { "101": "Prensas" }
    }
  }
  ```

- **`detalle`:** el texto guardado, convertido con `JSON.parse`. Si no es JSON válido, el texto tal cual.
- **`realizado_por`:** `null` si ese usuario ya no existe.
- **`referencias`:**
  - qué trae: el nombre de cada perfil y cada sector cuyo id aparece en los registros de la página, incluidos los inactivos;
  - dónde se buscan los ids: `PERFIL_CAMBIADO` (`anterior` y `nuevo`), `SECTORES_CAMBIADOS` (`anterior` y `nuevo`) y `USUARIO_CREADO` (`perfil_id` y `sectores`);
  - para qué: la pantalla muestra nombres sin hacer más pedidos.

---

## 6. Frontend: solo los tipos

No hay pantallas nuevas ni cambios visibles.

En `frontend/src/api/tipos.ts`, agregar interfaces que coincidan exactamente con las respuestas:

- de `GET /api/usuarios`, `GET /api/usuarios/:id` (con sus excepciones), `GET /api/permisos` y `GET /api/perfiles`;
- de `GET /api/usuarios/:id/auditoria`;
- de las cuatro rutas con `?all=true`.

Si alguna ya existe, se completa; no se duplica.

---

## 7. Pruebas

### 7.1 EX-11

Sección 1.3, en el primer commit.

### 7.2 Archivo nuevo `backend/tests/administracion.test.ts`

Script `test:administracion`.

- **Datos:** crea sus propios usuarios (incluido un administrador), sectores, plantas, máquinas y filas de catálogo. Las filas de catálogo llevan códigos `T_AD_` más un sufijo único.
- **Limpieza:** borra todo por los ids que guardó.
- **Catálogos:** guarda el estado y lo devuelve en un `finally`, según la regla 4 de la sección 0.
- **No depende de los catálogos actuales:**
  - ni de sus nombres ni de cuántas filas tienen;
  - el valor por omisión se consulta, no se supone.
- **Conteos que incluyen datos ajenos:** se verifican por diferencia, como en la F3a.1.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| AD-01 | Permisos, con un operario | (a) `GET` sin `all` en las cuatro rutas: 200.<br>(b) `?all=true` en las cuatro: 403 `PERMISO_INSUFICIENTE`.<br>(c) `POST`, `PUT`, `DELETE` y `PUT /orden`: 403. |
| AD-02 | Sectores con `?all=true` | Un sector de la prueba con 2 máquinas activas y 1 inactiva, y con 1 usuario activo y 1 inactivo: `maquinas_activas` 2 y `usuarios_activos` 1. Un sector inactivo de la prueba aparece con `activo: false`. Sin `all`, no aparece. |
| AD-03 | Sector: baja | (a) Con una máquina activa: 409 `EN_USO` con `maquinas_activas` 1, por `DELETE` y por `PUT`.<br>(b) Solo con un usuario activo: 409 `EN_USO` con `usuarios_activos` 1.<br>(c) Solo con una máquina y un usuario inactivos: 200.<br>(d) Reactivarlo con su planta inactiva: 400.<br>(e) Con la planta activa: 200. |
| AD-04 | Duplicados | (a) Nombre repetido en sector y en planta: 409 `NOMBRE_DUPLICADO`, en `POST` y en `PUT`.<br>(b) Criticidad con código repetido: 409 `CODIGO_DUPLICADO`.<br>(c) Criticidad con nombre repetido: 409 `NOMBRE_DUPLICADO`. |
| AD-05 | Plantas | (a) Alta y edición; `descripcion: ""` la vacía.<br>(b) `?all=true` trae `sectores_activos`.<br>(c) Baja con un sector activo: 409 `EN_USO` con `sectores_activos` 1.<br>(d) Sin sectores activos: 200, y no aparece en `GET /api/plantas`.<br>(e) `PUT` con `activo: true`: vuelve a aparecer.<br>(f) Id inexistente: 404 `PLANTA_NO_ENCONTRADA`; `abc`: 400. |
| AD-06 | Criticidad: alta | (a) `codigo` `alta`, `1A`, de 31 caracteres o faltante: 400.<br>(b) Válida: 201, con `orden` = máximo + 1, `por_omision: false`, activa y `prioridad_alta` como vino.<br>(c) Con `orden` o con `por_omision`: 400.<br>(d) La respuesta es igual a su elemento en `?all=true` (`deepStrictEqual`). |
| AD-07 | Criticidad: edición | (a) Cambian `nombre` y `prioridad_alta`.<br>(b) Con `codigo` o con `orden`: 400.<br>(c) `por_omision: false`: 400.<br>(d) Id inexistente: 404 `CRITICIDAD_NO_ENCONTRADA`. |
| AD-08 | Valor por omisión | (a) Marcar una de la prueba: 200. La anterior queda en `false` y hay una sola por omisión.<br>(b) Una máquina nueva sin criticidad toma la nueva.<br>(c) Desactivar la por omisión: 409 `ES_POR_OMISION`.<br>(d) Marcar una inactiva: 400.<br>Al terminar, vuelve la original. |
| AD-09 | Criticidad en uso | (a) Una de la prueba, usada por una máquina activa: la baja da 409 `EN_USO` con `maquinas_activas` 1.<br>(b) Después de desactivar la máquina: 200. No aparece sin `all`; con `all`, aparece con `activo: false`.<br>(c) Reactivar la máquina: 400.<br>(d) Reactivar la criticidad y después la máquina: 200 las dos. |
| AD-10 | Orden | (a) La lista completa, con una de la prueba primera: 200. `GET` la devuelve primera y los `orden` quedan en 1 a n.<br>(b) Falta un id, se repite uno o hay uno inexistente: 400. |
| AD-11 | Dos escrituras a la vez | (a) Dos `POST` simultáneos con códigos distintos: los dos 201, con `orden` distintos.<br>(b) Dos `PUT` simultáneos que marcan por omisión dos filas distintas de la prueba: los dos 200, y al final hay una sola por omisión. |
| AD-12 | Tipos de equipo | Recorrido corto, ya que comparten el código:<br>• alta: 201, con `orden` = máximo + 1;<br>• código repetido: 409;<br>• desactivar el por omisión: 409 `ES_POR_OMISION`;<br>• uno en uso: 409 `EN_USO`;<br>• orden incompleto: 400;<br>• id inexistente: 404 `TIPO_EQUIPO_NO_ENCONTRADO`. |
| AD-13 | Perfiles | Se crean 2 usuarios activos y 1 inactivo con un mismo perfil: `usuarios_activos` de ese perfil sube en 2. |
| AD-14 | Auditoría de un usuario | Un usuario de la prueba, creado por la API. Después, en pedidos separados: cambio de nombre, de perfil y de sectores; una excepción; y la desactivación.<br>(a) 6 registros, del más nuevo al más viejo, con `realizado_por` y con `detalle` como objeto.<br>(b) `referencias` trae los nombres de los perfiles y sectores que aparecen.<br>(c) `limit=2`: 2 registros y `total` 6. `offset=4`: los 2 más viejos.<br>(d) `limit` 0, 201 o `abc`, y `offset` -1: 400.<br>(e) Usuario inexistente: 404.<br>(f) Sin `USUARIOS_GESTIONAR`: 403.<br>(g) La contraseña temporal no aparece en ninguna parte de la respuesta. |
| AD-15 | Sector inactivo ya asignado | Un usuario inactivo de la prueba tiene el sector S. Se desactiva S y se reactiva al usuario.<br>(a) `PATCH` con sectores [S, T]: 200.<br>(b) `PATCH` con sectores [S, T, U], con U inactivo: 422. |
| AD-16 | Catálogos intactos | Al final, en los dos catálogos, el valor por omisión y el `orden` de cada fila que no creó la prueba son los del principio. |

### 7.3 Pruebas existentes

**Cambio permitido:** si una prueba espera 400 para el nombre de sector repetido, pasarla a 409. Yo no encontré ninguna.

Si cualquier otra prueba existente falla por esta etapa, **frenar y preguntar**. Por ejemplo, una que desactive por la API un sector con máquinas activas.

### 7.4 Control de `test:todo`

La línea sigue con los **once** números, todos en 0.

---

## 8. Documentación

1. **`docs/decisiones.md`:** agregar al final:

   > ## D-015 — Bajas en sectores, plantas y catálogos
   >
   > **Estado:** Aceptada
   >
   > Un sector, una planta, una criticidad o un tipo de equipo no se desactiva mientras algo activo lo use:
   >
   > - un sector, mientras tenga máquinas activas o usuarios activos;
   > - una planta, mientras tenga sectores activos;
   > - una criticidad o un tipo de equipo, mientras lo use una máquina activa.
   >
   > Cada catálogo tiene siempre un valor por omisión activo. Se cambia marcando otro, y el valor por omisión no se puede desactivar.
   >
   > Lo que ya estaba asignado se conserva: una máquina o un usuario inactivos pueden quedar con un valor inactivo. Una máquina no se reactiva con su sector, criticidad o tipo inactivos. Un usuario sí, porque un sector inactivo no tiene máquinas activas y no le da acceso a nada.
   >
   > **Motivo:** que ningún dato activo dependa de uno inactivo, y que el alta de una máquina siempre encuentre sus valores por omisión.

2. **`docs/modelo-datos.md`:** en `criticidades` y `tipos_equipo`, agregar: "Siempre hay un valor por omisión activo; se cambia marcando otro (D-015)."

---

## 9. Lo que viene en la F4b (para orientar; no se hace en esta etapa)

- **A1 Usuarios:**
  - tabla con filtros por activo, perfil y sector;
  - búsqueda sin tildes;
  - "Nuevo usuario".
- **A2 Usuario:**
  - datos, perfil y sectores;
  - contraseña temporal en el alta; restablecer la contraseña;
  - desactivar y reactivar, con aviso si es responsable de intervenciones abiertas;
  - excepciones: solo con `PERMISOS_GESTIONAR`, y ofreciendo solo lo que quien las da puede dar;
  - historial (sección 5.3);
  - sobre uno mismo: solo lectura.
- **A3 Sectores y plantas.**
- **Catálogos de máquinas:** criticidades y tipos de equipo, con su orden y su valor por omisión.
- **A4 Perfiles:** solo lectura.
- **Menú:** los ítems nuevos según los permisos.

---

## 10. Fuera de alcance

- Crear o editar perfiles: A4 queda de solo lectura.
- Auditoría de los cambios en sectores, plantas y catálogos.
- Pantalla para la marca de la instalación (empresa y logo): sigue por configuración.
- Aplicar las migraciones 005 a 014 en la base principal.
- Pantallas: son la F4b.

---

## 11. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 8 están hechas, en tres commits:
   1. sección 1: `fix(api): cambios simultaneos sobre una excepcion`;
   2. secciones 2 a 4, con AD-01 a AD-12 y AD-16: `feat(api): sectores, plantas y catalogos para administracion`;
   3. secciones 5 a 8, con AD-13 a AD-15: `feat(api): usuarios y perfiles para administracion`.
2. Durante el trabajo, correr solo `test:excepciones`, `test:administracion`, `test:maquinas` y `test:usuarios`.
3. Al cerrar, `npm run test:todo -- etapa-f4a` **una vez**, en Neon:
   - en verde;
   - con el total de antes (310) más las pruebas nuevas;
   - con los **once** números en 0.
4. `npm run typecheck`, `npm run test:front` y `npm run build:frontend` sin errores.
5. Push en `feat/base-neon`.

**Informe corto:**

1. Los tres hashes.
2. En cuántas de las 5 rondas falló EX-11 antes de la corrección.
3. La salida final de `test:todo`: el total y la línea de los once números.
4. Las pruebas existentes que se modificaron, con el motivo, o "ninguna".
5. Desvíos.
6. Dudas.
