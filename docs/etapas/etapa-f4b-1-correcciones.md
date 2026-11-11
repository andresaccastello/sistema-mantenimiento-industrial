# Etapa F4b.1 — Detalles de las pantallas de administración

> **Estado:** requerimiento para implementar.
> **Requisito previo:** commit `5edb5a9` (Etapa F4b).
> **Origen:** revisión de la F4b con el sistema levantado en mi base local.
>
> - Pruebas del backend: `test:todo` en mi base y en una base como la principal, con 329 de 329 y los once números en 0.
> - Pruebas del frontend: 122 de 122. Typecheck y build sin errores.
> - Capturas a 1440×900 y 390×844.

**Lo que funciona y no se toca:**

- **A1 Usuarios:**
  - los filtros se combinan bien, también con tildes ("ádmïn" encuentra a los administradores);
  - una dirección con valores inválidos muestra los activos;
  - "← Usuarios" vuelve con los filtros.
- **A2 Usuario, cada acción contra la base:**
  - el alta, con los errores de contraseña y de legajo repetido en su campo;
  - la edición manda solo lo que cambió;
  - excepciones: agregar, cambiar y quitar; el cambio vale en la sesión del usuario sin volver a entrar;
  - restablecer la contraseña cierra la sesión vieja;
  - el aviso de intervenciones abiertas al desactivar;
  - el historial, en el orden y con los textos correctos;
  - sobre uno mismo, sin botones.
- **Gestor por excepción:**
  - ve "Usuarios" y no "Sectores y catálogos";
  - solo le ofrece los alcances que tiene;
  - no tiene botones en los permisos que no tiene;
  - el perfil Administrador le aparece deshabilitado.
- **A3:**
  - las bajas bloqueadas muestran su texto y solo "Volver";
  - el nombre repetido va en su campo;
  - el código se sugiere bien;
  - marcar por omisión llega a "Nueva máquina" de R4.
- **A4:** las 150 celdas coinciden con `perfil_permiso`.
- **Celular:** sin desborde de la página; los diálogos, a pantalla completa.

---

## 0. Reglas de trabajo

1. Rama `feat/base-neon`. No se agregan dependencias.
2. **Un solo commit:** `fix(front): detalles de la administracion`.
3. Solo frontend. El backend y las pruebas del backend no cambian.
4. Ante cualquier duda, frenar y preguntar.

Guardar este archivo como `docs/etapas/etapa-f4b-1-correcciones.md`.

---

## 1. Correcciones

### 1.1 Subir y bajar no funcionan

`TabCatalogo` manda `{ orden: [...] }`, y la API espera `{ ids: [...] }`. Por eso responde 400 siempre, y el orden nunca cambia.

**Corrección:** mandar `{ ids: nuevoOrden }`.

### 1.2 El motivo viene escrito al cambiar una excepción

Al tocar "Cambiar", el campo "Motivo" trae el motivo anterior. Si se guarda así, el historial registra un cambio con el motivo de otro.

**Corrección:** al cambiar, el motivo empieza vacío, igual que al agregar.

### 1.3 Conteos de plantas desactualizados

Después de desactivar o reactivar un sector, la pestaña Plantas sigue mostrando el conteo viejo. Ejemplo: "Tiene 2 sectores activos", cuando ya era uno solo.

**Corrección:** al desactivar o reactivar un sector, invalidar también `['plantas']`. Hoy ya lo hace `ModalSector`.

### 1.4 Pestaña desconocida

`/sectores?pestana=otra` muestra las pestañas sin contenido.

**Corrección:** un valor desconocido se trata como "Sectores".

### 1.5 Detalles visuales

1. **Acciones en una sola línea.** En las tablas de A3, "Editar" y el botón del menú salen uno debajo del otro, y las filas quedan altas. Corrección: `wrap="nowrap"` en esos `Group`.
2. **Enlaces de los conteos.** En Sectores, los números salen azules y subrayados, como un enlace del navegador. Corrección: usar el mismo estilo que "Abiertas" en R4: `Text component={Link}`, sin subrayado.
3. **Márgenes de A3.** A3 está dentro de un `Container` con su propio margen, y queda corrida respecto de A1 y A4. Corrección: la misma estructura que A1, sin `Container`.
4. **"Más acciones" en A2.** Hoy es un botón con solo tres puntos. Corrección: el mismo botón que en R5, con el texto "Más acciones".
5. **Botón del menú en las filas de A3.** Agregarle `aria-label="Más acciones"`.

### 1.6 Avisos de React en la consola

"Each child in a list should have a unique key prop" aparece en A1, A2 y A4. Viene de los fragmentos `<>` dentro de un `map` en `BloquePermisosUsuario` y `Perfiles`.

**Corrección:** usar `<Fragment key={…}>`. Al terminar, la consola tiene que quedar sin avisos en las cuatro pantallas.

### 1.7 Punto doble en el historial

Un motivo que termina en punto queda "Motivo: Volvió el responsable..".

**Corrección:**

- en `textoAuditoria`, no agregar el punto final si el motivo ya termina en ".", "!" o "?";
- se amplía FE-36 con ese caso.

---

## 2. Criterios de cierre e informe

**Criterios de cierre:**

1. La sección 1 está hecha, en un commit.
2. `npm run test:front` en verde, con FE-36 ampliada.
3. `npm run typecheck` y `npm run build:frontend` sin errores.
4. Push en `feat/base-neon`.

**No hace falta `test:todo`:** esta etapa no toca el backend. Yo corro las pruebas completas en mis bases al revisar.

**Informe corto:**

1. El hash del commit.
2. La salida final de `test:front`.
3. Typecheck y build, con el tamaño del JS.
4. Desvíos.
5. Dudas.
