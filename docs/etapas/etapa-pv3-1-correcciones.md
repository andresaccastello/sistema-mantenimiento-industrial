# Etapa PV3.1 — Correcciones de la PV3

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `61dd969` (Etapa PV3).
> **Origen:** revisión de la PV3 (10/11) y dos dudas del informe.

**La PV3 está bien.** En la revisión pasaron:
- `test:todo` local, 489/489, y la huella;
- los ataques a la API;
- la concurrencia.

Quedan cuatro detalles.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Un commit:** `fix: correcciones de la PV3`.
3. **Pruebas:**
   - solo `test:migration-018`, `test:preventivos` y `test:medidores`;
   - **no correr `test:todo`.**
4. **Pruebas existentes: se autoriza cambiar solo:**
   - M18-07, para el perfil `I_D` (1);
   - lo que dice la 3 en PV-09, PV-21, PV-30 y ME-05.
5. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-pv3-1-correcciones.md`.

---

## 1. El permiso para `I_D`

**La duda del informe tiene razón:** `I_D` tiene que tener `MAQUINAS_REGISTRAR_LECTURAS`. La `009` le copia los permisos de `RESPONSABLE_MANTENIMIENTO` cuando se aplica, pero en la base principal la `009` corre antes que la `018`.

- **En la `018`,** el permiso se asigna también a `I_D`, junto a los otros tres perfiles.
- **M18-07** lo controla en los cuatro.

---

## 2. La vista con volumen

**Qué pasa:** con 400 planes y 2000 tareas, la vista nueva cuesta unos 113.000 y pasa el umbral de JIT de PostgreSQL (`jit_above_cost`, 100.000). La de la PV2.2 costaba 73.000. Una consulta de los vencimientos tarda de 3 a 4 veces más: unos 240 ms contra 65 ms en mi base, con JIT prendido, que viene así por omisión. El endpoint hace tres consultas sobre la vista, así que pasa de unos 200 ms a más de 600 ms.

**La corrección:**
- **El lateral `u`,** el de la última ejecución, suma `max(it.valor_medidor) FILTER (WHERE it.medidor_id = t.medidor_id) AS ultimo_uso`. Ya recorre las mismas filas, con las mismas condiciones.
- **El lateral `uu` se borra,** y `pu` usa `u.ultimo_uso`.
- **Nada más cambia:** las columnas y los resultados son los mismos.

**Lo que medí con ese cambio:**
- con los mismos datos, la vista nueva y la corregida dan las mismas filas, y no hay diferencias;
- el costo baja a unos 80.000, por debajo del umbral;
- cada consulta tarda entre 70 y 160 ms.

---

## 3. Concurrencia contra Neon

**PV-09 dio una vez `RECURSO_OCUPADO`.** No es un error del sistema. Contra Neon, cada consulta tarda lo que tarda la red, y la operación que espera el bloqueo a veces pasa los 5 segundos de `lock_timeout`. Igual es una respuesta correcta: no hizo nada, y se puede reintentar.

**En PV-09, PV-21, PV-30 y ME-05:** donde la prueba espera un código exacto para la operación que pierde la carrera, acepta también 409 `RECURSO_OCUPADO`. En ese caso, controla que esa operación no dejó nada hecho, y el resto se controla igual:
- nada duplicado;
- el stock nunca negativo;
- las lecturas vigentes nunca bajan.

**No se cambia `lock_timeout`** ni la cantidad de vueltas.

---

## 4. Un comentario

En `backend/functions/medidores/lecturas.ts`, el comentario de `bloquearMedidor` dice que generar toma el medidor, y no lo toma. La razón real del orden es `bloquearIntervencion`: bloquea la máquina antes que la intervención, y marcar una tarea llega al medidor con la máquina ya bloqueada. Cargar una lectura va en el mismo orden: primero la máquina, después el medidor. Corregir el comentario.

---

## 5. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 4 están hechas, en un commit.
2. `test:migration-018`, `test:preventivos` y `test:medidores` en verde, en Neon.
3. `npm run typecheck` sin errores.
4. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. El hash.
2. El lateral `u` y `pu`, como quedaron en la `018`.
3. La salida final de las tres suites.
4. La salida de `SHOW jit;` en la rama de pruebas de Neon.
5. Desvíos y dudas.
