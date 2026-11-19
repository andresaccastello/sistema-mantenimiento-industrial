# Etapa L1 — Limpieza técnica

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `6ed0631` (Etapa LE1).
> **Origen:** el plan de cierre de la tesis, más lo anotado en las revisiones de la CAL1, la PC1 y la LE1.

**La regla de toda la etapa: lo que el usuario ve no cambia,** salvo los detalles de la sección 1. Partir pantallas, cargar por partes y tipar las pruebas tienen que dar exactamente el mismo sistema.

**Qué entra:**
- los detalles chicos que quedaron anotados;
- el typecheck de las pruebas del backend;
- las pantallas de más de 500 líneas, partidas;
- la carga del front por pantalla, y sacar la interfaz provisoria `dev-ui`;
- poner al día `docs/plan-trabajo.md`;
- borrar los restos viejos de la rama de pruebas, **con la lista a la vista y el OK de Andrés**.

**Qué no entra:**
- partir los archivos grandes del backend (`motor.ts`, `usuarios.ts`, `intervenciones.ts`): están probados, y partirlos ahora es riesgo sin beneficio para el usuario;
- partir los archivos de `lib/`: son lógica pura, con sus pruebas.

---

## 0. Reglas de trabajo

1. **Leé `CLAUDE.md` entero y seguí sus reglas.**
   - **Nunca abras, leas, muestres ni modifiques `.env`.**
   - Rama `feat/base-neon`. **No se agregan dependencias.**
2. **Cinco commits,** y cada uno pasa `npm run typecheck` solo. A partir del 2, ese typecheck incluye las pruebas.

   | N.º | Sección | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1 | `fix: detalles pendientes de CAL1, PC1 y LE1` |
   | 2 | 2 | `chore(tests): typecheck de las pruebas` |
   | 3 | 3 | `refactor(front): pantallas de menos de 500 líneas` |
   | 4 | 4 | `perf(front): carga por pantalla y sin la DevUI provisoria` |
   | 5 | 5 | `docs: plan de trabajo al día` |

   La sección 6 no es un commit: son datos de la rama de pruebas.
3. **Pruebas:**
   - en Neon: `test:calendario` y `test:vencimientos`, por la sección 1;
   - además: `test:front`, `typecheck` (con las pruebas) y `build:frontend`, después de cada commit;
   - **no correr `test:todo`.** Como el commit 2 toca los archivos de todas las suites, Andrés lo corre esa noche.
4. **Pruebas existentes: se autoriza cambiar:**
   - en la sección 1: CA-01 (un caso más), las FE de los textos que cambian, y la limpieza de PA-* y PA-10;
   - en la sección 2: **solo tipos** en los archivos de `backend/tests/`. **Ninguna comprobación, ningún dato y ninguna llamada cambia.** Si un error de tipos muestra un error real en la prueba, frenar y avisar.

   Si otra falla, frenar y avisar.
5. **Ante cualquier duda, frenar y preguntar.**
6. **`ResumenCelular.tsx`:** tiene una línea en blanco agregada que no es de nadie. Descartala con `git restore` antes de empezar.

Guardar este archivo como `docs/etapas/etapa-l1-limpieza-tecnica.md`.

---

## 1. Detalles pendientes (primer commit)

| # | Dónde | Qué pasa | Corrección |
| :-: | :--- | :--- | :--- |
| 1.1 | `GET /api/planes/calendario` | `desde=0000-01-01` da 500: el año 0 pasa el control de JS y Postgres no lo acepta. | Año menor que 1: 422 `DATOS_INVALIDOS`. Se suma el caso a CA-01. |
| 1.2 | Panel del día del calendario | Con `vencida_por_uso` sale "Venció por uso" y además "También vence por uso: puede tocar antes". | Si venció por uso, la segunda no se muestra. |
| 1.3 | `formatDuracion` (`lib/formato.ts`) | Un tiempo de más de 0 y menos de 1 minuto se ve "0 min". En el resumen del celular, "Tiempo de reparación: 0 min" parece un error. | De más de 0 a menos de 1: "menos de 1 min". El 0 exacto sigue "0 min". Con prueba FE. |
| 1.4 | Ronda de lecturas | Una tarea que pasa de Próxima a Vencida dice "está Vencida", y el resumen, "1 tarea pasó a vencida". | "Pasó a Vencida", si antes no estaba vencida, como con Próxima. Con prueba FE. |
| 1.5 | `Notificaciones.tsx` | El mismo aviso de React de la 7.3 de la LE1: `bg` del tema y `style.backgroundColor` en la misma `Card`. | Igual que en la LE1: el color con la prop `bg`, sin el `style`. |
| 1.6 | `test:vencimientos` (PA-*) y el programado (PA-10) | `procesarVencimientos` ahora también avisa lecturas atrasadas, y su limpieza no borra esos avisos ni la marca en medidores ajenos. En una base con medidores atrasados, deja datos. | La limpieza borra los avisos `LECTURA_ATRASADA` que creó la corrida y devuelve `atraso_avisado_en` a como estaba en los medidores que no son de la prueba. Lo mismo que hace `test:lecturas-ronda`. |

---

## 2. Typecheck de las pruebas (segundo commit)

**Qué pasa:** `backend/tsconfig.json` no incluye `backend/tests/`. Con una configuración que las incluye, hay **1.428 errores:**
- 1.415 son lo mismo: el cuerpo de las respuestas (`await res.json()`) y algunas filas llegan como `unknown`, y después se leen sus campos;
- 13 son de otro tipo, por ejemplo una variable declarada `any[]` a la que se le asigna `unknown`, o un campo que el tipo no conoce (`usuarios.test.ts`, línea 867).

**La corrección:**
- **`backend/tsconfig.tests.json`**, que extiende el de `backend/` e incluye `tests/**/*.ts` y `functions/**/*.ts`. Tiene que estar dentro de `backend/`, para que se resuelvan los tipos.
- **Script `typecheck:tests`**, y `typecheck` lo corre también: `typecheck:backend`, después `typecheck:tests` y después el del front.
- **Para los 1.415:** que el cuerpo de las respuestas sea `any` **en un solo lugar,** no con un `as any` en cada línea. Por ejemplo, un ayudante compartido que devuelva el cuerpo ya leído, o una declaración de tipos solo para las pruebas. En el informe va cuál elegiste y por qué. **Lo que importa de este typecheck** es que las pruebas usen bien las funciones del backend que importan (firmas, nombres y parámetros), no tipar cada respuesta.
- **Los 13 restantes,** uno por uno. Si alguno muestra que la prueba compara algo que no existe (por ejemplo, un campo que la API no manda), frenar y avisar: puede ser una prueba que hoy pasa sin probar nada.

**Al terminar:** `npm run typecheck` da 0 errores, con las pruebas incluidas.

---

## 3. Pantallas de menos de 500 líneas (tercer commit)

| Pantalla | Líneas |
| :--- | :-: |
| `pantallas/DetalleMaquina.tsx` | 1.056 |
| `pantallas/IntervencionesLista.tsx` | 619 |
| `pantallas/DetalleIntervencion.tsx` | 533 |
| `pantallas/ReportarFalla.tsx` | 510 |

- **Cada bloque con sentido propio pasa a un componente** en `componentes/`, en la carpeta del tema: la ficha de datos, el historial, los medidores, los filtros de la lista, etc. La pantalla queda armando las piezas.
- **No cambia nada de lo que se ve ni de lo que se pide a la API:** los mismos textos, el mismo orden y las mismas consultas, con las mismas claves de TanStack Query.
- **Si en el camino aparece lógica que se puede probar** (un cálculo, un texto armado), va a `lib/` con su prueba FE. No es obligatorio.
- **`DetalleMaquina.tsx` usa `useMediaQuery('(max-width: 48em)')`,** otro corte: a 768 px exactos se comporta como celular y el resto del sistema no. Pasa a `useEsCelular()`.
- **Al terminar,** ninguna pantalla de `pantallas/` pasa de 500 líneas, ni ningún componente nuevo. En el informe va la tabla de antes y después.

---

## 4. Carga por pantalla y sin la DevUI (cuarto commit)

**Qué pasa:** el front sale en un solo archivo de 1.239 kB (345 kB comprimido), y la compilación avisa que pasa de 500 kB. Todo se descarga al entrar, aunque el operario use dos pantallas.

**La corrección:**
- **Las pantallas se cargan cuando se abren,** con `React.lazy` y `Suspense` en `rutas.tsx`. Se cargan siempre, de entrada:
  - el ingreso, el `Layout` y `RedireccionInicio`;
  - "Reportar falla" y "Mis reportes", las del operario y el celular.

  Las demás, por pantalla.
- **Mientras se carga una pantalla:** un indicador de carga dentro del `Layout`, sin que el menú desaparezca ni la página salte.
- **Si la carga falla** (por ejemplo, se publicó una versión nueva y el archivo viejo ya no existe), un mensaje "No se pudo cargar la pantalla", con "Reintentar" que recarga la página. Nunca una pantalla en blanco.
- **Si después de esto algún archivo sigue pasando de 500 kB,** se pueden separar las librerías grandes con la configuración de Vite (`codeSplitting` o `manualChunks`). **No se sube el límite del aviso:** el aviso tiene que desaparecer porque los archivos son más chicos.
- **La DevUI provisoria se borra:** `frontend/src/dev-ui/` (más de 3.000 líneas) y su ruta en `rutas.tsx`. Era la interfaz de prueba del principio, solo cargaba en desarrollo, y la reemplazaron las pantallas reales. **Antes de borrarla, buscá si algo más la importa;** si algo la usa, frenar y avisar.

**En el informe:** la salida de `build:frontend` antes y después, con el tamaño de cada archivo.

---

## 5. Plan de trabajo al día (quinto commit)

`docs/plan-trabajo.md`:
- **lo hecho desde la A1,** con la etapa de cada cosa: A2, CAL1, PC1, LE1 y esta L1;
- **lo que falta del plan de cierre,** en este orden:
  1. recorrido de punta a punta (el revisor);
  2. datos de demostración;
  3. publicación: base principal de la 004 a la última, con copia de seguridad;
  4. prueba con GI-RE;
  5. archivo para SAE, cuando llegue el formato;
  6. tesis.

En `docs/alcance.md`, revisá que estén "Reporte de compras" (PC1) y "Ronda de lecturas" (LE1). Si falta alguno, se suma.

---

## 6. Restos viejos en la rama de pruebas (sin commit)

**Qué pasa:** en la rama de pruebas de Neon quedaron datos de corridas viejas, cortadas antes de que existiera la limpieza segura de la C2:
- 21 usuarios `ID_<número>` sin apellido;
- 13 máquinas `MO_<algo>`;
- quizás otros, por ejemplo `DIR_<número>`.

**Son datos, no código. Hay que hacerlo en dos pasos, y el segundo solo con el OK de Andrés:**

1. **Inventario, solo lectura.** Con un script en una carpeta temporal, fuera del repo, armá la lista:
   - las filas con prefijos de prueba en usuarios, máquinas, plantas, sectores, planes, repuestos y proveedores, con su id, su nombre y su fecha de creación;
   - de qué dependen (intervenciones, notificaciones, auditoría, lecturas…), con la cantidad de filas de cada tabla.

   **No borres nada todavía.** Mostrá la lista en el informe, o antes si te lo pide Andrés, **y frená.**
2. **Borrado, solo después del OK de Andrés sobre esa lista.** En una transacción, en el orden de las dependencias. Después, una consulta de solo lectura que muestre que no quedó ninguna de esas filas, y que lo demás sigue igual: el mismo conteo por tabla, menos lo borrado.

**Quedan afuera:**
- los planes 289 y 1012, que cargó Andrés a mano;
- todo lo que no tenga un prefijo de prueba.

**La base principal no se toca.**

---

## 7. Cierre e informe

**Criterios de cierre:**
1. Las secciones 1 a 5 están hechas, en cinco commits que compilan solos. El typecheck con las pruebas, desde el commit 2.
2. Las pruebas de la regla 3 en verde, `test:calendario` y `test:vencimientos` en Neon.
3. Push en `feat/base-neon`.
4. La sección 6, hasta el inventario. El borrado, cuando Andrés dé el OK.

**Informe.** Las salidas van pegadas tal cual:
1. Los cinco hashes.
2. La salida final de las pruebas de la regla 3, y de `typecheck` con las pruebas.
3. Cómo se resolvieron los 1.415 errores de la sección 2, y los 13 restantes uno por uno.
4. La tabla de líneas de las pantallas, antes y después, y las de los componentes nuevos.
5. La salida de `build:frontend`, antes y después.
6. El inventario de la sección 6.
7. Desvíos y dudas.

**El recorrido en pantalla lo hace el revisor:** todas las pantallas partidas y la carga por pantalla, en la computadora y en el celular.
