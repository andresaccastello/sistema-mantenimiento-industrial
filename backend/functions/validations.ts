import { Context } from 'hono';

/**
 * Un entero seguro escrito solo con dígitos, desde `minimo`. Si no, null.
 * Para límites y desplazamientos de los listados: "1e20", "1.5", "0x10" o " 7" no son válidos.
 */
export const parseEnteroTexto = (val: unknown, minimo: number): number | null => {
  if (typeof val !== 'string' || !/^\d+$/.test(val)) return null;
  const num = Number(val);
  // Solo enteros seguros: uno más grande no entra en bigint y la base lo rechazaría
  return Number.isSafeInteger(num) && num >= minimo ? num : null;
};

/**
 * Un id, tal como llegó: un número entero seguro mayor que 0, o un texto de solo dígitos
 * que dé uno. Todo lo demás (true, [5], "0x10", "1e3", "+1", "1.0", " 7 ") da null.
 */
export const parseId = (val: unknown): number | null => {
  if (typeof val === 'number') {
    return Number.isSafeInteger(val) && val > 0 ? val : null;
  }
  return parseEnteroTexto(val, 1);
};

export const parseString = (val: any): string | null => {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const badRequest = (c: Context, message: string) => {
  return c.json({ error: message, codigo: 'DATOS_INVALIDOS' }, 400);
};

export const leerCuerpoObjeto = async (
  c: Context
): Promise<{ ok: true; body: Record<string, any> } | { ok: false; response: Response }> => {
  let raw: any;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: badRequest(c, 'El cuerpo de la solicitud debe ser un objeto JSON') };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, response: badRequest(c, 'El cuerpo de la solicitud debe ser un objeto JSON') };
  }
  return { ok: true, body: raw };
};
