# Sistema de Mantenimiento Industrial

Tesis de Analista en Sistemas: un sistema de mantenimiento industrial **general**. GI-RE S.A. es solo el caso de estudio: nada específico de esa empresa va en el código.

**Cómo se trabaja:**

- Cada etapa es un archivo de `docs/etapas/`. Implementás exactamente lo que pide.
- Un revisor verifica cada commit: corre las pruebas en su base, compara la huella de todas las tablas, saca capturas a 1440×900 y 390×844, y ataca la API. Lo que no cumple vuelve como corrección.

---

## Seguridad: no negociable

- **Base de datos:** solo la rama de pruebas de Neon que apunta el `.env`. **Nunca la base principal.**
- **El `.env`** no se modifica. Contraseñas, cadenas de conexión y secretos no se muestran ni se copian en ningún lado: código, commits, salidas ni informes.
- **Correo:**
  - las credenciales SMTP van solo en variables de entorno;
  - las pruebas corren con `EMAIL_TRANSPORTE=simulado`;
  - nunca se manda un email de verdad.
- **Datos reales, fuera del repo:** ni el logo de GI-RE ni nombres, clientes, proveedores o montos de la empresa. En las pruebas, nombres genéricos.
- **No subir código de SolGest:** es de un tercero.
- **Dependencias:** no se agregan, salvo que la etapa lo diga.
- **Migraciones:** solo las que pide la etapa. La base principal está en la 004: de la 005 en adelante se pueden editar.

---

## Una etapa, paso a paso

1. Leer el archivo de la etapa completo, y los documentos que cita.
2. Hacer lo pedido, sin agregar ni sacar nada, en la rama `feat/base-neon`. Los commits van con los mensajes y en el orden que dice la etapa. Push al terminar.
3. **Ante una duda:** de día, frenar y preguntar. Si la etapa dice que es de noche, seguir su regla 2.
4. **Pruebas existentes:** no se modifican, salvo las que la etapa autoriza con su ID.
5. **Qué pruebas correr:**
   - de día, solo las suites que nombra la etapa;
   - `npm run test:todo -- <etiqueta>`, solo cuando la etapa pide la corrida de la noche: una vez, y sin arreglar ni reintentar nada después.
6. **Cada prueba crea y borra sus propios datos.** No toca ni borra datos que no creó. `test:todo` controla 24 tablas y tienen que quedar en 0.
   Un archivo de pruebas que toma un cliente para todo el archivo lo declara con `let`, y su `finally` empieza con `client = await clienteSano(client)`.

---

## El informe

- **Las salidas se pegan tal cual, nunca resumidas ni de memoria:** pruebas, typecheck, build y `wc -l`.
- Los hashes de los commits.
- Los desvíos y las dudas.
- Lo que no se hizo o falló se dice. Un informe con un dato inventado obliga a revisar todo de nuevo.

---

## Técnica

**Stack:** Node 22, TypeScript, Hono, `pg` sin ORM, PostgreSQL en Neon (la rama de pruebas es la 18). React 19, React Router 7, Mantine 9 y TanStack Query 5.

**Backend:**

- El código está en `backend/functions/` y las pruebas, en `backend/tests/*.test.ts`. Cada prueba lleva su ID: RE-01, RI-05, M16-03, etcétera.
- Migraciones en `database/migrations/NNN_*.sql`:
  - se pueden aplicar varias veces;
  - no deshacen cambios posteriores: se reaplican en cada corrida de pruebas.
- Los errores van con `ErrorNegocio(status, codigo, mensaje, detalles)` y `responderError`. Un error de la base nunca debería salir como 500 si se puede prever: por ejemplo, un único repetido da 409.
- **Concurrencia:** nunca leer, decidir y escribir sin bloquear.
  - `SELECT … FOR UPDATE` en la fila que se cambia; `FOR SHARE` en la que se usa como referencia;
  - `LOCK TABLE … IN SHARE ROW EXCLUSIVE MODE` para los catálogos.
- **Respuestas:**
  - los `numeric` van como número;
  - las fechas sin hora, como `YYYY-MM-DD`, con `to_char`;
  - los ids y booleanos se validan con su tipo real: `"false"` no es `false`, y `true` no es un id.

**Frontend:**

- `frontend/src/lib/`: lógica pura, con pruebas FE-xx.
- Pantallas en `pantallas/`, de hasta 500 líneas. Diálogos y partes en `componentes/<área>/`.
- **Tipos de la API:** en `api/tipos.ts`, iguales a la respuesta real. `clienteApi.get<Tipo>(…)` siempre con su tipo, y nada de `any` para datos de la API.
- Las pruebas de contrato, como `api/contrato-*.test.ts`, copian respuestas reales: si el typecheck falla ahí, el error está en el tipo o en el componente, no en la prueba.
- Las consultas se invalidan por prefijo.
- Los textos de la interfaz, en castellano rioplatense: "Ingresá", "Cargá".

---

## Comandos

```bash
npm run typecheck
npm run build:frontend
npm run test:front
npm run test:<suite>          # ver "scripts" en package.json
npm run test:todo -- <etiqueta>   # solo para la corrida de la noche
```
