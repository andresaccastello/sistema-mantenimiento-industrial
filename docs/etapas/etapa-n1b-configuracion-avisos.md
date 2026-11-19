# Etapa N1b — Pantalla de Configuración y datos de contacto

> **Estado:** requerimiento para implementar.
> **Requisito previo:** la Etapa N1a terminada (`docs/etapas/etapa-n1a-avisos-email.md`).
> **Base:** la API de la N1a y las pantallas de la F4b (A1, A2 y `ModalUsuario`).
>
> **Para qué:** que el administrador configure los avisos por email desde el sistema y vea qué se envió, y que cada usuario tenga su email y su WhatsApp cargados.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`.
2. **Un solo commit:** `feat(front): configuracion de avisos y datos de contacto`.
3. **Solo frontend.** El backend y sus pruebas no cambian.
4. **No se agregan dependencias.**
5. Lo que está en `lib/` sigue siendo lógica pura, sin React y sin `fetch`.
6. **Tamaño de los archivos:** ninguna pantalla pasa de 500 líneas. Los bloques y diálogos de la pantalla nueva van en `componentes/configuracion/`.
7. **Las reglas las decide el backend.** El frontend muestra todo error de la API según su `codigo`.
8. **Esta etapa no corre `test:todo`:** va en la corrida de la noche.
9. Ante cualquier duda, **frenar y preguntar**.

Guardar este archivo como `docs/etapas/etapa-n1b-configuracion-avisos.md`.

---

## 1. Base

### 1.1 Tipos (`api/tipos.ts`)

- **Interfaces nuevas,** que coincidan exactamente con la sección 5.2 de la N1a:
  - `ModoAviso` (`'NUNCA' | 'SOLO_ALTA' | 'SIEMPRE'`);
  - `CanalAviso`, `ReglaAviso` y `ConfiguracionAvisos`;
  - `EnvioAviso` y `EnviosAvisos`.
- **Campos nuevos** `email` y `telefono_whatsapp`, de tipo `string | null`, en:
  - los tipos de la lista y el detalle de usuarios;
  - el `Usuario` de la sesión.

### 1.2 `ApiError` con los datos del error

Hoy `ApiError` pierde los campos extra de la respuesta, por ejemplo el `detalle` de `ENVIO_FALLIDO`.

**Corrección:**

- agregar `readonly datos?: Record<string, unknown>`, con el cuerpo completo de la respuesta de error;
- `cliente.ts` lo completa;
- lo demás no cambia.

### 1.3 Mensajes de error (`lib/errores.ts`)

| `codigo` | Mensaje | ¿Recarga? |
| :--- | :--- | :-: |
| `CANAL_NO_DISPONIBLE` | WhatsApp todavía no está disponible. | no |
| `CANAL_SIN_CONFIGURAR` | Falta configurar el servidor de correo. | sí |
| `CANAL_NO_ENCONTRADO` | Ese canal no existe. | sí |
| `SIN_EMAIL` | Cargá tu email en tu usuario para recibir la prueba. | no |
| `ENVIO_FALLIDO` | No se pudo enviar el email. | no |
| `EMAIL_INVALIDO` | El email no tiene un formato válido. | no |
| `TELEFONO_INVALIDO` | El número tiene que estar en formato internacional, por ejemplo +5491112345678. | no |

- `EMAIL_INVALIDO` y `TELEFONO_INVALIDO` se muestran en su campo.
- En `ENVIO_FALLIDO`, debajo del mensaje va `datos.detalle` en gris, porque es lo que ayuda a encontrar la causa.

---

## 2. Lógica pura nueva

### 2.1 `lib/avisos.ts`

**`TIPOS_AVISO`:** la lista de los 8 tipos, **en el mismo orden que** `REGLAS_EVENTOS_NOTIFICACION` del backend. Cada uno con su nombre y a quién le llega:

| `tipo_evento` | Nombre | A quién le llega |
| :--- | :--- | :--- |
| `FALLA_REGISTRADA` | Falla reportada | A quienes reciben avisos de fallas, según sus sectores. Es de prioridad alta si la máquina quedó detenida o si su criticidad es de prioridad alta. |
| `INTERVENCION_ASIGNADA` | Trabajo asignado | A quien queda como responsable. |
| `INTERVENCION_REASIGNADA` | Trabajo reasignado | Al nuevo responsable y al anterior. |
| `INTERVENCION_DESASIGNADA` | Responsable quitado | A quien deja de ser responsable. |
| `INTERVENCION_FINALIZADA` | Intervención finalizada | A quien reportó la falla y al responsable. |
| `INTERVENCION_CANCELADA` | Intervención cancelada | A quien reportó la falla y al responsable. |
| `INTERVENCION_REABIERTA` | Intervención reabierta | A quien reportó la falla y al responsable. |
| `DETENCION_PENDIENTE_CONFIRMACION` | Máquina para confirmar | A quienes confirman que una máquina volvió a producir. Siempre es de prioridad alta. |

**Otras funciones:**

| Función | Qué hace |
| :--- | :--- |
| `nombreTipoAviso(tipo)` | El nombre de la tabla; si no está, el código tal cual. |
| `etiquetaModo(modo)` | `NUNCA` → "Nunca"; `SOLO_ALTA` → "Solo prioridad alta"; `SIEMPRE` → "Siempre". |
| `estadoEnvio(estado)` | `{ etiqueta, color }`:<br>• `PENDIENTE` → "Pendiente", amarillo;<br>• `ENVIADO` → "Enviado", `marca`;<br>• `ERROR` → "Con error", rojo;<br>• `DESCARTADO` → "Descartado", gris. |
| `detalleEnvio(envio, ahora)` | El texto en gris debajo del estado:<br>• `PENDIENTE` con `proximo_intento_en`: "Intento {intentos} de 5 falló. Reintenta {formatHace del futuro, por ejemplo 'en 4 min'}.";<br>• `PENDIENTE` sin intentos: "Sale en el próximo minuto.";<br>• `ERROR` o `DESCARTADO`: el `ultimo_error`;<br>• `ENVIADO`: "Enviado a {destino}". |

Si `formatHace` no maneja fechas futuras, se agrega a `lib/formato.ts` una variante `formatDentroDe`, con su prueba.

### 2.2 `lib/contacto.ts`

| Función | Qué hace |
| :--- | :--- |
| `normalizarEmail(texto)` | Recorta los espacios y pasa a minúsculas. Vacío → `null`. |
| `validarEmail(email)` | El texto de `EMAIL_INVALIDO`, o `null`. Mismo patrón que la base: `^[^@\s]+@[^@\s]+\.[^@\s]+$`. `null` es válido. |
| `normalizarTelefono(texto)` | Saca espacios, guiones, puntos y paréntesis. Un "00" inicial pasa a "+". Vacío → `null`. |
| `validarTelefono(tel)` | El texto de `TELEFONO_INVALIDO`, o `null`. Mismo patrón que la base: `^\+[1-9][0-9]{7,14}$`. `null` es válido. |

### 2.3 Cambios en `lib/` existentes

1. **`textoAuditoria`, `USUARIO_MODIFICADO`:**
   - si `anterior` tiene la clave `email`, el registro es nuevo y lleva los cuatro campos. El detalle lista solo lo que cambió, separado por "; ": "Nombre: {anterior} → {nuevo}", "Email: {anterior o '—'} → {nuevo o '—'}" y "WhatsApp: …";
   - si no la tiene, queda como hoy.
2. **`grupoPermiso`:** el prefijo `CONFIGURACION_` va al grupo nuevo "Configuración", después de "Usuarios y permisos".
3. **`filtrarUsuarios`:** el texto también busca en el email.
4. **Menú (`lib/menu.ts`):** el ítem "Configuración" va último, con `CONFIGURACION_GESTIONAR`, y lleva a `/configuracion`.

---

## 3. Pantalla Configuración (`/configuracion`)

- **Ruta protegida** con `CONFIGURACION_GESTIONAR`.
- **Título:** "Configuración". Debajo, el bloque "Avisos por email y WhatsApp" con sus tres partes. Más adelante se van a sumar otros bloques en la misma pantalla.
- **Consultas:**
  - `GET /api/configuracion/avisos`, clave `['configuracion', 'avisos']`;
  - `GET /api/configuracion/avisos/envios?limit={n}&estado={e}`, clave `['configuracion', 'avisos', 'envios', n, e]`;
  - las dos se actualizan solas cada 30 segundos mientras la pantalla está abierta (`refetchInterval`).
- **Línea en gris debajo del título del bloque:** "La campana del sistema avisa siempre. Acá se elige qué avisos, además, salen por email o WhatsApp."

### 3.1 Canales

Dos tarjetas lado a lado, que en celular quedan una debajo de la otra.

**Email:**

- **Si `configurado`:**
  - "Envía desde {remitente}";
  - un `Switch` "Activo";
  - el botón "Enviar prueba".
- **Si no:**
  - un `Alert` amarillo: "Falta configurar el servidor de correo. Lo hace quien instala el sistema (ver `docs/desarrollo-local.md`).";
  - el `Switch` deshabilitado.
- **Apagar con envíos pendientes:** si `pendientes` es mayor que 0, se confirma antes: "Hay {n} email(s) por salir. Si apagás el canal, se descartan."
- **"Enviar prueba":**
  - manda `POST /prueba` con `{ "canal": "EMAIL" }`;
  - **si la sesión no tiene email,** el botón queda deshabilitado, con un `Tooltip`: "Cargá tu email en tu usuario para recibir la prueba.";
  - **si sale bien,** el aviso: "Email de prueba enviado a {enviado_a}. Revisá también la carpeta de spam.";
  - **si falla (`ENVIO_FALLIDO`),** un `Alert` rojo dentro de la tarjeta, con el mensaje y el `detalle`.
- **Abajo, en gris:** "Último cambio: {fecha} por {nombre}", si hay.

**WhatsApp:**

- distintivo "Próximamente";
- texto: "Se puede dejar preparado: cargá el número de cada usuario y elegí qué avisos van a salir.";
- `Switch` deshabilitado.

### 3.2 Qué se envía

| Columna | Contenido |
| :--- | :--- |
| Aviso | El nombre y, debajo, a quién le llega, en gris (`TIPOS_AVISO`). |
| Email | `Select` con "Nunca", "Solo prioridad alta" y "Siempre". |
| WhatsApp | Lo mismo. Se puede cambiar, para dejarlo preparado. |

- **Guardar:** cada cambio manda `PUT /reglas` en el momento.
  - Mientras se guarda, ese `Select` queda deshabilitado.
  - Si sale bien, el aviso "Guardado.".
  - Si falla, el `Select` vuelve al valor anterior.
- **Debajo de la tabla, en gris:** "'Solo prioridad alta' manda las fallas de máquinas detenidas o de criticidad con prioridad alta, y las máquinas para confirmar."

### 3.3 Últimos envíos

- **Encabezado:**
  - "{pendientes} por salir";
  - el botón "Procesar ahora" (`POST /procesar`). Al terminar, el aviso "Procesados: {procesados}. Enviados: {enviados}." y se actualiza la lista.
- **Filtro "Estado":** Todos, Pendientes, Enviados, Con error, Descartados.

| Columna | Contenido |
| :--- | :--- |
| Fecha | `formatFechaHora(creado_en)` |
| Para | `nombreCompleto` y, debajo, el destino en gris. Si no hay destino, nada. |
| Aviso | El título. Debajo, `nombreTipoAviso` en gris. Si tiene intervención, el título es un enlace a ella. |
| Estado | El distintivo de `estadoEnvio` y, debajo, `detalleEnvio`. |

- **Paginado:** empieza con 20. "Ver más" suma 20, hasta 100.
- **Sin envíos:** "Todavía no se envió nada."

---

## 4. Usuarios

1. **`ModalUsuario`, en el alta y en la edición:**
   - dos campos opcionales, "Email" y "WhatsApp";
   - debajo de WhatsApp: "Con código de país, por ejemplo +54 9 11 1234-5678.";
   - antes de enviar, se normalizan con `normalizarEmail` y `normalizarTelefono`, y se validan con `validarEmail` y `validarTelefono`;
   - en la edición, se mandan solo si cambiaron, como el resto.
2. **A2, bloque "Datos":** "Email" y "WhatsApp", o "—" si no hay.
3. **Mi cuenta:**
   - "Email" y "WhatsApp" de la sesión, solo para leer;
   - debajo, en gris: "Para cambiarlos, pedíselo a un administrador.".

---

## 5. Pruebas del frontend

| ID | Qué prueba | Esperado |
| :-: | :--- | :--- |
| FE-39 | `lib/avisos.ts` | **Orden de `TIPOS_AVISO`:** los 8 códigos, en el orden de la tabla 2.1. La prueba lleva la lista escrita y un comentario que dice que tiene que coincidir con `REGLAS_EVENTOS_NOTIFICACION`.<br>**Etiquetas:** `nombreTipoAviso` de uno conocido y de uno desconocido; las tres de `etiquetaModo`; los cuatro estados de `estadoEnvio`.<br>**`detalleEnvio`:** los cuatro casos de la tabla, con un `ahora` fijo. |
| FE-40 | `lib/contacto.ts` | **`normalizarEmail`:** "  Ana@Empresa.COM " → "ana@empresa.com"; "" → `null`.<br>**`validarEmail`:** "ana@empresa" y "a b@c.com" dan error; `null` es válido.<br>**`normalizarTelefono`:** "+54 9 (11) 1234-5678" → "+5491112345678"; "0054 11 1234 5678" → "+541112345678"; "" → `null`.<br>**`validarTelefono`:** "5491112345678", sin el "+", da error; "+12" da error; "+5491112345678" es válido. |
| FE-36 (se amplía) | `textoAuditoria` | Un `USUARIO_MODIFICADO` nuevo, con solo el email cambiado: "Email: — → ana@empresa.com". Uno con nombre y WhatsApp cambiados: los dos, separados por "; ". Uno viejo, con dos campos: como hoy. |
| FE-34 (se amplía) | `grupoPermiso` | `CONFIGURACION_GESTIONAR` → "Configuración", en su lugar del orden. |
| FE-32 (se amplía) | `filtrarUsuarios` | El texto encuentra por email. |
| FE-04 (se amplía) | Menú | "Configuración" aparece con `CONFIGURACION_GESTIONAR` y no aparece sin ese permiso. |
| FE-formato | `formatDentroDe` | Solo si se agrega (sección 2.1): 30 segundos, 4 minutos y 2 horas. |

---

## 6. Lo que voy a revisar yo

Con el backend en `EMAIL_TRANSPORTE=simulado`, contra mi base local. Capturas a 1440×900 y 390×844. El envío real con Gmail lo prueba el usuario en su máquina, con su contraseña de aplicación.

- **Canales:**
  - correo sin configurar;
  - prender y apagar, también con pendientes;
  - la prueba, con y sin email propio;
  - el error de envío con su detalle.
- **Reglas:** cada cambio contra `notificacion_reglas`, y que vuelva al valor anterior si falla.
- **Últimos envíos:**
  - que coincida con `notificacion_envios`;
  - cada estado con su texto;
  - "Procesar ahora";
  - la actualización sola cada 30 segundos.
- **Recorrido completo:**
  - una falla crítica llega por email a quien tiene email cargado;
  - una común no llega, con el modo `SOLO_ALTA`;
  - una asignación sí llega.
- **Usuarios:**
  - email y WhatsApp en el alta y la edición, con los errores en su campo;
  - el historial con el cambio de email;
  - Mi cuenta.
- **Permisos:** "Configuración" solo para el administrador; un gestor de usuarios no la ve.
- **Celular:** sin desborde de la página.

---

## 7. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 5 están hechas, en un commit.
2. `npm run test:front` en verde, con FE-39 y FE-40 nuevas y las ampliadas.
3. `npm run typecheck` y `npm run build:frontend` sin errores.
4. **No correr `test:todo`:** va en la corrida de la noche.
5. Push en `feat/base-neon`.

**Informe corto:**

1. El hash del commit.
2. La salida final de `test:front`.
3. Typecheck y build, con el tamaño del JS.
4. El tamaño en líneas de la pantalla nueva.
5. Desvíos.
6. Dudas.
