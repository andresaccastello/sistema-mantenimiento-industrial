# Etapa P — Pendientes técnicos del backend

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `7f177e0` (Etapa 8.2).
> **Para qué:** cerrar los pendientes chicos que fueron quedando, antes de empezar el frontend. No hay funcionalidad nueva.
> **Origen:** revisión del código y una corrida de todas las pruebas en una base **nueva** (solo migraciones y `seed_admin`). En esa base, 6 de las 8 suites de migraciones fallan porque esperan datos que ya no existen.

---

## 0. Reglas de trabajo

Las de la Etapa 8.2 (sección 0). Además:

1. Solo se tocan los archivos y las pruebas que nombra este documento.
2. **No cambia ningún código de estado HTTP** ni el comportamiento de ningún endpoint, salvo lo que se pide acá.
3. Ante cualquier diferencia con lo que dice el documento, **frenar y preguntar**.

Guardar este archivo como `docs/etapas/etapa-p-pendientes-tecnicos.md`.

### Fuera de alcance

- **Aplicar las migraciones 005 a 011 en la base principal.** Se hará en un paso aparte, con respaldo previo, cuando se prepare una versión para mostrar.
- Repuestos, costos, preventivos, reportes nuevos y frontend.

---

## 1. Versiones fijas de las dependencias

**Problema:** `package.json` (raíz) y `frontend/package.json` tienen 13 dependencias en `"latest"` y otras con `^`. Una instalación nueva puede traer versiones distintas a las probadas.

**Cambio:**

1. Reemplazar **todas** las versiones de los dos `package.json` por la versión **exacta** que figura hoy en `package-lock.json`: sin `latest`, sin `^` y sin `~`. No se actualiza nada; se fija lo que ya está instalado.
2. Agregar un `.npmrc` en la raíz con `save-exact=true`, para que las instalaciones futuras también queden fijas.
3. Verificar que `npm ci` instala sin errores y que `package-lock.json` no cambia, salvo los rangos de versión.

---

## 2. Fechas tomadas de la base y no del reloj de Node

**Problema:** en dos lugares se guarda una fecha generada con `new Date()` en Node, en lugar de usar la hora de la base como el resto del sistema:

| Lugar | Hoy |
| :--- | :--- |
| `motor.ts`, INICIAR sin `fecha_inicio` | `camposExtra.fecha_inicio = new Date().toISOString()` |
| `motor.ts`, auditoría de `ELIMINACION_LOGICA` | `valorNuevo: new Date().toISOString()` |

**Cambio:**

- **INICIAR:** si no viene `fecha_inicio`, se usa el `NOW()` de la misma transacción. Leerlo como texto (`SELECT NOW()::text`) para no perder los microsegundos, y pasarlo tanto a `fecha_inicio` como a `fechaEfectiva`.
- **Eliminación:** el valor de la auditoría es el `eliminado_en` que se acaba de guardar. Usar `RETURNING eliminado_en` del `UPDATE` y no generar otra fecha.
- En `backend/functions` no queda ningún `new Date()` que genere una fecha que se guarde en la base. Para leer o dar formato sí se puede usar.

---

## 3. Responsables habilitados sin una consulta por usuario

**Problema:** `GET /api/intervenciones/:id/responsables-habilitados` recorre todos los usuarios activos y llama a `validarResponsableHabilitado` para cada uno. Son 2 o más consultas por usuario, así que la cantidad de consultas crece con la cantidad de usuarios.

**Cambio:**

- Armar la lista con una cantidad **fija** de consultas, que no dependa de cuántos usuarios haya. Usar `usuariosConPermiso` (de `notificaciones.ts`) para `INTERVENCIONES_RECIBIR_ASIGNACION` y para `INTERVENCIONES_VER`, más **una** consulta para traer `legajo` y `nombre`.
- La regla de visibilidad es la misma de `validarResponsableHabilitado`, según el alcance de `INTERVENCIONES_VER`:
  - `TODAS`: habilitado;
  - `PROPIAS`: habilitado, porque la asignación la vuelve propia;
  - `SECTORES`: habilitado solo si el sector de la máquina está entre sus sectores.
- Mismo formato de respuesta y mismo orden (por `nombre`).
- `validarResponsableHabilitado` no cambia: se sigue usando al asignar.
- Si la prueba P-03 muestra diferencias entre las dos reglas, **frenar y avisar**; no ajustar una para que coincida con la otra.

---

## 4. Todas las respuestas de error con `codigo`

**Problema:** 26 respuestas de error devuelven solo `{ error }`, sin `codigo`. El resto del sistema usa `{ error, codigo }`. Para el frontend conviene un formato único.

**Cambio:** agregar `codigo` sin cambiar el código HTTP ni el mensaje:

| Dónde | Respuesta | `codigo` |
| :--- | :--- | :--- |
| `validations.ts`, `badRequest` | 400 | `DATOS_INVALIDOS` |
| `middleware.ts`: sin token, identificador inválido, usuario inactivo o inexistente | 401 | `NO_AUTENTICADO` |
| `middleware.ts`: permiso o alcance insuficiente | 403 | `PERMISO_INSUFICIENTE` |
| `middleware.ts`: error interno | 500 | `ERROR_INTERNO` |
| `maquinas.ts`: ver máquinas desactivadas sin permiso | 403 | `PERMISO_INSUFICIENTE` |
| `maquinas.ts`: máquina no encontrada (todos los casos) | 404 | `MAQUINA_NO_ENCONTRADA` |
| `sectores.ts`: sector no encontrado | 404 | `SECTOR_NO_ENCONTRADO` |
| `maquinas.ts` y `sectores.ts`: error interno | 500 | `ERROR_INTERNO` |

Al terminar, en `backend/functions` no queda ninguna respuesta de error sin `codigo`. Para buscarlas, usar la expresión `json\(\s*\{\s*error`.

---

## 5. Pruebas de migraciones independientes de datos previos

**Problema:** `migration_003`, `005`, `006`, `007`, `008` y `migration_011` (M11-06) toman "el primer sector, máquina o usuario" que encuentran con `LIMIT 1`. En una base nueva no hay ninguno y fallan. Además, cuando sí existen, las pruebas modifican datos que no crearon.

**Cambio:**

- Cada una de esas suites crea su propio sector y su propia máquina, con nombres únicos como en `tiempos.test.ts`, y los borra al final.
- El usuario se busca por legajo (`ADMIN001`) o se crea uno propio.
- En `migration_009` (línea 122), cambiar `SELECT id FROM usuarios LIMIT 1` por la búsqueda de `ADMIN001`.
- Lo que verifica cada prueba no cambia.

Yo lo voy a verificar al revisar: correré todo en una base recién creada, con solo las migraciones y `seed_admin`.

---

## 6. E-06 con la lista exacta de motivos

**Problema:** E-06 (`reapertura_eliminacion.test.ts`) verifica `motivos.includes(...)`. Si aparece un motivo de más, la prueba no lo detecta.

**Cambio:** en cada caso de E-06, comparar la lista completa, ordenada, con `deepStrictEqual`. Los valores esperados son los que hoy se verifican con `includes`. Si en algún caso el código devuelve motivos adicionales, **frenar y avisar**.

---

## 7. `.env.example` completo

1. **Cambio en `.env.example`:**
   - Listar todas las variables que usa el backend, **sin valores reales**: `DATABASE_URL`, `NEON_TEST_BRANCH_ID`, `JWT_SECRET` y `ADMIN_INITIAL_PASSWORD`, cada una con un comentario de una línea.
   - Mostrar el formato de `DATABASE_URL` con datos inventados y `sslmode=verify-full`, por ejemplo: `postgresql://USUARIO:CLAVE@HOST/BASE?sslmode=verify-full`. Así desaparece el aviso de seguridad de `pg` que hoy llena los logs.
2. **No se toca el `.env` real.** Lo actualiza Andrés.

---

## 8. Pruebas

Las pruebas nuevas van en `backend/tests/pendientes.test.ts`, con el script `test:pendientes`. Crean sus propios datos.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| P-01 | Iniciar **sin** `fecha_inicio` | Son iguales al milisegundo: `fecha_inicio` de la intervención, `cambiado_en` de la fila `EN_PROCESO` y su `fecha_efectiva` |
| P-02 | Eliminar una intervención pendiente | `valor_nuevo` de la auditoría `ELIMINACION_LOGICA` es igual al milisegundo al `eliminado_en` guardado |
| P-03 | Responsables habilitados con estos usuarios: (a) responsable de mantenimiento; (b) operario; (c) operario con excepciones `CONCEDER` de `INTERVENCIONES_RECIBIR_ASIGNACION` y de `INTERVENCIONES_VER` con alcance `SECTORES`, asignado a **otro** sector; (d) lo mismo, pero asignado al sector de la máquina; (e) responsable con `DENEGAR` de `RECIBIR_ASIGNACION`; (f) responsable inactivo | La lista incluye a (a) y (d) y no incluye a (b), (c), (e) ni (f). Además, para **todos** los usuarios activos, aparecer en la lista coincide con que `validarResponsableHabilitado` no lance error. |
| P-04 | Formato de errores | Sin token → 401 `NO_AUTENTICADO`; sin permiso → 403 `PERMISO_INSUFICIENTE`; máquina inexistente → 404 `MAQUINA_NO_ENCONTRADA`; sector inexistente → 404 `SECTOR_NO_ENCONTRADO`; id inválido (`/api/maquinas/abc`) → 400 `DATOS_INVALIDOS` |

Todas las pruebas existentes siguen pasando. Los únicos cambios permitidos en pruebas existentes son los de las secciones 5 y 6.

---

## 9. Criterios de cierre

1. Las secciones 1 a 7 están hechas.
2. P-01 a P-04 pasan.
3. `npm run test:todo -- etapa-p` corre en verde; el log queda en `docs/evidencia/etapa-p-pruebas.log`, con la línea de total. El typecheck también pasa.
4. Commit y push en `feat/base-neon`.

---

## 10. Informe a entregar

1. Archivos modificados.
2. La línea de total copiada **del log** y el resultado del typecheck.
3. Las versiones que quedaron fijadas, raíz y frontend, en una tabla.
4. Pruebas existentes modificadas y motivo.
5. **Todos** los desvíos.
6. Dudas.
