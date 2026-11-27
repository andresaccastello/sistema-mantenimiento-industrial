# Etapa F0 — Base del frontend

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `3be2839` (Etapa API.1).
> **Base:** `docs/front/mapa-pantallas.md` (secciones 1, 2, 3 y 5), decisiones D-009, D-010 y D-011.
> **Para qué:** dejar armado el esqueleto del frontend nuevo para que las etapas F1 a F5 solo agreguen pantallas. Incluye el tema, el menú, el ingreso, el cambio de contraseña, los avisos, "Mi cuenta", el manejo de errores y la tabla de estados.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. **No se toca el backend** ni ninguna prueba del backend: las 270 tienen que seguir pasando.
2. Solo las dependencias de la sección 1, en versión **exacta** (ya existe `.npmrc` con `save-exact=true`).
3. Seguir la documentación oficial de **Mantine 9** (mantine.dev) y de **React Router 7** en "modo declarativo" (`BrowserRouter`, `Routes`, `Route`). No usar APIs de versiones anteriores.
4. Ante cualquier duda o diferencia con el mapa de pantallas, **frenar y preguntar**.
5. Informe corto (sección 10).

Guardar este archivo como `docs/etapas/etapa-f0-base-frontend.md`.

---

## 1. Dependencias del frontend

En `frontend/package.json`:

| Paquete | Versión | Para qué |
| :--- | :--- | :--- |
| `@mantine/core`, `@mantine/hooks`, `@mantine/notifications`, `@mantine/form` | 9.7.4 | componentes, avisos emergentes y formularios |
| `@tabler/icons-react` | 3.50.0 | íconos |
| `react-router` | 7.18.5 | rutas |
| `@tanstack/react-query` | 5.105.0 | pedidos al backend, caché y actualización |
| `@fontsource-variable/inter` | 5.3.0 | tipografía Inter, sin CDN |
| `postcss`, `postcss-preset-mantine`, `postcss-simple-vars` (dev) | 8.5.32, 1.18.0, 7.0.1 | configuración que pide Mantine para Vite |

Agregar `frontend/postcss.config.cjs` según la guía de Mantine para Vite.

---

## 2. Estructura

```
frontend/src/
  main.tsx                 proveedores: Mantine, Notifications, QueryClient, BrowserRouter, Auth
  app/rutas.tsx            todas las rutas (sección 5)
  app/Layout.tsx           AppShell: barra superior, menú lateral, contenido
  app/RutaProtegida.tsx    exige sesión y, si corresponde, un permiso
  api/cliente.ts           cliente HTTP (sección 4)
  api/tipos.ts             tipos de las respuestas que se usan
  auth/AuthContext.tsx     sesión, usuario y permisos
  auth/sesion.ts           guardar y leer el token
  tema/tema.ts             createTheme (sección 3)
  lib/formato.ts           tiempos legibles
  lib/estados.ts           tabla única de estados
  lib/menu.ts              ítems del menú según permisos
  lib/inicio.ts            a dónde lleva "Inicio"
  lib/errores.ts           mensajes y clasificación por código
  lib/*.test.ts            pruebas de la sección 8
  componentes/             EncabezadoPagina, EstadoBadge, PantallaVacia, EnConstruccion,
                           SinPermiso, NoEncontrada, Campana
  pantallas/               Ingreso, CambiarPassword, Notificaciones, MiCuenta, Muestra
  dev-ui/                  sin cambios
```

**Regla:** lo que está en `lib/` es lógica pura, sin React y sin `fetch`, así se puede probar con `node:test`.

---

## 3. Tema (paleta de SolGest, D-010)

`createTheme` con:

- **Color primario:** `marca`, la escala `emerald` de 10 tonos:

  `#ecfdf5`, `#d1fae5`, `#a7f3d0`, `#6ee7b7`, `#34d399`, `#10b981`, `#059669`, `#047857`, `#065f46`, `#064e3b`

  Se configura con `primaryColor: 'marca'` y `primaryShade: 6`, que corresponde a `#059669`.
- **Tipografía:** `'Inter Variable', -apple-system, 'Segoe UI', Roboto, sans-serif`.
- **Bordes:** `defaultRadius: 'sm'` (4 px).
- **Tamaño de los controles:** el de Mantine por omisión (`sm`: 36 px de alto, texto de 14 px).
- **Fondo general** `#f8fafc`; tarjetas blancas con borde `rgba(0,0,0,0.08)`; texto `#0f172a`; texto secundario `#64748b`.
- **Solo modo claro** (`forceColorScheme="light"`). El modo oscuro queda para más adelante.

No se definen CSS globales que pisen los de Mantine, salvo el fondo del `body`.

---

## 4. Cliente de la API y sesión

### 4.1 `api/cliente.ts`

- URL base: `import.meta.env.VITE_API_URL`; si no está definida, `http://localhost:3000`. Crear `frontend/.env.example` con `VITE_API_URL`.
- Agrega `Authorization: Bearer <token>` cuando hay sesión.
- Si la respuesta no es 2xx, lanza un `ApiError` con `status`, `codigo`, `mensaje` (el campo `error`) y `motivos`, si vienen.
- Error de red (sin respuesta) → `ApiError` con `codigo` = `SIN_CONEXION`.
- Función `listar(path)` que devuelve `{ items, total }`; `total` sale del header `X-Total-Count`.
- **Reacción ante ciertos códigos** (la decide `lib/errores.ts`):
  - `NO_AUTENTICADO` o `SESION_INVALIDADA` → borra la sesión y lleva a `/ingreso` con el aviso "Tu sesión terminó. Volvé a ingresar."
  - `CAMBIO_PASSWORD_REQUERIDO` → lleva a `/cambiar-password`.
  - **Ojo:** `CREDENCIALES_INVALIDAS` también llega con 401 (ingreso con datos incorrectos o contraseña actual mal escrita al cambiarla), pero **no** cierra la sesión. Por eso la reacción depende del `codigo` y no del número 401.

### 4.2 Sesión (`auth/`)

- **El token se guarda en `sessionStorage`.** Las computadoras de planta pueden ser compartidas: al cerrar el navegador, la sesión se termina. Envolver la lectura y la escritura en `try/catch`.
- Al iniciar la aplicación, si hay token → `GET /api/auth/me`. Si falla, se borra la sesión.
- El contexto expone `usuario` (lo que devuelve `/me`, con `permisos` y `sectores`), `tienePermiso(codigo)`, `alcance(codigo)`, `ingresar`, `salir` y `recargarUsuario`.
- `salir` borra el token, limpia la caché de React Query y lleva a `/ingreso`.

### 4.3 React Query

- No reintenta ante errores 4xx; reintenta una vez ante `SIN_CONEXION` o 5xx.
- Los errores de acciones (mutaciones) se muestran con `@mantine/notifications`, usando el mensaje de `lib/errores.ts`.

---

## 5. Rutas y pantallas

### 5.1 Rutas

| Ruta | Pantalla | Exige | En F0 |
| :--- | :--- | :--- | :--- |
| `/ingreso` | C1 Ingreso | — (pública) | **completa** |
| `/cambiar-password` | C2 Cambio de contraseña | sesión | **completa** |
| `/` | Inicio | sesión | redirige según `lib/inicio.ts` |
| `/tablero` | R1 Tablero | `INTERVENCIONES_VER` | En construcción (F3) |
| `/mis-reportes` | O1 Inicio del operario | sesión | En construcción (F1) |
| `/reportar` | O2 Reportar falla | `INTERVENCIONES_CREAR` | En construcción (F1) |
| `/intervenciones` y `/intervenciones/:id` | R2, R3 y O3 | `INTERVENCIONES_VER` | En construcción (F2) |
| `/maquinas` y `/maquinas/:id` | R4, R5 | sesión | En construcción (F3) |
| `/reportes` | D1 | `REPORTES_CONSULTAR` | En construcción (F5) |
| `/usuarios` | A1 | `USUARIOS_GESTIONAR` | En construcción (F4) |
| `/sectores` | A3 | `MAQUINAS_GESTIONAR` | En construcción (F4) |
| `/notificaciones` | C3 Avisos | sesión | **completa** |
| `/mi-cuenta` | C4 Mi cuenta | sesión | **completa** |
| `/muestra` | Muestra de componentes | sesión; **solo en desarrollo** (`import.meta.env.DEV`) | **completa** |
| `/dev-ui/*` | interfaz provisional actual | **solo en desarrollo** | sin cambios, cargada con `lazy` |
| `*` | No encontrada | — | **completa** |

- **Sin sesión** → `/ingreso`, recordando la ruta pedida para volver a ella después de ingresar.
- **Con `debe_cambiar_password`** → cualquier ruta lleva a `/cambiar-password`.
- **Sin el permiso de la ruta** → la pantalla "Sin permiso" (dentro del layout), no un redireccionamiento.
- **"En construcción"** es una página con el encabezado y el texto "Esta pantalla se construye en la etapa F#", para poder probar la navegación desde ahora.

### 5.2 Layout (`AppShell` de Mantine)

**Barra superior de 56 px:**

- A la izquierda:
  - el botón de menú (solo en pantallas angostas);
  - el logo, si `tiene_logo` (`<img>` desde `/api/configuracion/logo`, 32 px de alto);
  - `nombre_sistema`, y debajo, más chico, `nombre_empresa` si hay.

  Los datos salen de `GET /api/configuracion/publica`.
- A la derecha:
  - la **campana** con el número de no leídas (`GET /api/notificaciones/contador`, cada 60 s y al volver a la pestaña); al hacer clic lleva a `/notificaciones`;
  - nombre y perfil del usuario, que llevan a `/mi-cuenta`;
  - el botón **"Salir"**, siempre visible (sección 9 del mapa).

**Menú lateral de 260 px:**

- Los ítems salen de `lib/menu.ts` (sección 5 del mapa), cada uno con su ícono de Tabler.
- El ítem activo queda resaltado.
- En pantallas de menos de 768 px se pliega detrás del botón de menú.

**Contenido:** fondo `#f8fafc`, con margen de 24 px. Cada pantalla empieza con `EncabezadoPagina` (título, subtítulo opcional y acciones a la derecha).

Durante el cambio obligatorio de contraseña **no se muestran el menú ni la campana**: solo la barra con "Salir".

### 5.3 C1 — Ingreso

- **Tarjeta centrada** con, de arriba abajo:
  - el logo y el nombre de la empresa, si están configurados;
  - el nombre del sistema;
  - **Legajo** y **Contraseña** (`PasswordInput`);
  - el botón **"Ingresar"**, el único primario.
- **Errores:** `CREDENCIALES_INVALIDAS` → "Legajo o contraseña incorrectos." debajo del formulario; otros códigos → el mensaje de `lib/errores.ts`.
- **Al ingresar:** si `debe_cambiar_password` → `/cambiar-password`; si no → la ruta recordada o `/`.

### 5.4 C2 — Cambio de contraseña

- **Campos:** contraseña actual, nueva y repetir la nueva.
- **Validación en pantalla:** la nueva tiene al menos 8 caracteres y las dos nuevas coinciden. El resto lo valida el servidor (`PASSWORD_INVALIDA`, que se muestra con su mensaje).
- **Contraseña actual incorrecta** (`CREDENCIALES_INVALIDAS`) → error en el campo "actual", **sin cerrar la sesión**.
- **Al terminar bien:**
  - si la respuesta trae `token`, reemplaza el guardado;
  - `recargarUsuario`;
  - aviso "Contraseña actualizada";
  - va a `/`.
- **Cambio obligatorio:** se muestra el texto "Por seguridad, tenés que cambiar la contraseña temporal antes de continuar."

### 5.5 C3 — Avisos (`/notificaciones`)

- **Lista** de `GET /api/notificaciones?limite=30`. Cada aviso muestra:
  - el título;
  - el mensaje;
  - "hace X", calculado con `lib/formato.ts`;
  - una marca "Alta" si `prioridad` es `ALTA`;
  - un estilo distinto si no está leído.
- **"Ver más":** pide la página siguiente con `antes_de` = el `id` del último aviso de la lista.
- **Interruptor "Solo no leídos"** → `solo_no_leidas=true`.
- **Al hacer clic en un aviso:**
  - lo marca como leído (`POST /:id/leer`);
  - si tiene `intervencion_id`, va a `/intervenciones/:id`.
- **Botón "Marcar todos como leídos"** → `POST /leer-todas`.
- **Después de cada acción** se actualizan la lista y el contador de la campana.
- **Sin avisos** → `PantallaVacia` con el texto "No tenés avisos."

### 5.6 C4 — Mi cuenta

- Nombre, legajo, perfil y sectores (como chips).
- Botón "Cambiar contraseña" → `/cambiar-password`.
- Botón "Salir".

### 5.7 Muestra de componentes (`/muestra`, solo en desarrollo)

Página para revisar el aspecto sin datos reales:

- los 9 `EstadoBadge` de la tabla de estados;
- botones (primario, secundario, peligro y deshabilitado);
- un formulario de ejemplo con campo de texto, select, fecha y textarea;
- una tabla de ejemplo con 5 filas;
- `PantallaVacia`;
- ejemplos de `formatDuracion` y `formatHace`;
- un aviso emergente de éxito y uno de error.

---

## 6. Tabla única de estados (`lib/estados.ts` y `EstadoBadge`)

| Entidad | Estado | Texto | Color Mantine | Ícono Tabler |
| :--- | :--- | :--- | :--- | :--- |
| intervención | `PENDIENTE` | Pendiente | `yellow` | `IconClock` |
| intervención | `EN_PROCESO` | En proceso | `blue` | `IconTool` |
| intervención | `EN_ESPERA_REPUESTOS` | Esperando repuestos | `violet` | `IconPackage` |
| intervención | `FINALIZADA` | Finalizada | `green` | `IconCircleCheck` |
| intervención | `CANCELADA` | Cancelada | `gray` | `IconCircleX` |
| máquina | `OPERATIVA` | Operativa | `green` | `IconCircleCheck` |
| máquina | `DETENIDA` | Detenida | `red` | `IconAlertTriangle` |
| máquina | `EN_MANTENIMIENTO` | En mantenimiento | `blue` | `IconTool` |
| máquina | `FUERA_DE_SERVICIO` | Fuera de servicio | `dark` | `IconBan` |

- En `lib/estados.ts` el ícono se guarda como **nombre** (texto, por ejemplo `'IconClock'`), para que ese archivo siga sin React. `EstadoBadge` traduce el nombre al componente de Tabler.
- `EstadoBadge` recibe `entidad` y `estado`, y muestra ícono y texto (variante `light`).
- Un estado desconocido muestra el código tal cual, en gris; no rompe la pantalla.

---

## 7. Lógica pura (`lib/`)

### 7.1 Formato de tiempos (`lib/formato.ts`)

**`formatDuracion(minutos)`**

| Entrada | Salida |
| :--- | :--- |
| `null` | "—" |
| `0` | "0 min" |
| menos de 60 | "N min" |
| menos de 24 h | "H h M min"; si M es 0, solo "H h" |
| 24 h o más | "D d H h"; si H es 0, solo "D d" |

**`formatHace(fechaISO, ahora)`**

| Diferencia | Salida |
| :--- | :--- |
| menos de 1 minuto, o fecha en el futuro | "recién" |
| cualquier otra | "hace " + `formatDuracion(diferencia)` |

### 7.2 Menú según permisos (`lib/menu.ts`)

**`itemsMenu(permisos)`** devuelve, en este orden, los ítems que corresponden:

| Ítem | Ruta | Se muestra si tiene |
| :--- | :--- | :--- |
| Inicio | `/` | siempre |
| Reportar falla | `/reportar` | `INTERVENCIONES_CREAR` |
| Intervenciones | `/intervenciones` | `INTERVENCIONES_VER` |
| Máquinas | `/maquinas` | siempre |
| Reportes | `/reportes` | `REPORTES_CONSULTAR` |
| Usuarios | `/usuarios` | `USUARIOS_GESTIONAR` |
| Sectores | `/sectores` | `MAQUINAS_GESTIONAR` |

### 7.3 Destino de "Inicio" (`lib/inicio.ts`)

**`destinoInicio(permisos)`:**

- si `INTERVENCIONES_VER` tiene alcance `TODAS` o `SECTORES` → `/tablero`;
- en cualquier otro caso → `/mis-reportes`.

### 7.4 Errores (`lib/errores.ts`)

**`mensajeError(apiError)`:** devuelve un texto para el usuario.

- Hay mensajes propios para `SIN_CONEXION` ("No se pudo conectar con el servidor."), `PERMISO_INSUFICIENTE`, `ESTADO_DESACTUALIZADO` ("Otra persona modificó esta intervención. Actualizá la pantalla.") y `ERROR_INTERNO`.
- Para el resto se usa el `mensaje` que manda el backend.

**`reaccionError(apiError)`:** devuelve qué hacer con el error.

| Código | Reacción |
| :--- | :--- |
| `NO_AUTENTICADO`, `SESION_INVALIDADA` | `'cerrar_sesion'` |
| `CAMBIO_PASSWORD_REQUERIDO` | `'cambiar_password'` |
| cualquier otro (incluido `CREDENCIALES_INVALIDAS`) | `'mostrar'` |

---

## 8. Pruebas

Las pruebas del frontend van en `frontend/src/lib/*.test.ts`, con `node:test`. Se agrega el script `test:front` en el `package.json` de la raíz: `tsx --test frontend/src/lib/*.test.ts`.

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| FE-01 | `formatDuracion` | `null` → "—"; 0 → "0 min"; 45 → "45 min"; 60 → "1 h"; 135 → "2 h 15 min"; 1440 → "1 d"; 1500 → "1 d 1 h"; 2880 → "2 d" |
| FE-02 | `formatHace` | 30 s antes → "recién"; fecha futura → "recién"; 80 min antes → "hace 1 h 20 min" |
| FE-03 | Tabla de estados | Están los 9 de la sección 6, cada uno con texto, color e ícono, y sin repetidos |
| FE-04 | `itemsMenu` con los permisos de cada perfil | **OPERARIO:** Inicio, Reportar falla, Intervenciones, Máquinas. **RESPONSABLE_MANTENIMIENTO** e **I_D:** los mismos más Reportes. **CONSULTA** y **DIRECCION:** Inicio, Intervenciones, Máquinas, Reportes. **ADMINISTRADOR:** los 7 ítems. |
| FE-05 | `destinoInicio` | `VER` con `PROPIAS` → `/mis-reportes`; con `SECTORES` o `TODAS` → `/tablero`; sin `VER` → `/mis-reportes` |
| FE-06 | `reaccionError` y `mensajeError` | `NO_AUTENTICADO` y `SESION_INVALIDADA` → `'cerrar_sesion'`; `CAMBIO_PASSWORD_REQUERIDO` → `'cambiar_password'`; `CREDENCIALES_INVALIDAS` → `'mostrar'`; `SIN_CONEXION` → su mensaje propio |

En FE-04, los permisos de cada perfil se escriben en la prueba copiando los de las migraciones; no se leen de la base.

---

## 9. Lo que voy a revisar yo

Voy a levantar el backend (`npm run dev:backend`) y el frontend (`npm run dev:frontend`), y a sacar capturas en **1440×900** y **390×844** de:

- el ingreso, con error y sin error;
- el cambio obligatorio de contraseña;
- el layout como operario, responsable, administrador y consulta (menú y destino de Inicio);
- los avisos con datos y vacíos;
- Mi cuenta;
- la muestra;
- "Sin permiso" (por ejemplo, un operario en `/reportes`);
- la página no encontrada;
- el cierre de sesión cuando el token deja de valer.

---

## 10. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 8 están hechas.
2. `npm run test:front` (FE-01 a FE-06) en verde.
3. `npm run typecheck` y `npm run build:frontend` sin errores.
4. `npm run test:todo -- etapa-f0` sigue en verde (270 pruebas); el log va en `docs/evidencia/`.
5. Commit y push en `feat/base-neon`.

**Informe corto:**

1. Hash del commit y rama.
2. La salida final de `test:front` y la línea de total de `test:todo`, copiadas de la consola o del log.
3. Typecheck y build.
4. Desvíos, incluido todo lo que no se haya hecho.
5. Dudas.
