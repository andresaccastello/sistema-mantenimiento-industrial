# Etapa API — API para el front

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `c2152c2` (Etapa P).
> **Base:** `docs/front/mapa-pantallas.md` (aprobado), sección 6. Esta etapa implementa API-01, 02, 03, 04, 06 y 07. API-05 (excepciones de permisos) queda para una etapa aparte, antes de F4.
> **Para qué:** que el frontend tenga todo lo que necesitan las pantallas de las etapas F0 a F3 sin repetir lógica del backend.

---

## 0. Reglas de trabajo

Las de la Etapa P (sección 0). Además:

1. **No cambia el formato de ninguna respuesta existente.** Solo se **agregan** campos, parámetros o endpoints. La interfaz provisional y las 244 pruebas actuales tienen que seguir funcionando sin cambios.
2. Ante cualquier diferencia entre lo que dice el documento y lo que hace el código, **frenar y preguntar**. Esto vale especialmente para la tabla de la sección 2.4: no se ajustan ni el código ni la tabla para que coincidan.
3. Informe corto (sección 10): hash, línea de total del log, desvíos y dudas.

Guardar este archivo como `docs/etapas/etapa-api-front.md` y el mapa como `docs/front/mapa-pantallas.md`.

---

## 1. Paso previo: decisiones

En `docs/decisiones.md`, agregar:

| ID | Decisión |
| :-: | :--- |
| D-009 | **Sistema general, marca por instalación.** El código no tiene nada específico de una empresa. El sistema se llama "Sistema de Mantenimiento Industrial"; el nombre de la empresa y el logo se configuran en cada instalación (tabla `configuracion_sistema`). Una instalación atiende a una empresa: varias empresas en una misma base (multiempresa) queda fuera de alcance y se evaluará si se integra con otro sistema. |
| D-010 | **Frontend:** React con Mantine (licencia MIT), versiones exactas. Escritorio primero; en celular la pantalla se acomoda sola y, si se confirma el uso, habrá una vista propia para las pantallas del operario. Paleta tomada de SolGest como referencia visual. |
| D-011 | **Mapa de pantallas aprobado** (`docs/front/mapa-pantallas.md`). Es la referencia de las etapas F0 a F5. |

---

## 2. API-01 — Acciones disponibles en el detalle de una intervención

### 2.1 Qué se agrega

`GET /api/intervenciones/:id` agrega el campo `acciones_disponibles`: una lista de códigos, siempre en este orden y sin repetidos:

`TOMAR`, `ASIGNAR`, `DESASIGNAR`, `INICIAR`, `ESPERAR_REPUESTOS`, `REANUDAR`, `FINALIZAR`, `RESOLVER_AHORA`, `CANCELAR`, `REABRIR`, `REGISTRAR_DETENCION`, `EDITAR`, `ELIMINAR`.

`ASIGNAR` incluye reasignar. Si la intervención está eliminada, la lista está vacía.

### 2.2 Qué significa

Una acción aparece en la lista **si y solo si** ese endpoint, llamado ahora por este usuario con el `estado_esperado` correcto y un cuerpo válido, **no** la rechazaría por estado, permiso, alcance, regla de actor (responsable o autoasignación), habilitación del responsable, detención ya abierta o motivos de bloqueo de la eliminación.

Las validaciones que dependen de los datos que se mandan (fechas, motivo, trabajo realizado, usuario destino) **no** cuentan: esas las resuelve el diálogo del frontend.

### 2.3 Cómo se implementa: una sola fuente de verdad

- Por cada acción, las comprobaciones que hoy hace el endpoint **antes de escribir** y que **no dependen del cuerpo** se pasan a una función de verificación **sin efectos** (sin `UPDATE`, sin `INSERT`, sin eventos). El endpoint la llama antes de modificar, y `acciones_disponibles` llama a la misma.
- `aplicarReglaActor` se separa en dos partes: `verificarReglaActor`, solo comprobaciones, y la asignación automática con su auditoría. La asignación automática no cambia.
- Los motivos de bloqueo de la eliminación (`ESTADO_NO_PENDIENTE`, `TIENE_FECHA_INICIO`, `TIENE_HISTORIAL`, etc.) salen de **una** función compartida, que usan el endpoint de eliminar y `acciones_disponibles`.
- Los códigos HTTP y de error que devuelven hoy los endpoints **no cambian**. Las 244 pruebas lo controlan.
- La lista se calcula sin modificar nada y con una cantidad de consultas que no depende de la cantidad de usuarios.

### 2.4 Tabla de acciones esperadas

**Usuarios** (todos ven la intervención):

- **R1** y **R2**: perfil `RESPONSABLE_MANTENIMIENTO`.
- **OP**: perfil `OPERARIO`, creador de la intervención.
- **CON**: perfil `CONSULTA`.

**Situaciones:** una falla creada por OP sobre una máquina sin detención; después se lleva a cada estado usando la API.

| Situación | R1 | R2 | OP | CON |
| :--- | :--- | :--- | :--- | :--- |
| **S1** Pendiente, sin responsable | TOMAR, ASIGNAR, INICIAR, RESOLVER_AHORA, CANCELAR, REGISTRAR_DETENCION, EDITAR, ELIMINAR | igual que R1 | EDITAR | — |
| **S2** Pendiente, responsable R1 (R1 la tomó) | ASIGNAR, DESASIGNAR, INICIAR, RESOLVER_AHORA, CANCELAR, REGISTRAR_DETENCION, EDITAR, ELIMINAR | igual que R1 | — | — |
| **S3** En proceso, responsable R1 | ASIGNAR, ESPERAR_REPUESTOS, FINALIZAR, CANCELAR, REGISTRAR_DETENCION, EDITAR | igual que R1 | — | — |
| **S4** Esperando repuestos, responsable R1 | ASIGNAR, REANUDAR, CANCELAR, REGISTRAR_DETENCION, EDITAR | igual que R1 | — | — |
| **S5** Finalizada | REABRIR | REABRIR | — | — |
| **S6** Cancelada | — | — | — | — |
| **S7** Igual que S1, pero con un período de detención abierto | no incluye REGISTRAR_DETENCION | no incluye REGISTRAR_DETENCION | EDITAR | — |

R2 tiene la misma lista que R1 aunque no sea el responsable, porque tiene `INTERVENCIONES_ASIGNAR` y la regla de actor se lo permite.

---

## 3. API-02 — Filtros y paginación en `GET /api/intervenciones`

Parámetros nuevos, todos opcionales y combinables. Se aplican **dentro** del alcance actual del usuario: solo achican el resultado.

| Parámetro | Valor | Filtra por |
| :--- | :--- | :--- |
| `estado` | uno o varios, separados por coma | estado de la intervención; un estado inexistente → 422 `DATOS_INVALIDOS` |
| `maquina_id` | entero | máquina |
| `sector_id` | entero | sector de la máquina |
| `tipo` | código (`CORRECTIVO`, `PREVENTIVO`) | tipo |
| `responsable_id` | entero | responsable |
| `mias` | `true` | responsable = usuario actual |
| `desde`, `hasta` | ISO con zona | `fecha_creacion` dentro del rango; se validan con `validarFechaISO` |
| `q` | texto, 2 a 100 caracteres | descripción, nombre o código de la máquina (sin distinguir mayúsculas) |
| `limit` | 1 a 200 | tamaño de página |
| `offset` | 0 o más; por omisión, 0 | desplazamiento (solo se usa junto con `limit`) |

**Sin `limit`, la respuesta trae todo, como hoy.** Así no cambia nada para la interfaz provisional ni para las pruebas existentes. El frontend nuevo siempre manda `limit`.

- **Total:** la respuesta sigue siendo una lista (para no romper nada). El total de resultados con los filtros aplicados va siempre en el header `X-Total-Count`, haya o no `limit`. El header además se expone en CORS (`exposeHeaders`).
- **Orden:** el actual. Para que la paginación sea estable, al final del orden se agrega `i.id DESC` si todavía no está.
- Los parámetros actuales (`sin_asignar`, `incluir_eliminadas`) siguen igual.
- Un valor inválido en cualquier parámetro (por ejemplo, `limit=0` o `maquina_id=abc`) → 422 `DATOS_INVALIDOS`.

---

## 4. API-03 — Resumen para el tablero

`GET /api/tablero`. Requiere `INTERVENCIONES_VER`; sin ese permiso → 403.

```json
{
  "maquinas": { "OPERATIVA": 12, "DETENIDA": 2, "EN_MANTENIMIENTO": 1, "FUERA_DE_SERVICIO": 0 },
  "intervenciones": {
    "PENDIENTE": 5, "EN_PROCESO": 3, "EN_ESPERA_REPUESTOS": 1,
    "sin_asignar": 2, "mias_abiertas": 1
  },
  "detenidas_ahora": [
    {
      "maquina": { "id": 3, "nombre": "...", "codigo": "...", "sector": { "id": 1, "nombre": "..." } },
      "estado": "DETENIDA",
      "detenida_desde": "...",
      "inactividad_en_curso_minutos": 95,
      "intervenciones_abiertas": 1
    }
  ]
}
```

- **Máquinas:** solo las activas. Con alcance `TODAS` de `INTERVENCIONES_VER`, todas; con cualquier otro alcance, las de los sectores del usuario (mismo criterio que D-47).
- **Intervenciones:** se cuentan las mismas que vería el usuario en el listado (alcance actual, sin eliminadas). `sin_asignar` = pendientes sin responsable; `mias_abiertas` = abiertas con responsable = usuario.
- **`detenidas_ahora`:** máquinas con algún período de detención abierto (de intervenciones no eliminadas).
  - `detenida_desde` es el comienzo del período abierto más antiguo de esa máquina.
  - `inactividad_en_curso_minutos` es la diferencia entre ahora y `detenida_desde`, redondeada.
  - Ordenadas de mayor a menor tiempo.
- Cantidad de consultas fija.

---

## 5. API-04 — Tipos de intervención

`GET /api/tipos-intervencion` (con sesión iniciada): `[{ "id", "codigo", "nombre" }]`, ordenados por `codigo`.

---

## 6. API-06 — Intervenciones abiertas por máquina

`GET /api/maquinas` agrega `intervenciones_abiertas` a cada máquina: la cantidad de intervenciones `PENDIENTE`, `EN_PROCESO` o `EN_ESPERA_REPUESTOS` no eliminadas, **sin importar el alcance del usuario**. Es solo un número y no da detalle.

Se calcula en la misma consulta (subconsulta o `LEFT JOIN` con agregado), no con una consulta por máquina.

---

## 7. API-07 — Marca configurable por instalación

### 7.1 Migración `database/migrations/012_configuracion.sql`

Idempotente y en una transacción. Crea la tabla `configuracion_sistema`, de **una sola fila**:

| Columna | Tipo y regla |
| :--- | :--- |
| `id` | `SMALLINT PRIMARY KEY`, `CHECK (id = 1)` |
| `nombre_sistema` | `TEXT NOT NULL`, por omisión `'Sistema de Mantenimiento Industrial'` |
| `nombre_empresa` | `TEXT NULL` |
| `logo` | `BYTEA NULL`; `CHECK (octet_length(logo) <= 307200)`, es decir, 300 KB como máximo |
| `logo_tipo` | `TEXT NULL`; `CHECK (logo_tipo IN ('image/png', 'image/jpeg', 'image/webp'))` |
| `actualizado_en` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |

- `CHECK ((logo IS NULL) = (logo_tipo IS NULL))`: si hay logo, tiene tipo, y al revés.
- Inserta la fila `id = 1` con los valores por omisión, si no existe (`ON CONFLICT DO NOTHING`).
- **SVG no se admite**: puede llevar código ejecutable.

### 7.2 Endpoints públicos (sin iniciar sesión)

- `GET /api/configuracion/publica` → `{ "nombre_sistema", "nombre_empresa", "tiene_logo", "actualizado_en" }`. La pantalla de ingreso lo necesita antes de que haya sesión.
- `GET /api/configuracion/logo` → los bytes del logo, con:
  - `Content-Type` = `logo_tipo`;
  - `Cache-Control: public, max-age=3600`;
  - `X-Content-Type-Options: nosniff`.

  Si no hay logo → 404 `LOGO_NO_CONFIGURADO`.
- Ninguno de los dos devuelve otros datos de la base.

### 7.3 Script para cargar la marca

`npm run marca:cargar -- --empresa "Nombre S.A." --logo ruta/al/logo.png` (`scripts/cargar-marca.mjs`):

- Los dos parámetros son opcionales. `--sin-logo` borra el logo.
- El tipo se detecta por los **primeros bytes** del archivo (PNG, JPEG o WebP), no por la extensión. Otro tipo, o más de 300 KB → error claro, sin modificar nada.
- Usa el `DATABASE_URL` del `.env`. Antes de escribir, muestra el host y el nombre de la base a la que se conecta.
- **No se sube ningún logo de una empresa real al repositorio.**

### 7.4 `.env.example`

Agregar `CORS_ORIGIN`, que ya usa `api.ts` y faltaba, con un comentario de una línea.

---

## 8. Pruebas

Las pruebas nuevas van en `backend/tests/api_front.test.ts`, con el script `test:api-front`. Crean sus propios datos y los borran al final. También `backend/tests/migration_012.test.ts`.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| AF-01 | Tabla de la sección 2.4: las 7 situaciones × 4 usuarios | `acciones_disponibles` igual (lista y orden) a la tabla. En S7 solo se verifica la ausencia de `REGISTRAR_DETENCION`, y para OP, que sea `["EDITAR"]`. |
| AF-02 | Para R2 en S1, S3 y S5: ejecutar **cada** acción de la lista, sobre una intervención nueva en la misma situación y con un cuerpo válido. Para `ASIGNAR`, el destino es un responsable distinto del actual. | Todas responden 2xx. Además, dos acciones que **no** están en la lista de S3 (`INICIAR` y `REABRIR`, con el `estado_esperado` correcto) responden 409 `TRANSICION_NO_PERMITIDA` |
| AF-03 | Intervención eliminada | `acciones_disponibles` = `[]` |
| AF-04 | Filtros: `estado=PENDIENTE,EN_PROCESO`, `maquina_id`, `sector_id`, `tipo`, `responsable_id`, `mias`, `desde`/`hasta`, `q`, por separado y combinados, sobre un conjunto armado en la prueba | Cada uno devuelve exactamente las intervenciones esperadas |
| AF-05 | Paginación sobre 7 resultados (filtrados por una máquina de la prueba) con `limit=3` | `offset` 0, 3 y 6 devuelven 3, 3 y 1, sin repetidos ni faltantes; `X-Total-Count` = 7 en las tres. Sin `limit`, vienen los 7. |
| AF-06 | Operario (alcance PROPIAS) con filtros | Nunca aparece una intervención ajena, aunque coincida con el filtro |
| AF-07 | Parámetros inválidos: `estado=XX`, `limit=0`, `limit=500`, `maquina_id=abc`, `desde` sin zona, `q` de 1 carácter | 422 `DATOS_INVALIDOS` en todos |
| AF-08 | Tablero con datos armados (2 máquinas detenidas, una desde hace 2 h y otra desde hace 30 min; intervenciones en varios estados) | Contadores exactos; `detenidas_ahora` con 2 elementos, ordenados, con ≈ 120 y ≈ 30 minutos (tolerancia de 1) |
| AF-09 | Tablero con alcance `SECTORES` | Solo cuenta máquinas e intervenciones de sus sectores |
| AF-10 | `GET /api/tipos-intervencion` | Incluye `CORRECTIVO` y `PREVENTIVO`; sin sesión → 401 `NO_AUTENTICADO` |
| AF-11 | `intervenciones_abiertas` en `GET /api/maquinas` | Una máquina con 1 pendiente, 1 en proceso, 1 finalizada y 1 eliminada → 2 |
| AF-12 | Configuración pública sin sesión | 200 con `nombre_sistema` = "Sistema de Mantenimiento Industrial" y `tiene_logo` = false; logo → 404 `LOGO_NO_CONFIGURADO` |
| AF-13 | Cargar un PNG chico por SQL en la prueba | `tiene_logo` = true; el logo responde 200, con `Content-Type: image/png`, `nosniff` y los mismos bytes. Al terminar, la fila vuelve a como estaba. |
| M12-01 | `migration_012` | La tabla existe; la fila 1 existe; correr la migración dos veces no falla; un segundo `INSERT` con `id = 2` falla; un logo de más de 300 KB o con tipo `image/svg+xml` falla |

---

## 9. Criterios de cierre

1. Las secciones 1 a 7 están hechas; la migración 012 está aplicada **solo** en la rama de pruebas.
2. AF-01 a AF-13 y M12-01 pasan, junto con las 244 anteriores **sin modificar ninguna**.
3. `npm run test:todo -- etapa-api-front` corre en verde; el log queda en `docs/evidencia/` con la línea de total. El typecheck también pasa.
4. Commit y push en `feat/base-neon`.

---

## 10. Informe a entregar (corto)

1. Hash del commit y rama.
2. Línea de total copiada **del log** y resultado del typecheck.
3. Desvíos, con su motivo.
4. Dudas.

No hace falta describir las pruebas ni listar archivos: se revisan en el commit.
