# Etapa GR1 — Gráficos en Reportes

> **Estado:** requerimiento para implementar. Etapa de día.
> **Requisito previo:** el commit `7dfe1b3`.
> **Origen:**
> - **el profesor:** los reportes tienen que tener gráficos, y hoy el sistema se usa mucho desde el teléfono;
> - **Andrés, el 26/11:** lo aprobó todo, también los gráficos en el celular.

**La idea en una línea:** cada pestaña de Reportes suma un gráfico arriba de su tabla, y hay un pedido nuevo para ver la **evolución por mes o por semana**, que es lo que hoy no se puede ver.

**Qué entra:**

| Pestaña | Gráfico | Tipo | Datos |
| :--- | :--- | :--- | :--- |
| Indicadores | Evolución: fallas y preventivas hechas (barras), disponibilidad % (línea) | Barras con línea, eje doble | **Nuevo:** `/reportes/evolucion` |
| Indicadores | Inactividad correctiva contra preventiva | Una barra apilada al 100 % | `/indicadores` |
| Inactividad | Las 10 máquinas con más horas paradas | Barras horizontales | `/inactividad` |
| Tiempos | Promedio de espera, trabajo y total por grupo | Barras agrupadas | `/tiempos` |
| Repuestos | Los 10 repuestos con más importe usado | Barras horizontales | `/repuestos` |
| Preventivos | Cumplimiento por plan | Barras horizontales de 0 a 100 % | `/preventivos` |
| Costos | Costo por período, partido por tipo | Barras apiladas | **Nuevo:** `/reportes/evolucion` |
| Costos | Las 10 máquinas que más costaron | Barras horizontales | `/costos` |
| Rutinas y Compras | Sin cambios: Rutinas ya tiene su grilla y Compras queda con su tabla | — | — |

**En el celular:** el resumen de Reportes (`ResumenCelular`) suma dos gráficos chicos, la evolución y las 5 máquinas con más horas paradas. Con el modo simple apagado, las pestañas muestran sus gráficos adaptados al ancho.

**Qué no entra:**
- exportar los gráficos como imagen;
- los gráficos en el tablero o en la ficha de la máquina.

---

## 0. Reglas de trabajo

1. **Leé `CLAUDE.md` entero y seguí sus reglas.**
   - **Nunca abras, leas, muestres ni modifiques `.env`.**
   - Rama `feat/base-neon`.
2. **Dependencias:** esta etapa **autoriza** dos, y nada más:
   - **`@mantine/charts`,** en la misma versión exacta que `@mantine/core` (hoy `9.7.4`);
   - **`recharts`,** en la versión que `@mantine/charts 9.7.4` declara como dependencia par.

   Las dos van en `frontend/package.json`, con versión exacta, sin `^`. Si `@mantine/charts 9.7.4` no existe o pide otra cosa, **frená y avisá.**
3. **Tres commits.** Cada uno tiene que pasar `npm run typecheck` solo:

   | N.º | Secciones | Mensaje |
   | :-: | :--- | :--- |
   | 1 | 1, 2 y 5.1 | `feat(api): evolución por período en reportes` |
   | 2 | 3 | `feat(front): componentes de gráficos` |
   | 3 | 4 y 5.2 | `feat(front): gráficos en reportes y en el resumen del celular` |

4. **Pruebas:**
   - **en Neon:** `test:reportes-evolucion` (nueva, `backend/tests/reportes_evolucion.test.ts`, con IDs EV-xx), además de `test:reportes`, `test:costos`, `test:tiempos` y `test:reportes-preventivos`;
   - **además:** `test:front`, `typecheck` y `build:frontend`;
   - **no correr `test:todo`.**
5. **El bundle:**
   - las librerías de gráficos van en un grupo propio (`charts`) en `codeSplitting.groups` de `vite.config.ts`;
   - **se cargan solo al abrir Reportes.** La pantalla de entrada no puede crecer: pegá en el informe el `index-*.js` antes y después.
6. **Ante cualquier duda, frenar y preguntar.**
7. **Los números:** la decisión y las FE son las siguientes libres. Esta etapa no lleva migración.

Guardar este archivo como `docs/etapas/etapa-gr1-graficos-en-reportes.md`.

---

## 1. `GET /api/reportes/evolucion` (primer commit)

**Parámetros:**
- `desde`, `hasta`, `planta_id` y `sector_id`, con la misma validación, el mismo alcance (`REPORTES_CONSULTAR`) y los mismos errores que `/indicadores`;
- `agrupar`, opcional: `mes` o `semana`.
  - Si no viene: `semana` si el intervalo es de 92 días o menos, y `mes` si es más largo;
  - otro valor da 422.
- **Como mucho 60 períodos.** Si son más, 422 `DATOS_INVALIDOS`, con el mensaje "Acortá el período o agrupá por mes".

**Los períodos:**
- **Las semanas van de lunes a domingo, y los meses son calendario,** según la fecha local de la instalación (`hoy_instalacion()` y la zona que ya usan los reportes).
- **El primero y el último se recortan** a `desde` y `hasta`.
- **Un período sin datos aparece igual,** con ceros. No se saltean.

**La respuesta:**

```jsonc
{
  "desde": "2026-09-01", "hasta": "2026-11-30", "agrupar": "mes",
  "periodos": [
    {
      "inicio": "2026-09-01", "fin": "2026-09-30",
      "fallas": 7,
      "correctivas_finalizadas": 6,
      "preventivas_finalizadas": 4,
      "inactividad_minutos": 1320,
      "disponibilidad": 97.4,          // o null, como en /indicadores
      "costo": {                        // null sin COSTOS_VER
        "repuestos": 120000, "mano_obra": 85000, "servicio_externo": 0,
        "transporte": 0, "otro": 5000, "ajuste": 0, "total": 210000
      }
    }
  ]
}
```

**La regla que no se negocia: es la misma cuenta que los reportes que ya existen, partida en períodos.**
- **Fallas, finalizadas, inactividad y disponibilidad** usan **exactamente** los mismos criterios de fecha, estado, alcance y máquinas que `/indicadores`. La inactividad usa la misma función SQL de unión de intervalos, recortada a cada período.
- **El costo** usa el mismo criterio de fecha y los mismos tipos que `/costos`.
- **La forma recomendada de cumplirla:** sacar las cuentas de `/indicadores` y `/costos` a funciones que reciban `desde` y `hasta`, y llamarlas desde los tres lugares. Si no lo hacés así, explicá en el informe cómo garantizás que coinciden.
- **Las pruebas EV-03 y EV-04 comparan la suma de los períodos contra el total del reporte de siempre.**

## 2. La decisión (primer commit)

**D-0xx — Gráficos en reportes.**

1. **Cada pestaña de Reportes muestra un gráfico arriba de su tabla.** La tabla sigue: es el detalle y la forma accesible de leer los mismos números.
2. **La evolución por período sale de un pedido propio,** con las mismas cuentas que los totales.
3. **Se usa `@mantine/charts`,** que dibuja con Recharts: toma el tema del sistema (claro, oscuro y los colores de marca) y se carga solo en Reportes.
4. **En el celular hay gráficos chicos en el resumen,** porque hoy el sistema se usa mucho desde el teléfono.

**Motivo:** el pedido del profesor. Además, los números sueltos no muestran tendencias ni comparaciones; un gráfico sí.

---

## 3. Los componentes de gráficos (segundo commit)

**Van en `componentes/graficos/`,** y cada uno recibe datos ya armados:
- **`GraficoEvolucion`:** barras con línea y eje doble (cantidades a la izquierda, porcentaje a la derecha);
- **`GraficoRanking`:** barras horizontales, con la etiqueta de la máquina o el repuesto a la izquierda y el valor formateado al final de cada barra;
- **`GraficoApilado`:** barras apiladas por período, con leyenda;
- **`GraficoProporcion`:** una sola barra al 100 %, partida en dos o tres, con su leyenda.

**Lo que tienen todos:**
- **El título adentro de la tarjeta, que dice la conclusión,** no el nombre del dato.
  - **El título lo arma el componente que llama, desde `lib`.**
  - **Ejemplo:** "Las fallas bajaron de 7 a 3 por mes" o "COM-01 concentra el 40 % de las horas paradas".
  - **Si no hay una conclusión clara,** va un título descriptivo.
- **Un tooltip** con los números formateados en castellano: miles con punto, `$` en los costos, horas y minutos como en el resto del sistema.
- **Sin datos** (todo en cero o la lista vacía): en lugar del gráfico vacío, "Sin datos en el período".
- **Mientras carga,** un `Skeleton` del mismo alto.
- **El alto:** 280 px en la computadora y 220 px en el celular, con el ancho siempre al 100 %.
- **Accesibilidad:** el color nunca es la única forma de distinguir. Hay leyenda y tooltip, y la tabla de abajo tiene los mismos números.

**Los colores van en `tema.ts`, en claro y en oscuro:**
- **Los de cada serie:** `--sm-graf-1` a `--sm-graf-5`.
  - **El 1 es el verde de marca;** el resto, tonos que se distingan entre sí y con contraste en los dos modos.
  - **Cada tipo de costo tiene siempre el mismo color** en todas las pantallas: repuestos el 1, mano de obra el 2, servicio externo el 3, y los otros juntos el 4.
- **El de la línea de disponibilidad:** `--sm-graf-linea`.
- **Las grillas y los ejes:** con `--sm-linea` y `--sm-tenue`.
- **Ningún color escrito a mano** fuera de `tema.ts`.

**Funciones puras en `lib/graficos.ts`, con pruebas FE:**
- **el top N con "Otras":** las primeras N y la suma del resto en una barra "Otras", que no aparece si el resto es 0;
- **la etiqueta de cada período:**
  - por mes, "sep 26";
  - por semana, "23/11", con el lunes;
- **las conclusiones para el título,** con un umbral claro y probado:
  - **la evolución:** compara el primer período completo con el último completo; si la diferencia es menor al 10 %, dice "estable";
  - **el ranking:** el porcentaje que concentra el primero;
- **el formato de los valores de cada eje y de cada tooltip.**

## 4. Los gráficos en cada pestaña y en el celular (tercer commit)

**Las pestañas:**
- **Cada una pone su gráfico (o sus dos gráficos) arriba de la tabla que ya tiene,** sin sacar nada.
- **Con dos gráficos,** van lado a lado a 1440 px y uno debajo del otro en el celular.

**Las particularidades:**
- **Indicadores:** la evolución usa `/reportes/evolucion` con los filtros de la pantalla.
- **Costos:** los dos gráficos solo con `COSTOS_VER`, como la pestaña. El apilado usa los tipos `repuestos`, `mano_obra`, `servicio_externo` y "otros" (transporte, otro y ajuste juntos). **Un ajuste negativo no se dibuja como barra negativa:** va sumado a "otros", y si eso deja "otros" en negativo, se muestra 0 y el tooltip lo aclara.
- **Tiempos:** el gráfico respeta el `agrupar` elegido en la pestaña.
- **Ranking en el celular:** top 5 en lugar de top 10.

**`ResumenCelular`, el modo simple:**
- **Suma, debajo de lo que ya muestra:**
  - la evolución por semana de las fallas, con barras solas y sin el eje doble, para que se lea en 390 px;
  - las 5 máquinas con más horas paradas.
- **Usa el período que ya elige el resumen** (7 días, 30 días o este mes).
- **Con 7 días agrupa por semana,** y entonces el gráfico de evolución tiene una sola barra. En ese caso se reemplaza por el texto "Elegí 30 días para ver la evolución".

**Las reglas de pantalla:**
- **modo claro y modo oscuro,** solo con variables `--sm-*`;
- **a 390 px, nada se sale de costado.** Los ejes se achican o rotan las etiquetas, y nunca hay scroll horizontal en la página.

## 5. Pruebas

### 5.1 `test:reportes-evolucion` (EV)

**Cómo se arma:**
- los datos se crean con fechas fijas pasadas (corridas por SQL, como en las otras suites de reportes), en una planta y un sector propios;
- se filtra siempre por ese sector, así no influyen otros datos de la base.

| N.º | Qué se prueba |
| :-: | :--- |
| EV-01 | La forma: períodos en orden, fechas como `YYYY-MM-DD`, números como número; el primer y el último período recortados a `desde` y `hasta`; los períodos vacíos, con ceros. |
| EV-02 | Sin `agrupar`: a 92 días o menos, `semana`; a más, `mes`. `agrupar=anio` da 422. Más de 60 períodos dan 422. |
| EV-03 | **La suma coincide:** la suma de `fallas`, `correctivas_finalizadas`, `preventivas_finalizadas` e `inactividad_minutos` de los períodos es igual a lo que da `/indicadores` con el mismo filtro. |
| EV-04 | **La suma coincide:** la suma de cada tipo de `costo` es igual a `por_tipo` y `total` de `/costos`. |
| EV-05 | Una detención que cruza el límite entre dos meses se reparte entre los dos, y la suma da igual que el total. |
| EV-06 | Sin `COSTOS_VER`, `costo` es `null` y el resto viene igual. |
| EV-07 | El alcance: con `SECTORES` no entran otros sectores, y un `sector_id` fuera del alcance responde como en `/indicadores`. Sin `REPORTES_CONSULTAR`, 403. |
| EV-08 | Las semanas empiezan el lunes, según la fecha local. Una falla creada el domingo 23:30, hora local, cae en esa semana y no en la siguiente. |

### 5.2 El front

Las FE de la sección 3:
- el top N con "Otras";
- las etiquetas de período;
- las conclusiones, cada una con su caso de "estable";
- el formato.

---

## 6. Cierre e informe

**Criterios de cierre:**
1. Las secciones 1 a 5 están hechas, en tres commits que compilan solos.
2. Las pruebas de la regla 4 están en verde, en Neon.
3. Se hizo push en `feat/base-neon`.

**El informe.** Las salidas van pegadas tal cual:
1. Los hashes y los números que se usaron.
2. Las versiones exactas de `@mantine/charts` y `recharts`.
3. La salida de cada suite, el typecheck y el build, con el tamaño del `index-*.js` y del grupo `charts` antes y después.
4. Cómo garantizás que la evolución y los totales coinciden (sección 1).
5. La búsqueda de colores escritos a mano en los archivos tocados.
6. Los desvíos y las dudas.

**El recorrido en pantalla lo hace el revisor,** con datos cargados, en claro y en oscuro, a 1440 y a 390 px.
