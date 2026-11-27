# Etapa F3a.1 — Pruebas que dependen de lo que hay en la base

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `6b40206` (Etapa F3a).
> **Origen:** revisión de la F3a. Corrí `test:todo` en tres bases distintas, con una "huella" de todas las tablas antes y después de cada corrida:
>
> | Base | Contenido | Resultado |
> | :--- | :--- | :--- |
> | Mi base local | Datos de planta, más cambios a mano: niveles de criticidad renombrados, otro valor por omisión, un nivel nuevo, un tipo de equipo desactivado, dos plantas, la marca cargada y un segundo administrador. | En verde |
> | Una base como la principal de hoy | Solo las migraciones 001 a 012 y `ADMIN001`. | No arranca |
> | Una base recién creada | Las migraciones 001 a 013 y solo `ADMIN001`. | Fallan dos suites y queda basura |
>
> Todo lo de abajo se comprobó en esas corridas.

**Lo que funciona y no se toca:**

- **Migración 013:** es idempotente (la apliqué dos veces). Las máquinas existentes quedaron con los valores por omisión y `tipo` pasó a `modelo` sin perder datos.
- **API de máquinas:** con los catálogos cambiados a mano, en mi base:
  - la lista y el detalle devuelven el mismo objeto;
  - `estado_desde` coincide con la base en todas las máquinas;
  - el alta toma el valor por omisión que haya en ese momento, no "Media";
  - la edición vacía los campos y deja igual los que no vienen;
  - el código repetido da 409, y desactivar una máquina con trabajo abierto da 409;
  - un tipo de equipo desactivado se rechaza y no aparece en el catálogo.
- **Tablero:** "Detenidas ahora" sale ordenada por criticidad; el filtro por planta cuenta bien; una planta inexistente da 404.
- **Avisos:**
  - falla en una máquina de la criticidad renombrada a "Crítica": `ALTA` con "— criticidad Crítica";
  - falla en una máquina de criticidad Baja: `NORMAL`.
- **Pruebas en mi base:** `test:todo` dio 293 de 293 y los once números en 0. Las pruebas no tocaron los catálogos ni la marca, y ningún administrador cambió de estado.
- **Frontend:** `test:front`, typecheck y build en verde. "Reportar falla" con `?maquina=` y las pantallas de intervenciones siguen andando.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias.
2. **Un solo commit:** `test: las pruebas no dependen de lo que hay en la base`.
3. **Qué se toca:** solo `scripts/run-all-tests.mjs`, las tres pruebas que nombra la sección 2 y el tipo de la sección 3.
   - El código de `backend/functions/` y las migraciones no cambian.
   - Lo que verifica cada prueba tampoco cambia.
4. Las pruebas corren solo contra la rama de pruebas de Neon.
5. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-f3a-1-correcciones.md`.

---

## 1. `test:todo` no arranca en una base sin la migración 013

### 1.1 Problema

En una base como la principal de hoy, que tiene hasta la migración 012:

```
[test:todo] No se pudo controlar los datos que quedaron: relation "plantas" does not exist
```

La corrida termina en 1 sin correr ninguna prueba.

**Causa.** El control cuenta `plantas`, `criticidades` y `tipos_equipo` antes de empezar. Esas tablas todavía no existen, porque las crea la prueba de la migración 013 en esa misma corrida.

**Cuándo pasa.** Cada vez que la rama de pruebas de Neon se vuelva a crear desde la principal antes de aplicarle la 013. Lo mismo va a pasar con cada migración futura que cree una tabla contada.

### 1.2 Corrección

1. **Contar solo lo que existe.** `contarFilas()` cuenta solo las tablas que ya existen (`to_regclass('public.<tabla>') IS NOT NULL`). Para las que no existen devuelve `null`.
2. **Contar tres veces:**
   - **al empezar;**
   - **al terminar las migraciones,** antes de las pruebas de negocio;
   - **al final.**
3. **La diferencia de cada tabla:**
   - si existía al empezar: final menos inicio, como hoy;
   - si no existía al empezar: final menos lo contado al terminar las migraciones. Así no cuentan como "datos que quedaron" los datos iniciales de la propia migración, por ejemplo los tres niveles de criticidad.
4. **Si una tabla contada no existe ni al terminar las migraciones:** `[test:todo] No se pudo controlar los datos que quedaron: <mensaje>` y código 1, como hoy.
5. **La línea de salida no cambia:** sigue con los once números.

---

## 2. Pruebas que dependen de los datos que ya hay

### 2.1 `permisos_granulares.test.ts` no corre en una base nueva

**Problema.** Usa `SELECT id FROM sectores LIMIT 1`, así que en una base sin sectores falla:

```
TypeError: Cannot read properties of undefined (reading 'id')   (permisos_granulares.test.ts:70)
```

La suite entera se corta. Por eso esa corrida contó 289 pruebas y no 293.

Antes de la F2.1 no se notaba: otras pruebas dejaban sectores en la base. Ahora que las limpiezas están bien, aparece. La Etapa P ya pedía que las pruebas corrieran en una base recién creada.

**Corrección.** Crear un sector propio, con nombre único, y borrarlo al final en el `finally`.

### 2.2 `usuarios.test.ts` usa sectores reales y, si no hay, deja dos de más

**Problema.**

- Toma los dos primeros sectores activos de la base para asignárselos a sus usuarios.
- Si hay menos de dos, crea "Sector U1" y "Sector U2" y **no los borra**. En la base nueva quedaron: `sectores 2`.
- Si ya existían con ese nombre, los reactiva (`ON CONFLICT … SET activo = TRUE`), es decir, modifica datos que no creó.

**Corrección.** Crear siempre sus dos sectores, con nombres únicos como los demás de la prueba, y borrarlos al final junto con `sectorPropioId` y `sectorInactivoId`. Se quitan la búsqueda de sectores existentes y el `ON CONFLICT`.

### 2.3 `tiempos.test.ts`, R-02, exige los totales de todo un día

**Problema.**

- R-02 inserta tres intervenciones finalizadas el 01/08/2026 y pide `/api/reportes/tiempos?agrupar=ejecucion` para ese día.
- Después exige que el grupo INTERNA tenga **exactamente** 2 intervenciones, y EXTERNA exactamente 1.
- Cualquier otra intervención finalizada ese día la rompe, por ejemplo la del historial importado (requisito 13 del relevamiento) o cualquier dato real de la rama.
- En mi base, con restos de una corrida vieja, dio `6 !== 2`.

**Corrección.**

1. Pedir el reporte **antes** de insertar y **después**.
2. Por grupo, comparar la diferencia entre las dos respuestas:
   - INTERNA: cantidad +2, total +180;
   - EXTERNA: cantidad +1, total +300.
3. El promedio se verifica, como hoy (90 y 300), solo si ese grupo no existía antes.

R-01 y R-05 no necesitan cambios: buscan sus propias máquinas y sectores.

---

## 3. Tipo sobrante en el frontend

En `frontend/src/api/tipos.ts`, `MaquinaLista` tiene un campo `planta?` suelto, además de `sector.planta`. La API no lo devuelve: hay que quitarlo.

---

## 4. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 3 están hechas, en un commit.
2. `npm run test:todo -- etapa-f3a-1`:
   - en verde, con **293** pruebas;
   - los once números en 0;
   - corrido dos veces seguidas;
   - el log de la segunda va en `docs/evidencia/`.
3. `npm run test:front`, `npm run typecheck` y `npm run build:frontend` sin errores.
4. Push en `feat/base-neon`.

Yo lo verifico en las tres bases: mi base con los catálogos cambiados, una como la principal (hasta la 012) y una recién creada.

**Informe corto:**

1. El hash del commit.
2. De las dos corridas de `test:todo`: la línea de total y la de datos que quedaron.
3. Desvíos.
4. Dudas.
