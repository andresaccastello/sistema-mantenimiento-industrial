# Etapa A1 — Cierre de alcance y uso en el celular

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** commit `20f221c` (Etapa R1).
> **Origen:** las decisiones de alcance del 11/11, en "Plan de cierre de la tesis".

**Qué entra:**
- dejar escritas las decisiones de alcance;
- sacar WhatsApp de la interfaz;
- acotar el uso en el celular;
- poner al día los documentos del proyecto.

**Qué no entra:** nada de la API ni de la base. El backend de WhatsApp queda como está, listo para el futuro.

---

## 0. Reglas de trabajo

1. **Leé `CLAUDE.md` entero y seguí sus reglas.**
   - **Nunca abras, leas, muestres ni modifiques `.env`.**
   - Rama `feat/base-neon`. **No se agregan dependencias.**
2. **Dos commits,** y cada uno pasa `npm run typecheck` solo:

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1 y 4 | `docs: cierre de alcance` |
   | 2 | 2 y 3 | `feat(front): sin WhatsApp en la interfaz y celular acotado` |

3. **Pruebas:**
   - solo `npm run test:front`, `npm run typecheck` y `npm run build:frontend`;
   - **no correr `test:todo`.**
4. **Pruebas existentes:** se autoriza cambiar solo las FE que esperan textos o columnas de WhatsApp en la interfaz, y solo para sacar WhatsApp. Si otra falla, frenar y avisar.
5. **Ante cualquier duda, frenar y preguntar.** No inventar reglas que la etapa no dice.

Guardar este archivo como `docs/etapas/etapa-a1-alcance-celular.md`.

---

## 1. Decisión (primer commit)

Agregar a `docs/decisiones.md`:

> **D-027 — Alcance final**
>
> **Estado:** Aceptada
>
> 1. **Documentos (requisito 11): no se implementan.** Adjuntar manuales, facturas o remitos no cambia el circuito de GI-RE: los comprobantes ya están en SAE y el 87 % del trabajo lo hacen externos. Queda como mejora futura.
> 2. **WhatsApp (requisito 12): no se implementa en esta versión.** La bandeja de salida y la API quedan preparadas (D-36), pero la interfaz no muestra el canal: ni la configuración, ni las reglas, ni el teléfono del usuario. Los avisos salen por la campana y por email.
> 3. **El sistema es de escritorio.** GI-RE trabaja en puestos con PC. En el celular solo se puede:
>    - el operario: reportar una falla, ver sus reportes y sus notificaciones;
>    - quien gestiona: ver el tablero y los reportes, sin cargar nada.
>
>    Todo lo demás se usa desde la computadora. Las pantallas ya se adaptan al celular, así que ampliar el uso es una mejora futura y no un rediseño.
> 4. **Esto es de interfaz, no de seguridad:** la API no distingue el dispositivo, y los permisos siguen siendo los mismos.
>
> **Motivo:** los sistemas líderes son móviles para el técnico, pero en GI-RE quien repara suele ser externo y la gestión se hace en el escritorio. Cargar costos, repuestos y horas en un celular es donde más errores se cometen.

---

## 2. WhatsApp fuera de la interfaz (segundo commit)

**Se saca de la interfaz,** sin tocar la API, los tipos de la API ni la base:

| Dónde | Qué se saca |
| :--- | :--- |
| `pantallas/Configuracion.tsx` | De "Avisos por email y WhatsApp" pasa a "Avisos por email", y el texto de abajo no nombra WhatsApp. |
| `componentes/configuracion/TarjetaCanales.tsx` | El canal WhatsApp: su fila, su interruptor y lo que lo acompañe. |
| `componentes/configuracion/TablaReglas.tsx` | La columna WhatsApp. |
| `componentes/admin/ModalUsuario.tsx` | El campo del teléfono de WhatsApp. Al editar, el valor que ya tenga el usuario no se manda ni se borra. |
| `pantallas/DetalleUsuario.tsx` y `pantallas/MiCuenta.tsx` | La fila de WhatsApp. |

- **`lib/errores.ts` y `lib/auditoria.ts`** pueden quedar como están: traducen códigos y eventos que la API todavía puede mandar.
- **Al terminar, buscá "WhatsApp" en `frontend/src`.** En el informe va la lista de lo que quedó, con el motivo de cada uno.

---

## 3. El celular (segundo commit)

### 3.1 Qué es "celular"

**El mismo corte que usa el `Layout`:** debajo de `sm` (48em), con `useMediaQuery` de Mantine. **No se mira el navegador ni el sistema operativo.**

### 3.2 Qué se puede usar

En `lib/`, con pruebas FE desde FE-129, una función `permitidaEnCelular(ruta, permisos)` que dice si una ruta se usa en el celular:

| Ruta | En el celular |
| :--- | :--- |
| `/ingreso`, `/cambiar-password`, `/mi-cuenta` y `/notificaciones` | Sí |
| `/reportar` y `/mis-reportes` | Sí |
| `/intervenciones/:id` | Solo cuando se muestra el reporte del operario (`vistaDetalle` da `'operario'`). La vista completa, no. |
| `/tablero` y `/reportes` | Sí, para consultar |
| Todo lo demás | No |

**Una ruta que no se usa en el celular** muestra, en lugar de la pantalla, un aviso:
- **título:** "Esta sección se usa desde la computadora";
- **texto:** "En el celular podés reportar fallas y consultar el tablero y los reportes.";
- **botones:** a las secciones permitidas que el usuario tiene, por ejemplo "Reportar una falla", "Mis reportes", "Tablero" y "Reportes".

Si en el celular se agranda la ventana por encima del corte, la pantalla vuelve a aparecer sola.

**En el celular:**
- **el menú** muestra solo las secciones permitidas que el usuario tiene. En la computadora, el menú no cambia;
- **al entrar a `/`:** con `INTERVENCIONES_CREAR`, va a `/reportar`; si no, al tablero, si lo tiene, o a reportes. En la computadora, `destinoInicio` no cambia.

### 3.3 Pruebas FE

- **`permitidaEnCelular`,** con cada fila de la tabla, más:
  - una ruta con id;
  - una con parámetros (`/reportes?vista=costos`);
  - una que no existe.
- **El menú del celular,** para un operario, un responsable y un administrador.
- **El destino al entrar,** en el celular y en la computadora.

---

## 4. Documentos del proyecto (primer commit)

- **`docs/alcance.md`:** las funcionalidades con su estado, hecho o descartado. Lo descartado lleva su decisión: documentos y WhatsApp (D-027) y rutinas (D-024). Se suma "Calendario de preventivos" como pendiente y "Archivo para SAE" como pendiente, a la espera del formato.
- **`docs/plan-trabajo.md`:** al día con lo hecho, con la etapa en que se hizo, y con lo que falta del plan de cierre:
  1. recorrido de punta a punta;
  2. limpieza técnica;
  3. experiencia de uso;
  4. calendario;
  5. SAE;
  6. datos de demostración;
  7. publicación;
  8. prueba con la empresa;
  9. tesis.

  Lo de "Diseño en paralelo" se marca como cerrado: el estilo actual queda como definitivo.
- **`docs/relevamiento-requisitos-derivados.md`:** a la tabla de la sección 3 se le suma una columna "Estado", con la etapa o la decisión de cada requisito.

  El 5 queda "Hecho, salvo día fijo de la semana y condición: pendientes de decisión".

---

## 5. Cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 4 están hechas, en dos commits que compilan solos.
2. `test:front`, `typecheck` y `build:frontend` sin errores.
3. Push en `feat/base-neon`.

**Informe.** Las salidas van pegadas tal cual:

1. Los dos hashes.
2. Lo que quedó con "WhatsApp" en `frontend/src`, y por qué.
3. La salida final de `test:front`, con las FE nuevas.
4. Typecheck y build.
5. Desvíos y dudas.

**El recorrido en pantalla lo hace el revisor.**
