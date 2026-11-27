/**
 * Contrato entre la API y los tipos del frontend (sección 7 de la Etapa C1).
 *
 * mismaForma(real, ejemplo) compara una respuesta real de la API con su ejemplo de
 * frontend/src/api/contrato-*.ts:
 * - las mismas claves en cada nivel;
 * - en los arreglos, el primer elemento;
 * - el mismo typeof en cada hoja, salvo que uno de los dos sea null.
 *
 * Devuelve la lista de diferencias, por ejemplo
 * "renglones[0].persona.legajo: falta en la API". Vacía si tienen la misma forma.
 */

function tipoDe(valor: unknown): string {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return 'array';
  return typeof valor;
}

function unir(ruta: string, clave: string): string {
  return ruta === '' ? clave : `${ruta}.${clave}`;
}

export function mismaForma(real: unknown, ejemplo: unknown, ruta = ''): string[] {
  // Si uno de los dos es null, no se compara más abajo
  if (real === null || ejemplo === null) {
    return [];
  }

  const tReal = tipoDe(real);
  const tEjemplo = tipoDe(ejemplo);
  const donde = ruta === '' ? '(raíz)' : ruta;

  if (tReal !== tEjemplo) {
    return [`${donde}: tipo distinto (API: ${tReal}, ejemplo: ${tEjemplo})`];
  }

  if (tReal === 'array') {
    const aReal = real as unknown[];
    const aEjemplo = ejemplo as unknown[];
    if (aEjemplo.length === 0) {
      return [];
    }
    if (aReal.length === 0) {
      return [`${donde}: arreglo vacío en la API, no se puede comparar`];
    }
    return mismaForma(aReal[0], aEjemplo[0], `${ruta}[0]`);
  }

  if (tReal === 'object') {
    const oReal = real as Record<string, unknown>;
    const oEjemplo = ejemplo as Record<string, unknown>;
    const diferencias: string[] = [];

    for (const clave of Object.keys(oEjemplo)) {
      if (!(clave in oReal)) {
        diferencias.push(`${unir(ruta, clave)}: falta en la API`);
      }
    }
    for (const clave of Object.keys(oReal)) {
      if (!(clave in oEjemplo)) {
        diferencias.push(`${unir(ruta, clave)}: sobra en la API`);
      }
    }
    for (const clave of Object.keys(oEjemplo)) {
      if (clave in oReal) {
        diferencias.push(...mismaForma(oReal[clave], oEjemplo[clave], unir(ruta, clave)));
      }
    }
    return diferencias;
  }

  // Hojas del mismo typeof
  return [];
}
