# Etapa 8.2 — Correcciones de la 8.1

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `2ac591c` (Etapa 8.1).
> **Origen:** revisión del commit y pruebas en una base local. El caso de la sección 1 se reprodujo corriendo la propia migración dos veces.

---

## 0. Reglas de trabajo

Las mismas de la Etapa 8.1 (sección 0). Además:

1. Solo se tocan los archivos y las pruebas que nombra este documento.
2. El informe describe cada prueba **por lo que verifica en el código**, no por lo que pedía el documento. Errores del informe de la 8.1:
   - Decía "188 pruebas"; fueron 238, porque el log tiene dos tandas: 50 + 188.
   - Describía T-12 con "bruta 1500, neta 240"; el test verifica 240 y 240.
   - Mencionaba una consulta de reportes en M-10 que no existe.
   - Nombraba una restricción `ck_reportes_intervalo_maximo` que no existe.

Guardar este archivo como `docs/etapas/etapa-8.2-correcciones.md`.

---

## 1. El relleno de `fecha_efectiva` no es idempotente (grave)

### Problema

En `011_tiempos.sql`, los dos rellenos filtran `h.fecha_efectiva IS NULL` **dentro** de la CTE, antes del `DISTINCT ON`. Entonces eligen "la primera fila sin fecha" y no "la primera fila". En la segunda corrida, esa fila es otra.

Caso reproducido: una intervención reabierta tal como la escribe el motor nuevo. Las filas son `EN_PROCESO` (con fecha), `FINALIZADA` (con fecha), `EN_PROCESO` de la reapertura (`NULL`) y `FINALIZADA` (con fecha). Al correr la migración otra vez:

- la fila `EN_PROCESO` de la reapertura recibe `fecha_inicio`;
- la neta pasa de **240 a 1500**.

Con datos viejos pasa lo mismo con las `FINALIZADA`: en la segunda corrida, la `FINALIZADA` anterior a la reapertura recibe la fecha del último cierre.

`migration_011` corre la migración dos veces en cada `test:todo`, así que en la rama de pruebas esto pasa en cada corrida. La M11-06 no lo detecta porque usa una intervención sin reapertura.

### Solución

Elegir la primera o la última fila entre **todas** las del estado, y actualizar solo si **esa** fila tiene `fecha_efectiva` en `NULL`:

```sql
WITH primera_en_proceso AS (
  SELECT DISTINCT ON (h.intervencion_id) h.id, i.fecha_inicio
  FROM historial_estados_intervencion h
  JOIN intervenciones i ON i.id = h.intervencion_id
  WHERE h.estado_nuevo = 'EN_PROCESO'
  ORDER BY h.intervencion_id, h.cambiado_en ASC, h.id ASC
)
UPDATE historial_estados_intervencion h
SET fecha_efectiva = p.fecha_inicio
FROM primera_en_proceso p
WHERE h.id = p.id
  AND h.fecha_efectiva IS NULL
  AND p.fecha_inicio IS NOT NULL;
```

La de `FINALIZADA` sigue el mismo criterio. Conserva `WHERE h.estado_nuevo = 'FINALIZADA' AND i.estado = 'FINALIZADA'` en la CTE, `ORDER BY … cambiado_en DESC, id DESC`, y `h.fecha_efectiva IS NULL AND fecha_finalizacion IS NOT NULL` en el `UPDATE`.

No hace falta reparar datos: la 011 no está aplicada en la base principal.

### M11-06 (ampliar)

Además del caso actual, agregar estos dos:

| Caso | Datos | Esperado |
| :-: | :--- | :--- |
| a | Intervención reabierta como la escribe el motor. Historial: `PENDIENTE` 01/01 08:00 sin fecha; `EN_PROCESO` registrado 09:00 con fecha 09:00; `FINALIZADA` registrado 02/01 08:00 con fecha 01/01 12:00; `EN_PROCESO` registrado 02/01 09:00 sin fecha; `FINALIZADA` registrado 02/01 10:00 con fecha 10:00. `fecha_inicio` 01/01 09:00, `fecha_finalizacion` 02/01 10:00. | Después de dos corridas, ninguna fila cambia; la fila de la reapertura sigue en `NULL`; en la vista, bruta 1500 y neta 240. |
| b | El mismo historial, todo sin `fecha_efectiva` (dato viejo) | Después de la primera corrida, solo la primera `EN_PROCESO` y la última `FINALIZADA` tienen fecha. Después de la segunda, todo igual: la `FINALIZADA` anterior y la `EN_PROCESO` de la reapertura siguen en `NULL`. |

---

## 2. Quitar la ruta alias y el valor por omisión de `estado_esperado`

### Problema

Se agregó `POST /api/intervenciones/:id/transiciones/RESOLVER_AHORA`, que nadie pidió. Además, `resolver-ahora` ahora toma `estado_esperado = 'PENDIENTE'` cuando no viene en el cuerpo. Antes respondía 422, como el resto de las acciones (P-31).

Con ese valor por omisión, un cliente que no manda `estado_esperado` se saltea el control de concurrencia optimista. Y la única razón de la ruta era que T-11 la usa.

### Solución

1. Eliminar la ruta alias. `resolverAhoraHandler` queda solo en `/:id/resolver-ahora`.
2. Restaurar la validación: sin `estado_esperado` → `422 DATOS_INVALIDOS`.
3. T-11 llama a `/:id/resolver-ahora`.
4. Prueba nueva **B-40** en `motor_cierres.test.ts`: `resolver-ahora` sin `estado_esperado` → 422 `DATOS_INVALIDOS`, y la intervención sigue `PENDIENTE`.

---

## 3. Pruebas que no siguieron lo pedido

**T-12.** Hoy prueba un cierre registrado tarde **sin** reapertura, un caso que la vista vieja ya resolvía bien. Reemplazarla por el caso pedido en la 8.1, armado por SQL:

- `fecha_creacion` 01/01 08:00, `fecha_inicio` 01/01 09:00, `fecha_finalizacion` 02/01 10:00, estado `FINALIZADA`.
- El historial es el del caso 1.a.
- Esperado: bruta **1500**, neta **240**.

**M-10.** Falta la segunda parte: llamar también a `/api/reportes/inactividad` con el mismo intervalo. Debe responder 200 y la máquina tiene que aparecer con `inactividad_minutos` = 0.

**R-05.**

1. El ranking hoy pasa aunque venga vacío. Verificar que incluya `maquina1Id`, además de que todas las máquinas sean del sector 1.
2. Falta `/reportes/tiempos`. Crear por SQL una intervención finalizada en una máquina del sector 2, dentro del intervalo. Con `agrupar=sector`, la respuesta tiene que tener el grupo del sector 1 y no el del sector 2.

---

## 4. Total único en el log de `test:todo`

Con dos tandas, el log termina con el total de la segunda y es fácil leer mal el número.

1. Agregar `--test-reporter=spec` a las dos tandas, para que el formato del log sea igual en cualquier máquina.
2. Al terminar, sumar los totales de las dos tandas (líneas `ℹ tests`, `ℹ pass`, `ℹ fail`) y escribir al final del log una línea con este formato: `[test:todo] Total: N pruebas, N correctas, N fallidas (migraciones: N, negocio: N)`.

---

## 5. Criterios de cierre

1. Las correcciones de las secciones 1 a 4 están hechas.
2. Pasan M11-06 (los tres casos), T-11, T-12, M-10, R-05 y B-40, junto con todo lo anterior.
3. Corre `npm run test:todo -- etapa-8.2` en verde y el log queda en `docs/evidencia/etapa-8.2-pruebas.log`, con la línea de total. El typecheck también pasa.
4. Commit y push en `feat/base-neon`.

---

## 6. Informe a entregar

1. Archivos modificados.
2. El log adjunto, la línea de total copiada **del log** y el resultado del typecheck.
3. Tests modificados y motivo.
4. **Todos** los desvíos.
5. Dudas.
