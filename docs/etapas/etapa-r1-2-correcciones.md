# Etapa R1.2 — Los diálogos de repuestos no cambian lo que escribe el usuario

> **Estado:** requerimiento para implementar. Etapa de día. **Solo frontend.**
> **Requisito previo:** commit `09a621c` (Etapa R1.1).
> **Origen:** revisión de la R1.1 con el sistema levantado en mi base local.
>
> - `test:todo` en mi base: 404 de 404, con los quince números en 0. La huella de la base, sin cambios ajenos.
> - Los ataques a la API de la R1.1, repetidos: todos corregidos.
> - Recorrido con Playwright de `/repuestos`, del detalle, de R3 y de D1.

**Lo que funciona y no se toca:**

- **La API:**
  - el importe calculado en SQL;
  - los ids y los booleanos validados;
  - ninguna carrera en 25 intentos por caso, y ningún 500 con nombres o códigos repetidos;
  - la migración 016 al reaplicarse.
- **La prueba de contrato:** probé cambiarle un nombre de campo y el typecheck lo detecta.
- **Las pantallas:**
  - el stock se ve en la lista, el detalle y las opciones;
  - ingreso, egreso y ajuste se registran;
  - la pestaña Usos ya no rompe la pantalla;
  - los movimientos muestran fecha, usuario y enlace;
  - `EMAIL_INVALIDO` y `CODIGO_DUPLICADO` aparecen en su campo;
  - los ⋮ tienen nombre accesible.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias.
2. Si `CLAUDE.md` todavía no está en el repo, va primero, en su propio commit: `docs: reglas del proyecto para Claude Code`.
3. **Un commit para esta etapa:** `fix(front): los diálogos de repuestos no cambian lo que escribe el usuario`.
4. Solo frontend. El backend y sus pruebas no cambian. No se modifica ninguna prueba existente.
5. **No correr `test:todo`:** va en la corrida de la noche.
6. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-r1-2-correcciones.md`.

---

## 1. Los campos numéricos cambian el valor sin avisar (grave)

Los `NumberInput` de los diálogos de repuestos tienen `min` y `max`. Mantine, por omisión, **lleva el valor al límite al salir del campo**. Así se envía un número que el usuario no escribió:

| Diálogo | Escribí | Se registró |
| :--- | :--- | :--- |
| Egreso, con 12 en stock | 50 | **Un egreso de 12: todo el stock.** |
| Egreso | 0 | Un egreso de 0,001 |
| Egreso | −3 | Un egreso de 0,001 |
| Agregar repuesto en R3, con 11,998 en stock | 50 | **Un consumo de 11,998: todo el stock.** |
| Ingreso | costo −50 | Costo $ 0 |

Lo correcto es mostrar el error y no enviar nada:

- "Hay 12 en stock." para el máximo;
- "Tiene que ser mayor que cero." para el cero y los negativos;
- "No puede ser negativo." para el costo.

Esos mensajes ya existen en `validarCantidad` y `validarCosto`.

**Corrección:**

1. **Un componente nuevo, `componentes/repuestos/CampoNumero.tsx`,** que envuelve `NumberInput` con:
   - `clampBehavior="none"`;
   - coma decimal y punto de miles, como hoy.

   **Su tipo de props no admite `min` ni `max`:** se quitan con `Omit`.
2. **Todos los campos de cantidades y costos de `componentes/repuestos/` usan `CampoNumero`.** Ningún otro archivo de esa carpeta importa `NumberInput`.
3. **Los límites los controlan `validarCantidad` y `validarCosto`** al confirmar, con el error en su campo, como ya pasa con el cero en `ModalConsumo`. El máximo de egreso y de consumo es el stock que muestra el diálogo.
4. **Lo que se envía es exactamente el valor que se ve en el campo.**

**Verificación en el informe:** la salida de `grep -rn "NumberInput" frontend/src/componentes/repuestos/`. Tiene que aparecer solo en `CampoNumero.tsx`.

---

## 2. El origen del costo con su código

La pestaña Costos del detalle muestra `MIGRACION`, `ALTA`, `EDICION`, `INGRESO` y `CONSUMO` tal cual.

**Corrección:** una función pura en `lib/repuestos.ts`, `etiquetaOrigenCosto(origen)`:

| Origen | Etiqueta |
| :--- | :--- |
| `MIGRACION` | Carga inicial |
| `ALTA` | Alta |
| `EDICION` | Edición |
| `INGRESO` | Ingreso |
| `CONSUMO` | Consumo |

Un valor desconocido sale tal cual.

**FE-57:** los cinco valores y uno desconocido.

---

## 3. `any` que quedó

La R1.1 pedía que en estos componentes solo quedara `catch (err: unknown)`. Quedaron:

- `catch (err: any)` en `ModalAnularConsumo`, `ModalCancelarPedido`, `ModalConsumo`, `ModalPedido`, `ModalProveedor`, `ModalRecibirPedido` y `ModalRepuesto`;
- `(err as any)` en `ModalMovimiento` y `(error as any)` en `DetalleRepuesto`;
- `Record<string, any>` para los cuerpos en `ModalConsumo`, `ModalPedido`, `ModalRecibirPedido`, `ModalRepuesto`, `ModalMovimiento` y en `cuerpoMovimiento`;
- `(d: any)` en los `DatePickerInput` de `ModalPedido`;
- `(val as any)` en `TabRepuestos`.

**Corrección:**

- **Errores:** `catch (err: unknown)`, y `err instanceof ApiError` para leer `codigo` y `datos`.
- **Cuerpos:** cada uno con su tipo en `api/tipos.ts` (`CuerpoConsumo`, `CuerpoPedido`, `CuerpoRecepcion`, `CuerpoRepuesto` y `CuerpoMovimiento`), con los campos de las secciones 4 y 5 de la R1. `cuerpoMovimiento` devuelve `CuerpoMovimiento`, y FE-56 sigue igual.
- **Fechas:** el tipo que da Mantine 9 a `onChange` de `DatePickerInput`.
- **Filtro:** el tipo del estado en vez de `as any`.

**Verificación en el informe:** la salida de `grep -rn "\bany\b" frontend/src/componentes/repuestos/ frontend/src/pantallas/DetalleRepuesto.tsx frontend/src/pantallas/Repuestos.tsx frontend/src/lib/repuestos.ts`. Tiene que salir vacía.

---

## 4. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 3 están hechas, en un commit (más el de `CLAUDE.md`, si hizo falta).
2. `npm run test:front`, `npm run typecheck` y `npm run build:frontend` sin errores.
3. Push en `feat/base-neon`.

**Informe corto.** Las salidas van pegadas tal cual:

1. Los hashes.
2. La salida final de `test:front`.
3. La salida de typecheck y la de build.
4. Las salidas de los dos `grep` de las secciones 1 y 3.
5. `wc -l` de los archivos tocados.
6. Desvíos.
7. Dudas.
