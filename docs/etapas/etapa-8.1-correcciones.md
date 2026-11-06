# Etapa 8.1 — Correcciones de tiempos e inactividad

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `4c2d575` (Etapa 8).
> **Origen:** revisión del commit y pruebas en una base local recién migrada. Los casos de las secciones 1 y 2 se reprodujeron con SQL antes de escribir este documento.

---

## 0. Reglas de trabajo

Las mismas de la Etapa 8 (sección 0). Además:

1. Ante cualquier ambigüedad o contradicción con el código, **detenerse y preguntar**.
2. El informe describe **solo lo que está en el diff**. El informe de la Etapa 8 dice que se actualizaron las secciones 7.1 y 7.2 de `analisis-intervenciones.md`, pero el commit no las toca: solo cambia la sección 11.
3. Único cambio permitido en tests existentes: el de la sección 1.4. Cualquier otro se declara en el informe con su motivo.

Guardar este archivo como `docs/etapas/etapa-8.1-correcciones.md`.

---

## 1. Corrección principal: cuándo ocurrió un cambio y cuándo se registró

### 1.1 Problema

La duración neta toma los bordes de los tramos de `cambiado_en`, que es la hora en que se **registró** el cambio. Hay dos excepciones: el primer tramo empieza en `fecha_inicio` y el último termina en `fecha_finalizacion`.

Al reabrir, `fecha_finalizacion` se borra (D-09; el valor queda en la auditoría). Entonces el primer cierre se mide con la hora en que se registró y no con la hora en que terminó el trabajo.

Caso reproducido:

- Inicio el día 1 a las 09:00.
- El trabajo terminó a las 12:00, pero se registró el día 2 a las 08:00.
- Reabierta el día 2 a las 09:00 y finalizada a las 10:00.

La neta real es 240 min; la vista devuelve **1440**.

El origen es D-44 tal como estaba escrita en el requerimiento de la Etapa 8: no contemplaba más de un cierre. La implementación siguió lo pedido.

### 1.2 Solución: D-44 revisada

Cada fila del historial guarda dos momentos:

- `cambiado_en`: cuándo se registró. No cambia: sigue siendo `NOW()`.
- `fecha_efectiva` (columna nueva, admite `NULL`): cuándo ocurrió, para los cambios en que el usuario indica una fecha.

**Regla de la neta:**

1. Se suman los tramos `EN_PROCESO`. Cada tramo va desde `COALESCE(fecha_efectiva, cambiado_en)` de la fila que lo abre hasta el mismo valor de la fila siguiente, con las filas ordenadas por `cambiado_en, id`.
2. Un tramo abierto cuenta hasta `NOW()`.
3. Un tramo negativo cuenta 0.
4. Al final, `LEAST(neta, bruta)`, como hoy.

Se quitan los casos especiales actuales de la vista: `rn_en_proceso`, `next_next_cambiado_en` y el uso directo de `fecha_inicio` y `fecha_finalizacion` en los tramos.

### 1.3 Cambios

**a) Migración `011_tiempos.sql`.** Se modifica esta misma migración, porque todavía no se aplicó en la base principal. Va entera en una transacción (`BEGIN` / `COMMIT`) y en este orden:

1. `ALTER TABLE historial_estados_intervencion ADD COLUMN IF NOT EXISTS fecha_efectiva TIMESTAMPTZ NULL`, con un `COMMENT` que explique la diferencia con `cambiado_en`.
2. Relleno de las filas existentes. Es idempotente: solo toca filas con `fecha_efectiva IS NULL`.
   - La **primera** fila `EN_PROCESO` de cada intervención toma `intervenciones.fecha_inicio`, si no es `NULL`.
   - La **última** fila `FINALIZADA` de las intervenciones en estado `FINALIZADA` toma `fecha_finalizacion`.
   - Las demás filas quedan en `NULL` y usan `cambiado_en`.
3. `DROP VIEW IF EXISTS v_intervencion_tiempos;` y luego `CREATE VIEW` con la regla de 1.2. Las columnas, su orden y su significado no cambian.
4. La función `fn_inactividad_maquina`, con el ajuste de la sección 2.

**b) `registrarCambioEstado`.** Recibe un parámetro opcional nuevo, `fechaEfectiva`, y lo guarda en la fila del historial. Si no viene, se guarda `NULL`.

**c) Acciones que pasan `fechaEfectiva`.** En todos los casos es el mismo valor que se guarda en la intervención:

| Acción | Fila del historial | `fechaEfectiva` |
| :--- | :--- | :--- |
| INICIAR (T1) | → `EN_PROCESO` | `fecha_inicio` |
| RESOLVER_AHORA (T2) | → `EN_PROCESO` | `fecha_inicio` |
| RESOLVER_AHORA (T2) | → `FINALIZADA` | `fecha_finalizacion` |
| FINALIZAR (T6) | → `FINALIZADA` | `fecha_finalizacion` |

El resto de las acciones no la pasa.

**d) `GET /api/intervenciones/:id`.** Agregar `fecha_efectiva` a cada elemento de `historial_estados`.

### 1.4 Tests existentes

T-05 y T-06 arman por SQL las filas que escribe el motor. Desde ahora el motor guarda `fecha_efectiva`, así que esas pruebas tienen que insertarla en las filas que corresponda según la tabla 1.3.c. Los resultados esperados no cambian.

---

## 2. Período con `desde` unos segundos en el futuro

### Problema

Al abrir un período, `desde` admite hasta 10 segundos en el futuro, para tolerar la diferencia de reloj. Durante esos segundos, `tstzrange(p.desde, COALESCE(p.hasta, NOW()))` falla con *range lower bound must be less than or equal to range upper bound* y devuelve 500.

Afecta a `/maquinas/:id/inactividad` y a **todo** `/reportes/inactividad`: un solo período así rompe el ranking de todas las máquinas.

### Solución

Usar `GREATEST(p.desde, COALESCE(p.hasta, NOW()))` como límite superior en:

- `fn_inactividad_maquina` (las tres agregaciones);
- la consulta de `periodos` en `maquinas.ts`;
- el conteo `intervenciones_con_detencion` en `reportes.ts`.

En la vista, la duración de cada período se calcula con `GREATEST(0, …)`.

---

## 3. Alcance de `REPORTES_CONSULTAR` (D-47)

### Problema

Los tres endpoints filtran solo cuando el alcance es `SECTORES`. Con `PROPIAS`, que la base admite y se puede asignar como excepción, el usuario ve todas las máquinas.

### D-47 (agregar a la sección 11 del análisis)

| ID | Decisión | Resolución |
| :-: | :--- | :--- |
| D-47 | Alcance de los reportes | **Aprobada:** con alcance `TODAS` se ve todo. Con cualquier otro alcance, solo las máquinas de los sectores del usuario: los reportes no tienen "propias". |

Aplicarlo en `/maquinas/:id/inactividad`, `/reportes/inactividad` y `/reportes/tiempos`.

---

## 4. Orden de las suites en `test:todo`

### Problema

Las suites corren en orden alfabético, así que `crud` e `intervenciones` van antes que `migration_011`, que es la que aplica la migración. En una base sin la 011, `intervenciones` falla con *relation "v_intervencion_tiempos" does not exist*. En la rama de Neon pasó porque la 011 ya estaba aplicada de antes.

### Solución

`scripts/run-all-tests.mjs` corre primero los `migration_*.test.ts` (en orden de nombre) y después el resto (también en orden de nombre). El orden final queda impreso al principio del log, como ahora.

---

## 5. Pruebas nuevas

Se agregan en `backend/tests/tiempos.test.ts`, salvo M11-06.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| T-11 | Resolver ahora registrado **después** del fin: inicio 10:00, fin 10:20, las dos filas registradas a las 10:30 (con `fecha_efectiva` según 1.3.c) | bruta 20, neta 20 |
| T-12 | El caso de 1.1 armado por SQL: la primera fila `FINALIZADA` con `cambiado_en` = día 2 08:00 y `fecha_efectiva` = día 1 12:00 | bruta 1500, neta 240 |
| T-13 | **Por la API**, sobre una falla sin detención. La falla se crea por la API y por SQL se le pone `fecha_creacion` = hace 6 h; si no, la fecha de inicio quedaría antes de la creación y daría `FECHA_INCOHERENTE`. Después: iniciar con `fecha_inicio` = hace 5 h; finalizar con `fecha_finalizacion` = hace 4 h; reabrir; finalizar sin fecha | neta ≈ 60 y bruta ≈ 300, con tolerancia de 1 min. En el historial: la fila `EN_PROCESO` inicial tiene `fecha_efectiva` = hace 5 h y la primera `FINALIZADA`, hace 4 h; la fila de la reapertura tiene `fecha_efectiva` `NULL`. |
| M-10 | Período abierto con `desde` = `NOW()` + 1 min, insertado por SQL. Se usa 1 minuto para que la prueba no dependa de la velocidad de la base. | `/maquinas/:id/inactividad` y `/reportes/inactividad` responden 200; ese período suma 0 |
| R-05 | Usuario con `REPORTES_CONSULTAR` alcance `PROPIAS` (excepción `CONCEDER`), asignado solo al sector 1 | Ranking y `/reportes/tiempos` solo con datos del sector 1; una máquina del sector 2 en `/maquinas/:id/inactividad` → 404 |
| M11-06 | En `migration_011.test.ts`: una intervención finalizada con historial sin `fecha_efectiva`; correr la migración, y después otra vez | Después de la primera corrida, la primera `EN_PROCESO` tiene `fecha_inicio` y la última `FINALIZADA` tiene `fecha_finalizacion`; las demás filas siguen en `NULL`. La segunda corrida no cambia nada. |

T-01 a T-10, M-01 a M-09 y R-01 a R-03 tienen que seguir pasando sin cambios (salvo lo indicado en 1.4).

---

## 6. Documentación

En `docs/analisis-intervenciones.md`, sección 11:

- Reemplazar el texto de **D-44** por: "**Aprobada:** cada fila del historial guarda cuándo se registró el cambio (`cambiado_en`) y, cuando el usuario indica una fecha, cuándo ocurrió (`fecha_efectiva`). La neta suma los tramos en `EN_PROCESO` usando la fecha en que ocurrió cada cambio, o la de registro si no hay otra. Nunca supera a la bruta."
- Agregar **D-47** (sección 3).

---

## 7. Criterios de cierre

1. La 011 modificada está aplicada **solo** en la rama de pruebas y `migration_011` pasa, incluida M11-06.
2. Pasan T-01 a T-13, M-01 a M-10 y R-01 a R-05.
3. `npm run test:todo -- etapa-8.1` corre con las migraciones primero, todo en verde; el log queda en `docs/evidencia/etapa-8.1-pruebas.log`. El typecheck también pasa.
4. Documentación de la sección 6 actualizada.
5. Commit y push en `feat/base-neon`.

---

## 8. Informe a entregar

1. Archivos creados y modificados.
2. El log de evidencia (adjunto, no transcripto), el orden en que corrieron las suites y el resultado del typecheck.
3. Tests existentes modificados y motivo.
4. **Todos** los desvíos, incluidos los cambios no pedidos.
5. Dudas o decisiones abiertas.
