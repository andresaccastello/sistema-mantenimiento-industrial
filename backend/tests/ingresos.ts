import type pg from 'pg';
import type { Hono } from 'hono';

/**
 * PUB1, 1: cada POST /api/auth/login deja una fila en intentos_ingreso. Una prueba que inicia
 * sesión anota los legajos que usa desde que empieza, y al terminar borra solo los intentos de
 * esos legajos que vinieron después: no toca los de nadie más.
 */
export interface SeguimientoIngresos {
  /** Deja `app.request` y `fetch` como estaban y borra los intentos de la prueba. Nunca tira error. */
  borrar(db: pg.Pool | pg.PoolClient): Promise<void>;
}

const RUTA_INGRESO = '/api/auth/login';

function urlDe(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export async function seguirIngresos(db: pg.Pool | pg.PoolClient, app: Hono): Promise<SeguimientoIngresos> {
  const { rows } = await db.query<{ ultimo: string }>(
    'SELECT COALESCE(max(id), 0)::text AS ultimo FROM intentos_ingreso'
  );
  const desdeId = rows[0].ultimo;
  const legajos = new Set<string>();

  const anotar = (input: string | URL | Request, init?: RequestInit) => {
    if (!urlDe(input).includes(RUTA_INGRESO) || typeof init?.body !== 'string') return;
    try {
      const cuerpo: unknown = JSON.parse(init.body);
      if (cuerpo && typeof cuerpo === 'object' && 'legajo' in cuerpo) {
        const { legajo } = cuerpo as { legajo: unknown };
        if (typeof legajo === 'string' || typeof legajo === 'number') legajos.add(String(legajo));
      }
    } catch {
      // un cuerpo que no es JSON no inicia sesión
    }
  };

  // Las pruebas llaman a la API con app.request; crud.test.ts, con fetch a su propio servidor
  const requestOriginal = app.request;
  app.request = ((input, requestInit, ...resto) => {
    anotar(input, requestInit);
    return requestOriginal(input, requestInit, ...resto);
  }) as typeof app.request;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    anotar(input, init);
    return fetchOriginal(input, init);
  }) as typeof fetch;

  return {
    async borrar(dbLimpieza) {
      app.request = requestOriginal;
      globalThis.fetch = fetchOriginal;
      if (legajos.size === 0) return;
      try {
        // El legajo, normalizado igual que en auth.ts
        await dbLimpieza.query(
          `DELETE FROM intentos_ingreso
           WHERE id > $1::bigint
             AND legajo IN (SELECT trim(left(upper(trim(l)), 50)) FROM unnest($2::text[]) AS l)`,
          [desdeId, [...legajos]]
        );
      } catch (err) {
        console.error('[limpieza] intentos de ingreso:', err instanceof Error ? err.message : String(err));
      }
    },
  };
}
