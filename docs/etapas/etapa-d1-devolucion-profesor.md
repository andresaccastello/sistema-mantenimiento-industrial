# Etapa D1 — Devolución del profesor

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `dbc6f1c`.
> **Origen:**
> - la revisión con el profesor del 18/11;
> - el error que encontró Andrés el 18/11: se pudo finalizar una intervención con un pedido de repuestos sin recibir.

**Qué entra:**
1. No finalizar una intervención con pedidos abiertos.
2. El celular, sin límites: un **modo simple opcional**, que cada usuario elige en "Mi cuenta".
3. Modo oscuro, también por usuario.
4. El nombre del sistema, el de la empresa y el logo, configurables por el administrador.

**Qué no entra:**
- el horómetro estimado;
- los avisos críticos;
- la app instalable con notificaciones (PWA).

Son etapas aparte.

---

## 0. Reglas de trabajo

1. **Leé `CLAUDE.md` entero y seguí sus reglas.**
   - **Nunca abras, leas, muestres ni modifiques `.env`.**
   - Rama `feat/base-neon`. **No se agregan dependencias.**
2. **Cuatro commits,** y cada uno pasa `npm run typecheck` solo:

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1 | `fix: no se finaliza con pedidos abiertos` |
   | 2 | 2, 3 (API) y 7 | `feat(api): preferencias del usuario e identidad del sistema` |
   | 3 | 4 y 5 | `feat(front): modo simple opcional y modo oscuro` |
   | 4 | 6 | `feat(front): nombre y logo configurables` |

3. **Pruebas:**
   - en Neon: `test:pedidos-compras`, `test:repuestos-intervenciones`, `test:preferencias` (nueva) y `test:migration-022` (nueva);
   - además: `test:front`, `typecheck` y `build:frontend`;
   - **no correr `test:todo`.**
4. **Pruebas existentes: se autoriza cambiar solo:**
   - las que finalizan una intervención con pedidos abiertos, recibiéndolos o cancelándolos antes (sección 1);
   - FE-129, FE-130 y FE-131, por la sección 4;
   - las de contrato de `/api/auth/me` y de `/api/configuracion/publica`, para sumar los campos nuevos.

   Si otra falla, frenar y avisar.
5. **Ante cualquier duda, frenar y preguntar.**
6. **Los números:** la decisión es la **D-031**; la migración, la **022**; las FE nuevas, desde la **FE-158**. Si alguno ya está usado, frenar y avisar.

Guardar este archivo como `docs/etapas/etapa-d1-devolucion-profesor.md`.

---

## 1. No se finaliza con pedidos abiertos (primer commit)

**Qué pasa:** se puede finalizar una intervención con un pedido de repuestos pendiente o pedido. Después llega el repuesto, la intervención ya está cerrada, "Usar en esta intervención" no se ofrece, y **el costo no entra.** Le pasó a Andrés con la intervención 20110.

**La regla nueva** reemplaza el punto D5 de la D-029:
- **una intervención no se finaliza si tiene pedidos pendientes o pedidos;**
- **la máquina puede volver a funcionar aparte,** con "Volvió a funcionar", y la intervención queda en proceso o esperando repuestos hasta que llegue lo pedido o se cancele el pedido.

**En la API:** la transición de finalizar responde **409 `PEDIDOS_ABIERTOS`**, con "La intervención tiene N pedidos sin recibir: recibilos o cancelalos antes de finalizar". El control va dentro de la misma transacción, con la intervención bloqueada. Vale también para "resolver ahora", si en ese estado pudiera haber pedidos.

**En el front:**
- en `ModalFinalizar`, el aviso amarillo pasa a ser **un bloqueo en rojo**, con la lista de los pedidos abiertos y el texto "Recibilos o cancelalos antes de finalizar";
- el botón Finalizar queda deshabilitado.

**En `docs/decisiones.md`:** el punto D5 de la D-029, con la regla nueva y su motivo.

**Prueba,** en `test:pedidos-compras`: finalizar con un pedido abierto da 409, y no cambia nada. Después de recibirlo, se finaliza; con otro pedido, después de cancelarlo, también.

---

## 2. Preferencias del usuario (API, segundo commit)

### 2.1 Migración 022

`database/migrations/022_preferencias_usuario.sql`. Tiene que poder reaplicarse sin error.

| Columna en `usuarios` | Tipo | Para qué |
| :--- | :--- | :--- |
| `modo_simple_celular` | `BOOLEAN NOT NULL DEFAULT TRUE` | En el celular, ver solo lo esencial. `TRUE` es lo de hoy, así que nadie ve un cambio hasta que lo apague. |
| `tema` | `VARCHAR(10) NOT NULL DEFAULT 'CLARO'`, `CHECK (tema IN ('CLARO', 'OSCURO', 'SISTEMA'))` | `SISTEMA` sigue lo que tenga elegido el dispositivo. |

**Prueba de la migración:** `backend/tests/migration_022.test.ts`, con el script `test:migration-022`:
- aplicar dos veces;
- las columnas con sus tipos y valores por omisión;
- el `CHECK` rechaza otro valor de `tema`.

### 2.2 Las rutas

- **`GET /api/auth/me`** suma `preferencias: { modo_simple_celular, tema }`.
- **`PATCH /api/auth/preferencias`** (`jwtVerify` y `dbVerify`, sin otro permiso: cada uno cambia **solo las suyas**):
  - el cuerpo trae `modo_simple_celular` (booleano) y/o `tema` (`CLARO`, `OSCURO` o `SISTEMA`);
  - si no trae ninguno, o trae un valor inválido o un campo desconocido: 422 `DATOS_INVALIDOS`;
  - devuelve las preferencias como quedaron;
  - no lleva auditoría: es una preferencia de pantalla, no un dato del negocio.

---

## 3. Identidad del sistema (API, segundo commit)

La tabla `configuracion_sistema` ya tiene `nombre_sistema`, `nombre_empresa`, `logo` y `logo_tipo` (migración 012), y `GET /api/configuracion/publica` y `GET /api/configuracion/logo` ya existen. **Falta poder cambiarlos.** Las tres rutas nuevas piden `CONFIGURACION_GESTIONAR`:

| Ruta | Qué hace |
| :--- | :--- |
| `PUT /api/configuracion/identidad` | `{ nombre_sistema, nombre_empresa }`. El nombre del sistema, recortado, de 3 a 80 caracteres. El de la empresa, `null` o recortado de 2 a 120. |
| `PUT /api/configuracion/logo` | Sube el logo, como `multipart/form-data` con el campo `archivo`, leído con `c.req.parseBody()` de Hono. Solo PNG, JPEG o WEBP, **controlado por los primeros bytes del archivo, no por el nombre ni por el tipo que declara.** Hasta 300 KB. Si no cumple, 422 con el motivo. |
| `DELETE /api/configuracion/logo` | Saca el logo. |

- **Todas actualizan `actualizado_en`.** `GET /publica` lo devuelve, y el front lo usa para no mostrar un logo viejo guardado en la caché del navegador (`/logo?v=…`).
- **Sin SVG,** a propósito: un SVG puede traer código.
- **Cada cambio queda en la auditoría** que ya use Configuración para los avisos. Si no hay ninguna que sirva, en el log, y en el informe va cuál se usó.

---

## 4. El modo simple, opcional (tercer commit)

**Hoy**, en el celular, todos ven una versión reducida (D-027 y D-030). **Con esta etapa**, eso pasa solo si el usuario tiene el modo simple prendido. Apagado, en el celular ve **lo mismo que en la computadora, según su perfil.**

- **Un hook `useModoSimple()`:** `useEsCelular()` y además `preferencias.modo_simple_celular`.
- **Lo que hoy depende del celular pasa a depender del modo simple:**
  - `permitidaEnCelular`;
  - el menú del celular;
  - el destino al entrar;
  - el aviso "Esta sección se usa desde la computadora";
  - el resumen de Reportes en el celular.
- **Lo que es solo adaptarse a la pantalla sigue dependiendo de `useEsCelular()`:** el menú que se esconde, las tarjetas en lugar de tablas, los botones a todo el ancho, etc. Si en algún lugar no es claro de qué lado va, frenar y preguntar.
- **La lógica pura, en `lib/celular.ts`,** recibe el modo simple como parámetro. FE-129 a FE-131 se ajustan, y se suman casos con el modo simple apagado: el menú del celular es el mismo de la computadora, y todas las rutas que permite el perfil están permitidas.
- **Con el modo simple apagado, ninguna pantalla se puede correr de costado a 390 px.** Una tabla ancha se desplaza **dentro** de su recuadro, no la página. Si hace falta tocar alguna pantalla para eso, se toca, y en el informe va la lista.

**En "Mi cuenta",** una sección nueva, **"Preferencias":**
- un interruptor **"Modo simple en el celular"**, con la ayuda: "En el celular muestra solo lo esencial: reportar fallas, tus reportes, la ronda de lecturas y un resumen de reportes. Apagado, en el celular ves lo mismo que en la computadora, según tu perfil.";
- el **tema** (sección 5);
- cada cambio se guarda al momento, con un aviso chico "Preferencia guardada", y se aplica sin recargar.

---

## 5. Modo oscuro (tercer commit)

- **En "Preferencias",** un `SegmentedControl`: "Claro", "Oscuro" y "Como el dispositivo". Por omisión, "Claro".
- **En `main.tsx`** se saca `forceColorScheme="light"`. El esquema sale de la preferencia del usuario: `SISTEMA` es `auto` en Mantine. Antes de entrar, en la pantalla de ingreso, se usa el último que se usó en ese navegador, para que no parpadee.
- **Los colores fijos:** hay unos 32 archivos con colores escritos a mano (`#64748b`, `#0f172a`, `#ffffff`, etc.), y el tema le pone `bg: '#ffffff'` a todo `Paper`. **Pasan a variables de Mantine** (`var(--mantine-color-text)`, `var(--mantine-color-dimmed)`, `var(--mantine-color-body)`, `var(--mantine-color-default-border)` y similares), o a colores del tema con su versión oscura.
- **En claro, todo tiene que verse igual que hoy.** El revisor compara las pantallas antes y después.
- **En oscuro, todo tiene que leerse bien:**
  - texto, bordes, tablas y tarjetas;
  - los colores de estado (vencida, próxima, al día, hecha);
  - el calendario;
  - los gráficos de reportes, si los hay.
- **Al terminar,** buscá colores escritos a mano en `frontend/src`. Solo pueden quedar en la definición del tema, y en el informe va la lista de lo que quede, con el motivo.

---

## 6. Nombre y logo configurables (cuarto commit)

**En Configuración** (con `CONFIGURACION_GESTIONAR`), una tarjeta nueva arriba, **"Identidad del sistema":**
- **los campos** "Nombre del sistema" y "Nombre de la empresa", con "Guardar";
- **el logo:**
  - la vista previa del actual;
  - "Subir logo" (PNG, JPEG o WEBP, hasta 300 KB), con la vista previa antes de confirmar;
  - "Quitar logo", con confirmación;
  - debajo, la ayuda: "Se ve arriba a la izquierda y en la pantalla de ingreso. Recomendado: fondo transparente, unos 200 × 64 px.".

**Dónde se ve:**
- **el encabezado**, que ya muestra el logo y el nombre del sistema; si hay nombre de empresa, va abajo, en chico;
- **la pantalla de ingreso**, con el logo, el nombre del sistema y el de la empresa;
- **el título de la pestaña del navegador**, con el nombre del sistema.

**Al guardar,** se ve sin recargar. El logo se pide con `?v=<actualizado_en>`.

---

## 7. Decisión y pruebas de la API (segundo commit)

**En `docs/decisiones.md`:**

> **D-031 — El celular, a elección de cada usuario**
>
> **Estado:** Aceptada. Reemplaza el punto 3 de la D-027 y el punto 2 de la D-030.
>
> 1. **El dispositivo no quita permisos.** En el celular, cada usuario ve lo que su perfil le permite, igual que en la computadora.
> 2. **El modo simple es opcional.** Cada usuario lo prende o lo apaga en "Mi cuenta". Prendido, en el celular ve lo esencial: reportar fallas, sus reportes, la ronda de lecturas y un resumen de reportes. Viene prendido, así que el uso de hoy no cambia hasta que alguien lo apague.
> 3. **Una tablet** de 768 px o más se ve como una computadora. Con el modo simple apagado, da lo mismo de qué lado caiga.
> 4. **El tema** (claro, oscuro o el del dispositivo) también es una preferencia de cada usuario.
>
> **Motivo:** la revisión con el profesor del 18/11. La tendencia es usar el celular para casi todo, limitar por dispositivo genera casos raros, y el sistema es para cualquier empresa: que cada una decida, no el sistema.

**Pruebas,** en `backend/tests/preferencias.test.ts`, con el script `test:preferencias`:

| ID | Caso | Esperado |
| :-: | :--- | :--- |
| PR-01 | `/me` | Trae `preferencias` con los valores por omisión. |
| PR-02 | `PATCH /api/auth/preferencias` | Cambia solo las del que llama, y otro usuario no cambia. Sin sesión: 401. |
| PR-03 | Cuerpo inválido: vacío, `tema: 'AZUL'`, `modo_simple_celular: 'si'`, un campo desconocido | 422, y no cambia nada. |
| PR-04 | `PUT /identidad` | Sin `CONFIGURACION_GESTIONAR`: 403. Con 2 y con 81 caracteres en el nombre del sistema: 422. Válido: se ve en `/publica`, con `actualizado_en` nuevo. |
| PR-05 | `PUT /logo` | Un PNG chico, válido: 200, y `/logo` lo devuelve con su tipo. Texto con el nombre `.png`: 422. Un SVG: 422. Más de 300 KB: 422. Sin permiso: 403. |
| PR-06 | `DELETE /logo` | `tiene_logo: false`, y `/logo` da 404. |

Siguen el patrón de C2 (`clienteSano`), y **dejan la identidad y el logo como estaban al empezar.**

---

## 8. Cierre e informe

**Criterios de cierre:**
1. Las secciones 1 a 7 están hechas, en cuatro commits que compilan solos.
2. Las pruebas de la regla 3 en verde, en Neon.
3. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:
1. Los cuatro hashes.
2. La salida final de cada suite de la regla 3.
3. Typecheck y build.
4. Las pantallas que se tocaron para no correrse de costado a 390 px (sección 4).
5. La búsqueda de colores escritos a mano, al terminar (sección 5).
6. La auditoría que se usó en la sección 3.
7. Desvíos y dudas.

**El recorrido en pantalla lo hace el revisor:** modo simple prendido y apagado en el celular, claro y oscuro en todas las pantallas, y la identidad en el encabezado y en el ingreso.
