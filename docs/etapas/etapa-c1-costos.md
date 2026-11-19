# Etapa C1 — Costos de la intervención

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `4f79db7` (Etapa R1.2).
> **Base:**
>
> - `docs/analisis-intervenciones.md`: RN-40 a RN-49, sección 7.3 y la tabla N4;
> - `docs/relevamiento-requisitos-derivados.md`: requisito 4 (mano de obra por persona) y requisito 1 (proveedor de un trabajo externo);
> - la tabla `intervencion_costos`, que existe desde la migración 001 y no tiene filas;
> - `backend/functions/intervenciones/costos.ts`, de la R1.
>
> **Para qué:**
>
> - que el costo total de una intervención sume los repuestos y todo lo que se carga a mano: mano de obra, servicios externos, transporte, otros y ajustes;
> - saber quién trabajó, cuántas horas, si fue personal interno o externo, y cuánto costó;
> - nunca pisar un importe: cada cosa es un renglón, que se anula y no se edita.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Tres commits, en este orden:**

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 2 y 3 | `feat(db): renglones de costo con mano de obra por persona` |
   | 2 | 4 a 7 | `feat(api): costos de la intervención y reporte de costos` |
   | 3 | 8 a 10 | `feat(front): costos en la intervención y en reportes` |

3. **Pruebas:**
   - solo estas: `test:migration-017` y `test:costos`, nuevas; `test:repuestos-intervenciones`, porque cambia `recalcularCostosIntervencion`; y `test:front`;
   - **no correr `test:todo`:** va en la corrida de la noche;
   - una prueba no borra ni modifica datos que no creó;
   - **pruebas existentes:** solo se puede ampliar FE-41 (sección 8.6). Ninguna del backend.
4. **Frontend:**
   - la lógica pura va en `lib/`;
   - las partes nuevas van en `componentes/costos/`;
   - `DetalleIntervencion.tsx` solo suma el bloque nuevo y su import.
5. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-c1-costos.md`.

---

## 1. Qué se resuelve

| Regla | Cómo |
| :--- | :--- |
| RN-40 y RN-43: el total se calcula solo | `recalcularCostosIntervencion` suma repuestos y renglones (sección 4.4). |
| RN-44 y RN-48: nada se pisa | Cada concepto manual es un renglón. No se edita: se anula con motivo y se carga otro. |
| RN-45 y requisito 4: la mano de obra por persona | Un renglón `MANO_OBRA` por persona, con horas, interna (un usuario) o externa (un proveedor). |
| RN-40: calcular cuando se puede | Si se carga el valor hora, el importe es horas × valor hora, calculado por la API. Si no, se carga el importe total; por ejemplo, la factura de un externo. |
| RN-46 | Los repuestos no son renglones: salen de la R1. |
| RN-47 | Un renglón no es negativo, salvo `AJUSTE`. **El total nunca queda negativo.** |
| 7.3 | Con la intervención `FINALIZADA`, agregar o anular pide además `INTERVENCIONES_CORREGIR` y motivo. |
| Requisito 1 | El servicio externo, el transporte o la mano de obra externa pueden indicar el proveedor. |

---

## 2. Migración 017 (primer commit)

Archivo `database/migrations/017_costos_renglones.sql`. Se puede aplicar varias veces y no deshace cambios posteriores.

### 2.1 `intervencion_costos`: columnas nuevas

| Columna | Tipo |
| :--- | :--- |
| `usuario_id` | FK a `usuarios`, nulo: la persona interna de un renglón `MANO_OBRA`. |
| `proveedor_id` | FK a `proveedores`, nulo: el externo. |
| `horas` | `numeric(8,2)` nulo |
| `valor_hora` | `numeric(14,2)` nulo |

**Restricciones nuevas:**

1. `horas` solo en `MANO_OBRA`, y mayor que 0.
2. Un `MANO_OBRA` tiene `horas`, y **exactamente uno** de `usuario_id` o `proveedor_id` (`num_nonnulls(...) = 1`).
3. `usuario_id` solo en `MANO_OBRA`.
4. `valor_hora` solo con `horas`, mayor o igual a 0, y entonces `importe = round(horas * valor_hora, 2)`.
5. `AJUSTE`: `importe <> 0` y `motivo` no nulo.

**Índices:** parciales, por `usuario_id` y por `proveedor_id`, donde no son nulos.

### 2.2 Costos cargados antes

Hasta ahora nada escribía `costo_mano_obra`, y `costo_total_estimado` solo lo escribía la R1. Antes de que el total se calcule solo, hay que asegurarse de no pisar un importe viejo (RN-44).

Al final de la migración, un bloque `DO`:

- **busca las intervenciones sin renglones** con `costo_mano_obra <> 0`, o con `costo_total_estimado <> costo_repuestos + costo_mano_obra`;
- **si hay alguna, la migración falla** con un mensaje que nombra hasta 20 ids: "Hay intervenciones con costos cargados a mano: … Revisarlas antes de migrar.";
- **no corrige nada:** eso se decide a mano.

En mi base local no hay ninguna. Si en la rama de pruebas aparece alguna, **frenar y avisar**.

### 2.3 Pruebas: `backend/tests/migration_017.test.ts`

Script `test:migration-017`. Las restricciones se prueban dentro de una transacción con `ROLLBACK`, como en la 016.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| M17-01 | Aplicar | Dos veces seguidas, sin error. |
| M17-02 | Estructura | Las cuatro columnas nuevas existen. |
| M17-03 | Restricciones | Se rechazan:<br>• `MANO_OBRA` sin horas;<br>• `MANO_OBRA` con usuario y proveedor, o sin ninguno;<br>• horas en `TRANSPORTE`;<br>• `usuario_id` en `OTRO`;<br>• `valor_hora` sin horas;<br>• `valor_hora` con un importe distinto de horas × valor hora;<br>• `AJUSTE` con importe 0, o sin motivo.<br>Se aceptan:<br>• `MANO_OBRA` de 2,5 h × 1200 con importe 3000;<br>• `MANO_OBRA` externa de 4 h sin valor hora, con importe 20000;<br>• `AJUSTE` de −1000 con motivo. |
| M17-04 | Costos cargados antes | Con `ROLLBACK`: una intervención de la prueba con `costo_mano_obra` 100 y sin renglones. Reaplicar falla, y el mensaje incluye su id. |

---

## 3. Reglas: D-019 (primer commit)

Agregar a `docs/decisiones.md`:

> ## D-019 — Costos de la intervención
>
> **Estado:** Aceptada
>
> 1. **El total sale solo:** repuestos usados (D-018) más los renglones no anulados. `costo_mano_obra` es la suma de los renglones `MANO_OBRA`. Ningún importe se escribe a mano en la intervención.
> 2. **Renglones** de mano de obra, servicio externo, transporte, otro y ajuste. No se editan: se anulan con motivo y se carga otro.
> 3. **Mano de obra:** un renglón por persona, con horas, interna (un usuario) o externa (un proveedor). Con valor hora, el importe es horas × valor hora, redondeado a centavos. Sin valor hora, se carga el importe total.
> 4. **Solo el ajuste puede ser negativo, y el total nunca:** una operación que lo dejaría negativo se rechaza, aunque sea anular un repuesto.
> 5. **Quién puede:**
>    - carga y anula quien tiene `COSTOS_REGISTRAR`, en `EN_PROCESO` y `EN_ESPERA_REPUESTOS`;
>    - con la intervención `FINALIZADA`, además `INTERVENCIONES_CORREGIR` y motivo;
>    - con la intervención `CANCELADA`, solo se anula, con `INTERVENCIONES_CORREGIR`.
> 6. **Importes visibles:** con `COSTOS_VER`. Las horas de mano de obra las ve cualquiera que ve la intervención.
> 7. **Valor hora:** no se guarda por persona. Se carga en cada renglón y queda como histórico. Una tarifa por persona es una mejora futura.
> 8. **Reporte de costos:** gasto registrado en el período, por la fecha de cada consumo y de cada renglón, no anulado, de las máquinas visibles de la selección, activas o no. Es el mismo criterio que D-018, punto 9.

---

## 4. API de costos de la intervención (segundo commit)

Las rutas van en `backend/functions/intervencionCostos.ts`: un `Hono` sin middleware propio, montado con una línea al final de `intervenciones.ts`, igual que el de repuestos. Los ids y los booleanos se validan con las funciones de `repuestos/validaciones.ts`.

### 4.1 Quién puede

| Estado | Registrar | Anular |
| :--- | :--- | :--- |
| `PENDIENTE` | No: 409 `ESTADO_NO_PERMITE_COSTOS` | No hay renglones que anular |
| `EN_PROCESO`, `EN_ESPERA_REPUESTOS` | `COSTOS_REGISTRAR` | `COSTOS_REGISTRAR` |
| `FINALIZADA` | `COSTOS_REGISTRAR`, `INTERVENCIONES_CORREGIR` y `motivo` | `COSTOS_REGISTRAR` e `INTERVENCIONES_CORREGIR` |
| `CANCELADA` | No: 409 `ESTADO_NO_PERMITE_COSTOS` | `COSTOS_REGISTRAR` e `INTERVENCIONES_CORREGIR` |

- Falta un permiso: 403 `PERMISO_INSUFICIENTE`.
- Una intervención eliminada, o que el usuario no ve: 404 `INTERVENCION_NO_ENCONTRADA`.
- No hay regla de actor: cargar costos es una tarea administrativa, no del responsable.

La tabla vive en una sola función, `permisosCostos(usuario, intervencion)`. La usan el `GET`, el `POST` y la anulación.

### 4.2 `GET /api/intervenciones/:id/costos`

Permiso `INTERVENCIONES_VER`. **No bloquea filas**, como el `GET` de repuestos.

```text
{
  renglones: [{
    id, tipo, descripcion,
    importe, valor_hora,                       // null sin COSTOS_VER
    horas,                                     // null si no es MANO_OBRA
    persona: { id, nombre, apellido } | null,
    proveedor: { id, nombre } | null,
    motivo, registrado_por, registrado_en,
    anulado, anulado_por, anulado_en, motivo_anulacion
  }],
  resumen: {                                   // null sin COSTOS_VER
    repuestos, mano_obra, servicio_externo, transporte, otro, ajuste, total
  },
  horas_mano_obra,                             // suma de horas de los MANO_OBRA no anulados
  ve_costos, puede_registrar, puede_anular
}
```

- `registrado_por` y `anulado_por` son `{ id, nombre, apellido }` o `null`.
- Los renglones van del más viejo al más nuevo, con los anulados.
- En el resumen:
  - `repuestos` es `costo_repuestos`;
  - `total` es `costo_total_estimado`;
  - el resto, la suma por tipo de los no anulados.

### 4.3 `POST /api/intervenciones/:id/costos`

| Campo | Regla |
| :--- | :--- |
| `tipo` | `MANO_OBRA`, `SERVICIO_EXTERNO`, `TRANSPORTE`, `OTRO` o `AJUSTE`. |
| `descripcion` | De 3 a 200, recortada. En `MANO_OBRA` es opcional: vacía se guarda como "Mano de obra". |
| `usuario_id` | Solo `MANO_OBRA`. Usuario activo; si no, 422 `PERSONA_INVALIDA`. |
| `proveedor_id` | Opcional, salvo en `AJUSTE`, donde no va. Proveedor activo, leído con `FOR SHARE`; si no, 422 `PROVEEDOR_INVALIDO`. |
| | En `MANO_OBRA` va **exactamente uno** de `usuario_id` o `proveedor_id`. |
| `horas` | Obligatorias en `MANO_OBRA`, y solo ahí. Mayores que 0, hasta 2 decimales, hasta 1000. |
| `valor_hora` | Opcional, solo en `MANO_OBRA`. Desde 0, hasta 2 decimales, hasta 10.000.000. **Si viene, la API calcula `importe = ROUND(horas * valor_hora, 2)` en SQL**, y mandar también `importe` da 422. |
| `importe` | Obligatorio si no hay `valor_hora`. Hasta 2 decimales, y en valor absoluto hasta 1.000.000.000. Mayor o igual a 0, salvo `AJUSTE`, que puede ser negativo pero no 0. |
| `motivo` | En `AJUSTE`, obligatorio. Con la intervención `FINALIZADA`, obligatorio para cualquier tipo. En los dos casos, al menos 5 caracteres; si no, 422 `MOTIVO_REQUERIDO`. En los demás casos es opcional, hasta 500. |

Un dato inválido da 422 `DATOS_INVALIDOS`, salvo que se indique otro código.

**Efectos, en una transacción con `bloquearIntervencion`:**

1. Inserta el renglón.
2. `recalcularCostosIntervencion` (sección 4.4).
3. Si está `FINALIZADA`: auditoría `CORRECCION_COSTO`, campo `costos`, `valor_nuevo` "Se agregó: <tipo legible> — <descripción>" y el motivo. **Sin importes.**

Responde 201 con el renglón, en el formato del `GET`.

### 4.4 `recalcularCostosIntervencion`, ampliada

En `backend/functions/intervenciones/costos.ts`:

- `costo_repuestos`: como en la R1;
- `costo_mano_obra` = suma de los `MANO_OBRA` no anulados;
- `costo_total_estimado` = `costo_repuestos` + suma de todos los renglones no anulados;
- **si el total daría negativo:** 409 `TOTAL_NEGATIVO`, con `total_resultante`, **antes** de escribir nada. La transacción se revierte entera.

Como la usan también los consumos, anular un consumo que dejaría el total negativo da el mismo 409, y el stock no cambia.

### 4.5 `POST /api/intervenciones/:id/costos/:renglonId/anular`

Con `{ motivo }`, de al menos 5 caracteres; si no, 422 `MOTIVO_REQUERIDO`.

**Errores:**

- renglón de otra intervención o inexistente: 404 `RENGLON_NO_ENCONTRADO`;
- ya anulado: 409 `RENGLON_YA_ANULADO`. El renglón se bloquea con `FOR UPDATE` antes de mirarlo.

**Efectos:**

1. Completa los tres datos de anulación.
2. `recalcularCostosIntervencion`, que puede dar `TOTAL_NEGATIVO`.
3. Si está `FINALIZADA` o `CANCELADA`: auditoría "Se anuló: <tipo legible> — <descripción>".

Responde 200 con el renglón.

### 4.6 `GET /api/costos/personas`

En `backend/functions/costos.ts`, montado en `api.ts` con `jwtVerify` y `dbVerify`.

- **Permiso:** `COSTOS_REGISTRAR`.
- **Respuesta:** los usuarios activos, por apellido y nombre, con `id`, `nombre`, `apellido` y `legajo`.

Y `GET /api/proveedores/opciones` pasa a aceptar también `COSTOS_REGISTRAR`.

---

## 5. Reporte: `GET /api/reportes/costos` (segundo commit)

En `reportes.ts`.

- **Permiso:** `REPORTES_CONSULTAR` y además `COSTOS_VER`. Sin `COSTOS_VER`: 403 `PERMISO_INSUFICIENTE`.
- **Alcance, período y filtros:** igual que `/repuestos`.
- **Qué cuenta (D-019, punto 8):**
  - consumos no anulados, por `creado_en`;
  - renglones no anulados, por `registrado_en`;
  - siempre de intervenciones no eliminadas y de máquinas visibles de la selección, activas o no.

```text
{
  desde, hasta, total, intervenciones,
  por_tipo: { repuestos, mano_obra, servicio_externo, transporte, otro, ajuste },
  por_maquina: [{ maquina: { id, codigo, nombre }, sector: { id, nombre },
                  repuestos, mano_obra, otros, total }],
  horas_por_persona: [{ persona: { id, nombre, apellido } | null,
                        proveedor: { id, nombre } | null,
                        horas, importe }]
}
```

- `intervenciones`: cuántas tuvieron algún gasto en el período.
- `otros`: servicio externo, transporte, otro y ajuste.
- **Orden:**
  - `por_maquina`, por total de mayor a menor, y después por nombre;
  - `horas_por_persona`, por horas de mayor a menor.

---

## 6. Pruebas de la API (segundo commit)

### 6.1 `backend/tests/costos.test.ts`

Script `test:costos`.

**Escenario:** como en `repuestos_intervenciones.test.ts`: dos plantas con un sector y una máquina cada una. Las intervenciones se crean y se mueven por la API.

**Usuarios:**

| Nombre | Cómo se arma |
| :--- | :--- |
| R | Perfil `RESPONSABLE_MANTENIMIENTO`: `COSTOS_REGISTRAR` y `COSTOS_VER`, sin `INTERVENCIONES_CORREGIR`. |
| A | Perfil `ADMINISTRADOR`. |
| T | Como R, con `DENEGAR` de `COSTOS_VER` y `COSTOS_REGISTRAR`. |
| O | Perfil `OPERARIO`, que crea las intervenciones. |
| O2 | Perfil `OPERARIO`, que no ve ninguna. |
| X | Perfil `OPERARIO`, con `CONCEDER` de `REPORTES_CONSULTAR` en alcance `SECTORES` (solo el sector 2) y de `COSTOS_VER`. |
| P | Un usuario activo, que es la persona de la mano de obra. Otro inactivo, para los errores. |

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| CO-01 | Estados | • `PENDIENTE`: 409 `ESTADO_NO_PERMITE_COSTOS`.<br>• `EN_PROCESO` y `EN_ESPERA_REPUESTOS`: 201.<br>• `CANCELADA`: 409.<br>• Eliminada: 404. |
| CO-02 | Mano de obra interna con valor hora | P, 2,5 h × 1200: `importe` 3000, calculado por la API. `costo_mano_obra` 3000, y el total es `costo_repuestos` + 3000. |
| CO-03 | Mano de obra externa | Un proveedor, 4 h, `importe` 20000, sin valor hora: 201, con `valor_hora` en `null`. |
| CO-04 | Validaciones de mano de obra | 422 en todos estos casos:<br>• sin horas;<br>• con usuario y proveedor, o sin ninguno;<br>• con `valor_hora` e `importe`;<br>• horas 0, o con 3 decimales;<br>• un usuario inactivo: `PERSONA_INVALIDA`;<br>• horas en `TRANSPORTE`;<br>• `usuario_id` en `OTRO`;<br>• `usuario_id: true`. |
| CO-05 | Otros tipos | • `SERVICIO_EXTERNO` con proveedor, `TRANSPORTE` y `OTRO`: 201.<br>• Importe negativo en esos tipos: 422.<br>• `AJUSTE` de −1000 con motivo: 201.<br>• `AJUSTE` sin motivo: 422 `MOTIVO_REQUERIDO`.<br>• `AJUSTE` de 0: 422. |
| CO-06 | El total nunca es negativo | Con un total de 1500:<br>• `AJUSTE` de −2000: 409 `TOTAL_NEGATIVO`, con `total_resultante` −500, y no se guarda nada.<br>• `AJUSTE` de −1000: 201.<br>• Anular el renglón de 1500: 409.<br>• En otra intervención, con un consumo de repuestos de 1000 y un `AJUSTE` de −800, anular el consumo: 409 `TOTAL_NEGATIVO`, y el stock no cambia. |
| CO-07 | Anular | • Sin motivo: 422.<br>• Con motivo: 200, y el total se recalcula.<br>• Otra vez: 409 `RENGLON_YA_ANULADO`.<br>• Un renglón de otra intervención: 404 `RENGLON_NO_ENCONTRADO`. |
| CO-08 | `FINALIZADA` | • R: 403.<br>• A sin motivo: 422.<br>• A con motivo: 201, y una auditoría `CORRECCION_COSTO` con campo `costos`, "Se agregó: Mano de obra — …" y el motivo. **Sin el importe ni el valor hora** en ningún texto.<br>• A anula: 200, y otra auditoría con "Se anuló". |
| CO-09 | `CANCELADA` | R anula: 403. A anula con motivo: 200. |
| CO-10 | Permisos y visibilidad | • O: `POST` 403. En el `GET`, `importe` y `valor_hora` en `null`, `resumen` en `null`, y `horas` y `horas_mano_obra` con su valor.<br>• O2: 404.<br>• `puede_registrar` y `puede_anular` coinciden con lo que responden el `POST` y la anulación, para R, A y O, en `EN_PROCESO` y en `FINALIZADA`. |
| CO-11 | Repuestos y renglones juntos | Consumo de 2 × 100, mano de obra de 3000, transporte de 500 y `AJUSTE` de −200. Resumen: repuestos 200, mano de obra 3000, transporte 500, ajuste −200 y total 3500, igual a `costo_total_estimado`. |
| CO-12 | Concurrencia | • Dos anulaciones a la vez del mismo renglón: una 200 y otra 409.<br>• Con un total de 1000, dos `AJUSTE` de −600 a la vez: uno 201 y otro 409 `TOTAL_NEGATIVO`; el total queda en 400. |
| CO-13 | Personas | • R: 200, solo usuarios activos.<br>• T y O: 403.<br>• `GET /api/proveedores/opciones` con solo `COSTOS_REGISTRAR`: 200. |
| CO-14 | Reporte | En un período fijo en el pasado, corriendo las fechas por SQL:<br>• M1: un consumo de 200, mano de obra de P de 2 h por 3000, y transporte de 500;<br>• M2: mano de obra externa de 4 h por 20000;<br>• además, un renglón anulado y otro fuera del período, que no cuentan.<br>Resultados:<br>• `total` 23700, `intervenciones` 2;<br>• `por_tipo` exacto;<br>• `por_maquina`: M2 con 20000 primero, y M1 con repuestos 200, mano de obra 3000, otros 500 y total 3700;<br>• `horas_por_persona`: el proveedor con 4 h y P con 2 h;<br>• con `planta_id` y con `sector_id`, solo lo de cada uno;<br>• X: solo M2;<br>• T: 403;<br>• `desde` posterior a `hasta`: 422. |
| CO-15 | Contrato | Sección 7. |

---

## 7. Contrato en las dos puntas (segundo commit)

En la R1, el frontend leía campos que la API no mandaba, y nadie lo vio hasta la revisión. La R1.1 lo resolvió con respuestas que yo capturé. Esta vez la API es nueva, así que el contrato se prueba de los dos lados:

1. **`frontend/src/api/contrato-costos.ts`** exporta un ejemplo de cada respuesta, como constante con su tipo de `api/tipos.ts`:
   - `GET /api/intervenciones/:id/costos`, con un renglón de cada tipo;
   - `POST` de un renglón;
   - `GET /api/costos/personas`;
   - `GET /api/reportes/costos`.

   **Sin `null` donde la API manda un valor**, para que el tipo quede probado. Sin `as` ni `any`.
2. **Del lado del frontend,** el typecheck controla que los ejemplos respeten los tipos, y FE-62 (sección 9) los usa.
3. **Del lado del backend, CO-15** llama a esas cuatro rutas con datos reales, como A, y compara cada respuesta con su ejemplo usando una función nueva, `mismaForma(real, ejemplo)`, en `backend/tests/contrato.ts`:
   - las mismas claves en cada nivel;
   - en los arreglos, el primer elemento;
   - el mismo `typeof` en cada hoja, salvo que uno de los dos sea `null`;
   - si falla, la lista de rutas con diferencias, por ejemplo `renglones[0].persona.legajo: falta en la API`.

`contrato-costos.ts` solo puede importar tipos. Si el typecheck del backend se queja por importarlo, frenar y preguntar.

---

## 8. Frontend (tercer commit)

### 8.1 `CampoNumero` pasa a ser común

Mover `componentes/repuestos/CampoNumero.tsx` a `componentes/CampoNumero.tsx` y actualizar los imports.

**Verificación:** `grep -rn "NumberInput" frontend/src/componentes/` solo encuentra `CampoNumero.tsx`.

### 8.2 `lib/costos.ts`

| Función | Qué hace |
| :--- | :--- |
| `etiquetaTipoCosto(tipo)` | "Mano de obra", "Servicio externo", "Transporte", "Otro" o "Ajuste". Un valor desconocido sale tal cual. |
| `formatHoras(valor)` | 2.5 → "2,5 h"; 1 → "1 h"; `null` → "—". |
| `importeManoObra(horas, valorHora)` | Lo mismo que calcula la API, redondeado igual que `ROUND` de SQL, sin errores de coma flotante. Usa enteros: centésimos de hora por centavos.<br>• 2,5 × 1200 = 3000;<br>• 0,5 × 2,01 = 1,01;<br>• 1,5 × 0,03 = 0,05. |
| `validarHoras(valor)` | • vacío: "Ingresá las horas.";<br>• 0 o menos: "Tienen que ser más que cero.";<br>• más de dos decimales: "Hasta dos decimales.";<br>• más de 1000: "Hasta 1.000 horas.". |
| `validarImporteCosto(tipo, valor)` | • vacío: "Ingresá un importe.";<br>• negativo, si no es `AJUSTE`: "No puede ser negativo.";<br>• `AJUSTE` en 0: "El ajuste no puede ser cero.";<br>• más de dos decimales: "Hasta dos decimales.". |
| `cuerpoCosto(campos)` | Devuelve `CuerpoCosto`, exacto según el tipo:<br>• manda `valor_hora` o `importe`, nunca los dos;<br>• manda `usuario_id` o `proveedor_id`;<br>• sin campos que no van en ese tipo. |
| `filasResumenCostos(resumen)` | Las filas del resumen en este orden: Repuestos, Mano de obra, Servicio externo, Transporte, Otro y Ajuste. Solo las que no son 0, salvo Repuestos, que va siempre. Al final, siempre, el Total. |

### 8.3 R3: bloque "Costos"

`componentes/costos/BloqueCostosIntervencion.tsx`, en la columna principal, después de "Pedidos de repuestos". **Solo se muestra con `ve_costos`.**

**Arriba:**

- el resumen, con `filasResumenCostos`;
- "Mano de obra: N h", si hay horas.

**Renglones:**

- columnas: Tipo, Detalle (la descripción y debajo la persona o el proveedor), Horas, Importe y Registró;
- un menú ⋮ con "Anular" en cada renglón vigente, si `puede_anular`, con `aria-label` "Acciones del renglón";
- los anulados, atenuados y tachados, con "Anulado por X el …: motivo";
- el dinero, sin corte de línea.

**Debajo:** el botón "Agregar costo", si `puede_registrar`.

**Sin renglones:** "Todavía no se cargaron costos además de los repuestos."

### 8.4 Diálogos

**`ModalCosto`:**

- el tipo, con un `SegmentedControl`;
- los campos según el tipo:

  | Tipo | Campos |
  | :--- | :--- |
  | Mano de obra | • "Quién trabajó": Interna o Externa.<br>• Interna: la persona, de `/api/costos/personas`. Externa: el proveedor, de `/api/proveedores/opciones`.<br>• Horas.<br>• "Valor hora", opcional. Si se carga, debajo "Importe: $ …", con `importeManoObra`. Si no, "Importe total", obligatorio.<br>• Descripción, opcional. |
  | Servicio externo, Transporte y Otro | Descripción, Proveedor (opcional) e Importe. |
  | Ajuste | Descripción, Importe (puede ser negativo) y Motivo, obligatorio. |

- con la intervención `FINALIZADA`: "Motivo de la corrección", obligatorio;
- todos los números, con `CampoNumero`; se valida con las funciones de 8.2, y el error va en su campo;
- `TOTAL_NEGATIVO`, en el campo Importe: "El total de la intervención quedaría en $ −500,00.".

**`ModalAnularCosto`:** el motivo. `TOTAL_NEGATIVO` se muestra en el diálogo.

**`ModalAnularConsumo`**, de la R1, también muestra `TOTAL_NEGATIVO`.

**Al terminar, invalidar:** los costos y los repuestos de la intervención, y el detalle de la intervención, por el historial.

### 8.5 Historial de R3

En `eventosHistorial`, `CORRECCION_COSTO` con campo `costos` sale como:

- **título:** "Corrección de costos";
- **detalle:** el `valor_nuevo`, y después "Motivo: …".

### 8.6 D1: pestaña "Costos"

`componentes/reportes/TabReporteCostos.tsx`. Va quinta, después de Repuestos.

- **Solo se muestra con `COSTOS_VER`.** Sin ese permiso, `vista=costos` vuelve a Indicadores.
- **FE-41 se amplía:** `vista=costos` es válida.

**Contenido:**

- **Tarjetas:** Total, Repuestos, Mano de obra y Otros.
- **"Por máquina":**
  - columnas: Máquina (enlace), Sector, Repuestos, Mano de obra, Otros y Total;
  - CSV, con `filasReporteCostos` en `lib/reportes.ts`.
- **"Horas por persona":** Persona o proveedor, Horas e Importe.

**Sin datos:** "No hay costos registrados para este período y estos filtros."

---

## 9. Pruebas del frontend (tercer commit)

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| FE-41 (ampliada) | `leerFiltrosReportes` | `vista=costos` se conserva. |
| FE-58 | `etiquetaTipoCosto` y `formatHoras` | Los cinco tipos, uno desconocido, y los ejemplos de 8.2. |
| FE-59 | `importeManoObra` | Los tres ejemplos de 8.2, más 1000 × 9.999.999,99. |
| FE-60 | `validarHoras` y `validarImporteCosto` | Cada mensaje, y `null` con valores válidos, incluido un ajuste negativo. |
| FE-61 | `cuerpoCosto` | Los cinco tipos, interna y externa, y con y sin valor hora: cuerpos exactos. |
| FE-62 | Contrato en uso | Con los ejemplos de `contrato-costos.ts`:<br>• `filasResumenCostos` da las filas esperadas;<br>• `filasReporteCostos` da la fila de cada máquina;<br>• `eventosHistorial` con una auditoría de costos da "Corrección de costos". |

---

## 10. Documentación (tercer commit, salvo donde se indica)

1. **`docs/decisiones.md`:** D-019, en el primer commit.
2. **`docs/modelo-datos.md`:** las columnas nuevas de `intervencion_costos`, también en el primer commit.
3. **`docs/front/mapa-pantallas.md`:** en R3, el bloque Costos; en D1, la pestaña Costos.
4. **`docs/plan-trabajo.md`:** tildar lo de costos, si está.

---

## 11. Fuera de alcance

- **Valor hora guardado por persona:** D-019, punto 7.
- **Costos en el detalle de máquina:** `DetalleMaquina.tsx` tiene 1044 líneas. Va en la limpieza técnica.
- **Aprobación de gastos:** D-19 del análisis.
- **Migrar la base principal.**

---

## 12. Cierre e informe

**Criterios de cierre:**

1. Las secciones 2 a 10 están hechas, en tres commits.
2. En verde, en Neon: `test:migration-017`, `test:costos` y `test:repuestos-intervenciones`.
3. `npm run test:front`, `npm run typecheck` y `npm run build:frontend` sin errores.
4. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. Los tres hashes.
2. La salida final de las suites del punto 2 y de `test:front`.
3. Typecheck y build.
4. `grep -rn "NumberInput" frontend/src/componentes/`.
5. `wc -l` de los archivos nuevos y de `DetalleIntervencion.tsx`.
6. **Qué probaste en pantalla y qué no.** Si no levantaste la app, decirlo.
7. Desvíos y dudas.
