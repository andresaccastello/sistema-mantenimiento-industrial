# Etapa 8 — Tiempos de gestión e inactividad real de las máquinas

> **Estado:** requerimiento para implementar.
> **Requisito previo:** Etapa U.1 cerrada (commit `92cafd2` o posterior).
> **Base:** `docs/analisis-intervenciones.md`, secciones 7.1 y 7.2, decisiones D-06, D-07 y D-08.
> **Para qué:** es la base de los reportes de la tesis (4.8: "tiempo de inactividad por máquina", "intervenciones pendientes o en proceso") y de la planilla del Anexo A.1 (horas internas y externas).

---

## 0. Reglas de trabajo

Las mismas de las etapas anteriores:

1. Rama `feat/base-neon`; nada en `main`.
2. Migraciones y tests **solo** en la rama aislada de Neon.
3. Nada fuera del alcance de la sección 2. Ante ambigüedad o contradicción con el código, **detenerse y preguntar**.
4. SQL visible con `pg`, sin ORM; migraciones idempotentes; tests con `node:test` + `app.request(...)`.
5. Fechas con `NOW()` de PostgreSQL; las que llegan del cliente, con `validarFechaISO`.
6. **Los tiempos se calculan al consultar, en SQL.** No se agregan columnas con tiempos guardados (la única que existe, `tiempo_inactividad_minutos`, sigue como está: D-08).
7. Evidencia: correr `npm run test:todo` (sección 7.3) y commitear el log que genera. El informe adjunta ese archivo y **no copia salidas a mano**.
8. El informe (sección 9) describe **solo lo que está en el código** y declara todo desvío.

---

## 1. Paso previo: documentación

`docs/analisis-intervenciones.md`, sección 11: marcar **D-06** (opción B: bruta + neta) y **D-07** (excluir las horas de `FUERA_DE_SERVICIO`) como **Aprobadas**, y agregar:

| ID | Decisión | Resolución |
| :-: | :--- | :--- |
| D-44 | Cómo se mide la duración neta | **Aprobada:** suma de los tramos en `EN_PROCESO` según el historial. El primer tramo empieza en `fecha_inicio` (que puede haberse cargado hacia atrás) y el tramo que termina en `FINALIZADA` cierra en `fecha_finalizacion`; los demás bordes salen de `cambiado_en` del historial. Nunca supera a la bruta. |
| D-45 | Qué detenciones cuentan como inactividad | **Aprobada:** cuentan los períodos de intervenciones no eliminadas, incluidas las canceladas (la máquina estuvo parada de verdad). Las eliminadas lógicamente no cuentan (registro equivocado, D-34). Un período abierto cuenta hasta el momento de la consulta. |
| D-46 | Inactividad por tipo | **Aprobada:** además del total, se informa la inactividad de las detenciones `CORRECTIVO` y `PREVENTIVO` por separado, porque una parada planificada no es una falla. Si se solapan, el total es menor que la suma de los dos. |

Guardar este archivo como `docs/etapas/etapa-8-tiempos-inactividad.md`.

---

## 2. Alcance

### Incluido

- Migración `011_tiempos.sql`: una vista y una función SQL (sección 3).
- Tiempos de cada intervención en el detalle y en el listado (sección 4).
- Inactividad real de una máquina en un intervalo (sección 5.1).
- Ranking de inactividad por máquina y tiempos agrupados por ejecución o tipo (secciones 5.2 y 5.3), como base de los reportes.
- `test:todo` descubre todas las suites solas y nombra el log por etapa (sección 7.3).
- Dev-ui mínima (sección 6).

### Excluido

- Corrección de fechas de intervenciones finalizadas → Etapa 10 (postergada).
- Otros indicadores (MTBF, MTTR, costos, repuestos más usados) → etapa de reportes.
- Gráficos → frontend definitivo.
- Calendario laboral (horas hábiles, turnos): todas las duraciones son de reloj, 24 h por día. Queda anotado como posible mejora.

---

## 3. Migración `database/migrations/011_tiempos.sql`

Idempotente (`CREATE OR REPLACE`). Requiere PostgreSQL 14 o superior (rangos múltiples); el test de la migración verifica `server_version_num >= 140000`.

### 3.1 Vista `v_intervencion_tiempos`

Una fila por intervención, con minutos enteros (redondeados) y `NULL` cuando no corresponde:

| Columna | Cálculo |
| :--- | :--- |
| `intervencion_id` | |
| `espera_minutos` | `fecha_inicio − fecha_creacion`; si todavía no empezó (sin `fecha_inicio`) y no está cancelada: `NOW() − fecha_creacion`; si se canceló sin empezar: `NULL` |
| `espera_en_curso` | `TRUE` si la espera se sigue contando (pendiente sin empezar) |
| `duracion_bruta_minutos` | `fecha_finalizacion − fecha_inicio`; si empezó y está abierta (`EN_PROCESO` o `EN_ESPERA_REPUESTOS`): `NOW() − fecha_inicio`; si no empezó, o se canceló sin finalizar: `NULL` |
| `duracion_neta_minutos` | suma de tramos en `EN_PROCESO` (D-44); un tramo abierto cuenta hasta `NOW()` |
| `tiempo_total_minutos` | `fecha_finalizacion − fecha_creacion`; `NULL` si no está finalizada |
| `trabajo_en_curso` | `TRUE` si está en `EN_PROCESO` o `EN_ESPERA_REPUESTOS` |
| `inactividad_minutos` | suma de **todos** sus períodos de detención (los abiertos hasta `NOW()`); `0` si no tiene |
| `inactividad_en_curso` | `TRUE` si tiene un período abierto |

Cálculo de la neta: tomar las filas de `historial_estados_intervencion` de la intervención ordenadas por `cambiado_en, id`; cada fila con `estado_nuevo = 'EN_PROCESO'` abre un tramo y la siguiente fila lo cierra (`LEAD`). Aplicar los bordes de D-44 y luego `LEAST(neta, bruta)`.

### 3.2 Función `fn_inactividad_maquina(p_maquina_id, p_desde, p_hasta)`

Devuelve una fila con `total_minutos`, `correctivo_minutos`, `preventivo_minutos` y `fuera_de_servicio_minutos`, calculados así:

1. **Períodos:** los de la máquina, de intervenciones no eliminadas (D-45), como `tstzrange(desde, COALESCE(hasta, NOW()))`.
2. **Unión** con `range_agg` (sin contar dos veces los solapamientos, sección 7.2).
3. **Fuera de servicio (D-07):** los intervalos en que la máquina estuvo `FUERA_DE_SERVICIO`, armados desde `historial_estados_maquina` (cada fila con `estado_nuevo = 'FUERA_DE_SERVICIO'` abre un intervalo que cierra la fila siguiente de esa máquina, o `NOW()`), se **restan** de la unión.
4. **Recorte** al intervalo pedido: intersección con `tstzrange(p_desde, p_hasta)`.
5. Duración = suma de `upper − lower` de cada rango del resultado, en minutos redondeados.
6. `correctivo_minutos` y `preventivo_minutos`: lo mismo, filtrando por el tipo de la intervención. `fuera_de_servicio_minutos`: cuánto tiempo de detención se descontó por estar fuera de servicio, dentro del intervalo.

Es la consulta central de la etapa: dejarla comentada paso por paso, porque se va a mostrar en la tesis.

Test `backend/tests/migration_011.test.ts`: versión de PostgreSQL, la vista y la función existen, y la migración se puede correr dos veces.

---

## 4. Tiempos de cada intervención

- `GET /api/intervenciones/:id`: agregar un bloque `tiempos` con todas las columnas de la vista (sin `intervencion_id`).
- `GET /api/intervenciones`: agregar el mismo bloque a cada elemento (un `JOIN` a la vista, sin consultas por fila).
- `tiempo_inactividad_minutos` (columna guardada, solo períodos cerrados) se sigue devolviendo como hoy.
- Sin cambios de permisos: lo ve quien ve la intervención.

---

## 5. Inactividad y base de reportes

Parámetros comunes:

- `desde` y `hasta`: ISO con zona; por defecto, los últimos 30 días hasta ahora. `desde >= hasta`, o un intervalo de más de 366 días → `422 DATOS_INVALIDOS`.
- Permiso `REPORTES_CONSULTAR`. Con alcance `SECTORES`, solo máquinas de sus sectores (una máquina de otro sector → 404; en los listados, simplemente no aparece). Sin el permiso → 403.

### 5.1 `GET /api/maquinas/:id/inactividad?desde=&hasta=`

```json
{
  "maquina": { "id": 3, "nombre": "Torno CNC", "codigo": "MAQ-003", "sector": { "id": 1, "nombre": "..." } },
  "intervalo": { "desde": "...", "hasta": "..." },
  "inactividad_minutos": 360,
  "por_tipo": { "CORRECTIVO": 360, "PREVENTIVO": 0 },
  "fuera_de_servicio_descontado_minutos": 0,
  "periodos": [
    { "id": 10, "intervencion_id": 5, "tipo": "CORRECTIVO", "desde": "...", "hasta": "...", "abierto": false }
  ]
}
```

`periodos` = los que se superponen con el intervalo (sin recortar), para que se pueda ver de dónde sale el número.

### 5.2 `GET /api/reportes/inactividad?desde=&hasta=&sector_id=`

Una fila por máquina activa (respetando el alcance) con `maquina`, `inactividad_minutos`, `por_tipo` e `intervenciones_con_detencion` (cantidad). Orden: mayor inactividad primero; empates por nombre. Máquinas sin detenciones en el intervalo aparecen con 0. Es el reporte "tiempo de inactividad por máquina" de la tesis (4.8).

### 5.3 `GET /api/reportes/tiempos?desde=&hasta=&agrupar=ejecucion|tipo|sector`

Sobre las intervenciones **finalizadas** con `fecha_finalizacion` dentro del intervalo, una fila por grupo con:

- `cantidad`;
- `espera_promedio_minutos`, `duracion_bruta_promedio_minutos`, `duracion_neta_promedio_minutos`;
- `duracion_bruta_total_minutos`, `duracion_neta_total_minutos`.

`agrupar` es obligatorio; otro valor → 422. `ejecucion` reproduce la división interna/externa del Anexo A.1.

---

## 6. Dev-ui (mínimo, provisional)

- Detalle de intervención: bloque "Tiempos" (espera, bruta, neta, total, inactividad), marcando "en curso" cuando corresponda. Mostrar en horas y minutos (`2 h 15 min`).
- Máquinas: en cada máquina, inactividad de los últimos 30 días, con la lista de períodos.
- Pestaña "Reportes" (si tiene `REPORTES_CONSULTAR`): ranking de inactividad y tiempos por ejecución, con selector de fechas.

---

## 7. Pruebas de aceptación

Archivo `backend/tests/tiempos.test.ts`, script `test:tiempos`. Los horarios se arman por SQL en el setup (fechas de la intervención, filas de historial y períodos en el pasado), con resultados esperados escritos a mano. Las comparaciones contra `NOW()` admiten una tolerancia de 1 minuto.

### 7.1 Tiempos de una intervención

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| T-01 | Creada 08:00, inicio 09:00, fin 12:00, sin espera de repuestos | espera 60, bruta 180, neta 180, total 240. |
| T-02 | En proceso 09:00–10:00, en espera 10:00–11:30, en proceso 11:30–12:00, fin 12:00 | bruta 180, neta 90. |
| T-03 | Finalizada 12:00, reabierta 15:00, finalizada 17:00 (inicio 09:00) | bruta 480 (incluye el hueco), neta 300 (lo excluye). |
| T-04 | Pendiente creada hace 2 h | espera ≈ 120 con `espera_en_curso = true`; bruta, neta y total `NULL`. |
| T-05 | "Resolver ahora" con inicio 10:00 y fin 10:20 | bruta 20, neta 20. |
| T-06 | Iniciada con `fecha_inicio` cargada 1 h antes del registro del cambio | La neta empieza en `fecha_inicio`, no en `cambiado_en`. |
| T-07 | En proceso desde hace 30 min | bruta y neta ≈ 30, `trabajo_en_curso = true`. |
| T-08 | Cancelada sin empezar | espera `NULL`, bruta `NULL`, neta 0. |
| T-09 | Un período cerrado de 2 h y uno abierto desde hace 1 h | `inactividad_minutos` ≈ 180, `inactividad_en_curso = true`; la columna guardada `tiempo_inactividad_minutos` sigue en 120. |
| T-10 | El listado trae el bloque `tiempos` en cada elemento | Igual al del detalle para las mismas intervenciones. |

### 7.2 Inactividad de la máquina

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| M-01 | **Ejemplo 7.2 del análisis:** A 08:00–12:00, B 10:00–14:00 | 360 (no 480). |
| M-02 | Igual, pidiendo el intervalo 09:00–11:00 | 120 (recortado). |
| M-03 | Detención 08:00–14:00 con la máquina `FUERA_DE_SERVICIO` 10:00–12:00 | 240; `fuera_de_servicio_descontado_minutos` 120. |
| M-04 | Un período de una intervención eliminada y otro de una cancelada | El de la eliminada no cuenta; el de la cancelada sí. |
| M-05 | Un período abierto desde hace 2 h; con `hasta` = hace 1 h | ≈ 120; 60 (corta en `hasta`). |
| M-06 | Correctiva 08:00–12:00 y preventiva 10:00–13:00 (tipo cambiado por SQL) | total 300, `CORRECTIVO` 240, `PREVENTIVO` 180. |
| M-07 | Máquina sin detenciones | 0 y `periodos` vacío. |
| M-08 | Sin `REPORTES_CONSULTAR`; con alcance `SECTORES` sobre una máquina de otro sector | 403; 404. |
| M-09 | La función SQL contra un cálculo hecho a mano en el test (fusión de intervalos ordenados en TypeScript) para 6 períodos solapados de forma variada | Mismo resultado. |

### 7.3 Reportes, validaciones y regresión

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| R-01 | `/reportes/inactividad` con tres máquinas (360, 0 y 90 minutos) y filtro de sector | Orden 360, 90, 0; el filtro deja solo las del sector; con alcance `SECTORES`, solo las suyas. |
| R-02 | `/reportes/tiempos?agrupar=ejecucion` con 2 internas (bruta 60 y 120) y 1 externa (bruta 300) | INTERNA: cantidad 2, bruta promedio 90, total 180; EXTERNA: 1, 300, 300. |
| R-03 | Fechas inválidas o sin zona; `desde >= hasta`; intervalo de 400 días; `agrupar` inválido | 422 `DATOS_INVALIDOS` en todos. |
| R-04 | Regresión: `npm run test:todo` + typecheck | Todo verde; el log queda en `docs/evidencia/etapa-8-pruebas.log`. |

### 7.4 Cambio en `test:todo`

`scripts/run-all-tests.mjs` hoy tiene la lista de suites escrita a mano y el nombre del log fijo. Cambiarlo para que:

- **descubra solo** todos los `backend/tests/*.test.ts` (ordenados por nombre), así ninguna suite nueva queda afuera;
- reciba el nombre de la etapa como argumento (`npm run test:todo -- etapa-8`) y escriba `docs/evidencia/<etapa>-pruebas.log`; sin argumento, `docs/evidencia/ultima-corrida.log`.

---

## 8. Criterios de cierre

1. Migración 011 aplicada **solo** en la rama de pruebas y su test pasa.
2. T-01 a T-10, M-01 a M-09 y R-01 a R-04 pasan.
3. Documentación de la sección 1 actualizada.
4. `docs/evidencia/etapa-8-pruebas.log` commiteado.
5. Commit y push en `feat/base-neon`.

---

## 9. Informe a entregar

1. Archivos creados y modificados.
2. El log de evidencia (adjunto, no transcripto) y el resultado del typecheck.
3. Tests anteriores modificados y motivo.
4. **Todos** los desvíos, incluidos cambios no pedidos.
5. Dudas o decisiones abiertas.
