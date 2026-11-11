# Etapa C2 — Cortes de conexión con la base

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `7f78f11` (Etapa PV3.1).
> **Origen:** de las últimas cuatro corridas de `test:preventivos` contra Neon, dos se cortaron con `ECONNRESET` y no limpiaron. Los restos hicieron fallar M18-04 en la corrida siguiente.

## Qué pasa

Cuando se corta una conexión, `pg` emite un evento `'error'`. **Hoy nadie lo atiende, y Node termina el proceso entero.** Pasa en dos casos:

| La conexión cortada | Quién emite el error |
| :--- | :--- |
| Tomada con `pool.connect()`, entre una consulta y otra | El cliente |
| Inactiva dentro del pool | El pool |

**En las pruebas,** cada archivo toma un cliente para todo el archivo. Si esa conexión se corta, el proceso muere antes de su `finally`, y nada se limpia.

**En producción** pasa lo mismo: si Neon corta una conexión inactiva del pool, se cae el servidor.

Lo reproduje en mi base, cortando la conexión con `pg_terminate_backend`. Los dos casos terminan con `Unhandled 'error' event` y código 1. Con el arreglo de la sección 1, el proceso sigue. Con el de la 2, la limpieza consigue una conexión nueva.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Un commit:** `fix: cortes de conexión con la base`.
3. **Pruebas:**
   - `test:conexion` (nueva);
   - `test:motor` y `test:usuarios`, que toman dos clientes;
   - y tres suites cortas más, a elección;
   - **no correr `test:todo`:** la corrida de la noche controla el resto.
4. **Las pruebas existentes solo cambian en lo que dice la 2.** Ningún otro cambio.
5. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-c2-cortes-de-conexion.md`.

---

## 1. El pool (`backend/functions/db.ts`)

- **`keepAlive: true`** en la configuración del pool.
- **`pool.on('error', avisar)`**, para las conexiones inactivas.
- **`pool.on('connect', (cliente) => cliente.on('error', avisar))`**, para las tomadas. Queda puesto en cada conexión nueva, durante toda su vida.
- **`avisar`** escribe en la consola: `[base] Se cortó una conexión (<código>); se descarta.` El código es `err.code`, o `err.message` si no hay código.

  **Nunca escribe la cadena de conexión ni el error entero.**

No hace falta más: el pool ya descarta, al liberarla, una conexión que no se puede usar.

---

## 2. Las pruebas

**Un ayudante nuevo, `backend/tests/conexion.ts`:**

`clienteSano(cliente)` devuelve un cliente que anda:
1. Prueba `SELECT 1` con el que recibe. Si anda, lo devuelve.
2. Si no, lo libera con `release(true)`, que lo destruye.
3. Escribe `[pruebas] Se cortó la conexión de la prueba: sigo con una nueva.`
4. Pide otro al pool. Si falla, hasta 3 intentos, con 2 segundos entre uno y otro.

**En cada archivo de `backend/tests/` que toma un cliente para todo el archivo:**
- `const client = await pool.connect()` pasa a `let client = await pool.connect()`;
- la primera línea del `finally` que limpia es `client = await clienteSano(client);`;
- el `client.release()` del final no cambia: libera el que quedó.

**Las funciones de limpieza ven el cliente nuevo,** porque usan la variable `client`.

- **Si un archivo toma dos clientes,** como `motor_estados` y `usuarios`, lo mismo para cada uno.
- **Si un archivo limpia fuera de un `finally`,** no se reestructura: se anota en el informe.

---

## 3. `backend/tests/conexion.test.ts`, con el script `test:conexion`

Para cortar una conexión, se toma su `pg_backend_pid()` y se corta desde otra con `pg_terminate_backend`. Si Neon no lo permite, frenar y avisar.

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| CX-01 | Se corta una conexión inactiva del pool | El proceso sigue, y una consulta nueva con `pool.query` anda. |
| CX-02 | Se corta la conexión tomada por la prueba | El proceso sigue. Una consulta con ese cliente falla. `clienteSano` devuelve otro, con otro `pg_backend_pid()`, que anda. |
| CX-03 | `clienteSano` con un cliente que anda | Devuelve el mismo. |

---

## 4. `CLAUDE.md`

Una línea en las reglas de pruebas:

> Un archivo de pruebas que toma un cliente para todo el archivo lo declara con `let`, y su `finally` empieza con `client = await clienteSano(client)`.

---

## 5. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 4 están hechas, en un commit.
2. Las suites de la regla 3 en verde, en Neon.
3. `npm run typecheck` sin errores.
4. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. El hash.
2. `db.ts` y `conexion.ts`, enteros.
3. La lista de archivos de prueba tocados, y los que se anotaron por la 2.
4. La salida final de las suites corridas.
5. Desvíos y dudas.
