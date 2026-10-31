# Etapa F0.1 — Correcciones de la base del frontend

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `669939f` (Etapa F0).
> **Origen:** revisión con el sistema levantado en local y capturas en 1440×900 y 390×844, como operario, responsable, administrador, consulta y usuario nuevo. Todo lo de abajo se vio en las capturas o se midió con el navegador.

---

## 0. Reglas de trabajo

Las de la Etapa F0 (sección 0). Solo se toca el frontend. No se agregan dependencias.

Guardar este archivo como `docs/etapas/etapa-f0-1-correcciones.md`.

---

## 1. En el celular, el botón "Salir" queda fuera de la pantalla (lo principal)

**Problema.** A 390 px de ancho, la barra superior no entra:

- el nombre y el perfil del usuario quedan cortados;
- el botón **"Salir" queda en x = 574**, fuera de la pantalla.

El menú desplegable tampoco ofrece "Salir" ni "Mi cuenta", así que **en el celular no hay forma de cerrar la sesión**. El mapa pide "Salir" siempre visible.

**Corrección.** En pantallas de menos de 768 px:

- **Barra superior:** queda el botón de menú, el logo (o el nombre del sistema, recortado con "…"), la campana y "Salir" como **botón de ícono**, con `aria-label="Salir"` y un tooltip. El nombre y el perfil del usuario se ocultan.
- **Menú desplegable:** al final, separados por una línea, se agregan "Mi cuenta" y "Salir".

En escritorio no cambia nada.

---

## 2. El aviso "Sesión finalizada" aparece duplicado

**Problema.** Cuando la sesión deja de valer, fallan a la vez dos pedidos (la campana y la pantalla) y se muestran **dos** avisos iguales.

**Corrección.** Mostrar el aviso con un `id` fijo (por ejemplo, `'sesion-finalizada'`) o con una marca que evite reaccionar dos veces. Tiene que verse un solo aviso.

---

## 3. El perfil se muestra con el código técnico

**Problema.** En la barra y en "Mi cuenta" aparece "RESPONSABLE_MANTENIMIENTO", "OPERARIO" o "ADMINISTRADOR".

**Corrección.** Nueva función pura `nombrePerfil(codigo)` en `lib/perfiles.ts`:

| Código | Texto |
| :--- | :--- |
| `ADMINISTRADOR` | Administrador |
| `RESPONSABLE_MANTENIMIENTO` | Responsable de mantenimiento |
| `OPERARIO` | Operario |
| `CONSULTA` | Consulta |
| `DIRECCION` | Dirección |
| `I_D` | I+D |

Cualquier otro código se muestra con los `_` reemplazados por espacios y solo la primera letra en mayúscula (por ejemplo, `JEFE_DE_PLANTA` → "Jefe de planta"). Así funciona también con perfiles nuevos que cree cada empresa.

---

## 4. "Inicio" no queda marcado en el menú

**Problema.** "Inicio" lleva a `/tablero` o a `/mis-reportes`, pero en esas pantallas ningún ítem del menú aparece resaltado.

**Corrección.** Nueva función pura `esRutaInicio(ruta, permisos)` en `lib/inicio.ts`. Devuelve `true` para `/` y para el destino que da `destinoInicio(permisos)`. El menú la usa para resaltar "Inicio".

---

## 5. Textos

| Dónde | Hoy | Cambio |
| :--- | :--- | :--- |
| Cambio de contraseña obligatorio | La frase "Por seguridad, tenés que cambiar…" aparece dos veces: como subtítulo y en el recuadro amarillo | Dejarla solo en el recuadro; el subtítulo se quita |
| "Sin permiso" | Muestra el código técnico, por ejemplo "(REPORTES_CONSULTAR)" | Quitar el código: "No tenés permiso para ver esta pantalla." |
| Ingreso, campo Legajo | Ejemplo "Ej: admin o número de legajo" | "Ej.: 1234" |

---

## 6. Pruebas

En `frontend/src/lib/`:

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| FE-07 | `nombrePerfil` | Los 6 códigos de la tabla de la sección 3; `JEFE_DE_PLANTA` → "Jefe de planta"; `null` o vacío → "" |
| FE-08 | `esRutaInicio` | Operario: `/` y `/mis-reportes` → `true`; `/tablero` → `false`. Responsable: `/` y `/tablero` → `true`; `/mis-reportes` → `false`. `/notificaciones` → `false` para los dos. |

---

## 7. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 6 están hechas.
2. `npm run test:front` en verde (FE-01 a FE-08), `npm run typecheck` y `npm run build:frontend` sin errores.
3. Commit y push en `feat/base-neon`. No hace falta correr `test:todo`, porque el backend no cambia.

**Informe corto:**

1. Hash del commit.
2. La salida final de `test:front`.
3. Typecheck y build.
4. Desvíos.
5. Dudas.

Lo reviso de nuevo con capturas en el celular.
