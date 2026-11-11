# Etapa N1.1 — Correcciones de los avisos por email

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `a0f0302` (Etapa N1b).
> **Origen:** revisión de la N1a y la N1b con el sistema levantado en mi base local.
>
> - Pruebas: `test:todo` en mi base y en una base como la principal, con 351 de 351 y los once números en 0.
> - Frontend: 134 de 134. Typecheck y build sin errores.
> - Recorrido con un servidor de correo local de verdad: `nodemailer` por SMTP, no el transporte simulado.

**Lo que funciona y no se toca:**

- **Recorrido completo:**
  - una falla crítica genera un envío por destinatario;
  - "Procesar ahora" manda el email a quien tiene email cargado y descarta al resto con "Sin email cargado";
  - el email llega con "[Urgente]" en el asunto, el enlace a la intervención y la firma;
  - una falla común no genera envíos.
- **Email de prueba:** llega bien, y con el correo caído muestra el error.
- **Correo caído:** el envío queda pendiente, con "Intento 1 de 5 falló. Reintenta en menos de 1 min.", y el error guardado no tiene la contraseña.
- **Apagar con pendientes:** pide confirmación y los descarta todos con "Canal desactivado".
- **Contacto:**
  - el email se guarda en minúsculas y el teléfono normalizado;
  - un teléfono inválido muestra el error en su campo;
  - el historial muestra "Email: — → …; WhatsApp: — → …";
  - Mi cuenta muestra los dos.
- **Permisos:** el Responsable no ve Configuración, ni entrando por la dirección.
- **Celular:** sin desborde de la página.
- **El vigía de `test:todo`:** con una suite que se cuelga a propósito, corta y termina con código 1.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias.
2. **Dos commits:**
   1. sección 1: `fix(test): una suite por proceso en la corrida completa`;
   2. secciones 2 a 6: `fix: detalles de los avisos por email`.
3. **No correr `test:todo`:** va en la corrida de la noche.
4. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-n1-1-correcciones.md`.

---

## 1. `test:todo`: una suite por proceso

Probé el vigía con una suite trabada después de una suite normal. Encontré tres problemas:

1. **Dice mal qué archivo se colgó.** Dijo "Último archivo: aa_normal.test.ts", que es la suite anterior. El reporte nombra cada prueba recién cuando termina, así que la que se cuelga nunca aparece.
2. **Se pierde el resto del grupo.** Al matar el proceso del grupo, no corren las suites que venían después, y el total queda mal: "1 pruebas, 0 correctas, 1 fallidas".
3. **Las canceladas no cuentan como fallidas.** Una prueba que queda esperando una promesa que nunca se cumple termina "cancelled". El resumen dijo "0 fallidas", aunque el código de salida fue 1.

Además, el aviso dice "20 minutos" aunque el límite sea otro.

**Corrección:**

- **Un proceso por archivo,** en el mismo orden de hoy: primero las migraciones y después las demás. El total suma lo de todos los archivos.
- **Si un archivo pasa el límite sin salida,** se mata solo ese proceso. El aviso queda así: `[test:todo] CORTADO: {n} minutos sin salida en <archivo exacto>`. La corrida sigue con el archivo siguiente.
- **Las pruebas `cancelled` cuentan como fallidas** en el total y en el código de salida.
- **Al final, si hubo fallas o cortes,** una línea por archivo con problema: `[test:todo] Con problemas: <archivo> (fallidas: n, canceladas: m, cortado: sí/no)`.
- Se mantienen `--test-timeout`, `--test-force-exit`, `EMAIL_TRANSPORTE=simulado` y `TEST_TODO_WATCHDOG_MS`.

**Verificación**, con suites temporales que **no se suben** y `TEST_TODO_WATCHDOG_MS=15000`:

| Caso | Esperado |
| :--- | :--- |
| Una suite normal, una que se cuelga con el proceso vivo (`setInterval` más una promesa que nunca se cumple) y otra normal después | Corta la segunda, nombrándola. Corre la tercera. Termina con código 1. |
| Una suite con una promesa que nunca se cumple, sin nada que mantenga vivo el proceso | Cuenta como fallida en el total. |

En el informe va la salida de los dos casos.

---

## 2. Tiempos máximos del correo

`nodemailer` usa por omisión hasta 10 minutos de espera por conexión. Mientras espera, el envío tiene su fila bloqueada, y el proceso se pasa del minuto de presupuesto.

**Corrección:** en `createTransport`, poner `connectionTimeout: 10000`, `greetingTimeout: 10000` y `socketTimeout: 30000`.

---

## 3. Migración 015: no quitar permisos al reaplicarla

Al final de la migración hay un `DELETE FROM perfil_permiso` que le saca `CONFIGURACION_GESTIONAR` a todo perfil que no sea ADMINISTRADOR. Si alguien después le da ese permiso a otro perfil, volver a aplicar la migración se lo quita. Las migraciones se reaplican en cada corrida de pruebas, y no pueden deshacer cambios posteriores.

**Corrección:**

- borrar ese `DELETE`. La migración todavía no está aplicada en la base principal, así que se puede editar;
- **M15-06 se amplía:** dentro de la transacción con `ROLLBACK`, darle el permiso a otro perfil, reaplicar la migración y verificar que lo conserva.

---

## 4. Las pruebas dejan cambiadas las fechas de la configuración

Después de `test:todo`, los modos de las reglas y el estado de los canales vuelven a su valor, pero `actualizado_en` queda con la hora de la corrida. A la mañana siguiente, la pantalla diría "Último cambio: hoy a las 3", sin nadie que lo haya hecho.

Además, N-16 apaga **todos** los canales al terminar, aunque antes estuvieran prendidos.

**Corrección:**

- en `avisos.test.ts` y en N-16, guardar y devolver también `actualizado_en` y `actualizado_por_usuario_id` de los canales y de las reglas que tocan;
- en N-16, devolver cada canal al estado `activo` que tenía al empezar;
- AV-14 compara también esas dos columnas.

Son los únicos cambios permitidos en pruebas existentes, junto con M15-06.

---

## 5. Email más largo que la columna

Un email de 255 caracteres da 500, porque la columna admite hasta 254.

**Corrección:**

- en la API, más de 254 caracteres: 422 `EMAIL_INVALIDO`;
- en el frontend, `validarEmail` también controla el largo;
- se amplían AV-13 y FE-40 con ese caso.

---

## 6. Ícono del menú

"Configuración" aparece en el menú con un signo de pregunta: `ICONOS_MENU`, en `app/Layout.tsx`, no tiene `IconSettings`.

**Corrección:** agregarlo.

---

## 7. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 a 6 están hechas, en dos commits.
2. En verde, en Neon: `test:migration-015`, `test:avisos`, `test:notificaciones` y `test:usuarios`.
3. `npm run test:front`, `npm run typecheck` y `npm run build:frontend` sin errores.
4. La verificación de la sección 1, hecha y **sin subir** las suites temporales.
5. **No correr `test:todo`:** va en la corrida de la noche.
6. Push en `feat/base-neon`.

**Informe corto:**

1. Los dos hashes.
2. La salida de los dos casos de la sección 1.
3. La salida final de las suites del punto 2 y de `test:front`.
4. Desvíos.
5. Dudas.
