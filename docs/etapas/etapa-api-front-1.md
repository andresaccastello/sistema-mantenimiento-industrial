# Etapa API.1 — Correcciones de la API para el front

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `3876b04` (Etapa API).
> **Origen:** revisión del commit y pruebas propias en una base nueva. Los problemas de las secciones 1, 2 y 3 se reprodujeron antes de escribir este documento.

---

## 0. Reglas de trabajo

Las de la Etapa API (sección 0). Además:

1. Las 266 pruebas actuales tienen que seguir pasando **sin modificar ninguna**. Si al reorganizar el código alguna prueba existente cambia de resultado (por ejemplo, devuelve otro código de error), **frenar y avisar**.
2. **Si no se cumple algo del requerimiento, se declara en el informe.** En la Etapa API, la sección 2.3 (una sola fuente de verdad) no se implementó y el informe no lo mencionó.

Guardar este archivo como `docs/etapas/etapa-api-front-1.md`.

---

## 1. Acciones disponibles con una sola fuente de verdad (lo principal)

### Problema

La sección 2.3 de la Etapa API pedía que `acciones_disponibles` usara **las mismas funciones de verificación** que los endpoints. Pero `obtenerAccionesDisponibles` reescribe las reglas por su cuenta. Solo comparte `obtenerMotivosBloqueoEliminacion`, y ni siquiera llama a la `verificarReglaActor` que se creó. Ya hay diferencias:

- **ELIMINAR (reproducido):** la lista aplica el alcance del permiso (propias o sectores), pero el endpoint no lo hace. Según el análisis, sección 8.3, `INTERVENCIONES_ELIMINAR` no tiene alcance. Caso: un responsable con la excepción `CONCEDER INTERVENCIONES_ELIMINAR` alcance `PROPIAS`, sobre una falla de otro usuario. La lista **no** incluye ELIMINAR, pero el endpoint elimina y responde **200**.
- **ESPERAR_REPUESTOS, REANUDAR y FINALIZAR sin responsable:** la lista exige un responsable. El endpoint, en cambio, aplica la regla de actor, que con `INTERVENCIONES_ASIGNARSE` autoasigna y sigue.

Con reglas duplicadas, cualquier cambio futuro en un endpoint deja la lista desactualizada sin que nadie se dé cuenta.

### Solución

**a) Transiciones de la tabla.** Crear `verificarTransicion(db, accion, intervencion, maquina, usuario)`. Hace, en este orden:

1. `buscarTransicion(accion, estado)`; si no hay transición → 409 `TRANSICION_NO_PERMITIDA`.
2. Controla el permiso de esa transición.
3. Si `requiereActor`, llama a `verificarReglaActor` con el `validaHabilitacion` de la tabla.

La usan, **antes de escribir**, `ejecutarTransicionServicio` (INICIAR, ESPERAR_REPUESTOS, REANUDAR), `finalizarIntervencionServicio`, `resolverAhoraIntervencionServicio`, `cancelarIntervencionServicio` y `reabrirIntervencionServicio`. Reemplaza las comprobaciones equivalentes que hoy están escritas dentro de cada uno.

**b) Las demás acciones.** Una función de verificación por acción, sacada del servicio que ya existe:

| Función | Qué comprueba |
| :--- | :--- |
| `verificarTomar` | permiso, estado, sin responsable, habilitación |
| `verificarAsignar` | permiso, estado; **no** el usuario destino, porque depende de lo que se manda |
| `verificarDesasignar` | permiso o propio con `ASIGNARSE`, estado, que tenga responsable |
| `verificarRegistrarDetencion` | permiso, estado, sin período abierto |
| `verificarEditar` | permiso, estado, reglas de alcance de D-33 |
| `verificarEliminar` | permiso y `obtenerMotivosBloqueoEliminacion` |

Cada servicio llama a su función antes de escribir. Se respetan el orden de las comprobaciones y los códigos de error de hoy.

**c) `obtenerAccionesDisponibles`.** Para cada una de las 13 acciones, llama a **su** función de verificación dentro de un `try/catch`:

- si lanza `ErrorNegocio`, la acción no va a la lista;
- cualquier otro error se propaga.

No tiene reglas propias: se borra todo el código que hoy repite reglas, incluido el alcance de ELIMINAR.

**d) Lo que no cambia.** El control de `estado_esperado` y las validaciones del cuerpo siguen en cada servicio, como hoy.

---

## 2. Ver una intervención eliminada

### Problema

`GET /api/intervenciones/:id?incluir_eliminada=true` deja ver una eliminada a cualquiera que la vea. Reproducido:

- un usuario de consulta → 200;
- el operario que la creó → 200.

Pero el listado con `incluir_eliminadas=true` exige `INTERVENCIONES_ELIMINAR` y les responde 403.

El origen es mío: la prueba AF-03 suponía que el detalle de una eliminada se podía consultar, y no es así.

### Solución

- Misma regla que el listado: `incluir_eliminada=true` exige `INTERVENCIONES_ELIMINAR`; sin ese permiso → 403 `PERMISO_INSUFICIENTE`.
- En el detalle se acepta **solo** `incluir_eliminada` (en singular). Se quita el alias `incluir_eliminadas`.

---

## 3. El script de la marca no arranca

### Problema

`scripts/cargar-marca.mjs` importa `dotenv`, que no está entre las dependencias del proyecto. Siempre falla con `ERR_MODULE_NOT_FOUND`; se reprodujo con `npm run marca:cargar`. Además, si la fila `id = 1` no existe (falta la migración 012), informa éxito sin haber modificado nada.

### Solución

1. Quitar `dotenv`. El script de `package.json` pasa a ser `node --env-file=.env scripts/cargar-marca.mjs`. **No se agrega ninguna dependencia.**
2. Verificar que el `UPDATE` afectó exactamente una fila. Si no, mostrar el error "Falta aplicar la migración 012" y terminar con código 1.

---

## 4. Pruebas nuevas

Las pruebas nuevas van en `backend/tests/api_front.test.ts`.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| AF-14 | El caso de la sección 1: responsable con `CONCEDER INTERVENCIONES_ELIMINAR` alcance `PROPIAS`, sobre una falla creada por otro usuario | La lista **incluye** ELIMINAR y el endpoint responde 200. La lista y el endpoint coinciden. |
| AF-15 | En S1 y S3, para OP, CON y R2: ejecutar, con un cuerpo válido, **cada** una de las 13 acciones que **no** está en `acciones_disponibles`. Cada una, sobre una intervención nueva en esa situación. | Ninguna responde 2xx, y el estado de la intervención no cambia. AF-02 cubre la otra dirección (las que están en la lista responden 2xx). |
| AF-16 | Detalle de una intervención eliminada con `?incluir_eliminada=true` | Usuario de consulta → 403; operario creador → 403; administrador → 200 con `acciones_disponibles` = `[]`. Sin el parámetro → 404, para todos. |
| AF-17 | `cargar-marca.mjs` ejecutado como proceso aparte contra la base de pruebas | Con un PNG chico y `--empresa "Empresa de prueba"`: termina con código 0 y la configuración pública muestra `tiene_logo` = true y ese nombre. Con un archivo de texto que empieza con `<svg` y con un archivo de 301 KB: código distinto de 0 y la fila no cambia. Al terminar, la fila vuelve a como estaba, por SQL. |

---

## 5. Criterios de cierre

1. Las secciones 1 a 3 están hechas.
2. AF-14 a AF-17 pasan, junto con las 266 anteriores sin modificar ninguna.
3. `npm run test:todo -- etapa-api-front-1` corre en verde; el log queda en `docs/evidencia/` con la línea de total. El typecheck también pasa.
4. Commit y push en `feat/base-neon`.

---

## 6. Informe a entregar (corto)

1. Hash del commit y rama.
2. Línea de total copiada **del log** y resultado del typecheck.
3. Desvíos, incluido **todo lo del requerimiento que no se haya hecho**.
4. Dudas.
