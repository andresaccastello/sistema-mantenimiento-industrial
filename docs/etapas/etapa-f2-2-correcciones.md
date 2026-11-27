# Etapa F2.2 — Correcciones de la F2.1

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `d056b8a` (Etapa F2.1, tercer commit).
> **Origen:** revisión de los tres commits de la F2.1 con el sistema levantado en local:
>
> - pruebas corridas sobre una base con datos de planta;
> - una "huella" de las 25 tablas antes y después de cada corrida, para ver toda fila borrada, agregada o cambiada;
> - el recorrido completo de acciones repetido en el navegador, mirando la base después de cada una.
>
> Todo lo de abajo se midió con el navegador o se comprobó en la base.

**Lo que funciona y no se toca:**

- **Limpiezas:** las pruebas ya no borran datos ajenos. En la huella de las 25 tablas no hubo ninguna fila borrada que no fuera de las pruebas.
- **Lista:**
  - la búsqueda conserva el espacio;
  - se puede filtrar un solo día;
  - la página fuera de rango se corrige sin dejar una entrada de más en el historial;
  - la columna Tiempo no se corta;
  - los filtros no se mueven, tienen nombre accesible y "Limpiar filtros" quedó en la línea del conteo;
  - en "Sin asignar", Estado queda deshabilitado en su lugar en vez de desaparecer. Está bien así.
- **Detalle:**
  - "Tomar" en dos pestañas del mismo responsable avisa "Ya sos el responsable de esta intervención." y actualiza la pantalla;
  - la barra de acciones queda siempre debajo del título, a 1440, 1100 y 390 px.
- **Separación de los diálogos:** las 13 acciones cambian la base igual que antes. Comparé todos los textos y pedidos de antes y después, y no se perdió ninguno.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias.
2. **Dos commits**, para revisarlos por separado:
   1. sección 1 (pruebas del backend y `scripts/run-all-tests.mjs`);
   2. sección 2 (pantallas).
3. El código de `backend/functions/` no cambia.
4. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-f2-2-correcciones.md`.

---

## 1. Pruebas que modifican datos que no crearon (primer commit)

### 1.1 Problema

La F2.1 corrigió los **borrados**. Pero al comparar todas las tablas antes y después de cada corrida aparecieron otros dos problemas:

- pruebas que **modifican** datos que no crearon;
- pruebas que dejan filas en tablas que el control no cuenta.

Para comprobarlo cargué una marca de prueba (nombre de empresa y logo) y un segundo administrador activo.

| Archivo | Qué hace | Qué pasó en mi base |
| :--- | :--- | :--- |
| `usuarios.test.ts`, U-09 | `UPDATE usuarios SET activo = FALSE WHERE perfil_id = <administrador> AND id != ADMIN001`. Al final reactiva solo a `ADMIN001`. | El segundo administrador quedó **desactivado** y ya no puede entrar. |
| `migration_012.test.ts`, M12-01.3 | Exige que `nombre_empresa`, `logo` y `logo_tipo` estén vacíos. | Con la marca cargada, la prueba **falla** y la corrida se corta en las migraciones: no corre ninguna prueba de negocio. |
| `migration_012.test.ts`, `finally` | Pone `nombre_empresa`, `logo` y `logo_tipo` en `NULL`. | **Borró** el nombre de la empresa y el logo. |
| `api_front.test.ts`, AF-12 | Exige que no haya logo. | Con la marca cargada, la prueba **falla**. |
| `api_front.test.ts`, AF-13 | Carga un PNG y al terminar pone el logo en `NULL`. | **Borró** el logo. |
| `migration_009.test.ts`, prueba 5 | Inserta en `auditoria_permisos` "ADMIN001 cambió su contraseña" y no la borra. | Cada corrida agrega un registro de auditoría **falso** sobre el administrador real. |
| `reapertura_eliminacion.test.ts`, E-06 | Usa el primer repuesto de la base. Si no hay ninguno, crea "Repuesto Test" y no lo borra. | Quedó "Repuesto Test". Con repuestos reales, la prueba usa uno de ellos. |

**Por qué el control de `test:todo` no lo vio:**

- cuenta filas, y un `UPDATE` no cambia la cantidad;
- no cuenta `auditoria_permisos` ni `repuestos`.

**Por qué importa ahora:** la marca se va a cargar al preparar la demo. La rama de pruebas de Neon es una copia de la base principal, así que, con estas pruebas como están, `test:todo` fallaría ahí y además borraría la marca de la rama.

### 1.2 Cambios

La regla de la F2.1 se amplía: **una prueba no borra ni modifica datos que no creó.** Si necesita cambiar algo que ya existía, como la configuración, guarda el valor antes de cambiarlo y lo restaura en un `finally`.

1. **U-09 (`usuarios.test.ts`):**
   - guardar los ids que desactiva, con `RETURNING id`;
   - en el `finally` de U-09, reactivar **exactamente esos** ids, además de `ADMIN001`.
2. **`migration_012.test.ts`:**
   - al empezar, guardar `nombre_sistema`, `nombre_empresa`, `logo` y `logo_tipo` de la fila 1;
   - en el `finally`, restaurar **esos valores**, no `NULL`;
   - M12-01.3 comprueba:
     - que la fila 1 existe;
     - que `nombre_sistema` es "Sistema de Mantenimiento Industrial";
     - que las columnas `nombre_empresa`, `logo` y `logo_tipo` no tienen valor por omisión (`column_default IS NULL` en `information_schema.columns`);
   - M12-01.3 deja de exigir que esas columnas estén vacías en la fila.
3. **AF-12 y AF-13 (`api_front.test.ts`):**
   - al empezar cada una, guardar `logo` y `logo_tipo` de la fila 1;
   - AF-12 pone el logo en `NULL` antes de probar el 404;
   - AF-13 carga su PNG;
   - al terminar cada una, en un `finally`, se restauran los valores guardados.
4. **Prueba 5 de `migration_009.test.ts`:** borrar por id la fila que inserta. El `INSERT` ya tiene `RETURNING id`.
5. **E-06 (`reapertura_eliminacion.test.ts`):**
   - crear siempre un repuesto propio, con un nombre único;
   - al final, borrarlo después de borrar sus filas de `intervencion_repuestos`;
   - no usar repuestos que ya estaban en la base.
6. **`scripts/run-all-tests.mjs`:** contar también `auditoria_permisos` y `repuestos`. La línea queda:
   `[test:todo] Datos que quedaron: usuarios 0, sectores 0, maquinas 0, intervenciones 0, usuario_permiso 0, notificaciones 0, auditoria_permisos 0, repuestos 0`
7. **Revisar las demás pruebas** con la regla ampliada. Lo que se encuentre y se corrija va en "Desvíos".

**Excepción aceptada:** las pruebas pueden seguir fijando la contraseña de `ADMIN001` a la del `.env` y dejarlo activo, porque la necesitan para entrar. No hace falta cambiarlo.

### 1.3 Cierre del primer commit

- `npm run test:todo -- etapa-f2-2-limpieza` en verde, con **274** pruebas y los **ocho** números en 0.
- **Correrlo dos veces seguidas**, sin tocar nada en el medio. El log que queda es el de la segunda.
- Mensaje del commit: `test: las pruebas no modifican datos que no crearon`.

Yo lo verifico en mi base con la marca cargada y un segundo administrador activo, comparando todas las tablas antes y después.

---

## 2. Pantallas (segundo commit)

### 2.1 "Confirmar que volvió a funcionar" no actualiza el detalle

**Problema.** Confirmé la recuperación desde el detalle de una intervención finalizada con la máquina detenida:

- el aviso salió bien y la base quedó bien;
- pero "Máquina detenida" y el botón "Confirmar que volvió a funcionar" siguieron en pantalla **59 segundos**, hasta el refresco automático.

Antes de separar los diálogos se actualizaba al instante.

**Causa.** `ModalConfirmarRecuperacion` llama a `useAccionIntervencion` sin `intervencionId`, y sin ese dato el hook no invalida ningún detalle. La sección 5 de la F2.1 pedía que no recibiera el detalle de la intervención, para poder usarlo desde la pantalla de máquina. No pedía que dejara de actualizarlo.

**Corrección.** En `useAccionIntervencion`, cuando no recibe `intervencionId`, invalida `['intervencion']`, es decir, **todos** los detalles. Vale tanto para el éxito como para el caso de `requiereRecargar`. Así sirve igual en la F3, donde una confirmación desde la máquina puede cerrar detenciones de varias intervenciones.

### 2.2 Eliminar sigue mostrando "No encontramos esta intervención"

**Problema.** Lo medí en tres eliminaciones:

- "No encontramos esta intervención." aparece unos 345 ms después de tocar "Eliminar" y dura unos 130 ms;
- en la consola sigue el 404.

**Causa.** El error fue mío: el orden que pedí en la F2.1 (3.2) no lo evita.

- React Router cambia de pantalla dentro de una transición (`startTransition`). Después de `navigate()`, el detalle sigue montado un instante mientras se dibuja la lista.
- Si en ese instante se quita la intervención del caché con `removeQueries`, el detalle la vuelve a pedir, recibe 404 y muestra "No encontramos esta intervención.".

**Corrección.** Quitar el detalle del caché recién cuando la pantalla de detalle se desmonta.

- **`ModalEliminar`** recibe una prop nueva, `onEliminada`. Al eliminar con éxito:
  1. llama a `onEliminada()`;
  2. llama a `onCerrar()`;
  3. navega a `destinoVolver`;
  4. invalida `['intervenciones']`, `['maquinas']` y `['notificaciones-contador']`;
  5. ya **no** llama a `removeQueries`.
- **`DetalleIntervencion`:**

```tsx
const eliminadaRef = useRef(false);
useEffect(() => () => {
  if (eliminadaRef.current) {
    eliminadaRef.current = false;
    queryClient.removeQueries({ queryKey: ['intervencion', idValido] });
  }
}, [idValido, queryClient]);
// ...
<ModalEliminar ... onEliminada={() => { eliminadaRef.current = true; }} />
```

Lo probé en mi copia, sin guardarlo. En tres eliminaciones:

- el texto no apareció ninguna vez;
- no hubo ningún pedido al detalle después de eliminar.

### 2.3 "Atrás" puede llevar a la página 1

**Problema.**

1. En "Abiertas", página 3, paso a la pestaña "Mías".
2. Más de 5 minutos después, toco "Atrás" en el navegador.
3. Vuelve a "Abiertas", pero a la **página 1**, no a la 3.

Lo reproduje así, con la espera real de 5 minutos y medio.

**Causa.**

- Pasados 5 minutos, la página 3 ya no está guardada en memoria y hay que pedirla de nuevo.
- Mientras llega, la consulta muestra los datos anteriores (`placeholderData: keepPreviousData`), que son los de "Mías", con 14 intervenciones.
- El efecto de la F2.1 (2.3) calcula `paginaValida(3, 14, 25)`, que da 1, y reescribe la dirección.

**Corrección.** Usar `isPlaceholderData` de la consulta y corregir la página solo con datos reales: `if (data && !isPlaceholderData && …)`. Agregarlo también a las dependencias del efecto.

### 2.4 Estado, con un valor elegido, ocupa dos líneas

**Problema.** Al elegir un estado, el texto de ejemplo "Estado" sigue visible debajo de la etiqueta del valor. El control pasa a dos líneas y queda más alto que los otros cuatro.

**Corrección.** Mostrar el texto de ejemplo solo si no hay estados elegidos: `placeholder={filtros.estados.length === 0 ? 'Estado' : undefined}`. El nombre accesible lo sigue dando `aria-label`.

---

## 3. Pruebas del frontend

No hay funciones puras nuevas: `test:front` sigue con FE-01 a FE-26. Las cuatro correcciones de la sección 2 las verifico en el navegador.

---

## 4. Lo que queda como está

- **"Sin asignar":** el filtro Estado queda deshabilitado en su lugar.
- **Diálogos:** ahora se cierran después de que llegan los datos nuevos, y no antes como en la F2. Es un cambio chico y mejor: no se ve un instante la pantalla vieja.
- **Clics muy rápidos en los filtros:** si se elige un filtro y se elige otro menos de 0,2 s después, el primero se puede perder. Lo vi con el navegador automático. Es difícil que le pase a una persona, así que por ahora queda anotado y no se corrige.

---

## 5. Criterios de cierre e informe

**Criterios de cierre:**

1. Las secciones 1 y 2 están hechas, en dos commits (regla 2).
2. `npm run test:front` en verde (87 pruebas).
3. `npm run test:todo -- etapa-f2-2`:
   - en verde, con **274** pruebas;
   - la línea de datos que quedaron con los **ocho** números en 0;
   - corrido **dos veces seguidas**;
   - el log de la segunda corrida va en `docs/evidencia/`.
4. `npm run typecheck` y `npm run build:frontend` sin errores.
5. Push de los dos commits en `feat/base-neon`.

**Informe corto:**

1. Los hashes de los dos commits.
2. Las salidas de las pruebas:
   - la salida final de `test:front`;
   - de las dos corridas de `test:todo`, la línea de total y la de datos que quedaron.
3. Typecheck y build, con el tamaño del JS.
4. Desvíos, incluido lo que se haya encontrado en el punto 1.2.7.
5. Dudas.
