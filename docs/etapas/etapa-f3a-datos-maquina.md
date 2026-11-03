# Etapa F3a — Datos de la máquina y API para el tablero y las máquinas

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `347c706` (Etapa F2.2).
> **Origen:**
>
> - mapa de pantallas (R1 Tablero, R4 Máquinas, R5 Detalle de máquina);
> - relevamiento, requisitos 9 (criticidad y tipo de equipo) y 10 (planta del sector);
> - revisión de la API de máquinas, sectores y tablero del commit `347c706`.

**Para qué.** La F3 se divide en dos etapas:

- **F3a (esta):** base de datos y API. No hay pantallas nuevas.
- **F3b (la siguiente):** las pantallas R1, R4 y R5, sobre esta API ya revisada.

**Decidido con Andrés (03/11/2026):**

1. Primero el backend, en una etapa propia.
2. Entran los tres datos pendientes del relevamiento:
   - criticidad;
   - tipo de equipo;
   - planta del sector.
3. Una falla en una máquina de criticidad alta avisa con prioridad alta, aunque no la haya detenido.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias.
2. **Dos commits**, para revisarlos por separado:
   1. sección 1: la migración 013 y su prueba;
   2. secciones 2 a 9: la API, sus pruebas, los tipos del frontend y la documentación.
3. **Pruebas:**
   - solo contra la rama de pruebas de Neon;
   - rige la regla de la F2.2: una prueba no borra ni modifica datos que no creó;
   - una prueba que necesita cambiar un catálogo existente lo hace dentro de una transacción terminada en `ROLLBACK`.
4. **Base principal:** la migración **no** se aplica ahí. Eso se hace en un paso aparte, con respaldo, al preparar la demo.
5. Ante cualquier duda o diferencia con este documento, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-f3a-datos-maquina.md`.

---

## 1. Migración `013_datos_maquina.sql` (primer commit)

Debe ser **idempotente**, como las anteriores: correrla dos veces no falla ni duplica datos. Para eso se usan:

- `CREATE TABLE IF NOT EXISTS`;
- `ADD COLUMN IF NOT EXISTS`;
- `ON CONFLICT DO NOTHING`;
- bloques `DO $$ … $$` donde haga falta.

### 1.1 Tabla `criticidades`

| Columna | Tipo y reglas | Para qué |
| :--- | :--- | :--- |
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | |
| `codigo` | `VARCHAR(30) NOT NULL UNIQUE` | Identificador estable. No cambia aunque cambie el nombre. |
| `nombre` | `VARCHAR(60) NOT NULL UNIQUE` | Lo que se muestra. |
| `orden` | `SMALLINT NOT NULL UNIQUE`, `CHECK (orden > 0)` | 1 es la más crítica. Ordena el tablero y las listas. |
| `prioridad_alta` | `BOOLEAN NOT NULL DEFAULT FALSE` | Sus fallas avisan con prioridad alta (sección 6). |
| `por_omision` | `BOOLEAN NOT NULL DEFAULT FALSE` | La que recibe una máquina nueva. |
| `activo` | `BOOLEAN NOT NULL DEFAULT TRUE` | |

**Restricciones:**

- a lo sumo una fila con `por_omision`, con un índice único parcial `WHERE por_omision`;
- la de por omisión tiene que estar activa: `CHECK (NOT por_omision OR activo)`.

**Datos iniciales:**

| `codigo` | `nombre` | `orden` | `prioridad_alta` | `por_omision` |
| :--- | :--- | :-: | :-: | :-: |
| `ALTA` | Alta | 1 | sí | no |
| `MEDIA` | Media | 2 | no | sí |
| `BAJA` | Baja | 3 | no | no |

### 1.2 Tabla `tipos_equipo`

Tiene las mismas columnas y restricciones que `criticidades`, **sin** `prioridad_alta`.

| `codigo` | `nombre` | `orden` | `por_omision` |
| :--- | :--- | :-: | :-: |
| `MAQUINA` | Máquina | 1 | sí |
| `VEHICULO` | Vehículo | 2 | no |
| `INSTALACION` | Instalación | 3 | no |
| `HERRAMIENTA` | Herramienta menor | 4 | no |

### 1.3 Tabla `plantas`

| Columna | Tipo y reglas |
| :--- | :--- |
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `nombre` | `VARCHAR(100) NOT NULL UNIQUE` |
| `descripcion` | `TEXT` |
| `activo` | `BOOLEAN NOT NULL DEFAULT TRUE` |
| `creado_en` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |

No tiene datos iniciales: una empresa con una sola planta no necesita cargar ninguna.

### 1.4 `sectores.planta_id`

- `BIGINT NULL REFERENCES plantas(id) ON DELETE RESTRICT`.
- `NULL` significa "sin planta".
- Índice `idx_sectores_planta`.

### 1.5 `maquinas.criticidad_id` y `maquinas.tipo_equipo_id`

1. **Dos funciones SQL `STABLE`:**
   - `fn_criticidad_por_omision()` devuelve el `id` de la criticidad con `por_omision` y `activo`, o `NULL` si no hay.
   - `fn_tipo_equipo_por_omision()` hace lo mismo con `tipos_equipo`.
2. **Para cada una de las dos columnas:**
   1. `ADD COLUMN IF NOT EXISTS … BIGINT REFERENCES … ON DELETE RESTRICT`;
   2. completar las máquinas existentes con el valor por omisión (`UPDATE … WHERE … IS NULL`);
   3. `SET DEFAULT fn_…()`;
   4. `SET NOT NULL`.
3. **Índices:** `idx_maquinas_criticidad` e `idx_maquinas_tipo_equipo`.

Así, un `INSERT` que no indica criticidad ni tipo, como los de las pruebas existentes, toma los de por omisión. Si alguien dejara un catálogo sin valor por omisión, el `INSERT` falla por `NOT NULL`. Es lo esperado.

### 1.6 `maquinas.tipo` pasa a llamarse `modelo`

- Con un bloque `DO`: si existe la columna `tipo` y no existe `modelo`, `ALTER TABLE maquinas RENAME COLUMN tipo TO modelo`. Los datos se conservan.
- **Motivo:** el tipo de la máquina pasa a ser el catálogo `tipos_equipo`. El texto libre que había queda como "marca y modelo", que sirve para buscar repuestos y manuales.
- Ninguna migración anterior usa `maquinas.tipo`. Ya lo revisé.

### 1.7 Prueba `backend/tests/migration_013.test.ts`

Script `test:migration-013`.

**Lección de la F2.2:** las pruebas de la migración **no exigen el contenido actual de los catálogos**, porque una instalación puede haber cambiado nombres o niveles. Verifican:

- la estructura;
- las restricciones;
- que existan los códigos iniciales.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| M13-01 | Aplicar la migración | Sin errores. |
| M13-02 | Aplicarla otra vez | Sin errores y sin filas nuevas en `criticidades` ni en `tipos_equipo`. Se cuentan antes y después. |
| M13-03 | Códigos iniciales | Existen `ALTA`, `MEDIA` y `BAJA`, y `MAQUINA`, `VEHICULO`, `INSTALACION` y `HERRAMIENTA`. En cada catálogo hay **a lo sumo una** fila por omisión, y está activa. |
| M13-04 | Restricciones de los catálogos, cada una dentro de una transacción con `ROLLBACK` | Falla:<br>• marcar una segunda fila por omisión;<br>• `orden` en 0;<br>• `orden` repetido;<br>• una fila por omisión inactiva. |
| M13-05 | `INSERT` de máquina sin criticidad ni tipo, en un sector propio de la prueba | Toma los `id` que devuelven `fn_criticidad_por_omision()` y `fn_tipo_equipo_por_omision()`. |
| M13-06 | Columnas | Existe `maquinas.modelo` y no existe `maquinas.tipo`. Las dos columnas nuevas son `NOT NULL`. |
| M13-07 | `sectores.planta_id` | Acepta `NULL`. Con una planta inexistente, falla por la clave foránea. |

Al terminar se borra todo lo que la prueba creó: sector, máquina y planta.

---

## 2. Catálogos: lectura (segundo commit desde acá)

Para cualquier usuario con sesión iniciada, igual que `GET /api/tipos-intervencion`. Devuelven solo los activos.

| Ruta | Respuesta | Orden |
| :--- | :--- | :--- |
| `GET /api/criticidades` | `[{ id, codigo, nombre, orden, prioridad_alta, por_omision }]` | `orden` |
| `GET /api/tipos-equipo` | `[{ id, codigo, nombre, orden, por_omision }]` | `orden` |
| `GET /api/plantas` | `[{ id, nombre, descripcion }]` | `nombre` |

El alta y la edición de estos catálogos quedan para la F4 (sección 11).

---

## 3. Máquinas

### 3.1 Representación única

`GET /api/maquinas` (cada elemento), `GET /api/maquinas/:id`, `POST` y `PUT` devuelven **el mismo objeto**:

```json
{
  "id": 758,
  "codigo": "MEC-02",
  "nombre": "Fresadora universal",
  "modelo": "Marca X, modelo 2000",
  "estado": "DETENIDA",
  "estado_desde": "2026-11-03T12:28:20.861Z",
  "ubicacion": null,
  "observaciones": null,
  "activo": true,
  "creado_en": "2026-10-20T13:00:00.000Z",
  "criticidad": { "id": 1, "codigo": "ALTA", "nombre": "Alta", "orden": 1, "prioridad_alta": true },
  "tipo_equipo": { "id": 1, "codigo": "MAQUINA", "nombre": "Máquina" },
  "sector": { "id": 101, "nombre": "Mecanizado", "planta": { "id": 1, "nombre": "Planta Norte" } },
  "intervenciones_abiertas": 2
}
```

- `sector.planta` es `null` si el sector no tiene planta.
- `intervenciones_abiertas` va también en `GET /:id`, como ya va en la lista.
- **Todos los `id` son números**, como pide AF-20.
- **Una sola consulta base para la lista y el detalle**, por ejemplo una función que arma el `SELECT`, así no se separan con el tiempo.
- `GET /api/maquinas` sigue sin filtros nuevos y ordenado por `nombre`. Los filtros de R4 se hacen en el frontend.

### 3.2 `estado_desde`

Se toma de `historial_estados_maquina`. Es el `cambiado_en` del **último** registro de esa máquina que cumple las dos condiciones:

- `estado_nuevo` igual al estado actual;
- `estado_anterior IS DISTINCT FROM estado_nuevo`.

Un registro que no cambia de estado no mueve la fecha. Si no hay ningún registro así, se usa `creado_en`.

### 3.3 Alta: `POST /api/maquinas`

**Cuerpo:** `nombre` y `sector_id` (obligatorios), y `codigo`, `modelo`, `ubicacion`, `observaciones`, `criticidad_id` y `tipo_equipo_id`.

| Caso | Respuesta |
| :--- | :--- |
| Sin `criticidad_id` o sin `tipo_equipo_id` | Toma el de por omisión: el valor por omisión de la columna. |
| `criticidad_id` o `tipo_equipo_id` inexistente o inactivo | 400 `DATOS_INVALIDOS`, por ejemplo "La criticidad indicada no existe o está inactiva". Mismo estilo que el sector. |
| Viene el campo `tipo` | 400 `DATOS_INVALIDOS`: "El campo tipo se reemplazó por modelo (texto) y tipo_equipo_id (catálogo)". |
| `estado` distinto de `OPERATIVA` | 422 `ESTADO_NO_EDITABLE`. Sin cambios. |
| Código repetido | **409 `CODIGO_MAQUINA_DUPLICADO`**. Hoy responde 400. |
| Correcto | 201 con la representación de 3.1. |

### 3.4 Edición: `PUT /api/maquinas/:id`

**Problema hoy:** el `UPDATE` usa `COALESCE`, así que un dato no se puede borrar. Por ejemplo, la ubicación o el código no pueden quedar vacíos.

**Regla nueva:** cada campo se trata según venga o no en el cuerpo (`'campo' in body`):

| Campo | No viene | Viene `null` o `""` | Viene un valor |
| :--- | :--- | :--- | :--- |
| `nombre`, `sector_id`, `criticidad_id`, `tipo_equipo_id` | no cambia | 400 `DATOS_INVALIDOS` | se valida y se guarda |
| `codigo`, `modelo`, `ubicacion`, `observaciones` | no cambia | queda vacío (`NULL`) | se guarda recortado |
| `activo` | no cambia | 400 `DATOS_INVALIDOS` | ver 3.5 |
| `estado` | — | — | 422 `ESTADO_NO_EDITABLE`, sin cambios |
| `tipo` | — | — | 400 `DATOS_INVALIDOS`, como en 3.3 |

- El `SET` se arma solo con los campos que vinieron, con parámetros. Nada de `COALESCE`.
- Código repetido: 409 `CODIGO_MAQUINA_DUPLICADO`.
- Máquina inexistente: 404 `MAQUINA_NO_ENCONTRADA`.
- Respuesta: 200 con la representación de 3.1.

### 3.5 Desactivar y reactivar

`DELETE /api/maquinas/:id` y `PUT` con `activo: false` siguen **la misma regla**. Se controla en este orden:

1. Si la máquina tiene intervenciones abiertas (`PENDIENTE`, `EN_PROCESO` o `EN_ESPERA_REPUESTOS`, no eliminadas): 409 `MAQUINA_CON_INTERVENCIONES_ABIERTAS`.
2. Si tiene períodos de detención abiertos de intervenciones no eliminadas, aunque estén finalizadas: 409 `MAQUINA_CON_DETENCIONES_ABIERTAS`. Es el mismo código que ya usa el cambio manual de estado.

**Motivo:** una máquina desactivada desaparece de las listas y de "Reportar falla". Si tuviera trabajo abierto, quedaría escondido.

**Para reactivar,** se usa `PUT` con `activo: true`. Si el sector de la máquina está inactivo: 400 `DATOS_INVALIDOS`, "El sector de la máquina está inactivo".

La respuesta de `DELETE` no cambia.

---

## 4. Sectores con planta

- `GET /api/sectores` y `GET /api/sectores/:id` incluyen `planta: { id, nombre } | null`.
- **`POST`:** acepta `planta_id`. Si no viene o es `null`, el sector queda sin planta.
- **`PUT`:** usa la misma regla de 3.4.
  - `nombre`: obligatorio. Si viene `null` o `""`: 400.
  - `descripcion` y `planta_id`: si vienen `null` o `""`, quedan vacíos.
  - `activo`: como hoy.
- **`planta_id` inexistente o inactiva:** 400 `DATOS_INVALIDOS`.
- **Respuesta de `POST` y `PUT`:** el sector con su `planta`.

---

## 5. Tablero: `GET /api/tablero`

1. **`detenidas_ahora[].maquina`** suma:
   - `criticidad: { id, codigo, nombre, orden }`;
   - `sector.planta: { id, nombre } | null`.
2. **Orden de `detenidas_ahora`:**
   1. `criticidad.orden`, de menor a mayor;
   2. inactividad en curso, de mayor a menor;
   3. `maquina.id`.
3. **Parámetro opcional `planta_id`:**
   - Filtra los tres bloques: máquinas por estado, intervenciones y detenidas. Cuenta solo las máquinas cuyo sector pertenece a esa planta, y se suma al alcance del usuario.
   - No numérico: 400 `DATOS_INVALIDOS`.
   - Inexistente: 404 `PLANTA_NO_ENCONTRADA`.

---

## 6. Avisos: prioridad alta por criticidad

Solo cambia el aviso `FALLA_REGISTRADA`, en `intervenciones/notificaciones.ts`.

**Prioridad:** `ALTA` si la máquina quedó detenida (`tiene_periodo_abierto`) **o** si su criticidad tiene `prioridad_alta`. Si no, `NORMAL`.

**Título:**

| Caso | Título |
| :--- | :--- |
| Detenida (sea o no crítica) | "Nueva falla en {máquina} — máquina detenida". Igual que hoy. |
| No detenida, con criticidad de `prioridad_alta` | "Nueva falla en {máquina} — criticidad {nombre del nivel}". Por ejemplo, "— criticidad Alta". |
| Otro caso | "Nueva falla en {máquina}". Igual que hoy. |

El mensaje y los demás avisos no cambian.

---

## 7. Frontend: solo los tipos

No hay pantallas nuevas ni cambios visibles.

- **`frontend/src/api/tipos.ts`:**
  - en `MaquinaLista`, `tipo` pasa a ser `modelo`;
  - se suman `estado_desde`, `criticidad`, `tipo_equipo` y `sector.planta`;
  - interfaces nuevas: `Criticidad`, `TipoEquipo` y `Planta`.
- **`frontend/src/dev-ui/Maquinas.tsx`:** cambiar `tipo` por `modelo`, nada más. La interfaz provisional se borra cuando la F3b cubra máquinas.

---

## 8. Pruebas

### 8.1 Archivo nuevo `backend/tests/maquinas.test.ts`

Script `test:maquinas`.

- **Datos:** crea sus propios sectores, plantas y máquinas. Cuando necesita niveles de criticidad para un caso, también los crea, con códigos únicos y `orden` desde 900.
- **Limpieza:** borra todo por los ids que guardó.
- **No depende de los nombres actuales de los catálogos:** por ejemplo, el valor por omisión se consulta, no se supone que es "Media".

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| MQ-01 | Catálogos, con un operario | Las tres rutas responden 200 y en el orden de la sección 2. Un nivel inactivo creado por la prueba no aparece. |
| MQ-02 | Representación | `GET /api/maquinas` y `/:id` traen todos los campos de 3.1, con ids numéricos. Para una misma máquina, el elemento de la lista y el detalle son iguales (`deepStrictEqual`). |
| MQ-03 | `estado_desde` | (a) Máquina nueva: `creado_en`.<br>(b) Después de reportar una falla que la detiene: el `cambiado_en` del registro `DETENIDA`.<br>(c) Después de confirmar la recuperación: el `cambiado_en` del registro de su estado nuevo.<br>(d) Un registro con el mismo estado anterior y nuevo, insertado a mano, no mueve la fecha. |
| MQ-04 | Alta | (a) Sin criticidad ni tipo: los de por omisión.<br>(b) Con ids válidos: esos.<br>(c) Con un id inexistente o inactivo: 400.<br>(d) Con `tipo`: 400.<br>(e) Con código repetido: 409 `CODIGO_MAQUINA_DUPLICADO`.<br>(f) La respuesta es igual a `GET /:id`. |
| MQ-05 | Edición | (a) Campo que no viene: no cambia.<br>(b) `null` y `""` vacían `codigo`, `modelo`, `ubicacion` y `observaciones`.<br>(c) `nombre: null`: 400.<br>(d) Cambio de criticidad y de tipo.<br>(e) Código repetido: 409.<br>(f) `estado`: 422. |
| MQ-06 | Desactivar | (a) Con una intervención pendiente: 409 `MAQUINA_CON_INTERVENCIONES_ABIERTAS`, por `DELETE` y por `PUT`.<br>(b) Con una intervención finalizada "sigue detenida": 409 `MAQUINA_CON_DETENCIONES_ABIERTAS`.<br>(c) Sin nada abierto: 200, y no aparece en `GET /api/maquinas`.<br>(d) `PUT` con `activo: true`: vuelve a aparecer.<br>(e) Con su sector inactivo: 400. |
| MQ-07 | Sectores con planta | (a) Alta con planta: `GET` la muestra.<br>(b) `PUT` con `planta_id: null`: queda sin planta.<br>(c) `PUT` con `descripcion: ""`: la vacía.<br>(d) Planta inexistente: 400. |
| MQ-08 | Orden del tablero | Dos máquinas detenidas, con niveles de la prueba de `orden` 901 y 902. La de 902 lleva más tiempo detenida, pero aparece **después** de la de 901. |
| MQ-09 | Tablero con `planta_id` | (a) Los tres bloques cuentan solo máquinas de esa planta.<br>(b) Planta inexistente: 404 `PLANTA_NO_ENCONTRADA`.<br>(c) `abc`: 400. |
| MQ-10 | Aviso de falla | (a) Máquina con nivel de `prioridad_alta`, sin detención: aviso `ALTA` con "— criticidad {nombre}".<br>(b) La misma, con detención: `ALTA` con "— máquina detenida".<br>(c) Nivel sin `prioridad_alta` y sin detención: `NORMAL` con "Nueva falla en {máquina}".<br>Se miran los avisos de un usuario propio de la prueba con `NOTIFICACIONES_FALLAS_RECIBIR`. |

### 8.2 Pruebas existentes

**Cambios permitidos:**

- cambiar `tipo` por `modelo` en los `INSERT INTO maquinas` y en los cuerpos que lo usen;
- cambiar la respuesta esperada para el código repetido, de 400 a 409, si alguna prueba lo verifica.

Si cualquier otra prueba existente falla por esta etapa, **frenar y preguntar**. Por ejemplo, una que desactive una máquina con trabajo abierto.

### 8.3 Control de `test:todo`

`scripts/run-all-tests.mjs` cuenta también `plantas`, `criticidades` y `tipos_equipo`. La línea queda con **once** números:

`[test:todo] Datos que quedaron: usuarios 0, sectores 0, maquinas 0, intervenciones 0, usuario_permiso 0, notificaciones 0, auditoria_permisos 0, repuestos 0, plantas 0, criticidades 0, tipos_equipo 0`

---

## 9. Documentación

1. **`docs/modelo-datos.md`:**
   - entradas para `criticidades`, `tipos_equipo` y `plantas`;
   - actualizar `maquinas` (criticidad, tipo de equipo, modelo) y `sectores` (planta).
2. **`docs/decisiones.md`:** agregar al final:

   > ## D-013 — Datos de la máquina: criticidad, tipo de equipo y planta
   >
   > **Estado:** Aceptada
   >
   > La máquina tiene **criticidad** y **tipo de equipo**, los dos de catálogos configurables con un valor por omisión. El **sector** puede pertenecer a una **planta**.
   >
   > Datos iniciales:
   >
   > - criticidades Alta, Media (por omisión) y Baja;
   > - tipos de equipo Máquina (por omisión), Vehículo, Instalación y Herramienta menor;
   > - ninguna planta.
   >
   > Una falla en una máquina cuya criticidad tiene `prioridad_alta` avisa con prioridad alta aunque no la detenga. El texto libre `tipo` pasa a llamarse `modelo` (marca y modelo).
   >
   > **Motivo:** relevamiento, requisitos 9 y 10. El tablero muestra primero las máquinas más críticas, y una empresa con varias plantas puede filtrar por planta.

   Si falta D-012, que cita el relevamiento, agregarla antes con el texto de la sección 1 del relevamiento.

---

## 10. Lo que viene en la F3b (para orientar; no se hace en esta etapa)

- **R1 Tablero:**
  - contadores que abren la lista filtrada;
  - "Detenidas ahora", ordenada por criticidad y con la inactividad en curso;
  - selector de planta, si hay dos o más.
- **R4 Máquinas:**
  - tabla con código, nombre, criticidad, tipo, sector y planta, estado y desde cuándo, e intervenciones abiertas;
  - filtros;
  - "Nueva máquina".
- **R5 Detalle de máquina:**
  - datos;
  - estado y desde cuándo;
  - detenciones abiertas, con "Confirmar que volvió a funcionar";
  - fuera de servicio y vuelta;
  - inactividad de los últimos 30 días;
  - intervenciones de la máquina;
  - reportar una falla en esa máquina;
  - editar, desactivar y reactivar.

---

## 11. Fuera de alcance

- **Alta y edición de criticidades, tipos de equipo y plantas,** con sus pantallas y su API de escritura: van en la F4, junto con Sectores (A3). Hasta entonces se cargan por SQL.
- **Filtro por planta** en la lista de intervenciones (R2) y en los reportes.
- **Aplicar las migraciones 005 a 013** en la base principal.
- **Pantallas:** son la F3b.

---

## 12. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 9 están hechas, en dos commits (regla 2):
   1. `feat(db): migración 013, datos de la máquina`;
   2. `feat(api): criticidad, tipo de equipo y planta en máquinas, sectores y tablero`.
2. `npm run test:migration-013` y `npm run test:maquinas` en verde.
3. `npm run test:todo -- etapa-f3a`:
   - en verde;
   - con el total de antes (274) más las pruebas nuevas;
   - con los **once** números en 0;
   - corrido **dos veces seguidas**;
   - el log de la segunda va en `docs/evidencia/`.
4. `npm run test:front`, `npm run typecheck` y `npm run build:frontend` sin errores.
5. Push de los dos commits en `feat/base-neon`.

**Informe corto:**

1. Los hashes de los dos commits.
2. De las dos corridas de `test:todo`: la línea de total y la de datos que quedaron.
3. Cuántas pruebas nuevas hay en `migration_013` y en `maquinas`.
4. Las pruebas existentes que se modificaron y por qué.
5. Desvíos.
6. Dudas.
