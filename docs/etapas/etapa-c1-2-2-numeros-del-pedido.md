# Etapa C1.2.2 — Números del pedido

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `ee0c62d` (Etapa C1.2.1).
> **Origen:** revisión de la C1.2.1 con el sistema levantado en mi base local.
>
> - `test:ids` 4 de 4, `test:costos` 23 de 23 y `test:front` 210 de 210. Sin la corrección, `test:ids` falla, como dice el informe. La huella de la base, sin cambios ajenos.
> - Ataques con ids en la ruta, la consulta y el cuerpo: ningún 500.
> - En pantalla, en escritorio y en celular, las secciones 2 y 3 andan como se pidió.
> - Quedan dos cosas de la misma familia, las dos de antes de la C1. Son las de abajo.

**Lo que funciona y no se toca:** todo lo de la C1.2.1. Esta etapa no toca el front.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias. Rige `CLAUDE.md`.
2. **Un commit:** `fix(api): límites e ids escritos de otra forma`.
3. **Pruebas:**
   - solo `test:ids`, `test:usuarios`, `test:administracion`, `test:avisos` y `test:repuestos`;
   - **no correr `test:todo`:** va en la corrida de la noche;
   - las pruebas existentes no se modifican, salvo `ids.test.ts`, que es de la etapa anterior y se amplía.
4. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-c1-2-2-numeros-del-pedido.md`.

---

## 1. Límites y desplazamientos que dan 500

Lo anotaste en el informe como sospecha. Lo probé:

| Pedido | Hoy |
| :--- | :--- |
| `GET /api/configuracion/avisos/envios?offset=1e20`, y con 20 dígitos | 500 |
| `GET /api/usuarios/:id/auditoria?offset=` con 20 dígitos | 500 |
| `GET /api/repuestos/:id/movimientos?limite=1.5`, y con `0.0001` | 500 |

`GET /api/intervenciones?offset=1e20` no da 500: responde 200 con la lista vacía.

**Corrección:**

1. **En todos los listados**, `limit`, `limite` y `offset` aceptan solo enteros seguros. Si no, la respuesta de dato inválido que ya da cada uno.
2. **Los movimientos de un repuesto** hoy no tienen esa respuesta:
   - `limite` es un entero desde 1, y más de 500 se toma como 500, como hoy;
   - cualquier otro valor, incluido `abc`, responde 422 `DATOS_INVALIDOS`.
3. Si conviene, una función compartida.

---

## 2. Un id escrito de otra forma se toma como otro id

`parseId` convierte con `Number(…)`, así que acepta valores que no son un id:

| Valor | Lo toma como |
| :--- | :--- |
| `true` | 1 |
| `[5]` | 5 |
| `"0x10"` | 16 |
| `"1e3"` | 1000 |
| `"+1"`, `"1.0"` | 1 |
| `" 7 "` | 7 |

**Ejemplos que vi:**

- `POST /api/sectores` con `planta_id: true` creó un sector en la planta 1.
- `GET /api/maquinas/0x10` busca la máquina 16.
- Pasa lo mismo con `maquina_id` al reportar una falla y con `usuario_id` del responsable.

El informe de la C1.2.1 dice que notificaciones ya rechaza `"1.0"` y `"+1"`. No es así: `parseId("1.0")` da 1.

**Corrección:**

1. **`parseId` recibe el valor tal cual** (`unknown`) y acepta solo:
   - un número entero seguro mayor que 0;
   - un texto de solo dígitos (`/^\d+$/`) que dé un entero seguro mayor que 0.

   Todo lo demás da `null`.
2. **Quien hoy llama `parseId(String(x))` pasa `x` directo.** Si no, `[5]` vuelve a ser `"5"`.
3. **La respuesta es la misma que hoy con 0.**
4. `validarIdCuerpo` y `parseIdRuta` ya son estrictos. No cambian, salvo que `parseIdRuta` pase a usar `parseId`.
5. **Revisar que el front mande los ids como número o como texto de dígitos.** Si encontrás otro formato, frenar y avisar.

---

## 3. Pruebas

Se suman a `ids.test.ts`, y el título de la suite pasa a "ID-01 a ID-05":

| ID | Qué prueba |
| :--- | :--- |
| ID-04 | **Formatos raros con el id de algo que existe:** `+id`, `id.0`, ` id`, el id en hexadecimal, `true`, `[id]`. La misma respuesta que con 0, y no se guarda nada. Ver la lista de abajo. |
| ID-05 | **Límites y desplazamientos:** los tres casos de la sección 1, y `offset=1e20` en las intervenciones. La respuesta de dato inválido, nunca 500. Los movimientos, también con `limite=abc`. |

**ID-04 cubre:**

- **en la ruta:** `GET /api/maquinas/X` y `POST /api/notificaciones/X/leer`;
- **en la consulta:** `maquina_id` del listado de intervenciones;
- **en el cuerpo:**
  - `maquina_id` al reportar una falla;
  - `planta_id` de un sector nuevo;
  - `usuario_id` del responsable;
  - `perfil_id` y `sectores` de un usuario nuevo;
  - `periodo_ids`;
  - los ids del orden de un catálogo.

---

## 4. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 3 están hechas, en un commit.
2. Las cinco suites de la regla 3 en verde, en Neon.
3. `npm run typecheck` sin errores.
4. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. El hash.
2. Los listados de la sección 1 y las llamadas `parseId(String(…))` que cambiaste.
3. Lo que encontraste en el front, por la sección 2.5.
4. La salida final de las cinco suites, y una corrida de `test:ids` sin la corrección en la que fallen ID-04 e ID-05.
5. El typecheck.
6. `wc -l` de los archivos tocados.
7. Desvíos y dudas.
